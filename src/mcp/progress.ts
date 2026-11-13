// Mi progreso (PLA-I19). Read-only totals for the screen: what reached a final Done or Merged,
// bucketed by calendar day in PLANIA_TZ (America/Mexico_City). A reopen clears resolved_at, so a
// ticket that was Done, reopened and Done again counts once, on the day it is Done now.
// Titles containing [PRUEBA] and Won't do never count. Ideas stay in the bitácora only.
// The year path reads the closes and merges of the span once, groups them per day in TypeScript and
// caches the summary. It does not scan events.
import type { Db } from "../db/client.js";
import type { Task } from "../db/schema.js";
import { readerOf } from "../store/pg.js";
import { gte, notNull, type Reader, type Row } from "../store/types.js";
import { ToolError } from "./errors.js";

export type Range = "day" | "week" | "year";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const PRUEBA = "[PRUEBA]";
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

// One formatter per zone: building one costs more than formatting, and the trend formats every close.
const dayFormats = new Map<string, Intl.DateTimeFormat>();
export function dayInTz(date: Date, tz = progressTz()): string {
  let format = dayFormats.get(tz);
  if (!format) {
    format = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
    dayFormats.set(tz, format);
  }
  return format.format(date);
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

const DAY_MS = 86_400_000;
const zoneFormats = new Map<string, Intl.DateTimeFormat>();
const zoneOffsets = new Map<string, number | null>();

// The zone's wall clock at an instant, to the second, written as if it were UTC.
function wallClock(at: number, tz: string): number {
  let format = zoneFormats.get(tz);
  if (!format) {
    const parts = { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" } as const;
    format = new Intl.DateTimeFormat("en-CA", { timeZone: tz, hourCycle: "h23", ...parts });
    zoneFormats.set(tz, format);
  }
  const p: Record<string, string> = {};
  for (const part of format.formatToParts(at)) p[part.type] = part.value;
  return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour) % 24, Number(p.minute), Number(p.second));
}

// The zone's offset from UTC through the UTC day holding `at`, or null when it differs between the day's first
// and last second (a clock change falls inside that day). Formatting every close through Intl is too slow for
// a year of them; a zone's offset holds for months, so one reading per day serves every close of that day.
function dayOffset(at: number, tz: string): number | null {
  const start = Math.floor(at / DAY_MS) * DAY_MS;
  const key = `${tz}|${start}`;
  let offset = zoneOffsets.get(key);
  if (offset === undefined) {
    const last = start + DAY_MS - 1000;
    const first = wallClock(start, tz) - start;
    offset = first === wallClock(last, tz) - last ? first : null;
    zoneOffsets.set(key, offset);
  }
  return offset;
}

// Calendar day, hour and HH:MM of an instant in tz, as to_char(... at time zone tz) gave them.
type Clock = { day: string; hour: number; time: string };
function localClock(date: Date, tz: string): Clock {
  const at = date.getTime();
  const offset = dayOffset(at, tz);
  const wall = offset === null ? wallClock(at, tz) : at + offset;
  const text = new Date(wall).toISOString();
  return { day: text.slice(0, 10), hour: Number(text.slice(11, 13)), time: text.slice(11, 16) };
}

// The earliest instant that can fall on `day` in any zone (none is a whole day away from UTC). A read starts
// there and each row is then kept by its calendar day in the zone, which is what the bounds from local
// midnight to the next local midnight selected in SQL.
function dayFloor(day: string): Date {
  return new Date(Date.parse(`${day}T00:00:00Z`) - DAY_MS);
}

const stampOf = (at: Date | null | undefined): string => (at ? at.toISOString() : "");

// The cache key's view of the data: counts and the newest timestamps, so any close, reopen, merge, new
// evidence, doc or decision makes a new key.
async function watermark(r: Reader): Promise<string> {
  const newest = { limit: 1 };
  const [tasks, [resolved], [updated], prs, [merged], [result], [doc], [decision]] = await Promise.all([
    r.count("tasks"),
    r.find("tasks", { resolvedAt: notNull() }, { ...newest, orderBy: [{ column: "resolvedAt", desc: true }] }),
    r.find("tasks", {}, { ...newest, orderBy: [{ column: "updatedAt", desc: true }] }),
    r.count("pullRequests"),
    r.find("pullRequests", { mergedAt: notNull() }, { ...newest, orderBy: [{ column: "mergedAt", desc: true }] }),
    r.find("results", {}, { ...newest, orderBy: [{ column: "createdAt", desc: true }] }),
    r.find("docs", {}, { ...newest, orderBy: [{ column: "updatedAt", desc: true }] }),
    r.find("decisions", {}, { ...newest, orderBy: [{ column: "createdAt", desc: true }] }),
  ]);
  return [
    tasks,
    stampOf(resolved?.resolvedAt),
    stampOf(updated?.updatedAt),
    prs,
    stampOf(merged?.mergedAt),
    stampOf(result?.createdAt),
    stampOf(doc?.updatedAt),
    stampOf(decision?.createdAt),
  ].join("|");
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

type Place = { slug: string; title: string };
// Projects by id. The store sorts them by slug, so the map keeps the database's slug order.
type Places = Map<string, Place>;

async function loadPlaces(r: Reader): Promise<Places> {
  const rows = await r.find("projects", {}, { orderBy: [{ column: "slug" }] });
  return new Map(rows.map((p) => [p.id, { slug: p.slug, title: p.title }]));
}

function titlesOf(places: Places): Titles {
  return new Map([...places.values()].map((p) => [p.slug, p.title]));
}

// A Done task with the project it belongs to and when it closed in the zone.
type Closed = Clock & { t: Task; place: Place };

// Done tasks of these kinds that closed on a calendar day from `from` to `to` in tz, [PRUEBA] titles left out
// (the LIKE pattern had no wildcard but its ends, so it was a case-sensitive substring test). The projects
// arrive as a promise so their read runs alongside this one.
async function closedTasks(r: Reader, projects: Promise<Places>, kinds: string[], from: string, to: string, tz: string): Promise<Closed[]> {
  const rows = await r.find("tasks", { status: "Done", kind: kinds, resolvedAt: gte(dayFloor(from)) });
  const places = await projects;
  const out: Closed[] = [];
  for (const t of rows) {
    const place = places.get(t.projectId);
    if (!place || !t.resolvedAt || isPruebaTitle(t.title)) continue;
    const clock = localClock(t.resolvedAt, tz);
    if (clock.day < from || clock.day > to) continue;
    out.push({ ...clock, t, place });
  }
  return out;
}

// A merged pull request with its project, the task it is linked to (if any) and when it merged in the zone.
type Merged = Clock & { pr: Row<"pullRequests">; place: Place; task: Task | undefined };

// Pull requests merged on a calendar day from `from` to `to` in tz, [PRUEBA] titles left out.
async function mergedPrs(r: Reader, projects: Promise<Places>, from: string, to: string, tz: string): Promise<Merged[]> {
  const rows = (await r.find("pullRequests", { state: "merged", mergedAt: gte(dayFloor(from)) })).filter((pr) => !isPruebaTitle(pr.title));
  const taskIds = [...new Set(rows.flatMap((pr) => (pr.taskId ? [pr.taskId] : [])))];
  const tasks = new Map((taskIds.length ? await r.find("tasks", { id: taskIds }) : []).map((t) => [t.id, t]));
  const places = await projects;
  const out: Merged[] = [];
  for (const pr of rows) {
    const place = places.get(pr.projectId);
    if (!place || !pr.mergedAt) continue;
    const clock = localClock(pr.mergedAt, tz);
    if (clock.day < from || clock.day > to) continue;
    out.push({ ...clock, pr, place, task: pr.taskId ? tasks.get(pr.taskId) : undefined });
  }
  return out;
}

// Closes per day, hour, project, kind and work type (a missing work type counts as "").
function taskAggregate(closed: Closed[]): TaskAgg[] {
  const groups = new Map<string, TaskAgg>();
  for (const c of closed) {
    const workType = c.t.workType ?? "";
    const key = [c.day, c.hour, c.place.slug, c.t.kind, workType].join("\u0000");
    const group = groups.get(key);
    if (group) group.n += 1;
    else groups.set(key, { day: c.day, hour: c.hour, slug: c.place.slug, project_title: c.place.title, kind: c.t.kind, work_type: workType, n: 1 });
  }
  return [...groups.values()];
}

// Merges per day, hour and project. A PR linked to a [PRUEBA] or Won't do task does not count.
function prAggregate(merged: Merged[]): PrAgg[] {
  const groups = new Map<string, PrAgg>();
  for (const m of merged) {
    if (m.task && (isPruebaTitle(m.task.title) || m.task.status === WONT)) continue;
    const key = [m.day, m.hour, m.place.slug].join("\u0000");
    const group = groups.get(key);
    if (group) group.n += 1;
    else groups.set(key, { day: m.day, hour: m.hour, slug: m.place.slug, project_title: m.place.title, n: 1 });
  }
  return [...groups.values()];
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

// The first row per task of rows already sorted newest first.
function firstPerTask<T extends { taskId: string | null }, V>(rows: T[], value: (row: T) => V): Map<string, V> {
  const out = new Map<string, V>();
  for (const row of rows) if (row.taskId && !out.has(row.taskId)) out.set(row.taskId, value(row));
  return out;
}

async function changesFor(r: Reader, ids: string[]): Promise<Map<string, { change: string; doc: string | null }>> {
  const out = new Map<string, { change: string; doc: string | null }>();
  if (ids.length === 0) return out;
  // The newest decision still standing and the newest doc of each task.
  const [decisions, docs] = await Promise.all([
    r.find("decisions", { taskId: ids, retiredAt: null }, { orderBy: [{ column: "createdAt", desc: true }] }),
    r.find("docs", { taskId: ids }, { orderBy: [{ column: "updatedAt", desc: true }] }),
  ]);
  const decision = firstPerTask(decisions, (d) => d.line);
  const doc = firstPerTask(docs, (d) => d.markdown);
  for (const id of ids) {
    const markdown = doc.get(id) ?? null;
    const change = plainExcerpt(decision.get(id) || markdown || "");
    out.set(id, { change, doc: markdown });
  }
  return out;
}

async function imagesFor(r: Reader, ids: string[]): Promise<Map<string, ProgressImage>> {
  const out = new Map<string, ProgressImage>();
  if (ids.length === 0) return out;
  const rows = await r.find("results", { taskId: ids, kind: "visual" }, { orderBy: [{ column: "createdAt" }] });
  const links = new Map<string, string[]>();
  for (const row of rows) {
    const bag = links.get(row.taskId) ?? [];
    for (const a of row.attachments ?? []) bag.push(a);
    if (row.url) bag.push(row.url);
    links.set(row.taskId, bag);
  }
  for (const id of ids) out.set(id, pairImages(links.get(id) ?? []));
  return out;
}

async function prsFor(r: Reader, ids: string[]): Promise<Map<string, ProgressPr[]>> {
  const out = new Map<string, ProgressPr[]>();
  if (ids.length === 0) return out;
  const rows = await r.find("pullRequests", { taskId: ids, state: "merged" }, { orderBy: [{ column: "number" }] });
  for (const row of rows) {
    if (!row.taskId || isPruebaTitle(row.title)) continue;
    const bag = out.get(row.taskId) ?? [];
    bag.push({ number: row.number, url: row.url, title: row.title });
    out.set(row.taskId, bag);
  }
  return out;
}

async function childrenFor(r: Reader, ids: string[]): Promise<Map<string, LogChild[]>> {
  const out = new Map<string, LogChild[]>();
  if (ids.length === 0) return out;
  // The store sorts by key, so children keep the database's key order.
  const kids = (await r.find("tasks", { parentId: ids, kind: "ticket" }, { orderBy: [{ column: "key" }] })).filter(
    (k) => !isPruebaTitle(k.title) && k.status !== WONT,
  );
  const prs = await prsFor(r, kids.map((k) => k.id));
  for (const k of kids) {
    if (!k.parentId) continue;
    const pr = prs.get(k.id)?.[0] ?? null;
    const bag = out.get(k.parentId) ?? [];
    bag.push({
      key: k.key,
      title: k.title,
      summary: k.summary,
      status: k.status,
      pr_number: pr?.number ?? null,
      pr_url: pr?.url ?? null,
    });
    out.set(k.parentId, bag);
  }
  return out;
}

function childStats(children: LogChild[]): { child_done: number; child_total: number } {
  return { child_done: children.filter((c) => c.status === "Done").length, child_total: children.length };
}

const closedAt = (c: Closed): number => c.t.resolvedAt!.getTime();

// The first of the rows by `rank`, highest first, then the latest close. Rows tied on both keep their read
// order (SQL left that tie to the plan).
function topOf(rows: Closed[], rank: (c: Closed) => number): Closed | undefined {
  let best: Closed | undefined;
  for (const c of rows) {
    if (!best || rank(c) > rank(best) || (rank(c) === rank(best) && closedAt(c) > closedAt(best))) best = c;
  }
  return best;
}

// Initiatives outrank tickets. Among initiatives, the one that closed the most tickets wins; among tickets,
// the one with the most visual evidence. `closed` is every close of the span.
async function biggestWin(r: Reader, closed: Closed[], tz: string): Promise<BiggestWin | null> {
  const initiatives = closed.filter((c) => c.t.kind === "initiative");
  const tickets = closed.filter((c) => c.t.kind === "ticket");
  // Done tickets under each initiative ([PRUEBA] left out), or visual results of each ticket.
  const score = new Map<string, number>();
  const bump = (id: string | null) => {
    if (id) score.set(id, (score.get(id) ?? 0) + 1);
  };
  let row: Closed | undefined;
  if (initiatives.length) {
    const kids = await r.find("tasks", { parentId: initiatives.map((c) => c.t.id), kind: "ticket", status: "Done" });
    for (const k of kids) if (!isPruebaTitle(k.title)) bump(k.parentId);
    row = topOf(initiatives, (c) => score.get(c.t.id) ?? 0);
  } else if (tickets.length) {
    for (const res of await r.find("results", { taskId: tickets.map((c) => c.t.id), kind: "visual" })) bump(res.taskId);
    row = topOf(tickets, (c) => score.get(c.t.id) ?? 0);
  }
  if (!row) return null;
  const t = row.t;
  const kind = t.kind as BiggestWin["kind"];
  const [changes, images, prs, children] = await Promise.all([
    changesFor(r, t.summary.trim() ? [] : [t.id]),
    imagesFor(r, [t.id]),
    prsFor(r, [t.id]),
    kind === "initiative" ? childrenFor(r, [t.id]) : Promise.resolve(new Map<string, LogChild[]>()),
  ]);
  const type = typeOf(kind, t.workType);
  const kids = children.get(t.id) ?? [];
  const ownPrs = prs.get(t.id) ?? [];
  const childPrs = kids.flatMap((c) => (c.pr_number && c.pr_url ? [{ number: c.pr_number, url: c.pr_url, title: c.title }] : []));
  const seen = new Set(ownPrs.map((p) => p.number));
  const merged = [...ownPrs, ...childPrs.filter((p) => !seen.has(p.number))];
  return {
    project: row.place.slug,
    project_title: row.place.title,
    key: t.key,
    kind,
    type,
    type_label: typeLabel(type),
    title: t.title,
    change: t.summary.trim() || changes.get(t.id)?.change || "",
    at: t.resolvedAt!.toISOString(),
    day: dayInTz(t.resolvedAt!, tz),
    prs: merged,
    tickets: kind === "initiative" ? (kids.length ? childStats(kids).child_done : (score.get(t.id) ?? 0)) : 1,
    images: images.get(t.id) ?? pairImages([]),
  };
}

// Up to four closes per project, initiatives first and then the latest. `closed` is the year's closes.
// SQL numbered them per project and returned them in that sort, projects in the database's slug order.
async function highlights(r: Reader, closed: Closed[], places: Places): Promise<YearBlock["highlights"]> {
  const initiative = (c: Closed) => c.t.kind === "initiative";
  const ranksAbove = (a: Closed, b: Closed) => (initiative(a) !== initiative(b) ? initiative(a) : closedAt(a) > closedAt(b));
  // The best four of each project, kept in rank order as the closes go by; a tie stays behind the earlier row.
  const top = new Map<string, Closed[]>();
  for (const c of closed) {
    const list = top.get(c.place.slug) ?? [];
    let at = list.length;
    while (at > 0 && ranksAbove(c, list[at - 1]!)) at--;
    if (at >= 4) continue;
    list.splice(at, 0, c);
    if (list.length > 4) list.pop();
    top.set(c.place.slug, list);
  }
  const rows = [...places.values()].flatMap((p) => top.get(p.slug) ?? []);
  const blank = rows.filter((c) => !c.t.summary.trim()).map((c) => c.t.id);
  const changes = await changesFor(r, blank);
  return rows.map((c) => ({
    project: c.place.slug,
    key: c.t.key,
    title: c.t.title,
    change: c.t.summary.trim() || changes.get(c.t.id)?.change || "",
    day: c.day,
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
  const r = readerOf(db);
  const stamp = await watermark(r);
  return cached(`summary|${tz}|${range}|${date}|${stamp}`, async () => {
    const year = yearRange(date);
    const span = spanOf(range, date);
    const heatFrom = addDays(weekRange(date).from, -(HEATMAP_WEEKS - 1) * 7);
    const lookback = addDays(today, -400);
    const from = [heatFrom, lookback, year.from, previousSpan(range, span.from).from].sort()[0]!;
    const to = [span.to, year.to, addDays(weekRange(date).from, 6), today].sort().at(-1)!;
    // One read of the closes and merges from `from` to `to`; the span and the year lie inside it.
    const projects = loadPlaces(r);
    const [places, closed, merged] = await Promise.all([
      projects,
      closedTasks(r, projects, ["ticket", "initiative"], from, to, tz),
      mergedPrs(r, projects, from, to, tz),
    ]);
    const within = (a: string, b: string) => (c: Closed) => c.day >= a && c.day <= b;
    const [win, marks] = await Promise.all([
      biggestWin(r, closed.filter(within(span.from, span.to)), tz),
      highlights(r, closed.filter(within(year.from, year.to)), places),
    ]);
    const tasks = taskAggregate(closed);
    const prs = prAggregate(merged);
    return buildSummary({ range, date, today, tz }, tasks, prs, foldTitles(tasks, prs, titlesOf(places)), win, marks);
  });
}

// ILIKE against a pattern whose wildcards were all escaped is a case-insensitive substring test. Postgres
// lowers each character on its own (simple case mapping); toLowerCase differs only for İ, which it turns
// into two characters, and a final Σ, which it lowers by context, so those two are mapped first. A database
// whose LC_CTYPE is C lowers ASCII letters only; there an accented capital matched only itself.
function foldCase(s: string): string {
  return s.replace(/İ/g, "i").replace(/Σ/g, "σ").toLowerCase();
}

function matcher(q: string | null): ((s: string) => boolean) | null {
  if (!q) return null;
  const needle = foldCase(q);
  return (s) => foldCase(s).includes(needle);
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

function typeMatches(type: ProgressType | null, t: Task): boolean {
  if (!type) return true;
  if (type === "pr") return false;
  if (type === "initiative" || type === "idea") return t.kind === type;
  return t.kind === "ticket" && t.workType === type;
}

// What the log reads, once: the closes (tickets, initiatives and ideas) and merges of the whole range in
// the chosen project, and for a search, the merged PRs of each of those tasks.
type LogData = {
  closed: Closed[];
  merged: Merged[];
  hit: ((s: string) => boolean) | null;
  // The search's digits, compared with a PR number written out (pr.number::text).
  digits: string | null;
  prsOf: Map<string, Row<"pullRequests">[]>;
};

async function loadLog(r: Reader, filters: LogFilters, tz: string): Promise<LogData> {
  const projects = loadPlaces(r);
  const inProject = (row: { place: Place }) => filters.project === null || row.place.slug === filters.project;
  const [closed, merged] = await Promise.all([
    closedTasks(r, projects, ["ticket", "initiative", "idea"], filters.from, filters.to, tz),
    mergedPrs(r, projects, filters.from, filters.to, tz),
  ]);
  const own = closed.filter(inProject);
  const prsOf = new Map<string, Row<"pullRequests">[]>();
  if (filters.q && own.length) {
    for (const pr of await r.find("pullRequests", { taskId: own.map((c) => c.t.id), state: "merged" })) {
      if (!pr.taskId) continue;
      const bag = prsOf.get(pr.taskId) ?? [];
      bag.push(pr);
      prsOf.set(pr.taskId, bag);
    }
  }
  return { closed: own, merged: merged.filter(inProject), hit: matcher(filters.q), digits: filters.q?.replace(/\D/g, "") || null, prsOf };
}

// The search over a close: its title, summary or key, its project's slug or title, or a merged PR of it
// by title or number.
function searchHits(data: LogData, c: Closed): boolean {
  const { hit, digits } = data;
  if (!hit) return true;
  if (hit(c.t.title) || hit(c.t.summary) || hit(c.t.key) || hit(c.place.slug) || hit(c.place.title)) return true;
  return (data.prsOf.get(c.t.id) ?? []).some((pr) => hit(pr.title) || (digits !== null && String(pr.number) === digits));
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
  resolved_at: Date;
  day: string;
  time: string;
  slug: string;
  project_title: string;
};

function logTasks(data: LogData, filters: LogFilters, end: string): TaskLogRow[] {
  if (end < filters.from) return [];
  return data.closed
    .filter((c) => c.day <= end && typeMatches(filters.type, c.t) && searchHits(data, c))
    .map((c) => ({
      id: c.t.id,
      key: c.t.key,
      kind: c.t.kind as TaskLogRow["kind"],
      work_type: c.t.workType,
      title: c.t.title,
      summary: c.t.summary,
      resolved_at: c.t.resolvedAt!,
      day: c.day,
      time: c.time,
      slug: c.place.slug,
      project_title: c.place.title,
    }));
}

type PrLogRow = {
  number: number;
  url: string;
  title: string;
  merged_at: Date;
  day: string;
  time: string;
  slug: string;
  project_title: string;
};

// Merges with no task, or whose task is not Done (a Done task lists its own PRs), not Won't do and not [PRUEBA].
function logPrs(data: LogData, filters: LogFilters, end: string): PrLogRow[] {
  if (filters.type && filters.type !== "pr") return [];
  if (end < filters.from) return [];
  const { hit, digits } = data;
  return data.merged
    .filter(
      (m) =>
        m.day <= end &&
        (!m.task || (m.task.status !== "Done" && m.task.status !== WONT && !isPruebaTitle(m.task.title))) &&
        (!hit || hit(m.pr.title) || hit(m.place.slug) || hit(m.place.title) || (digits !== null && String(m.pr.number) === digits)),
    )
    .map((m) => ({
      number: m.pr.number,
      url: m.pr.url,
      title: m.pr.title,
      merged_at: m.pr.mergedAt!,
      day: m.day,
      time: m.time,
      slug: m.place.slug,
      project_title: m.place.title,
    }));
}

function countLog(data: LogData, filters: LogFilters): { counts: Record<string, number>; projects: ProjectCount[] } {
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
  // The chips ignore the type filter and the page: every close and merge of the range that the project and
  // search allow.
  const open: LogFilters = { ...filters, type: null, cursor: null };
  for (const c of data.closed) if (searchHits(data, c)) bump(typeOf(c.t.kind, c.t.workType), c.place.slug, c.place.title, 1);
  for (const r of logPrs(data, open, filters.to)) bump("pr", r.slug, r.project_title, 1);
  const projects = [...projectMap.entries()]
    .map(([slug, v]) => ({ slug, title: v.title, count: v.count }))
    .sort((a, b) => projectSort(a.slug, b.slug));
  return { counts, projects };
}

export async function progressLog(db: Db, input: { from?: string; to?: string; project?: string; type?: string; q?: string; cursor?: string }): Promise<ProgressLog> {
  const tz = progressTz();
  const filters = parseLog(input);
  const r = readerOf(db);
  const stamp = await watermark(r);
  const key = `log|${tz}|${JSON.stringify(filters)}|${stamp}`;
  return cached(key, async () => {
    const end = windowEnd(filters);
    const data = await loadLog(r, filters, tz);
    const taskRows = logTasks(data, filters, end);
    const prRows = logPrs(data, filters, end);
    const totals = countLog(data, filters);
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
      changesFor(r, blank),
      imagesFor(r, ids),
      prsFor(r, ids),
      childrenFor(r, initiativeIds),
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
  const r = readerOf(db);
  // By its canonical key in the project (not an alias). A missing value names nothing: the port reads an
  // undefined filter as "any".
  const place = project == null ? undefined : await r.get("projects", { slug: project });
  if (!place) throw new ToolError("PROJECT_NOT_FOUND");
  const task = key == null ? undefined : await r.get("tasks", { projectId: place.id, key });
  if (!task || isPruebaTitle(task.title) || task.status === WONT) throw new ToolError("TASK_NOT_FOUND");
  const parent = task.parentId ? await r.get("tasks", { id: task.parentId }) : undefined;
  const row = {
    id: task.id,
    key: task.key,
    kind: task.kind as ProgressItem["kind"],
    work_type: task.workType,
    title: task.title,
    summary: task.summary,
    status: task.status,
    resolved_at: task.resolvedAt,
    created_at: task.createdAt,
    slug: place.slug,
    project_title: place.title,
    parent_key: parent?.key ?? null,
    parent_title: parent?.title ?? null,
  };
  const [changes, images, prs, children, events] = await Promise.all([
    changesFor(r, [row.id]),
    imagesFor(r, [row.id]),
    prsFor(r, [row.id]),
    row.kind === "initiative" ? childrenFor(r, [row.id]) : Promise.resolve(new Map<string, LogChild[]>()),
    r.find("events", { taskId: row.id, type: ["task.created", "task.status", "note"] }, { orderBy: [{ column: "id" }], limit: 16 }),
  ]);
  const kids = children.get(row.id) ?? [];
  const stats = childStats(kids);
  const at = row.resolved_at ? new Date(row.resolved_at) : null;
  const created = new Date(row.created_at);
  const type = typeOf(row.kind, row.work_type);
  const doc = changes.get(row.id)?.doc ?? null;
  const timeline = events.map((e) => {
    const when = new Date(e.createdAt);
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
