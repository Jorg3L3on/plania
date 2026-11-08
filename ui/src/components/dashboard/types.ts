// Screen shape of GET /api/dashboard. Role is the label CEO.
// name is the greeting (PLANIA_CEO_NAME, default Jorge). The roster row stays CEO.

export type DashboardClaim = { project: string; key: string; title: string };

export type DashboardAgent = {
  slug: string;
  name: string;
  role: string;
  title: string;
  status: string;
  note: string;
  claim: DashboardClaim | null;
  // PLA-I28
  adapter: string;
  can_wake: boolean;
  wake_reason: string | null;
  ready: number;
  last_check_in_at: string | null;
};

export type GoalHealth = "on" | "risk" | "stop" | "none";

export type DashboardGoal = {
  id: string;
  title: string;
  project: string | null;
  status: string;
  progress: { done: number; total: number };
  health: GoalHealth;
  why: string;
  initiatives: { key: string; title: string; status: string }[];
};

export type QueueKind = "decidir" | "merge" | "atorado" | "paso";

export type QueueItem = {
  id: string;
  kind: QueueKind;
  project: string;
  key: string | null;
  title: string;
  detail: string;
  age_days: number;
  href: string | null;
  action: "open" | "review" | "assign";
};

export type DashboardTrend = {
  weeks: { from: string; label: string; total: number }[];
  target: number;
  cycle_days: number | null;
  in_review: number;
  ready_unowned: number;
};

export type ReadyTicket = { project: string; key: string; title: string; parent_key: string | null; owner_agent: string | null };

export type WakeResult = { woke: boolean; reason: string; detail?: string | null; run: { status: string; summary: string } | null };

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
  label: "reportado";
  week: string;
  input: number;
  output: number;
};

export type Dashboard = {
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
  brief: string[];
  queue: QueueItem[];
  trend: DashboardTrend;
  previous_finished: number;
  ready_tickets: ReadyTicket[];
};
