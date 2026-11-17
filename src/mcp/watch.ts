import type { Actor, Task } from "../db/schema.js";
import { writeVia } from "../runner/limits.js";
// This file exports a readerOf of its own (the digest reader's key), so the port's is renamed here.
import { readerOf as storeReaderOf } from "../store/port.js";
import { lt, lte, notNull, type Reader } from "../store/types.js";
import { payloadText } from "./delegate.js";
import { footprintsOf } from "./footprint-read.js";
import { inbox, type InboxItem } from "./inbox.js";
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

// The newest event id and the newest event time of each project. They are read apart, as two maxima: a
// write's clock reading does not have to grow with its event ids.
async function lastEventByProject(r: Reader, projectIds: string[]) {
  const out = new Map<string, { id: number; at: Date }>();
  await Promise.all(
    projectIds.map(async (projectId) => {
      const [byId] = await r.find("events", { projectId }, { orderBy: [{ column: "id", desc: true }], limit: 1 });
      const [byAt] = await r.find("events", { projectId }, { orderBy: [{ column: "createdAt", desc: true }], limit: 1 });
      if (byId && byAt) out.set(projectId, { id: byId.id, at: byAt.createdAt });
    }),
  );
  return out;
}

const ZERO_COUNTS = { open: 0, in_progress: 0, in_review: 0, needs_jorge: 0, blocked: 0, done: 0, overdue: 0 };

// Statuses an open ticket and an overdue one are not in.
const NOT_OPEN = ["Done", "Won't do", "Released"];
const NOT_OVERDUE = ["Done", "Won't do", "Merged", "Released"];

async function ticketCountsByProject(r: Reader) {
  // Today's date in UTC, as "YYYY-MM-DD" like due_on.
  const today = new Date().toISOString().slice(0, 10);
  const out = new Map<string, typeof ZERO_COUNTS>();
  for (const t of await r.find("tasks", { kind: "ticket" })) {
    let c = out.get(t.projectId);
    if (!c) out.set(t.projectId, (c = { ...ZERO_COUNTS }));
    if (!NOT_OPEN.includes(t.status)) c.open += 1;
    if (t.status === "In progress") c.in_progress += 1;
    if (t.status === "In review") c.in_review += 1;
    if (t.status === "Needs Jorge") c.needs_jorge += 1;
    if (t.status === "Blocked") c.blocked += 1;
    if (t.status === "Done") c.done += 1;
    if (t.dueOn !== null && t.dueOn < today && !NOT_OVERDUE.includes(t.status)) c.overdue += 1;
  }
  return out;
}

// Every project, sorted by slug by the store so text order stays the database's.
const projectsBySlug = (r: Reader) => r.find("projects", undefined, { orderBy: [{ column: "slug" }] });

export async function listProjects(db: Q) {
  const r = storeReaderOf(db);
  const all = await projectsBySlug(r);
  const [last, counts] = await Promise.all([lastEventByProject(r, all.map((p) => p.id)), ticketCountsByProject(r)]);
  const out = await Promise.all(
    all.map(async (p) => {
      const d = await resumeDigest(db, p);
      const le = last.get(p.id);
      return {
        slug: p.slug,
        title: p.title,
        key_prefix: p.keyPrefix,
        headline: d.headline,
        line: resumeLine(d),
        readiness: d.readiness,
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
async function staleClaims(r: Reader, ids: string[]) {
  const out = new Map<string, Set<string | null>>();
  if (!ids.length) return out;
  for (const e of await r.find("events", { taskId: ids, type: "claim.stale" })) {
    if (e.taskId) (out.get(e.taskId) ?? out.set(e.taskId, new Set()).get(e.taskId)!).add(payloadText(e.payload, "lease_until"));
  }
  return out;
}

// Newest event per task written by the session that holds it (heartbeats update last_seen_at, not events).
// The session is compared as text, as actor->>'session_id' was: only a string session id can match.
export async function lastSessionEvent(r: Reader, rows: { id: string; sessionId: unknown }[]) {
  const out = new Map<string, Date>();
  if (!rows.length) return out;
  const sessionOf = new Map<string, unknown>();
  for (const row of rows) if (!sessionOf.has(row.id)) sessionOf.set(row.id, row.sessionId);
  for (const e of await r.find("events", { taskId: rows.map((row) => row.id) })) {
    const want = e.taskId ? sessionOf.get(e.taskId) : undefined;
    if (typeof want !== "string" || payloadText(e.actor, "session_id") !== want) continue;
    const prev = out.get(e.taskId!);
    if (!prev || e.createdAt > prev) out.set(e.taskId!, e.createdAt);
  }
  return out;
}

export async function getRunning(db: Q, now = new Date()) {
  const r = storeReaderOf(db);
  // Held tickets by project slug, then by key. The store sorts each text column; the stable sort by the
  // project's place keeps the key order inside a project.
  const projects = await projectsBySlug(r);
  const place = new Map(projects.map((p, i) => [p.id, i]));
  const slugOf = new Map(projects.map((p) => [p.id, p.slug]));
  const held = (await r.find("tasks", { owner: notNull() }, { orderBy: [{ column: "key" }] }))
    .filter((t) => place.has(t.projectId))
    .sort((a, b) => place.get(a.projectId)! - place.get(b.projectId)!);
  const parentIds = [...new Set(held.flatMap((t) => (t.parentId ? [t.parentId] : [])))];
  const parentKeys = new Map(parentIds.length ? (await r.find("tasks", { id: parentIds })).map((t) => [t.id, t.key]) : []);
  const rows = held.map((t) => ({ t, slug: slugOf.get(t.projectId)!, parentKey: t.parentId ? (parentKeys.get(t.parentId) ?? null) : null }));
  const owned = rows.map((row) => ({ id: row.t.id, owner: row.t.owner! }));
  const [sessionEvents, foot, stale] = await Promise.all([
    lastSessionEvent(r, owned.map((o) => ({ id: o.id, sessionId: o.owner.session_id }))),
    footprintsOf(db, owned.map((o) => o.id)),
    staleClaims(r, owned.map((o) => o.id)),
  ]);
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
  // PLA-I60-5: live runner runs per project (an agent may run several work items at once), by project slug, then
  // by start (the store's sort, nulls last; the stable sort by the project's place keeps it).
  const agentSlug = new Map((await r.find("agents")).map((a) => [a.id, a.slug]));
  const live = (await r.find("agentRuns", { status: ["starting", "running"] }, { orderBy: [{ column: "startedAt" }] }))
    .filter((x) => place.has(x.projectId) && agentSlug.has(x.agentId))
    .sort((a, b) => place.get(a.projectId)! - place.get(b.projectId)!);
  const runs = live.map((x) => ({ run_id: x.id, project: slugOf.get(x.projectId)!, agent: agentSlug.get(x.agentId)!, work_key: x.workKey, lane: x.lane, status: x.status, started_at: iso(x.startedAt) }));
  return { running, runs, as_of: now.toISOString() };
}

// ---- get_digest

// Where this reader left off. reader: the agent token id, or static:<scope> for env tokens.
export async function readerCursor(db: Q, reader: string): Promise<number | null> {
  // A missing reader names no bookmark (the port would read a missing value as "any").
  const row = reader == null ? undefined : await storeReaderOf(db).get("digestReads", { reader });
  return row ? Number(row.cursor) : null;
}

// The bookmark belongs to no project: its write is a store write of its own, or part of the one db is in.
export async function rememberCursor(db: Q, reader: string, cursor: number) {
  await writeVia(db, async (uow) => {
    if (await uow.get("digestReads", { reader })) await uow.update("digestReads", { reader }, { cursor, at: uow.now });
    else await uow.insert("digestReads", { reader, cursor });
  });
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
  const r = storeReaderOf(db);
  // By due date, then project slug, then key. The store sorts the text columns (slug and key); the stable
  // sort by due date and the project's place keeps the key order within one.
  const projects = await projectsBySlug(r);
  const place = new Map(projects.map((p, i) => [p.id, i]));
  const slugOf = new Map(projects.map((p) => [p.id, p.slug]));
  // A missing or empty project id means every project, as before.
  const due = await r.find("tasks", { projectId: projectId || undefined, dueOn: lt(today) }, { orderBy: [{ column: "dueOn" }, { column: "key" }] });
  const rows = due
    .filter((t) => t.dueOn !== null && !NOT_OVERDUE.includes(t.status) && place.has(t.projectId))
    .sort((a, b) => (a.dueOn! < b.dueOn! ? -1 : a.dueOn! > b.dueOn! ? 1 : 0) || place.get(a.projectId)! - place.get(b.projectId)!);
  return rows.map((t) => ({ project: slugOf.get(t.projectId)!, key: t.key, title: t.title, status: t.status, due_on: t.dueOn, days_late: Math.round((Date.parse(today) - Date.parse(t.dueOn!)) / 86_400_000) }));
}

// The newest event id, among those at least `hours` old; 0 when there is none.
async function cursorHoursAgo(r: Reader, hours: number): Promise<number> {
  const [row] = await r.find("events", { createdAt: lte(new Date(Date.now() - hours * 3_600_000)) }, { orderBy: [{ column: "id", desc: true }], limit: 1 });
  return row?.id ?? 0;
}

async function latestCursor(r: Reader): Promise<number> {
  const [row] = await r.find("events", undefined, { orderBy: [{ column: "id", desc: true }], limit: 1 });
  return row?.id ?? 0;
}

// remember: false reads from the reader's bookmark without moving it (the screen moves it on "Visto").
export type DigestInput = { since?: number; project?: string; max_events_per_project?: number; reader?: string; remember?: boolean };

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
  const r = storeReaderOf(db);
  if (since === undefined) {
    since = await cursorHoursAgo(r, DIGEST_DEFAULT_HOURS);
    from = "default";
  }
  const only = input.project && input.project !== "all" ? input.project : null;
  const all = await projectsBySlug(r);
  const scoped = only ? all.filter((p) => p.slug === only) : all;
  const perProject = Math.max(1, Math.min(input.max_events_per_project ?? DIGEST_PER_PROJECT_DEFAULT, 200));

  // One pass over the feed; the cursor moves to the newest id read (or the latest if nothing new).
  const feed = await listEvents(db, only ? (scoped[0]?.id ?? null) : null, { since, limit: DIGEST_EVENTS_MAX });
  const cursor = feed.events.length ? feed.next_cursor : Math.max(since, await latestCursor(r));
  const byProject = new Map<string, typeof feed.events>();
  for (const e of feed.events) {
    const slug = (e as { project?: string }).project ?? "";
    (byProject.get(slug) ?? byProject.set(slug, []).get(slug)!).push(e);
  }

  const [running, box, overdue] = await Promise.all([getRunning(db), inbox(db, "all"), overdueTasks(db, only ? scoped[0]?.id : undefined)]);
  const needsJorge = (box.items as InboxItem[])
    .filter((i) => !only || i.project === only)
    .map((i) => ({ project: i.project, kind: i.kind, group: i.group, key: i.key, title: i.title, why: i.why, options: i.options, blocks: i.blocks, urgency: i.urgency, wait_s: i.wait_s, pr_url: i.pr_url, action_hint: i.action_hint }));

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
      readiness: d.readiness,
      headline: d.headline.generated || null,
      headline_note: d.headline.note.text || null,
      changes: lines.slice(-perProject),
      changes_total: meaningful.length,
      changes_lines: lines.length,
      highlights: h,
      quiet: running.running.filter((r) => r.project === p.slug).every((r) => r.liveness !== "live"),
    });
  }

  // A digest over one project reads a partial feed, so its cursor must not become the reader's
  // memory for "all": only an unscoped call moves the bookmark.
  if (reader && !only && input.remember !== false) await rememberCursor(db, reader, cursor);
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
