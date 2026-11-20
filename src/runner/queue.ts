// PLA-I60-1: the one place a run is queued. Every insert into agent_runs goes through insertRun:
//   work_key  what the run is about for that agent: task:<KEY>, consulta:<uuid> or general. The partial unique index
//             agent_runs_active_work_unique allows one queued/starting/running run per (agent, project, work_key), so
//             two wakes for the same work coalesce in SQL, from any process, with no check-then-insert race.
//   trigger   why it was queued; lane which cap it counts against; reason what its prompt says it is for.
// A wake that coalesces into a queued run appends its reason there (the run reads every event it absorbed). One that
// coalesces into a live run is kept in `absorbed`; when that run finishes, one retry is queued for it (finishRun).
import { and, eq, inArray, sql } from "drizzle-orm";
import { agentRuns, type Agent, type AgentRun, type RunLane, type RunTrigger } from "../db/schema.js";
import type { Q } from "../mcp/tx.js";

export const ACTIVE_STATUSES = ["queued", "starting", "running"] as const;
export const LIVE_STATUSES = ["starting", "running"] as const;
const REASON_MAX = 2000;

// PLA-I67-6: trial:<id> is a skill trial (src/runner/trial.ts); it has no task key.
export const workKeyOf = (taskKey: string | null | undefined, consultaId?: string | null, trialId?: string | null): string =>
  trialId ? `trial:${trialId}` : consultaId ? `consulta:${consultaId}` : taskKey ? `task:${taskKey}` : "general";

export const consultaIdOfRun = (run: Pick<AgentRun, "workKey">): string | null => (run.workKey.startsWith("consulta:") ? run.workKey.slice("consulta:".length) : null);

export type RunInsert = {
  agent: Pick<Agent, "id">;
  project: { id: string };
  role: string;
  taskKey: string | null;
  consultaId?: string | null;
  trialId?: string | null;
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

// Insert a queued run, or coalesce into the active run on the same work key.
export async function insertRun(tx: Q, input: RunInsert): Promise<RunInserted> {
  const lane: RunLane = input.consultaId ? "consulta" : "work";
  const workKey = workKeyOf(input.taskKey, input.consultaId, input.trialId);
  const reason = input.reason?.trim() ? input.reason.trim().slice(0, REASON_MAX) : null;
  const [row] = await tx
    .insert(agentRuns)
    .values({
      agentId: input.agent.id,
      projectId: input.project.id,
      taskKey: input.taskKey,
      role: input.role,
      status: "queued",
      summary: input.summary.slice(0, 500),
      queuedAt: input.queuedAt ?? new Date(),
      reserveTokens: input.reserveTokens ?? 0,
      workKey,
      trigger: input.trigger,
      lane,
      reason,
      notBefore: input.notBefore ?? null,
    })
    .onConflictDoNothing({ target: [agentRuns.agentId, agentRuns.projectId, agentRuns.workKey], where: sql.raw(`status in ('queued', 'starting', 'running')`) })
    .returning();
  if (row) {
    // Delivered when this transaction commits: every worker listening admits within a moment (runner.ts).
    await notifyQueue(tx);
    return { kind: "queued", run: row };
  }
  const [existing] = await tx
    .select({ id: agentRuns.id, status: agentRuns.status })
    .from(agentRuns)
    .where(and(eq(agentRuns.agentId, input.agent.id), eq(agentRuns.projectId, input.project.id), eq(agentRuns.workKey, workKey), inArray(agentRuns.status, [...ACTIVE_STATUSES])))
    .limit(1);
  // The other run ended between the conflict and this read: try once more.
  if (!existing) return insertRun(tx, input);
  if (reason && input.appendReason !== false) {
    // Appended in SQL, so two wakes coalescing at once never overwrite each other's reason.
    const col = existing.status === "queued" ? agentRuns.reason : agentRuns.absorbed;
    const name = existing.status === "queued" ? "reason" : "absorbed";
    await tx
      .update(agentRuns)
      .set({ [name]: sql`right(coalesce(nullif(${col}, '') || E'\n', '') || ${reason}, ${REASON_MAX})` })
      .where(and(eq(agentRuns.id, existing.id), sql`position(${reason} in coalesce(${col}, '')) = 0`));
  }
  return { kind: "coalesced", existing: { id: existing.id, status: existing.status } };
}

// The active run of this agent on this work key, if any.
export async function activeRunOn(tx: Q, agentId: string, projectId: string, workKey: string): Promise<AgentRun | null> {
  const [row] = await tx
    .select()
    .from(agentRuns)
    .where(and(eq(agentRuns.agentId, agentId), eq(agentRuns.projectId, projectId), eq(agentRuns.workKey, workKey), inArray(agentRuns.status, [...ACTIVE_STATUSES])))
    .limit(1);
  return row ?? null;
}

// PLA-I60-2: called after a commit that queued a run, so admission runs in seconds instead of at the next tick.
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

export const QUEUE_CHANNEL = "plania_runs";
export async function notifyQueue(tx: Q): Promise<void> {
  await tx.execute(sql`select pg_notify(${QUEUE_CHANNEL}, '')`).catch(() => undefined);
}
