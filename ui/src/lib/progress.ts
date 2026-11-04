// Display helpers for Mi progreso. Colours are a fixed palette (the API does not send them).
// Days are calendar dates already bucketed in America/Mexico_City by the server.
import type { ProgressRange } from "./types.js";

export const PROJECT_COLOR: Record<string, string> = {
  micasa: "#34d399",
  workia: "#60a5fa",
  filmia: "#f472b6",
  zigzag: "#fbbf24",
  plania: "#a78bfa",
};

const FALLBACK = ["#34d399", "#60a5fa", "#f472b6", "#fbbf24", "#a78bfa", "#fb7185", "#22d3ee"];
const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"] as const;
const WEEKDAYS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"] as const;

export const projectColor = (slug: string): string => {
  const known = PROJECT_COLOR[slug];
  if (known) return known;
  let n = 0;
  for (const ch of slug) n = (n + ch.charCodeAt(0)) % FALLBACK.length;
  return FALLBACK[n] ?? "#a1a1aa";
};

const parts = (day: string): { y: number; m: number; d: number; wd: number } => {
  const [y, m, d] = day.split("-").map(Number);
  const year = y ?? 1970;
  const month = m ?? 1;
  const date = d ?? 1;
  const wd = new Date(Date.UTC(year, month - 1, date)).getUTCDay();
  return { y: year, m: month, d: date, wd };
};

const cap = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** "sáb 31 oct" */
export const formatDay = (day: string): string => {
  const p = parts(day);
  const name = WEEKDAYS[p.wd] ?? "";
  return `${name.slice(0, 3)} ${p.d} ${MONTHS[p.m - 1] ?? ""}`;
};

/** "Sábado 31 oct" */
export const formatDayLong = (day: string): string => {
  const p = parts(day);
  return `${cap(WEEKDAYS[p.wd] ?? "")} ${p.d} ${MONTHS[p.m - 1] ?? ""}`;
};

export const monthName = (day: string): string => (MONTHS[parts(day).m - 1] ?? "").toUpperCase();

export const cosasCaption = (finished: number, projects: number): string => {
  const cosas = finished === 1 ? "cosa terminada" : "cosas terminadas";
  if (projects <= 0) return cosas;
  const proy = projects === 1 ? "1 proyecto" : `${projects} proyectos`;
  return `${cosas} en ${proy}`;
};

export const deltaText = (pct: number | null, range: ProgressRange): { up: boolean; text: string } | null => {
  if (pct === null) return null;
  const vs = range === "day" ? "ayer" : range === "week" ? "semana pasada" : "el año pasado";
  if (pct === 0) return { up: true, text: `igual que ${vs}` };
  const up = pct > 0;
  return { up, text: `${up ? "▲" : "▼"} ${Math.abs(pct)}% vs. ${vs}` };
};

export const parseRange = (raw: string | null): ProgressRange => (raw === "day" || raw === "year" ? raw : "week");

export const rhythmTitle = (range: ProgressRange): string =>
  range === "day" ? "Ritmo del día" : range === "year" ? "Ritmo del año" : "Ritmo de la semana";

export const isGif = (url: string): boolean => {
  try {
    return new URL(url).pathname.toLowerCase().endsWith(".gif");
  } catch {
    return url.toLowerCase().split("?")[0]?.endsWith(".gif") ?? false;
  }
};

export const TYPE_MARK: Record<string, string> = {
  bug: "🐞",
  code: "✨",
  ops: "⚙",
  research: "🔎",
  "decision-needed": "⚖",
  debt: "🧹",
  idea: "💡",
  initiative: "🏁",
  pr: "⎇",
};

const TYPE_CHIP: Record<string, string> = {
  bug: "Bugs",
  code: "Features",
  ops: "Ops",
  research: "Investigación",
  "decision-needed": "Decisiones",
  debt: "Deuda",
  idea: "Ideas",
  initiative: "Iniciativas",
  pr: "PRs",
};

export const typeChip = (type: string): string => TYPE_CHIP[type] ?? type;

/** Newest month first, `count` months back from a YYYY-MM-DD already in the project zone. */
export const monthsBack = (today: string, count = 12): { key: string; label: string }[] => {
  let year = Number(today.slice(0, 4));
  let month = Number(today.slice(5, 7));
  const out: { key: string; label: string }[] = [];
  for (let i = 0; i < count; i++) {
    const key = `${year}-${String(month).padStart(2, "0")}`;
    out.push({ key, label: (MONTHS[month - 1] ?? "").toUpperCase() });
    month -= 1;
    if (month === 0) {
      month = 12;
      year -= 1;
    }
  }
  return out;
};

export const monthSpan = (key: string): { from: string; to: string } => {
  const year = Number(key.slice(0, 4));
  const month = Number(key.slice(5, 7));
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from: `${key}-01`, to: `${key}-${String(last).padStart(2, "0")}` };
};

export type LogNeedle = { project?: string; type?: string; q?: string };

type Matchable = {
  project: string;
  type: string;
  title: string;
  summary: string;
  change: string;
  key: string | null;
  prs: { number: number; title: string }[];
};

// All three narrow the list. An empty field does not. Search looks at the title, the change,
// the key and the PR number (`#293` or `293`).
export const entryMatches = (entry: Matchable, needle: LogNeedle): boolean => {
  if (needle.project && entry.project !== needle.project) return false;
  if (needle.type && entry.type !== needle.type) return false;
  const q = needle.q?.trim().toLowerCase() ?? "";
  if (!q) return true;
  const digits = q.startsWith("#") ? q.slice(1) : q;
  const blob = [entry.title, entry.summary, entry.change, entry.key ?? "", entry.project, ...entry.prs.flatMap((pr) => [String(pr.number), pr.title])]
    .join("\n")
    .toLowerCase();
  if (blob.includes(q)) return true;
  return /^\d+$/.test(digits) && entry.prs.some((pr) => String(pr.number) === digits);
};
