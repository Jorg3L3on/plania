// PLA-I60-1: the one place a run is queued. Every insert into agent_runs goes through insertRun:
//   work_key  what the run is about for that agent: task:<KEY>, consulta:<uuid> or general. One queued/starting/running
//             run per (agent, project, work_key) (agent_runs_active_work_unique on main). The store does not enforce
//             that partial rule, so insertRun looks for the active run and inserts in the same serialized write: two
//             wakes for the same work coalesce, with no check-then-insert race.
//   trigger   why it was queued; lane which cap it counts against; reason what its prompt says it is for.
// A wake that coalesces into a queued run appends its reason there (the run reads every event it absorbed). One that
// coalesces into a live run is kept in `absorbed`; when that run finishes, one retry is queued for it (finishRun).
import type { Agent, AgentRun, RunLane, RunTrigger } from "../db/schema.js";
import type { Q } from "../mcp/tx.js";
import { readerOf } from "../store/port.js";
import { writeVia } from "./limits.js";

export const ACTIVE_STATUSES = ["queued", "starting", "running"] as const;
export const LIVE_STATUSES = ["starting", "running"] as const;
const REASON_MAX = 2000;

export const workKeyOf = (taskKey: string | null | undefined, consultaId?: string | null): string =>
  consultaId ? `consulta:${consultaId}` : taskKey ? `task:${taskKey}` : "general";

export const consultaIdOfRun = (run: Pick<AgentRun, "workKey">): string | null => (run.workKey.startsWith("consulta:") ? run.workKey.slice("consulta:".length) : null);

export type RunInsert = {
  agent: Pick<Agent, "id">;
  project: { id: string };
  role: string;
  taskKey: string | null;
  consultaId?: string | null;
  trigger: RunTrigger;
  reason?: string | null;
  // Display text for the queued row (the screen shows it); never read for meaning.
  summary: string;
  queuedAt?: Date;
  reserveTokens?: number;
  notBefore?: Date | null;
  // false: a coalesced wake does not add its reason to the run it joins (the brief's plan wakes carry their own).
  appendReason?: boolean;
};

export type RunInserted = { kind: "queued"; run: AgentRun } | { kind: "coalesced"; existing: Pick<AgentRun, "id" | "status"> };

// The last REASON_MAX characters, as SQL's right() counted them.
const lastChars = (s: string): string => {
  const chars = [...s];
  return chars.length > REASON_MAX ? chars.slice(-REASON_MAX).join("") : s;
};

// Insert a queued run, or coalesce into the active run on the same work key. Inside the caller's write when it is in
// one; otherwise a write of its own under the run's project.
export async function insertRun(tx: Q, input: RunInsert): Promise<RunInserted> {
  const lane: RunLane = input.consultaId ? "consulta" : "work";
  const workKey = workKeyOf(input.taskKey, input.consultaId);
  const reason = input.reason?.trim() ? input.reason.trim().slice(0, REASON_MAX) : null;
  const out = await writeVia(
    tx,
    async (uow): Promise<RunInserted> => {
      // The partial unique rule, checked by hand: the read and the insert below are one serialized write.
      const [existing] = await uow.find("agentRuns", { agentId: input.agent.id, projectId: input.project.id, workKey, status: [...ACTIVE_STATUSES] }, { limit: 1 });
      if (!existing) {
        const run = await uow.insert("agentRuns", {
          agentId: input.agent.id,
          projectId: input.project.id,
          taskKey: input.taskKey,
          role: input.role,
          status: "queued",
          summary: input.summary.slice(0, 500),
          queuedAt: input.queuedAt ?? uow.now,
          reserveTokens: input.reserveTokens ?? 0,
          workKey,
          trigger: input.trigger,
          lane,
          reason,
          notBefore: input.notBefore ?? null,
        });
        return { kind: "queued", run };
      }
      if (reason && input.appendReason !== false) {
        // Appended here, inside the write, so two wakes coalescing at once never overwrite each other's reason.
        const queued = existing.status === "queued";
        const cur = (queued ? existing.reason : existing.absorbed) ?? "";
        if (!cur.includes(reason)) {
          const next = lastChars(`${cur ? `${cur}\n` : ""}${reason}`);
          await uow.update("agentRuns", { id: existing.id }, queued ? { reason: next } : { absorbed: next });
        }
      }
      return { kind: "coalesced", existing: { id: existing.id, status: existing.status } };
    },
    input.project.id,
  );
  // Every worker in this process admits within a moment (runner.ts).
  if (out.kind === "queued") await notifyQueue(tx);
  return out;
}

// The active run of this agent on this work key, if any.
export async function activeRunOn(tx: Q, agentId: string, projectId: string, workKey: string): Promise<AgentRun | null> {
  return (await readerOf(tx).get("agentRuns", { agentId, projectId, workKey, status: [...ACTIVE_STATUSES] })) ?? null;
}

// PLA-I60-2: called after a write that queued a run, so admission runs in seconds instead of at the next tick.
// The runner registers it; tests and scripts without a runner leave it a no-op.
let kick: () => void = () => {};
export const setQueueKick = (fn: () => void): void => {
  kick = fn;
};
export const kickQueue = (): void => {
  try {
    kick();
  } catch {
    // a kick never fails the write that caused it
  }
};

// On main this was NOTIFY plania_runs, delivered on commit to every listening process. The store has no channel
// between processes: it kicks this process's admission loop, which waits a moment (debounced) and then takes a write
// of its own, so it runs after the write that queued (writes are serialized). The heartbeat drains every minute as
// the fallback, as before.
export const QUEUE_CHANNEL = "plania_runs";
export async function notifyQueue(_tx: Q): Promise<void> {
  kickQueue();
}
