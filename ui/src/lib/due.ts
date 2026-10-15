// 2.10: dates on screen. due_on is a calendar day (YYYY-MM-DD); time_after an instant. Both read in
// the browser's time zone. Closed or merged work is never overdue.

const DAY = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short" });
const DAY_YEAR = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", year: "numeric" });
const NOT_DUE = ["Done", "Won't do", "Merged", "Released"];

/** The browser's today as YYYY-MM-DD. */
export function todayLocal(nowMs = Date.now()): string {
  const d = new Date(nowMs);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// A bare day is read at local noon, so no time zone moves it to the day before.
const asDate = (on: string) => (/^\d{4}-\d{2}-\d{2}$/.test(on) ? new Date(`${on}T12:00:00`) : new Date(on));

/** "24 oct" (with the year when it is not this one). */
export function dayText(on: string, nowMs = Date.now()): string {
  const d = asDate(on);
  const text = (d.getFullYear() === new Date(nowMs).getFullYear() ? DAY : DAY_YEAR).format(d);
  return text.replace(/\./g, "");
}

export function isOverdue(t: { due_on?: string | null; status: string }, nowMs = Date.now()): boolean {
  return !!t.due_on && !NOT_DUE.includes(t.status) && t.due_on < todayLocal(nowMs);
}

/** "vence 24 oct", or null when the task has no due date or is closed. */
export function dueText(t: { due_on?: string | null; status: string }, nowMs = Date.now()): string | null {
  if (!t.due_on || NOT_DUE.includes(t.status)) return null;
  return `${isOverdue(t, nowMs) ? "venció" : "vence"} ${dayText(t.due_on, nowMs)}`;
}

export type Upcoming = { key: string; title: string; on: string; kind: "due" | "time_after" };
export type DateLine = Upcoming & { project: string; overdue: boolean };

/** Inicio's Próximo: overdue first (oldest first), then what comes in date order. */
export function proximoOf(projects: { slug: string; tasks: { key: string; title: string; status: string; due_on?: string | null }[]; upcoming?: Upcoming[]; overdue?: string[] }[]): DateLine[] {
  const overdue: DateLine[] = [];
  const next: DateLine[] = [];
  for (const p of projects) {
    for (const key of p.overdue ?? []) {
      const t = p.tasks.find((x) => x.key === key);
      if (t?.due_on) overdue.push({ project: p.slug, key, title: t.title, on: t.due_on, kind: "due", overdue: true });
    }
    for (const u of p.upcoming ?? []) next.push({ ...u, project: p.slug, overdue: false });
  }
  const byDate = (a: DateLine, b: DateLine) => asDate(a.on).getTime() - asDate(b.on).getTime() || a.key.localeCompare(b.key);
  return [...overdue.sort(byDate), ...next.sort(byDate)];
}
