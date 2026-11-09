// PLA-I35-1: what a project card says about the business, derived from tables that already exist (no migration).
//   plan       the week of the plan: the most advanced Active initiative, its place among the project's
//              initiatives (one initiative = one week), its tickets done of total, and the pace against a date.
//   this_week  what happened in the last 7 days: tickets closed, docs written, PRs merged; last_at = last event.
//   next       the next milestone and whose it is: Jorge's (a ceo-owned or Needs Jorge ticket) first, then the
//              next Ready ticket, the active initiative's before the rest.
//   work       what a paused project keeps inside: open tickets, and those In progress.
// Pace: due = the active initiative's due_on, else the delivery (the last initiative with a due_on). Weeks of work
// left until that initiative = its position - week + 1; weeks of calendar left = ceil(days to due / 7) (0 or
// less once past). weeks_behind = max(0, work - calendar); 0 ok, 1 late, 2 or more bad. No date: pace null.
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { agents, tasks, type Project, type Task } from "../db/schema.js";
import { roleOf } from "../runner/limits.js";

const DAY = 86_400_000;
const CLOSED = ["Done", "Merged", "Released", "Won't do"];
const DONE = ["Done", "Merged", "Released"];

export type Pace = "ok" | "late" | "bad";
export type PlanLine = {
  week: number;
  weeks: number;
  initiative: { key: string; title: string };
  done: number;
  total: number;
  due_on: string | null;
  pace: Pace | null;
  weeks_behind: number | null;
};
export type ThisWeek = { done: number; docs: number; prs: number; last_at: string | null };
export type NextOwner = "jorge" | "po" | string;
export type NextLine = { title: string; key: string; owner: NextOwner; due: string | null };
export type WorkLine = { open: number; in_progress: number };

// MIA-I2 before MIA-I10: the number at the end of the key, then creation.
const keyNumber = (key: string) => Number(/(\d+)$/.exec(key)?.[1] ?? Number.MAX_SAFE_INTEGER);
const byKey = (a: Task, b: Task) => keyNumber(a.key) - keyNumber(b.key) || a.createdAt.getTime() - b.createdAt.getTime();

export function paceOf(input: { week: number; dueIndex: number; dueOn: string; today: Date }): { pace: Pace; weeks_behind: number } {
  const due = Date.parse(`${input.dueOn}T23:59:59Z`);
  const days = (due - input.today.getTime()) / DAY;
  const calendar = Math.ceil(days / 7);
  const work = input.dueIndex - input.week + 1;
  const behind = Math.max(0, work - calendar);
  return { pace: behind === 0 ? "ok" : behind === 1 ? "late" : "bad", weeks_behind: behind };
}

export async function planOf(db: Db, p: Project, today = new Date()): Promise<PlanLine | null> {
  const all = (await db.select().from(tasks).where(and(eq(tasks.projectId, p.id), eq(tasks.kind, "initiative")))).filter((t) => t.status !== "Won't do").sort(byKey);
  const active = all.filter((t) => t.status === "Active").at(-1);
  if (!active) return null;
  const week = all.indexOf(active) + 1;
  const children = await db.select({ status: tasks.status }).from(tasks).where(and(eq(tasks.parentId, active.id), eq(tasks.kind, "ticket")));
  const counted = children.filter((c) => c.status !== "Won't do");
  let dueIndex = week;
  let dueOn = active.dueOn ?? null;
  if (!dueOn) {
    const last = all.filter((t, i) => t.dueOn && i + 1 >= week).at(-1);
    if (last) {
      dueOn = last.dueOn!;
      dueIndex = all.indexOf(last) + 1;
    }
  }
  const pace = dueOn ? paceOf({ week, dueIndex, dueOn, today }) : null;
  return {
    week,
    weeks: all.length,
    initiative: { key: active.key, title: active.title },
    done: counted.filter((c) => DONE.includes(c.status)).length,
    total: counted.length,
    due_on: dueOn,
    pace: pace?.pace ?? null,
    weeks_behind: pace?.weeks_behind ?? null,
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
