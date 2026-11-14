import type { Db } from "../db/client.js";
import { ADAPTERS, type AdapterConfig, type AdapterName } from "../db/schema.js";
import { spawn, type SpawnDeps, type SpawnTask } from "../adapters/index.js";
import { requeueHeld, sweepFailedRuns, sweepStoppedRuns } from "../runner/failed.js";
import { COMPANY } from "../runner/limits.js";
import { cleanupWorktrees, drainQueue, enforceLive, wakeClaude, type RunnerDeps } from "../runner/runner.js";
import { ToolError } from "../mcp/errors.js";
import { iso } from "../mcp/tx.js";
import { storeOf, readerOf } from "../store/port.js";
import type { NewRow } from "../store/types.js";
import type { Job } from "./index.js";

// PLA-I26: on each agent's cadence, pick Ready work and wake them through their adapter.
// Stuck agents stay on sweepStuck (src/jobs/stuck.ts). A second wake inside the cadence writes nothing.
// Summaries never include adapter config values.

const SLUG = /^[a-z][a-z0-9-]{0,58}$/;
const MINUTE = 60_000;
const PRIORITY = ["P0", "P1", "P2", "P3"];
const WORK = ["code", "ops", "research", "decision-needed", "bug", "debt"];

const CAP_WORK: Record<string, readonly string[]> = {
  cursor: ["code", "bug", "debt"],
  "claude-code": ["code", "bug", "debt"],
  engineering: ["code", "bug", "debt", "ops"],
  research: ["research"],
  design: ["decision-needed"],
  staff: ["ops"],
  coo: ["ops", "decision-needed"],
  cto: ["code", "bug", "debt", "ops"],
  "chief-of-staff": ["ops"],
  "product-owner": ["decision-needed"],
  engineer: ["code", "bug", "debt"],
  shared: ["research", "decision-needed"],
};

export type ReadyWork = {
  project: string;
  key: string;
  title: string;
  priority: string | null;
  workType: string | null;
  ownerAgent: string | null;
  // PLA-I29-10: the project's runs_paused switch. A paused project offers no work to anyone.
  paused?: boolean;
  // PLA-I36-6: Jorge picked this ticket to go first in its project (settings.next_first).
  first?: boolean;
};

export type HeartbeatRunView = {
  agent: string;
  started_at: string;
  ended_at: string | null;
  status: string;
  adapter: string;
  summary: string;
  task_key: string | null;
};

// queued: the runner's cap is full, the run waits its turn. coalesced: a run of this agent is
// already live or queued, so the wake wrote nothing.
export type WakeResult = {
  woke: boolean;
  reason: "ok" | "cadence" | "dry-run" | "queued" | "coalesced";
  run: HeartbeatRunView | null;
};

export type HeartbeatDeps = SpawnDeps & { runner?: RunnerDeps };

const checkSlug = (slug: string): string => {
  const trimmed = slug.trim().toLowerCase();
  if (!SLUG.test(trimmed)) throw new ToolError("INVALID_FILTER", { field: "agent", hint: "lowercase letters, digits and dashes" });
  return trimmed;
};

const adapterOf = (value: string): AdapterName => ((ADAPTERS as readonly string[]).includes(value) ? (value as AdapterName) : "none");

const workTypesFor = (role: string, capabilities: string[]): Set<string> => {
  const out = new Set<string>();
  for (const cap of [role, ...capabilities]) {
    if (WORK.includes(cap)) out.add(cap);
    for (const item of CAP_WORK[cap] ?? []) out.add(item);
  }
  return out;
};

const priorityRank = (priority: string | null): number => {
  const index = PRIORITY.indexOf(priority ?? "");
  return index === -1 ? PRIORITY.length : index;
};

// A product owner belongs to one project: po-<slug>, or a capability naming the project
// (the same rule as the event wakes in src/runner/events.ts).
const ownProject = (agent: { slug?: string; capabilities: string[] }, project: string): boolean =>
  agent.slug === `po-${project}` || agent.capabilities.includes(project);

// Owned Ready work wins. Otherwise an unowned Ready ticket in a capable project or work type.
// PLA-I29-10: never from a paused project, and a product owner only inside its own project.
// PLA-I32-5: a team member (projectSlug, from agents.project_id) only ever picks in its own project.
export const pickReady = (agent: { id: string; slug?: string; role: string; capabilities: string[]; projectSlug?: string | null }, rows: ReadyWork[]): ReadyWork | null => {
  const types = workTypesFor(agent.role, agent.capabilities);
  const caps = new Set(agent.capabilities);
  const isPo = agent.role === "product-owner" || !!agent.slug?.startsWith("po-");
  const matches = rows.filter((row) => {
    if (row.title.includes("[PRUEBA]")) return false;
    if (row.paused) return false;
    if (agent.projectSlug && row.project !== agent.projectSlug) return false;
    if (isPo && !agent.projectSlug && !ownProject(agent, row.project)) return false;
    if (row.ownerAgent === agent.id) return true;
    if (row.ownerAgent) return false;
    if (caps.has(row.project)) return true;
    return !!row.workType && types.has(row.workType);
  });
  matches.sort((a, b) => {
    const owned = Number(b.ownerAgent === agent.id) - Number(a.ownerAgent === agent.id);
    if (owned) return owned;
    const first = Number(!!b.first) - Number(!!a.first);
    if (first) return first;
    const priority = priorityRank(a.priority) - priorityRank(b.priority);
    if (priority) return priority;
    return a.project.localeCompare(b.project) || a.key.localeCompare(b.key);
  });
  return matches[0] ?? null;
};

export const loadReady = async (db: Db): Promise<ReadyWork[]> => {
  const r = readerOf(db);
  const live = new Map((await r.find("projects", { runsPaused: false })).map((p) => [p.id, p]));
  if (!live.size) return [];
  const rows = await r.find("tasks", { projectId: [...live.keys()], kind: "ticket", status: "Ready" });
  return rows.map((t) => {
    const p = live.get(t.projectId)!;
    return {
      project: p.slug,
      key: t.key,
      title: t.title,
      priority: t.priority,
      workType: t.workType,
      ownerAgent: t.ownerAgent,
      paused: p.runsPaused,
      first: p.settings.next_first === t.key,
    };
  });
};

const taskOf = (row: ReadyWork | null): SpawnTask | null => (row ? { project: row.project, key: row.key, title: row.title } : null);

const viewOf = (
  slug: string,
  row: { startedAt: Date; endedAt: Date | null; status: string; adapter: string; summary: string; taskKey: string | null },
): HeartbeatRunView => ({
  agent: slug,
  started_at: iso(row.startedAt)!,
  ended_at: iso(row.endedAt),
  status: row.status,
  adapter: row.adapter,
  summary: row.summary,
  task_key: row.taskKey,
});

// A heartbeat run belongs to an agent, a company row: its write carries no project.
const recordRun = (db: Db, run: NewRow<"heartbeatRuns">) => storeOf(db).write(COMPANY, {}, (uow) => uow.insert("heartbeatRuns", run));

const explicitTask = async (db: Db, agentId: string, taskKey: string): Promise<ReadyWork> => {
  const key = taskKey.trim();
  // The key in every project: a key is unique only inside its own.
  const r = readerOf(db);
  const found = await r.find("tasks", { key });
  if (found.length === 0) throw new ToolError("TASK_NOT_FOUND", { key });
  if (found.length > 1) throw new ToolError("INVALID_FILTER", { field: "task_key", hint: "key is in more than one project" });
  const task = found[0]!;
  if (task.kind !== "ticket" || task.status !== "Ready") throw new ToolError("INVALID_FILTER", { field: "task_key", hint: "not Ready" });
  if (task.ownerAgent && task.ownerAgent !== agentId) throw new ToolError("INVALID_FILTER", { field: "task_key", hint: "owned by another agent" });
  const project = (await r.get("projects", { id: task.projectId }))!;
  return {
    project: project.slug,
    key: task.key,
    title: task.title,
    priority: task.priority,
    workType: task.workType,
    ownerAgent: task.ownerAgent,
  };
};

export const wakeAgent = async (db: Db, input: { agent: string; taskKey?: string; dryRun?: boolean; now?: Date }, deps?: HeartbeatDeps): Promise<WakeResult> => {
  const slug = checkSlug(input.agent);
  const now = input.now ?? new Date();
  const r = readerOf(db);
  const row = await r.get("agents", { slug });
  if (!row) throw new ToolError("AGENT_NOT_FOUND", { slug });

  const chosen = input.taskKey ? await explicitTask(db, row.id, input.taskKey) : null;
  const spawnAgent = {
    slug: row.slug,
    adapter: adapterOf(row.adapter),
    adapterConfig: (row.adapterConfig ?? {}) as AdapterConfig,
    wakeUrl: row.wakeUrl,
  };

  if (input.dryRun) {
    await spawn({ agent: spawnAgent, task: taskOf(chosen), dryRun: true }, deps);
    return { woke: false, reason: "dry-run", run: null };
  }

  const dueBefore = row.heartbeatMinutes == null ? null : new Date(now.getTime() - row.heartbeatMinutes * MINUTE);
  const cadenceOpen = dueBefore == null || !row.lastHeartbeatAt || new Date(row.lastHeartbeatAt).getTime() <= dueBefore.getTime();
  if (!cadenceOpen) return { woke: false, reason: "cadence", run: null };

  // The cadence is taken inside one serialized write: of two wakes at once, only the first finds it still open.
  const claimed = await storeOf(db).write(COMPANY, {}, async (uow) => {
    const cur = await uow.get("agents", { id: row.id });
    if (!cur) return false;
    if (dueBefore != null && cur.lastHeartbeatAt != null && cur.lastHeartbeatAt.getTime() > dueBefore.getTime()) return false;
    await uow.update("agents", { id: row.id }, { lastHeartbeatAt: now, updatedAt: uow.now });
    return true;
  });
  if (!claimed) return { woke: false, reason: "cadence", run: null };

  const projectSlug = row.projectId ? ((await r.get("projects", { id: row.projectId }))?.slug ?? null) : null;
  const task = chosen ?? pickReady({ ...row, projectSlug }, await loadReady(db));

  // PLA-I29: claude_code wakes go through the runner (limits, worktree, supervised process).
  // A started run writes its heartbeat_runs row when it ends; a skip or a fail writes it now.
  if (spawnAgent.adapter === "claude_code") {
    const outcome = await wakeClaude(db, { agent: row, task, now }, deps?.runner);
    if (outcome.kind === "coalesced") return { woke: false, reason: "coalesced", run: null };
    if (outcome.kind === "queued") {
      return { woke: false, reason: "queued", run: { agent: row.slug, started_at: iso(now)!, ended_at: null, status: "queued", adapter: "claude_code", summary: outcome.summary, task_key: outcome.taskKey } };
    }
    if (outcome.kind === "started") {
      return { woke: true, reason: "ok", run: { agent: row.slug, started_at: iso(now)!, ended_at: null, status: "running", adapter: "claude_code", summary: outcome.summary, task_key: outcome.taskKey } };
    }
    if (outcome.recorded) {
      return { woke: true, reason: "ok", run: { agent: row.slug, started_at: iso(now)!, ended_at: iso(new Date()), status: outcome.kind, adapter: "claude_code", summary: outcome.summary, task_key: outcome.taskKey } };
    }
    const skipped = await recordRun(db, { agentId: row.id, startedAt: now, endedAt: new Date(), status: outcome.kind, adapter: "claude_code", summary: outcome.summary.slice(0, 500), taskKey: outcome.taskKey });
    return { woke: true, reason: "ok", run: viewOf(row.slug, skipped) };
  }

  const outcome = await spawn({ agent: spawnAgent, task: taskOf(task) }, deps);
  const summary = task ? outcome.summary : outcome.status === "ok" ? "no ready work" : outcome.summary;
  const inserted = await recordRun(db, {
    agentId: row.id,
    startedAt: now,
    endedAt: new Date(),
    status: outcome.status,
    adapter: outcome.adapter,
    summary: summary.slice(0, 500),
    taskKey: task?.key ?? null,
  });
  return { woke: true, reason: "ok", run: viewOf(row.slug, inserted) };
};

export const listHeartbeatRuns = async (db: Db, filter: { agent?: string; limit?: number } = {}): Promise<{ runs: HeartbeatRunView[] }> => {
  const limit = filter.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new ToolError("INVALID_FILTER", { field: "limit", max: 100 });
  const slug = filter.agent ? checkSlug(filter.agent) : undefined;
  const r = readerOf(db);
  let agentId: string | undefined;
  if (slug) {
    const row = await r.get("agents", { slug });
    if (!row) throw new ToolError("AGENT_NOT_FOUND", { slug });
    agentId = row.id;
  }
  // Every run has its agent (the foreign key cascades), so the limit applies before the agents are read.
  const rows = await r.find("heartbeatRuns", agentId ? { agentId } : {}, {
    orderBy: [
      { column: "startedAt", desc: true },
      { column: "id", desc: true },
    ],
    limit,
  });
  const slugOf = new Map(rows.length ? (await r.find("agents", { id: [...new Set(rows.map((row) => row.agentId))] })).map((a) => [a.id, a.slug]) : []);
  return { runs: rows.filter((row) => slugOf.has(row.agentId)).map((row) => viewOf(slugOf.get(row.agentId)!, row)) };
};

export const runHeartbeat = async (db: Db, now = new Date(), deps?: HeartbeatDeps): Promise<Record<string, number>> => {
  // PLA-I29: switches stop live runs first, then queued runs take free slots.
  const stopped = await enforceLive(db, now);
  // PLA-16: a run that failed holding its ticket is retried once (queued here, started by the drain below),
  // or its ticket is handed to Jorge after a second failure in a row.
  const failed = await sweepFailedRuns(db);
  // PLA-18: a run a limit stopped lets go of its ticket, and work a limit held is queued again once the
  // runner's checks say it would start.
  const freed = await sweepStoppedRuns(db);
  const held = await requeueHeld(db, now, deps?.runner);
  const drained = await drainQueue(db, now, deps?.runner);
  const cleaned = await cleanupWorktrees(db, deps?.runner);
  const roster = (await readerOf(db).find("agents")).map((a) => ({ slug: a.slug, minutes: a.heartbeatMinutes }));
  const counts = {
    woken: 0,
    skipped: 0,
    failed: 0,
    held: 0,
    queued: 0,
    stopped,
    started_from_queue: drained.started,
    dropped_from_queue: drained.dropped,
    worktrees_removed: cleaned,
    retried_after_fail: failed.retried,
    handed_to_jorge: failed.held,
    freed_after_stop: freed.freed,
    requeued_held: held.requeued,
  };
  for (const row of roster) {
    if (row.minutes == null) continue;
    const result = await wakeAgent(db, { agent: row.slug, now }, deps);
    if (!result.run || result.reason === "coalesced") {
      counts.held += 1;
      continue;
    }
    if (result.reason === "queued") counts.queued += 1;
    else if (result.run.status === "ok" || result.run.status === "running") counts.woken += 1;
    else if (result.run.status === "fail") counts.failed += 1;
    else counts.skipped += 1;
  }
  return counts;
};

export const heartbeatJob: Job = {
  name: "heartbeat",
  intervalMs: 60_000,
  runOnce: (db, now) => runHeartbeat(db, now),
};
