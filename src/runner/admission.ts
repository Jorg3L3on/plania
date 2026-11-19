// PLA-I60-2: the pieces of admission that are not the runner's own process work. The decision itself runs in
// runner.ts (admit), in one short transaction under ADMIT_LOCK, so two processes never both take the last slot:
//   limits     a project's «Agentes a la vez», «Preguntas a la vez» and «Por agente» (Motores), and a seat's own
//              «a la vez» (agents.max_parallel). The company's max_concurrent is the ceiling over every project.
//   counters   what is live now, grouped the ways the limits need, read once per admission.
//   lock keys  one live run per folder, branch and ticket (run_locks primary key).
//   weights    each run's share of the 5-hour plan, from the motor it starts with, so admission can stop before
//              the guard instead of after it.
//   machine    free memory and disk on this machine; a worker with a live run starts no more when either is low.
import { execFile } from "node:child_process";
import { statfs } from "node:fs/promises";
import { freemem, hostname, platform, totalmem } from "node:os";
import { and, eq, inArray, sql } from "drizzle-orm";
import { agentRuns, heartbeatRuns, runLocks, runnerReservations, type ProjectRunnerSettings } from "../db/schema.js";
import type { Q } from "../mcp/tx.js";
import { defineWords, say } from "../words.js";

export const ADMIT_LOCK = 7_600_017;
export const LIVE = ["starting", "running"] as const;

export type HeldCode = "project_cap" | "agent_cap" | "ceiling" | "machine" | "start_rate" | "plan" | "rest" | "lock" | "areas";

export type Limits = { maxConcurrent: number; consultaSlots: number; maxPerAgent: number; serializeAreas: boolean };

export const projectLimits = (s: ProjectRunnerSettings | null | undefined): Limits => ({
  maxConcurrent: s?.max_concurrent ?? 1,
  consultaSlots: s?.consulta_slots ?? 1,
  maxPerAgent: s?.max_per_agent ?? 1,
  serializeAreas: s?.serialize_areas ?? true,
});

// A seat's own value, else its project's «por agente». Company agents (no team project) default to 1.
export const agentCapOf = (agent: { maxParallel: number | null; projectId: string | null }, limits: Limits): number =>
  agent.maxParallel ?? (agent.projectId ? limits.maxPerAgent : 1);

// ---- plan weights (spec 6.7): est_pct_per_run is an Opus run at «Medio»; other motors scale from it.
const MODEL_FACTOR: Record<string, number> = { haiku: 0.33, sonnet: 0.66, opus: 1, fable: 1.33 };
const EFFORT_FACTOR: Record<string, number> = { low: 0.6, medium: 1, high: 1.4, xhigh: 1.8, max: 2.4 };

export function planWeight(model: string | null | undefined, effort: string | null | undefined, estPct: number): number {
  const m = (model ?? "").toLowerCase();
  const family = Object.keys(MODEL_FACTOR).find((f) => m === f || m.startsWith(`claude-${f}`));
  const mf = family ? MODEL_FACTOR[family]! : 1;
  const ef = effort ? (EFFORT_FACTOR[effort] ?? 1) : 1;
  return Math.round(estPct * mf * ef * 100) / 100;
}

// ---- lock keys (spec 6.3)
export function lockKeysOf(input: { projectId: string; taskKey: string | null; branch: string | null; cwd: string | null }): string[] {
  const keys: string[] = [];
  if (input.cwd) keys.push(`cwd:${input.cwd}`);
  if (input.branch) keys.push(`branch:${input.projectId}:${input.branch}`);
  if (input.taskKey) keys.push(`task:${input.projectId}:${input.taskKey}`);
  return keys;
}

// All keys or none: a run that cannot take every key releases the ones it took.
export async function takeLocks(tx: Q, runId: string, keys: string[]): Promise<{ ok: true } | { ok: false; held: string[] }> {
  if (keys.length === 0) return { ok: true };
  const got = await tx
    .insert(runLocks)
    .values(keys.map((lockKey) => ({ lockKey, runId })))
    .onConflictDoNothing()
    .returning({ lockKey: runLocks.lockKey });
  if (got.length === keys.length) return { ok: true };
  const mine = new Set(got.map((g) => g.lockKey));
  if (mine.size) await tx.delete(runLocks).where(and(eq(runLocks.runId, runId), inArray(runLocks.lockKey, [...mine])));
  return { ok: false, held: keys.filter((k) => !mine.has(k)) };
}

export const releaseLocks = (tx: Q, runId: string) => tx.delete(runLocks).where(eq(runLocks.runId, runId));

// ---- counters
export type Counters = {
  total: number;
  // Live work-lane runs: what the company ceiling counts (questions have their own slots, PLA-50).
  work: number;
  byProjectLane: Map<string, number>;
  byAgent: Map<string, number>;
  byWorker: Map<string, number>;
  startsLastMinute: number;
  reserved: number;
  weightSince: (at: Date | null) => number;
};

type LiveRow = { project_id: string; lane: string; agent_id: string; worker_id: string | null; started_at: Date | null; plan_weight: number | null; team: boolean } & Record<string, unknown>;

export async function readCounters(tx: Q, now: Date, extraReserved = 0): Promise<Counters> {
  const live = await tx.execute<LiveRow>(sql`
    select r.project_id, r.lane, r.agent_id, r.worker_id, r.started_at, r.plan_weight, (a.project_id is not null) as team
    from agent_runs r join agents a on a.id = r.agent_id
    where r.status in ('starting', 'running')`);
  const byProjectLane = new Map<string, number>();
  const byAgent = new Map<string, number>();
  const byWorker = new Map<string, number>();
  let starts = 0;
  for (const r of live.rows) {
    if (r.team || r.lane === "consulta") byProjectLane.set(`${r.project_id}:${r.lane}`, (byProjectLane.get(`${r.project_id}:${r.lane}`) ?? 0) + 1);
    if (r.lane === "work") byAgent.set(r.agent_id, (byAgent.get(r.agent_id) ?? 0) + 1);
    if (r.worker_id) byWorker.set(r.worker_id, (byWorker.get(r.worker_id) ?? 0) + 1);
    if (r.started_at && new Date(r.started_at).getTime() >= now.getTime() - 60_000) starts += 1;
  }
  const [res] = await tx
    .select({ n: sql<number>`coalesce(sum(${runnerReservations.slots}), 0)::int` })
    .from(runnerReservations)
    .where(sql`${runnerReservations.expiresAt} > ${now.toISOString()}::timestamptz`);
  const rows = live.rows;
  return {
    total: rows.length,
    work: rows.filter((r) => r.lane === "work").length,
    byProjectLane,
    byAgent,
    byWorker,
    startsLastMinute: starts,
    reserved: Math.max(res?.n ?? 0, extraReserved),
    weightSince: (at) => rows.filter((r) => !at || (r.started_at && new Date(r.started_at).getTime() >= at.getTime())).reduce((a, r) => a + (r.plan_weight ?? 0), 0),
  };
}

export const bump = (c: Counters, run: { projectId: string; lane: string; agentId: string; team: boolean; weight: number }, worker: string, now: Date): void => {
  c.total += 1;
  if (run.lane === "work") c.work += 1;
  if (run.team || run.lane === "consulta") c.byProjectLane.set(`${run.projectId}:${run.lane}`, (c.byProjectLane.get(`${run.projectId}:${run.lane}`) ?? 0) + 1);
  if (run.lane === "work") c.byAgent.set(run.agentId, (c.byAgent.get(run.agentId) ?? 0) + 1);
  c.byWorker.set(worker, (c.byWorker.get(worker) ?? 0) + 1);
  c.startsLastMinute += 1;
  const prev = c.weightSince;
  c.weightSince = (at) => prev(at) + (!at || now.getTime() >= at.getTime() ? run.weight : 0);
};

// ---- this worker and machine
export const workerId = (env: NodeJS.ProcessEnv = process.env): string => env.PLANIA_WORKER_ID?.trim() || `${hostname()}:main`;

export const workerCapacity = (env: NodeJS.ProcessEnv = process.env): number => {
  const n = Number(env.PLANIA_WORKER_MAX_RUNS);
  if (Number.isInteger(n) && n > 0) return n;
  return Math.max(1, Math.floor((totalmem() / 1048576 - 3072) / 400));
};

export type MachineFacts = { freeMb: number; freeDiskGb: number };

let memCache: { at: number; mb: number } | null = null;
// Memory the OS can hand out now. On macOS free pages alone are near zero most of the time (the rest is cache), so
// inactive, speculative and purgeable pages count too.
export async function availableMemoryMb(): Promise<number> {
  if (memCache && Date.now() - memCache.at < 10_000) return memCache.mb;
  let mb = freemem() / 1048576;
  if (platform() === "darwin") {
    const text = await new Promise<string | null>((resolve) => execFile("vm_stat", [], { timeout: 3_000 }, (err, out) => resolve(err ? null : String(out))));
    if (text) {
      const page = Number(/page size of (\d+) bytes/.exec(text)?.[1] ?? 16384);
      const pages = (name: string) => Number(new RegExp(`Pages ${name}:\\s+(\\d+)`).exec(text)?.[1] ?? 0);
      mb = ((pages("free") + pages("inactive") + pages("speculative") + pages("purgeable")) * page) / 1048576;
    }
  }
  memCache = { at: Date.now(), mb };
  return mb;
}

export async function freeDiskGb(dir: string): Promise<number> {
  try {
    const s = await statfs(dir);
    return (Number(s.bavail) * Number(s.bsize)) / 1073741824;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

// ---- the screen's words for a held run (Appendix C); the screen renders these, the API carries code + detail.
// PLA-I2-10: in the install's language (heldText); the Spanish is unchanged.
type HeldWords = Record<HeldCode, string>;
export const HELD_WORDS = defineWords<HeldWords>({
  es: {
    project_cap: "Esperando lugar en el proyecto",
    agent_cap: "Esperando: este puesto ya hace lo que su tope permite",
    ceiling: "Esperando lugar en la máquina",
    machine: "La máquina está corta de memoria o disco",
    start_rate: "Arrancando de a poco",
    plan: "El plan va alto; sigue cuando baje",
    rest: "Descansa entre corridas",
    lock: "Espera a que termine el trabajo en la misma rama o ticket",
    areas: "Espera: otro trabajo toca los mismos archivos",
  },
  en: {
    project_cap: "Waiting for room in the project",
    agent_cap: "Waiting: this seat is already doing as much as its limit allows",
    ceiling: "Waiting for room on the machine",
    machine: "The machine is short of memory or disk",
    start_rate: "Starting a few at a time",
    plan: "The plan is running high; it goes on when it comes down",
    rest: "Resting between runs",
    lock: "Waiting for the work on the same branch or ticket to finish",
    areas: "Waiting: other work touches the same files",
  },
});
export const heldText = (code: HeldCode): string | null => say(HELD_WORDS)[code] ?? null;

// Runs whose admission was lost (the process died between admitting and spawning): their lease ran out while
// still `starting`. They end as fail and free their locks.
export async function reapLostStarts(tx: Q, now: Date): Promise<number> {
  const rows = await tx
    .update(agentRuns)
    .set({ status: "fail", summary: "fail: start lost", endedAt: now, stopReason: "start_lost" })
    .where(and(eq(agentRuns.status, "starting"), sql`${agentRuns.leaseUntil} < ${now.toISOString()}::timestamptz`))
    .returning({ id: agentRuns.id, agentId: agentRuns.agentId, startedAt: agentRuns.startedAt, queuedAt: agentRuns.queuedAt, taskKey: agentRuns.taskKey, summary: agentRuns.summary });
  if (rows.length) {
    await tx.delete(runLocks).where(inArray(runLocks.runId, rows.map((r) => r.id)));
    await tx.insert(heartbeatRuns).values(rows.map((r) => ({ agentId: r.agentId, startedAt: r.startedAt ?? r.queuedAt, endedAt: now, status: "fail", adapter: "claude_code", summary: r.summary, taskKey: r.taskKey })));
  }
  return rows.length;
}

// PLA-I60-3: live runs of another worker whose lease ran out more than two minutes ago: that worker is gone. They
// end as fail: worker lost and free their keys (PLA-16 then retries or hands the ticket over).
export async function reapLostWorkers(tx: Q, me: string, now: Date): Promise<number> {
  const rows = await tx
    .update(agentRuns)
    .set({ status: "fail", summary: "fail: worker lost", endedAt: now, stopReason: "worker_lost" })
    .where(
      and(
        eq(agentRuns.status, "running"),
        sql`${agentRuns.workerId} is not null and ${agentRuns.workerId} <> ${me}`,
        sql`${agentRuns.leaseUntil} < ${new Date(now.getTime() - 2 * 60_000).toISOString()}::timestamptz`,
      ),
    )
    .returning({ id: agentRuns.id, agentId: agentRuns.agentId, startedAt: agentRuns.startedAt, queuedAt: agentRuns.queuedAt, taskKey: agentRuns.taskKey, summary: agentRuns.summary });
  if (rows.length) {
    await tx.delete(runLocks).where(inArray(runLocks.runId, rows.map((r) => r.id)));
    await tx.insert(heartbeatRuns).values(rows.map((r) => ({ agentId: r.agentId, startedAt: r.startedAt ?? r.queuedAt, endedAt: now, status: "fail", adapter: "claude_code", summary: r.summary, taskKey: r.taskKey })));
  }
  return rows.length;
}
