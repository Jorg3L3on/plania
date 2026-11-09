// PLA-I30 Compañía's model, kept for the plumbing (budgets, plan, runs) that moved to Máquina in PLA-I33
// and for the shared words and numbers. The organization's shapes (PLA-I33) are in api.ts and org.ts.
// Pure and relative imports only, so test/compania.test.ts loads it with node:test. Tokens, never money.

export type BudgetState = "ok" | "warn" | "stopped";
export type Budget = { used: number; limit: number | null; pct: number | null; state: BudgetState; reason: "unset" | "usage_unknown" | null };
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
};

export type CompanyProjectRow = { slug: string; title: string; paused: boolean; paused_at: string | null; budget: Budget };
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
  settings: { max_concurrent: number; cooldown_minutes: number; plan_guard_pct: number; reserve_tokens: number; max_turns: number; timeout_minutes: number };
  week: { starts_at: string; resets_at: string; timezone: string };
  projects: CompanyProjectRow[];
  roles: { role: string; budget: Budget }[];
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

export type NewProjectResult = { slug: string; key_prefix: string; paused: true; po: string; prompt_doc_id: string | null };

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

// 1.18M, 640k, 820. es-MX writes the decimal point as ".".
export function tokens(n: number): string {
  const v = Math.max(0, Math.round(n));
  if (v >= 1_000_000) return `${trim(v / 1_000_000)}M`;
  if (v >= 1_000) return `${Math.round(v / 1_000)}k`;
  return String(v);
}
const trim = (x: number) => String(Math.round(x * 100) / 100);

export const pct = (n: number | null) => (n == null ? "—" : `${Math.round(n)}%`);

export function usedOfLimit(b: Budget): string {
  return b.limit == null ? `${tokens(b.used)} · sin límite` : `${tokens(b.used)} / ${tokens(b.limit)}`;
}

// The fill of a meter, clamped to 0–100.
export const fill = (b: Budget) => (b.limit == null || b.limit <= 0 ? 0 : Math.min(100, Math.max(0, (b.used / b.limit) * 100)));

export type Tone = "ok" | "warn" | "stop" | "idle";
export function meterTone(b: Budget): Tone {
  if (b.reason === "unset") return "idle";
  if (b.state === "stopped") return "stop";
  if (b.state === "warn") return "warn";
  return "ok";
}

export function clock(iso: string | null, timeZone?: string): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("es-MX", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone }).format(new Date(iso));
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

export function ago(iso: string | null, now: number): string {
  if (!iso) return "sin movimiento";
  const min = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (min < 1) return "hace un momento";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} días`;
}

// ---- the banners (5e, 5g, 5h), shown in Máquina since PLA-I33-3

export type Banner =
  | { kind: "paused"; since: string | null }
  | { kind: "budget"; project: CompanyProjectRow }
  | { kind: "plan"; plan: CompanyPlan; waiting: number };

export function bannersOf(c: Plumbed): Banner[] {
  const out: Banner[] = [];
  if (c.company.paused) out.push({ kind: "paused", since: c.company.paused_at });
  for (const p of c.projects) {
    if (!p.paused && p.budget.state === "stopped" && p.budget.reason === null) out.push({ kind: "budget", project: p });
  }
  if (!c.company.paused && c.plan.state === "stopped") out.push({ kind: "plan", plan: c.plan, waiting: c.runs.queued.length });
  return out;
}

// Copy for the banners, kept here so the tests pin the words and that there is no money in them.
export function budgetBannerText(p: CompanyProjectRow): string {
  return `${pct(p.budget.pct)} · ${p.title} llegó a su límite semanal · ${usedOfLimit(p.budget)} · nada nuevo arranca ahí hasta el lunes 00:00 · los demás siguen`;
}

export function planBannerText(plan: CompanyPlan, timeZone?: string): string {
  const head = plan.five_hour_pct == null ? "El plan" : `${pct(plan.five_hour_pct)}`;
  const until = plan.resets_at ? `hasta ${clock(plan.resets_at, timeZone)}` : "hasta que baje";
  return `${head} · la ventana de 5 h pasó el guardia · no arrancan corridas nuevas ${until} para que te quede plan a ti · las que corren terminan su paso`;
}

export function pausedBannerText(since: string | null, timeZone?: string): string {
  return since ? `La compañía está detenida · desde ${clock(since, timeZone)}, por ti` : "La compañía está detenida, por ti";
}

// What the En marcha header says, so an empty list never looks like a failure.
export function capLine(c: Plumbed): string {
  const cap = `Tope: ${c.settings.max_concurrent} a la vez`;
  return c.runs.queued.length ? `${cap} · ${c.runs.queued.length} en espera` : cap;
}

export function idleLine(c: Plumbed): string {
  if (c.company.paused) return "Nada corre: la compañía está detenida.";
  if (c.plan.state === "stopped") return `Nada arranca: ${c.runs.queued.length} en espera del guardia.`;
  if (c.projects.length > 0 && c.projects.every((p) => p.paused)) return "Nada corre: todos los proyectos están en pausa.";
  return "Nada corre.";
}

export const planUnknownLine = "No se pudo leer el uso del plan. Desconocido = alto: no arranca nada nuevo.";

export const RUN_WORD: Record<string, string> = { ok: "ok", fail: "falló", skipped: "omitida", stopped: "detenida", running: "corriendo", queued: "en espera" };

// The URL state (PLA-I33): ?vista=<slug> previews a project, ?doc=<id> a doc, ?nuevo the new project dialog.
// ?p=<slug> (the old project sheet) redirects to /p/<slug>; ?equipo (the old Equipo sheet) to Máquina.
export type SheetParam = { kind: "project"; slug: string } | { kind: "vista"; slug: string } | { kind: "equipo" } | { kind: "doc"; id: string } | { kind: "nuevo" } | null;
export function sheetOf(search: string): SheetParam {
  const q = new URLSearchParams(search);
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

// The header: Inicio is the logo, then these four.
export const NAV: { to: string; label: string }[] = [
  { to: "/ceo", label: "Compañía" },
  { to: "/inbox", label: "Bandeja" },
  { to: "/progreso", label: "Progreso" },
  { to: "/machine", label: "Máquina" },
];
