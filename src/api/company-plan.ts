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
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { agents, events, taskBlockers, tasks, type Project, type Task } from "../db/schema.js";
import { hasUnsatisfiedBlocker } from "../mcp/blockers.js";
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
export const byKey = (a: Task, b: Task) => keyNumber(a.key) - keyNumber(b.key) || a.createdAt.getTime() - b.createdAt.getTime();
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

// PLA-I40-3: the route. The project's open initiatives in the plan's order are its legs; the one the plan stands
// on (planOf's active initiative, so both counts agree) is "here" and carries its tickets as named steps.
//   leg   done (every ticket landed), here, planned (has tickets), unplanned (none yet); note says a step that
//         was put off when only Backlog tickets are left.
//   step  done (accepted), published (in a release that shipped, or Released), delivered (In review, waits for
//         the owner), working (In progress), next (the first Ready step nothing holds), later (the rest).
// At most 8 legs and 12 steps; more_legs and more_steps count what was left out.
export type StepState = "done" | "published" | "delivered" | "working" | "next" | "later";
export type RouteStep = { key: string; title: string; state: StepState; who: string | null; at: string | null };
export type LegState = "done" | "here" | "planned" | "unplanned";
export type RouteLeg = { key: string; title: string; done: number; total: number; state: LegState; note: string | null; steps?: RouteStep[]; more_steps?: number };
export type Route = { legs: RouteLeg[]; more_legs: number };
const MAX_LEGS = 8;
const MAX_STEPS = 12;

export async function routeOf(db: Db, p: Project): Promise<Route | null> {
  const open = (await db.select().from(tasks).where(and(eq(tasks.projectId, p.id), eq(tasks.kind, "initiative")))).filter((t) => OPEN_INITIATIVE.includes(t.status)).sort(byKey);
  if (open.length === 0) return null;
  const here = open.filter((t) => t.status === "Active").at(-1) ?? null;
  const tickets = (await db.select().from(tasks).where(and(inArray(tasks.parentId, open.map((t) => t.id)), eq(tasks.kind, "ticket")))).filter((t) => t.status !== "Won't do");

  const legs: RouteLeg[] = open.map((i) => {
    const mine = tickets.filter((t) => t.parentId === i.id);
    const done = mine.filter((t) => DONE.includes(t.status)).length;
    const left = mine.filter((t) => !DONE.includes(t.status));
    const off = left.length > 0 && left.every((t) => t.status === "Backlog");
    const state: LegState = i.id === here?.id ? "here" : mine.length === 0 ? "unplanned" : done === mine.length ? "done" : "planned";
    return { key: i.key, title: i.title, done, total: mine.length, state, note: off ? (left.length === 1 ? `Pospuesto: ${left[0]!.title}` : `${left.length} pasos pospuestos`) : null };
  });

  if (here) {
    const mine = tickets.filter((t) => t.parentId === here.id).sort((a, b) => (a.phase ?? 999) - (b.phase ?? 999) || byKey(a, b));
    const shipped = new Set<string>();
    for (const e of await db.select({ payload: events.payload }).from(events).where(and(eq(events.projectId, p.id), eq(events.type, "release.shipped"))).orderBy(desc(events.id)).limit(50)) {
      for (const k of (e.payload.tickets as unknown[] | undefined) ?? []) if (typeof k === "string") shipped.add(k);
    }
    // A Ready step is free when nothing holds it and every step before it has landed (the rule that wakes Taller).
    const ready = mine.filter((t) => t.status === "Ready");
    const held = new Set<string>();
    if (ready.length) {
      const rows = await db.execute<{ id: string }>(sql`
        select t.id from ${tasks} t where t.id in (${sql.join(ready.map((t) => sql`${t.id}::uuid`), sql`, `)})
          and (${hasUnsatisfiedBlocker(sql`t.id`)} or exists (
            select 1 from ${taskBlockers} tb join ${tasks} b on b.id = tb.blocker_id
            where tb.task_id = t.id and b.status not in ('Merged', 'Released', 'Done')))`);
      for (const r of rows.rows) held.add(String(r.id));
    }
    const next = ready.find((t) => !held.has(t.id))?.id ?? null;
    const owners = [...new Set(mine.map((t) => t.ownerAgent).filter((x): x is string => !!x))];
    const roles = new Map<string, string>();
    if (owners.length) for (const a of await db.select().from(agents).where(inArray(agents.id, owners))) roles.set(a.id, roleOf(a) ?? a.role);
    const steps: RouteStep[] = mine.map((t) => {
      const state: StepState =
        t.status === "Released" || (DONE.includes(t.status) && shipped.has(t.key))
          ? "published"
          : DONE.includes(t.status)
            ? "done"
            : t.status === "In review"
              ? "delivered"
              : t.status === "In progress"
                ? "working"
                : t.id === next
                  ? "next"
                  : "later";
      const who = (t.ownerAgent && roles.get(t.ownerAgent)) || ((t.workType ?? "code") === "code" ? "taller" : "product-owner");
      return { key: t.key, title: t.title, state, who, at: t.statusChangedAt?.toISOString() ?? null };
    });
    const leg = legs.find((l) => l.key === here.key)!;
    leg.steps = steps.slice(0, MAX_STEPS);
    if (steps.length > MAX_STEPS) leg.more_steps = steps.length - MAX_STEPS;
  }
  // Keep the leg we stand on in view when there are more than fit.
  const at = Math.max(0, legs.findIndex((l) => l.state === "here"));
  const from = Math.min(Math.max(0, at - (MAX_LEGS - 2)), Math.max(0, legs.length - MAX_LEGS));
  return { legs: legs.slice(from, from + MAX_LEGS), more_legs: Math.max(0, legs.length - MAX_LEGS) };
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

// PLA-I36-6: the next Ready tickets (not Jorge's), in Siguiente's order, for Cambiar lo siguiente.
export type ReadyLine = { key: string; title: string };
// PLA-I39-1: every Ready ticket that is not Jorge's, in Siguiente's order, with what decides whose queue it joins.
export type QueuedTicket = { key: string; title: string; owner: string | null; work_type: string };

export async function nextOf(db: Db, p: Project, ceoId: string | null, activeKey: string | null): Promise<NextLine | null> {
  return (await readyOf(db, p, ceoId, activeKey)).next;
}

export async function readyOf(db: Db, p: Project, ceoId: string | null, activeKey: string | null): Promise<{ next: NextLine | null; ready: ReadyLine[]; queued: QueuedTicket[] }> {
  const open = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.projectId, p.id), eq(tasks.kind, "ticket"), inArray(tasks.status, ["Ready", "Needs Jorge"])))
    .orderBy(asc(tasks.phase), asc(tasks.createdAt));
  if (open.length === 0) return { next: null, ready: [], queued: [] };
  const parents = new Map<string, string>();
  const parentIds = [...new Set(open.map((t) => t.parentId).filter((x): x is string => !!x))];
  if (parentIds.length) for (const r of await db.select({ id: tasks.id, key: tasks.key }).from(tasks).where(inArray(tasks.id, parentIds))) parents.set(r.id, r.key);
  const inActive = (t: Task) => (activeKey && t.parentId && parents.get(t.parentId) === activeKey ? 0 : 1);
  const jorge = (t: Task) => t.status === "Needs Jorge" || (!!ceoId && t.ownerAgent === ceoId);
  // PLA-I36-6: the ticket Jorge picked goes first after his own.
  const first = (t: Task) => (p.settings.next_first === t.key ? 0 : 1);
  const sorted = [...open].sort((a, b) => Number(!jorge(a)) - Number(!jorge(b)) || first(a) - first(b) || inActive(a) - inActive(b) || PRIORITY(a.priority) - PRIORITY(b.priority) || (a.phase ?? 99) - (b.phase ?? 99) || byKey(a, b));
  const t = sorted[0]!;
  const theirs = sorted.filter((x) => x.status === "Ready" && !jorge(x));
  const ready = theirs.slice(0, 5).map((x) => ({ key: x.key, title: x.title }));
  const queued = theirs.map((x) => ({ key: x.key, title: x.title, owner: x.ownerAgent ?? null, work_type: x.workType ?? "code" }));
  let owner: NextOwner = jorge(t) ? "jorge" : (t.workType ?? "code") === "code" ? "taller" : "po";
  if (!jorge(t) && t.ownerAgent) {
    const [a] = await db.select().from(agents).where(eq(agents.id, t.ownerAgent)).limit(1);
    const role = a ? roleOf(a) : null;
    if (role) owner = role === "product-owner" ? "po" : role;
  }
  return { next: { title: t.title, key: t.key, owner, due: t.dueOn ?? null }, ready, queued };
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
