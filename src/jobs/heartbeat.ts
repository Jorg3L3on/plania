import { and, desc, eq, isNull, lte, or, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { ADAPTERS, agents, heartbeatRuns, projects, tasks, type AdapterConfig, type AdapterName } from "../db/schema.js";
import { spawn, type SpawnDeps, type SpawnTask } from "../adapters/index.js";
import { ToolError } from "../mcp/errors.js";
import { iso } from "../mcp/tx.js";
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

export type WakeResult = {
  woke: boolean;
  reason: "ok" | "cadence" | "dry-run";
  run: HeartbeatRunView | null;
};

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

// Owned Ready work wins. Otherwise an unowned Ready ticket in a capable project or work type.
export const pickReady = (agent: { id: string; role: string; capabilities: string[] }, rows: ReadyWork[]): ReadyWork | null => {
  const types = workTypesFor(agent.role, agent.capabilities);
  const caps = new Set(agent.capabilities);
  const matches = rows.filter((row) => {
    if (row.title.includes("[PRUEBA]")) return false;
    if (row.ownerAgent === agent.id) return true;
    if (row.ownerAgent) return false;
    if (caps.has(row.project)) return true;
    return !!row.workType && types.has(row.workType);
  });
  matches.sort((a, b) => {
    const owned = Number(b.ownerAgent === agent.id) - Number(a.ownerAgent === agent.id);
    if (owned) return owned;
    const priority = priorityRank(a.priority) - priorityRank(b.priority);
    if (priority) return priority;
    return a.project.localeCompare(b.project) || a.key.localeCompare(b.key);
  });
  return matches[0] ?? null;
};

const loadReady = async (db: Db): Promise<ReadyWork[]> => {
  const rows = await db
    .select({
      project: projects.slug,
      key: tasks.key,
      title: tasks.title,
      priority: tasks.priority,
      workType: tasks.workType,
      ownerAgent: tasks.ownerAgent,
    })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(and(eq(tasks.kind, "ticket"), eq(tasks.status, "Ready")));
  return rows;
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

const explicitTask = async (db: Db, agentId: string, taskKey: string): Promise<ReadyWork> => {
  const key = taskKey.trim();
  const found = await db
    .select({
      task: tasks,
      project: projects.slug,
    })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(eq(tasks.key, key));
  if (found.length === 0) throw new ToolError("TASK_NOT_FOUND", { key });
  if (found.length > 1) throw new ToolError("INVALID_FILTER", { field: "task_key", hint: "key is in more than one project" });
  const row = found[0]!;
  if (row.task.kind !== "ticket" || row.task.status !== "Ready") throw new ToolError("INVALID_FILTER", { field: "task_key", hint: "not Ready" });
  if (row.task.ownerAgent && row.task.ownerAgent !== agentId) throw new ToolError("INVALID_FILTER", { field: "task_key", hint: "owned by another agent" });
  return {
    project: row.project,
    key: row.task.key,
    title: row.task.title,
    priority: row.task.priority,
    workType: row.task.workType,
    ownerAgent: row.task.ownerAgent,
  };
};

export const wakeAgent = async (db: Db, input: { agent: string; taskKey?: string; dryRun?: boolean; now?: Date }, deps?: SpawnDeps): Promise<WakeResult> => {
  const slug = checkSlug(input.agent);
  const now = input.now ?? new Date();
  const [row] = await db.select().from(agents).where(eq(agents.slug, slug)).limit(1);
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

  const claimed = await db
    .update(agents)
    .set({ lastHeartbeatAt: now, updatedAt: sql`now()` })
    .where(
      and(
        eq(agents.id, row.id),
        dueBefore == null ? sql`true` : or(isNull(agents.lastHeartbeatAt), lte(agents.lastHeartbeatAt, dueBefore)),
      ),
    )
    .returning({ id: agents.id });
  if (claimed.length === 0) return { woke: false, reason: "cadence", run: null };

  const task = chosen ?? pickReady(row, await loadReady(db));
  const outcome = await spawn({ agent: spawnAgent, task: taskOf(task) }, deps);
  const summary = task ? outcome.summary : outcome.status === "ok" ? "no ready work" : outcome.summary;
  const [inserted] = await db
    .insert(heartbeatRuns)
    .values({
      agentId: row.id,
      startedAt: now,
      endedAt: new Date(),
      status: outcome.status,
      adapter: outcome.adapter,
      summary: summary.slice(0, 500),
      taskKey: task?.key ?? null,
    })
    .returning();
  return { woke: true, reason: "ok", run: viewOf(row.slug, inserted!) };
};

export const listHeartbeatRuns = async (db: Db, filter: { agent?: string; limit?: number } = {}): Promise<{ runs: HeartbeatRunView[] }> => {
  const limit = filter.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new ToolError("INVALID_FILTER", { field: "limit", max: 100 });
  const slug = filter.agent ? checkSlug(filter.agent) : undefined;
  let agentId: string | undefined;
  if (slug) {
    const [row] = await db.select({ id: agents.id }).from(agents).where(eq(agents.slug, slug)).limit(1);
    if (!row) throw new ToolError("AGENT_NOT_FOUND", { slug });
    agentId = row.id;
  }
  const rows = await db
    .select({
      slug: agents.slug,
      startedAt: heartbeatRuns.startedAt,
      endedAt: heartbeatRuns.endedAt,
      status: heartbeatRuns.status,
      adapter: heartbeatRuns.adapter,
      summary: heartbeatRuns.summary,
      taskKey: heartbeatRuns.taskKey,
    })
    .from(heartbeatRuns)
    .innerJoin(agents, eq(agents.id, heartbeatRuns.agentId))
    .where(agentId ? eq(heartbeatRuns.agentId, agentId) : undefined)
    .orderBy(desc(heartbeatRuns.startedAt), desc(heartbeatRuns.id))
    .limit(limit);
  return { runs: rows.map((row) => viewOf(row.slug, row)) };
};

export const runHeartbeat = async (db: Db, now = new Date(), deps?: SpawnDeps): Promise<Record<string, number>> => {
  const roster = await db.select({ slug: agents.slug, minutes: agents.heartbeatMinutes }).from(agents);
  const counts = { woken: 0, skipped: 0, failed: 0, held: 0 };
  for (const row of roster) {
    if (row.minutes == null) continue;
    const result = await wakeAgent(db, { agent: row.slug, now }, deps);
    if (!result.run) {
      counts.held += 1;
      continue;
    }
    if (result.run.status === "ok") counts.woken += 1;
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
