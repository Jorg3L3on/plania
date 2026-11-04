// PLA-I24: the CEO screen. One read composed from the roster, goals, the inbox, and the week
// already cached by Mi progreso. No budgets, no new tables, no second scan of the year.
import { sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { inbox } from "./inbox.js";
import { listGoals, type GoalView } from "./goals.js";
import { isPruebaTitle, progressLog, progressSummary, weekRange, dayInTz } from "./progress.js";
import { listAgents, type AgentView } from "./team.js";

export type DashboardAgent = {
  slug: string;
  name: string;
  role: string;
  title: string;
  status: string;
  note: string;
  claim: { project: string; key: string; title: string } | null;
};

export type DashboardGoal = {
  id: string;
  title: string;
  project: string | null;
  status: string;
  progress: { done: number; total: number };
};

export type DashboardWin = {
  project: string;
  key: string | null;
  title: string;
  type_label: string;
  day: string;
};

export type DashboardStuck = {
  project: string;
  key: string;
  title: string;
  status: string;
  agent: string;
  name: string;
};

export type DashboardWait = {
  id: string;
  kind: string;
  group: string;
  project: string;
  key: string | null;
  title: string | null;
  why: string;
};

export type CeoDashboard = {
  role: "CEO";
  timezone: string;
  today: string;
  team: { alive: number; idle: number; stuck: number; total: number; agents: DashboardAgent[] };
  goals: DashboardGoal[];
  shipped: {
    from: string;
    to: string;
    label: string;
    finished: number;
    prs: number;
    buckets: { date: string; label: string; total: number }[];
    wins: DashboardWin[];
  };
  stuck: DashboardStuck[];
  waits: DashboardWait[];
};

const STATUS_RANK: Record<string, number> = { alive: 0, idle: 1, stuck: 2 };
const WINS = 12;

type LiveClaim = { project: string; key: string; title: string; status: string; agent: string | null };

// The screen route is the only caller. This is not an MCP tool: an agent token is refused on GET /api/dashboard.
export function registerDashboardTools(): void {
  return;
}

function matchAgent(label: string, roster: AgentView[]): AgentView | undefined {
  const key = label.trim().toLowerCase();
  if (!key) return undefined;
  return roster.find((agent) => agent.slug.toLowerCase() === key || agent.name.trim().toLowerCase() === key);
}

function flatGoals(nodes: GoalView[]): DashboardGoal[] {
  const out: DashboardGoal[] = [];
  const walk = (list: GoalView[]) => {
    for (const node of list) {
      if (node.status !== "dropped") {
        out.push({
          id: node.id,
          title: node.title,
          project: node.project,
          status: node.status,
          progress: node.progress,
        });
      }
      walk(node.children);
    }
  };
  walk(nodes);
  return out;
}

async function liveClaims(db: Db): Promise<LiveClaim[]> {
  const rows = await db.execute<LiveClaim>(sql`
    select p.slug as project, t.key, t.title, t.status, t.owner->>'agent' as agent
    from tasks t
    join projects p on p.id = t.project_id
    where t.owner is not null and t.lease_until > now()`);
  return rows.rows.filter((row) => !isPruebaTitle(row.title));
}

export async function ceoDashboard(db: Db): Promise<CeoDashboard> {
  const today = dayInTz(new Date());
  const week = weekRange(today);
  const [roster, board, summary, log, box, claims] = await Promise.all([
    listAgents(db),
    listGoals(db),
    progressSummary(db, { range: "week", date: today }),
    progressLog(db, { from: week.from, to: week.to }),
    inbox(db, "all"),
    liveClaims(db),
  ]);

  const byAgent = new Map<string, LiveClaim[]>();
  for (const claim of claims) {
    const agent = claim.agent ? matchAgent(claim.agent, roster.agents) : undefined;
    if (!agent) continue;
    const list = byAgent.get(agent.slug) ?? [];
    list.push(claim);
    byAgent.set(agent.slug, list);
  }
  for (const list of byAgent.values()) list.sort((a, b) => a.project.localeCompare(b.project) || a.key.localeCompare(b.key));

  const agents: DashboardAgent[] = roster.agents
    .map((agent) => {
      const claim = byAgent.get(agent.slug)?.[0] ?? null;
      return {
        slug: agent.slug,
        name: agent.name,
        role: agent.role,
        title: agent.title,
        status: agent.status,
        note: agent.note,
        claim: claim ? { project: claim.project, key: claim.key, title: claim.title } : null,
      };
    })
    .sort((a, b) => (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9) || a.name.localeCompare(b.name, "es"));

  const counts = { alive: 0, idle: 0, stuck: 0, total: agents.length };
  for (const agent of agents) {
    if (agent.status === "alive" || agent.status === "idle" || agent.status === "stuck") counts[agent.status] += 1;
  }

  const stuck: DashboardStuck[] = [];
  for (const agent of roster.agents) {
    if (agent.status !== "stuck") continue;
    for (const claim of byAgent.get(agent.slug) ?? []) {
      stuck.push({
        project: claim.project,
        key: claim.key,
        title: claim.title,
        status: claim.status,
        agent: agent.slug,
        name: agent.name,
      });
    }
  }
  stuck.sort((a, b) => a.project.localeCompare(b.project) || a.key.localeCompare(b.key));

  const wins: DashboardWin[] = log.days
    .flatMap((day) => day.entries)
    .filter((entry) => entry.kind === "ticket" || entry.kind === "initiative")
    .sort((a, b) => (a.at < b.at ? 1 : -1))
    .slice(0, WINS)
    .map((entry) => ({
      project: entry.project,
      key: entry.key,
      title: entry.title,
      type_label: entry.type_label,
      day: entry.day,
    }));

  const waits: DashboardWait[] = box.items
    .filter((item) => item.group !== "limpieza")
    .map((item) => ({
      id: item.id,
      kind: item.kind,
      group: item.group,
      project: item.project,
      key: item.key,
      title: item.title,
      why: item.why,
    }));

  return {
    role: "CEO",
    timezone: summary.timezone,
    today: summary.today,
    team: { ...counts, agents },
    goals: flatGoals(board.goals),
    shipped: {
      from: summary.from,
      to: summary.to,
      label: summary.label,
      finished: summary.finished,
      prs: summary.prs,
      buckets: summary.buckets.map((bucket) => ({ date: bucket.date, label: bucket.label, total: bucket.total })),
      wins,
    },
    stuck,
    waits,
  };
}
