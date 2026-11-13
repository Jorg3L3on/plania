// PLA-I32-2: each project has its own team, made from shared role templates. A template is a role
// prompt doc in Plania (`Prompt: <role>`, PROMPT_DOCS) plus the roster fields an agent made from it gets.
// The four core roles come with every project; the specialists are added on screen ("Añadir al equipo").
// Agents of a team carry project_id and role_template; the slug is po-<project> for the product owner and
// <template>-<project> for the rest (research-mianovia, taller-mianovia).
import type { AdapterConfig, Agent } from "../db/schema.js";
import type { Q } from "../mcp/tx.js";
import { readerOf } from "../store/pg.js";
import type { NewRow } from "../store/types.js";
import { writeVia } from "./limits.js";

export const CORE_TEMPLATES = ["product-owner", "research", "artist", "taller"] as const;
export const SPECIALIST_TEMPLATES = ["qa", "copy", "marketing", "data"] as const;
export const TEAM_TEMPLATES = [...CORE_TEMPLATES, ...SPECIALIST_TEMPLATES] as const;
export type TeamTemplate = (typeof TEAM_TEMPLATES)[number];

type TemplateRow = { title: string; role: string; capabilities: (project: string) => string[]; name: (projectTitle: string) => string };

// role is agents.role (what list_agents and the org chart show); capabilities feed the work picker.
export const TEMPLATE_ROWS: Record<TeamTemplate, TemplateRow> = {
  "product-owner": { title: "Product owner", role: "product-owner", capabilities: (p) => [p], name: (t) => `PO ${t}` },
  research: { title: "Research", role: "research", capabilities: () => ["research"], name: (t) => `Research ${t}` },
  artist: { title: "Artist", role: "artist", capabilities: () => ["design"], name: (t) => `Artist ${t}` },
  taller: { title: "Builder", role: "taller", capabilities: () => ["engineering"], name: (t) => `Taller ${t}` },
  qa: { title: "QA", role: "qa", capabilities: () => ["qa"], name: (t) => `QA ${t}` },
  copy: { title: "Copy", role: "copy", capabilities: () => ["copy"], name: (t) => `Copy ${t}` },
  marketing: { title: "Marketing", role: "marketing", capabilities: () => ["marketing"], name: (t) => `Marketing ${t}` },
  data: { title: "Data", role: "data", capabilities: () => ["data"], name: (t) => `Data ${t}` },
};

export const isTeamTemplate = (v: string): v is TeamTemplate => (TEAM_TEMPLATES as readonly string[]).includes(v);

export const teamSlug = (template: TeamTemplate, project: string): string => (template === "product-owner" ? `po-${project}` : `${template}-${project}`);

export const RUNNER_CONFIG: { adapter: "claude_code"; adapterConfig: AdapterConfig } = {
  adapter: "claude_code",
  adapterConfig: { command_env: "CLAUDE_CODE_BIN", args_env: "CLAUDE_CODE_ARGS" },
};

// Adapter fields still at their default (none, or a dead http row with no wake_url and no config) join
// the runner, as the org seed has always done; a configured or retired row is left alone.
export function untouchedAdapter(a: Agent): boolean {
  const config = a.adapterConfig ?? {};
  const blank = a.heartbeatMinutes == null && Object.keys(config).length === 0;
  return a.status !== "retired" && a.kind !== "human" && blank && (a.adapter === "none" || (a.adapter === "http" && !a.wakeUrl));
}

// One team member: inserted when missing, otherwise given its project and template while those are
// still empty (name, title, note and capabilities stay as Jorge left them). reports_to fills while empty.
// tx may be the plain Db: the member is then one write of its own.
export async function ensureMember(
  tx: Q,
  project: { id: string; slug: string; title: string },
  template: TeamTemplate,
  opts: { reportsTo?: string | null; note?: string } = {},
): Promise<{ agent: Agent; created: boolean }> {
  const slug = teamSlug(template, project.slug);
  const row = TEMPLATE_ROWS[template];
  const parent = opts.reportsTo ? await readerOf(tx).get("agents", { slug: opts.reportsTo }) : undefined;
  return writeVia(
    tx,
    async (uow) => {
      const existing = await uow.get("agents", { slug });
      if (!existing) {
        const made = await uow.insert("agents", {
          slug,
          name: row.name(project.title || project.slug).slice(0, 60),
          role: row.role,
          title: row.title,
          kind: "bot",
          capabilities: row.capabilities(project.slug),
          note: opts.note ?? "",
          status: "idle",
          adapter: RUNNER_CONFIG.adapter,
          adapterConfig: RUNNER_CONFIG.adapterConfig,
          heartbeatMinutes: null,
          projectId: project.id,
          roleTemplate: template,
          reportsTo: parent?.id ?? null,
        });
        return { agent: made, created: true };
      }
      const set: Partial<NewRow<"agents">> = {};
      if (!existing.projectId) set.projectId = project.id;
      if (!existing.roleTemplate) set.roleTemplate = template;
      if (!existing.reportsTo && parent && parent.id !== existing.id) set.reportsTo = parent.id;
      if (untouchedAdapter(existing)) Object.assign(set, { adapter: RUNNER_CONFIG.adapter, adapterConfig: RUNNER_CONFIG.adapterConfig });
      if (Object.keys(set).length === 0) return { agent: existing, created: false };
      const [updated] = await uow.update("agents", { id: existing.id }, { ...set, updatedAt: uow.now });
      return { agent: updated!, created: false };
    },
    project.id,
  );
}

// The four core roles of a project. The PO reports to the CEO seat; the others report to their PO.
export async function ensureTeam(tx: Q, project: { id: string; slug: string; title: string }): Promise<{ created: string[] }> {
  const created: string[] = [];
  const po = await ensureMember(tx, project, "product-owner", { reportsTo: "ceo" });
  if (po.created) created.push(po.agent.slug);
  for (const template of CORE_TEMPLATES.filter((t) => t !== "product-owner")) {
    const m = await ensureMember(tx, project, template, { reportsTo: po.agent.slug });
    if (m.created) created.push(m.agent.slug);
  }
  return { created };
}

// The live members of one project's team (retired rows left out), by slug.
export async function teamOf(tx: Q, projectId: string): Promise<Agent[]> {
  return (await readerOf(tx).find("agents", { projectId }, { orderBy: [{ column: "slug" }] })).filter((a) => a.status !== "retired");
}
