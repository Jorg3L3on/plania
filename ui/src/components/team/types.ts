export type OwnedTask = { project: string; key: string; title: string; status: string };

export type WorkingOn = { project: string; key: string; title: string };

export type TeamMember = {
  slug: string;
  name: string;
  role: string;
  title: string;
  reports_to: string | null;
  capabilities: string[];
  kind: string;
  last_check_in_at: string | null;
  status: string;
  note: string;
  tasks: OwnedTask[];
  working_on: WorkingOn | null;
};

export type TeamRoster = { agents: TeamMember[] };

export const STATUS_WORD: Record<string, string> = {
  alive: "activo",
  idle: "en espera",
  stuck: "atascado",
};

export const STATUS_DOT: Record<string, string> = {
  alive: "bg-status-done",
  idle: "bg-status-idle",
  stuck: "bg-status-blocked",
};

export const KIND_WORD: Record<string, string> = {
  human: "persona",
  bot: "bot",
  coder: "coder",
};

const PREFERRED = [
  "ceo",
  "asistente",
  "plania",
  "taller",
  "artist",
  "research",
  "coach",
  "housi",
  "workia",
  "filmia",
  "zigzag",
  "owner-plania",
  "cursor",
  "claude-code",
];

const rankOf = (slug: string) => {
  const i = PREFERRED.indexOf(slug);
  return i === -1 ? PREFERRED.length : i;
};

export const byOrg = (a: TeamMember, b: TeamMember) =>
  rankOf(a.slug) - rankOf(b.slug) || a.name.localeCompare(b.name, "es");

export const childrenOf = (slug: string, agents: TeamMember[]) =>
  agents.filter((agent) => agent.reports_to === slug).sort(byOrg);

export const rootsOf = (agents: TeamMember[]) => {
  const slugs = new Set(agents.map((agent) => agent.slug));
  return agents.filter((agent) => !agent.reports_to || !slugs.has(agent.reports_to)).sort(byOrg);
};
