// PLA-I30: what the Compañía screen reads on top of companyState (src/runner/company.ts), which stays as built.
// Read only, on the same cookie-only routes (src/api/company.ts):
//   GET /api/company            gains viewer, prompts, roster and project_facts (existing fields keep their meaning)
//   GET /api/company/projects/:slug   the project sheet: goal, idea pipeline, en curso / bloqueado / siguiente, recent runs
//   GET /api/company/docs/:id   one role prompt doc (title "Prompt: …"), for Prompt ↗
// Tokens are input + output + cache counts, as everywhere on this page. No money.
import { sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { ToolError } from "../mcp/errors.js";
import { PROMPT_DOCS, RUNNER_ROLES, roleOf, type RunnerRole } from "../runner/limits.js";

export type PromptRef = { doc_id: string; title: string; version: number };

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
};

export type CompanyExtras = {
  // The route only answers Jorge's cookie, so this is always true there. The sheets take it as a prop and
  // hide Cambiar, Subir límite and Mover guardia when it is false.
  viewer: { can_edit_limits: boolean };
  prompts: Record<RunnerRole, PromptRef | null>;
  roster: RosterRow[];
  project_facts: Record<string, ProjectFacts>;
};

type Row = Record<string, unknown>;
const rows = async (db: Db, query: ReturnType<typeof sql>): Promise<Row[]> => (await db.execute(query)).rows as Row[];
const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : typeof v === "string" ? new Date(v).toISOString() : null);

const runOf = (r: Row): RunBrief => ({
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
});

const RUN_COLUMNS = sql`r.id, a.slug as agent, r.role, p.slug as project, r.task_key as ticket, r.status, r.summary, r.started_at, r.ended_at, r.tokens_total as tokens`;

const promptsProject = () => process.env.PLANIA_PROMPTS_PROJECT || "plania";

export async function promptRefs(db: Db): Promise<Record<RunnerRole, PromptRef | null>> {
  const titles = RUNNER_ROLES.map((role) => PROMPT_DOCS[role]);
  const found = await rows(
    db,
    sql`select d.id, d.title, d.version from docs d join projects p on p.id = d.project_id
        where p.slug = ${promptsProject()} and d.task_id is null and d.title in (${sql.join(titles.map((t) => sql`${t}`), sql`, `)})`,
  );
  const byTitle = new Map(found.map((r) => [String(r.title), r]));
  const out = {} as Record<RunnerRole, PromptRef | null>;
  for (const role of RUNNER_ROLES) {
    const r = byTitle.get(PROMPT_DOCS[role]);
    out[role] = r ? { doc_id: String(r.id), title: String(r.title), version: Number(r.version) } : null;
  }
  return out;
}

// Which project a product owner serves: po-<slug>, else a capability that names a project.
export function poProject(agent: { slug: string; capabilities: string[] }, projectSlugs: Set<string>): string | null {
  if (agent.slug.startsWith("po-") && projectSlugs.has(agent.slug.slice(3))) return agent.slug.slice(3);
  return agent.capabilities.find((c) => projectSlugs.has(c)) ?? null;
}

export async function companyExtras(db: Db, now = new Date()): Promise<CompanyExtras> {
  const projectRows = await rows(db, sql`select id, slug from projects order by slug`);
  const slugs = new Set(projectRows.map((p) => String(p.slug)));
  const agentRows = await rows(
    db,
    sql`select id, slug, name, role, capabilities, heartbeat_minutes, last_heartbeat_at from agents where kind <> 'human' order by slug`,
  );
  const lastRuns = await rows(
    db,
    sql`select distinct on (r.agent_id, r.project_id) r.agent_id, ${RUN_COLUMNS}
        from agent_runs r join agents a on a.id = r.agent_id join projects p on p.id = r.project_id
        order by r.agent_id, r.project_id, r.queued_at desc`,
  );
  const latestFor = (agentId: string, project?: string) =>
    lastRuns
      .filter((r) => r.agent_id === agentId && (!project || r.project === project))
      .sort((a, b) => String(iso(b.started_at) ?? "").localeCompare(String(iso(a.started_at) ?? "")))[0];

  const roster: RosterRow[] = [];
  for (const a of agentRows) {
    const capabilities = (a.capabilities as string[]) ?? [];
    const role = roleOf({ slug: String(a.slug), role: String(a.role), capabilities });
    if (!role) continue;
    const minutes = (a.heartbeat_minutes as number | null) ?? null;
    const last = a.last_heartbeat_at ? new Date(String(iso(a.last_heartbeat_at))) : null;
    const next = minutes == null ? null : last ? new Date(Math.max(last.getTime() + minutes * 60_000, now.getTime())) : now;
    const project = role === "product-owner" ? poProject({ slug: String(a.slug), capabilities }, slugs) : null;
    const run = latestFor(String(a.id));
    roster.push({
      slug: String(a.slug),
      name: String(a.name),
      role,
      project,
      heartbeat_minutes: minutes,
      next_wake_at: next?.toISOString() ?? null,
      last_run: run ? runOf(run) : null,
    });
  }

  const counts = await rows(
    db,
    sql`select p.slug,
          count(*) filter (where t.kind = 'ticket' and t.status in ('In progress', 'In review'))::int as in_flight,
          count(*) filter (where t.kind = 'ticket' and t.status in ('Blocked', 'Needs Jorge'))::int as blocked,
          max(t.updated_at) as last_move_at
        from projects p left join tasks t on t.project_id = p.id group by p.slug`,
  );
  const goalRows = await rows(
    db,
    sql`select distinct on (g.project_id) p.slug, g.title from goals g join projects p on p.id = g.project_id
        where g.status = 'active' order by g.project_id, g.position, g.created_at`,
  );
  const goalBy = new Map(goalRows.map((g) => [String(g.slug), String(g.title)]));
  const facts: Record<string, ProjectFacts> = {};
  for (const c of counts) {
    const slug = String(c.slug);
    const po = roster.find((r) => r.role === "product-owner" && r.project === slug) ?? null;
    const poAgent = po ? agentRows.find((a) => a.slug === po.slug) : undefined;
    const run = poAgent ? latestFor(String(poAgent.id), slug) : undefined;
    facts[slug] = {
      goal: goalBy.get(slug) ?? null,
      in_flight: Number(c.in_flight ?? 0),
      blocked: Number(c.blocked ?? 0),
      last_move_at: iso(c.last_move_at),
      po: po ? { slug: po.slug, name: po.name } : null,
      last_run: run ? runOf(run) : null,
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
  next: { key: string; title: string; priority: string | null }[];
  runs: RunBrief[];
};

export async function projectSheet(db: Db, slug: string): Promise<ProjectSheet> {
  const [project] = await rows(db, sql`select id, slug, title from projects where slug = ${slug} limit 1`);
  if (!project) throw new ToolError("PROJECT_NOT_FOUND", { project: slug });
  const id = String(project.id);
  const [goal] = await rows(db, sql`select title from goals where project_id = ${id} and status = 'active' order by position, created_at limit 1`);
  const ideas = await rows(
    db,
    sql`select stage, count(*)::int as n, (array_agg(title order by created_at desc))[1] as newest
        from tasks where project_id = ${id} and kind = 'idea' and status = 'Open' group by stage`,
  );
  const ideaBy = new Map(ideas.map((r) => [String(r.stage), r]));
  const owner = sql`coalesce((t.owner->>'agent'), (select a.name from agents a where a.id = t.owner_agent))`;
  const inProgress = await rows(
    db,
    sql`select t.key, t.title, t.status, ${owner} as owner from tasks t
        where t.project_id = ${id} and t.kind = 'ticket' and t.status in ('In progress', 'In review') order by t.updated_at desc limit 6`,
  );
  const blocked = await rows(
    db,
    sql`select t.key, t.title, t.status, coalesce(nullif(t.blocked_note, ''), case when t.status = 'Needs Jorge' then 'te espera a ti' else 'bloqueado' end) as why
        from tasks t where t.project_id = ${id} and t.kind = 'ticket' and t.status in ('Blocked', 'Needs Jorge') order by t.updated_at desc limit 6`,
  );
  const next = await rows(
    db,
    sql`select t.key, t.title, t.priority from tasks t
        where t.project_id = ${id} and t.kind = 'ticket' and t.status = 'Ready'
        order by coalesce(t.priority, 'P9'), t.created_at limit 5`,
  );
  const runs = await rows(
    db,
    sql`select ${RUN_COLUMNS} from agent_runs r join agents a on a.id = r.agent_id join projects p on p.id = r.project_id
        where r.project_id = ${id} and r.status not in ('queued', 'running') order by r.queued_at desc limit 8`,
  );
  return {
    slug: String(project.slug),
    title: String(project.title),
    goal: goal ? String(goal.title) : null,
    pipeline: PIPELINE_STAGES.map((stage) => {
      const r = ideaBy.get(stage);
      return { stage, count: Number(r?.n ?? 0), newest: (r?.newest as string | null) ?? null };
    }),
    in_progress: inProgress.map((r) => ({ key: String(r.key), title: String(r.title), status: String(r.status), owner: (r.owner as string | null) ?? null })),
    blocked: blocked.map((r) => ({ key: String(r.key), title: String(r.title), status: String(r.status), why: String(r.why) })),
    next: next.map((r) => ({ key: String(r.key), title: String(r.title), priority: (r.priority as string | null) ?? null })),
    runs: runs.map(runOf),
  };
}

// Only the role prompt docs, so this route never becomes a general doc reader.
export async function promptDoc(db: Db, id: string): Promise<{ id: string; title: string; version: number; markdown: string }> {
  const titles = RUNNER_ROLES.map((role) => PROMPT_DOCS[role]);
  const [doc] = await rows(
    db,
    sql`select d.id, d.title, d.version, d.markdown from docs d join projects p on p.id = d.project_id
        where d.id = ${id} and p.slug = ${promptsProject()} and d.task_id is null and d.title in (${sql.join(titles.map((t) => sql`${t}`), sql`, `)})`,
  );
  if (!doc) throw new ToolError("DOC_NOT_FOUND", { doc_id: id });
  return { id: String(doc.id), title: String(doc.title), version: Number(doc.version), markdown: String(doc.markdown) };
}
