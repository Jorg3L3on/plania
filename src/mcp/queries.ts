import { and, asc, desc, eq, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { checks, events, projects, tasks, type Actor, type Project, type Task } from "../db/schema.js";
import { blockerList, hasUnsatisfiedBlocker } from "./blockers.js";
import { taskChecks } from "./checks.js";
import { listDecisions, type DecisionFilters } from "./decisions.js";
import { projectDocs, taskDocs } from "./docs.js";
import { ToolError } from "./errors.js";
import { taskResults } from "./evidence.js";
import { taskQuestions } from "./questions.js";
import { iso, type Q } from "./tx.js";

export { ToolError };

// Claimable: Backlog or Ready, or In progress whose lease is gone (stale_claim).
const claimableNow = sql`(${tasks.status} in ('Backlog', 'Ready')
  or (${tasks.status} = 'In progress' and (${tasks.leaseUntil} is null or ${tasks.leaseUntil} < now())))`;

// P0 first, P3 last, null after everything. Text order of P0..P3 is already correct.
const byPriority = sql`${tasks.priority} asc nulls last`;

export async function findProject(db: Q, slug: string): Promise<Project> {
  const [row] = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
  if (!row) throw new ToolError("PROJECT_NOT_FOUND");
  return row;
}

export async function findTask(db: Q, projectId: string, key: string): Promise<Task | undefined> {
  const [row] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.projectId, projectId), eq(tasks.key, key)))
    .limit(1);
  return row;
}

export async function requireTask(db: Q, projectId: string, key: string): Promise<Task> {
  const t = await findTask(db, projectId, key);
  if (!t) throw new ToolError("TASK_NOT_FOUND");
  return t;
}

// The v1 hand-written card, read-only until the cleanup migration drops it. null when empty.
export function legacyCard(p: Project) {
  const card = {
    in_progress: p.resumeInProgress,
    next_action: p.resumeNextAction,
    branch_or_prod: p.resumeBranchOrProd,
    must_keep_decision: p.resumeMustKeepDecision,
  };
  return Object.values(card).some(Boolean) ? card : null;
}

// Last LOG_LIMIT events of a task, oldest first. The full history is in list_events.
const LOG_LIMIT = 50;

export function eventShape(e: typeof events.$inferSelect) {
  return { id: e.id, at: iso(e.createdAt), type: e.type, task_key: e.taskKey, actor: e.actor, payload: e.payload };
}

const EVENTS_DEFAULT = 200;
const EVENTS_MAX = 1000;

// The change feed. Event ids grow in commit order within a project (writes are serialized per
// project), so "since the last id I saw" never skips one. next_cursor is the id to pass next time.
export async function listEvents(
  db: Q,
  projectId: string,
  f: { since?: number; key?: string; types?: string[]; limit?: number },
) {
  const where: SQL[] = [eq(events.projectId, projectId)];
  if (f.since !== undefined) where.push(sql`${events.id} > ${f.since}`);
  if (f.key !== undefined) where.push(eq(events.taskKey, f.key));
  if (f.types?.length) {
    // "claim" matches claim.acquired, claim.released...; "note" matches note.
    where.push(sql`(${sql.join(f.types.map((t) => sql`${events.type} = ${t} or ${events.type} like ${`${t}.%`}`), sql` or `)})`);
  }
  const limit = Math.min(Math.max(f.limit ?? EVENTS_DEFAULT, 1), EVENTS_MAX);
  const rows = await db.select().from(events).where(and(...where)).orderBy(asc(events.id)).limit(limit + 1);
  const page = rows.slice(0, limit);
  return {
    events: page.map(eventShape),
    next_cursor: page.at(-1)?.id ?? f.since ?? 0,
    more: rows.length > limit,
  };
}

async function taskLog(db: Q, taskId: string) {
  const rows = await db
    .select()
    .from(events)
    .where(eq(events.taskId, taskId))
    .orderBy(desc(events.id))
    .limit(LOG_LIMIT);
  const [total] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(events)
    .where(eq(events.taskId, taskId));
  const log = rows.reverse().map((e) => ({ id: e.id, at: iso(e.createdAt), type: e.type, actor: e.actor, payload: e.payload }));
  return { log, log_total: total?.n ?? 0 };
}

// The lease owner, if the lease has not expired. Expired leases count as free everywhere.
export function liveOwner(t: Pick<Task, "owner" | "leaseUntil">, now = new Date()): Actor | null {
  return t.owner && t.leaseUntil && t.leaseUntil > now ? t.owner : null;
}

function claimShape(t: Task) {
  if (!t.owner) return null;
  return {
    owner: t.owner,
    claimed_at: iso(t.claimedAt),
    lease_until: iso(t.leaseUntil),
    last_seen_at: iso(t.lastSeenAt),
    live: liveOwner(t) !== null,
  };
}

// get_task with include_children: the task plus each child's full shape, in key order.
export async function taskWithChildren(db: Q, t: Task) {
  const children = await db.select().from(tasks).where(eq(tasks.parentId, t.id)).orderBy(asc(tasks.key));
  return { ...(await taskShape(db, t)), children: await Promise.all(children.map((c) => taskShape(db, c))) };
}

// The get_task shape. Every create_*/set_* tool returns this too.
export async function taskShape(db: Q, t: Task) {
  const [parent] = t.parentId
    ? await db.select({ key: tasks.key }).from(tasks).where(eq(tasks.id, t.parentId)).limit(1)
    : [];
  const children = await db
    .select({ key: tasks.key })
    .from(tasks)
    .where(eq(tasks.parentId, t.id))
    .orderBy(asc(tasks.key));
  return {
    key: t.key,
    kind: t.kind,
    title: t.title,
    summary: t.summary,
    scope: t.scope,
    // Only until the backfill moves a v1 body into scope, checks and the log.
    ...(t.body && !t.scope ? { legacy_body: t.body } : {}),
    status: t.status,
    priority: t.priority,
    work_type: t.workType,
    phase: t.phase,
    checks: await taskChecks(db, t.id),
    results: await taskResults(db, t.id),
    docs: await taskDocs(db, t.id),
    questions: await taskQuestions(db, t),
    origin: t.origin,
    parent_key: parent?.key ?? null,
    child_keys: children.map((c) => c.key),
    blocked_by: await blockerList(db, t),
    blocked_note: t.blockedNote,
    base_branch: t.baseBranch,
    ...(t.kind === "initiative" ? { in_progress_note: t.inProgressNote, next_action: t.nextAction } : {}),
    branch: t.branch,
    pr_url: t.prUrl,
    claim: claimShape(t),
    workspace: t.workspace,
    version: t.version,
    created_at: iso(t.createdAt),
    updated_at: iso(t.updatedAt),
    resolved_at: iso(t.resolvedAt),
    ...(await taskLog(db, t.id)),
  };
}

export async function projectCounts(db: Q, projectId: string) {
  const discovered = sql`${tasks.origin} = 'discovered'`;
  const settled = sql`${tasks.status} in ('In review', 'Done')`;
  const [row] = await db
    .select({
      chartered: sql<number>`count(*) filter (where not coalesce(${discovered}, false))::int`,
      charteredSettled: sql<number>`count(*) filter (where not coalesce(${discovered}, false) and ${settled})::int`,
      found: sql<number>`count(*) filter (where ${discovered})::int`,
      foundOpen: sql<number>`count(*) filter (where ${discovered} and not ${settled})::int`,
    })
    .from(tasks)
    .where(and(eq(tasks.projectId, projectId), eq(tasks.kind, "ticket"), sql`${tasks.status} <> 'Won''t do'`));
  return row ?? { chartered: 0, charteredSettled: 0, found: 0, foundOpen: 0 };
}

export type TaskFilters = {
  parentKey?: string;
  status?: string;
  kind?: string;
  workType?: string;
  owner?: string; // a live lease held by this session_id or agent; "none" for unclaimed
  unblocked?: boolean;
  updatedSince?: string;
  search?: string;
  limit?: number;
};

const LIST_DEFAULT = 200;
const LIST_MAX = 1000;
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export async function listTasks(db: Q, projectId: string, filters: TaskFilters) {
  const parent = alias(tasks, "parent");
  const live = sql`${tasks.leaseUntil} > now()`;
  const where: SQL[] = [eq(tasks.projectId, projectId)];
  if (filters.parentKey !== undefined) where.push(eq(parent.key, filters.parentKey));
  if (filters.status !== undefined) where.push(eq(tasks.status, filters.status));
  if (filters.kind !== undefined) where.push(eq(tasks.kind, filters.kind));
  if (filters.workType !== undefined) where.push(eq(tasks.workType, filters.workType));
  if (filters.owner === "none") where.push(sql`not coalesce(${live}, false)`);
  else if (filters.owner !== undefined) {
    where.push(sql`${live} and (${tasks.owner}->>'session_id' = ${filters.owner} or ${tasks.owner}->>'agent' = ${filters.owner})`);
  }
  if (filters.unblocked !== undefined) {
    where.push(filters.unblocked ? sql`not ${hasUnsatisfiedBlocker(tasks.id)}` : hasUnsatisfiedBlocker(tasks.id));
  }
  if (filters.updatedSince !== undefined) {
    const since = new Date(filters.updatedSince);
    if (Number.isNaN(since.getTime())) throw new ToolError("INVALID_FILTER", { field: "updated_since" });
    where.push(sql`${tasks.updatedAt} > ${since.toISOString()}::timestamptz`);
  }
  if (filters.search?.trim()) {
    const term = `%${likeEscape(filters.search.trim())}%`;
    where.push(sql`(
      ${tasks.key} ilike ${term} or ${tasks.title} ilike ${term} or ${tasks.summary} ilike ${term} or ${tasks.scope} ilike ${term}
      or exists (select 1 from ${checks} c where c.task_id = ${tasks.id} and c.text ilike ${term})
    )`);
  }
  return db
    .select({
      key: tasks.key,
      title: tasks.title,
      summary: tasks.summary,
      status: tasks.status,
      priority: tasks.priority,
      kind: tasks.kind,
      work_type: tasks.workType,
      parent_key: parent.key,
      origin: tasks.origin,
      version: tasks.version,
      claimed_by: sql<Actor | null>`case when ${live} then ${tasks.owner} end`,
      updated_at: sql<string>`to_char(${tasks.updatedAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
    })
    .from(tasks)
    .leftJoin(parent, eq(parent.id, tasks.parentId))
    .where(and(...where))
    .orderBy(byPriority, desc(tasks.updatedAt))
    .limit(Math.min(Math.max(filters.limit ?? LIST_DEFAULT, 1), LIST_MAX));
}

export async function getMemory(db: Q, p: Project, filters: DecisionFilters = {}) {
  return {
    rules: p.rulesText,
    design_docs: await projectDocs(db, p.id),
    decisions: await listDecisions(db, p.id, filters),
  };
}

// Read-only. Claimable: ticket in Backlog|Ready whose blockers are all In review|Done.
export async function nextTask(db: Q, projectId: string, initiativeKey?: string) {
  const where: SQL[] = [
    eq(tasks.projectId, projectId),
    eq(tasks.kind, "ticket"),
    claimableNow,
    sql`not ${hasUnsatisfiedBlocker(tasks.id)}`,
  ];
  if (initiativeKey !== undefined) {
    const initiative = await findTask(db, projectId, initiativeKey);
    if (!initiative || initiative.kind !== "initiative") throw new ToolError("INITIATIVE_NOT_FOUND");
    where.push(eq(tasks.parentId, initiative.id));
  }
  const [t] = await db
    .select()
    .from(tasks)
    .where(and(...where))
    .orderBy(byPriority, asc(tasks.key))
    .limit(1);
  if (!t) return { task: null };
  const parent = t.parentId
    ? (await db.select({ key: tasks.key }).from(tasks).where(eq(tasks.id, t.parentId)).limit(1))[0]
    : undefined;
  return {
    task: {
      key: t.key,
      title: t.title,
      summary: t.summary,
      status: t.status,
      priority: t.priority,
      parent_key: parent?.key ?? null,
      blocked_by: await blockerList(db, t),
      stale_claim: t.status === "In progress",
      workspace: t.workspace,
    },
  };
}
