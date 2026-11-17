// PLA-I60-2: the pieces of admission that are not the runner's own process work. The decision itself runs in
// runner.ts (admit), in one serialized store write, so two admissions never both take the last slot:
//   limits     a project's «Agentes a la vez», «Preguntas a la vez» and «Por agente» (Motores), and a seat's own
//              «a la vez» (agents.max_parallel). The company's max_concurrent is the ceiling over every project.
//   counters   what is live now, grouped the ways the limits need, read once per admission.
//   lock keys  one live run per folder, branch and ticket (run_locks primary key).
//   weights    each run's share of the 5-hour plan, from the motor it starts with, so admission can stop before
//              the guard instead of after it.
//   machine    free memory and disk on this Mac; a worker with a live run starts no more when either is low.
import { execFile } from "node:child_process";
import { statfs } from "node:fs/promises";
import { freemem, hostname, platform, totalmem } from "node:os";
import type { ProjectRunnerSettings } from "../db/schema.js";
import type { Q } from "../mcp/tx.js";
import { uowOf } from "../store/port.js";
import { gt, lt, ne } from "../store/types.js";
import { writeVia } from "./limits.js";

// On main, the Postgres advisory lock admission took. The store's write queue is that lock now; kept for callers.
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

// All keys or none: a run that cannot take every key takes none. Inside the admission write: on main the primary key's
// "on conflict do nothing" found the taken keys; here they are read, and the keys inserted, in that same write.
export async function takeLocks(tx: Q, runId: string, keys: string[]): Promise<{ ok: true } | { ok: false; held: string[] }> {
  if (keys.length === 0) return { ok: true };
  const uow = uowOf(tx);
  const held: string[] = [];
  for (const lockKey of keys) if (await uow.get("runLocks", { lockKey })) held.push(lockKey);
  if (held.length) return { ok: false, held };
  for (const lockKey of keys) await uow.insert("runLocks", { lockKey, runId, acquiredAt: uow.now });
  return { ok: true };
}

// Inside the caller's write when it is in one (the end of a run and its release are one write).
export const releaseLocks = (tx: Q, runId: string): Promise<unknown> => writeVia(tx, (uow) => uow.delete("runLocks", { runId }));

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

type LiveRow = { project_id: string; lane: string; agent_id: string; worker_id: string | null; started_at: Date | null; plan_weight: number | null; team: boolean };

export async function readCounters(tx: Q, now: Date, extraReserved = 0): Promise<Counters> {
  const uow = uowOf(tx);
  // The live runs whose agent still exists, with whether that agent is on a project's team.
  const rows: LiveRow[] = [];
  const runs = await uow.find("agentRuns", { status: ["starting", "running"] });
  const agents = new Map((await uow.find("agents", { id: [...new Set(runs.map((r) => r.agentId))] })).map((a) => [a.id, a]));
  for (const r of runs) {
    const a = agents.get(r.agentId);
    if (!a) continue;
    rows.push({ project_id: r.projectId, lane: r.lane, agent_id: r.agentId, worker_id: r.workerId, started_at: r.startedAt, plan_weight: r.planWeight, team: a.projectId !== null });
  }
  const byProjectLane = new Map<string, number>();
  const byAgent = new Map<string, number>();
  const byWorker = new Map<string, number>();
  let starts = 0;
  for (const r of rows) {
    if (r.team || r.lane === "consulta") byProjectLane.set(`${r.project_id}:${r.lane}`, (byProjectLane.get(`${r.project_id}:${r.lane}`) ?? 0) + 1);
    if (r.lane === "work") byAgent.set(r.agent_id, (byAgent.get(r.agent_id) ?? 0) + 1);
    if (r.worker_id) byWorker.set(r.worker_id, (byWorker.get(r.worker_id) ?? 0) + 1);
    if (r.started_at && r.started_at.getTime() >= now.getTime() - 60_000) starts += 1;
  }
  const reserved = (await uow.find("runnerReservations", { expiresAt: gt(now) })).reduce((a, x) => a + x.slots, 0);
  return {
    total: rows.length,
    work: rows.filter((r) => r.lane === "work").length,
    byProjectLane,
    byAgent,
    byWorker,
    startsLastMinute: starts,
    reserved: Math.max(reserved, extraReserved),
    weightSince: (at) => rows.filter((r) => !at || (r.started_at && r.started_at.getTime() >= at.getTime())).reduce((a, r) => a + (r.plan_weight ?? 0), 0),
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
export const HELD_TEXT: Record<HeldCode, string> = {
  project_cap: "Esperando lugar en el proyecto",
  agent_cap: "Esperando: este puesto ya hace lo que su tope permite",
  ceiling: "Esperando lugar en la Mac",
  machine: "La Mac está corta de memoria o disco",
  start_rate: "Arrancando de a poco",
  plan: "El plan va alto; sigue cuando baje",
  rest: "Descansa entre corridas",
  lock: "Espera a que termine el trabajo en la misma rama o ticket",
  areas: "Espera: otro trabajo toca los mismos archivos",
};

// Runs whose admission was lost (the process died between admitting and spawning): their lease ran out while
// still `starting`. They end as fail and free their locks.
export async function reapLostStarts(tx: Q, now: Date): Promise<number> {
  const uow = uowOf(tx);
  const rows = await uow.update("agentRuns", { status: "starting", leaseUntil: lt(now) }, { status: "fail", summary: "fail: start lost", endedAt: now, stopReason: "start_lost" });
  await endReaped(tx, rows, now);
  return rows.length;
}

// PLA-I60-3: live runs of another worker whose lease ran out more than two minutes ago: that worker is gone. They
// end as fail: worker lost and free their keys (PLA-16 then retries or hands the ticket over).
export async function reapLostWorkers(tx: Q, me: string, now: Date): Promise<number> {
  const uow = uowOf(tx);
  // ne(me) never matches a null worker, as `worker_id is not null and worker_id <> me` did.
  const rows = await uow.update(
    "agentRuns",
    { status: "running", workerId: ne(me), leaseUntil: lt(new Date(now.getTime() - 2 * 60_000)) },
    { status: "fail", summary: "fail: worker lost", endedAt: now, stopReason: "worker_lost" },
  );
  await endReaped(tx, rows, now);
  return rows.length;
}

// The reaped runs' keys go, and each gets its heartbeat row.
async function endReaped(tx: Q, rows: { id: string; agentId: string; startedAt: Date | null; queuedAt: Date; taskKey: string | null; summary: string }[], now: Date): Promise<void> {
  const uow = uowOf(tx);
  if (rows.length) await uow.delete("runLocks", { runId: rows.map((r) => r.id) });
  for (const r of rows) {
    await uow.insert("heartbeatRuns", { agentId: r.agentId, startedAt: r.startedAt ?? r.queuedAt, endedAt: now, status: "fail", adapter: "claude_code", summary: r.summary, taskKey: r.taskKey });
  }
}
