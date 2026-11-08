// PLA-I24: the CEO screen. One read composed from the roster, goals, the inbox, and the week
// already cached by Mi progreso. No budgets, no new tables, no second scan of the year.
// PLA-I27: the greeting name and this week's reported usage. Still no budgets.
import { sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { inbox } from "./inbox.js";
import { listGoals, type GoalView } from "./goals.js";
import { addDays, isPruebaTitle, isoWeek, progressLog, progressSummary, progressTz, weekRange, dayInTz } from "./progress.js";
import { listAgents, workingOnBySlug, type AgentView } from "./team.js";
import { USAGE_LABEL, usageSummary } from "./usage.js";
import {
  TREND_TARGET,
  WEEKS,
  buildBrief,
  buildQueue,
  companySignal,
  goalSignal,
  loadInitiatives,
  loadReadyByAgent,
  loadReviews,
  loadTrend,
  wakeInfo,
  type GoalSignal,
  type Health,
  type InitiativeSignal,
  type QueueItem,
  type Trend,
} from "./ceo-signals.js";

export type DashboardAgent = {
  slug: string;
  name: string;
  role: string;
  title: string;
  status: string;
  note: string;
  claim: { project: string; key: string; title: string } | null;
  // PLA-I28: what the screen's Despertar can do, and the Ready tickets this agent owns.
  adapter: string;
  can_wake: boolean;
  wake_reason: string | null;
  ready: number;
  last_check_in_at: string | null;
};

export type DashboardGoal = {
  id: string;
  title: string;
  project: string | null;
  status: string;
  progress: { done: number; total: number };
  // PLA-I28: derived, never typed: see goalSignal.
  health: Health;
  why: string;
  initiatives: { key: string; title: string; status: string }[];
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

export type DashboardUsage = {
  label: typeof USAGE_LABEL;
  week: string;
  input: number;
  output: number;
  usd?: number;
};

export type CeoDashboard = {
  role: "CEO";
  name: string;
  timezone: string;
  today: string;
  team: { alive: number; idle: number; stuck: number; total: number; agents: DashboardAgent[] };
  goals: DashboardGoal[];
  usage: DashboardUsage;
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
  // PLA-I28: the brief, one queue of what needs the CEO, and the weekly trend.
  brief: string[];
  queue: QueueItem[];
  trend: Trend;
  previous_finished: number;
};

const STATUS_RANK: Record<string, number> = { alive: 0, stuck: 1, idle: 2 };
const WINS = 12;
const DEFAULT_CEO_NAME = "Jorge";

// Greeting on /ceo. PLANIA_CEO_NAME overrides the default display name. The roster row stays «CEO».
export function ceoDisplayName(raw = process.env.PLANIA_CEO_NAME): string {
  const name = (raw ?? "").replace(/[\u0000-\u001f]/g, "").trim().replace(/\s+/g, " ");
  return name ? name.slice(0, 80) : DEFAULT_CEO_NAME;
}

// Same ISO week usage_summary stores: IYYY-Www of the screen's calendar day.
export function isoWeekKey(day: string): string {
  const { week, weekYear } = isoWeek(day);
  return `${weekYear}-W${String(week).padStart(2, "0")}`;
}

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

// Parents stay before their children, as before; a company goal's health sums its project goals.
function flatGoals(nodes: GoalView[], initiatives: InitiativeSignal[], now: Date): DashboardGoal[] {
  const byGoal = new Map<string, InitiativeSignal[]>();
  for (const item of initiatives) {
    if (!item.goal_id) continue;
    const list = byGoal.get(item.goal_id) ?? [];
    list.push(item);
    byGoal.set(item.goal_id, list);
  }
  const dayOf = (iso: string) => dayInTz(new Date(iso));
  const out: DashboardGoal[] = [];
  const walk = (list: GoalView[]): GoalSignal[] => {
    const signals: GoalSignal[] = [];
    for (const node of list) {
      const own = byGoal.get(node.id) ?? [];
      const at = node.status !== "dropped" ? out.push({} as DashboardGoal) - 1 : -1;
      const childSignals = walk(node.children);
      const signal = node.project === null && node.children.length > 0 ? companySignal(childSignals) : goalSignal(own, now, dayOf);
      if (at < 0) continue;
      out[at] = {
        id: node.id,
        title: node.title,
        project: node.project,
        status: node.status,
        progress: node.progress,
        health: signal.health,
        why: signal.why,
        initiatives: own.map((item) => ({ key: item.key, title: item.title, status: item.status })),
      };
      signals.push(signal);
    }
    return signals;
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
  const now = new Date();
  const today = dayInTz(now);
  const week = weekRange(today);
  const weekId = isoWeekKey(today);
  const weekStarts = Array.from({ length: WEEKS }, (_, i) => addDays(week.from, (i - (WEEKS - 1)) * 7));
  const [roster, board, summary, previous, log, box, claims, usage, working, initiatives, reviews, trend, readyBy] = await Promise.all([
    listAgents(db),
    listGoals(db),
    progressSummary(db, { range: "week", date: today }),
    progressSummary(db, { range: "week", date: addDays(today, -7) }),
    progressLog(db, { from: week.from, to: week.to }),
    inbox(db, "all"),
    liveClaims(db),
    usageSummary(db, { week: weekId }),
    workingOnBySlug(db),
    loadInitiatives(db),
    loadReviews(db),
    loadTrend(db, { timeZone: progressTz(), weekStarts }),
    loadReadyByAgent(db),
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
      const focus = working.get(agent.slug) ?? null;
      return {
        slug: agent.slug,
        name: agent.name,
        role: agent.role,
        title: agent.title,
        status: agent.status,
        note: agent.note,
        claim: focus,
        adapter: agent.adapter,
        ...wakeInfo(agent),
        ready: readyBy.get(agent.slug) ?? 0,
        last_check_in_at: agent.last_check_in_at,
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

  const input = usage.totals.reduce((sum, row) => sum + row.input, 0);
  const output = usage.totals.reduce((sum, row) => sum + row.output, 0);

  const queue = buildQueue({ waits: box.items, reviews, initiatives }, now);
  const brief = buildBrief({ queue, finished: summary.finished, previous: previous.finished });

  return {
    role: "CEO",
    name: ceoDisplayName(),
    timezone: summary.timezone,
    today: summary.today,
    team: { ...counts, agents },
    goals: flatGoals(board.goals, initiatives, now),
    usage: { label: usage.label, week: weekId, input, output },
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
    brief,
    queue,
    trend: { ...trend, target: TREND_TARGET },
    previous_finished: previous.finished,
  };
}
