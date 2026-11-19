import { defineWords, getLanguage, words, type Language } from "./i18n.js";
import { LOCALE } from "./locale.js";
// PLA-I30 Compañía's model, kept for the plumbing (week tokens, plan, runs) that moved to Máquina in PLA-I33
// and for the shared words and numbers. The organization's shapes (PLA-I33) are in api.ts and org.ts.
// Pure and relative imports only, so test/compania.test.ts loads it with node:test. Tokens, never money.
// PLA-I2-10: the words are in COMPANIA_LIB_WORDS, in both languages; each function takes the language last. The
// constants that hold words (RUN_WORD, NAV, planUnknownLine) keep their Spanish for their readers; the screen reads
// runWord(), navItems() and planUnknownText().

export const COMPANIA_LIB_WORDS = defineWords({
  es: {
    // ago(): "hace 5 min"
    noMove: "sin movimiento",
    moment: "un momento",
    minutes: (n: number) => `${n} min`,
    hours: (n: number) => `${n} h`,
    days: (n: number) => `${n} días`,
    ago: (span: string) => `hace ${span}`,
    // the banners
    planHead: "El plan",
    until: (clock: string) => `hasta ${clock}`,
    untilDown: "hasta que baje",
    planBanner: (head: string, until: string) =>
      `${head} · la ventana de 5 h pasó el guardia · no arrancan corridas nuevas ${until} para que te quede plan a ti · las que corren terminan su paso`,
    pausedSince: (clock: string) => `La compañía está detenida · desde ${clock}, por ti`,
    paused: "La compañía está detenida, por ti",
    // the En marcha header
    cap: (n: number) => `Tope: ${n} a la vez`,
    capWaiting: (cap: string, n: number) => `${cap} · ${n} en espera`,
    idlePaused: "Nada corre: la compañía está detenida.",
    idlePlan: (n: number) => `Nada arranca: ${n} en espera del guardia.`,
    idleAllPaused: "Nada corre: todos los proyectos están en pausa.",
    idle: "Nada corre.",
    planUnknown: "No se pudo leer el uso del plan. Desconocido = alto: no arranca nada nuevo.",
    run: { ok: "ok", fail: "falló", skipped: "omitida", stopped: "detenida", running: "corriendo", queued: "en espera" } as Record<string, string>,
    // The header's four links, by path.
    nav: { "/ceo": "Compañía", "/inbox": "Bandeja", "/progreso": "Progreso", "/machine": "Máquina" } as Record<string, string>,
  },
  en: {
    noMove: "no activity",
    moment: "a moment",
    minutes: (n: number) => `${n} min`,
    hours: (n: number) => `${n} h`,
    days: (n: number) => `${n} days`,
    ago: (span: string) => `${span} ago`,
    planHead: "The plan",
    until: (clock: string) => `until ${clock}`,
    untilDown: "until it goes down",
    planBanner: (head: string, until: string) =>
      `${head} · the 5 h window passed the guard · no new runs start ${until} so you keep some plan for yourself · the ones running finish their step`,
    pausedSince: (clock: string) => `The company is stopped · since ${clock}, by you`,
    paused: "The company is stopped, by you",
    cap: (n: number) => `Limit: ${n} at a time`,
    capWaiting: (cap: string, n: number) => `${cap} · ${n} waiting`,
    idlePaused: "Nothing is running: the company is stopped.",
    idlePlan: (n: number) => `Nothing starts: ${n} waiting on the guard.`,
    idleAllPaused: "Nothing is running: every project is paused.",
    idle: "Nothing is running.",
    planUnknown: "The plan's usage could not be read. Unknown = high: nothing new starts.",
    run: { ok: "ok", fail: "failed", skipped: "skipped", stopped: "stopped", running: "running", queued: "waiting" },
    nav: { "/ceo": "Company", "/inbox": "Inbox", "/progreso": "Progress", "/machine": "Machine" },
  },
});

// PLA-21: no weekly budgets. This week's tokens are shown, never checked.
// PLA-I46-5: used is input + output; the parts come from a server that sends them.
export type Usage = { used: number; last_week?: number; input?: number; output?: number; cache_read?: number; cache_create?: number };
export type RunnerRole = "product-owner" | "taller" | "research" | "artist" | "asistente";
export type CompanyRun = {
  id: string;
  agent: string;
  role: string;
  project: string;
  ticket: string | null;
  status: "running" | "queued";
  queued_at: string;
  started_at: string | null;
  turns: number;
  tokens: number;
};

export type RunBrief = {
  id: string;
  agent: string;
  role: string;
  project: string;
  ticket: string | null;
  status: string;
  summary: string;
  started_at: string | null;
  ended_at: string | null;
  tokens: number;
  // PLA-I30-8: a config failure ("fail: missing env X") whose X is now set.
  resolved?: boolean;
};

export type PlanState = "ok" | "warn" | "stopped" | "unknown";
export type CompanyPlan = {
  five_hour_pct: number | null;
  seven_day_pct: number | null;
  resets_at: string | null;
  seven_day_resets_at: string | null;
  guard_pct: number;
  status: string | null;
  state: PlanState;
  read_at: string | null;
  source: string | null;
  override?: boolean;
};

export type CompanyProjectRow = { slug: string; title: string; paused: boolean; paused_at: string | null; usage: Usage };
export type ProjectFacts = {
  goal: string | null;
  in_flight: number;
  blocked: number;
  last_move_at: string | null;
  po: { slug: string; name: string } | null;
  last_run: RunBrief | null;
  // PLA-I30-8: Ready tickets a runner bot would pick here. Absent on an older server.
  bot_work?: number;
};
export type PromptRef = { doc_id: string; title: string; version: number };
export type RosterRow = {
  slug: string;
  name: string;
  role: RunnerRole;
  project: string | null;
  heartbeat_minutes: number | null;
  next_wake_at: string | null;
  last_run: RunBrief | null;
};

export type Company = {
  company: { paused: boolean; paused_at: string | null };
  settings: { max_concurrent: number; cooldown_minutes: number; plan_guard_pct: number; guard_override?: boolean; reserve_tokens: number; max_turns: number; timeout_minutes: number };
  week: { starts_at: string; resets_at: string; timezone: string };
  projects: CompanyProjectRow[];
  runs: { live: CompanyRun[]; queued: CompanyRun[] };
  plan: CompanyPlan;
  // PLA-I30 extras. Optional, so an older server still renders.
  viewer?: { can_edit_limits: boolean };
  prompts?: Partial<Record<RunnerRole, PromptRef | null>>;
  roster?: RosterRow[];
  project_facts?: Record<string, ProjectFacts>;
};

// PLA-I33: what the plumbing blocks read. GET /api/company used to carry it; Máquina's plumbing does now.
export type Plumbed = Pick<Company, "company" | "settings" | "week" | "projects" | "runs" | "plan">;

export type ProjectSheetData = {
  slug: string;
  title: string;
  goal: string | null;
  pipeline: { stage: "idea" | "research" | "design" | "planning" | "ready"; count: number; newest: string | null }[];
  in_progress: { key: string; title: string; status: string; owner: string | null }[];
  blocked: { key: string; title: string; status: string; why: string }[];
  next: { key: string; title: string; priority: string | null; yours?: boolean }[];
  runs: RunBrief[];
  bot_work?: number;
};

// NEWPROJ-8: what POST /company/projects returns (NewProject in src/runner/new-project.ts): the team's agent slugs too.
export type NewProjectResult = { slug: string; key_prefix: string; paused: true; po: string; team: string[]; prompt_doc_id: string | null };

// ---- words and numbers

export const ROLE_LABEL: Record<RunnerRole, string> = {
  asistente: "Asistente",
  "product-owner": "Product owners",
  taller: "Taller",
  research: "Research",
  artist: "Artist",
};
const ROLE_SHORT: Record<string, string> = { asistente: "As", "product-owner": "PO", taller: "T", research: "R", artist: "Ar" };
export const roleInitials = (role: string) => ROLE_SHORT[role] ?? role.slice(0, 2);
export const roleWord = (role: string) => (role === "product-owner" ? "PO" : (ROLE_LABEL[role as RunnerRole] ?? role));

// 1.18M, 640k, 820. The fallback locale writes the decimal point as ".".
export function tokens(n: number): string {
  const v = Math.max(0, Math.round(n));
  if (v >= 1_000_000) return `${trim(v / 1_000_000)}M`;
  if (v >= 1_000) return `${Math.round(v / 1_000)}k`;
  return String(v);
}
const trim = (x: number) => String(Math.round(x * 100) / 100);

export const pct = (n: number | null) => (n == null ? "—" : `${Math.round(n)}%`);

export type Tone = "ok" | "warn" | "stop" | "idle";

export function clock(iso: string | null, timeZone?: string): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat(LOCALE, { hour: "2-digit", minute: "2-digit", hour12: false, timeZone }).format(new Date(iso));
}

// 0:42, 14:32, 1:02:45. Never wraps.
export function elapsed(fromIso: string | null, now: number): string {
  if (!fromIso) return "—";
  const s = Math.max(0, Math.floor((now - new Date(fromIso).getTime()) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const two = (x: number) => String(x).padStart(2, "0");
  return h > 0 ? `${h}:${two(m)}:${two(sec)}` : `${m}:${two(sec)}`;
}

/** How long ago, without the «hace»: "5 min", "3 h", "2 días"; "sin movimiento" when there is no time. */
export function agoSpan(iso: string | null, now: number, language: Language = getLanguage()): string {
  const w = words(COMPANIA_LIB_WORDS, language);
  if (!iso) return w.noMove;
  const min = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (min < 1) return w.moment;
  if (min < 60) return w.minutes(min);
  const h = Math.round(min / 60);
  if (h < 48) return w.hours(h);
  return w.days(Math.round(h / 24));
}

export function ago(iso: string | null, now: number, language: Language = getLanguage()): string {
  const w = words(COMPANIA_LIB_WORDS, language);
  return iso ? w.ago(agoSpan(iso, now, language)) : w.noMove;
}

// ---- the banners (5e, 5g, 5h), shown in Máquina since PLA-I33-3

export type Banner =
  | { kind: "paused"; since: string | null }
  | { kind: "plan"; plan: CompanyPlan; waiting: number };

export function bannersOf(c: Plumbed): Banner[] {
  const out: Banner[] = [];
  if (c.company.paused) out.push({ kind: "paused", since: c.company.paused_at });
  if (!c.company.paused && c.plan.state === "stopped") out.push({ kind: "plan", plan: c.plan, waiting: c.runs.queued.length });
  return out;
}

// Copy for the banners, kept here so the tests pin the words and that there is no money in them.
export function planBannerText(plan: CompanyPlan, timeZone?: string, language: Language = getLanguage()): string {
  const w = words(COMPANIA_LIB_WORDS, language);
  const head = plan.five_hour_pct == null ? w.planHead : `${pct(plan.five_hour_pct)}`;
  const until = plan.resets_at ? w.until(clock(plan.resets_at, timeZone)) : w.untilDown;
  return w.planBanner(head, until);
}

export function pausedBannerText(since: string | null, timeZone?: string, language: Language = getLanguage()): string {
  const w = words(COMPANIA_LIB_WORDS, language);
  return since ? w.pausedSince(clock(since, timeZone)) : w.paused;
}

// What the En marcha header says, so an empty list never looks like a failure.
export function capLine(c: Plumbed, language: Language = getLanguage()): string {
  const w = words(COMPANIA_LIB_WORDS, language);
  const cap = w.cap(c.settings.max_concurrent);
  return c.runs.queued.length ? w.capWaiting(cap, c.runs.queued.length) : cap;
}

export function idleLine(c: Plumbed, language: Language = getLanguage()): string {
  const w = words(COMPANIA_LIB_WORDS, language);
  if (c.company.paused) return w.idlePaused;
  if (c.plan.state === "stopped") return w.idlePlan(c.runs.queued.length);
  if (c.projects.length > 0 && c.projects.every((p) => p.paused)) return w.idleAllPaused;
  return w.idle;
}

/** The Spanish line, kept for its readers; the screen reads planUnknownText(). */
export const planUnknownLine = COMPANIA_LIB_WORDS.es.planUnknown;
export const planUnknownText = (language: Language = getLanguage()): string => words(COMPANIA_LIB_WORDS, language).planUnknown;

/** A run's outcome in Spanish, kept for its readers; the screen reads runWord(). */
export const RUN_WORD: Record<string, string> = COMPANIA_LIB_WORDS.es.run;
export const runWord = (status: string, language: Language = getLanguage()): string => words(COMPANIA_LIB_WORDS, language).run[status] ?? status;

// The URL state (PLA-I33): ?vista=<slug> previews a project, ?doc=<id> a doc, ?nuevo the new project dialog.
// ?p=<slug> (the old project sheet) redirects to /p/<slug>; ?equipo (the old Equipo sheet) to Máquina.
// PLA-I39-6: the building's side page is in the address too: ?m=<slug>:<agent> a teammate, ?plan=<slug> the plan,
// ?add=<slug> adding someone. A link reopens it.
export type SheetParam =
  | { kind: "project"; slug: string }
  | { kind: "vista"; slug: string }
  | { kind: "equipo" }
  | { kind: "doc"; id: string }
  | { kind: "nuevo" }
  | { kind: "member"; slug: string; agent: string }
  | { kind: "plan"; slug: string }
  | { kind: "add"; slug: string }
  | { kind: "asistente" }
  | null;
export function sheetOf(search: string): SheetParam {
  const q = new URLSearchParams(search);
  const m = q.get("m");
  if (m && m.includes(":")) {
    const [slug, agent] = [m.slice(0, m.indexOf(":")), m.slice(m.indexOf(":") + 1)];
    if (slug && agent) return { kind: "member", slug, agent };
  }
  const plan = q.get("plan");
  if (plan) return { kind: "plan", slug: plan };
  const add = q.get("add");
  if (add) return { kind: "add", slug: add };
  if (q.has("asistente")) return { kind: "asistente" };
  const p = q.get("p");
  if (p) return { kind: "project", slug: p };
  const vista = q.get("vista");
  if (vista) return { kind: "vista", slug: vista };
  const doc = q.get("doc");
  if (doc) return { kind: "doc", id: doc };
  if (q.has("equipo")) return { kind: "equipo" };
  if (q.has("nuevo")) return { kind: "nuevo" };
  return null;
}
export const sheetSearch = (sheet: Exclude<SheetParam, null>): string =>
  sheet.kind === "member"
    ? `?m=${encodeURIComponent(sheet.slug)}:${encodeURIComponent(sheet.agent)}`
    : sheet.kind === "plan"
      ? `?plan=${encodeURIComponent(sheet.slug)}`
      : sheet.kind === "add"
        ? `?add=${encodeURIComponent(sheet.slug)}`
        : sheet.kind === "asistente"
          ? "?asistente"
          : "";
// /ceo?p=<slug> → /p/<slug>; /ceo?equipo → /machine. Null when /ceo stays.
export function ceoRedirect(search: string): string | null {
  const sheet = sheetOf(search);
  if (sheet?.kind === "project" || sheet?.kind === "vista") return `/p/${encodeURIComponent(sheet.slug)}`;
  if (sheet?.kind === "equipo") return "/machine";
  return null;
}
// Old routes (PLA-I30-2). /goals scrolls to the team cards; /equipo goes to Máquina, where the plumbing lives (PLA-I33).
export const LEGACY_REDIRECTS: Record<string, string> = {
  "/ahora": "/ceo",
  "/goals": "/ceo#proyectos",
  "/equipo": "/machine",
};

// The header: Inicio is the logo, then these four. NAV keeps the Spanish labels; the header reads navItems().
const NAV_PATHS = ["/ceo", "/inbox", "/progreso", "/machine"] as const;
export const navItems = (language: Language = getLanguage()): { to: string; label: string }[] =>
  NAV_PATHS.map((to) => ({ to, label: words(COMPANIA_LIB_WORDS, language).nav[to]! }));
export const NAV: { to: string; label: string }[] = navItems("es");
