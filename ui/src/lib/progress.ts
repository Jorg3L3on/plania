// Display helpers for Mi progreso. Colours come from a palette by slug (the API does not send them).
// Days are calendar dates already bucketed in the install's zone by the server.
// PLA-I2-10: the words are in PROGRESS_LIB_WORDS, in both languages; each function takes the language last.
import { defineWords, getLanguage, words, type Language } from "./i18n.js";
import type { ProgressRange } from "./types.js";

const FALLBACK = ["#34d399", "#60a5fa", "#f472b6", "#fbbf24", "#a78bfa", "#fb7185", "#22d3ee"];

export const PROGRESS_LIB_WORDS = defineWords({
  es: {
    months: ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"],
    weekdays: ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"],
    cosas: (n: number): string => (n === 1 ? "cosa terminada" : "cosas terminadas"),
    inProjects: (cosas: string, n: number) => `${cosas} en ${n === 1 ? "1 proyecto" : `${n} proyectos`}`,
    vs: { day: "ayer", week: "semana pasada", year: "el año pasado" } as Record<ProgressRange, string>,
    same: (vs: string) => `igual que ${vs}`,
    rhythm: { day: "Ritmo del día", week: "Ritmo de la semana", year: "Ritmo del año" } as Record<ProgressRange, string>,
    typeChip: {
      bug: "Bugs",
      code: "Features",
      ops: "Ops",
      research: "Investigación",
      "decision-needed": "Decisiones",
      debt: "Deuda",
      idea: "Ideas",
      initiative: "Iniciativas",
      pr: "PRs",
    } as Record<string, string>,
  },
  en: {
    months: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
    weekdays: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
    cosas: (n: number): string => (n === 1 ? "thing finished" : "things finished"),
    inProjects: (cosas: string, n: number) => `${cosas} in ${n === 1 ? "1 project" : `${n} projects`}`,
    vs: { day: "yesterday", week: "last week", year: "last year" },
    same: (vs: string) => `same as ${vs}`,
    rhythm: { day: "Rhythm of the day", week: "Rhythm of the week", year: "Rhythm of the year" },
    typeChip: {
      bug: "Bugs",
      code: "Features",
      ops: "Ops",
      research: "Research",
      "decision-needed": "Decisions",
      debt: "Debt",
      idea: "Ideas",
      initiative: "Initiatives",
      pr: "PRs",
    },
  },
});

export const projectColor = (slug: string): string => {
  // PLA-I2-3: derived from the slug alone (a stable hash into the palette), so any project gets one.
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
export const formatDay = (day: string, language: Language = getLanguage()): string => {
  const w = words(PROGRESS_LIB_WORDS, language);
  const p = parts(day);
  const name = w.weekdays[p.wd] ?? "";
  return `${name.slice(0, 3)} ${p.d} ${w.months[p.m - 1] ?? ""}`;
};

/** "Sábado 31 oct" */
export const formatDayLong = (day: string, language: Language = getLanguage()): string => {
  const w = words(PROGRESS_LIB_WORDS, language);
  const p = parts(day);
  return `${cap(w.weekdays[p.wd] ?? "")} ${p.d} ${w.months[p.m - 1] ?? ""}`;
};

export const monthName = (day: string, language: Language = getLanguage()): string => (words(PROGRESS_LIB_WORDS, language).months[parts(day).m - 1] ?? "").toUpperCase();

export const cosasCaption = (finished: number, projects: number, language: Language = getLanguage()): string => {
  const w = words(PROGRESS_LIB_WORDS, language);
  const cosas = w.cosas(finished);
  if (projects <= 0) return cosas;
  return w.inProjects(cosas, projects);
};

export const deltaText = (pct: number | null, range: ProgressRange, language: Language = getLanguage()): { up: boolean; text: string } | null => {
  if (pct === null) return null;
  const w = words(PROGRESS_LIB_WORDS, language);
  const vs = w.vs[range === "day" || range === "week" ? range : "year"];
  if (pct === 0) return { up: true, text: w.same(vs) };
  const up = pct > 0;
  return { up, text: `${up ? "▲" : "▼"} ${Math.abs(pct)}% vs. ${vs}` };
};

export const parseRange = (raw: string | null): ProgressRange => (raw === "day" || raw === "year" ? raw : "week");

export const rhythmTitle = (range: ProgressRange, language: Language = getLanguage()): string =>
  words(PROGRESS_LIB_WORDS, language).rhythm[range === "day" || range === "year" ? range : "week"];

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

export const typeChip = (type: string, language: Language = getLanguage()): string => {
  const chips = words(PROGRESS_LIB_WORDS, language).typeChip;
  return Object.hasOwn(chips, type) ? chips[type]! : type;
};

/** Newest month first, `count` months back from a YYYY-MM-DD already in the project zone. */
export const monthsBack = (today: string, count = 12, language: Language = getLanguage()): { key: string; label: string }[] => {
  const months = words(PROGRESS_LIB_WORDS, language).months;
  let year = Number(today.slice(0, 4));
  let month = Number(today.slice(5, 7));
  const out: { key: string; label: string }[] = [];
  for (let i = 0; i < count; i++) {
    const key = `${year}-${String(month).padStart(2, "0")}`;
    out.push({ key, label: (months[month - 1] ?? "").toUpperCase() });
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
