import type { TeamMember } from "@/components/team/types";

// Card copy and accent from docs/company-mockups/org.html. Colors are this app's
// status tokens: the mockup's base.css is not in that commit.
export type StudioFace = {
  title: string;
  line: string;
  beat?: string;
  border: string;
  wash?: string;
};

const FACE: Record<string, StudioFace> = {
  ceo: {
    title: "CEO",
    line: "Dueño / CEO · marca el rumbo · nunca bloquea",
    border: "border-status-review",
    wash: "bg-gradient-to-br from-status-review/35 to-card",
  },
  asistente: {
    title: "Asistente",
    line: "Chief of Staff · reparte el trabajo y el resumen del día",
    beat: "cada mañana y con cada mensaje",
    border: "border-status-ready",
  },
  plania: {
    title: "Plania bot",
    line: "COO · metas → iniciativas → tareas",
    beat: "triaje cada hora",
    border: "border-status-review",
  },
  taller: {
    title: "Taller",
    line: "CTO · construye, revisa y entrega a sandbox",
    beat: "toma lo que está Ready",
    border: "border-status-jorge",
  },
  cursor: {
    title: "Cursor sessions",
    line: "Ingenieros · reclaman tickets",
    border: "border-border",
  },
  "claude-code": {
    title: "Claude Code",
    line: "Ingeniero · reclama tickets",
    border: "border-border",
  },
  artist: { title: "Artist", line: "Diseño", border: "border-status-blocked" },
  research: { title: "Research", line: "Investigación", border: "border-status-done" },
  coach: { title: "Coach", line: "Coach del CEO", border: "border-status-now" },
  housi: { title: "Housi", line: "PO de MiCasa", border: "border-status-done" },
  workia: { title: "Workia", line: "PO de Workia", border: "border-status-ready" },
  filmia: { title: "Filmia", line: "PO de Filmia", border: "border-status-blocked" },
  zigzag: { title: "ZigZag", line: "PO de ZigZag", border: "border-status-now" },
  "owner-plania": { title: "Plania", line: "El bot Plania, también PO", border: "border-status-review" },
};

export const faceOf = (agent: TeamMember): StudioFace =>
  FACE[agent.slug] ?? { title: agent.name, line: agent.title, border: "border-border" };

const firstOf = (agents: TeamMember[], slugs: string[]) =>
  slugs.flatMap((slug) => {
    const agent = agents.find((row) => row.slug === slug);
    return agent ? [agent] : [];
  });

const restReportingTo = (agents: TeamMember[], parent: string, placed: Set<string>) =>
  agents.filter((agent) => agent.reports_to === parent && !placed.has(agent.slug));

export type StudioLayout = {
  ceo: TeamMember | null;
  asistente: TeamMember | null;
  leads: TeamMember[];
  engineering: TeamMember[];
  shared: TeamMember[];
  owners: TeamMember[];
  extra: TeamMember[];
};

// The mockup is one column, not a tree: CEO, Asistente, then the two leads,
// then engineering, shared services and one product owner per business.
export const studioLayout = (agents: TeamMember[]): StudioLayout => {
  const placed = new Set<string>();
  const take = (slugs: string[]) => {
    const rows = firstOf(agents, slugs);
    for (const row of rows) placed.add(row.slug);
    return rows;
  };
  const ceo = take(["ceo"])[0] ?? null;
  const asistente = take(["asistente"])[0] ?? null;
  const leads = take(["plania", "taller"]);
  const engineering = [...take(["cursor", "claude-code"]), ...restReportingTo(agents, "taller", placed)];
  for (const row of engineering) placed.add(row.slug);
  const shared = [...take(["artist", "research", "coach"]), ...restReportingTo(agents, "asistente", placed)];
  for (const row of shared) placed.add(row.slug);
  const owners = [...take(["housi", "workia", "filmia", "zigzag", "owner-plania"]), ...restReportingTo(agents, "plania", placed)];
  for (const row of owners) placed.add(row.slug);
  const extra = agents.filter((agent) => !placed.has(agent.slug));
  return { ceo, asistente, leads, engineering, shared, owners, extra };
};
