// PLA-I35-1: what a project card says about the business, derived from tables that already exist (no migration).
//   plan       where the work is (PLA-I36-5: by the calendar, not by an initiative's place in the list).
//   this_week  what happened in the last 7 days: tickets closed, docs written, PRs merged; last_at = last event.
//   next       the next milestone and whose it is: Jorge's (a ceo-owned or Needs Jorge ticket) first, then the
//              next Ready ticket, the active initiative's before the rest.
//   work       what a paused project keeps inside: open tickets, and those In progress.
// PLA-I36-5. The plan is the project's open initiatives (Planning, Active, Shipping, On hold). Delivery is the
// goal's target_on, else the latest due_on among them. Start is the oldest open initiative's creation. With both
// dates the bar runs in calendar weeks from start to delivery: today_pct is how much of that time went by,
// done_pct how much of the plan's tickets are done. weeks_behind = max(0, round((today_pct - done_pct) * weeks));
// 0 ok, 1 late, 2 or more bad; forecast_on = delivery + weeks_behind weeks. Without a delivery date there is no
// bar and no pace: only the active initiative and its tickets done of total.
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { agents, tasks, type Project, type Task } from "../db/schema.js";
import { roleOf } from "../runner/limits.js";

const DAY = 86_400_000;
const CLOSED = ["Done", "Merged", "Released", "Won't do"];
const DONE = ["Done", "Merged", "Released"];

export type Pace = "ok" | "late" | "bad";
export type PlanLine = {
  initiative: { key: string; title: string };
  // The active initiative's tickets.
  done: number;
  total: number;
  // Calendar (null without a delivery date).
  start_on: string | null;
  due_on: string | null;
  weeks: number | null;
  today_pct: number | null;
  done_pct: number | null;
  pace: Pace | null;
  weeks_behind: number | null;
  forecast_on: string | null;
};
export type ThisWeek = { done: number; docs: number; prs: number; last_at: string | null };
export type NextOwner = "jorge" | "po" | string;
export type NextLine = { title: string; key: string; owner: NextOwner; due: string | null };
export type WorkLine = { open: number; in_progress: number };

// MIA-I2 before MIA-I10: the number at the end of the key, then creation.
const keyNumber = (key: string) => Number(/(\d+)$/.exec(key)?.[1] ?? Number.MAX_SAFE_INTEGER);
const byKey = (a: Task, b: Task) => keyNumber(a.key) - keyNumber(b.key) || a.createdAt.getTime() - b.createdAt.getTime();
const OPEN_INITIATIVE = ["Planning", "Active", "Shipping", "On hold"];
const day = (d: Date) => d.toISOString().slice(0, 10);
const atNoon = (iso: string) => Date.parse(`${iso}T12:00:00Z`);

export type Calendar = { weeks: number; today_pct: number; done_pct: number; pace: Pace; weeks_behind: number; forecast_on: string };

// Pure: the calendar position of a plan.
export function calendarOf(input: { startOn: string; dueOn: string; today: Date; done: number; total: number }): Calendar {
  const start = atNoon(input.startOn);
  const due = atNoon(input.dueOn);
  const span = Math.max(DAY, due - start);
  const weeks = Math.max(1, Math.ceil(span / (7 * DAY)));
  const today = Math.min(1, Math.max(0, (input.today.getTime() - start) / span));
  const done = input.total > 0 ? input.done / input.total : 0;
  const behind = Math.max(0, Math.round((today - done) * weeks));
  const pct = (x: number) => Math.round(x * 100);
  return {
    weeks,
    today_pct: pct(today),
    done_pct: pct(done),
    pace: behind === 0 ? "ok" : behind === 1 ? "late" : "bad",
    weeks_behind: behind,
    forecast_on: day(new Date(due + behind * 7 * DAY)),
  };
}

// Kept for the forecast in Rumbo: delivery plus the weeks behind.
export const forecastOf = (dueOn: string, weeksBehind: number) => day(new Date(atNoon(dueOn) + weeksBehind * 7 * DAY));

export async function planOf(db: Db, p: Project, today = new Date(), goalTarget: string | null = null): Promise<PlanLine | null> {
  const open = (await db.select().from(tasks).where(and(eq(tasks.projectId, p.id), eq(tasks.kind, "initiative")))).filter((t) => OPEN_INITIATIVE.includes(t.status)).sort(byKey);
  const active = open.filter((t) => t.status === "Active").at(-1);
  if (!active) return null;
  const tickets = await db
    .select({ status: tasks.status, parentId: tasks.parentId })
    .from(tasks)
    .where(and(inArray(tasks.parentId, open.map((t) => t.id)), eq(tasks.kind, "ticket")));
  const counted = tickets.filter((c) => c.status !== "Won't do");
  const mine = counted.filter((c) => c.parentId === active.id);
  const dueOn = goalTarget ?? open.map((t) => t.dueOn).filter((d): d is string => !!d).sort().at(-1) ?? null;
  const startOn = day(new Date(Math.min(...open.map((t) => t.createdAt.getTime()))));
  const cal = dueOn ? calendarOf({ startOn, dueOn, today, done: counted.filter((c) => DONE.includes(c.status)).length, total: counted.length }) : null;
  return {
    initiative: { key: active.key, title: active.title },
    done: mine.filter((c) => DONE.includes(c.status)).length,
    total: mine.length,
    start_on: dueOn ? startOn : null,
    due_on: dueOn,
    weeks: cal?.weeks ?? null,
    today_pct: cal?.today_pct ?? null,
    done_pct: cal?.done_pct ?? null,
    pace: cal?.pace ?? null,
    weeks_behind: cal?.weeks_behind ?? null,
    forecast_on: cal?.forecast_on ?? null,
  };
}

export async function thisWeekOf(db: Db, p: Project, now = new Date()): Promise<ThisWeek> {
  const since = new Date(now.getTime() - 7 * DAY).toISOString();
  const r = await db.execute<{ done: number; docs: number; prs: number; last_at: Date | string | null }>(sql`
    select
      (select count(distinct e.task_id)::int from events e join tasks t on t.id = e.task_id
        where e.project_id = ${p.id} and e.type = 'task.status' and e.payload->>'to' in ('Done', 'Merged', 'Released')
          and t.kind = 'ticket' and e.created_at >= ${since}::timestamptz) as done,
      (select count(distinct e.payload->>'doc_id')::int from events e
        where e.project_id = ${p.id} and e.type = 'doc.put' and e.task_id is not null and e.created_at >= ${since}::timestamptz) as docs,
      (select count(*)::int from events e
        where e.project_id = ${p.id} and e.type = 'pr.merged' and e.created_at >= ${since}::timestamptz) as prs,
      (select max(e.created_at) from events e where e.project_id = ${p.id}) as last_at`);
  const row = r.rows[0]!;
  const last = row.last_at ? new Date(row.last_at) : null;
  return { done: Number(row.done ?? 0), docs: Number(row.docs ?? 0), prs: Number(row.prs ?? 0), last_at: last ? last.toISOString() : null };
}

export async function ceoAgentId(db: Db): Promise<string | null> {
  const [ceo] = await db.select({ id: agents.id }).from(agents).where(eq(agents.slug, "ceo")).limit(1);
  return ceo?.id ?? null;
}

const PRIORITY = (p: string | null) => (p ? Number(p.slice(1)) : 9);

export async function nextOf(db: Db, p: Project, ceoId: string | null, activeKey: string | null): Promise<NextLine | null> {
  const open = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.projectId, p.id), eq(tasks.kind, "ticket"), inArray(tasks.status, ["Ready", "Needs Jorge"])))
    .orderBy(asc(tasks.phase), asc(tasks.createdAt));
  if (open.length === 0) return null;
  const parents = new Map<string, string>();
  const parentIds = [...new Set(open.map((t) => t.parentId).filter((x): x is string => !!x))];
  if (parentIds.length) for (const r of await db.select({ id: tasks.id, key: tasks.key }).from(tasks).where(inArray(tasks.id, parentIds))) parents.set(r.id, r.key);
  const inActive = (t: Task) => (activeKey && t.parentId && parents.get(t.parentId) === activeKey ? 0 : 1);
  const jorge = (t: Task) => t.status === "Needs Jorge" || (!!ceoId && t.ownerAgent === ceoId);
  const sorted = [...open].sort((a, b) => Number(!jorge(a)) - Number(!jorge(b)) || inActive(a) - inActive(b) || PRIORITY(a.priority) - PRIORITY(b.priority) || (a.phase ?? 99) - (b.phase ?? 99) || byKey(a, b));
  const t = sorted[0]!;
  let owner: NextOwner = jorge(t) ? "jorge" : (t.workType ?? "code") === "code" ? "taller" : "po";
  if (!jorge(t) && t.ownerAgent) {
    const [a] = await db.select().from(agents).where(eq(agents.id, t.ownerAgent)).limit(1);
    const role = a ? roleOf(a) : null;
    if (role) owner = role === "product-owner" ? "po" : role;
  }
  return { title: t.title, key: t.key, owner, due: t.dueOn ?? null };
}

export async function workOf(db: Db, p: Project): Promise<WorkLine> {
  const rows = await db
    .select({ status: tasks.status, n: sql<number>`count(*)::int` })
    .from(tasks)
    .where(and(eq(tasks.projectId, p.id), eq(tasks.kind, "ticket")))
    .groupBy(tasks.status);
  let open = 0;
  let inProgress = 0;
  for (const r of rows) {
    if (!CLOSED.includes(r.status)) open += Number(r.n);
    if (r.status === "In progress") inProgress += Number(r.n);
  }
  return { open, in_progress: inProgress };
}
