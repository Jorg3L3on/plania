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
    })
    .from(tasks)
    .where(eq(tasks.kind, "ticket"))
    .groupBy(tasks.projectId);
  return new Map(rows.map((r) => [r.projectId, { open: r.open, in_progress: r.in_progress, in_review: r.in_review, needs_jorge: r.needs_jorge, blocked: r.blocked, done: r.done }]));
}

const ZERO_COUNTS = { open: 0, in_progress: 0, in_review: 0, needs_jorge: 0, blocked: 0, done: 0 };

export async function listProjects(db: Q) {
  const all = await db.select().from(projects).orderBy(asc(projects.slug));
  const [last, counts] = await Promise.all([lastEventByProject(db), ticketCountsByProject(db)]);
  const out = await Promise.all(
    all.map(async (p) => {
      const d = await resumeDigest(db, p, { includeLegacy: true });
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

export function liveness(t: Pick<Task, "leaseUntil">, lastActivity: Date | null, now = new Date()): Liveness {
  if (!t.leaseUntil || t.leaseUntil <= now) return "stale";
  if (!lastActivity || now.getTime() - lastActivity.getTime() > QUIET_MIN * 60_000) return "quiet";
  return "live";
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
  const [sessionEvents, foot] = await Promise.all([lastSessionEvent(db, owned), footprintsOf(db, owned.map((o) => o.id))]);
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
      liveness: liveness(t, last, now),
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

  const [running, box] = await Promise.all([getRunning(db), inbox(db, "all")]);
  const needsJorge = (box.items as InboxItem[])
    .filter((i) => !only || i.project === only)
    .map((i) => ({ project: i.project, kind: i.kind, key: i.key, title: i.title, why: i.why, options: i.options, wait_s: i.wait_s, pr_url: i.pr_url, action_hint: i.action_hint }));

  const unchanged: string[] = [];
  const out = [];
  for (const p of scoped) {
    const evs = byProject.get(p.slug) ?? [];
    const meaningful = evs.filter((e) => !NOISE.has(e.type));
    if (!meaningful.length) {
      unchanged.push(p.slug);
      continue;
    }
    const d = await resumeDigest(db, p, { includeLegacy: true });
    const h: Highlights = { done: [], to_review: [], blocked: [], needs_jorge: [], prs_opened: [], prs_merged: [], claims: [] };
    for (const e of meaningful) highlight(h, e);
    const tail = meaningful.slice(-perProject);
    out.push({
      slug: p.slug,
      title: p.title,
      line: resumeLine(d),
      headline: d.headline.text || null,
      changes: tail.map((e) => ({ id: e.id, at: e.at, type: e.type, key: e.task_key, summary: e.summary })),
      changes_total: meaningful.length,
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
