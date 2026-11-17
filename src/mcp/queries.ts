import type { Actor, Project, Task } from "../db/schema.js";
import { readerOf } from "../store/port.js";
import type { Reader, Row, UnitOfWork, Where } from "../store/types.js";
import { agentRefOf } from "./team.js";
import { blockedTaskIds, blockerList } from "./blockers.js";
import { taskChecks } from "./checks.js";
import { listDecisions, type DecisionFilters } from "./decisions.js";
import { projectDocs, taskDocs } from "./docs.js";
import { ToolError } from "./errors.js";
import { taskFootprint } from "./footprint-read.js";
import { taskResults } from "./evidence.js";
import { taskQuestions } from "./questions.js";
import { iso, type Ctx, type Q } from "./tx.js";
import { summarize } from "./summary.js";
import { whyChainOf } from "./goals.js";
import { initiativeState } from "./initiative-state.js";

export { ToolError };

// The clock a read compares leases and blockers against. Inside a write it is the write's own reading
// (what SQL now() was there); anywhere else, the time the read runs.
const clockOf = (r: Reader): Date => (r as Partial<UnitOfWork>).now ?? new Date();

// Claimable: Backlog or Ready, or In progress whose lease is gone (stale_claim).
const claimableNow = (t: Task, now: Date) =>
  t.status === "Backlog" || t.status === "Ready" || (t.status === "In progress" && (t.leaseUntil === null || t.leaseUntil < now));

// Sorting by priority (P0 first, P3 last, null after everything) is left to the store: ascending order
// puts nulls last, and the text order of P0..P3 is already correct.

export async function findProject(db: Q, slug: string): Promise<Project> {
  // A missing slug names no project (the port would read a missing value as "any").
  const row = slug == null ? undefined : await readerOf(db).get("projects", { slug });
  if (!row) throw new ToolError("PROJECT_NOT_FOUND");
  return row;
}

// By canonical key, or by any former key (task_aliases).
export async function findTask(db: Q, projectId: string, key: string): Promise<Task | undefined> {
  if (key == null) return undefined;
  const r = readerOf(db);
  const row = await r.get("tasks", { projectId, key });
  if (row) return row;
  const viaAlias = await r.get("taskAliases", { projectId, alias: key });
  return viaAlias ? r.get("tasks", { id: viaAlias.taskId }) : undefined;
}

export async function aliasesOf(db: Q, taskId: string): Promise<string[]> {
  const rows = await readerOf(db).find("taskAliases", { taskId }, { orderBy: [{ column: "createdAt" }] });
  return rows.map((r) => r.alias);
}

export async function requireTask(db: Q, projectId: string, key: string): Promise<Task> {
  const t = await findTask(db, projectId, key);
  if (!t) throw new ToolError("TASK_NOT_FOUND");
  return t;
}

// Last LOG_LIMIT events of a task, oldest first. The full history is in list_events.
const LOG_LIMIT = 50;

export function eventShape(e: Row<"events">, task?: { kind: string | null; parentKey: string | null }, project?: string) {
  const shape = {
    id: e.id,
    at: iso(e.createdAt),
    type: e.type,
    ...(project !== undefined ? { project } : {}),
    task_key: e.taskKey,
    ...(task ? { kind: task.kind, parent_key: task.parentKey } : {}),
    actor: e.actor,
    payload: e.payload,
  };
  return { ...shape, summary: summarize(shape) };
}

const EVENTS_DEFAULT = 200;
const EVENTS_MAX = 1000;
const EVENTS_PAGE = 256;

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// SQL LIKE, case-sensitive: % is any run of characters, _ any one, and a backslash takes the next literally.
function likeRegex(pattern: string): RegExp {
  let out = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === "\\" && i + 1 < pattern.length) out += escapeRegex(pattern[++i]!);
    else if (c === "%") out += "[\\s\\S]*";
    else if (c === "_") out += "[\\s\\S]";
    else out += escapeRegex(c);
  }
  return new RegExp(`^${out}$`);
}

// The first `want` events, oldest first, that match `where` and `keep` and have an id above `since`
// (when given). The port has no range filter, so this reads pages instead of the whole history: a poller
// that is up to date finds everything after its cursor in one page from the newest end; any other read
// goes from the oldest end in growing pages until enough rows match or the history runs out.
async function readEvents(r: Reader, where: Where<"events">, since: number | undefined, keep: (e: Row<"events">) => boolean, want: number) {
  const after = (e: Row<"events">) => since === undefined || e.id > since;
  if (since !== undefined) {
    const newest = await r.find("events", where, { orderBy: [{ column: "id", desc: true }], limit: EVENTS_PAGE });
    if (newest.length < EVENTS_PAGE || newest.at(-1)!.id <= since) return newest.filter((e) => after(e) && keep(e)).reverse().slice(0, want);
  }
  for (let n = Math.max(want, EVENTS_PAGE); ; n *= 4) {
    const rows = await r.find("events", where, { orderBy: [{ column: "id" }], limit: n });
    const hits = rows.filter((e) => after(e) && keep(e));
    if (hits.length >= want || rows.length < n) return hits.slice(0, want);
  }
}

// The change feed. Event ids grow in commit order (writeTx holds one global lock), so "since the
// last id I saw" never skips one, in one project or across all. next_cursor is the id to pass next time.
// projectId null (2.7): every project; each event then carries its project slug. key needs a project.
export async function listEvents(
  db: Q,
  projectId: string | null,
  f: { since?: number; key?: string; types?: string[]; limit?: number },
) {
  const r = readerOf(db);
  const where: Where<"events"> = projectId ? { projectId } : {};
  if (f.key !== undefined && !projectId) throw new ToolError("INVALID_FILTER", { field: "key", reason: "key needs a project slug, not all" });
  if (f.key !== undefined && projectId) {
    // An alias finds the task's whole history, under every key it has had.
    const t = await findTask(db, projectId, f.key);
    if (t) where.taskId = t.id;
    else where.taskKey = f.key;
  }
  // "claim" matches claim.acquired, claim.released...; "note" matches note.
  const typeMatch = f.types?.length ? f.types.map((t) => ({ exact: t, like: likeRegex(`${t}.%`) })) : undefined;
  const ofType = (e: Row<"events">) => !typeMatch || typeMatch.some((m) => e.type === m.exact || m.like.test(e.type));
  const limit = Math.min(Math.max(f.limit ?? EVENTS_DEFAULT, 1), EVENTS_MAX);
  const rows = await readEvents(r, where, f.since, ofType, limit + 1);
  const page = rows.slice(0, limit);
  // Each event with its project's slug, and its task's kind and parent key when the task is still there.
  const slugs = new Map(page.length ? (await r.find("projects", { id: [...new Set(page.map((e) => e.projectId))] })).map((p) => [p.id, p.slug]) : []);
  const taskIds = [...new Set(page.flatMap((e) => (e.taskId ? [e.taskId] : [])))];
  const taskRows = taskIds.length ? await r.find("tasks", { id: taskIds }) : [];
  const parentIds = [...new Set(taskRows.flatMap((t) => (t.parentId ? [t.parentId] : [])))];
  const parentKeys = new Map(parentIds.length ? (await r.find("tasks", { id: parentIds })).map((t) => [t.id, t.key]) : []);
  const taskOf = new Map(taskRows.map((t) => [t.id, t]));
  return {
    events: page.map((e) => {
      const t = e.taskId ? taskOf.get(e.taskId) : undefined;
      return eventShape(e, { kind: t?.kind ?? null, parentKey: t?.parentId ? (parentKeys.get(t.parentId) ?? null) : null }, slugs.get(e.projectId)!);
    }),
    next_cursor: page.at(-1)?.id ?? f.since ?? 0,
    more: rows.length > limit,
  };
}

async function taskLog(db: Q, taskId: string, limit = LOG_LIMIT) {
  const r = readerOf(db);
  const rows = limit ? await r.find("events", { taskId }, { orderBy: [{ column: "id", desc: true }], limit }) : [];
  const total = await r.count("events", { taskId });
  const log = rows.reverse().map((e) => ({ id: e.id, at: iso(e.createdAt), type: e.type, actor: e.actor, payload: e.payload }));
  return { log, log_total: total };
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
  const children = await readerOf(db).find("tasks", { parentId: t.id }, { orderBy: [{ column: "key" }] });
  return { ...(await taskFull(db, t, opts)), children: await Promise.all(children.map((c) => taskFull(db, c, opts))) };
}

export type ShapeOptions = { log?: boolean };

async function parentKeyOf(db: Q, t: Task): Promise<string | null> {
  if (!t.parentId) return null;
  const parent = await readerOf(db).get("tasks", { id: t.parentId });
  return parent?.key ?? null;
}

async function childKeysOf(db: Q, t: Task): Promise<string[]> {
  const children = await readerOf(db).find("tasks", { parentId: t.id }, { orderBy: [{ column: "key" }] });
  return children.map((c) => c.key);
}

// 2.8: the PR behind a task as one object, from pull_requests (the poller) or, when the poller has not
// seen it, the number parsed from pr_url. null when the task has neither.
export type PrShape = { number: number | null; url: string; state: string | null; ci_state: string | null; merged_at: string | null };
export const PR_NUMBER = /\/pull\/(\d+)/;
export function prFromUrl(url: string | null): PrShape | null {
  if (!url) return null;
  const m = PR_NUMBER.exec(url);
  return { number: m ? Number(m[1]) : null, url, state: null, ci_state: null, merged_at: null };
}
// 2.11 (PLA-02): the pull_requests row behind a task: the one the poller linked to it, else the one
// its pr_url names (phases sharing an initiative's PR are linked by url only).
export async function prRowOf(db: Q, t: Pick<Task, "id" | "prUrl">) {
  const r = readerOf(db);
  const newest = { orderBy: [{ column: "updatedAt" as const, desc: true }], limit: 1 };
  const [linked] = await r.find("pullRequests", { taskId: t.id }, newest);
  if (linked || !t.prUrl) return linked;
  const [byUrl] = await r.find("pullRequests", { url: t.prUrl }, newest);
  return byUrl;
}
export async function prOf(db: Q, t: Pick<Task, "id" | "prUrl">): Promise<PrShape | null> {
  const pr = await prRowOf(db, t);
  if (pr) return { number: pr.number, url: pr.url, state: pr.state, ci_state: pr.ciState, merged_at: iso(pr.mergedAt) };
  return prFromUrl(t.prUrl);
}
// The same object for list_tasks: only the PR the poller linked to the task (newest first), else the
// pr_url, else null. Keys in the order list_tasks has always sent them (jsonb's: shortest first).
function listPr(linked: Row<"pullRequests"> | undefined, prUrl: string | null): PrShape | null {
  if (linked) return { url: linked.url, state: linked.state, number: linked.number, ci_state: linked.ciState, merged_at: iso(linked.mergedAt) };
  if (prUrl === null) return null;
  const m = PR_NUMBER.exec(prUrl);
  return { url: prUrl, state: null, number: m ? Number(m[1]) : null, ci_state: null, merged_at: null };
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
    status: t.status,
    stage: t.stage,
    promoted_to: t.promotedTo,
    priority: t.priority,
    work_type: t.workType,
    phase: t.phase,
    checks: await taskChecks(db, t.id),
    // PLA-I46-11: the PO's check list from an accepted plan, for QA (only when the ticket has one).
    ...(t.poChecklist?.length ? { po_checklist: t.poChecklist } : {}),
    // PLA-I52-1: the delivery's muestra (views, steps, one sentence), once finish stored one.
    ...(t.muestra ? { muestra: t.muestra } : {}),
    results: await taskResults(db, t),
    docs: await taskDocs(db, t.id),
    questions: await taskQuestions(db, t),
    footprint: await taskFootprint(db, t.id),
    origin: t.origin,
    parent_key: await parentKeyOf(db, t),
    why_chain: await whyChainOf(db, t),
    child_keys: await childKeysOf(db, t),
    blocked_by: await blockerList(db, t),
    blocked_note: t.blockedNote,
    base_branch: t.baseBranch,
    ...(t.kind === "initiative"
      ? { in_progress_note: t.inProgressNote, next_action: t.nextAction, state: await initiativeState(db, t), state_note: await stateNoteShape(db, t) }
      : {}),
    branch: t.branch,
    pr_url: t.prUrl,
    pr: await prOf(db, t),
    due_on: t.dueOn,
    areas: t.areas,
    handoff: t.handoff && new Date(t.handoff.until) > new Date() ? t.handoff : null,
    workspace_history: await workspaceHistory(db, t.id),
    ...(t.workType === "bug" ? { severity: t.severity, found_in: t.foundIn, introduced_by: t.introducedBy, regression: t.regression } : {}),
    ...(t.workType === "debt" ? { cost_note: t.costNote } : {}),
    claim: claimShape(t),
    owner_agent: await agentRefOf(db, t.ownerAgent),
    workspace: t.workspace,
    version: t.version,
    created_at: iso(t.createdAt),
    updated_at: iso(t.updatedAt),
    status_changed_at: iso(t.statusChangedAt),
    resolved_at: iso(t.resolvedAt),
    done_at: iso(t.resolvedAt),
    ...log,
  };
}

// R-16: where an initiative stands, apart from its spec; stale once a ticket of it (or it) moved later.
// 2.11: commentary beside the derived state (initiative-state.ts); stale is a flag on the note, not an audit finding.
async function stateNoteShape(db: Q, t: Task) {
  if (!t.stateNote) return { text: "", at: null, stale: false };
  const r = readerOf(db);
  const self = await r.get("tasks", { id: t.id });
  const moved = [...(self ? [self] : []), ...(await r.find("tasks", { parentId: t.id }))].flatMap((x) => (x.statusChangedAt ? [x.statusChangedAt] : []));
  const last = moved.length ? new Date(Math.max(...moved.map((d) => d.getTime()))) : null;
  const stale = !!t.stateNoteAt && !!last && last > t.stateNoteAt;
  return { text: t.stateNote, at: iso(t.stateNoteAt), stale };
}

// R-06: every workspace the ticket has used, oldest first (claims and handoffs).
async function workspaceHistory(db: Q, taskId: string) {
  const rows = await readerOf(db).find("events", { taskId, type: ["claim.acquired", "claim.workspace", "claim.handoff"] }, { orderBy: [{ column: "id" }] });
  const out: { at: string; by: Actor; workspace: unknown; handoff?: string }[] = [];
  for (const r of rows) {
    const ws = (r.payload as { workspace?: unknown }).workspace;
    if (r.type === "claim.handoff") out.push({ at: iso(r.createdAt), by: r.actor, workspace: null, handoff: String((r.payload as { note?: string }).note ?? "") });
    else if (ws) out.push({ at: iso(r.createdAt), by: r.actor, workspace: ws });
  }
  return out;
}

// get_task view "summary": what an agent needs to decide, under 2 KB. Counts stand in for the lists.
export async function taskSummary(db: Q, t: Task) {
  const r = readerOf(db);
  const counts = {
    results: await r.count("results", { taskId: t.id }),
    docs: await r.count("docs", { taskId: t.id }),
    questions: await r.count("questions", { taskId: t.id, answeredAt: null }),
    log_total: await r.count("events", { taskId: t.id }),
  };
  return {
    key: t.key,
    aliases: await aliasesOf(db, t.id),
    kind: t.kind,
    title: t.title,
    summary: t.summary,
    status: t.status,
    stage: t.stage,
    promoted_to: t.promotedTo,
    priority: t.priority,
    work_type: t.workType,
    phase: t.phase,
    parent_key: await parentKeyOf(db, t),
    why_chain: await whyChainOf(db, t),
    child_keys: await childKeysOf(db, t),
    ...(t.kind === "initiative" ? { state: await initiativeState(db, t) } : {}),
    checks: (await taskChecks(db, t.id)).map((c) => ({ n: c.n, text: c.text, done: c.done, waived: !!c.waived })),
    blocked_by: await blockerList(db, t),
    blocked_note: t.blockedNote,
    branch: t.branch,
    pr_url: t.prUrl,
    pr: await prOf(db, t),
    due_on: t.dueOn,
    claim: claimShape(t),
    owner_agent: await agentRefOf(db, t.ownerAgent),
    workspace: t.workspace,
    version: t.version,
    updated_at: iso(t.updatedAt),
    status_changed_at: iso(t.statusChangedAt),
    done_at: iso(t.resolvedAt),
    counts: { results: counts.results, docs: counts.docs, open_questions: counts.questions, log_total: counts.log_total },
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

// Most warnings are a sentence. A structured one carries a code and what the caller needs to act on it:
// FOOTPRINT_LIVE {kind, locator, teardown} when a ticket closes with something still running.
export type WriteWarning = string | { code: string; [k: string]: unknown };

// What every write returns: the key, where the task stands, the version to pass next time and what
// changed. extra carries the id a tool just made (a result, a decision, a question, the claim).
// verbose: true (ctx) adds the full task without its log.
export async function writeReply<E extends Record<string, unknown>>(
  db: Q,
  t: Task,
  ctx: Pick<Ctx, "verbose">,
  changed: string[],
  extra: E = {} as E,
  warnings?: WriteWarning[],
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
  const tickets = (await readerOf(db).find("tasks", { projectId, kind: "ticket" })).filter((t) => t.status !== "Won't do");
  const discovered = (t: Task) => t.origin === "discovered";
  const settled = (t: Task) => t.status === "In review" || t.status === "Done";
  return {
    chartered: tickets.filter((t) => !discovered(t)).length,
    charteredSettled: tickets.filter((t) => !discovered(t) && settled(t)).length,
    found: tickets.filter(discovered).length,
    foundOpen: tickets.filter((t) => discovered(t) && !settled(t)).length,
  };
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

export async function listTasks(db: Q, projectId: string, filters: TaskFilters) {
  const r = readerOf(db);
  const now = clockOf(r);
  const live = (t: Task) => !!t.leaseUntil && t.leaseUntil > now;
  let since: Date | undefined;
  if (filters.updatedSince !== undefined) {
    since = new Date(filters.updatedSince);
    if (Number.isNaN(since.getTime())) throw new ToolError("INVALID_FILTER", { field: "updated_since" });
  }
  // The store sorts (P0 to P3, null last, then most recently updated); the filters below keep that order.
  const all = await r.find("tasks", { projectId }, { orderBy: [{ column: "priority" }, { column: "updatedAt", desc: true }] });
  const keyOf = new Map(all.map((t) => [t.id, t.key]));
  const parentKey = (t: Task) => (t.parentId ? (keyOf.get(t.parentId) ?? null) : null);
  let rows = all;
  if (filters.parentKey !== undefined) rows = rows.filter((t) => parentKey(t) === filters.parentKey);
  if (filters.status !== undefined) rows = rows.filter((t) => t.status === filters.status);
  if (filters.kind !== undefined) rows = rows.filter((t) => t.kind === filters.kind);
  if (filters.workType !== undefined) rows = rows.filter((t) => t.workType === filters.workType);
  if (filters.severity?.length) rows = rows.filter((t) => t.severity !== null && filters.severity!.includes(t.severity));
  if (filters.owner === "none") rows = rows.filter((t) => !live(t));
  else if (filters.owner !== undefined) rows = rows.filter((t) => live(t) && (t.owner?.session_id === filters.owner || t.owner?.agent === filters.owner));
  if (filters.unblocked !== undefined) {
    const blocked = await blockedTaskIds(r, projectId, rows.map((t) => t.id), now);
    rows = rows.filter((t) => blocked.has(t.id) !== filters.unblocked);
  }
  if (since) rows = rows.filter((t) => t.updatedAt > since);
  if (filters.search?.trim()) {
    // Case-insensitive and literal (ILIKE with the term escaped): a substring of the key, title,
    // summary, scope or any check's text.
    const term = filters.search.trim().toLowerCase();
    const hit = (s: string) => s.toLowerCase().includes(term);
    const ids = rows.map((t) => t.id);
    const checkHits = new Set((ids.length ? await r.find("checks", { taskId: ids }) : []).filter((c) => hit(c.text)).map((c) => c.taskId));
    rows = rows.filter((t) => hit(t.key) || hit(t.title) || hit(t.summary) || hit(t.scope) || checkHits.has(t.id));
  }
  rows = rows.slice(0, Math.min(Math.max(filters.limit ?? LIST_DEFAULT, 1), LIST_MAX));
  const ids = rows.map((t) => t.id);
  const linked = new Map<string, Row<"pullRequests">>();
  for (const pr of ids.length ? await r.find("pullRequests", { taskId: ids }, { orderBy: [{ column: "updatedAt", desc: true }] }) : []) {
    if (pr.taskId && !linked.has(pr.taskId)) linked.set(pr.taskId, pr);
  }
  return rows.map((t) => ({
    key: t.key,
    title: t.title,
    summary: t.summary,
    status: t.status,
    priority: t.priority,
    kind: t.kind,
    stage: t.stage,
    promoted_to: t.promotedTo,
    work_type: t.workType,
    parent_key: parentKey(t),
    origin: t.origin,
    severity: t.severity,
    version: t.version,
    claimed_by: (live(t) ? t.owner : null) as Actor | null,
    updated_at: iso(t.updatedAt),
    // 2.8: when it moved, when it closed, when it is due, and its PR as one object.
    status_changed_at: iso(t.statusChangedAt),
    done_at: iso(t.resolvedAt),
    due_on: t.dueOn,
    pr_url: t.prUrl,
    pr: listPr(linked.get(t.id), t.prUrl),
  }));
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
  const r = readerOf(db);
  const now = clockOf(r);
  const p = await r.get("projects", { id: projectId });
  const where: Where<"tasks"> = { projectId, kind: "ticket" };
  if (initiativeKey !== undefined) {
    const initiative = await findTask(db, projectId, initiativeKey);
    if (!initiative || initiative.kind !== "initiative") throw new ToolError("INITIATIVE_NOT_FOUND");
    where.parentId = initiative.id;
  }
  // The store sorts by priority (null last) then key, so both keep the database's text order.
  let rows = (await r.find("tasks", where, { orderBy: [{ column: "priority" }, { column: "key" }] })).filter((t) => claimableNow(t, now));
  // settings.claim_from: "ready" means only Ready tickets (and stale claims) are offered.
  if (p?.settings.claim_from === "ready") rows = rows.filter((t) => t.status !== "Backlog");
  const blocked = await blockedTaskIds(r, projectId, rows.map((t) => t.id), now);
  rows = rows.filter((t) => !blocked.has(t.id));
  // 2.12: within a priority, what Jorge asked for (origin jorge) comes first. Each priority keeps the
  // rank the store gave it, and the sort is stable, so key order holds inside each group.
  const rank = new Map<string | null, number>();
  for (const t of rows) if (!rank.has(t.priority)) rank.set(t.priority, rank.size);
  const jorgeFirst = (t: Task) => (t.origin === "jorge" ? 0 : 1);
  rows.sort((a, b) => rank.get(a.priority)! - rank.get(b.priority)! || jorgeFirst(a) - jorgeFirst(b));
  const t = rows[0];
  if (!t) return { task: null };
  const parent = t.parentId ? await r.get("tasks", { id: t.parentId }) : undefined;
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
      request: t.origin === "jorge",
    },
  };
}
