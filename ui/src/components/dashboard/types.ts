// Screen shape of GET /api/dashboard. Role is the label CEO, never a person's name.

export type DashboardClaim = { project: string; key: string; title: string };

export type DashboardAgent = {
  slug: string;
  name: string;
  role: string;
  title: string;
  status: string;
  note: string;
  claim: DashboardClaim | null;
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

export type Dashboard = {
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
