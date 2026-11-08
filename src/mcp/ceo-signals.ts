// PLA-I28: what the CEO screen derives from data it already has: a short brief, one queue of what needs
// the CEO, goal health, weekly trend and whether an agent can be woken from the screen. Read-only SQL.
// The rules are plain functions so tests can pin them without a database.
import { sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import type { AgentView } from "./team.js";
import { isPruebaTitle } from "./progress.js";

export const STALL_DAYS = 7;
export const RISK_REVIEWS = 3;
export const WEEKS = 6;
export const TREND_TARGET = 140;
const DAY_MS = 86_400_000;

export type Health = "on" | "risk" | "stop" | "none";

// Open initiatives with what their tickets are doing. last_move is the newest status change of any child.
export type InitiativeSignal = {
  project: string;
  key: string;
  title: string;
  status: string;
  goal_id: string | null;
  open: number;
  ready: number;
  in_review: number;
  in_progress: number;
  done: number;
  total: number;
  last_move: string | null;
};

export type ReviewGroup = {
  project: string;
  key: string;
  title: string;
  count: number;
  since: string;
  pr_url: string | null;
};

export type QueueKind = "decidir" | "merge" | "atorado" | "paso";

export type QueueItem = {
  id: string;
  kind: QueueKind;
  project: string;
  key: string | null;
  title: string;
  detail: string;
  age_days: number;
  href: string | null;
  action: "open" | "review" | "assign";
};

export type GoalSignal = { health: Health; why: string };

export type TrendWeek = { from: string; label: string; total: number };

export type Trend = {
  weeks: TrendWeek[];
  target: number;
  cycle_days: number | null;
  in_review: number;
  ready_unowned: number;
};

export type WakeInfo = { can_wake: boolean; wake_reason: string | null };

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

// "30 oct" for a YYYY-MM-DD day.
export function shortDay(day: string): string {
  const [, month, date] = day.split("-").map(Number);
  return `${date} ${MONTHS[(month ?? 1) - 1]}`;
}

export function ageDays(since: string | null, now: Date): number {
  if (!since) return 0;
  return Math.max(0, Math.floor((now.getTime() - new Date(since).getTime()) / DAY_MS));
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// Stopped: nothing moved for STALL_DAYS and Ready work waits. At risk: RISK_REVIEWS or more wait on the CEO's review.
export function initiativeStalled(item: InitiativeSignal, now: Date): boolean {
  if (item.status === "On hold" || item.ready === 0 || item.in_progress > 0) return false;
  return ageDays(item.last_move, now) >= STALL_DAYS;
}

export function goalSignal(items: InitiativeSignal[], now: Date, dayOf: (iso: string) => string): GoalSignal {
  if (items.length === 0) return { health: "none", why: "Sin iniciativas vinculadas" };
  const stalled = items.filter((item) => initiativeStalled(item, now));
  const active = items.filter((item) => item.status !== "On hold");
  if (active.length > 0 && stalled.length === active.length) {
    const first = stalled[0]!;
    const since = first.last_move ? ` sin cambios desde el ${shortDay(dayOf(first.last_move))}` : " sin cambios";
    return { health: "stop", why: `${first.key}${since}, ${plural(first.ready, "listo", "listos")}` };
  }
  const reviews = items.reduce((sum, item) => sum + item.in_review, 0);
  if (reviews >= RISK_REVIEWS) return { health: "risk", why: `${plural(reviews, "espera", "esperan")} tu revisión` };
  // The screen already shows the goal's done/total; the why says what is open and moving, not the count again.
  const ready = items.reduce((sum, item) => sum + item.ready, 0);
  const moving = items.filter((item) => item.in_progress > 0).length;
  const parts = [plural(items.length, "iniciativa abierta", "iniciativas abiertas")];
  if (ready > 0) parts.push(plural(ready, "listo", "listos"));
  if (moving > 0) parts.push(plural(moving, "en curso", "en curso"));
  return { health: "on", why: parts.join(" · ") };
}

// The company goal sums its project goals' health: how many are on track.
export function companySignal(children: GoalSignal[]): GoalSignal {
  const counted = children.filter((child) => child.health !== "none");
  if (counted.length === 0) return { health: "none", why: "Sin metas de producto con iniciativas" };
  const on = counted.filter((child) => child.health === "on").length;
  const worst = counted.some((child) => child.health === "stop") ? "stop" : counted.some((child) => child.health === "risk") ? "risk" : "on";
  return { health: worst === "stop" ? "risk" : worst, why: `${on} de ${counted.length} metas en curso` };
}

const KIND_RANK: Record<QueueKind, number> = { decidir: 0, merge: 1, atorado: 2, paso: 3 };

type WaitLike = { id: string; group: string; project: string; key: string | null; title: string | null; why: string; wait_s: number; pr_url: string | null };

export function buildQueue(
  input: { waits: WaitLike[]; reviews: ReviewGroup[]; initiatives: InitiativeSignal[] },
  now: Date,
): QueueItem[] {
  const out: QueueItem[] = [];
  for (const wait of input.waits) {
    if (wait.group !== "decisiones" && wait.group !== "pasos") continue;
    out.push({
      id: `wait:${wait.id}`,
      kind: wait.group === "decisiones" ? "decidir" : "paso",
      project: wait.project,
      key: wait.key,
      title: wait.title?.trim() || wait.why,
      detail: wait.title ? wait.why : "",
      age_days: Math.floor(wait.wait_s / 86_400),
      href: wait.pr_url,
      action: "open",
    });
  }
  for (const group of input.reviews) {
    out.push({
      id: `review:${group.project}:${group.key}`,
      kind: "merge",
      project: group.project,
      key: group.key,
      title: group.title,
      detail: `${plural(group.count, "ticket", "tickets")} en revisión`,
      age_days: ageDays(group.since, now),
      href: group.pr_url,
      action: "review",
    });
  }
  for (const item of input.initiatives) {
    if (!initiativeStalled(item, now)) continue;
    out.push({
      id: `stall:${item.project}:${item.key}`,
      kind: "atorado",
      project: item.project,
      key: item.key,
      title: item.title,
      detail: `${plural(item.ready, "ticket listo", "tickets listos")} y nadie lo toma`,
      age_days: ageDays(item.last_move, now),
      href: null,
      action: "assign",
    });
  }
  return out.sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind] || b.age_days - a.age_days || (a.key ?? "").localeCompare(b.key ?? ""));
}

const PROJECT_NAMES: Record<string, string> = { micasa: "MiCasa" };
export const projectName = (slug: string) => PROJECT_NAMES[slug] ?? slug.charAt(0).toUpperCase() + slug.slice(1);

// At most four lines, most urgent first. Numbers only from the queue and the week; nothing invented.
export function buildBrief(input: { queue: QueueItem[]; finished: number; previous: number }): string[] {
  const lines: string[] = [];
  const merges = input.queue.filter((item) => item.kind === "merge");
  if (merges.length > 0) {
    const perProject = new Map<string, number>();
    for (const item of merges) {
      const n = Number.parseInt(item.detail, 10) || 0;
      perProject.set(item.project, (perProject.get(item.project) ?? 0) + n);
    }
    const total = [...perProject.values()].reduce((a, b) => a + b, 0);
    const parts = [...perProject.entries()].sort((a, b) => b[1] - a[1]).map(([slug, n]) => `${projectName(slug)} ${n}`);
    lines.push(`${plural(total, "ticket espera", "tickets esperan")} tu revisión: ${parts.join(", ")}.`);
  }
  const stalled = input.queue.filter((item) => item.kind === "atorado");
  if (stalled.length > 0) {
    const first = stalled[0]!;
    const more = stalled.length > 1 ? ` (y ${stalled.length - 1} más)` : "";
    lines.push(`${first.key} (${projectName(first.project)}) lleva ${first.age_days} días quieta, con trabajo listo y sin agente${more}.`);
  }
  const decisions = input.queue.filter((item) => item.kind === "decidir");
  if (decisions.length > 0) {
    lines.push(`${plural(decisions.length, "decisión te espera", "decisiones te esperan")}: ${decisions[0]!.title}.`);
  }
  if (input.finished > 0 || input.previous > 0) {
    if (input.previous > 0) {
      const delta = Math.round(((input.finished - input.previous) / input.previous) * 100);
      const word = delta >= 0 ? "más" : "menos";
      lines.push(`Salieron ${input.finished} cosas esta semana, ${Math.abs(delta)} % ${word} que la anterior.`);
    } else {
      lines.push(`Salieron ${input.finished} cosas esta semana.`);
    }
  }
  if (lines.length === 0) lines.push("Nada te espera hoy.");
  return lines.slice(0, 4);
}

// Whether the screen's Despertar can do anything. Never reads a value, only whether the named variable is set.
export function wakeInfo(agent: Pick<AgentView, "adapter" | "adapter_config" | "wake_url">, env: NodeJS.ProcessEnv = process.env): WakeInfo {
  const config = (agent.adapter_config ?? {}) as Record<string, string | undefined>;
  const named = (field: string) => {
    const name = config[field];
    return name ? { name, set: Boolean(env[name]?.trim()) } : null;
  };
  switch (agent.adapter) {
    case "http":
      return agent.wake_url ? { can_wake: true, wake_reason: null } : { can_wake: false, wake_reason: "Sin URL para despertarlo" };
    case "cursor_agent":
    case "claude_code": {
      const command = named("command_env");
      if (!command) return { can_wake: false, wake_reason: "Sin comando configurado" };
      return command.set ? { can_wake: true, wake_reason: null } : { can_wake: false, wake_reason: `Falta ${command.name} en .env` };
    }
    case "grok_webhook": {
      const url = named("url_env");
      if (!url) return { can_wake: false, wake_reason: "Sin URL configurada" };
      return url.set ? { can_wake: true, wake_reason: null } : { can_wake: false, wake_reason: `Falta ${url.name} en .env` };
    }
    default:
      return { can_wake: false, wake_reason: "Se despierta a mano" };
  }
}

const iso = (value: unknown): string | null => (value == null ? null : new Date(value as string).toISOString());

export async function loadInitiatives(db: Db): Promise<InitiativeSignal[]> {
  const rows = await db.execute<Record<string, unknown>>(sql`
    select p.slug as project, i.key, i.title, i.status, i.goal_id,
      count(t.id) filter (where t.status not in ('Done', 'Won''t do'))::int as open,
      count(t.id) filter (where t.status = 'Ready')::int as ready,
      count(t.id) filter (where t.status = 'In review')::int as in_review,
      count(t.id) filter (where t.status = 'In progress')::int as in_progress,
      count(t.id) filter (where t.status = 'Done')::int as done,
      count(t.id) filter (where t.status <> 'Won''t do')::int as total,
      max(coalesce(t.status_changed_at, t.created_at)) as last_move
    from tasks i
    join projects p on p.id = i.project_id
    left join tasks t on t.parent_id = i.id and t.kind = 'ticket'
    where i.kind = 'initiative' and i.status not in ('Done', 'Won''t do')
    group by p.slug, i.id
    order by p.slug, i.key`);
  return rows.rows
    .filter((row) => !isPruebaTitle(String(row.title)))
    .map((row) => ({
      project: String(row.project),
      key: String(row.key),
      title: String(row.title),
      status: String(row.status),
      goal_id: (row.goal_id as string | null) ?? null,
      open: Number(row.open),
      ready: Number(row.ready),
      in_review: Number(row.in_review),
      in_progress: Number(row.in_progress),
      done: Number(row.done),
      total: Number(row.total),
      last_move: iso(row.last_move),
    }));
}

// In review tickets, one group per initiative (or the ticket itself when standalone).
export async function loadReviews(db: Db): Promise<ReviewGroup[]> {
  const rows = await db.execute<Record<string, unknown>>(sql`
    select p.slug as project, coalesce(i.key, t.key) as key, coalesce(i.title, t.title) as title,
      count(*)::int as count, min(coalesce(t.status_changed_at, t.updated_at)) as since,
      min(t.pr_url) as pr_url
    from tasks t
    join projects p on p.id = t.project_id
    left join tasks i on i.id = t.parent_id
    where t.kind = 'ticket' and t.status = 'In review'
    group by p.slug, coalesce(i.key, t.key), coalesce(i.title, t.title)
    order by p.slug, 2`);
  return rows.rows
    .filter((row) => !isPruebaTitle(String(row.title)))
    .map((row) => ({
      project: String(row.project),
      key: String(row.key),
      title: String(row.title),
      count: Number(row.count),
      since: iso(row.since)!,
      pr_url: (row.pr_url as string | null) ?? null,
    }));
}

// Tickets Done per calendar week (Monday start, screen time zone), the last WEEKS weeks, oldest first.
export async function loadTrend(db: Db, input: { timeZone: string; weekStarts: string[] }): Promise<Omit<Trend, "target">> {
  const first = input.weekStarts[0]!;
  const [weeks, cycle, open] = await Promise.all([
    db.execute<{ week: string; total: number }>(sql`
      select to_char(date_trunc('week', resolved_at at time zone ${input.timeZone}), 'YYYY-MM-DD') as week, count(*)::int as total
      from tasks
      where kind = 'ticket' and status = 'Done' and resolved_at is not null
        and (resolved_at at time zone ${input.timeZone})::date >= ${first}::date
      group by 1`),
    db.execute<{ days: number | null }>(sql`
      select percentile_cont(0.5) within group (order by extract(epoch from (resolved_at - created_at)) / 86400) as days
      from tasks
      where kind = 'ticket' and status = 'Done' and resolved_at > now() - interval '28 days'`),
    db.execute<{ in_review: number; ready_unowned: number }>(sql`
      select count(*) filter (where status = 'In review')::int as in_review,
        count(*) filter (where status = 'Ready' and owner_agent is null)::int as ready_unowned
      from tasks
      where kind = 'ticket'`),
  ]);
  const byWeek = new Map(weeks.rows.map((row) => [row.week, Number(row.total)]));
  const days = cycle.rows[0]?.days;
  return {
    weeks: input.weekStarts.map((from) => ({ from, label: shortDay(from), total: byWeek.get(from) ?? 0 })),
    cycle_days: days == null ? null : Math.round(Number(days) * 10) / 10,
    in_review: Number(open.rows[0]?.in_review ?? 0),
    ready_unowned: Number(open.rows[0]?.ready_unowned ?? 0),
  };
}

export type ReadyTicket = { project: string; key: string; title: string; parent_key: string | null; owner_agent: string | null };

export const READY_LIMIT = 80;

// Ready tickets the screen can hand to an agent: unowned first, then by priority and key.
export async function loadReadyTickets(db: Db): Promise<ReadyTicket[]> {
  const rows = await db.execute<Record<string, unknown>>(sql`
    select p.slug as project, t.key, t.title, i.key as parent_key, a.slug as owner_agent
    from tasks t
    join projects p on p.id = t.project_id
    left join tasks i on i.id = t.parent_id
    left join agents a on a.id = t.owner_agent
    where t.kind = 'ticket' and t.status = 'Ready'
    order by (t.owner_agent is not null), coalesce(t.priority, 'P9'), p.slug, t.key
    limit ${READY_LIMIT}`);
  return rows.rows
    .filter((row) => !isPruebaTitle(String(row.title)))
    .map((row) => ({
      project: String(row.project),
      key: String(row.key),
      title: String(row.title),
      parent_key: (row.parent_key as string | null) ?? null,
      owner_agent: (row.owner_agent as string | null) ?? null,
    }));
}

// Ready tickets each agent owns, by roster slug.
export async function loadReadyByAgent(db: Db): Promise<Map<string, number>> {
  const rows = await db.execute<{ slug: string; ready: number }>(sql`
    select a.slug, count(*)::int as ready
    from tasks t
    join agents a on a.id = t.owner_agent
    where t.kind = 'ticket' and t.status = 'Ready'
    group by a.slug`);
  return new Map(rows.rows.map((row) => [row.slug, Number(row.ready)]));
}
