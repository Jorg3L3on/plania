// Mi progreso (PLA-I19). Read-only totals for the screen: what reached a final Done or Merged,
// bucketed by calendar day in PLANIA_TZ (America/Mexico_City). A reopen clears resolved_at, so a
// ticket that was Done, reopened and Done again counts once, on the day it is Done now.
// Titles containing [PRUEBA] and Won't do never count. Ideas stay in the bitácora only.
// The year path groups tasks and pull requests per day in SQL and caches the summary. It does not
// scan events, so it does not need the events.created_at index.
import { sql, type SQL } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { ToolError } from "./errors.js";

export type Range = "day" | "week" | "year";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const PRUEBA = "[PRUEBA]";
const PRUEBA_LIKE = `%${PRUEBA}%`;
const WONT = "Won't do";
const PROJECT_ORDER = ["micasa", "workia", "filmia", "zigzag", "plania"];
const WEEK_SHORT = ["L", "M", "M", "J", "V", "S", "D"] as const;
const WEEK_LONG = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"] as const;
const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"] as const;
const CACHE_MS = 60_000;
const HEATMAP_WEEKS = 53;
const LOG_PAGE_DAYS = 21;
const LOG_FULL_SPAN_DAYS = 45;
const EXCERPT = 280;

export const PROGRESS_TYPES = ["bug", "code", "ops", "research", "decision-needed", "debt", "idea", "initiative", "pr"] as const;
export type ProgressType = (typeof PROGRESS_TYPES)[number];

const TYPE_LABEL: Record<string, string> = {
  bug: "Bug arreglado",
  code: "Feature",
  ops: "Ops",
  research: "Investigación",
  "decision-needed": "Decisión",
  debt: "Deuda",
  idea: "Idea",
  initiative: "Iniciativa cerrada",
  pr: "PR fusionado",
};

const STATUS_LABEL: Record<string, string> = {
  Done: "Cerrada",
  "Won't do": "Descartada",
  "In progress": "En curso",
  "In review": "En revisión",
  Merged: "Fusionada",
  Released: "Publicada",
  Ready: "Lista",
  Backlog: "En espera",
  Blocked: "Bloqueada",
  "Needs Jorge": "Te toca",
  Planning: "Planeando",
  Active: "Activa",
  Shipping: "En estreno",
  "On hold": "En pausa",
  Open: "Abierta",
};

export type ProjectCount = { slug: string; title: string; count: number };
export type ProgressPr = { number: number; url: string; title: string };
export type ProgressImage = { before: string | null; after: string | null; all: string[] };

export type DayBucket = { date: string; weekday: string; label: string; total: number; by_project: ProjectCount[] };
export type HourBucket = { hour: number; total: number; by_project: ProjectCount[] };
export type MonthBucket = { month: string; label: string; total: number; by_project: ProjectCount[] };
export type HeatCell = { date: string; count: number; slug: string | null };

export type BiggestWin = {
  project: string;
  project_title: string;
  key: string;
  kind: "ticket" | "initiative";
  type: string;
  type_label: string;
  title: string;
  change: string;
  at: string;
  day: string;
  prs: ProgressPr[];
  tickets: number;
  images: ProgressImage;
};

export type YearBlock = {
  year: number;
  from: string;
  to: string;
  finished: number;
  active_days: number;
  initiatives: number;
  prs: number;
  bugs: number;
  best_streak: number;
  best_day: { date: string; count: number } | null;
  project_of_year: ProjectCount | null;
  by_project: ProjectCount[];
  months: MonthBucket[];
  highlights: { project: string; key: string; title: string; change: string; day: string }[];
};

export type ProgressSummary = {
  range: Range;
  timezone: string;
  date: string;
  today: string;
  from: string;
  to: string;
  label: string;
  finished: number;
  projects_touched: number;
  bugs: number;
  prs: number;
  initiatives: number;
  tickets: number;
  previous_finished: number;
  delta_pct: number | null;
  streak: {
    current: number;
    best_year: number;
    is_best: boolean;
    week: { date: string; label: string; active: boolean; upcoming: boolean }[];
  };
  buckets: DayBucket[];
  hours: HourBucket[];
  by_project: ProjectCount[];
  heatmap: HeatCell[];
  year: YearBlock;
  biggest_win: BiggestWin | null;
};

export type LogChild = {
  key: string;
  title: string;
  summary: string;
  status: string;
  pr_number: number | null;
  pr_url: string | null;
};

export type LogEntry = {
  id: string;
  day: string;
  time: string;
  at: string;
  project: string;
  project_title: string;
  key: string | null;
  kind: "ticket" | "initiative" | "idea" | "pr";
  type: string;
  type_label: string;
  title: string;
  summary: string;
  change: string;
  prs: ProgressPr[];
  images: ProgressImage;
  children: LogChild[];
  child_done: number;
  child_total: number;
};

export type ProgressLog = {
  from: string;
  to: string;
  timezone: string;
  counts: Record<string, number>;
  projects: ProjectCount[];
  days: { date: string; weekday: string; total: number; best: boolean; by_project: ProjectCount[]; entries: LogEntry[] }[];
  next_cursor: string | null;
};

export type ProgressItem = {
  project: string;
  project_title: string;
  key: string;
  kind: "ticket" | "initiative" | "idea";
  type: string;
  type_label: string;
  title: string;
  summary: string;
  change: string;
  doc: string | null;
  status: string;
  day: string | null;
  time: string | null;
  at: string | null;
  created_day: string | null;
  parent: { key: string; title: string } | null;
  prs: ProgressPr[];
  images: ProgressImage;
  children: LogChild[];
  child_done: number;
  child_total: number;
  span_days: number | null;
  timeline: { day: string; time: string; label: string; text: string }[];
};

type TaskAgg = { day: string; hour: number; slug: string; project_title: string; kind: string; work_type: string; n: number };
type PrAgg = { day: string; hour: number; slug: string; project_title: string; n: number };
type Titles = Map<string, string>;

const cache = new Map<string, { exp: number; value: unknown }>();

export function clearProgressCache(): void {
  cache.clear();
}

export function progressTz(): string {
  return process.env.PLANIA_TZ || "America/Mexico_City";
}

export function isPruebaTitle(title: string): boolean {
  return title.includes(PRUEBA);
}

export function dayInTz(date: Date, tz = progressTz()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y!, (m ?? 1) - 1, (d ?? 1) + n)).toISOString().slice(0, 10);
}

/** 0 = Monday … 6 = Sunday. Calendar arithmetic, so it does not depend on the host zone. */
export function weekdayIndex(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  const js = new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1)).getUTCDay();
  return (js + 6) % 7;
}

export function weekRange(day: string): { from: string; to: string } {
  const monday = addDays(day, -weekdayIndex(day));
  return { from: monday, to: addDays(monday, 6) };
}

export function yearRange(day: string): { from: string; to: string; year: number } {
  const year = Number(day.slice(0, 4));
  return { from: `${year}-01-01`, to: `${year}-12-31`, year };
}

/** ISO week of the Thursday in this Monday–Sunday week. 2026-10-26 is week 44. */
export function isoWeek(day: string): { week: number; weekYear: number } {
  const thursday = addDays(day, 3 - weekdayIndex(day));
  const weekYear = Number(thursday.slice(0, 4));
  const jan4 = `${weekYear}-01-04`;
  const week1Monday = addDays(jan4, -weekdayIndex(jan4));
  const diff = Math.round((Date.parse(`${thursday}T00:00:00Z`) - Date.parse(`${week1Monday}T00:00:00Z`)) / 86_400_000);
  return { week: Math.floor(diff / 7) + 1, weekYear };
}

export function deltaPct(current: number, previous: number): number | null {
  if (previous <= 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / previous) * 100);
}

/**
 * Current streak counts back from today, or from yesterday when today has no close yet
 * (the day is not over). bestYear is the longest run inside that calendar year.
 */
export function streakOf(active: Iterable<string>, today: string, year: number): { current: number; bestYear: number } {
  const set = new Set(active);
  let current = 0;
  let cursor = set.has(today) ? today : addDays(today, -1);
  if (set.has(cursor)) {
    while (set.has(cursor)) {
      current += 1;
      cursor = addDays(cursor, -1);
    }
  }
  const prefix = `${year}-`;
  const days = [...set].filter((d) => d.startsWith(prefix)).sort();
  let bestYear = 0;
  let run = 0;
  let prev = "";
  for (const d of days) {
    run = prev && addDays(prev, 1) === d ? run + 1 : 1;
    if (run > bestYear) bestYear = run;
    prev = d;
  }
  return { current, bestYear };
}

export function pairImages(links: string[]): ProgressImage {
  const all = [...new Set(links.filter((u) => /^https?:\/\//i.test(u)))];
  if (all.length === 0) return { before: null, after: null, all };
  if (all.length === 1) return { before: null, after: all[0] ?? null, all };
  return { before: all[0] ?? null, after: all[all.length - 1] ?? null, all };
}

export function plainExcerpt(markdown: string, max = EXCERPT): string {
  const text = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/[#>*_`~]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

export function typeOf(kind: string, workType: string | null): string {
  if (kind === "initiative") return "initiative";
  if (kind === "idea") return "idea";
  return workType || "code";
}

export function typeLabel(type: string): string {
  return TYPE_LABEL[type] ?? type;
}

function assertDay(value: string, field: string): string {
  if (!DAY_RE.test(value)) throw new ToolError("INVALID_FILTER", { field, hint: "YYYY-MM-DD" });
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== (m ?? 1) - 1 || dt.getUTCDate() !== d) {
    throw new ToolError("INVALID_FILTER", { field, hint: "YYYY-MM-DD" });
  }
  return value;
}

function parseRange(raw: string): Range {
  if (raw === "day" || raw === "week" || raw === "year") return raw;
  throw new ToolError("INVALID_FILTER", { field: "range", hint: "day, week or year" });
}

function spanOf(range: Range, day: string): { from: string; to: string } {
  if (range === "day") return { from: day, to: day };
  if (range === "week") return weekRange(day);
  const y = yearRange(day);
  return { from: y.from, to: y.to };
}

function previousSpan(range: Range, from: string): { from: string; to: string } {
  if (range === "day") {
    const d = addDays(from, -1);
    return { from: d, to: d };
  }
  if (range === "week") return { from: addDays(from, -7), to: addDays(from, -1) };
  const year = Number(from.slice(0, 4)) - 1;
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}

function pretty(day: string): string {
  const month = MONTHS[Number(day.slice(5, 7)) - 1] ?? "";
  return `${Number(day.slice(8, 10))} ${month}`;
}

function cap(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function rangeLabel(range: Range, from: string, to: string, today: string): string {
  if (range === "day") {
    const name = from === today ? "Hoy" : cap(WEEK_LONG[weekdayIndex(from)] ?? "");
    return `${name} · ${pretty(from)}`;
  }
  if (range === "week") {
    const { week } = isoWeek(from);
    return `SEMANA ${week} · ${pretty(from).toUpperCase()} – ${pretty(to).toUpperCase()}`;
  }
  return `AÑO ${from.slice(0, 4)}`;
}

function projectSort(a: string, b: string): number {
  const ia = PROJECT_ORDER.indexOf(a);
  const ib = PROJECT_ORDER.indexOf(b);
  return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b);
}

function countsOf(map: Map<string, number>, titles: Titles): ProjectCount[] {
  return [...map.entries()]
    .filter(([, n]) => n > 0)
    .map(([slug, count]) => ({ slug, title: titles.get(slug) ?? slug, count }))
    .sort((a, b) => projectSort(a.slug, b.slug));
}

function dominant(map: Map<string, number>): string | null {
  let best: string | null = null;
  let n = 0;
  for (const [slug, count] of [...map.entries()].sort((a, b) => projectSort(a[0], b[0]))) {
    if (count > n) {
      best = slug;
      n = count;
    }
  }
  return best;
}

function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

function tzStart(day: string, tz: string): SQL {
  return sql`(${day}::date::timestamp at time zone ${tz})`;
}

function tzEnd(day: string, tz: string): SQL {
  return sql`((${day}::date + interval '1 day')::timestamp at time zone ${tz})`;
}

async function q<T extends Record<string, unknown>>(db: Db, query: SQL): Promise<T[]> {
  return (await db.execute<T>(query)).rows as T[];
}

async function watermark(db: Db): Promise<string> {
  const [row] = await q<{ stamp: string }>(db, sql`
    select concat_ws('|',
      (select count(*) from tasks),
      (select coalesce(max(resolved_at)::text, '') from tasks),
      (select coalesce(max(updated_at)::text, '') from tasks),
      (select count(*) from pull_requests),
      (select coalesce(max(merged_at)::text, '') from pull_requests),
      (select coalesce(max(created_at)::text, '') from results),
      (select coalesce(max(updated_at)::text, '') from docs),
      (select coalesce(max(created_at)::text, '') from decisions)
    ) as stamp`);
  return row?.stamp ?? "";
}

async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.exp > Date.now()) return hit.value as T;
  const value = await load();
  cache.set(key, { exp: Date.now() + CACHE_MS, value });
  return value;
}

function cosa(row: TaskAgg): boolean {
  return row.kind === "ticket" || row.kind === "initiative";
}

async function loadProjects(db: Db): Promise<Titles> {
  const rows = await q<{ slug: string; title: string }>(db, sql`select slug, title from projects`);
  return new Map(rows.map((r) => [r.slug, r.title]));
}

async function taskAggregate(db: Db, from: string, to: string, tz: string): Promise<TaskAgg[]> {
  const rows = await q<TaskAgg>(db, sql`
    select to_char(t.resolved_at at time zone ${tz}, 'YYYY-MM-DD') as day,
           extract(hour from t.resolved_at at time zone ${tz})::int as hour,
           p.slug,
           max(p.title) as project_title,
           t.kind,
           coalesce(t.work_type, '') as work_type,
           count(*)::int as n
    from tasks t
    join projects p on p.id = t.project_id
    where t.status = 'Done'
      and t.resolved_at is not null
      and t.resolved_at >= ${tzStart(from, tz)}
      and t.resolved_at < ${tzEnd(to, tz)}
      and t.title not like ${PRUEBA_LIKE}
      and t.kind in ('ticket', 'initiative')
    group by 1, 2, 3, 5, 6`);
  return rows.map((r) => ({ ...r, hour: Number(r.hour), n: Number(r.n) }));
}

async function prAggregate(db: Db, from: string, to: string, tz: string): Promise<PrAgg[]> {
  const rows = await q<PrAgg>(db, sql`
    select to_char(pr.merged_at at time zone ${tz}, 'YYYY-MM-DD') as day,
           extract(hour from pr.merged_at at time zone ${tz})::int as hour,
           p.slug,
           max(p.title) as project_title,
           count(*)::int as n
    from pull_requests pr
    join projects p on p.id = pr.project_id
    left join tasks t on t.id = pr.task_id
    where pr.state = 'merged'
      and pr.merged_at is not null
      and pr.merged_at >= ${tzStart(from, tz)}
      and pr.merged_at < ${tzEnd(to, tz)}
      and pr.title not like ${PRUEBA_LIKE}
      and (t.id is null or (t.title not like ${PRUEBA_LIKE} and t.status <> ${WONT}))
    group by 1, 2, 3`);
  return rows.map((r) => ({ ...r, hour: Number(r.hour), n: Number(r.n) }));
}

function foldTitles(tasks: TaskAgg[], prs: PrAgg[], known: Titles): Titles {
  const titles = new Map(known);
  for (const r of tasks) if (!titles.has(r.slug)) titles.set(r.slug, r.project_title);
  for (const r of prs) if (!titles.has(r.slug)) titles.set(r.slug, r.project_title);
  return titles;
}

function sumTasks(rows: TaskAgg[], pred: (r: TaskAgg) => boolean): number {
  let n = 0;
  for (const r of rows) if (pred(r)) n += r.n;
  return n;
}

function sumPrs(rows: PrAgg[], pred: (r: PrAgg) => boolean): number {
  let n = 0;
  for (const r of rows) if (pred(r)) n += r.n;
  return n;
}

function byProject(rows: TaskAgg[], pred: (r: TaskAgg) => boolean, titles: Titles): ProjectCount[] {
  const map = new Map<string, number>();
  for (const r of rows) {
    if (!pred(r)) continue;
    map.set(r.slug, (map.get(r.slug) ?? 0) + r.n);
  }
  return countsOf(map, titles);
}

function dayMap(rows: TaskAgg[], from: string, to: string): Map<string, TaskAgg[]> {
  const map = new Map<string, TaskAgg[]>();
  for (const r of rows) {
    if (r.day < from || r.day > to || !cosa(r)) continue;
    const list = map.get(r.day);
    if (list) list.push(r);
    else map.set(r.day, [r]);
  }
  return map;
}

function activeSet(tasks: TaskAgg[], prs: PrAgg[]): Set<string> {
  const set = new Set<string>();
  for (const r of tasks) if (cosa(r) && r.n > 0) set.add(r.day);
  for (const r of prs) if (r.n > 0) set.add(r.day);
  return set;
}

function monthBuckets(rows: TaskAgg[], year: number, titles: Titles): MonthBucket[] {
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  return Array.from({ length: 12 }, (_, i) => {
    const month = `${year}-${String(i + 1).padStart(2, "0")}`;
    const slice = rows.filter((r) => cosa(r) && r.day.startsWith(month) && r.day >= from && r.day <= to);
    const total = slice.reduce((a, r) => a + r.n, 0);
    return { month, label: (MONTHS[i] ?? "").toUpperCase(), total, by_project: byProject(slice, cosa, titles) };
  });
}

function bestDay(rows: TaskAgg[], from: string, to: string): { date: string; count: number } | null {
  const totals = new Map<string, number>();
  for (const r of rows) {
    if (!cosa(r) || r.day < from || r.day > to) continue;
    totals.set(r.day, (totals.get(r.day) ?? 0) + r.n);
  }
  let best: { date: string; count: number } | null = null;
  for (const [date, count] of totals) {
    if (!best || count > best.count || (count === best.count && date > best.date)) best = { date, count };
  }
  return best;
}

async function changesFor(db: Db, ids: string[]): Promise<Map<string, { change: string; doc: string | null }>> {
  const out = new Map<string, { change: string; doc: string | null }>();
  if (ids.length === 0) return out;
  const list = sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `);
  const [decisions, docs] = await Promise.all([
    q<{ task_id: string; line: string }>(db, sql`
      select distinct on (task_id) task_id, line
      from decisions
      where task_id in (${list}) and retired_at is null
      order by task_id, created_at desc`),
    q<{ task_id: string; markdown: string }>(db, sql`
      select distinct on (task_id) task_id, markdown
      from docs
      where task_id in (${list})
      order by task_id, updated_at desc`),
  ]);
  const decision = new Map(decisions.map((d) => [d.task_id, d.line]));
  const doc = new Map(docs.map((d) => [d.task_id, d.markdown]));
  for (const id of ids) {
    const markdown = doc.get(id) ?? null;
    const change = plainExcerpt(decision.get(id) || markdown || "");
    out.set(id, { change, doc: markdown });
  }
  return out;
}

async function imagesFor(db: Db, ids: string[]): Promise<Map<string, ProgressImage>> {
  const out = new Map<string, ProgressImage>();
  if (ids.length === 0) return out;
  const list = sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `);
  const rows = await q<{ task_id: string; url: string | null; attachments: string[] | null }>(db, sql`
    select task_id, url, attachments
    from results
    where task_id in (${list}) and kind = 'visual'
    order by created_at`);
  const links = new Map<string, string[]>();
  for (const r of rows) {
    const bag = links.get(r.task_id) ?? [];
    for (const a of r.attachments ?? []) bag.push(a);
    if (r.url) bag.push(r.url);
    links.set(r.task_id, bag);
  }
  for (const id of ids) out.set(id, pairImages(links.get(id) ?? []));
  return out;
}

async function prsFor(db: Db, ids: string[]): Promise<Map<string, ProgressPr[]>> {
  const out = new Map<string, ProgressPr[]>();
  if (ids.length === 0) return out;
  const list = sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `);
  const rows = await q<{ task_id: string; number: number; url: string; title: string }>(db, sql`
    select task_id, number, url, title
    from pull_requests
    where task_id in (${list}) and state = 'merged' and title not like ${PRUEBA_LIKE}
    order by number`);
  for (const r of rows) {
    const bag = out.get(r.task_id) ?? [];
    bag.push({ number: r.number, url: r.url, title: r.title });
    out.set(r.task_id, bag);
  }
  return out;
}

type ChildRow = { parent_id: string; id: string; key: string; title: string; summary: string; status: string };

async function childrenFor(db: Db, ids: string[]): Promise<Map<string, LogChild[]>> {
  const out = new Map<string, LogChild[]>();
  if (ids.length === 0) return out;
  const list = sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `);
  const kids = await q<ChildRow>(db, sql`
    select parent_id, id, key, title, summary, status
    from tasks
    where parent_id in (${list}) and kind = 'ticket' and title not like ${PRUEBA_LIKE} and status <> ${WONT}
    order by key`);
  const prs = await prsFor(db, kids.map((k) => k.id));
  for (const k of kids) {
    const pr = prs.get(k.id)?.[0] ?? null;
    const bag = out.get(k.parent_id) ?? [];
    bag.push({
      key: k.key,
      title: k.title,
      summary: k.summary,
      status: k.status,
      pr_number: pr?.number ?? null,
      pr_url: pr?.url ?? null,
    });
    out.set(k.parent_id, bag);
  }
  return out;
}

function childStats(children: LogChild[]): { child_done: number; child_total: number } {
  return { child_done: children.filter((c) => c.status === "Done").length, child_total: children.length };
}

type WinRow = {
  id: string;
  key: string;
  kind: "ticket" | "initiative";
  title: string;
  summary: string;
  work_type: string | null;
  resolved_at: Date | string;
  slug: string;
  project_title: string;
  child_done: number;
};

// Initiatives outrank tickets. Among initiatives, the one that closed the most tickets wins.
// The pick is one indexed read, not a score joined across every PR and result of the year.
async function biggestWin(db: Db, from: string, to: string, tz: string): Promise<BiggestWin | null> {
  const bounds = sql`t.title not like ${PRUEBA_LIKE}
        and t.resolved_at >= ${tzStart(from, tz)}
        and t.resolved_at < ${tzEnd(to, tz)}`;
  const [initiative] = await q<WinRow>(db, sql`
    select t.id, t.key, t.kind, t.title, t.summary, t.work_type, t.resolved_at,
           p.slug, p.title as project_title,
           count(ch.id) filter (where ch.status = 'Done')::int as child_done
    from tasks t
    join projects p on p.id = t.project_id
    left join tasks ch on ch.parent_id = t.id and ch.kind = 'ticket' and ch.title not like ${PRUEBA_LIKE} and ch.status <> ${WONT}
    where t.status = 'Done' and t.kind = 'initiative' and ${bounds}
    group by t.id, p.id
    order by count(ch.id) filter (where ch.status = 'Done') desc, t.resolved_at desc
    limit 1`);
  const [ticket] = initiative
    ? []
    : await q<WinRow>(db, sql`
        select t.id, t.key, t.kind, t.title, t.summary, t.work_type, t.resolved_at,
               p.slug, p.title as project_title, 0::int as child_done
        from tasks t
        join projects p on p.id = t.project_id
        where t.status = 'Done' and t.kind = 'ticket' and ${bounds}
        order by (select count(*) from results r where r.task_id = t.id and r.kind = 'visual') desc, t.resolved_at desc
        limit 1`);
  const row = initiative ?? ticket;
  if (!row) return null;
  const [changes, images, prs, children] = await Promise.all([
    changesFor(db, row.summary.trim() ? [] : [row.id]),
    imagesFor(db, [row.id]),
    prsFor(db, [row.id]),
    row.kind === "initiative" ? childrenFor(db, [row.id]) : Promise.resolve(new Map<string, LogChild[]>()),
  ]);
  const at = new Date(row.resolved_at).toISOString();
  const type = typeOf(row.kind, row.work_type);
  const kids = children.get(row.id) ?? [];
  const ownPrs = prs.get(row.id) ?? [];
  const childPrs = kids.flatMap((c) => (c.pr_number && c.pr_url ? [{ number: c.pr_number, url: c.pr_url, title: c.title }] : []));
  const seen = new Set(ownPrs.map((p) => p.number));
  const merged = [...ownPrs, ...childPrs.filter((p) => !seen.has(p.number))];
  return {
    project: row.slug,
    project_title: row.project_title,
    key: row.key,
    kind: row.kind,
    type,
    type_label: typeLabel(type),
    title: row.title,
    change: row.summary.trim() || changes.get(row.id)?.change || "",
    at,
    day: dayInTz(new Date(row.resolved_at), tz),
    prs: merged,
    tickets: row.kind === "initiative" ? (kids.length ? childStats(kids).child_done : row.child_done) : 1,
    images: images.get(row.id) ?? pairImages([]),
  };
}

async function highlights(db: Db, from: string, to: string, tz: string): Promise<YearBlock["highlights"]> {
  const rows = await q<{ id: string; slug: string; key: string; title: string; summary: string; day: string }>(db, sql`
    select id, slug, key, title, summary, day from (
      select t.id, p.slug, t.key, t.title, t.summary,
             to_char(t.resolved_at at time zone ${tz}, 'YYYY-MM-DD') as day,
             row_number() over (partition by p.slug order by (t.kind = 'initiative') desc, t.resolved_at desc) as rn
      from tasks t
      join projects p on p.id = t.project_id
      where t.status = 'Done'
        and t.kind in ('ticket', 'initiative')
        and t.title not like ${PRUEBA_LIKE}
        and t.resolved_at >= ${tzStart(from, tz)}
        and t.resolved_at < ${tzEnd(to, tz)}
    ) s where rn <= 4`);
  const blank = rows.filter((r) => !r.summary.trim()).map((r) => r.id);
  const changes = await changesFor(db, blank);
  return rows.map((r) => ({
    project: r.slug,
    key: r.key,
    title: r.title,
    change: r.summary.trim() || changes.get(r.id)?.change || "",
    day: r.day,
  }));
}

function buildSummary(
  query: { range: Range; date: string; today: string; tz: string },
  tasks: TaskAgg[],
  prs: PrAgg[],
  titles: Titles,
  win: BiggestWin | null,
  yearHighlights: YearBlock["highlights"],
): ProgressSummary {
  const { range, date, today, tz } = query;
  const { from, to } = spanOf(range, date);
  const prev = previousSpan(range, from);
  const year = yearRange(date);
  const inRange = (r: { day: string }) => r.day >= from && r.day <= to;
  const inPrev = (r: { day: string }) => r.day >= prev.from && r.day <= prev.to;
  const inYear = (r: { day: string }) => r.day >= year.from && r.day <= year.to;
  const finished = sumTasks(tasks, (r) => cosa(r) && inRange(r));
  const previousFinished = sumTasks(tasks, (r) => cosa(r) && inPrev(r));
  const by = byProject(tasks, (r) => cosa(r) && inRange(r), titles);
  const active = activeSet(tasks, prs);
  const streak = streakOf(active, today, year.year);
  const week = weekRange(date);
  const grouped = dayMap(tasks, from, to);
  const buckets: DayBucket[] = (range === "year" ? [] : eachDay(from, to)).map((d) => {
    const slice = grouped.get(d) ?? [];
    const total = slice.reduce((a, r) => a + r.n, 0);
    return {
      date: d,
      weekday: cap(WEEK_LONG[weekdayIndex(d)] ?? ""),
      label: WEEK_SHORT[weekdayIndex(d)] ?? "",
      total,
      by_project: byProject(slice, cosa, titles),
    };
  });
  const hours: HourBucket[] = range === "day"
    ? Array.from({ length: 24 }, (_, hour) => {
        const slice = tasks.filter((r) => cosa(r) && r.day === date && r.hour === hour);
        return { hour, total: slice.reduce((a, r) => a + r.n, 0), by_project: byProject(slice, cosa, titles) };
      })
    : [];
  const heatFrom = addDays(weekRange(date).from, -(HEATMAP_WEEKS - 1) * 7);
  const heatTo = week.to;
  const heatDays = dayMap(tasks, heatFrom, heatTo);
  const heatmap: HeatCell[] = eachDay(heatFrom, heatTo).map((d) => {
    const slice = heatDays.get(d) ?? [];
    const map = new Map<string, number>();
    for (const r of slice) map.set(r.slug, (map.get(r.slug) ?? 0) + r.n);
    return { date: d, count: slice.reduce((a, r) => a + r.n, 0), slug: dominant(map) };
  });
  const yearRows = tasks.filter(inYear);
  const yearProjects = byProject(yearRows, cosa, titles);
  const yearActive = [...active].filter((d) => d >= year.from && d <= year.to).length;
  const peak = bestDay(tasks, year.from, year.to);
  return {
    range,
    timezone: tz,
    date,
    today,
    from,
    to,
    label: rangeLabel(range, from, to, today),
    finished,
    projects_touched: by.length,
    bugs: sumTasks(tasks, (r) => r.kind === "ticket" && r.work_type === "bug" && inRange(r)),
    prs: sumPrs(prs, inRange),
    initiatives: sumTasks(tasks, (r) => r.kind === "initiative" && inRange(r)),
    tickets: sumTasks(tasks, (r) => r.kind === "ticket" && inRange(r)),
    previous_finished: previousFinished,
    delta_pct: deltaPct(finished, previousFinished),
    streak: {
      current: streak.current,
      best_year: streak.bestYear,
      is_best: streak.current > 0 && streak.current === streak.bestYear,
      week: eachDay(week.from, week.to).map((d) => ({
        date: d,
        label: WEEK_SHORT[weekdayIndex(d)] ?? "",
        active: active.has(d),
        upcoming: d > today,
      })),
    },
    buckets,
    hours,
    by_project: by,
    heatmap,
    year: {
      year: year.year,
      from: year.from,
      to: year.to,
      finished: sumTasks(yearRows, cosa),
      active_days: yearActive,
      initiatives: sumTasks(yearRows, (r) => r.kind === "initiative"),
      prs: sumPrs(prs, inYear),
      bugs: sumTasks(yearRows, (r) => r.kind === "ticket" && r.work_type === "bug"),
      best_streak: streak.bestYear,
      best_day: peak,
      project_of_year: yearProjects.slice().sort((a, b) => b.count - a.count || projectSort(a.slug, b.slug))[0] ?? null,
      by_project: [...titles.entries()]
        .map(([slug, title]) => ({ slug, title, count: yearProjects.find((p) => p.slug === slug)?.count ?? 0 }))
        .sort((a, b) => projectSort(a.slug, b.slug)),
      months: monthBuckets(tasks, year.year, titles),
      highlights: yearHighlights,
    },
    biggest_win: win,
  };
}

export async function progressSummary(db: Db, input: { range?: string; date?: string }): Promise<ProgressSummary> {
  const tz = progressTz();
  const today = dayInTz(new Date(), tz);
  const range = parseRange(input.range ?? "");
  const date = input.date ? assertDay(input.date, "date") : today;
  const stamp = await watermark(db);
  return cached(`summary|${tz}|${range}|${date}|${stamp}`, async () => {
    const year = yearRange(date);
    const heatFrom = addDays(weekRange(date).from, -(HEATMAP_WEEKS - 1) * 7);
    const lookback = addDays(today, -400);
    const from = [heatFrom, lookback, year.from, previousSpan(range, spanOf(range, date).from).from].sort()[0]!;
    const to = [spanOf(range, date).to, year.to, addDays(weekRange(date).from, 6), today].sort().at(-1)!;
    const [tasks, prs, known, win, marks] = await Promise.all([
      taskAggregate(db, from, to, tz),
      prAggregate(db, from, to, tz),
      loadProjects(db),
      biggestWin(db, spanOf(range, date).from, spanOf(range, date).to, tz),
      highlights(db, year.from, year.to, tz),
    ]);
    return buildSummary({ range, date, today, tz }, tasks, prs, foldTitles(tasks, prs, known), win, marks);
  });
}

function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

function parseType(raw: string | undefined): ProgressType | null {
  if (!raw) return null;
  if ((PROGRESS_TYPES as readonly string[]).includes(raw)) return raw as ProgressType;
  throw new ToolError("INVALID_FILTER", { field: "type", hint: PROGRESS_TYPES.join(", ") });
}

type LogFilters = { from: string; to: string; project: string | null; type: ProgressType | null; q: string | null; cursor: string | null };

function parseLog(input: { from?: string; to?: string; project?: string; type?: string; q?: string; cursor?: string }): LogFilters {
  const tz = progressTz();
  const today = dayInTz(new Date(), tz);
  const week = weekRange(today);
  const from = input.from ? assertDay(input.from, "from") : week.from;
  const to = input.to ? assertDay(input.to, "to") : week.to;
  if (from > to) throw new ToolError("INVALID_FILTER", { field: "from", hint: "from is after to" });
  if (eachDay(from, to).length > 400) throw new ToolError("INVALID_FILTER", { field: "from", hint: "at most 400 days" });
  const q = input.q?.trim() ?? "";
  if (q.length > 80) throw new ToolError("INVALID_FILTER", { field: "q", hint: "at most 80 characters" });
  return {
    from,
    to,
    project: input.project?.trim() || null,
    type: parseType(input.type),
    q: q || null,
    cursor: input.cursor ? assertDay(input.cursor, "cursor") : null,
  };
}

function taskTypeSql(type: ProgressType | null): SQL {
  if (!type || type === "pr") return type === "pr" ? sql`false` : sql`true`;
  if (type === "initiative") return sql`t.kind = 'initiative'`;
  if (type === "idea") return sql`t.kind = 'idea'`;
  return sql`t.kind = 'ticket' and t.work_type = ${type}`;
}

function searchSql(q: string | null, digits: string | null): SQL {
  if (!q) return sql`true`;
  const like = likePattern(q);
  const prMatch = digits
    ? sql`or exists (select 1 from pull_requests pr where pr.task_id = t.id and pr.state = 'merged' and (pr.title ilike ${like} escape '\\' or pr.number::text = ${digits}))`
    : sql`or exists (select 1 from pull_requests pr where pr.task_id = t.id and pr.state = 'merged' and pr.title ilike ${like} escape '\\')`;
  return sql`(
    t.title ilike ${like} escape '\\'
    or t.summary ilike ${like} escape '\\'
    or t.key ilike ${like} escape '\\'
    or p.slug ilike ${like} escape '\\'
    or p.title ilike ${like} escape '\\'
    ${prMatch}
  )`;
}

function windowEnd(filters: LogFilters): string {
  if (!filters.cursor || filters.cursor > filters.to) return filters.to;
  const dayBefore = addDays(filters.cursor, -1);
  return dayBefore < filters.from ? addDays(filters.from, -1) : dayBefore;
}

type TaskLogRow = {
  id: string;
  key: string;
  kind: "ticket" | "initiative" | "idea";
  work_type: string | null;
  title: string;
  summary: string;
  resolved_at: Date | string;
  day: string;
  time: string;
  slug: string;
  project_title: string;
};

async function logTasks(db: Db, filters: LogFilters, end: string, tz: string): Promise<TaskLogRow[]> {
  if (end < filters.from) return [];
  return q<TaskLogRow>(db, sql`
    select t.id, t.key, t.kind, t.work_type, t.title, t.summary, t.resolved_at,
           to_char(t.resolved_at at time zone ${tz}, 'YYYY-MM-DD') as day,
           to_char(t.resolved_at at time zone ${tz}, 'HH24:MI') as time,
           p.slug, p.title as project_title
    from tasks t
    join projects p on p.id = t.project_id
    where t.status = 'Done'
      and t.resolved_at is not null
      and t.resolved_at >= ${tzStart(filters.from, tz)}
      and t.resolved_at < ${tzEnd(end, tz)}
      and t.title not like ${PRUEBA_LIKE}
      and t.kind in ('ticket', 'initiative', 'idea')
      and (${filters.project}::text is null or p.slug = ${filters.project})
      and ${taskTypeSql(filters.type)}
      and ${searchSql(filters.q, filters.q?.replace(/\D/g, "") || null)}`);
}

type PrLogRow = {
  number: number;
  url: string;
  title: string;
  merged_at: Date | string;
  day: string;
  time: string;
  slug: string;
  project_title: string;
};

async function logPrs(db: Db, filters: LogFilters, end: string, tz: string): Promise<PrLogRow[]> {
  if (filters.type && filters.type !== "pr") return [];
  if (end < filters.from) return [];
  const like = filters.q ? likePattern(filters.q) : null;
  const digits = filters.q?.replace(/\D/g, "") || null;
  return q<PrLogRow>(db, sql`
    select pr.number, pr.url, pr.title, pr.merged_at,
           to_char(pr.merged_at at time zone ${tz}, 'YYYY-MM-DD') as day,
           to_char(pr.merged_at at time zone ${tz}, 'HH24:MI') as time,
           p.slug, p.title as project_title
    from pull_requests pr
    join projects p on p.id = pr.project_id
    left join tasks t on t.id = pr.task_id
    where pr.state = 'merged'
      and pr.merged_at is not null
      and pr.merged_at >= ${tzStart(filters.from, tz)}
      and pr.merged_at < ${tzEnd(end, tz)}
      and pr.title not like ${PRUEBA_LIKE}
      and (t.id is null or (t.status is distinct from 'Done' and t.status <> ${WONT} and t.title not like ${PRUEBA_LIKE}))
      and (${filters.project}::text is null or p.slug = ${filters.project})
      and (${like}::text is null or pr.title ilike ${like} escape '\\' or p.slug ilike ${like} escape '\\' or p.title ilike ${like} escape '\\' or (${digits}::text is not null and pr.number::text = ${digits}))`);
}

async function countLog(db: Db, filters: LogFilters, tz: string): Promise<{ counts: Record<string, number>; projects: ProjectCount[] }> {
  const counts: Record<string, number> = { all: 0 };
  for (const t of PROGRESS_TYPES) counts[t] = 0;
  const projectMap = new Map<string, { title: string; count: number }>();
  const bump = (type: string, slug: string, title: string, n: number) => {
    counts[type] = (counts[type] ?? 0) + n;
    counts.all = (counts.all ?? 0) + n;
    const cur = projectMap.get(slug) ?? { title, count: 0 };
    cur.count += n;
    projectMap.set(slug, cur);
  };
  const open: LogFilters = { ...filters, type: null, cursor: null };
  const [tasks, prs] = await Promise.all([
    q<{ kind: string; work_type: string | null; slug: string; project_title: string; n: number }>(db, sql`
      select t.kind, t.work_type, p.slug, max(p.title) as project_title, count(*)::int as n
      from tasks t
      join projects p on p.id = t.project_id
      where t.status = 'Done'
        and t.resolved_at is not null
        and t.resolved_at >= ${tzStart(filters.from, tz)}
        and t.resolved_at < ${tzEnd(filters.to, tz)}
        and t.title not like ${PRUEBA_LIKE}
        and t.kind in ('ticket', 'initiative', 'idea')
        and (${filters.project}::text is null or p.slug = ${filters.project})
        and ${searchSql(filters.q, filters.q?.replace(/\D/g, "") || null)}
      group by 1, 2, 3`),
    logPrs(db, open, filters.to, tz),
  ]);
  for (const r of tasks) bump(typeOf(r.kind, r.work_type), r.slug, r.project_title, r.n);
  for (const r of prs) bump("pr", r.slug, r.project_title, 1);
  const projects = [...projectMap.entries()]
    .map(([slug, v]) => ({ slug, title: v.title, count: v.count }))
    .sort((a, b) => projectSort(a.slug, b.slug));
  return { counts, projects };
}

export async function progressLog(db: Db, input: { from?: string; to?: string; project?: string; type?: string; q?: string; cursor?: string }): Promise<ProgressLog> {
  const tz = progressTz();
  const filters = parseLog(input);
  const stamp = await watermark(db);
  const key = `log|${tz}|${JSON.stringify(filters)}|${stamp}`;
  return cached(key, async () => {
    const end = windowEnd(filters);
    const [taskRows, prRows, totals] = await Promise.all([
      logTasks(db, filters, end, tz),
      logPrs(db, filters, end, tz),
      countLog(db, filters, tz),
    ]);
    const days = new Set<string>();
    for (const r of taskRows) days.add(r.day);
    for (const r of prRows) days.add(r.day);
    let ordered = [...days].sort((a, b) => (a < b ? 1 : -1));
    const span = eachDay(filters.from, filters.to).length;
    let next: string | null = null;
    if (span > LOG_FULL_SPAN_DAYS && ordered.length > LOG_PAGE_DAYS) {
      ordered = ordered.slice(0, LOG_PAGE_DAYS);
      next = ordered[ordered.length - 1] ?? null;
    }
    const keep = new Set(ordered);
    const keptTasks = taskRows.filter((r) => keep.has(r.day));
    const ids = keptTasks.map((r) => r.id);
    const initiativeIds = keptTasks.filter((r) => r.kind === "initiative").map((r) => r.id);
    const blank = keptTasks.filter((r) => !r.summary.trim()).map((r) => r.id);
    const [changes, images, prs, children] = await Promise.all([
      changesFor(db, blank),
      imagesFor(db, ids),
      prsFor(db, ids),
      childrenFor(db, initiativeIds),
    ]);
    const entries: LogEntry[] = [];
    for (const r of keptTasks) {
      const type = typeOf(r.kind, r.work_type);
      const kids = children.get(r.id) ?? [];
      const stats = childStats(kids);
      const own = prs.get(r.id) ?? [];
      const seen = new Set(own.map((p) => p.number));
      const extra = kids.flatMap((c) => (c.pr_number && c.pr_url && !seen.has(c.pr_number) ? [{ number: c.pr_number, url: c.pr_url, title: c.title }] : []));
      entries.push({
        id: r.id,
        day: r.day,
        time: r.time,
        at: new Date(r.resolved_at).toISOString(),
        project: r.slug,
        project_title: r.project_title,
        key: r.key,
        kind: r.kind,
        type,
        type_label: typeLabel(type),
        title: r.title,
        summary: r.summary,
        change: r.summary.trim() || changes.get(r.id)?.change || "",
        prs: [...own, ...extra],
        images: images.get(r.id) ?? pairImages([]),
        children: kids,
        ...stats,
      });
    }
    for (const r of prRows) {
      if (!keep.has(r.day)) continue;
      entries.push({
        id: `pr:${r.slug}:${r.number}`,
        day: r.day,
        time: r.time,
        at: new Date(r.merged_at).toISOString(),
        project: r.slug,
        project_title: r.project_title,
        key: null,
        kind: "pr",
        type: "pr",
        type_label: typeLabel("pr"),
        title: r.title,
        summary: "",
        change: "",
        prs: [{ number: r.number, url: r.url, title: r.title }],
        images: pairImages([]),
        children: [],
        child_done: 0,
        child_total: 0,
      });
    }
    const byDay = new Map<string, LogEntry[]>();
    for (const e of entries) {
      const bag = byDay.get(e.day) ?? [];
      bag.push(e);
      byDay.set(e.day, bag);
    }
    const dayTotals = ordered.map((d) => ({ date: d, total: (byDay.get(d) ?? []).filter((e) => e.kind !== "pr" && e.kind !== "idea").length }));
    const peak = dayTotals.reduce((m, d) => Math.max(m, d.total), 0);
    return {
      from: filters.from,
      to: filters.to,
      timezone: tz,
      counts: totals.counts,
      projects: totals.projects,
      days: ordered.map((d) => {
        const list = (byDay.get(d) ?? []).slice().sort((a, b) => (a.at < b.at ? 1 : -1));
        const map = new Map<string, { title: string; count: number }>();
        for (const e of list) {
          if (e.kind === "pr" || e.kind === "idea") continue;
          const cur = map.get(e.project) ?? { title: e.project_title, count: 0 };
          cur.count += 1;
          map.set(e.project, cur);
        }
        const total = [...map.values()].reduce((a, v) => a + v.count, 0);
        return {
          date: d,
          weekday: cap(WEEK_LONG[weekdayIndex(d)] ?? ""),
          total,
          best: peak > 0 && total === peak,
          by_project: [...map.entries()].map(([slug, v]) => ({ slug, title: v.title, count: v.count })).sort((a, b) => projectSort(a.slug, b.slug)),
          entries: list,
        };
      }),
      next_cursor: next,
    };
  });
}

export async function progressItem(db: Db, project: string, key: string): Promise<ProgressItem> {
  const tz = progressTz();
  const [row] = await q<{
    id: string;
    key: string;
    kind: "ticket" | "initiative" | "idea";
    work_type: string | null;
    title: string;
    summary: string;
    status: string;
    resolved_at: Date | string | null;
    created_at: Date | string;
    slug: string;
    project_title: string;
    parent_key: string | null;
    parent_title: string | null;
  }>(db, sql`
    select t.id, t.key, t.kind, t.work_type, t.title, t.summary, t.status, t.resolved_at, t.created_at,
           p.slug, p.title as project_title, parent.key as parent_key, parent.title as parent_title
    from tasks t
    join projects p on p.id = t.project_id
    left join tasks parent on parent.id = t.parent_id
    where p.slug = ${project} and t.key = ${key}
    limit 1`);
  if (!row || isPruebaTitle(row.title) || row.status === WONT) {
    if (!row) {
      const known = await q<{ n: number }>(db, sql`select count(*)::int as n from projects where slug = ${project}`);
      if (!known[0]?.n) throw new ToolError("PROJECT_NOT_FOUND");
    }
    throw new ToolError("TASK_NOT_FOUND");
  }
  const [changes, images, prs, children, events] = await Promise.all([
    changesFor(db, [row.id]),
    imagesFor(db, [row.id]),
    prsFor(db, [row.id]),
    row.kind === "initiative" ? childrenFor(db, [row.id]) : Promise.resolve(new Map<string, LogChild[]>()),
    q<{ type: string; payload: Record<string, unknown>; created_at: Date | string }>(db, sql`
      select type, payload, created_at
      from events
      where task_id = ${row.id}::uuid and type in ('task.created', 'task.status', 'note')
      order by id
      limit 16`),
  ]);
  const kids = children.get(row.id) ?? [];
  const stats = childStats(kids);
  const at = row.resolved_at ? new Date(row.resolved_at) : null;
  const created = new Date(row.created_at);
  const type = typeOf(row.kind, row.work_type);
  const doc = changes.get(row.id)?.doc ?? null;
  const timeline = events.map((e) => {
    const when = new Date(e.created_at);
    const to = typeof e.payload.to === "string" ? e.payload.to : "";
    const text = typeof e.payload.text === "string" ? e.payload.text : typeof e.payload.note === "string" ? e.payload.note : "";
    const label = e.type === "task.created" ? "Creada" : e.type === "note" ? "Nota" : STATUS_LABEL[to] ?? (to || e.type);
    const body = e.type === "task.created" ? row.title : e.type === "note" ? text : to ? `Pasó a ${STATUS_LABEL[to] ?? to}` : "";
    return { day: dayInTz(when, tz), time: timeInTz(when, tz), label, text: body };
  });
  if (timeline.length === 0) {
    timeline.push({ day: dayInTz(created, tz), time: timeInTz(created, tz), label: "Creada", text: row.title });
    if (at) timeline.push({ day: dayInTz(at, tz), time: timeInTz(at, tz), label: "Cerrada", text: "Quedó en Done" });
  }
  const createdDay = dayInTz(created, tz);
  const closedDay = at ? dayInTz(at, tz) : null;
  return {
    project: row.slug,
    project_title: row.project_title,
    key: row.key,
    kind: row.kind,
    type,
    type_label: typeLabel(type),
    title: row.title,
    summary: row.summary,
    change: row.summary.trim() || changes.get(row.id)?.change || "",
    doc: doc ? doc.slice(0, 12_000) : null,
    status: row.status,
    day: closedDay,
    time: at ? timeInTz(at, tz) : null,
    at: at ? at.toISOString() : null,
    created_day: createdDay,
    parent: row.parent_key ? { key: row.parent_key, title: row.parent_title ?? row.parent_key } : null,
    prs: prs.get(row.id) ?? [],
    images: images.get(row.id) ?? pairImages([]),
    children: kids,
    ...stats,
    span_days: closedDay ? Math.round((Date.parse(`${closedDay}T00:00:00Z`) - Date.parse(`${createdDay}T00:00:00Z`)) / 86_400_000) + 1 : null,
    timeline,
  };
}

function timeInTz(date: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const hour = parts.find((p) => p.type === "hour")?.value ?? "00";
  const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
  return `${hour === "24" ? "00" : hour}:${minute}`;
}
