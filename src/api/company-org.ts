// PLA-I32-6: the read contract of the Compañía pages (Plan doc of PLA-IDEA7, "Contrato de API").
//   GET  /api/company                   companyRead: the company, Asistente, each project with its team and thread, the plumbing line
//   GET  /api/company/projects/:slug    projectRead: today's project sheet plus team, thread_id and the templates to add
//   POST /api/company/projects/:slug/team {template}   addTeamMember: one more agent on the team, from a role template
//   GET  /api/machine                   plumbing (merged into the machine inventory): budgets, plan guard, switches, runs, log
// Tokens only, never money. Cookie-only routes (src/api/company.ts and the /api session for /api/machine).
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { agentRuns, agents, docs, events, projects, questions, tasks, threadMessages, type Actor, type Agent, type Project } from "../db/schema.js";
import { projectSheet, type ProjectSheet, type RunBrief } from "./company-extra.js";
import { agentOfActor, asistenteAgent } from "../runner/events.js";
import { PROMPT_DOCS, budgetView, isRunnerRole, lastReading, loadSettings, planView, roleOf, screenTz, weekBounds, type BudgetView, type PlanView } from "../runner/limits.js";
import { TEAM_TEMPLATES, TEMPLATE_ROWS, ensureMember, isTeamTemplate, teamOf, teamSlug, type TeamTemplate } from "../runner/team.js";
import { actionsFor, companyThread, projectThread, threadSummary } from "../runner/threads.js";
import { companyState, type CompanyState, type RunView } from "../runner/company.js";
import { decisionsRead, type Decision } from "./company-decisions.js";
import { ceoAgentId, nextOf, planOf, thisWeekOf, workOf, type NextLine, type PlanLine, type ThisWeek, type WorkLine } from "./company-plan.js";

const HOUR = 3_600_000;
const QUIET_HOURS = 48;
const promptsProject = () => process.env.PLANIA_PROMPTS_PROJECT || "plania";

export type MemberState = "running" | "idle" | "waiting_jorge" | "paused" | "no_budget";
export type Light = "ok" | "needs_jorge" | "quiet" | "paused" | "no_budget";

export type TeamMember = {
  agent: string;
  role: string;
  template: string | null;
  state: MemberState;
  now: { ticket: string | null; since: string } | null;
  last: { ticket: string | null; status: string; at: string } | null;
  produced: { kind: "doc" | "pr" | "idea" | "plan"; ref: string; title: string } | null;
  waiting: string | null;
};

export type ThreadLine = { id: string; unread: number; last: { at: string; author_role: string; body: string } | null };

export type ProjectCard = {
  slug: string;
  title: string;
  paused: boolean;
  light: Light;
  goal: string | null;
  budget: BudgetView;
  team: TeamMember[];
  thread: ThreadLine;
  // PLA-I35-1: the card as a report (src/api/company-plan.ts).
  plan: PlanLine | null;
  this_week: ThisWeek;
  next: NextLine | null;
  work: WorkLine;
};

export type CompanyRead = {
  company: { paused: boolean };
  week: { starts_at: string; resets_at: string; timezone: string };
  asistente: { thread_id: string; budget: BudgetView; last_run: { status: string; at: string; summary: string } | null; state: MemberState };
  projects: ProjectCard[];
  plumbing: { spend: number; limit: number | null; running: number; paused: boolean };
  // PLA-I35-1: Te toca (src/api/company-decisions.ts).
  decisions: Decision[];
};

const ORDER = new Map<string, number>(TEAM_TEMPLATES.map((t, i) => [t, i]));
const byTemplate = (a: Agent, b: Agent) => (ORDER.get(a.roleTemplate ?? "") ?? 99) - (ORDER.get(b.roleTemplate ?? "") ?? 99) || a.slug.localeCompare(b.slug);

// Open questions per asker (resolved through runner sessions or roster slugs), oldest first.
async function openQuestionsByAgent(db: Db, projectId?: string): Promise<Map<string, string>> {
  const rows = await db
    .select({ askedBy: questions.askedBy, question: questions.question })
    .from(questions)
    .where(and(isNull(questions.answeredAt), projectId ? eq(questions.projectId, projectId) : undefined))
    .orderBy(asc(questions.askedAt));
  const out = new Map<string, string>();
  for (const r of rows) {
    const a = await agentOfActor(db, r.askedBy as Actor);
    if (a && !out.has(a.id)) out.set(a.id, r.question);
  }
  return out;
}

async function lastRunOf(db: Db, agentId: string) {
  const [running] = await db
    .select({ taskKey: agentRuns.taskKey, startedAt: agentRuns.startedAt })
    .from(agentRuns)
    .where(and(eq(agentRuns.agentId, agentId), eq(agentRuns.status, "running")))
    .limit(1);
  const [ended] = await db
    .select({ taskKey: agentRuns.taskKey, status: agentRuns.status, endedAt: agentRuns.endedAt, summary: agentRuns.summary })
    .from(agentRuns)
    .where(and(eq(agentRuns.agentId, agentId), sql`${agentRuns.endedAt} is not null`))
    .orderBy(desc(agentRuns.endedAt))
    .limit(1);
  return { running: running ?? null, ended: ended ?? null };
}

// The newest thing a member delivered, from its own lines in the project thread.
async function producedBy(db: Db, threadId: string, slug: string): Promise<TeamMember["produced"]> {
  const rows = await db
    .select({ links: threadMessages.links })
    .from(threadMessages)
    .where(and(eq(threadMessages.threadId, threadId), eq(threadMessages.authorAgent, slug)))
    .orderBy(desc(threadMessages.at))
    .limit(20);
  for (const r of rows) {
    const link = r.links.find((l) => l.kind === "doc" || l.kind === "pr" || l.kind === "idea");
    if (!link) continue;
    const kind = link.kind === "doc" && /^plan\b/i.test(link.title) ? "plan" : (link.kind as "doc" | "pr" | "idea");
    return { kind, ref: link.ref, title: link.title };
  }
  return null;
}

async function memberView(db: Db, a: Agent, ctx: { paused: boolean; noBudget: boolean; threadId: string; waiting: Map<string, string> }): Promise<TeamMember> {
  const { running, ended } = await lastRunOf(db, a.id);
  const waiting = ctx.waiting.get(a.id) ?? null;
  const state: MemberState = running ? "running" : ctx.paused ? "paused" : waiting ? "waiting_jorge" : ctx.noBudget ? "no_budget" : "idle";
  return {
    agent: a.slug,
    role: roleOf(a) ?? a.role,
    template: a.roleTemplate ?? null,
    state,
    now: running ? { ticket: running.taskKey, since: (running.startedAt ?? new Date()).toISOString() } : null,
    last: ended ? { ticket: ended.taskKey, status: ended.status, at: ended.endedAt!.toISOString() } : null,
    produced: await producedBy(db, ctx.threadId, a.slug),
    waiting,
  };
}

async function goalOf(db: Db, projectId: string): Promise<string | null> {
  const rows = await db.execute<{ title: string }>(sql`select title from goals where project_id = ${projectId} and status = 'active' order by position, created_at limit 1`);
  return rows.rows[0]?.title ?? null;
}

// paused, then no budget, then something waits on Jorge (an open question, a Needs Jorge ticket, a message
// with buttons), then quiet (no event in 48 h), else ok.
async function lightOf(db: Db, p: Project, paused: boolean, budget: BudgetView, threadId: string, now: Date): Promise<Light> {
  if (paused) return "paused";
  if (budget.state === "stopped") return "no_budget";
  const [q] = await db.select({ id: questions.id }).from(questions).where(and(eq(questions.projectId, p.id), isNull(questions.answeredAt))).limit(1);
  const [nj] = await db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.projectId, p.id), eq(tasks.status, "Needs Jorge"))).limit(1);
  if (q || nj) return "needs_jorge";
  const recent = await db.select().from(threadMessages).where(and(eq(threadMessages.threadId, threadId), isNull(threadMessages.actionState))).orderBy(desc(threadMessages.at)).limit(30);
  for (const m of recent) if ((await actionsFor(db, m, p.id)).length > 0) return "needs_jorge";
  const [last] = await db.select({ at: events.createdAt }).from(events).where(eq(events.projectId, p.id)).orderBy(desc(events.id)).limit(1);
  if (!last || now.getTime() - last.at.getTime() > QUIET_HOURS * HOUR) return "quiet";
  return "ok";
}

async function teamView(db: Db, p: Project, ctx: { paused: boolean; noBudget: boolean; threadId: string }): Promise<TeamMember[]> {
  const waiting = await openQuestionsByAgent(db, p.id);
  const out: TeamMember[] = [];
  for (const a of (await teamOf(db, p.id)).sort(byTemplate)) out.push(await memberView(db, a, { ...ctx, waiting }));
  return out;
}

const threadLine = (s: Awaited<ReturnType<typeof threadSummary>>): ThreadLine => ({ id: s.id, unread: s.unread, last: s.last });

export async function companyRead(db: Db, now = new Date()): Promise<CompanyRead> {
  const settings = await loadSettings(db);
  const tz = screenTz();
  const { startsAt, resetsAt } = await weekBounds(db, now, tz);
  const cards: ProjectCard[] = [];
  let limitSum = 0;
  let anyLimit = false;
  const ceoId = await ceoAgentId(db);
  for (const p of await db.select().from(projects).orderBy(asc(projects.slug))) {
    const budget = await budgetView(db, { kind: "project", projectId: p.id }, startsAt);
    if (budget.limit != null) {
      limitSum += budget.limit;
      anyLimit = true;
    }
    const thread = await threadSummary(db, await projectThread(db, p.id), p);
    const paused = settings.companyPaused || p.runsPaused;
    const plan = await planOf(db, p, now);
    cards.push({
      slug: p.slug,
      title: p.title,
      paused: p.runsPaused,
      light: await lightOf(db, p, paused, budget, thread.id, now),
      goal: await goalOf(db, p.id),
      budget,
      team: await teamView(db, p, { paused, noBudget: budget.state === "stopped", threadId: thread.id }),
      thread: threadLine(thread),
      plan,
      this_week: await thisWeekOf(db, p, now),
      next: await nextOf(db, p, ceoId, plan?.initiative.key ?? null),
      work: await workOf(db, p),
    });
  }

  const asisBudget = await budgetView(db, { kind: "asistente" }, startsAt);
  if (asisBudget.limit != null) {
    limitSum += asisBudget.limit;
    anyLimit = true;
  }
  const company = await companyThread(db);
  const asis = await asistenteAgent(db);
  let lastRun: CompanyRead["asistente"]["last_run"] = null;
  let state: MemberState = settings.companyPaused ? "paused" : asisBudget.state === "stopped" ? "no_budget" : "idle";
  if (asis) {
    const { running, ended } = await lastRunOf(db, asis.id);
    if (ended) lastRun = { status: ended.status, at: ended.endedAt!.toISOString(), summary: ended.summary };
    if (running) state = "running";
    else if (!settings.companyPaused && (await openQuestionsByAgent(db)).has(asis.id)) state = "waiting_jorge";
  }

  const spend = await db.execute<{ used: string }>(sql`
    select coalesce(sum(case when status = 'running' then greatest(tokens_total, reserve_tokens) else tokens_total end), 0)::bigint as used
    from agent_runs where status in ('running', 'ok', 'fail', 'stopped') and coalesce(started_at, queued_at) >= ${startsAt.toISOString()}::timestamptz`);
  const [running] = await db.select({ n: sql<number>`count(*)::int` }).from(agentRuns).where(eq(agentRuns.status, "running"));

  return {
    company: { paused: settings.companyPaused },
    week: { starts_at: startsAt.toISOString(), resets_at: resetsAt.toISOString(), timezone: tz },
    asistente: { thread_id: company.id, budget: asisBudget, last_run: lastRun, state },
    projects: cards,
    plumbing: { spend: Number(spend.rows[0]?.used ?? 0), limit: anyLimit ? limitSum : null, running: running?.n ?? 0, paused: settings.companyPaused },
    decisions: await decisionsRead(db, now),
  };
}

// ---- One project

export type TemplateRef = { slug: TeamTemplate; title: string };
export type ProjectRead = ProjectSheet & { team: TeamMember[]; thread_id: string; templates: TemplateRef[] };

// The templates that have their prompt doc in Plania (`Prompt: <role>`) and are not on this team yet.
async function templatesFor(db: Db, team: TeamMember[]): Promise<TemplateRef[]> {
  const titles = TEAM_TEMPLATES.filter((t) => isRunnerRole(t)).map((t) => PROMPT_DOCS[t as keyof typeof PROMPT_DOCS]);
  const found = await db
    .select({ title: docs.title })
    .from(docs)
    .innerJoin(projects, eq(projects.id, docs.projectId))
    .where(and(eq(projects.slug, promptsProject()), isNull(docs.taskId), inArray(docs.title, titles)));
  const have = new Set(found.map((d) => d.title));
  const taken = new Set(team.map((m) => m.template));
  return TEAM_TEMPLATES.filter((t) => have.has(PROMPT_DOCS[t as keyof typeof PROMPT_DOCS]) && !taken.has(t)).map((t) => ({ slug: t, title: TEMPLATE_ROWS[t].title }));
}

export async function projectRead(db: Db, slug: string, now = new Date()): Promise<ProjectRead> {
  const sheet = await projectSheet(db, slug);
  const [p] = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
  const settings = await loadSettings(db);
  const { startsAt } = await weekBounds(db, now);
  const budget = await budgetView(db, { kind: "project", projectId: p!.id }, startsAt);
  const thread = await projectThread(db, p!.id);
  const team = await teamView(db, p!, { paused: settings.companyPaused || p!.runsPaused, noBudget: budget.state === "stopped", threadId: thread.id });
  return { ...sheet, team, thread_id: thread.id, templates: await templatesFor(db, team) };
}

export type AddMemberError = { error: "PROJECT_NOT_FOUND" | "INVALID_TEMPLATE" | "PROMPT_DOC_MISSING" | "AGENT_EXISTS"; status: 400 | 404 | 409; hint: string; agent?: string };

export async function addTeamMember(db: Db, slug: string, template: string): Promise<{ agent: TeamMember; team: TeamMember[] } | AddMemberError> {
  const [p] = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
  if (!p) return { error: "PROJECT_NOT_FOUND", status: 404, hint: "no such project" };
  if (!isTeamTemplate(template)) return { error: "INVALID_TEMPLATE", status: 400, hint: `one of ${TEAM_TEMPLATES.join(", ")}` };
  const title = PROMPT_DOCS[template as keyof typeof PROMPT_DOCS];
  const [doc] = await db
    .select({ id: docs.id })
    .from(docs)
    .innerJoin(projects, eq(projects.id, docs.projectId))
    .where(and(eq(projects.slug, promptsProject()), isNull(docs.taskId), eq(docs.title, title)))
    .limit(1);
  if (!doc) return { error: "PROMPT_DOC_MISSING", status: 409, hint: `Falta el doc «${title}» en Plania.` };
  const agentSlug = teamSlug(template, p.slug);
  const [taken] = await db.select({ id: agents.id }).from(agents).where(eq(agents.slug, agentSlug)).limit(1);
  if (taken) return { error: "AGENT_EXISTS", status: 409, hint: `${agentSlug} ya está en el roster.`, agent: agentSlug };
  const po = await db.select().from(agents).where(and(eq(agents.projectId, p.id), eq(agents.roleTemplate, "product-owner"))).limit(1);
  await ensureMember(db, p, template, { reportsTo: po[0]?.slug ?? "ceo", note: `Prompt: doc «${title}» (${doc.id}).` });
  const read = await projectRead(db, slug);
  return { agent: read.team.find((m) => m.agent === agentSlug)!, team: read.team };
}

// ---- Máquina

export type Plumbing = {
  company: CompanyState["company"];
  settings: CompanyState["settings"] & { asistente_weekly_limit: number | null };
  week: CompanyState["week"];
  plan: PlanView;
  budgets: { asistente: BudgetView; projects: { slug: string; title: string; paused: boolean; paused_at: string | null; budget: BudgetView }[] };
  runs: { live: RunView[]; queued: RunView[] };
  log: RunBrief[];
  viewer: { can_edit_limits: boolean };
};

export async function plumbing(db: Db, now = new Date()): Promise<Plumbing> {
  const state = await companyState(db, now);
  const settings = await loadSettings(db);
  const { startsAt } = await weekBounds(db, now);
  const log = await db.execute<Record<string, unknown>>(sql`
    select r.id, a.slug as agent, r.role, p.slug as project, r.task_key as ticket, r.status, r.summary, r.started_at, r.ended_at, r.tokens_total as tokens
    from agent_runs r join agents a on a.id = r.agent_id join projects p on p.id = r.project_id
    where r.status not in ('queued', 'running') order by coalesce(r.ended_at, r.queued_at) desc limit 30`);
  const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v ? new Date(String(v)).toISOString() : null);
  return {
    company: state.company,
    settings: { ...state.settings, asistente_weekly_limit: settings.asistenteWeeklyLimit == null ? null : Number(settings.asistenteWeeklyLimit) },
    week: state.week,
    plan: planView(await lastReading(db), settings.planGuardPct, now),
    budgets: { asistente: await budgetView(db, { kind: "asistente" }, startsAt), projects: state.projects },
    runs: state.runs,
    log: log.rows.map((r) => ({
      id: String(r.id),
      agent: String(r.agent),
      role: String(r.role),
      project: String(r.project),
      ticket: (r.ticket as string | null) ?? null,
      status: String(r.status),
      summary: String(r.summary ?? ""),
      started_at: iso(r.started_at),
      ended_at: iso(r.ended_at),
      tokens: Number(r.tokens ?? 0),
    })),
    viewer: { can_edit_limits: true },
  };
}
