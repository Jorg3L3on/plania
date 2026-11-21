// PLA-I72-5: the rules of the new Máquinas door (components/corriente/cuarto.tsx), tested without a browser
// (test/i72-cuarto-ui.test.ts). The reads it shows (copies, numbers, leftovers, sign-in) and what each part says: the
// summary chips, a copy's state pill, its tiles, the shared machines' lines, the leftovers' lines, the drawer to open.
// Words in lib/maquinas-words.ts (CUARTO_WORDS), both languages.
import { getLanguage, words, type Language } from "./i18n.js";
import { FALLBACK_LOCALES, LOCALE } from "./locale.js";
import { CUARTO_WORDS } from "./maquinas-words.js";

export type Phase = "starting" | "capturing" | "live" | "failed" | "off" | "running" | "unavailable";
export type Copia = {
  id: string;
  kind: "inicio" | "iniciativa";
  key: string | null;
  title: string;
  status: string | null;
  branch: string | null;
  phase: Phase;
  managed: boolean;
  port: number | null;
  url: string | null;
  started_at: string | null;
  error: string | null;
  detail: string | null;
  keep: boolean;
  database: string | null;
  worktree: string | null;
  made: boolean;
};
export type CopiasRead = { project: string; configured: boolean; own_bases: boolean; no_code: boolean; copias: Copia[] };
export type DiskSplit = { total: number | null; code: number | null; deps: number | null; cache: number | null; log: number | null };
export type ServerNumbers = { on: boolean; cpu: number | null; mem_bytes: number | null; uptime_s: number | null; response_ms: number | null; cpu_samples: number[]; mem_samples: number[]; disk: DiskSplit | null; line: string | null };
export type BaseNumbers = { name: string; reachable: boolean; size_bytes: number | null; tables: number | null; rows: number | null; connections: number | null; migrations: { applied: number; pending: number } | null; origin: { from: "app" | "inicio"; at: string | null } };
export type Numeros = {
  at: string;
  sampling: boolean;
  servers: Record<string, ServerNumbers>;
  bases: Record<string, BaseNumbers>;
  mac: { disk_free: number | null; disk_total: number | null; mem_free: number | null; mem_total: number | null };
  engine: { on: boolean; version: string | null; uptime_s: number | null; connections: number | null; max_connections: number | null; project_bases: number | null };
};
export type Sobrante = {
  id: string;
  kind: "base" | "servidor" | "carpeta";
  name: string;
  initiative: { key: string; title: string; status: string; closed_at: string | null } | null;
  size_bytes: number | null;
  mem_bytes: number | null;
  port: number | null;
};
export type SobrantesRead = { project: string; sobrantes: Sobrante[]; total: number; total_bytes: number; swept_at: string | null };
export type EntrarRead = { user: string | null; password: string | null; can_password: boolean; at: string | null; stale: string[] };

const W = (l: Language) => words(CUARTO_WORDS, l);
// The house locale (the browser's variant of the install's language), or that language's fallback when asked for another.
const loc = (language: Language) => (language === getLanguage() ? LOCALE : FALLBACK_LOCALES[language]);

// ---- numbers as the screen writes them

/** A size as a value and its unit (1.27 GB), in the house locale. */
export function size(n: number | null | undefined, language: Language = getLanguage()): { v: string; u: string } | null {
  if (n === null || n === undefined || !Number.isFinite(n)) return null;
  const fmt = (x: number, d: number) => x.toLocaleString(loc(language), { minimumFractionDigits: d, maximumFractionDigits: d });
  if (n >= 1024 ** 3) return { v: fmt(n / 1024 ** 3, 2), u: "GB" };
  if (n >= 1024 ** 2) return { v: fmt(n / 1024 ** 2, 0), u: "MB" };
  if (n >= 1024) return { v: fmt(n / 1024, 0), u: "KB" };
  return { v: String(Math.round(n)), u: "B" };
}
export const sizeText = (n: number | null | undefined, language: Language = getLanguage()): string => {
  const s = size(n, language);
  return s ? `${s.v} ${s.u}` : "";
};
export const pct = (part: number | null, whole: number | null): number | null => (part === null || whole === null || whole <= 0 ? null : Math.max(0, Math.min(100, Math.round((part / whole) * 100))));
export const cpuText = (n: number | null, language: Language = getLanguage()): string => (n === null ? "—" : n.toLocaleString(loc(language), { maximumFractionDigits: 1 }));

/** How long something has been on: 2 h 14 m, 41 m, 12 s, 6 días. */
export function since(seconds: number | null, language: Language = getLanguage()): string {
  if (seconds === null || !Number.isFinite(seconds)) return "—";
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} m`;
  if (s < 86400) {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return m ? `${h} h ${m} m` : `${h} h`;
  }
  return W(language).days(Math.floor(s / 86400));
}

/** A date as «hace 6 días» / «6 days ago», or the day for older ones. */
export function ago(iso: string | null, now: number = Date.now(), language: Language = getLanguage()): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const d = Math.floor((now - t) / 86400_000);
  const w = W(language);
  return d <= 0 ? w.agoToday : d === 1 ? w.agoYesterday : d < 14 ? w.agoDays(d) : w.agoWeeks(Math.floor(d / 7));
}
export function dayOf(iso: string | null, language: Language = getLanguage()): string {
  if (!iso) return "";
  const t = new Date(iso);
  return Number.isFinite(t.getTime()) ? t.toLocaleDateString(loc(language), { day: "numeric", month: "short" }).replace(".", "") : "";
}

// ---- a copy

export type RowState = "on" | "starting" | "failed" | "off" | "outside" | "unavailable" | "never";
const LIVE = new Set<Phase>(["live", "capturing"]);
export function rowState(c: Copia): RowState {
  if (c.phase === "unavailable") return "unavailable";
  if (c.phase === "running") return "outside";
  if (LIVE.has(c.phase)) return "on";
  if (c.phase === "starting") return "starting";
  if (c.phase === "failed") return "failed";
  return c.kind === "iniciativa" && !c.made ? "never" : "off";
}
export const isOn = (c: Copia) => ["on", "starting", "outside"].includes(rowState(c));
export const pillTone = (s: RowState): "ok" | "bad" | "live" | "" => (s === "on" || s === "outside" ? "ok" : s === "failed" ? "bad" : s === "starting" ? "live" : "");
export const pillWord = (s: RowState, language: Language = getLanguage()): string => W(language).pill[s];

export const copyName = (c: Copia, language: Language = getLanguage()): string => (c.kind === "inicio" ? W(language).inicio : c.title);
export function copySub(c: Copia, language: Language = getLanguage()): string {
  const w = W(language);
  if (c.kind === "inicio") return w.inicioSub;
  return w.iniSub(w.status[c.status ?? ""] ?? w.statusOther);
}
/** The server switch: what it does now (Encender/Apagar), and whether it can be flipped. */
export function switchOf(c: Copia): { on: boolean; can: boolean } {
  const s = rowState(c);
  return { on: s === "on" || s === "starting", can: c.managed || s === "off" || s === "never" || s === "failed" };
}
/** «Abrir la app ↗» only with the server answering. */
export const appUrl = (c: Copia): string | null => (rowState(c) === "on" || rowState(c) === "outside" ? c.url : null);

// The last request line of a copy's output, for the server tile's foot.
const REQ = /\b(GET|POST|PUT|PATCH|DELETE|HEAD)\s+\S+.*?\b[1-5]\d\d\b/;
export const lastRequest = (lines: string[]): string | null => [...lines].reverse().find((l) => REQ.test(l))?.trim() ?? null;
/** The first error line of a copy's output, for a copy that did not start. */
export const errorLine = (lines: string[], fallback: string | null = null): string | null =>
  lines.find((l) => /\b(error|missing|exited|fatal|cannot|failed)\b/i.test(l))?.trim() ?? fallback;

/** A key the log or the error says is missing, if any is one of the keys the app lists as missing. */
export function missingKey(text: string | null, missing: string[]): string | null {
  if (!text) return null;
  for (const m of text.matchAll(/\b([A-Z][A-Z0-9_]{2,})\b/g)) if (missing.includes(m[1]!)) return m[1]!;
  return null;
}

// ---- the head

export type Summary = { total: number; on: number; failed: { id: string; name: string }[]; leftovers: number; leftover_bytes: number };
export function summaryOf(r: CopiasRead | undefined, left: SobrantesRead | undefined, language: Language = getLanguage()): Summary {
  const cs = r?.copias ?? [];
  // An initiative never made is listed (it can be turned on) but is not a copy yet.
  const made = cs.filter((c) => c.kind === "inicio" || c.made || rowState(c) !== "never");
  return {
    total: made.length,
    on: cs.filter(isOn).length,
    failed: cs.filter((c) => rowState(c) === "failed").map((c) => ({ id: c.id, name: copyName(c, language) })),
    leftovers: left?.total ?? 0,
    leftover_bytes: left?.total_bytes ?? 0,
  };
}

// ---- the leftovers

export type LeftLine = { kind: string; name: string; from: string; amount: string; button: string; icon: "db" | "server" | "folder" };
export function leftLine(s: Sobrante, now: number = Date.now(), language: Language = getLanguage()): LeftLine {
  const w = W(language);
  const i = s.initiative;
  const how = i ? (w.leftHow[i.status] ? `${w.leftHow[i.status]}${i.closed_at ? ` ${ago(i.closed_at, now, language)}` : ""}` : w.leftOpen) : w.leftNoInitiative;
  return {
    kind: w.leftKind[s.kind] ?? s.kind,
    name: s.kind === "carpeta" ? w.leftFolder(i?.title ?? null) : s.kind === "servidor" && s.port ? `localhost:${s.port}` : s.name,
    from: w.leftFrom(i?.title ?? null, how),
    amount: s.kind === "servidor" ? (s.mem_bytes !== null ? w.inMemory(sizeText(s.mem_bytes, language)) : "") : sizeText(s.size_bytes, language),
    button: s.kind === "servidor" ? w.stopDel : w.del,
    icon: s.kind === "base" ? "db" : s.kind === "servidor" ? "server" : "folder",
  };
}

// ---- the drawer

export type Focus = { who: "shared"; part: "mac" | "motor" | "llaves" } | { who: string; part: "servidor" | "base" };
/** The drawer named by the address (?ver=maq:<who>:<part>); the old single words open the start copy's parts. */
export function focusOf(raw: string | null, copias: Copia[] = []): Focus | null {
  if (!raw) return null;
  const legacy: Record<string, string> = { servidor: "inicio:servidor", base: "inicio:base", registro: "inicio:servidor", llaves: "shared:llaves", mapa: "inicio:base" };
  const v = legacy[raw] ?? (raw.startsWith("tabla:") ? "inicio:base" : raw);
  const i = v.indexOf(":");
  if (i < 0) return null;
  const who = v.slice(0, i);
  const part = v.slice(i + 1);
  if (who === "shared") return part === "mac" || part === "motor" || part === "llaves" ? { who: "shared", part } : null;
  if (part !== "servidor" && part !== "base") return null;
  if (copias.length && !copias.some((c) => c.id === who)) return null;
  return { who, part };
}
export const focusKey = (f: Focus): string => `${f.who}:${f.part}`;

/** Disk split bars of a server drawer, biggest first, without empty parts. */
export function diskBars(d: DiskSplit | null, language: Language = getLanguage()): { key: string; label: string; bytes: number; text: string; share: number }[] {
  if (!d) return [];
  const w = W(language);
  const parts = (["code", "deps", "cache", "log"] as const).map((k) => ({ key: k, label: w.diskParts[k]!, bytes: d[k] ?? 0 })).filter((x) => x.bytes > 0);
  const max = Math.max(1, ...parts.map((x) => x.bytes));
  return parts.map((x) => ({ ...x, text: sizeText(x.bytes, language), share: Math.round((x.bytes / max) * 100) }));
}

/** Copies whose base the engine drawer lists, with their numbers. */
export function basesList(r: CopiasRead | undefined, n: Numeros | undefined): { id: string; name: string; db: string; size: number | null; conns: number | null }[] {
  return (r?.copias ?? []).filter((c) => c.database && n?.bases[c.id]).map((c) => ({ id: c.id, name: copyName(c), db: c.database!, size: n!.bases[c.id]!.size_bytes, conns: n!.bases[c.id]!.connections }));
}

/** A sparkline path (0..100 wide, 0..14 high) for samples. */
export function spark(values: number[], height = 14): { line: string; area: string } | null {
  if (values.length < 2) return null;
  const max = Math.max(...values, 1e-9);
  const min = Math.min(...values, 0);
  const pts = values.map((v, i) => [(i / (values.length - 1)) * 100, height - ((v - min) / (max - min || 1)) * (height - 2) - 1] as const);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  return { line, area: `${line} L100,${height} L0,${height} Z` };
}
