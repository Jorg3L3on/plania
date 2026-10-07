import { and, asc, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { checks, events, projects, taskAliases, tasks, type Actor, type Project, type Task } from "../db/schema.js";
import { blockerList, hasUnsatisfiedBlocker } from "./blockers.js";
import { taskChecks } from "./checks.js";
import { listDecisions, type DecisionFilters } from "./decisions.js";
import { projectDocs, taskDocs } from "./docs.js";
import { ToolError } from "./errors.js";
import { taskResults } from "./evidence.js";
import { taskQuestions } from "./questions.js";
import { iso, type Ctx, type Q } from "./tx.js";

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

// By canonical key, or by any former key (task_aliases).
export async function findTask(db: Q, projectId: string, key: string): Promise<Task | undefined> {
  const [row] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.projectId, projectId), eq(tasks.key, key)))
    .limit(1);
  if (row) return row;
  const [viaAlias] = await db
    .select({ t: tasks })
    .from(taskAliases)
    .innerJoin(tasks, eq(tasks.id, taskAliases.taskId))
    .where(and(eq(taskAliases.projectId, projectId), eq(taskAliases.alias, key)))
    .limit(1);
  return viaAlias?.t;
}

export async function aliasesOf(db: Q, taskId: string): Promise<string[]> {
  const rows = await db.select({ alias: taskAliases.alias }).from(taskAliases).where(eq(taskAliases.taskId, taskId)).orderBy(asc(taskAliases.createdAt));
  return rows.map((r) => r.alias);
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

export function eventShape(e: typeof events.$inferSelect, task?: { kind: string | null; parentKey: string | null }) {
  return {
    id: e.id,
    at: iso(e.createdAt),
    type: e.type,
    task_key: e.taskKey,
    ...(task ? { kind: task.kind, parent_key: task.parentKey } : {}),
    actor: e.actor,
    payload: e.payload,
  };
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
  if (f.key !== undefined) {
    // An alias finds the task's whole history, under every key it has had.
    const t = await findTask(db, projectId, f.key);
    where.push(t ? eq(events.taskId, t.id) : eq(events.taskKey, f.key));
  }
  if (f.types?.length) {
    // "claim" matches claim.acquired, claim.released...; "note" matches note.
    where.push(sql`(${sql.join(f.types.map((t) => sql`${events.type} = ${t} or ${events.type} like ${`${t}.%`}`), sql` or `)})`);
  }
  const limit = Math.min(Math.max(f.limit ?? EVENTS_DEFAULT, 1), EVENTS_MAX);
  const parent = alias(tasks, "parent");
  const rows = await db
    .select({ e: events, kind: tasks.kind, parentKey: parent.key })
    .from(events)
    .leftJoin(tasks, eq(tasks.id, events.taskId))
    .leftJoin(parent, eq(parent.id, tasks.parentId))
    .where(and(...where))
    .orderBy(asc(events.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  return {
    events: page.map((r) => eventShape(r.e, { kind: r.kind, parentKey: r.parentKey })),
    next_cursor: page.at(-1)?.e.id ?? f.since ?? 0,
    more: rows.length > limit,
  };
}

async function taskLog(db: Q, taskId: string, limit = LOG_LIMIT) {
  const rows = limit
    ? await db.select().from(events).where(eq(events.taskId, taskId)).orderBy(desc(events.id)).limit(limit)
    : [];
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
export async function taskWithChildren(db: Q, t: Task, opts: ShapeOptions = {}) {
  const children = await db.select().from(tasks).where(eq(tasks.parentId, t.id)).orderBy(asc(tasks.key));
  return { ...(await taskFull(db, t, opts)), children: await Promise.all(children.map((c) => taskFull(db, c, opts))) };
}

export type ShapeOptions = { log?: boolean };

async function parentKeyOf(db: Q, t: Task): Promise<string | null> {
  if (!t.parentId) return null;
  const [parent] = await db.select({ key: tasks.key }).from(tasks).where(eq(tasks.id, t.parentId)).limit(1);
  return parent?.key ?? null;
}

async function childKeysOf(db: Q, t: Task): Promise<string[]> {
  const children = await db.select({ key: tasks.key }).from(tasks).where(eq(tasks.parentId, t.id)).orderBy(asc(tasks.key));
  return children.map((c) => c.key);
}

// get_task view "full" (the default): everything but the log, which list_events pages by cursor
// (include_log: true adds the last LOG_LIMIT events). The screen and the export read this too.
export async function taskFull(db: Q, t: Task, opts: ShapeOptions = {}) {
  const log = opts.log ? await taskLog(db, t.id) : { log_total: (await taskLog(db, t.id, 0)).log_total };
  return {
    key: t.key,
    aliases: await aliasesOf(db, t.id),
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
    results: await taskResults(db, t),
    docs: await taskDocs(db, t.id),
    questions: await taskQuestions(db, t),
    origin: t.origin,
    parent_key: await parentKeyOf(db, t),
    child_keys: await childKeysOf(db, t),
    blocked_by: await blockerList(db, t),
    blocked_note: t.blockedNote,
    base_branch: t.baseBranch,
    ...(t.kind === "initiative"
      ? { in_progress_note: t.inProgressNote, next_action: t.nextAction, state_note: await stateNoteShape(db, t) }
      : {}),
    branch: t.branch,
    pr_url: t.prUrl,
    areas: t.areas,
    handoff: t.handoff && new Date(t.handoff.until) > new Date() ? t.handoff : null,
    workspace_history: await workspaceHistory(db, t.id),
    ...(t.workType === "bug" ? { severity: t.severity, found_in: t.foundIn, introduced_by: t.introducedBy, regression: t.regression } : {}),
    ...(t.workType === "debt" ? { cost_note: t.costNote } : {}),
    claim: claimShape(t),
    workspace: t.workspace,
    version: t.version,
    created_at: iso(t.createdAt),
    updated_at: iso(t.updatedAt),
    resolved_at: iso(t.resolvedAt),
    ...log,
  };
}

// R-16: where an initiative stands, apart from its spec; stale once a ticket of it (or it) moved later.
async function stateNoteShape(db: Q, t: Task) {
  if (!t.stateNote) return { text: "", at: null, stale: false };
  const [last] = await db
    .select({ at: sql<Date | null>`max(${tasks.statusChangedAt})` })
    .from(tasks)
    .where(sql`${tasks.parentId} = ${t.id} or ${tasks.id} = ${t.id}`);
  const stale = !!t.stateNoteAt && !!last?.at && new Date(last.at) > t.stateNoteAt;
  return { text: t.stateNote, at: iso(t.stateNoteAt), stale };
}

// R-06: every workspace the ticket has used, oldest first (claims and handoffs).
async function workspaceHistory(db: Q, taskId: string) {
  const rows = await db
    .select({ at: events.createdAt, type: events.type, actor: events.actor, payload: events.payload })
    .from(events)
    .where(and(eq(events.taskId, taskId), sql`${events.type} in ('claim.acquired', 'claim.workspace', 'claim.handoff')`))
    .orderBy(asc(events.id));
  const out: { at: string; by: Actor; workspace: unknown; handoff?: string }[] = [];
  for (const r of rows) {
    const ws = (r.payload as { workspace?: unknown }).workspace;
    if (r.type === "claim.handoff") out.push({ at: iso(r.at), by: r.actor, workspace: null, handoff: String((r.payload as { note?: string }).note ?? "") });
    else if (ws) out.push({ at: iso(r.at), by: r.actor, workspace: ws });
  }
  return out;
}

// get_task view "summary": what an agent needs to decide, under 2 KB. Counts stand in for the lists.
export async function taskSummary(db: Q, t: Task) {
  const [counts] = await db.execute<{ results: number; docs: number; questions: number; log_total: number }>(sql`
    select
      (select count(*)::int from results where task_id = ${t.id}) as results,
      (select count(*)::int from docs where task_id = ${t.id}) as docs,
      (select count(*)::int from questions where task_id = ${t.id} and answered_at is null) as questions,
      (select count(*)::int from ${events} where task_id = ${t.id}) as log_total`).then((r) => r.rows);
  return {
    key: t.key,
    aliases: await aliasesOf(db, t.id),
    kind: t.kind,
    title: t.title,
    summary: t.summary,
    status: t.status,
    priority: t.priority,
    work_type: t.workType,
    phase: t.phase,
    parent_key: await parentKeyOf(db, t),
    child_keys: await childKeysOf(db, t),
    checks: (await taskChecks(db, t.id)).map((c) => ({ n: c.n, text: c.text, done: c.done, waived: !!c.waived })),
    blocked_by: await blockerList(db, t),
    blocked_note: t.blockedNote,
    branch: t.branch,
    pr_url: t.prUrl,
    claim: claimShape(t),
    workspace: t.workspace,
    version: t.version,
    updated_at: iso(t.updatedAt),
    counts: { results: counts?.results ?? 0, docs: counts?.docs ?? 0, open_questions: counts?.questions ?? 0, log_total: counts?.log_total ?? 0 },
    scope_chars: t.scope.length,
  };
}

// The full shape without the log (the screen's lists and the export). Writes use writeReply instead.
export const taskShape = (db: Q, t: Task) => taskFull(db, t, { log: false });

// Keeps only the requested top-level keys. Unknown names are INVALID_FILTER so a typo is not a silent blank.
export function pickFields<T extends Record<string, unknown>>(shape: T, fields: string[] | undefined): Partial<T> {
  if (!fields?.length) return shape;
  const unknown = fields.filter((f) => !(f in shape));
  if (unknown.length) throw new ToolError("INVALID_FILTER", { field: "fields", unknown });
  return Object.fromEntries(fields.map((f) => [f, shape[f]])) as Partial<T>;
}

// What every write returns: the key, where the task stands, the version to pass next time and what
// changed. extra carries the id a tool just made (a result, a decision, a question, the claim).
// verbose: true (ctx) adds the full task without its log.
export async function writeReply<E extends Record<string, unknown>>(
  db: Q,
  t: Task,
  ctx: Pick<Ctx, "verbose">,
  changed: string[],
  extra: E = {} as E,
  warnings?: string[],
) {
  return {
    key: t.key,
    status: t.status,
    version: t.version,
    changed,
    ...extra,
    ...(warnings?.length ? { warnings } : {}),
    task: ctx.verbose ? await taskFull(db, t) : undefined,
  };
}

export { claimShape };

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
  severity?: string[];
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
  if (filters.severity?.length) where.push(inArray(tasks.severity, filters.severity));
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
      severity: tasks.severity,
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
  const [p] = await db.select({ settings: projects.settings }).from(projects).where(eq(projects.id, projectId)).limit(1);
  const where: SQL[] = [
    eq(tasks.projectId, projectId),
    eq(tasks.kind, "ticket"),
    claimableNow,
    sql`not ${hasUnsatisfiedBlocker(tasks.id)}`,
  ];
  // settings.claim_from: "ready" means only Ready tickets (and stale claims) are offered.
  if (p?.settings.claim_from === "ready") where.push(sql`${tasks.status} <> 'Backlog'`);
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
      kind: t.kind,
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
