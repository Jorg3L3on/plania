// PLA-I32-6: the read contract of the Compañía pages (Plan doc of PLA-IDEA7, "Contrato de API").
//   GET  /api/company                   companyRead: the company, Asistente, each project with its team and thread, the plumbing line
//   GET  /api/company/projects/:slug    projectRead: today's project sheet plus team, thread_id and the templates to add
//   POST /api/company/projects/:slug/team {template}   addTeamMember: one more agent on the team, from a role template
//   GET  /api/machine                   plumbing (merged into the machine inventory): week usage, plan guard, switches, runs, log
// Tokens only, never money. Cookie-only routes (src/api/company.ts and the /api session for /api/machine).
import type { Db } from "../db/client.js";
import type { Actor, Agent, AgentRun, Project } from "../db/schema.js";
import { readerOf } from "../store/pg.js";
import { gte, notNull } from "../store/types.js";
import { ENDED_STATUSES, projectSheet, type ProjectSheet, type RunBrief } from "./company-extra.js";
import { agentOfActor, asistenteAgent } from "../runner/events.js";
import { PROMPT_DOCS, isRunnerRole, lastReading, loadSettings, planView, roleOf, screenTz, weekBounds, weekUsage, type CardUsage, type PlanView, type WeekUsage } from "../runner/limits.js";
import { TEAM_TEMPLATES, TEMPLATE_ROWS, ensureMember, isTeamTemplate, teamOf, teamSlug, type TeamTemplate } from "../runner/team.js";
import { actionsFor, companyThread, projectThread, threadSummary } from "../runner/threads.js";
import { companyState, type CompanyState, type RunView } from "../runner/company.js";
import { decisionsRead, inboxByProject, type Decision } from "./company-decisions.js";
import { ordersOf, type Order } from "./company-orders.js";
import { loadReadiness } from "../mcp/readiness.js";
import type { InboxItem } from "../mcp/inbox.js";
import { ceoAgentId, planOf, readyOf, type QueuedTicket, type ReadyLine, thisWeekOf, workOf, type NextLine, type PlanLine, type ThisWeek, type WorkLine } from "./company-plan.js";

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
};

export type QueueItem = { key: string; title: string };
const QUEUE_MAX = 3;

export type ThreadLine = { id: string; unread: number; last: { at: string; author_role: string; body: string } | null };

export type ProjectCard = {
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
  this_week: ThisWeek;
  next: NextLine | null;
  // PLA-I36-6: the next Ready tickets, for Cambiar lo siguiente.
  ready: ReadyLine[];
  // PLA-I36-8: whether a PO's plan waits for "Sí, empiecen". PLA-I36-10: the running preview.
  plan_approval: boolean;
  preview_url: string | null;
  work: WorkLine;
  // PLA-I36-3: Tus órdenes (src/api/company-orders.ts).
  orders: Order[];
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
async function producedBy(db: Db, threadId: string, slug: string): Promise<TeamMember["produced"]> {
  const rows = await readerOf(db).find("threadMessages", { threadId, authorAgent: slug }, { orderBy: [{ column: "at", desc: true }], limit: 20 });
  for (const r of rows) {
    const link = r.links.find((l) => l.kind === "doc" || l.kind === "pr" || l.kind === "idea");
    if (!link) continue;
    const kind = link.kind === "doc" && /^plan\b/i.test(link.title) ? "plan" : (link.kind as "doc" | "pr" | "idea");
    return { kind, ref: link.ref, title: link.title };
  }
  return null;
}

async function ticketTitle(db: Db, projectId: string | null, key: string | null): Promise<string | null> {
  if (!projectId || !key) return null;
  return (await readerOf(db).get("tasks", { projectId, key }))?.title ?? null;
}

async function memberView(db: Db, a: Agent, ctx: { paused: boolean; threadId: string; waiting: Map<string, string> }): Promise<TeamMember> {
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
    produced: await producedBy(db, ctx.threadId, a.slug),
    waiting,
  };
}

type GoalRow = { id: string; title: string; why: string; target_on: string | null };
async function goalOf(db: Db, projectId: string): Promise<GoalRow | null> {
  const [g] = await readerOf(db).find(
    "goals",
    { projectId, status: "active", parentId: null },
    { orderBy: [{ column: "position" }, { column: "createdAt" }], limit: 1 },
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
  for (const m of recent) if ((await actionsFor(db, m, p.id)).length > 0) return jorge("Una entrega espera tu visto bueno.");

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
  const out: TeamMember[] = [];
  for (const a of (await teamOf(db, p.id)).sort(byTemplate)) out.push(await memberView(db, a, { ...ctx, waiting }));
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
    fillQueues(team, upNext.queued, new Map(slugs.map((a) => [a.id, a.slug])));
    const light = await lightOf(db, p, { paused, threadId: thread.id, now, ceoId, team, plan, inbox: inbox.get(p.slug) ?? [] });
    cards.push({
      slug: p.slug,
      title: p.title,
      paused: p.runsPaused,
      light: light.light,
      light_reason: light.reason,
      goal: goal?.title ?? null,
      rumbo: rumboOf(goal, plan),
      usage,
      team,
      thread: threadLine(thread),
      plan,
      this_week: await thisWeekOf(db, p, now),
      next: upNext.next,
      ready: upNext.ready,
      plan_approval: !!p.settings.plan_approval,
      preview_url: p.settings.preview_url ?? null,
      work: await workOf(db, p),
      orders: await ordersOf(db, p, thread.id, now),
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

  // This week's tokens of every run that ran, counted from when it started (else when it was queued).
  const spent = ["running", "ok", "fail", "stopped"];
  const thisWeek = [
    ...(await r.find("agentRuns", { status: spent, startedAt: gte(startsAt) })),
    ...(await r.find("agentRuns", { status: spent, startedAt: null, queuedAt: gte(startsAt) })),
  ];
  const spend = thisWeek.reduce((sum, run) => sum + run.tokensTotal, 0);
  const running = await r.count("agentRuns", { status: "running" });

  return {
    company: { paused: settings.companyPaused },
    week: { starts_at: startsAt.toISOString(), resets_at: resetsAt.toISOString(), timezone: tz },
    asistente: { thread_id: company.id, usage: asisUsage, last_run: lastRun, state, unread: companyUnread },
    projects: cards,
    plumbing: { spend, running, paused: settings.companyPaused },
    decisions: await decisionsRead(db, now, inbox),
    inbox: countInbox(inbox),
  };
}

// ---- One project

export type TemplateRef = { slug: TeamTemplate; title: string };
export type ProjectRead = ProjectSheet & { team: TeamMember[]; thread_id: string; templates: TemplateRef[] };

// The prompts project's own docs (not a ticket's) with these titles.
async function promptDocs(db: Db, titles: string[]) {
  const r = readerOf(db);
  const home = await r.get("projects", { slug: promptsProject() });
  return home ? r.find("docs", { projectId: home.id, taskId: null, title: titles }) : [];
}

// The templates that have their prompt doc in Plania (`Prompt: <role>`) and are not on this team yet.
async function templatesFor(db: Db, team: TeamMember[]): Promise<TemplateRef[]> {
  const titles = TEAM_TEMPLATES.filter((t) => isRunnerRole(t)).map((t) => PROMPT_DOCS[t as keyof typeof PROMPT_DOCS]);
  const found = await promptDocs(db, titles);
  const have = new Set(found.map((d) => d.title));
  const taken = new Set(team.map((m) => m.template));
  return TEAM_TEMPLATES.filter((t) => have.has(PROMPT_DOCS[t as keyof typeof PROMPT_DOCS]) && !taken.has(t)).map((t) => ({ slug: t, title: TEMPLATE_ROWS[t].title }));
}

export async function projectRead(db: Db, slug: string, now = new Date()): Promise<ProjectRead> {
  const sheet = await projectSheet(db, slug);
  const p = await readerOf(db).get("projects", { slug });
  const settings = await loadSettings(db);
  const thread = await projectThread(db, p!.id);
  const team = await teamView(db, p!, { paused: settings.companyPaused || p!.runsPaused, threadId: thread.id });
  return { ...sheet, team, thread_id: thread.id, templates: await templatesFor(db, team) };
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
  usage: { asistente: WeekUsage; projects: CompanyState["projects"] };
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
    usage: { asistente: await weekUsage(db, { kind: "asistente" }, startsAt), projects: state.projects },
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
