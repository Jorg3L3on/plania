import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { digestReads, events, projects, tasks, type Actor, type Task } from "../db/schema.js";
import { footprintsOf } from "./footprint-read.js";
import { inbox, type InboxItem } from "./inbox.js";
import { headlineShape } from "./project.js";
import { listEvents } from "./queries.js";
import { resumeDigest, resumeLine } from "./resume.js";
import { iso, type Q } from "./tx.js";

// 2.7 Watch API: cross-project reads for an assistant that keeps Jorge updated with one cheap call.
// list_projects (every project in one line with counts), get_running (every live claim with a
// derived liveness) and get_digest (what changed since a cursor, what runs, what waits on Jorge).
// Everything here reads tables other tools already write; agents emit nothing new.

// A lease is "quiet" after this long without a heartbeat or an event from its session.
export const QUIET_MIN = Number(process.env.PLANIA_QUIET_MIN) || 20;
const DIGEST_DEFAULT_HOURS = 24;
const DIGEST_EVENTS_MAX = 2000;
export const DIGEST_PER_PROJECT_DEFAULT = 15;

// ---- list_projects

async function lastEventByProject(db: Q) {
  const rows = await db
    .select({ projectId: events.projectId, id: sql<number>`max(${events.id})::bigint`, at: sql<Date>`max(${events.createdAt})` })
    .from(events)
    .groupBy(events.projectId);
  return new Map(rows.map((r) => [r.projectId, { id: Number(r.id), at: r.at instanceof Date ? r.at : new Date(r.at) }]));
}

async function ticketCountsByProject(db: Q) {
  const rows = await db
    .select({
      projectId: tasks.projectId,
      open: sql<number>`count(*) filter (where ${tasks.status} not in ('Done', 'Won''t do', 'Released'))::int`,
      in_progress: sql<number>`count(*) filter (where ${tasks.status} = 'In progress')::int`,
      in_review: sql<number>`count(*) filter (where ${tasks.status} = 'In review')::int`,
      needs_jorge: sql<number>`count(*) filter (where ${tasks.status} = 'Needs Jorge')::int`,
      blocked: sql<number>`count(*) filter (where ${tasks.status} = 'Blocked')::int`,
      done: sql<number>`count(*) filter (where ${tasks.status} = 'Done')::int`,
      overdue: sql<number>`count(*) filter (where ${tasks.dueOn} < (now() at time zone 'UTC')::date and ${tasks.status} not in ('Done', 'Won''t do', 'Merged', 'Released'))::int`,
    })
    .from(tasks)
    .where(eq(tasks.kind, "ticket"))
    .groupBy(tasks.projectId);
  return new Map(rows.map((r) => [r.projectId, { open: r.open, in_progress: r.in_progress, in_review: r.in_review, needs_jorge: r.needs_jorge, blocked: r.blocked, done: r.done, overdue: r.overdue }]));
}

const ZERO_COUNTS = { open: 0, in_progress: 0, in_review: 0, needs_jorge: 0, blocked: 0, done: 0, overdue: 0 };

export async function listProjects(db: Q) {
  const all = await db.select().from(projects).orderBy(asc(projects.slug));
  const [last, counts] = await Promise.all([lastEventByProject(db), ticketCountsByProject(db)]);
  const out = await Promise.all(
    all.map(async (p) => {
      const d = await resumeDigest(db, p);
      const le = last.get(p.id);
      return {
        slug: p.slug,
        title: p.title,
        key_prefix: p.keyPrefix,
        headline: headlineShape(p),
        line: resumeLine(d),
        counts: counts.get(p.id) ?? ZERO_COUNTS,
        open_questions: d.open_questions.length,
        claims: d.claims.length,
        last_event_id: le?.id ?? 0,
        last_event_at: le ? iso(le.at) : null,
        created_at: iso(p.createdAt),
      };
    }),
  );
  return { projects: out, as_of: new Date().toISOString() };
}

// ---- get_running

export type Liveness = "live" | "quiet" | "stale";

export function liveness(t: Pick<Task, "leaseUntil">, lastActivity: Date | null, now = new Date(), goneOnMachine = false): Liveness {
  if (!t.leaseUntil || t.leaseUntil <= now || goneOnMachine) return "stale";
  if (!lastActivity || now.getTime() - lastActivity.getTime() > QUIET_MIN * 60_000) return "quiet";
  return "live";
}

// 2.8: claim.stale events (the machine job saw the claim's worktree gone), by task → lease_until values
// they were logged for, so a later lease on the same ticket starts clean.
async function staleClaims(db: Q, ids: string[]) {
  const out = new Map<string, Set<string>>();
  if (!ids.length) return out;
  const rows = await db
    .select({ taskId: events.taskId, until: sql<string>`${events.payload}->>'lease_until'` })
    .from(events)
    .where(and(inArray(events.taskId, ids), eq(events.type, "claim.stale")));
  for (const r of rows) if (r.taskId) (out.get(r.taskId) ?? out.set(r.taskId, new Set()).get(r.taskId)!).add(r.until);
  return out;
}

// Newest event per task written by the session that holds it (heartbeats update last_seen_at, not events).
async function lastSessionEvent(db: Q, rows: { id: string; owner: Actor }[]) {
  if (!rows.length) return new Map<string, Date>();
  const ids = rows.map((r) => r.id);
  const found = await db
    .select({ taskId: events.taskId, session: sql<string>`${events.actor}->>'session_id'`, at: sql<Date>`max(${events.createdAt})` })
    .from(events)
    .where(and(inArray(events.taskId, ids), sql`${events.actor}->>'session_id' in (${sql.join(rows.map((r) => sql`${r.owner.session_id}`), sql`, `)})`))
    .groupBy(events.taskId, sql`${events.actor}->>'session_id'`);
  const out = new Map<string, Date>();
  for (const f of found) {
    const row = rows.find((r) => r.id === f.taskId && r.owner.session_id === f.session);
    if (row && f.taskId) out.set(f.taskId, f.at instanceof Date ? f.at : new Date(f.at));
  }
  return out;
}

export async function getRunning(db: Q, now = new Date()) {
  const parent = alias(tasks, "parent");
  const rows = await db
    .select({ t: tasks, slug: projects.slug, parentKey: parent.key })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .leftJoin(parent, eq(parent.id, tasks.parentId))
    .where(isNotNull(tasks.owner))
    .orderBy(asc(projects.slug), asc(tasks.key));
  const owned = rows.map((r) => ({ id: r.t.id, owner: r.t.owner! }));
  const [sessionEvents, foot, stale] = await Promise.all([lastSessionEvent(db, owned), footprintsOf(db, owned.map((o) => o.id)), staleClaims(db, owned.map((o) => o.id))]);
  const running = rows.map(({ t, slug, parentKey }) => {
    const candidates = [t.lastSeenAt, t.claimedAt, sessionEvents.get(t.id) ?? null].filter((d): d is Date => d instanceof Date);
    const last = candidates.length ? new Date(Math.max(...candidates.map((d) => d.getTime()))) : null;
    return {
      project: slug,
      key: t.key,
      kind: t.kind,
      parent_key: parentKey,
      title: t.title,
      status: t.status,
      owner: t.owner,
      claimed_at: iso(t.claimedAt),
      lease_until: iso(t.leaseUntil),
      last_activity_at: iso(last),
      liveness: liveness(t, last, now, stale.get(t.id)?.has(iso(t.leaseUntil) ?? "") ?? false),
      gone_on_machine: stale.get(t.id)?.has(iso(t.leaseUntil) ?? "") ?? false,
      workspace: t.workspace,
      footprint: foot.filter((f) => f.taskId === t.id && f.state !== "gone").map(({ taskId: _, ...f }) => f),
    };
  });
  return { running, as_of: now.toISOString() };
}

// ---- get_digest

// Where this reader left off. reader: the agent token id, or static:<scope> for env tokens.
export async function readerCursor(db: Q, reader: string): Promise<number | null> {
  const [row] = await db.select().from(digestReads).where(eq(digestReads.reader, reader)).limit(1);
  return row ? Number(row.cursor) : null;
}

export async function rememberCursor(db: Q, reader: string, cursor: number) {
  await db
    .insert(digestReads)
    .values({ reader, cursor })
    .onConflictDoUpdate({ target: digestReads.reader, set: { cursor, at: sql`now()` } });
}

// Events that say nothing to a human reading a summary once every quarter hour.
const NOISE = new Set(["claim.workspace", "claim.expiring"]);

type Change = { id: number; at: string; type: string; key: string | null; summary: string; collapsed?: number };

// 2.8 collapse rules: consecutive status moves of one key fold into the last one (Ready → In progress
// → In review reads "→ In review"), and a run of notes by one session on one key folds into one line
// with a count. Everything else stays. collapsed says how many events a line stands for.
export function collapseChanges(evs: { id: number; at: string; type: string; task_key: string | null; summary: string; actor: Actor }[]): Change[] {
  const out: Change[] = [];
  for (const e of evs) {
    const prev = out.at(-1);
    const line: Change = { id: e.id, at: e.at, type: e.type, key: e.task_key, summary: e.summary };
    const sameKey = prev && prev.key === e.task_key && prev.type === e.type;
    if (sameKey && e.type === "task.status") {
      out[out.length - 1] = { ...line, collapsed: (prev.collapsed ?? 1) + 1 };
      continue;
    }
    if (sameKey && e.type === "note" && prev.summary.startsWith(`${e.task_key} nota (${e.actor.agent})`)) {
      const n = (prev.collapsed ?? 1) + 1;
      out[out.length - 1] = { ...line, summary: `${e.task_key} ${n} notas (${e.actor.agent}); última: ${e.summary.slice(e.summary.indexOf(": ") + 2)}`, collapsed: n };
      continue;
    }
    out.push(line);
  }
  return out;
}

// Open tasks whose due date passed (a calendar date compared to today's UTC date).
export async function overdueTasks(db: Q, projectId?: string) {
  const today = new Date().toISOString().slice(0, 10);
  const rows = await db
    .select({ key: tasks.key, title: tasks.title, status: tasks.status, due_on: tasks.dueOn, slug: projects.slug })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(and(isNotNull(tasks.dueOn), sql`${tasks.dueOn} < ${today}::date`, sql`${tasks.status} not in ('Done', 'Won''t do', 'Merged', 'Released')`, ...(projectId ? [eq(tasks.projectId, projectId)] : [])))
    .orderBy(asc(tasks.dueOn), asc(projects.slug), asc(tasks.key));
  return rows.map((r) => ({ project: r.slug, key: r.key, title: r.title, status: r.status, due_on: r.due_on, days_late: Math.round((Date.parse(today) - Date.parse(r.due_on!)) / 86_400_000) }));
}

async function cursorHoursAgo(db: Q, hours: number): Promise<number> {
  const [row] = await db
    .select({ id: sql<number>`coalesce(max(${events.id}), 0)::bigint` })
    .from(events)
    .where(sql`${events.createdAt} <= now() - make_interval(hours => ${hours})`);
  return Number(row?.id ?? 0);
}

async function latestCursor(db: Q): Promise<number> {
  const [row] = await db.select({ id: sql<number>`coalesce(max(${events.id}), 0)::bigint` }).from(events);
  return Number(row?.id ?? 0);
}

export type DigestInput = { since?: number; project?: string; max_events_per_project?: number; reader?: string };

type Highlights = { done: string[]; to_review: string[]; blocked: string[]; needs_jorge: string[]; prs_opened: number[]; prs_merged: number[]; claims: string[] };

function highlight(h: Highlights, e: { type: string; task_key: string | null; payload: Record<string, unknown> }) {
  const k = e.task_key;
  const push = (list: string[], v: string | null) => v && !list.includes(v) && list.push(v);
  if (e.type === "task.status" || e.type === "task.approved_move") {
    const to = String(e.payload.to ?? "");
    if (to === "Done" || to === "Merged" || to === "Released") push(h.done, k);
    if (to === "In review") push(h.to_review, k);
    if (to === "Blocked") push(h.blocked, k);
    if (to === "Needs Jorge") push(h.needs_jorge, k);
  }
  if (e.type === "question.asked") push(h.needs_jorge, k);
  if (e.type === "claim.acquired") push(h.claims, k);
  const n = typeof e.payload.number === "number" ? e.payload.number : null;
  if (e.type === "pr.opened" && n !== null && !h.prs_opened.includes(n)) h.prs_opened.push(n);
  if (e.type === "pr.merged" && n !== null && !h.prs_merged.includes(n)) h.prs_merged.push(n);
}

export async function getDigest(db: Q, input: DigestInput = {}) {
  const reader = input.reader;
  let since = input.since;
  let from: "since" | "memory" | "default" = "since";
  if (since === undefined && reader && !(input.project && input.project !== "all")) {
    const remembered = await readerCursor(db, reader);
    if (remembered !== null) {
      since = remembered;
      from = "memory";
    }
  }
  if (since === undefined) {
    since = await cursorHoursAgo(db, DIGEST_DEFAULT_HOURS);
    from = "default";
  }
  const only = input.project && input.project !== "all" ? input.project : null;
  const all = await db.select().from(projects).orderBy(asc(projects.slug));
  const scoped = only ? all.filter((p) => p.slug === only) : all;
  const perProject = Math.max(1, Math.min(input.max_events_per_project ?? DIGEST_PER_PROJECT_DEFAULT, 200));

  // One pass over the feed; the cursor moves to the newest id read (or the latest if nothing new).
  const feed = await listEvents(db, only ? (scoped[0]?.id ?? null) : null, { since, limit: DIGEST_EVENTS_MAX });
  const cursor = feed.events.length ? feed.next_cursor : Math.max(since, await latestCursor(db));
  const byProject = new Map<string, typeof feed.events>();
  for (const e of feed.events) {
    const slug = (e as { project?: string }).project ?? "";
    (byProject.get(slug) ?? byProject.set(slug, []).get(slug)!).push(e);
  }

  const [running, box, overdue] = await Promise.all([getRunning(db), inbox(db, "all"), overdueTasks(db, only ? scoped[0]?.id : undefined)]);
  const needsJorge = (box.items as InboxItem[])
    .filter((i) => !only || i.project === only)
    .map((i) => ({ project: i.project, kind: i.kind, key: i.key, title: i.title, why: i.why, options: i.options, blocks: i.blocks, urgency: i.urgency, wait_s: i.wait_s, pr_url: i.pr_url, action_hint: i.action_hint }));

  const unchanged: string[] = [];
  const out = [];
  for (const p of scoped) {
    const evs = byProject.get(p.slug) ?? [];
    const meaningful = evs.filter((e) => !NOISE.has(e.type));
    if (!meaningful.length) {
      unchanged.push(p.slug);
      continue;
    }
    const d = await resumeDigest(db, p);
    const h: Highlights = { done: [], to_review: [], blocked: [], needs_jorge: [], prs_opened: [], prs_merged: [], claims: [] };
    for (const e of meaningful) highlight(h, e);
    const lines = collapseChanges(meaningful);
    out.push({
      slug: p.slug,
      title: p.title,
      line: resumeLine(d),
      headline: d.headline.text || null,
      changes: lines.slice(-perProject),
      changes_total: meaningful.length,
      changes_lines: lines.length,
      highlights: h,
      quiet: running.running.filter((r) => r.project === p.slug).every((r) => r.liveness !== "live"),
    });
  }

  // A digest over one project reads a partial feed, so its cursor must not become the reader's
  // memory for "all": only an unscoped call moves the bookmark.
  if (reader && !only) await rememberCursor(db, reader, cursor);
  return {
    cursor,
    since,
    since_from: from,
    as_of: running.as_of,
    truncated: feed.more,
    needs_jorge: needsJorge,
    overdue,
    running: running.running.filter((r) => !only || r.project === only),
    projects: out,
    unchanged_projects: unchanged,
  };
}

// The reader key behind a connection: an agent token's id, or the static env token's scope.
export function readerOf(identity: { tokenId: string } | undefined, scopes: readonly string[]): string {
  if (identity) return identity.tokenId;
  return `static:${scopes.includes("write") ? "bearer" : "read"}`;
}
