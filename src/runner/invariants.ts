// PLA-I60-6: the runner's rules, checked against the store. Admission is built to keep them (spec section 5);
// this proves it: the load test calls it every 100 ms, and the audit job turns any violation into a finding.
//   I1  one active run per (agent, project, work key)            (insertRun checks it inside the write that queues)
//   I2  no lock key held by a run that is no longer live          (a leak would block that folder or branch)
//   I3  a project's live work-lane runs within «Agentes a la vez»; its questions within «Preguntas a la vez»
//   I4  an agent's live work runs within its cap
//   I5  live work runs within the ceiling minus reserved slots (questions: I3b); a worker's runs within its capacity
// Lowering a number never stops a live run, so I3-I5 are not checked for ten minutes after one changed.
import type { Q } from "../mcp/tx.js";
import { readerOf } from "../store/port.js";
import { gt } from "../store/types.js";

export type Violation = { code: "I1" | "I2" | "I3" | "I3b" | "I4" | "I5" | "I5b"; detail: string };

const ACTIVE = ["queued", "starting", "running"];
const LIVE = ["starting", "running"];
const RECENT_MS = 10 * 60_000;

// A whole number from a project's settings.runner, else null (what (settings->'runner'->>'x')::int gave).
const intOf = (v: unknown): number | null => (typeof v === "number" ? Math.trunc(v) : typeof v === "string" && /^\s*-?\d+\s*$/.test(v) ? Number(v) : null);

function counts<K>(rows: readonly K[]): Map<K, number> {
  const out = new Map<K, number>();
  for (const k of rows) out.set(k, (out.get(k) ?? 0) + 1);
  return out;
}

export async function checkRunnerInvariants(db: Q): Promise<Violation[]> {
  const out: Violation[] = [];
  const r = readerOf(db);
  const now = Date.now();
  const active = await r.find("agentRuns", { status: ACTIVE });
  for (const [k, n] of counts(active.map((x) => JSON.stringify([x.agentId, x.projectId, x.workKey])))) {
    if (n > 1) out.push({ code: "I1", detail: `${(JSON.parse(k) as string[])[2]}: ${n} active runs for one agent` });
  }
  for (const l of await r.find("runLocks")) {
    const run = await r.get("agentRuns", { id: l.runId });
    if (run && !LIVE.includes(run.status)) out.push({ code: "I2", detail: `${l.lockKey} held by a ${run.status} run` });
  }

  const since = new Date(now - RECENT_MS);
  const changed =
    (await r.count("events", { type: ["project.runner", "agent.parallel", "company.ceiling"], createdAt: gt(since) })) > 0 ||
    (await r.count("runnerSettings", { updatedAt: gt(since) })) > 0;
  if (changed) return out;

  const live = active.filter((x) => LIVE.includes(x.status));
  const agents = new Map((await r.find("agents", { id: [...new Set(live.map((x) => x.agentId))] })).map((a) => [a.id, a]));
  const projects = new Map((await r.find("projects")).map((p) => [p.id, p]));
  const runnerOf = (projectId: string | null | undefined) => (projectId ? (projects.get(projectId)?.settings?.runner as Record<string, unknown> | undefined) : undefined);

  // I3: work runs of team agents, by the agent's project (one that still exists).
  const teamWork = live.filter((x) => x.lane === "work").map((x) => agents.get(x.agentId)?.projectId).filter((id): id is string => !!id && projects.has(id));
  for (const [projectId, n] of counts(teamWork)) {
    const cap = intOf(runnerOf(projectId)?.max_concurrent) ?? 1;
    if (n > cap) out.push({ code: "I3", detail: `project ${projectId}: ${n} live over ${cap}` });
  }
  const questions = live.filter((x) => x.lane === "consulta" && projects.has(x.projectId)).map((x) => x.projectId);
  for (const [projectId, n] of counts(questions)) {
    const cap = intOf(runnerOf(projectId)?.consulta_slots) ?? 1;
    if (n > cap) out.push({ code: "I3b", detail: `project ${projectId}: ${n} questions over ${cap}` });
  }
  const byAgent = live.filter((x) => x.lane === "work" && agents.has(x.agentId)).map((x) => x.agentId);
  for (const [agentId, n] of counts(byAgent)) {
    const a = agents.get(agentId)!;
    const cap = a.maxParallel ?? (a.projectId === null ? 1 : intOf(runnerOf(a.projectId)?.max_per_agent)) ?? 1;
    if (n > cap) out.push({ code: "I4", detail: `agent ${agentId}: ${n} live over ${cap}` });
  }
  const settings = await r.get("runnerSettings", { id: 1 });
  if (settings) {
    const reserved = (await r.find("runnerReservations", { expiresAt: gt(new Date(now)) })).reduce((a, x) => a + x.slots, 0);
    const work = live.filter((x) => x.lane === "work").length;
    const allowed = settings.maxConcurrent - reserved;
    if (work > allowed) out.push({ code: "I5", detail: `${work} live over ${allowed}` });
  }
  const workers = new Map((await r.find("runnerWorkers")).map((w) => [w.id, w]));
  for (const [workerId, n] of counts(live.map((x) => x.workerId).filter((id): id is string => !!id && workers.has(id)))) {
    const capacity = workers.get(workerId)!.capacity;
    if (n > capacity) out.push({ code: "I5b", detail: `worker ${workerId}: ${n} live over ${capacity}` });
  }
  return out;
}
