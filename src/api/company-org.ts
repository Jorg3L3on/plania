// PLA-I32-6: the read contract of the Compañía pages (Plan doc of PLA-IDEA7, "Contrato de API").
//   GET  /api/company                   companyRead: the company, Asistente, each project with its team and thread, the plumbing line
//   GET  /api/company/projects/:slug    projectRead: today's project sheet plus team, thread_id, the templates to add and
//                                       hire (every template with free | taken | no_doc, for the Sumar sheet)
//   POST /api/company/projects/:slug/team {template}   addTeamMember: one more agent on the team, from a role template
//   GET  /api/machine                   plumbing (merged into the machine inventory): week usage, plan guard, switches, runs, log
// Tokens only, never money. Cookie-only routes (src/api/company.ts and the /api session for /api/machine).
import type { Db } from "../db/client.js";
import type { Actor, Agent, AgentRun, Project, RunnerSettings } from "../db/schema.js";
import { blockedTaskIds } from "../mcp/blockers.js";
import { readerOf } from "../store/port.js";
import { gte, notNull } from "../store/types.js";
import { resolveMotor } from "../runner/motor.js";
import { runnerView, type RunnerView } from "./company-runner.js";
import { capacityFacts, agentFacts, holdOf, type CapacityFacts } from "../runner/hold.js";
import { ENDED_STATUSES, projectSheet, type ProjectSheet, type RunBrief } from "./company-extra.js";
import { agentOfActor, asistenteAgent } from "../runner/events.js";
import { latestBrief } from "../runner/asistente.js";
import { PROMPT_DOCS, isRunnerRole, lastReading, loadSettings, planView, roleOf, screenTz, weekBounds, weekUsage, type CardUsage, type PlanView, type WeekUsage } from "../runner/limits.js";
import { TEAM_TEMPLATES, TEMPLATE_ROWS, ensureMember, isTeamTemplate, teamOf, teamSlug, type TeamTemplate } from "../runner/team.js";
import { actionsFor, companyThread, projectThread, threadSummary } from "../runner/threads.js";
import { companyState, type CompanyState, type RunView } from "../runner/company.js";
import { autoAcceptOf, type AutoAccept } from "./auto-accept.js";
import { decisionsRead, inboxByProject, type Decision } from "./company-decisions.js";
import { ordersOf, type Order } from "./company-orders.js";
import { pedidosOf, type Pedido } from "./company-pedidos.js";
import { nextMove, type NextMove } from "./company-move.js";
import { loadReadiness } from "../mcp/readiness.js";
import type { InboxItem } from "../mcp/inbox.js";
import { projectEtapas, tableroOf, type AhoraItem, type Tablero } from "./etapa.js";
import { byKey, ceoAgentId, planOf, readyOf, routeOf, type Route, type QueuedTicket, type ReadyLine, thisWeekOf, workOf, type NextLine, type PlanLine, type ThisWeek, type WorkLine } from "./company-plan.js";

const HOUR = 3_600_000;
const QUIET_HOURS = 48;
const promptsProject = () => process.env.PLANIA_PROMPTS_PROJECT || "plania";

export type MemberState = "running" | "idle" | "waiting_jorge" | "paused";
// PLA-I36-1: the worst of, in order: something is Jorge's, a run failed, the work is blocked, the plan is
// late, nothing moved in 48 h; else ok. Paused comes first. PLA-21: no budgets, so no "no_budget".
export type Light = "ok" | "needs_jorge" | "failed" | "blocked" | "late" | "quiet" | "paused";
export type LightReason = { text: string; action: { label: string; href: string } | null };

export type TeamMember = {
  agent: string;
  role: string;
  template: string | null;
  state: MemberState;
  // PLA-I39-1: title is the ticket's title, null when the run has no ticket (the key stays in ticket).
  // PLA-I39-6: run_id, for Detener (a live run) and Reanudar (a stopped one) from the side page.
  now: { ticket: string | null; title: string | null; since: string; run_id: string } | null;
  last: { ticket: string | null; title: string | null; status: string; at: string; run_id: string } | null;
  // PLA-I39-1: up to three Ready tickets waiting for this teammate (by owner, else code to Taller, the rest to the PO).
  queue: QueueItem[];
  produced: { kind: "doc" | "pr" | "idea" | "plan"; ref: string; title: string } | null;
  waiting: string | null;
  // PLA-I40-1: why this teammate's next step has not started, and when it will if that is known.
  next_start: NextStart | null;
  // PLA-I46-12: the skill pack slugs this role carries (GET/PUT /api/company/projects/:slug/team/:agent/packs).
  packs: string[];
  // PLA-I59-2 (Motores): what this seat's next run asks for (resolved as the runner does, src/runner/motor.ts), and
  // whether each part is the seat's own or the company's. A PO also carries its Preguntar motor.
  motor: MotorView;
  consulta_motor: MotorView | null;
  // This ISO week's input + output tokens of the seat's runs in this project, and its share of the project's
  // total (null when nothing was reported this week).
  used_week: { tokens: number; share: number } | null;
};

export type MotorView = { model: string | null; effort: string | null; own_model: boolean; own_effort: boolean };

// hold: the runner's own verdict (rest, usage, slot, paused, no_goal: src/runner/hold.ts), or what the ticket waits
// on (waiting_owner: a step before it was delivered and waits for the owner's answer; waiting_step: any other
// blocker), or unqueued (Ready, free, and no wake is queued), or soon (a wake is queued and nothing holds it).
export type NextHold = "rest" | "usage" | "slot" | "paused" | "no_goal" | "waiting_owner" | "waiting_step" | "unqueued" | "soon";
export type NextStart = { key: string | null; title: string | null; hold: NextHold; starts_at: string | null; text: string };

export type QueueItem = { key: string; title: string };
const QUEUE_MAX = 3;

export type ThreadLine = { id: string; unread: number; last: { at: string; author_role: string; body: string } | null };

export type ProjectCard = {
  runner?: RunnerView;
  slug: string;
  title: string;
  paused: boolean;
  light: Light;
  // PLA-I36-1: why, in one sentence, and the action that clears it. Null when Bien or paused.
  light_reason: LightReason | null;
  goal: string | null;
  // PLA-I36-4: the destination: the goal sentence, its delivery date and the forecast; missing says Fijar.
  rumbo: Rumbo;
  // PLA-21: this week's tokens, shown only. PLA-23: and last week's, to compare.
  usage: CardUsage;
  team: TeamMember[];
  thread: ThreadLine;
  // PLA-I35-1: the card as a report (src/api/company-plan.ts).
  plan: PlanLine | null;
  // PLA-I40-7: the accept-by-itself switch, and why the oldest waiting delivery was not accepted.
  auto_accept: AutoAccept;
  // PLA-I40-6: the last things that happened on this floor, and the owner's requests nobody took.
  latest: LatestLine[];
  stale_requests: StaleRequest[];
  // PLA-I40-3: the delivery as legs, the current one with its named steps (src/api/company-plan.ts).
  route: Route | null;
  this_week: ThisWeek;
  next: NextLine | null;
  // PLA-I36-6: the next Ready tickets, for Cambiar lo siguiente.
  ready: ReadyLine[];
  // PLA-I47-3: the ticket the owner put first (Hacer primero), so La fila numbers Sigue as the runner takes it.
  next_first: string | null;
  // PLA-I36-8: whether a PO's plan waits for "Sí, empiecen". PLA-I36-10: the running preview.
  plan_approval: boolean;
  preview_url: string | null;
  work: WorkLine;
  // PLA-I36-3: Tus órdenes (src/api/company-orders.ts).
  orders: Order[];
  // PLA-I46-3: la siguiente jugada, the one thing on this floor that is the owner's (src/api/company-move.ts).
  next_move: NextMove | null;
  // PLA-I53-2: every open initiative with its tickets and their stage, and who works now (src/api/etapa.ts).
  tablero: Tablero;
  ahora: AhoraItem[];
  // PLA-I54-1: the owner's ideas taking shape (the floor's tube), src/api/company-pedidos.ts.
  pedidos: Pedido[];
};

export type CompanyRead = {
  company: { paused: boolean };
  week: { starts_at: string; resets_at: string; timezone: string };
  // PLA-I39-1: unread, the company thread's unread messages (counted as a project thread's are).
  asistente: { thread_id: string; usage: WeekUsage; last_run: { status: string; at: string; summary: string } | null; state: MemberState; unread: number };
  projects: ProjectCard[];
  plumbing: { spend: number; running: number; paused: boolean };
  // PLA-I35-1: Te toca (src/api/company-decisions.ts).
  decisions: Decision[];
  // PLA-I36-2: what Bandeja counts, so Te toca never says "Nada te espera" while it holds something.
  inbox: { decisiones: number; pasos: number };
  // PLA-I42-5: "Brief de hoy", the Morning brief's 0-token projection (the asistente.brief event, up to 5 lines),
  // with a link to the full /brief page. null until the first brief is stored.
  brief: { lines: string[]; generated_at: string; link: "/brief" } | null;
  // PLA-I59-2 (Motores): the company's default motor (null fields: the CLI's own default).
  motor_default: { model: string | null; effort: string | null };
};

const ORDER = new Map<string, number>(TEAM_TEMPLATES.map((t, i) => [t, i]));
const byTemplate = (a: Agent, b: Agent) => (ORDER.get(a.roleTemplate ?? "") ?? 99) - (ORDER.get(b.roleTemplate ?? "") ?? 99) || a.slug.localeCompare(b.slug);

// Open questions per asker (resolved through runner sessions or roster slugs), oldest first.
async function openQuestionsByAgent(db: Db, projectId?: string): Promise<Map<string, string>> {
  const rows = await readerOf(db).find("questions", { answeredAt: null, ...(projectId ? { projectId } : {}) }, { orderBy: [{ column: "askedAt" }] });
  const out = new Map<string, string>();
  for (const r of rows) {
    const a = await agentOfActor(db, r.askedBy as Actor);
    if (a && !out.has(a.id)) out.set(a.id, r.question);
  }
  return out;
}

async function lastRunOf(db: Db, agentId: string) {
  const r = readerOf(db);
  const running = await r.get("agentRuns", { agentId, status: "running" });
  const [ended] = await r.find("agentRuns", { agentId, endedAt: notNull() }, { orderBy: [{ column: "endedAt", desc: true }], limit: 1 });
  return { running: running ?? null, ended: ended ?? null };
}

// The newest thing a member delivered, from its own lines in the project thread.
// PLA-I46-4: a window names a delivered PR by its step: «Paso N · <the ticket's title>», the title the plan wrote
// (in Spanish), never the PR's own (often English). With no ticket behind the PR it says only «Paso N».
const PR_NUMBER = /\/pull\/(\d+)|#(\d+)/;
export async function prStepTitle(db: Db, projectId: string | null, ref: string, prTitle: string): Promise<string> {
  const m = PR_NUMBER.exec(ref) ?? PR_NUMBER.exec(prTitle);
  const n = m ? (m[1] ?? m[2]) : null;
  const r = readerOf(db);
  // The ticket whose PR is this one: the same URL, or (with a number) any URL ending in /pull/<n>; the exact one first.
  const tickets = projectId ? await r.find("tasks", { projectId, kind: "ticket", prUrl: notNull() }) : [];
  const t = tickets.find((x) => x.prUrl === ref) ?? (n ? tickets.find((x) => x.prUrl!.endsWith(`/pull/${n}`)) : undefined);
  if (!t) return n ? `Paso ${n}` : "Un paso";
  if (!t.parentId) return t.title;
  const steps = (await r.find("tasks", { parentId: t.parentId, kind: "ticket" }))
    .filter((x) => x.status !== "Won't do")
    .sort((a, b) => (a.phase ?? 999) - (b.phase ?? 999) || byKey(a, b));
  const i = steps.findIndex((x) => x.id === t.id);
  return i >= 0 ? `Paso ${i + 1} · ${t.title}` : t.title;
}

async function producedBy(db: Db, threadId: string, slug: string, projectId: string | null): Promise<TeamMember["produced"]> {
  const rows = await readerOf(db).find("threadMessages", { threadId, authorAgent: slug }, { orderBy: [{ column: "at", desc: true }], limit: 20 });
  for (const r of rows) {
    const link = r.links.find((l) => l.kind === "doc" || l.kind === "pr" || l.kind === "idea");
    if (!link) continue;
    const kind = link.kind === "doc" && /^plan\b/i.test(link.title) ? "plan" : (link.kind as "doc" | "pr" | "idea");
    return { kind, ref: link.ref, title: kind === "pr" ? await prStepTitle(db, projectId, link.ref, link.title) : link.title };
  }
  return null;
}

async function ticketTitle(db: Db, projectId: string | null, key: string | null): Promise<string | null> {
  if (!projectId || !key) return null;
  return (await readerOf(db).get("tasks", { projectId, key }))?.title ?? null;
}

async function memberView(db: Db, a: Agent, ctx: { paused: boolean; threadId: string; waiting: Map<string, string>; settings: RunnerSettings }): Promise<TeamMember> {
  const { running, ended } = await lastRunOf(db, a.id);
  const waiting = ctx.waiting.get(a.id) ?? null;
  const state: MemberState = running ? "running" : ctx.paused ? "paused" : waiting ? "waiting_jorge" : "idle";
  return {
    agent: a.slug,
    role: roleOf(a) ?? a.role,
    template: a.roleTemplate ?? null,
    state,
    now: running ? { ticket: running.taskKey, title: await ticketTitle(db, a.projectId, running.taskKey), since: (running.startedAt ?? new Date()).toISOString(), run_id: running.id } : null,
    last: ended ? { ticket: ended.taskKey, title: await ticketTitle(db, a.projectId, ended.taskKey), status: ended.status, at: ended.endedAt!.toISOString(), run_id: ended.id } : null,
    queue: [],
    produced: await producedBy(db, ctx.threadId, a.slug, a.projectId),
    waiting,
    next_start: null,
    packs: a.skillPacks ?? [],
    motor: motorView(a, ctx.settings, false),
    consulta_motor: a.roleTemplate === "product-owner" ? motorView(a, ctx.settings, true) : null,
    used_week: null,
  };
}

// PLA-I59-2: the motor a seat's next run would ask for. own_* says the seat (or, for Preguntar, its consulta value)
// set that part itself; otherwise it comes from further down the rule (the company, or the CLI when null).
function motorView(a: Agent, settings: RunnerSettings, consulta: boolean): MotorView {
  const m = resolveMotor({
    consulta,
    seat: { model: a.motorModel, effort: a.motorEffort, consultaModel: a.consultaModel, consultaEffort: a.consultaEffort },
    company: { model: settings.defaultModel, effort: settings.defaultEffort },
  });
  const own = (src: string) => (consulta ? src === "consulta" : src === "seat");
  return { model: m.model, effort: m.effort, own_model: own(m.source.model), own_effort: own(m.source.effort) };
}

// PLA-I59-2: each seat's input + output tokens this week in this project, and its share of the project's total.
async function weekUsedBySeat(db: Db, projectId: string, startsAt: Date): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (const run of await readerOf(db).find("agentRuns", { projectId, startedAt: gte(startsAt) })) {
    out.set(run.agentId, (out.get(run.agentId) ?? 0) + Number(run.inputTokens) + Number(run.outputTokens));
  }
  return out;
}

type GoalRow = { id: string; title: string; why: string; target_on: string | null };
async function goalOf(db: Db, projectId: string): Promise<GoalRow | null> {
  const r = readerOf(db);
  // PLA-I46-4: a project's goal usually hangs under a company goal; only a sub-goal of the same project is skipped.
  const own = new Set((await r.find("goals", { projectId })).map((g) => g.id));
  const [g] = (await r.find("goals", { projectId, status: "active" }, { orderBy: [{ column: "position" }, { column: "createdAt" }] })).filter(
    (g) => !g.parentId || !own.has(g.parentId),
  );
  // target_on is a date column, read as its YYYY-MM-DD text.
  return g ? { id: g.id, title: g.title, why: g.why, target_on: g.targetOn ?? null } : null;
}

// PLA-I36-4: the seeded placeholder ("Avance del producto (slug)") is not a destination.
export const PLACEHOLDER_GOAL = /^Avance del producto\b/i;
export type Rumbo = { goal_id: string | null; goal: string | null; why: string; target_on: string | null; forecast_on: string | null; weeks_behind: number | null; missing: boolean };
export function rumboOf(goal: GoalRow | null, plan: PlanLine | null): Rumbo {
  const real = goal && !PLACEHOLDER_GOAL.test(goal.title.trim()) ? goal : null;
  return {
    goal_id: goal?.id ?? null,
    goal: real?.title ?? null,
    why: goal?.why ?? "",
    target_on: goal?.target_on ?? null,
    forecast_on: goal?.target_on && plan?.due_on === goal.target_on ? plan.forecast_on : null,
    weeks_behind: goal?.target_on && plan?.due_on === goal.target_on ? plan.weeks_behind : null,
    missing: !real || !goal?.target_on,
  };
}

// PLA-I36-1. paused, then the worst of: Jorge's (an open question, a Needs Jorge ticket, a
// ceo-owned Ready ticket, a manual step, a release, a message with buttons), a run that failed (a member's
// last ended run), blocked (readiness blocked), late (the plan's pace), quiet (no event in 48 h); else ok.
const quote = (s: string, n = 80) => `«${s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s}»`;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const TE_TOCA = { label: "Ver en Te toca", href: "#te-toca" };
export const DELIVERY_WAITS = "Una entrega espera tu visto bueno.";

export type LightCtx = { paused: boolean; threadId: string; now: Date; ceoId: string | null; team: TeamMember[]; plan: PlanLine | null; inbox: InboxItem[] };

export async function lightOf(db: Db, p: Project, c: LightCtx): Promise<{ light: Light; reason: LightReason | null }> {
  const open = `/p/${encodeURIComponent(p.slug)}`;
  if (c.paused) return { light: "paused", reason: null };

  const jorge = (text: string): { light: Light; reason: LightReason } => ({ light: "needs_jorge", reason: { text, action: TE_TOCA } });
  const r = readerOf(db);
  const q = await r.get("questions", { projectId: p.id, answeredAt: null });
  if (q) return jorge("El equipo te hizo una pregunta y espera tu respuesta.");
  const nj = await r.get("tasks", { projectId: p.id, status: "Needs Jorge" });
  if (nj) return jorge(`${quote(nj.title)} espera tu decisión.`);
  if (c.ceoId) {
    const mine = await r.get("tasks", { projectId: p.id, kind: "ticket", status: "Ready", ownerAgent: c.ceoId });
    if (mine) return jorge(`Lo siguiente es tuyo: ${quote(mine.title)}.`);
  }
  const step = c.inbox.find((i) => i.kind === "human_action");
  if (step) return jorge(`Un paso es tuyo: ${quote(step.why, 100)}.`);
  const release = c.inbox.find((i) => i.kind === "release");
  if (release) {
    const n = (release.target as { tickets?: unknown[] } | undefined)?.tickets?.length ?? 0;
    // PLA-23: the action publishes from the floor (the plate opens the sheet); Te toca no longer exists.
    return {
      light: "needs_jorge",
      reason: { text: n === 1 ? "1 cambio listo espera que lo publiques." : `${n} cambios listos esperan que los publiques.`, action: { label: "Publicar", href: "#publicar" } },
    };
  }
  const recent = await r.find("threadMessages", { threadId: c.threadId, actionState: null }, { orderBy: [{ column: "at", desc: true }], limit: 30 });
  for (const m of recent) if ((await actionsFor(db, m, p.id)).length > 0) return jorge(DELIVERY_WAITS);

  const failed = c.team.find((m) => m.state !== "running" && m.last?.status === "fail");
  if (failed) {
    // Its newest failed run (a run never ended sorts first, as Postgres puts nulls first in a descending sort).
    const member = await r.get("agents", { slug: failed.agent });
    const [run] = member ? await r.find("agentRuns", { agentId: member.id, status: "fail" }, { orderBy: [{ column: "endedAt", desc: true }], limit: 1 }) : [];
    const why = run?.summary.trim().split("\n")[0]?.trim();
    const who = roleWord(failed.role);
    return { light: "failed", reason: { text: why ? `La última corrida ${who} falló: ${why.length > 140 ? `${why.slice(0, 139)}…` : why}` : `La última corrida ${who} falló.`, action: { label: "Ver en Máquina", href: "/machine" } } };
  }

  const ready = await loadReadiness(db, p);
  if (ready.state === "blocked") {
    const why = ready.reasons.find((x) => x.severity === "blocked") ?? ready.reasons[0]!;
    const t = why.task_key ? await r.get("tasks", { projectId: p.id, key: why.task_key }) : undefined;
    const name = t ? quote(t.title) : "Un ticket";
    const text =
      why.code === "CI_FAILURE"
        ? `Las pruebas de ${name} fallaron.`
        : why.code === "DEPLOY_BLOCKED"
          ? `${name} espera un despliegue que falló o va atrás.`
          : why.code === "AREAS_OVERLAP"
            ? "Dos trabajos tocan los mismos archivos a la vez."
            : `${name} está bloqueado.`;
    return { light: "blocked", reason: { text, action: { label: "Abrir", href: open } } };
  }

  if (c.plan && (c.plan.pace === "late" || c.plan.pace === "bad")) {
    const n = c.plan.weeks_behind ?? 1;
    return { light: "late", reason: { text: `Va ${plural(n, "semana", "semanas")} atrás de la entrega del ${c.plan.due_on}.`, action: { label: "Abrir", href: open } } };
  }

  const [last] = await r.find("events", { projectId: p.id }, { orderBy: [{ column: "id", desc: true }], limit: 1 });
  if (!last || c.now.getTime() - last.createdAt.getTime() > QUIET_HOURS * HOUR) {
    const days = last ? Math.floor((c.now.getTime() - last.createdAt.getTime()) / (24 * HOUR)) : null;
    return { light: "quiet", reason: { text: days ? `Nada se movió en ${plural(days, "día", "días")}.` : "Nada se movió todavía.", action: { label: "Abrir", href: open } } };
  }
  return { light: "ok", reason: null };
}

const ROLE_WORD: Record<string, string> = { "product-owner": "del PO", research: "de Research", artist: "de Artist", taller: "de Taller" };
const roleWord = (role: string) => ROLE_WORD[role] ?? `de ${role}`;

async function teamView(db: Db, p: Project, ctx: { paused: boolean; threadId: string }): Promise<TeamMember[]> {
  const waiting = await openQuestionsByAgent(db, p.id);
  const settings = await loadSettings(db);
  const out: TeamMember[] = [];
  const seats = (await teamOf(db, p.id)).sort(byTemplate);
  for (const a of seats) out.push(await memberView(db, a, { ...ctx, waiting, settings }));
  // PLA-I59-2: this week's usage per seat, as a share of the project's total.
  const used = await weekUsedBySeat(db, p.id, (await weekBounds(db, new Date())).startsAt);
  const total = [...used.values()].reduce((a, b) => a + b, 0);
  seats.forEach((a, i) => {
    const n = used.get(a.id) ?? 0;
    out[i]!.used_week = total > 0 ? { tokens: n, share: n / total } : null;
  });
  return out;
}

// PLA-I39-1: each Ready ticket joins the queue of the teammate whose agent owns it; else code goes to Taller and
// anything else to the PO. Siguiente's order; at most three each; a ticket with no such teammate joins none.
export function fillQueues(team: TeamMember[], queued: QueuedTicket[], agentSlugById: Map<string, string>): void {
  const byTemplate = (t: string) => team.find((m) => m.template === t);
  for (const q of queued) {
    const owner = q.owner ? team.find((m) => m.agent === agentSlugById.get(q.owner!)) : undefined;
    const m = owner ?? (q.work_type === "code" ? byTemplate("taller") : byTemplate("product-owner"));
    if (m && m.queue.length < QUEUE_MAX) m.queue.push({ key: q.key, title: q.title });
  }
}

// PLA-I40-1: one short sentence per hold. No ticket keys, no money; the time travels in starts_at.
export function holdText(hold: NextHold, x: { scope?: "company" | "project"; plan?: PlanView } = {}): string {
  switch (hold) {
    case "rest":
      return "Descansa entre un trabajo y otro.";
    case "usage": {
      const p = x.plan;
      if (!p || p.state === "unknown") return "No se sabe cuánto uso de Claude queda.";
      if (p.status === "allowed_warning" || p.status === "rejected") return "Claude avisó que el uso está al límite.";
      return `El uso de Claude va en ${p.five_hour_pct} % y el tope es ${p.guard_pct} %.`;
    }
    case "slot":
      return "Espera un lugar: ya hay otros trabajando.";
    case "paused":
      return x.scope === "company" ? "La compañía está en pausa." : "El proyecto está en pausa.";
    case "no_goal":
      return "Falta fijar la meta del proyecto.";
    case "waiting_owner":
      return "Espera que aceptes la entrega anterior.";
    case "waiting_step":
      return "Espera un paso anterior.";
    case "unqueued":
      return "Nadie lo ha despertado todavía.";
    case "soon":
      return "Arranca en un momento.";
  }
}

// What the ticket itself waits on: a step before it that was delivered and not accepted yet (the next step is
// woken when that one lands), else any other blocker that does not hold.
async function ticketHold(db: Db, projectId: string, key: string): Promise<"waiting_owner" | "waiting_step" | null> {
  const r = readerOf(db);
  const t = await r.get("tasks", { projectId, key });
  if (!t) return null;
  const links = await r.find("taskBlockers", { taskId: t.id });
  const delivered = links.length > 0 && (await r.count("tasks", { id: links.map((l) => l.blockerId), status: "In review" })) > 0;
  if (delivered) return "waiting_owner";
  // A time_after blocker is read against the clock, as now() was.
  return (await blockedTaskIds(r, projectId, [t.id], new Date())).has(t.id) ? "waiting_step" : null;
}

// PLA-I40-1: for each teammate that is not working, its next step (the queued wake's ticket, else the first of
// its queue) and why it has not started. The runner's verdict comes from hold.ts, the function preflight uses.
export async function fillNextStarts(db: Db, p: Project, team: TeamMember[], ctx: { settings: RunnerSettings; capacity: CapacityFacts; now: Date }): Promise<void> {
  const roster = new Map((await teamOf(db, p.id)).map((a) => [a.slug, a]));
  for (const m of team) {
    const agent = roster.get(m.agent);
    if (!agent || m.state === "running") continue;
    const [queuedRun] = await readerOf(db).find("agentRuns", { agentId: agent.id, status: "queued" }, { orderBy: [{ column: "queuedAt" }], limit: 1 });
    const first = m.queue[0] ?? null;
    if (!queuedRun && !first) continue;
    const key = queuedRun ? queuedRun.taskKey : first!.key;
    const title = queuedRun ? await ticketTitle(db, p.id, queuedRun.taskKey) : first!.title;
    const make = (hold: NextHold, startsAt: Date | null = null, x: Parameters<typeof holdText>[1] = {}): NextStart => ({ key, title, hold, starts_at: startsAt?.toISOString() ?? null, text: holdText(hold, x) });

    const waits = !queuedRun && key ? await ticketHold(db, p.id, key) : null;
    if (waits) {
      m.next_start = make(waits);
      continue;
    }
    const role = roleOf(agent);
    const hold = holdOf(await agentFacts(db, { agent, role, project: p, settings: ctx.settings, now: ctx.now }), ctx.capacity);
    m.next_start = hold ? make(hold.code, hold.startsAt, { scope: hold.scope, plan: ctx.capacity.plan }) : make(queuedRun ? "soon" : "unqueued");
  }
}

// PLA-I40-6: what just happened here, newest first, three at most: a release the owner published (with how many
// changes) and a step a teammate delivered. The owner's own answers are the decisions' states; the screen adds them.
export type LatestLine = { kind: "published" | "delivered"; title: string | null; n: number | null; at: string };
export async function latestOf(db: Db, p: Project): Promise<LatestLine[]> {
  const r = readerOf(db);
  const events = await r.find("events", { projectId: p.id, type: ["release.merged", "task.status"] }, { orderBy: [{ column: "id", desc: true }] });
  const out: LatestLine[] = [];
  for (const e of events) {
    if (out.length >= 3) break;
    const payload = e.payload as Record<string, unknown>;
    if (e.type === "release.merged") {
      out.push({ kind: "published", title: null, n: Array.isArray(payload.tickets) ? payload.tickets.length : null, at: e.createdAt.toISOString() });
      continue;
    }
    // A step delivered: a ticket moved to In review.
    if (payload.to !== "In review" || !e.taskId) continue;
    const t = await r.get("tasks", { id: e.taskId });
    if (t?.kind === "ticket") out.push({ kind: "delivered", title: t.title, n: null, at: e.createdAt.toISOString() });
  }
  return out;
}

// A request the owner made on screen (origin jorge) that has been Ready for over an hour with no run queued or
// live on it: nobody is going to take it unless it is sent again.
export const STALE_REQUEST_MIN = 60;
export type StaleRequest = { key: string; title: string; since: string };
export async function staleRequestsOf(db: Db, p: Project, now: Date): Promise<StaleRequest[]> {
  const before = new Date(now.getTime() - STALE_REQUEST_MIN * 60_000);
  const r = readerOf(db);
  const since = (t: { statusChangedAt: Date | null; createdAt: Date }) => t.statusChangedAt ?? t.createdAt;
  const old = (await r.find("tasks", { projectId: p.id, kind: "ticket", origin: "jorge", status: "Ready" })).filter((t) => since(t) < before);
  if (!old.length) return [];
  const taken = new Set((await r.find("agentRuns", { projectId: p.id, taskKey: old.map((t) => t.key), status: ["queued", "running"] })).map((x) => x.taskKey));
  return old
    .filter((t) => !taken.has(t.key))
    .sort((a, b) => since(a).getTime() - since(b).getTime())
    .slice(0, 5)
    .map((t) => ({ key: t.key, title: t.title, since: since(t).toISOString() }));
}

const countInbox = (inbox: Map<string, InboxItem[]>) => {
  let decisiones = 0;
  let pasos = 0;
  for (const items of inbox.values()) for (const i of items) i.group === "decisiones" ? decisiones++ : i.group === "pasos" ? pasos++ : null;
  return { decisiones, pasos };
};

const threadLine = (s: Awaited<ReturnType<typeof threadSummary>>): ThreadLine => ({ id: s.id, unread: s.unread, last: s.last });

export async function companyRead(db: Db, now = new Date()): Promise<CompanyRead> {
  const settings = await loadSettings(db);
  const tz = screenTz();
  const { startsAt, resetsAt } = await weekBounds(db, now, tz);
  const cards: ProjectCard[] = [];
  const ceoId = await ceoAgentId(db);
  const r = readerOf(db);
  const all = await r.find("projects", {}, { orderBy: [{ column: "slug" }] });
  const inbox = await inboxByProject(db, all);
  const capacity = await capacityFacts(db, settings, now);
  for (const p of all) {
    const lastWeek = new Date(startsAt.getTime() - 7 * 24 * HOUR);
    const usage: CardUsage = {
      used: (await weekUsage(db, { kind: "project", projectId: p.id }, startsAt)).used,
      last_week: (await weekUsage(db, { kind: "project", projectId: p.id }, lastWeek, startsAt)).used,
    };
    const thread = await threadSummary(db, await projectThread(db, p.id), p);
    const paused = settings.companyPaused || p.runsPaused;
    const goal = await goalOf(db, p.id);
    const plan = await planOf(db, p, now, goal?.target_on ?? null);
    const team = await teamView(db, p, { paused, threadId: thread.id });
    const upNext = await readyOf(db, p, ceoId, plan?.initiative.key ?? null);
    const owners = [...new Set(upNext.queued.map((q) => q.owner).filter((x): x is string => !!x))];
    const slugs = owners.length ? await r.find("agents", { id: owners }) : [];
    // PLA-I40-6: a request nobody took leaves the queue; the floor shows it as a warning instead.
    const stale = await staleRequestsOf(db, p, now);
    const staleKeys = new Set(stale.map((x) => x.key));
    fillQueues(team, upNext.queued.filter((q) => !staleKeys.has(q.key)), new Map(slugs.map((a) => [a.id, a.slug])));
    await fillNextStarts(db, p, team, { settings, capacity, now });
    const light = await lightOf(db, p, { paused, threadId: thread.id, now, ceoId, team, plan, inbox: inbox.get(p.slug) ?? [] });
    const etapas = await projectEtapas(db, p, now);
    cards.push({
      slug: p.slug,
      title: p.title,
      paused: p.runsPaused,
      // PLA-I60-5: «a la vez» in Motores.
      runner: await runnerView(db, p, now),
      light: light.light,
      light_reason: light.reason,
      goal: goal?.title ?? null,
      rumbo: rumboOf(goal, plan),
      usage,
      team,
      thread: threadLine(thread),
      plan,
      route: await routeOf(db, p),
      auto_accept: { on: !!p.settings.auto_accept, hold: null, ...(p.settings.auto_accept_invisible ? { invisible: true } : {}) },
      latest: await latestOf(db, p),
      stale_requests: stale,
      this_week: await thisWeekOf(db, p, now),
      next: upNext.next,
      ready: upNext.ready,
      next_first: p.settings.next_first ?? null,
      plan_approval: !!p.settings.plan_approval,
      preview_url: p.settings.preview_url ?? null,
      work: await workOf(db, p),
      orders: await ordersOf(db, p, thread.id, now),
      next_move: null,
      tablero: tableroOf(etapas),
      ahora: etapas.ahora,
      pedidos: await pedidosOf(db, p.id),
    });
  }

  const asisUsage = await weekUsage(db, { kind: "asistente" }, startsAt);
  const company = await companyThread(db);
  const companyUnread = (await threadSummary(db, company, null)).unread;
  const asis = await asistenteAgent(db);
  let lastRun: CompanyRead["asistente"]["last_run"] = null;
  let state: MemberState = settings.companyPaused ? "paused" : "idle";
  if (asis) {
    const { running, ended } = await lastRunOf(db, asis.id);
    if (ended) lastRun = { status: ended.status, at: ended.endedAt!.toISOString(), summary: ended.summary };
    if (running) state = "running";
    else if (!settings.companyPaused && (await openQuestionsByAgent(db)).has(asis.id)) state = "waiting_jorge";
  }

  // PLA-I46-5: the company's week is input + output, as Máquina shows it (cache apart).
  const spend = (await weekUsage(db, { kind: "all" }, startsAt)).used;
  const running = await r.count("agentRuns", { status: "running" });

  const decisions = await decisionsRead(db, now, inbox);
  // PLA-I47-7: the light read a delivery before the decisions were read. A delivery held for QA's pass (or any rule
  // that keeps it off Te toca) is not the owner's turn yet, so the floor must not say it is (it drew a dead button).
  for (const c of cards) {
    const waiting = decisions.some((d) => d.project === c.slug && d.state === null && (d.kind === "pr" || d.kind === "deliverable"));
    if (c.light === "needs_jorge" && c.light_reason?.text === DELIVERY_WAITS && !waiting) {
      c.light = "ok";
      c.light_reason = null;
    }
  }
  for (const c of cards) if (c.auto_accept.on || c.auto_accept.invisible) c.auto_accept = await autoAcceptOf(db, all.find((p) => p.slug === c.slug)!, decisions);
  for (const c of cards) c.next_move = nextMove(c, decisions, { companyPaused: settings.companyPaused });
  return {
    company: { paused: settings.companyPaused },
    week: { starts_at: startsAt.toISOString(), resets_at: resetsAt.toISOString(), timezone: tz },
    asistente: { thread_id: company.id, usage: asisUsage, last_run: lastRun, state, unread: companyUnread },
    projects: cards,
    plumbing: { spend, running, paused: settings.companyPaused },
    decisions,
    inbox: countInbox(inbox),
    brief: await briefLine(db),
    motor_default: { model: settings.defaultModel, effort: settings.defaultEffort },
  };
}

async function briefLine(db: Db): Promise<CompanyRead["brief"]> {
  const b = await latestBrief(db);
  return b ? { lines: b.lines.slice(0, 5), generated_at: b.generated_at, link: "/brief" } : null;
}

// ---- One project

export type TemplateRef = { slug: TeamTemplate; title: string };
// PLA-I46-13: every role template with why it can or cannot be added: free, already on the team, or its
// `Prompt: <role>` doc is not in Plania yet. The hire sheet shows all of them; templates stays the free ones.
export type HireRef = TemplateRef & { state: "free" | "taken" | "no_doc" };
export type ProjectRead = ProjectSheet & { team: TeamMember[]; thread_id: string; templates: TemplateRef[]; hire: HireRef[] };

// The prompts project's own docs (not a ticket's) with these titles.
async function promptDocs(db: Db, titles: string[]) {
  const r = readerOf(db);
  const home = await r.get("projects", { slug: promptsProject() });
  return home ? r.find("docs", { projectId: home.id, taskId: null, title: titles }) : [];
}

export async function hireFor(db: Db, team: TeamMember[]): Promise<HireRef[]> {
  const titles = TEAM_TEMPLATES.filter((t) => isRunnerRole(t)).map((t) => PROMPT_DOCS[t as keyof typeof PROMPT_DOCS]);
  const found = await promptDocs(db, titles);
  const have = new Set(found.map((d) => d.title));
  const taken = new Set(team.map((m) => m.template));
  return TEAM_TEMPLATES.map((t) => ({
    slug: t,
    title: TEMPLATE_ROWS[t].title,
    state: taken.has(t) ? ("taken" as const) : have.has(PROMPT_DOCS[t as keyof typeof PROMPT_DOCS]) ? ("free" as const) : ("no_doc" as const),
  }));
}

export async function projectRead(db: Db, slug: string, now = new Date()): Promise<ProjectRead> {
  const sheet = await projectSheet(db, slug);
  const p = await readerOf(db).get("projects", { slug });
  const settings = await loadSettings(db);
  const thread = await projectThread(db, p!.id);
  const team = await teamView(db, p!, { paused: settings.companyPaused || p!.runsPaused, threadId: thread.id });
  const hire = await hireFor(db, team);
  return { ...sheet, team, thread_id: thread.id, templates: hire.filter((h) => h.state === "free").map(({ slug, title }) => ({ slug, title })), hire };
}

export type AddMemberError = { error: "PROJECT_NOT_FOUND" | "INVALID_TEMPLATE" | "PROMPT_DOC_MISSING" | "AGENT_EXISTS"; status: 400 | 404 | 409; hint: string; agent?: string };

export async function addTeamMember(db: Db, slug: string, template: string): Promise<{ agent: TeamMember; team: TeamMember[] } | AddMemberError> {
  const r = readerOf(db);
  const p = await r.get("projects", { slug });
  if (!p) return { error: "PROJECT_NOT_FOUND", status: 404, hint: "no such project" };
  if (!isTeamTemplate(template)) return { error: "INVALID_TEMPLATE", status: 400, hint: `one of ${TEAM_TEMPLATES.join(", ")}` };
  const title = PROMPT_DOCS[template as keyof typeof PROMPT_DOCS];
  // undefined when the template has no prompt doc title: no doc matches it.
  const [doc] = title === undefined ? [] : await promptDocs(db, [title]);
  if (!doc) return { error: "PROMPT_DOC_MISSING", status: 409, hint: `Falta el doc «${title}» en Plania.` };
  const agentSlug = teamSlug(template, p.slug);
  const taken = await r.get("agents", { slug: agentSlug });
  if (taken) return { error: "AGENT_EXISTS", status: 409, hint: `${agentSlug} ya está en el roster.`, agent: agentSlug };
  const po = await r.get("agents", { projectId: p.id, roleTemplate: "product-owner" });
  await ensureMember(db, p, template, { reportsTo: po?.slug ?? "ceo", note: `Prompt: doc «${title}» (${doc.id}).` });
  const read = await projectRead(db, slug);
  return { agent: read.team.find((m) => m.agent === agentSlug)!, team: read.team };
}

// ---- Máquina

export type Plumbing = {
  company: CompanyState["company"];
  settings: CompanyState["settings"];
  week: CompanyState["week"];
  plan: PlanView;
  // PLA-21: this week's tokens, shown only (no budgets).
  usage: { asistente: WeekUsage; projects: CompanyState["projects"]; week: WeekUsage };
  runs: { live: RunView[]; queued: RunView[] };
  log: RunBrief[];
  viewer: { can_edit_limits: boolean };
};

export async function plumbing(db: Db, now = new Date()): Promise<Plumbing> {
  const state = await companyState(db, now);
  const settings = await loadSettings(db);
  const { startsAt } = await weekBounds(db, now);
  const log = await runLog(db, LOG_SIZE);
  return {
    company: state.company,
    settings: state.settings,
    week: state.week,
    plan: planView(await lastReading(db), settings.planGuardPct, now, settings.guardOverride),
    usage: { asistente: await weekUsage(db, { kind: "asistente" }, startsAt), projects: state.projects, week: await weekUsage(db, { kind: "all" }, startsAt) },
    runs: state.runs,
    log,
    viewer: { can_edit_limits: true },
  };
}

const LOG_SIZE = 30;

// The newest ended runs, by when they ended (else when they were queued). The runs that ended and those that
// never did are each sorted by Postgres; the two lists are merged here.
async function runLog(db: Db, size: number): Promise<RunBrief[]> {
  const r = readerOf(db);
  const ended = await r.find("agentRuns", { status: ENDED_STATUSES, endedAt: notNull() }, { orderBy: [{ column: "endedAt", desc: true }], limit: size });
  const never = await r.find("agentRuns", { status: ENDED_STATUSES, endedAt: null }, { orderBy: [{ column: "queuedAt", desc: true }], limit: size });
  const at = (run: AgentRun) => (run.endedAt ?? run.queuedAt).getTime();
  const runs: AgentRun[] = [];
  while (runs.length < size && (ended.length || never.length)) {
    const fromEnded = !never.length || (ended.length > 0 && at(ended[0]!) >= at(never[0]!));
    runs.push(fromEnded ? ended.shift()! : never.shift()!);
  }
  // Every run has its agent and project (the foreign keys).
  const agentIds = [...new Set(runs.map((x) => x.agentId))];
  const projectIds = [...new Set(runs.map((x) => x.projectId))];
  const agents = new Map(agentIds.length ? (await r.find("agents", { id: agentIds })).map((a) => [a.id, a.slug]) : []);
  const projects = new Map(projectIds.length ? (await r.find("projects", { id: projectIds })).map((p) => [p.id, p.slug]) : []);
  return runs.map((x) => ({
    id: x.id,
    agent: agents.get(x.agentId)!,
    role: x.role,
    project: projects.get(x.projectId)!,
    ticket: x.taskKey ?? null,
    status: x.status,
    summary: x.summary,
    started_at: x.startedAt?.toISOString() ?? null,
    ended_at: x.endedAt?.toISOString() ?? null,
    tokens: x.tokensTotal,
  }));
}
