// PLA-I35: the words of Compañía v2 (Design afdb15dd v2, canvas docs/company-mockups/compania-v2.html). Pure: the
// page and test/compania-v2.test.ts read the same functions. A decision lives in Te toca only; the card and
// Asistente point to it. Never "Sin corridas todavía", never a null key: when there is nothing to say, the line
// does not exist. Spend is tokens, never money.
import { ago, tokens, type Tone } from "./compania";
import type { Decision, DecisionState, OrgOrder, OrgPlan, OrgProject, ThreadMessage } from "./api";
import { roleName } from "./org";

export const TE_TOCA_MAX = 5;
export const TE_TOCA_EMPTY = "Nada te espera. El equipo sigue; Asistente te avisa cuando haga falta.";

// ---- Te toca

// A release has no button here (publishing asks for the owner's code in Bandeja) and still waits.
export const pending = (d: Decision) => d.state === null && (d.actions.length > 0 || d.kind === "release");

// PLA-I36-2: "Nada te espera" only when Bandeja's decisiones and pasos are empty too.
export function teTocaEmpty(inbox: { decisiones: number; pasos: number } | undefined): string {
  const n = (inbox?.decisiones ?? 0) + (inbox?.pasos ?? 0);
  if (n === 0) return TE_TOCA_EMPTY;
  return `Nada urgente aquí · ${n === 1 ? "1 cosa te espera" : `${n} cosas te esperan`} en Bandeja.`;
}

// "2 checks abiertos · pruebas fallando"; null when there is nothing to say.
export function checksText(d: Pick<Decision, "checks">): { text: string; tone: Tone; open: boolean } | null {
  const c = d.checks;
  if (!c) return null;
  const parts: string[] = [];
  if (c.open > 0) parts.push(c.open === 1 ? "1 check abierto" : `${c.open} checks abiertos`);
  if (c.ci === "failure") parts.push("pruebas fallando");
  else if (c.ci === "pending") parts.push("pruebas corriendo");
  else if (c.ci === "success") parts.push("pruebas en verde");
  if (parts.length === 0) return c.open === 0 && c.ci === null ? null : { text: "checks completos", tone: "ok", open: false };
  const open = c.open > 0 || c.ci === "failure" || c.ci === "pending";
  return { text: parts.join(" · "), tone: c.ci === "failure" ? "stop" : open ? "warn" : "ok", open };
}

// "4 commits · 3 cambios · 1 check abierto · 1 paso antes".
export function releaseText(d: Pick<Decision, "release">): string | null {
  const r = d.release;
  if (!r) return null;
  return [
    r.ahead == null ? "sin datos de GitHub" : r.ahead === 1 ? "1 commit" : `${r.ahead} commits`,
    r.tickets.length === 1 ? "1 cambio" : `${r.tickets.length} cambios`,
    r.open_checks ? (r.open_checks === 1 ? "1 check abierto" : `${r.open_checks} checks abiertos`) : "",
    r.before ? (r.before === 1 ? "1 paso antes" : `${r.before} pasos antes`) : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

// The first five rows (acted rows keep their place), how many wait, and how many more Bandeja holds.
export function teToca(decisions: Decision[]): { rows: Decision[]; waiting: number; more: number } {
  const rows = decisions.slice(0, TE_TOCA_MAX);
  return { rows, waiting: decisions.filter(pending).length, more: Math.max(0, decisions.length - rows.length) };
}

// The recommended option first; the rest in their order.
export const ordered = (d: Decision) => [...(d.options ?? [])].sort((a, b) => Number(b.recommended) - Number(a.recommended) || a.n - b.n);

const WAKE: Record<string, string> = {
  queued: "el PO despierta en su turno",
  busy: "el PO lo toma al terminar lo que corre",
  paused: "el proyecto está en pausa: lo ve al reanudar",
  off: "el PO lo ve al despertar",
  no_agent: "el proyecto no tiene PO",
};

const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");

// "✓ Elegiste 1 · Planear el formulario · el PO despierta en su turno".
export function stateText(s: DecisionState): string {
  const r = s.result ?? {};
  const ticket = str(r.ticket);
  switch (s.action) {
    case "elegir": {
      const option = Array.isArray(r.option) ? r.option.join(" + ") : str(r.option);
      const label = str(r.label) || str(r.answer);
      return ["Elegiste" + (option ? ` ${option}` : ""), label, WAKE[str(r.wake)] ?? ""].filter(Boolean).join(" · ");
    }
    case "responder":
      return ["Respondiste", str(r.text) || str(r.answer), WAKE[str(r.wake)] ?? ""].filter(Boolean).join(" · ");
    case "hecho":
      return ["Hecho", ticket].filter(Boolean).join(" · ");
    case "aplazar":
      return ["Aplazado", ticket && `${ticket} vuelve al backlog`].filter(Boolean).join(" · ");
    case "aceptar":
      return r.merged ? "Fusionado a sandbox" : ["Aceptado", ticket].filter(Boolean).join(" · ");
    case "fusionar":
      return "Fusionado a sandbox";
    case "cambios":
      return ["Cambios pedidos", ticket].filter(Boolean).join(" · ");
    default:
      return "Hecho";
  }
}

export const KIND_POINTER: Record<string, string> = {
  question: "↑ Responder en Te toca",
  proposal: "↑ Decidir en Te toca",
  step: "↑ Un paso tuyo en Te toca",
  release: "↑ Listo para publicar en Te toca",
};
// The card's pointer when its project has a decision waiting.
export const pointerFor = (decisions: Decision[], slug: string): string | null => {
  const d = decisions.find((x) => x.project === slug && pending(x));
  if (!d) return null;
  return KIND_POINTER[d.kind] ?? "↑ Decidir en Te toca";
};

// ---- the card as a report

const MONTH = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", timeZone: "UTC" });
export const shortDate = (day: string) => MONTH.format(new Date(`${day}T12:00:00Z`)).replace(".", "");

export function paceText(plan: OrgPlan): { text: string; tone: Tone } | null {
  if (!plan.pace) return null;
  const due = plan.due_on ? ` · entrega ${shortDate(plan.due_on)}` : "";
  if (plan.pace === "ok") return { text: `a tiempo${due}`, tone: "ok" };
  const n = plan.weeks_behind ?? 1;
  return { text: `${n === 1 ? "1 semana" : `${n} semanas`} atrás${due}`, tone: plan.pace === "late" ? "warn" : "stop" };
}

// PLA-I36-5: one bar, two marks. null without a delivery date: no fake weeks.
export function calendarBar(plan: OrgPlan): { weeks: number; today: number; done: number; line: string } | null {
  if (plan.weeks == null || plan.today_pct == null || plan.done_pct == null) return null;
  const gap = plan.today_pct - plan.done_pct;
  const behind = plan.weeks_behind ?? 0;
  const line =
    behind > 0
      ? `Hoy va al ${plan.today_pct}% del tiempo y la obra al ${plan.done_pct}%: ${behind === 1 ? "1 semana" : `${behind} semanas`} atrás`
      : gap <= 0
        ? `La obra (${plan.done_pct}%) va por delante del tiempo (${plan.today_pct}%)`
        : `La obra (${plan.done_pct}%) va con el tiempo (${plan.today_pct}%)`;
  return { weeks: plan.weeks, today: plan.today_pct, done: plan.done_pct, line };
}

// PLA-I36-4: Rumbo. The goal sentence, the delivery date and the forecast; or what is missing.
export function rumboText(p: OrgProject): { goal: string | null; date: string | null; forecast: { text: string; tone: Tone } | null; missing: boolean } {
  const r = p.rumbo;
  if (!r || r.missing) return { goal: r?.goal ?? null, date: r?.target_on ? shortDate(r.target_on) : null, forecast: null, missing: true };
  const behind = r.weeks_behind ?? 0;
  const forecast = r.forecast_on
    ? behind > 0
      ? { text: `pronóstico ${shortDate(r.forecast_on)}`, tone: (behind === 1 ? "warn" : "stop") as Tone }
      : { text: "a tiempo", tone: "ok" as Tone }
    : null;
  return { goal: r.goal, date: shortDate(r.target_on!), forecast, missing: false };
}
export const RUMBO_MISSING = "Sin meta ni fecha";

export function thisWeekText(p: OrgProject, now: number): string {
  const w = p.this_week;
  const parts = [
    w.done ? `${w.done} ${w.done === 1 ? "hecho" : "hechos"}` : "",
    w.docs ? `${w.docs} ${w.docs === 1 ? "doc" : "docs"}` : "",
    w.prs ? `${w.prs} ${w.prs === 1 ? "PR" : "PRs"}` : "",
  ].filter(Boolean);
  if (parts.length) return `Esta semana: ${parts.join(" · ")}`;
  return w.last_at ? `Esta semana: nada · la última vez, ${ago(w.last_at, now)}` : "Esta semana: nada todavía";
}

export const ownerChip = (owner: string): { text: string; jorge: boolean } =>
  owner === "jorge" ? { text: "te toca", jorge: true } : { text: owner === "po" ? "PO" : roleName(owner), jorge: false };

// "Quieto 3 días" from the last event.
export function lightWord(p: OrgProject, base: string, now: number): string {
  if (p.light !== "quiet" || !p.this_week.last_at) return base;
  const days = Math.floor((now - new Date(p.this_week.last_at).getTime()) / 86_400_000);
  return days >= 1 ? `${base} ${days === 1 ? "1 día" : `${days} días`}` : base;
}

// The PO's last line, when the last message in the thread is not Jorge's.
export function poLine(p: OrgProject): { role: string; at: string; body: string } | null {
  const last = p.thread.last;
  if (!last || last.author_role === "ceo" || last.author_role === "jorge" || !last.body.trim()) return null;
  return { role: last.author_role, at: last.at, body: last.body };
}

// Ahora: who runs or is stuck. Nobody: why, in a few words.
// PLA-I36-1: a member whose last run failed says so ("su última corrida falló").
export function nowLines(p: OrgProject): { role: string; text: string; tone: Tone; since: string | null }[] {
  return p.team
    .filter((m) => m.state === "running" || m.state === "waiting_jorge" || (m.state !== "paused" && m.last?.status === "fail"))
    .map((m) =>
      m.state === "running"
        ? { role: roleName(m.role), text: m.now?.ticket ? `construye ${m.now.ticket}` : "trabaja", tone: "ok" as Tone, since: m.now?.since ?? null }
        : m.state === "waiting_jorge"
          ? { role: roleName(m.role), text: m.waiting ? `espera: ${m.waiting}` : "te espera", tone: "stop" as Tone, since: null }
          : { role: roleName(m.role), text: "su última corrida falló", tone: "stop" as Tone, since: m.last?.at ?? null },
    );
}
export function nobodyWhy(p: OrgProject, decisions: Decision[], companyPaused: boolean): string {
  if (companyPaused) return "la compañía está detenida";
  if (p.light === "no_budget") return "sin presupuesto esta semana";
  if (p.light === "failed") return "la última corrida falló";
  if (p.light === "blocked") return "el trabajo está bloqueado";
  const d = decisions.find((x) => x.project === p.slug && pending(x));
  if (d)
    return d.kind === "question"
      ? "el PO espera tu respuesta"
      : d.kind === "action" || d.kind === "step"
        ? "lo siguiente es tuyo"
        : d.kind === "release"
          ? "hay cambios listos para publicar"
          : "el PO espera tu elección";
  if (!p.next) return "sin trabajo listo";
  if (p.next.owner === "jorge") return "lo siguiente es tuyo";
  return "lo siguiente arranca en su turno";
}

// ---- Tus órdenes (PLA-I36-3)

export function orderText(o: OrgOrder, now: number): { text: string; tone: Tone } {
  switch (o.state) {
    case "entregada":
      return { text: "entregada", tone: "ok" };
    case "en_curso":
      return { text: o.who ? `en curso · ${roleName(o.who)}` : "en curso", tone: "ok" };
    case "entendida":
      return { text: "entendida", tone: "idle" };
    case "sin_tomar": {
      const h = o.age_h ?? 0;
      return { text: `sin tomar · ${h >= 48 ? `${Math.floor(h / 24)} días` : `${h} h`}`, tone: "warn" };
    }
    case "cancelada":
      return { text: "cancelada", tone: "idle" };
    default:
      return { text: `enviada · ${ago(o.at, now)}`, tone: "idle" };
  }
}

// ---- En pausa

export function pausedText(p: OrgProject, now: number): string {
  const open = p.work.open;
  const head = open === 0 ? "Sin trabajo abierto" : `${open} ${open === 1 ? "ticket abierto guardado" : "tickets abiertos guardados"}`;
  if (!p.this_week.last_at) return head;
  const days = Math.floor((now - new Date(p.this_week.last_at).getTime()) / 86_400_000);
  return days >= 1 ? `${head} · quieto ${days === 1 ? "1 día" : `${days} días`}` : head;
}

// ---- the company line under the greeting: "Mianovia avanza, cinco proyectos en pausa"

const NUM = ["cero", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez"];
const num = (n: number) => NUM[n] ?? String(n);
export function companyLine(projects: OrgProject[]): string {
  const live = projects.filter((p) => !p.paused && p.light !== "paused");
  const paused = projects.length - live.length;
  const names = live.map((p) => p.title);
  const head =
    names.length === 0 ? "Nada avanza" : names.length === 1 ? `${names[0]} avanza` : names.length <= 3 ? `${names.slice(0, -1).join(", ")} y ${names.at(-1)} avanzan` : `${num(names.length)} proyectos avanzan`;
  if (paused === 0) return head;
  return `${head}, ${paused === 1 ? "uno en pausa" : `${num(paused)} proyectos en pausa`}`;
}

// ---- Asistente folded

const dayKey = (iso: string, timeZone?: string) => new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone }).format(new Date(iso));
export function todayMessages(messages: ThreadMessage[], now: number, timeZone?: string): ThreadMessage[] {
  const today = dayKey(new Date(now).toISOString(), timeZone);
  return messages.filter((m) => dayKey(m.at, timeZone) === today);
}
// Asistente's latest message (the answer or the 07:00 brief), not Jorge's.
export function latestFromAsistente(messages: ThreadMessage[]): ThreadMessage | null {
  const mine = (m: ThreadMessage) => m.author.agent === "jorge" || m.author.role === "ceo" || m.author.role === "jorge";
  return [...messages].sort((a, b) => b.at.localeCompare(a.at)).find((m) => !mine(m)) ?? null;
}
export const foldLine = (n: number) => `Conversación de hoy · ${n === 1 ? "1 mensaje" : `${n} mensajes`}`;
export const SUGGESTIONS = (projects: OrgProject[]) => {
  const first = projects.find((p) => !p.paused)?.title ?? projects[0]?.title;
  return [first ? `¿Cómo va ${first}?` : "¿Cómo va todo?", "¿Qué espera de mí?", ...(first ? [`${first}: `] : [])];
};

export { tokens };
