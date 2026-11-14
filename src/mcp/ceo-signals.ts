// PLA-I28: what the CEO screen derives from data it already has: a short brief, one queue of what needs
// the CEO, goal health, weekly trend and whether an agent can be woken from the screen. Read-only.
// The rules are plain functions so tests can pin them without a database.
import type { Db } from "../db/client.js";
import type { Task } from "../db/schema.js";
import { readerOf } from "../store/port.js";
import { gt, gte, notNull, type Reader } from "../store/types.js";
import type { AgentView } from "./team.js";
import { dayInTz, isPruebaTitle, weekRange } from "./progress.js";

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
  input: { waits: WaitLike[]; reviews: ReviewGroup[]; initiatives: InitiativeSignal[]; yours?: YoursTicket[] },
  now: Date,
): QueueItem[] {
  const out: QueueItem[] = [];
  // PLA-I30-8: a Ready ticket Jorge owns (owner ceo) is his step; no bot will take it.
  for (const t of input.yours ?? []) {
    out.push({
      id: `yours:${t.project}:${t.key}`,
      kind: "paso",
      project: t.project,
      key: t.key,
      title: t.title,
      detail: "Te toca: ningún bot lo toma",
      age_days: ageDays(t.since, now),
      href: null,
      action: "open",
    });
  }
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
  // PLA-I30-8: a Ready ticket only Jorge can do (owner ceo).
  const yours = input.queue.filter((item) => item.id.startsWith("yours:"));
  if (yours.length > 0) {
    const first = yours[0]!;
    const more = yours.length > 1 ? ` (y ${yours.length - 1} más)` : "";
    lines.push(`Te toca: ${first.key} ${first.title} (${projectName(first.project)})${more}.`);
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

const iso = (value: Date | null | undefined): string | null => (value == null ? null : value.toISOString());
const WONT = "Won't do";

// Projects by id with their place in the database's slug order. SQL sorted these reads by slug and then by
// a task key; the store sorts the tasks by key and a stable sort on this rank puts the slugs first.
async function projectRanks(r: Reader): Promise<Map<string, { slug: string; rank: number }>> {
  const rows = await r.find("projects", {}, { orderBy: [{ column: "slug" }] });
  return new Map(rows.map((p, rank) => [p.id, { slug: p.slug, rank }]));
}

// Tasks by id, for the parents and owners the reads below joined.
async function tasksById(r: Reader, ids: (string | null)[]): Promise<Map<string, Task>> {
  const wanted = [...new Set(ids.filter((id): id is string => id !== null))];
  return new Map((wanted.length ? await r.find("tasks", { id: wanted }) : []).map((t) => [t.id, t]));
}

async function agentsById(r: Reader, ids: (string | null)[]): Promise<Map<string, { slug: string; kind: string }>> {
  const wanted = [...new Set(ids.filter((id): id is string => id !== null))];
  return new Map((wanted.length ? await r.find("agents", { id: wanted }) : []).map((a) => [a.id, { slug: a.slug, kind: a.kind }]));
}

const latest = (dates: Date[]): Date | null => (dates.length ? new Date(Math.max(...dates.map((d) => d.getTime()))) : null);
const earliest = (dates: Date[]): Date | null => (dates.length ? new Date(Math.min(...dates.map((d) => d.getTime()))) : null);

export async function loadInitiatives(db: Db): Promise<InitiativeSignal[]> {
  const r = readerOf(db);
  const [projects, initiatives] = await Promise.all([
    projectRanks(r),
    r.find("tasks", { kind: "initiative" }, { orderBy: [{ column: "key" }] }),
  ]);
  const open = initiatives.filter((i) => i.status !== "Done" && i.status !== WONT && projects.has(i.projectId));
  const tickets = open.length ? await r.find("tasks", { parentId: open.map((i) => i.id), kind: "ticket" }) : [];
  const children = new Map<string, Task[]>();
  for (const t of tickets) {
    if (!t.parentId) continue;
    const list = children.get(t.parentId) ?? [];
    list.push(t);
    children.set(t.parentId, list);
  }
  return open
    .sort((a, b) => projects.get(a.projectId)!.rank - projects.get(b.projectId)!.rank)
    .filter((i) => !isPruebaTitle(i.title))
    .map((i) => {
      const kids = children.get(i.id) ?? [];
      const count = (keep: (t: Task) => boolean) => kids.filter(keep).length;
      return {
        project: projects.get(i.projectId)!.slug,
        key: i.key,
        title: i.title,
        status: i.status,
        goal_id: i.goalId ?? null,
        open: count((t) => t.status !== "Done" && t.status !== WONT),
        ready: count((t) => t.status === "Ready"),
        in_review: count((t) => t.status === "In review"),
        in_progress: count((t) => t.status === "In progress"),
        done: count((t) => t.status === "Done"),
        total: count((t) => t.status !== WONT),
        // The newest status change of any child (its creation when it never moved); null with no children.
        last_move: iso(latest(kids.map((t) => t.statusChangedAt ?? t.createdAt))),
      };
    });
}

// In review tickets, one group per initiative (or the ticket itself when standalone).
export async function loadReviews(db: Db): Promise<ReviewGroup[]> {
  const r = readerOf(db);
  // The store sorts by pr_url (nulls last), so the first URL a group meets is the one min(pr_url) chose.
  const [projects, tickets] = await Promise.all([
    projectRanks(r),
    r.find("tasks", { kind: "ticket", status: "In review" }, { orderBy: [{ column: "prUrl" }] }),
  ]);
  const parents = await tasksById(r, tickets.map((t) => t.parentId));
  // Each group's head (its initiative, or the ticket) in the database's key order, for the sort below.
  const heads = new Map<string, Task>();
  for (const t of tickets) {
    const parent = t.parentId ? parents.get(t.parentId) : undefined;
    heads.set(t.id, parent ?? t);
  }
  const headIds = [...new Set([...heads.values()].map((h) => h.id))];
  const keyRank = new Map<string, number>();
  for (const h of headIds.length ? await r.find("tasks", { id: headIds }, { orderBy: [{ column: "key" }] }) : []) {
    if (!keyRank.has(h.key)) keyRank.set(h.key, keyRank.size);
  }
  type Group = ReviewGroup & { rank: number; moved: Date[] };
  const groups = new Map<string, Group>();
  for (const t of tickets) {
    const project = projects.get(t.projectId);
    if (!project) continue;
    const head = heads.get(t.id)!;
    const id = JSON.stringify([project.slug, head.key, head.title]);
    let group = groups.get(id);
    if (!group) {
      group = { project: project.slug, key: head.key, title: head.title, count: 0, since: "", pr_url: null, rank: project.rank, moved: [] };
      groups.set(id, group);
    }
    group.count += 1;
    group.moved.push(t.statusChangedAt ?? t.updatedAt);
    if (group.pr_url === null && t.prUrl !== null) group.pr_url = t.prUrl;
  }
  return [...groups.values()]
    .sort((a, b) => a.rank - b.rank || (keyRank.get(a.key) ?? 0) - (keyRank.get(b.key) ?? 0))
    .filter((group) => !isPruebaTitle(group.title))
    .map((group) => ({
      project: group.project,
      key: group.key,
      title: group.title,
      count: group.count,
      since: iso(earliest(group.moved))!,
      pr_url: group.pr_url,
    }));
}

// Median of values sorted ascending, as percentile_cont(0.5): linear between the two middle ranks.
function medianOf(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const at = 0.5 * (sorted.length - 1);
  const low = sorted[Math.floor(at)]!;
  const high = sorted[Math.ceil(at)]!;
  return low + (at - Math.floor(at)) * (high - low);
}

// Tickets Done per calendar week (Monday start, screen time zone), the last WEEKS weeks, oldest first.
// Unlike the other reads, the week totals and the cycle time keep [PRUEBA] tickets, as the SQL did.
export async function loadTrend(db: Db, input: { timeZone: string; weekStarts: string[] }): Promise<Omit<Trend, "target">> {
  const r = readerOf(db);
  const first = input.weekStarts[0]!;
  // now() - interval '28 days' in SQL; read here as 28 whole days, the same unless the database's session
  // zone changed its clock in the last four weeks.
  const since = new Date(Date.now() - 28 * DAY_MS);
  // A day before `first` at UTC midnight is before its local midnight in any zone; each close is then kept
  // by its calendar day in the zone.
  const floor = new Date(Date.parse(`${first}T00:00:00Z`) - DAY_MS);
  const [done, recent, inReview, readyUnowned] = await Promise.all([
    r.find("tasks", { kind: "ticket", status: "Done", resolvedAt: gte(floor) }),
    r.find("tasks", { kind: "ticket", status: "Done", resolvedAt: gt(since) }),
    r.count("tasks", { kind: "ticket", status: "In review" }),
    r.count("tasks", { kind: "ticket", status: "Ready", ownerAgent: null }),
  ]);
  const byWeek = new Map<string, number>();
  for (const t of done) {
    const day = dayInTz(t.resolvedAt!, input.timeZone);
    if (day < first) continue;
    const week = weekRange(day).from;
    byWeek.set(week, (byWeek.get(week) ?? 0) + 1);
  }
  const days = medianOf(recent.map((t) => (t.resolvedAt!.getTime() - t.createdAt.getTime()) / DAY_MS).sort((a, b) => a - b));
  return {
    weeks: input.weekStarts.map((from) => ({ from, label: shortDay(from), total: byWeek.get(from) ?? 0 })),
    cycle_days: days == null ? null : Math.round(days * 10) / 10,
    in_review: inReview,
    ready_unowned: readyUnowned,
  };
}

export type ReadyTicket = { project: string; key: string; title: string; parent_key: string | null; owner_agent: string | null };

export const READY_LIMIT = 80;

// Ready tickets the screen can hand to an agent: unowned first, then by priority and key.
export async function loadReadyTickets(db: Db): Promise<ReadyTicket[]> {
  const r = readerOf(db);
  const [projects, tickets] = await Promise.all([
    projectRanks(r),
    r.find("tasks", { kind: "ticket", status: "Ready" }, { orderBy: [{ column: "key" }] }),
  ]);
  const [parents, agents] = await Promise.all([tasksById(r, tickets.map((t) => t.parentId)), agentsById(r, tickets.map((t) => t.ownerAgent))]);
  // Unowned first, then priority (null as P9; P0 to P3 sort the same in any collation), then slug; the
  // store's key order holds inside each. The limit applies before [PRUEBA] titles leave, as in SQL.
  const priority = (t: Task) => t.priority ?? "P9";
  return tickets
    .filter((t) => projects.has(t.projectId))
    .sort(
      (a, b) =>
        Number(a.ownerAgent !== null) - Number(b.ownerAgent !== null) ||
        (priority(a) < priority(b) ? -1 : priority(a) > priority(b) ? 1 : 0) ||
        projects.get(a.projectId)!.rank - projects.get(b.projectId)!.rank,
    )
    .slice(0, READY_LIMIT)
    .filter((t) => !isPruebaTitle(t.title))
    .map((t) => ({
      project: projects.get(t.projectId)!.slug,
      key: t.key,
      title: t.title,
      parent_key: (t.parentId ? parents.get(t.parentId)?.key : undefined) ?? null,
      owner_agent: (t.ownerAgent ? agents.get(t.ownerAgent)?.slug : undefined) ?? null,
    }));
}

// PLA-I30-8: Ready tickets owned by the human seat (ceo, or any agent of kind human).
// since is an ISO time (the SQL passed Postgres's own text through; both parse to the same instant).
export type YoursTicket = { project: string; key: string; title: string; since: string | null };

export async function loadYours(db: Db): Promise<YoursTicket[]> {
  const r = readerOf(db);
  const [projects, tickets] = await Promise.all([
    projectRanks(r),
    r.find("tasks", { kind: "ticket", status: "Ready", ownerAgent: notNull() }, { orderBy: [{ column: "key" }] }),
  ]);
  const agents = await agentsById(r, tickets.map((t) => t.ownerAgent));
  const human = (t: Task) => {
    const agent = t.ownerAgent ? agents.get(t.ownerAgent) : undefined;
    return !!agent && (agent.kind === "human" || agent.slug === "ceo");
  };
  return tickets
    .filter((t) => projects.has(t.projectId) && human(t))
    .sort((a, b) => projects.get(a.projectId)!.rank - projects.get(b.projectId)!.rank)
    .slice(0, 20)
    .filter((t) => !isPruebaTitle(t.title))
    .map((t) => ({ project: projects.get(t.projectId)!.slug, key: t.key, title: t.title, since: iso(t.statusChangedAt) }));
}

// Ready tickets each agent owns, by roster slug.
export async function loadReadyByAgent(db: Db): Promise<Map<string, number>> {
  const r = readerOf(db);
  const tickets = await r.find("tasks", { kind: "ticket", status: "Ready", ownerAgent: notNull() });
  const agents = await agentsById(r, tickets.map((t) => t.ownerAgent));
  const out = new Map<string, number>();
  for (const t of tickets) {
    const agent = t.ownerAgent ? agents.get(t.ownerAgent) : undefined;
    if (agent) out.set(agent.slug, (out.get(agent.slug) ?? 0) + 1);
  }
  return out;
}
