// PLA-I30: what the Compañía screen reads on top of companyState (src/runner/company.ts), which stays as built.
// Read only, on the same cookie-only routes (src/api/company.ts):
//   GET /api/company            gains viewer, prompts, roster and project_facts (existing fields keep their meaning)
//   GET /api/company/projects/:slug   the project sheet: goal, idea pipeline, en curso / bloqueado / siguiente, recent runs
//   GET /api/company/docs/:id   one role prompt doc (title "Prompt: …"), for Prompt ↗; PLA-I36-2: or a doc attached
//                               to a ticket (the evidence a Te toca row links). Project-level docs stay out.
// Tokens are input + output + cache counts, as everywhere on this page. No money.
import type { Db } from "../db/client.js";
import { RUN_STATUSES, type AgentRun, type Task } from "../db/schema.js";
import { ToolError } from "../mcp/errors.js";
import { iso } from "../mcp/tx.js";
import { loadReady, pickReady } from "../jobs/heartbeat.js";
import { PROMPT_DOCS, RUNNER_ROLES, roleOf, type RunnerRole } from "../runner/limits.js";
import { readerOf } from "../store/pg.js";
import { ne, notNull } from "../store/types.js";

export type PromptRef = { doc_id: string; title: string; version: number };

export type RunBrief = {
  // PLA-I30-8: a "fail: missing env X" run once X is set on the server: shown as resolved.
  resolved?: boolean;
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
};

export type RosterRow = {
  slug: string;
  name: string;
  role: RunnerRole;
  project: string | null;
  heartbeat_minutes: number | null;
  next_wake_at: string | null;
  last_run: RunBrief | null;
};

export type ProjectFacts = {
  goal: string | null;
  in_flight: number;
  blocked: number;
  last_move_at: string | null;
  po: { slug: string; name: string } | null;
  last_run: RunBrief | null;
  // PLA-I30-8: Ready tickets here that some runner bot would pick (0 in a paused project).
  bot_work: number;
};

export type CompanyExtras = {
  // The route only answers Jorge's cookie, so this is always true there. The sheets take it as a prop and
  // hide Cambiar and Mover guardia when it is false.
  viewer: { can_edit_limits: boolean };
  prompts: Record<RunnerRole, PromptRef | null>;
  roster: RosterRow[];
  project_facts: Record<string, ProjectFacts>;
};

const MISSING_ENV = /^fail: missing env ([A-Z0-9_]+)/;
const resolvedNow = (summary: string): boolean => {
  const m = MISSING_ENV.exec(summary);
  return !!m && !!process.env[m[1]!]?.trim();
};

// A run that ended one way or another: every status but queued and running (the table's check allows no others).
export const ENDED_STATUSES = RUN_STATUSES.filter((s) => s !== "queued" && s !== "running");

// PLA-I30-8: per project, how many Ready tickets a runner bot (claude_code, with a runner role) would pick.
export async function botWorkBy(db: Db): Promise<Map<string, number>> {
  const ready = await loadReady(db);
  // roleOf gets slug, role and capabilities only (role_template stays out), so the older rules decide.
  const bots = (await readerOf(db).find("agents", { adapter: "claude_code" }))
    .map((a) => ({ id: a.id, slug: a.slug, role: a.role, capabilities: a.capabilities ?? [] }))
    .filter((a) => roleOf(a) !== null);
  const out = new Map<string, number>();
  for (const row of ready) {
    if (bots.some((b) => pickReady(b, [row]) !== null)) out.set(row.project, (out.get(row.project) ?? 0) + 1);
  }
  return out;
}

// One run as the screen shows it, with its agent's and project's slugs.
const runOf = (r: AgentRun, agent: string, project: string): RunBrief => ({
  ...(resolvedNow(r.summary) ? { resolved: true } : {}),
  id: r.id,
  agent,
  role: r.role,
  project,
  ticket: r.taskKey ?? null,
  status: r.status,
  summary: r.summary,
  started_at: iso(r.startedAt),
  ended_at: iso(r.endedAt),
  tokens: r.tokensTotal,
});

// The slugs of some runs' agents, by agent id.
async function agentSlugs(db: Db, runs: AgentRun[]): Promise<Map<string, string>> {
  const ids = [...new Set(runs.map((r) => r.agentId))];
  return new Map(ids.length ? (await readerOf(db).find("agents", { id: ids })).map((a) => [a.id, a.slug]) : []);
}

const promptsProject = () => process.env.PLANIA_PROMPTS_PROJECT || "plania";
const promptTitles = (): string[] => RUNNER_ROLES.map((role) => PROMPT_DOCS[role]);

export async function promptRefs(db: Db): Promise<Record<RunnerRole, PromptRef | null>> {
  const r = readerOf(db);
  const home = await r.get("projects", { slug: promptsProject() });
  const found = home ? await r.find("docs", { projectId: home.id, taskId: null, title: promptTitles() }) : [];
  const byTitle = new Map(found.map((d) => [d.title, d]));
  const out = {} as Record<RunnerRole, PromptRef | null>;
  for (const role of RUNNER_ROLES) {
    const d = byTitle.get(PROMPT_DOCS[role]);
    out[role] = d ? { doc_id: d.id, title: d.title, version: d.version } : null;
  }
  return out;
}

// Which project a product owner serves: po-<slug>, else a capability that names a project.
export function poProject(agent: { slug: string; capabilities: string[] }, projectSlugs: Set<string>): string | null {
  if (agent.slug.startsWith("po-") && projectSlugs.has(agent.slug.slice(3))) return agent.slug.slice(3);
  return agent.capabilities.find((c) => projectSlugs.has(c)) ?? null;
}

export async function companyExtras(db: Db, now = new Date()): Promise<CompanyExtras> {
  const r = readerOf(db);
  const projectRows = await r.find("projects", {}, { orderBy: [{ column: "slug" }] });
  const slugs = new Set(projectRows.map((p) => p.slug));
  const slugById = new Map(projectRows.map((p) => [p.id, p.slug]));
  const agentRows = await r.find("agents", { kind: ne("human") }, { orderBy: [{ column: "slug" }] });
  const agentSlug = new Map(agentRows.map((a) => [a.id, a.slug]));
  // The newest run (by queued_at) of each agent in each project, in agent then project id order: Postgres
  // sorts, so ids and times compare as it stores them. Only these agents' runs are ever looked up.
  const runRows = agentRows.length
    ? await r.find("agentRuns", { agentId: agentRows.map((a) => a.id) }, { orderBy: [{ column: "agentId" }, { column: "projectId" }, { column: "queuedAt", desc: true }] })
    : [];
  const lastRuns: { run: AgentRun; agent: string; project: string }[] = [];
  const seen = new Set<string>();
  for (const run of runRows) {
    const pair = `${run.agentId} ${run.projectId}`;
    const project = slugById.get(run.projectId);
    if (seen.has(pair) || project === undefined) continue;
    seen.add(pair);
    lastRuns.push({ run, agent: agentSlug.get(run.agentId)!, project });
  }
  const latestFor = (agentId: string, project?: string) =>
    lastRuns
      .filter((x) => x.run.agentId === agentId && (!project || x.project === project))
      .sort((a, b) => String(iso(b.run.startedAt) ?? "").localeCompare(String(iso(a.run.startedAt) ?? "")))[0];
  const briefOf = (x: (typeof lastRuns)[number] | undefined) => (x ? runOf(x.run, x.agent, x.project) : null);

  const roster: RosterRow[] = [];
  for (const a of agentRows) {
    const capabilities = a.capabilities ?? [];
    // roleOf gets slug, role and capabilities only (role_template stays out), so the older rules decide.
    const role = roleOf({ slug: a.slug, role: a.role, capabilities });
    if (!role) continue;
    const minutes = a.heartbeatMinutes ?? null;
    const last = a.lastHeartbeatAt;
    const next = minutes == null ? null : last ? new Date(Math.max(last.getTime() + minutes * 60_000, now.getTime())) : now;
    const project = role === "product-owner" ? poProject({ slug: a.slug, capabilities }, slugs) : null;
    roster.push({
      slug: a.slug,
      name: a.name,
      role,
      project,
      heartbeat_minutes: minutes,
      next_wake_at: next?.toISOString() ?? null,
      last_run: briefOf(latestFor(a.id)),
    });
  }

  // Each project's first active goal by position, then creation (company goals have no project).
  const goalBy = new Map<string, string>();
  for (const g of await r.find("goals", { status: "active", projectId: notNull() }, { orderBy: [{ column: "position" }, { column: "createdAt" }] })) {
    const slug = slugById.get(g.projectId!);
    if (slug !== undefined && !goalBy.has(slug)) goalBy.set(slug, g.title);
  }
  const botWork = await botWorkBy(db);
  // One entry per project, in slug order. (The grouped query had no order; its rows came in hash order.)
  const facts: Record<string, ProjectFacts> = {};
  for (const p of projectRows) {
    const slug = p.slug;
    const po = roster.find((x) => x.role === "product-owner" && x.project === slug) ?? null;
    const poAgent = po ? agentRows.find((a) => a.slug === po.slug) : undefined;
    // The last move is the newest updated_at among all the project's tasks, of any kind.
    const [lastMove] = await r.find("tasks", { projectId: p.id }, { orderBy: [{ column: "updatedAt", desc: true }], limit: 1 });
    facts[slug] = {
      goal: goalBy.get(slug) ?? null,
      in_flight: await r.count("tasks", { projectId: p.id, kind: "ticket", status: ["In progress", "In review"] }),
      blocked: await r.count("tasks", { projectId: p.id, kind: "ticket", status: ["Blocked", "Needs Jorge"] }),
      last_move_at: iso(lastMove?.updatedAt ?? null),
      po: po ? { slug: po.slug, name: po.name } : null,
      last_run: poAgent ? briefOf(latestFor(poAgent.id, slug)) : null,
      bot_work: botWork.get(slug) ?? 0,
    };
  }
  return { viewer: { can_edit_limits: true }, prompts: await promptRefs(db), roster, project_facts: facts };
}

export const PIPELINE_STAGES = ["idea", "research", "design", "planning", "ready"] as const;

export type ProjectSheet = {
  slug: string;
  title: string;
  goal: string | null;
  pipeline: { stage: (typeof PIPELINE_STAGES)[number]; count: number; newest: string | null }[];
  in_progress: { key: string; title: string; status: string; owner: string | null }[];
  blocked: { key: string; title: string; status: string; why: string }[];
  // yours: owned by the human seat (ceo); no bot takes it (PLA-I30-8).
  next: { key: string; title: string; priority: string | null; yours: boolean }[];
  runs: RunBrief[];
  bot_work: number;
};

export async function projectSheet(db: Db, slug: string): Promise<ProjectSheet> {
  const r = readerOf(db);
  const project = await r.get("projects", { slug });
  if (!project) throw new ToolError("PROJECT_NOT_FOUND", { project: slug });
  const id = project.id;
  const [goal] = await r.find("goals", { projectId: id, status: "active" }, { orderBy: [{ column: "position" }, { column: "createdAt" }], limit: 1 });
  // Open ideas per stage: how many, and the title of the newest.
  const ideaBy = new Map<string, { n: number; newest: string }>();
  for (const t of await r.find("tasks", { projectId: id, kind: "idea", status: "Open" }, { orderBy: [{ column: "createdAt", desc: true }] })) {
    const hit = ideaBy.get(String(t.stage));
    if (hit) hit.n += 1;
    else ideaBy.set(String(t.stage), { n: 1, newest: t.title });
  }
  // Who has it: the lease holder's agent, else the name of the agent it is assigned to.
  const ownerOf = async (t: Task): Promise<string | null> => {
    if (t.owner?.agent != null) return String(t.owner.agent);
    return t.ownerAgent ? ((await r.get("agents", { id: t.ownerAgent }))?.name ?? null) : null;
  };
  const inProgress = await r.find("tasks", { projectId: id, kind: "ticket", status: ["In progress", "In review"] }, { orderBy: [{ column: "updatedAt", desc: true }], limit: 6 });
  const blocked = await r.find("tasks", { projectId: id, kind: "ticket", status: ["Blocked", "Needs Jorge"] }, { orderBy: [{ column: "updatedAt", desc: true }], limit: 6 });
  // Priority first with a missing one last (it sorted as P9, after P0..P3, the only priorities a write accepts),
  // then the oldest. Postgres sorts.
  const next = await r.find("tasks", { projectId: id, kind: "ticket", status: "Ready" }, { orderBy: [{ column: "priority" }, { column: "createdAt" }], limit: 5 });
  // Jorge's: assigned to a human seat or to ceo.
  const yours = async (t: Task): Promise<boolean> => {
    const a = t.ownerAgent ? await r.get("agents", { id: t.ownerAgent }) : undefined;
    return !!a && (a.kind === "human" || a.slug === "ceo");
  };
  const runs = await r.find("agentRuns", { projectId: id, status: ENDED_STATUSES }, { orderBy: [{ column: "queuedAt", desc: true }], limit: 8 });
  const slugOf = await agentSlugs(db, runs);
  const inProgressRows: ProjectSheet["in_progress"] = [];
  for (const t of inProgress) inProgressRows.push({ key: t.key, title: t.title, status: t.status, owner: await ownerOf(t) });
  const nextRows: ProjectSheet["next"] = [];
  for (const t of next) nextRows.push({ key: t.key, title: t.title, priority: t.priority ?? null, yours: await yours(t) });
  return {
    slug: project.slug,
    title: project.title,
    goal: goal ? goal.title : null,
    pipeline: PIPELINE_STAGES.map((stage) => {
      const hit = ideaBy.get(stage);
      return { stage, count: hit?.n ?? 0, newest: hit?.newest ?? null };
    }),
    in_progress: inProgressRows,
    blocked: blocked.map((t) => ({ key: t.key, title: t.title, status: t.status, why: t.blockedNote || (t.status === "Needs Jorge" ? "te espera a ti" : "bloqueado") })),
    next: nextRows,
    runs: runs.map((x) => runOf(x, slugOf.get(x.agentId)!, project.slug)),
    bot_work: (await botWorkBy(db)).get(project.slug) ?? 0,
  };
}

// Only the role prompt docs, so this route never becomes a general doc reader.
export async function promptDoc(db: Db, id: string): Promise<{ id: string; title: string; version: number; markdown: string }> {
  const r = readerOf(db);
  const doc = await r.get("docs", { id });
  const owner = doc ? await r.get("projects", { id: doc.projectId }) : undefined;
  // A doc on a ticket, or one of the role prompts at the prompts project's level.
  if (!doc || !owner || !(doc.taskId !== null || (owner.slug === promptsProject() && promptTitles().includes(doc.title)))) throw new ToolError("DOC_NOT_FOUND", { doc_id: id });
  return { id: doc.id, title: doc.title, version: doc.version, markdown: doc.markdown };
}
