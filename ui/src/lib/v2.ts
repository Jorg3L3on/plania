// PLA-I35: the words of Compañía v2 (Design afdb15dd v2, canvas docs/company-mockups/compania-v2.html). Pure: the
// page and test/compania-v2.test.ts read the same functions. A decision lives in Te toca only; the card and
// Asistente point to it. Never "Sin corridas todavía", never a null key: when there is nothing to say, the line
// does not exist. Spend is tokens, never money.
import { ago, tokens, type Tone } from "./compania";
import type { AskResult, Decision, DecisionState, OrderKind, OrderStage, OrgOrder, OrgPlan, OrgProject, OrgRun, ThreadMessage } from "./api";
import { roleName } from "./org";
import { LOCALE } from "./locale.js";
import { getLanguage, words, type Language } from "./i18n.js";
import { V2_WORDS } from "./v2-words";
// PLA-I2-10: the words are in V2_WORDS (lib/v2-words.ts), in both languages; the functions that return words take
// the language last, the screen's by default. The exported constants keep their Spanish for the tests.
const W = (language: Language) => words(V2_WORDS, language);

export const TE_TOCA_MAX = 5;
export const TE_TOCA_EMPTY = V2_WORDS.es.teTocaEmpty;

// ---- Te toca

// A release has no button here (publishing asks for the owner's code in Bandeja) and still waits.
// PLA-I46-11: a plan left for later (Después) waits on its floor but is not Te toca.
export const waitingPlan = (d: Decision) => d.state === null && d.kind === "plan" && !!d.plan?.later_at;
export const pending = (d: Decision) => d.state === null && !waitingPlan(d) && (d.actions.length > 0 || d.kind === "release");

// PLA-I36-2: "Nada te espera" only when Bandeja's decisiones and pasos are empty too.
export function teTocaEmpty(inbox: { decisiones: number; pasos: number } | undefined, language: Language = getLanguage()): string {
  const n = (inbox?.decisiones ?? 0) + (inbox?.pasos ?? 0);
  if (n === 0) return W(language).teTocaEmpty;
  return W(language).nothingUrgent(n);
}

// "2 checks abiertos · pruebas fallando"; null when there is nothing to say.
export function checksText(d: Pick<Decision, "checks">, language: Language = getLanguage()): { text: string; tone: Tone; open: boolean } | null {
  const w = W(language);
  const c = d.checks;
  if (!c) return null;
  const parts: string[] = [];
  if (c.open > 0) parts.push(w.openChecks(c.open));
  if (c.ci === "failure") parts.push(w.testsFailing);
  else if (c.ci === "pending") parts.push(w.testsRunning);
  else if (c.ci === "success") parts.push(w.testsGreen);
  else if (c.ci === "none") parts.push(w.noCi);
  if (parts.length === 0) return c.open === 0 && c.ci === null ? null : { text: w.checksDone, tone: "ok", open: false };
  const open = c.open > 0 || c.ci === "failure" || c.ci === "pending";
  // PLA-23: a repo with no CI is neither good nor bad news: neutral, unless something else is open.
  const tone: Tone = c.ci === "failure" ? "stop" : open ? "warn" : c.ci === "none" ? "idle" : "ok";
  return { text: parts.join(" · "), tone, open };
}

// "4 commits · 3 cambios · 1 check abierto · 1 paso antes".
export function releaseText(d: Pick<Decision, "release">, language: Language = getLanguage()): string | null {
  const w = W(language);
  const r = d.release;
  if (!r) return null;
  return [
    r.ahead == null ? w.noGithub : w.commits(r.ahead),
    w.changes(r.tickets.length),
    r.open_checks ? w.openChecks(r.open_checks) : "",
    r.before ? w.stepsBefore(r.before) : "",
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

const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");

// "✓ Elegiste 1 · Planear el formulario · el PO despierta en su turno".
export function stateText(s: DecisionState, language: Language = getLanguage()): string {
  const w = W(language);
  const WAKE = w.wake;
  const r = s.result ?? {};
  const ticket = str(r.ticket);
  switch (s.action) {
    case "elegir": {
      const option = Array.isArray(r.option) ? r.option.join(" + ") : str(r.option);
      const label = str(r.label) || str(r.answer);
      return [w.chose(option), label, WAKE[str(r.wake)] ?? ""].filter(Boolean).join(" · ");
    }
    case "responder":
      return [w.answered, str(r.text) || str(r.answer), WAKE[str(r.wake)] ?? ""].filter(Boolean).join(" · ");
    case "hecho":
      return w.done;
    case "aplicar": {
      const n = typeof r.added === "number" ? r.added : 0;
      const at = [str(r.path), str(r.branch) && w.onBranch(str(r.branch))].filter(Boolean).join(" ");
      const commit = str(r.commit) ? ` (${str(r.commit).slice(0, 7)})` : "";
      const base = n ? w.addedToPr(n, at, commit) : w.alreadyInPr(at);
      // A new commit on a delivery with no CI: its owner was asked to run the checks again (or why not).
      const v = str(r.verify);
      if (!v) return base;
      return v === "taller" || v === "product-owner" ? w.testsAgain(base, v === "taller" ? w.taller : w.thePo) : `${base} · ${v}`;
    }
    case "aplazar":
      return w.postponed;
    case "aceptar":
      return r.already ? w.alreadyApproved : r.merged ? w.approvedCopy : w.approvedClosed;
    case "fusionar":
      return w.approvedCopy;
    case "empezar": {
      const n = Array.isArray(r.created) ? r.created.length : 0;
      return w.started(n);
    }
    case "cambiar":
      return w.youChange;
    case "cancelar":
      return w.canceled;
    case "cambios":
      return w.changesAsked;
    default:
      return w.done;
  }
}

export const KIND_POINTER: Record<string, string> = V2_WORDS.es.kindPointer;
// The card's pointer when its project has a decision waiting.
export const pointerFor = (decisions: Decision[], slug: string, language: Language = getLanguage()): string | null => {
  const d = decisions.find((x) => x.project === slug && pending(x));
  if (!d) return null;
  return W(language).kindPointer[d.kind] ?? W(language).decidePointer;
};

// ---- the card as a report

const MONTH = new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "short", timeZone: "UTC" });
export const shortDate = (day: string) => MONTH.format(new Date(`${day}T12:00:00Z`)).replace(".", "");

export function paceText(plan: OrgPlan, language: Language = getLanguage()): { text: string; tone: Tone } | null {
  const w = W(language);
  if (!plan.pace) return null;
  const due = plan.due_on ? w.due(shortDate(plan.due_on)) : "";
  if (plan.pace === "ok") return { text: w.onTime(due), tone: "ok" };
  const n = plan.weeks_behind ?? 1;
  return { text: w.behind(n, due), tone: plan.pace === "late" ? "warn" : "stop" };
}

// PLA-I36-5: one bar, two marks. null without a delivery date: no fake weeks.
export function calendarBar(plan: OrgPlan, language: Language = getLanguage()): { weeks: number; today: number; done: number; line: string } | null {
  const w = W(language);
  if (plan.weeks == null || plan.today_pct == null || plan.done_pct == null) return null;
  const gap = plan.today_pct - plan.done_pct;
  const behind = plan.weeks_behind ?? 0;
  const line =
    behind > 0
      ? w.calendarBehind(plan.today_pct, plan.done_pct, behind)
      : gap <= 0
        ? w.calendarAhead(plan.done_pct, plan.today_pct)
        : w.calendarEven(plan.done_pct, plan.today_pct);
  return { weeks: plan.weeks, today: plan.today_pct, done: plan.done_pct, line };
}

// PLA-I36-4: Rumbo. The goal sentence, the delivery date and the forecast; or what is missing.
export function rumboText(p: OrgProject, language: Language = getLanguage()): { goal: string | null; date: string | null; forecast: { text: string; tone: Tone } | null; missing: boolean } {
  const w = W(language);
  const r = p.rumbo;
  if (!r || r.missing) return { goal: r?.goal ?? null, date: r?.target_on ? shortDate(r.target_on) : null, forecast: null, missing: true };
  const behind = r.weeks_behind ?? 0;
  const forecast = r.forecast_on
    ? behind > 0
      ? { text: w.forecast(shortDate(r.forecast_on)), tone: (behind === 1 ? "warn" : "stop") as Tone }
      : { text: w.onTime(""), tone: "ok" as Tone }
    : null;
  return { goal: r.goal, date: shortDate(r.target_on!), forecast, missing: false };
}
export const RUMBO_MISSING = V2_WORDS.es.rumboMissing;

export function thisWeekText(p: OrgProject, now: number, language: Language = getLanguage()): string {
  const t = W(language);
  const w = p.this_week;
  const parts = [
    w.done ? t.doneCount(w.done) : "",
    w.docs ? `${w.docs} ${w.docs === 1 ? "doc" : "docs"}` : "",
    w.prs ? `${w.prs} ${w.prs === 1 ? "PR" : "PRs"}` : "",
  ].filter(Boolean);
  if (parts.length) return t.thisWeek(parts.join(" · "));
  return w.last_at ? t.thisWeekLast(ago(w.last_at, now, language)) : t.thisWeekNothing;
}

export const ownerChip = (owner: string, language: Language = getLanguage()): { text: string; mine: boolean } =>
  owner === "owner" ? { text: W(language).yourTurn, mine: true } : { text: owner === "po" ? "PO" : roleName(owner), mine: false };

// "Quieto 3 días" from the last event.
export function lightWord(p: OrgProject, base: string, now: number, language: Language = getLanguage()): string {
  if (p.light !== "quiet" || !p.this_week.last_at) return base;
  const days = Math.floor((now - new Date(p.this_week.last_at).getTime()) / 86_400_000);
  return days >= 1 ? `${base} ${W(language).days(days)}` : base;
}

// The PO's last line, when the last message in the thread is not the owner's.
export function poLine(p: OrgProject): { role: string; at: string; body: string } | null {
  const last = p.thread.last;
  if (!last || last.author_role === "ceo" || last.author_role === "owner" || !last.body.trim()) return null;
  return { role: last.author_role, at: last.at, body: last.body };
}

// Ahora: who runs or is stuck. Nobody: why, in a few words.
// PLA-I36-1: a member whose last run failed says so ("su última corrida falló").
export function nowLines(p: OrgProject, language: Language = getLanguage()): { role: string; text: string; tone: Tone; since: string | null }[] {
  const w = W(language);
  return p.team
    .filter((m) => m.state === "running" || m.state === "waiting_owner" || (m.state !== "paused" && m.last?.status === "fail"))
    .map((m) =>
      m.state === "running"
        ? { role: roleName(m.role), text: w.works, tone: "ok" as Tone, since: m.now?.since ?? null }
        : m.state === "waiting_owner"
          ? { role: roleName(m.role), text: m.waiting ? w.waitsFor(m.waiting) : w.waitsForYou, tone: "stop" as Tone, since: null }
          : { role: roleName(m.role), text: w.lastRunFailedIts, tone: "stop" as Tone, since: m.last?.at ?? null },
    );
}
export function nobodyWhy(p: OrgProject, decisions: Decision[], companyPaused: boolean, language: Language = getLanguage()): string {
  const w = W(language);
  if (companyPaused) return w.companyStopped;
  if (p.light === "failed") return w.lastRunFailed;
  if (p.light === "blocked") return w.workBlocked;
  const d = decisions.find((x) => x.project === p.slug && pending(x));
  if (d)
    return d.kind === "question"
      ? w.poWaitsAnswer
      : d.kind === "action" || d.kind === "step"
        ? w.nextIsYours
        : d.kind === "release"
          ? w.readyToPublish
          : w.poWaitsChoice;
  if (!p.next) return w.noWorkReady;
  if (p.next.owner === "owner") return w.nextIsYours;
  return w.nextOnTurn;
}

// ---- Tus órdenes (PLA-I36-3)

export function orderText(o: OrgOrder, now: number, language: Language = getLanguage()): { text: string; tone: Tone } {
  const w = W(language);
  switch (o.state) {
    case "entregada":
      return { text: w.delivered, tone: "ok" };
    case "en_curso":
      return { text: o.who ? w.inProgressBy(roleName(o.who)) : w.inProgress, tone: "ok" };
    case "entendida":
      return { text: w.understood, tone: "idle" };
    case "sin_tomar": {
      const h = o.age_h ?? 0;
      return { text: w.notTaken(h >= 48 ? w.ageDays(Math.floor(h / 24)) : w.ageHours(h)), tone: "warn" };
    }
    case "cancelada":
      return { text: w.orderCanceled, tone: "idle" };
    default:
      return { text: w.sent(ago(o.at, now)), tone: "idle" };
  }
}

// ---- En pausa

export function pausedText(p: OrgProject, now: number, language: Language = getLanguage()): string {
  const w = W(language);
  const open = p.work.open;
  const head = open === 0 ? w.noOpenWork : w.openTickets(open);
  if (!p.this_week.last_at) return head;
  const days = Math.floor((now - new Date(p.this_week.last_at).getTime()) / 86_400_000);
  return days >= 1 ? w.quietFor(head, w.days(days)) : head;
}

// ---- the company line under the greeting: "Tienda avanza, cinco proyectos en pausa"

export function companyLine(projects: OrgProject[], language: Language = getLanguage()): string {
  const w = W(language);
  const num = (n: number) => w.nums[n] ?? String(n);
  const live = projects.filter((p) => !p.paused && p.light !== "paused");
  const paused = projects.length - live.length;
  const names = live.map((p) => p.title);
  const head =
    names.length === 0 ? w.nothingMoves : names.length === 1 ? w.oneMoves(names[0]!) : names.length <= 3 ? w.fewMove(names.slice(0, -1).join(", "), names.at(-1)!) : w.manyMove(num(names.length));
  if (paused === 0) return head;
  return paused === 1 ? w.pausedOne(head) : w.pausedMany(head, num(paused));
}

// ---- Asistente folded

const dayKey = (iso: string, timeZone?: string) => new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone }).format(new Date(iso));
export function todayMessages(messages: ThreadMessage[], now: number, timeZone?: string): ThreadMessage[] {
  const today = dayKey(new Date(now).toISOString(), timeZone);
  return messages.filter((m) => dayKey(m.at, timeZone) === today);
}
// Asistente's latest message (the answer or the 07:00 brief), not the owner's.
export function latestFromAsistente(messages: ThreadMessage[]): ThreadMessage | null {
  const mine = (m: ThreadMessage) => m.author.agent === "owner" || m.author.role === "ceo" || m.author.role === "owner";
  return [...messages].sort((a, b) => b.at.localeCompare(a.at)).find((m) => !mine(m)) ?? null;
}
export const foldLine = (n: number, language: Language = getLanguage()) => W(language).foldLine(n);
export const SUGGESTIONS = (projects: OrgProject[], language: Language = getLanguage()) => {
  const w = W(language);
  const first = projects.find((p) => !p.paused)?.title ?? projects[0]?.title;
  return [first ? w.howIs(first) : w.howIsAll, w.whatWaits, ...(first ? [`${first}: `] : [])];
};

export { tokens };

// ---- PLA-I36-6/8/9/10/11: steering from the card

// The Spanish lists, kept for the tests; kindWords and stages read them in the screen's language.
export const KIND_WORDS: { id: OrderKind; word: string; hint: string }[] = V2_WORDS.es.kinds;
export const kindWords = (language: Language = getLanguage()) => W(language).kinds;

export const STAGES: { id: OrderStage; word: string }[] = V2_WORDS.es.stages;
export const stages = (language: Language = getLanguage()) => W(language).stages;
// How many of the four stages are reached (0 = sent, nothing understood yet).
export const stageReached = (stage: OrderStage | undefined) => (stage ? STAGES.findIndex((s) => s.id === stage) + 1 : 0);

// NEWPROJ-5: starting, the ask answered before the PO's run started (src/api/company-actions.ts askPo).
export function askText(r: AskResult, language: Language = getLanguage()): string {
  const w = W(language);
  if (r.woke) return r.woke.woke ? w.sentOnIt : w.sentWhy(w.woke[r.woke.reason] ?? r.woke.summary ?? r.woke.reason);
  return r.wake === "queued" ? w.sentTurn : r.wake === "busy" ? w.sentBusy : w.sentLater;
}

// "Taller trabaja en «Formulario» desde 10:42 · último: registró pruebas"
export function runText(run: OrgRun, clockOf: (iso: string) => string, language: Language = getLanguage()): string {
  const w = W(language);
  if (run.status === "stopped") return w.stopped(roleName(run.role, language), run.step);
  return [w.worksOn(roleName(run.role, language), run.step, clockOf(run.since)), run.last ? w.lastDid(run.last) : ""].filter(Boolean).join(" · ");
}

// "Pruebas: 12 pasan · 1 falla · 8 archivos cambiados"
export function evidenceText(d: Pick<Decision, "evidence" | "files">, language: Language = getLanguage()): { text: string; tone: Tone } | null {
  const w = W(language);
  const e = d.evidence;
  const parts: string[] = [];
  if (e) {
    if (e.pass != null) parts.push(w.pass(e.pass));
    if (e.fail != null) parts.push(w.fail(e.fail));
    if (e.pass == null && e.fail == null) parts.push(e.verdict === "pass" ? w.green : e.verdict === "fail" ? w.failed : w.warnings);
  }
  if (d.files != null) parts.push(w.files(d.files));
  if (parts.length === 0) return null;
  const red = e && (e.verdict === "fail" || (e.fail ?? 0) > 0);
  return { text: e ? w.tests(parts.join(" · ")) : parts.join(" · "), tone: red ? "stop" : e?.verdict === "pass" ? "ok" : "idle" };
}

// Plain words for a link on the main lines: no keys, no "PR de …".
export function plainLink(l: { kind: string; ref: string; title: string }, language: Language = getLanguage()): string {
  const w = W(language);
  if (l.kind === "pr") return w.seeChange;
  if (l.kind === "doc") return w.doc(l.title || w.untitled);
  return l.title || w.open;
}
