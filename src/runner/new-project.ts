// PLA-I31-3: a new project from the company template. Jorge's screen only (POST /api/company/projects).
// A name and a one-sentence goal make: the project (switch off, so it starts paused), its active goal,
// a product owner on the runner (adapter claude_code, reports to ceo, no cadence) whose prompt is the
// `Prompt: Product owner` doc. No token limit (PLA-21). PLA-I32-2: the PO comes
// with its team, Research, Artist and Taller (research-<slug>, ...), all with project_id and role_template. Nothing is queued:
// the PO's first wake comes when Jorge resumes the project (project.runs_resumed, src/runner/events.ts).
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { agents, docs, projects, type ProjectSettings } from "../db/schema.js";
import { setGoal } from "../mcp/goals.js";
import { setProject } from "../mcp/project.js";
import { setAgent } from "../mcp/team.js";
import { webCtx, writeTx, type Ctx } from "../mcp/tx.js";
import { PROMPT_DOCS } from "./limits.js";
import { CORE_TEMPLATES, RUNNER_CONFIG, ensureTeam, teamSlug } from "./team.js";

// Where the role prompt docs live; the runner reads them from the same project.
const promptsProject = () => process.env.PLANIA_PROMPTS_PROJECT || "plania";
const PROJECT_BODY = "Company project. The plan lives in Plania.";

export type NewProject = { slug: string; key_prefix: string; paused: true; po: string; team: string[]; prompt_doc_id: string | null };
export type NewProjectError = { error: "INVALID_BODY" | "PROJECT_EXISTS" | "PROMPT_DOC_MISSING" | "KEY_PREFIX_TAKEN"; status: 400 | 409; field?: string; slug?: string };

export function slugOf(name: string): string {
  const base = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  if (!base) return "";
  return /^[a-z]/.test(base) ? base : `p-${base}`.slice(0, 40).replace(/-+$/g, "");
}

// Three letters from the slug, unique among projects: the first three, then first + later letters,
// then two letters and a digit.
export function prefixCandidates(slug: string): string[] {
  const letters = slug.replace(/[^a-z0-9]/g, "").toUpperCase();
  const padded = (letters + "XXX").slice(0, Math.max(3, letters.length));
  const out = new Set<string>([padded.slice(0, 3)]);
  for (let i = 1; i < padded.length; i++) for (let j = i + 1; j < padded.length; j++) out.add(`${padded[0]}${padded[i]}${padded[j]}`);
  for (let d = 1; d <= 9; d++) out.add(`${padded.slice(0, 2)}${d}`);
  return [...out];
}

// NEWPROJ-1: the one function that creates a project. The screen's sheet, the MCP tool
// create_company_project and `pnpm project:add` all call it, so every project starts the same way:
// paused, plan approval on, a key prefix checked against the others, its team (PO, Research, Artist,
// Taller) on the runner config, and the same events. Callers that must stay safe to run twice check
// for an existing slug first; here an existing slug is PROJECT_EXISTS.
export type NewProjectInput = {
  name: string;
  goal?: string;
  // Explicit slug and key prefix; otherwise taken from the name. An explicit prefix that is taken is refused.
  slug?: string;
  key_prefix?: string;
  github_repo?: string;
  repo_path?: string;
  po_name?: string;
};

export type NewProjectOptions = {
  // The sheet refuses when the `Prompt: Product owner` doc is missing; the script and the MCP tool
  // create anyway (the runner reads the prompt doc by role when the PO runs).
  requirePromptDoc?: boolean;
  ctx?: Ctx;
};

const SLUG = /^[a-z][a-z0-9-]{0,55}$/;
const PREFIX = /^[A-Z]{2,5}$/;

export async function createProjectFromTemplate(db: Db, input: NewProjectInput, opts: NewProjectOptions = {}): Promise<NewProject | NewProjectError> {
  const requirePromptDoc = opts.requirePromptDoc ?? true;
  const name = input.name.trim();
  const goal = input.goal?.trim();
  if (!name || name.length > 40) return { error: "INVALID_BODY", status: 400, field: "name" };
  if (input.goal !== undefined && (!goal || goal.length > 280)) return { error: "INVALID_BODY", status: 400, field: "goal" };
  const slug = input.slug !== undefined ? input.slug.trim().toLowerCase() : slugOf(name);
  if (!slug || !SLUG.test(slug)) return { error: "INVALID_BODY", status: 400, field: input.slug !== undefined ? "slug" : "name" };
  if (input.key_prefix !== undefined && !PREFIX.test(input.key_prefix)) return { error: "INVALID_BODY", status: 400, field: "key_prefix" };
  const poName = (input.po_name?.trim() || `PO ${name}`).slice(0, 60);
  const po = `po-${slug}`;

  const [existing] = await db.select({ id: projects.id }).from(projects).where(eq(projects.slug, slug)).limit(1);
  if (existing) return { error: "PROJECT_EXISTS", status: 409, slug };
  const team = CORE_TEMPLATES.map((t) => teamSlug(t, slug));
  const [teamTaken] = await db.select({ id: agents.id }).from(agents).where(inArray(agents.slug, team)).limit(1);
  if (teamTaken) return { error: "PROJECT_EXISTS", status: 409, slug };

  const [prompt] = await db
    .select({ id: docs.id })
    .from(docs)
    .innerJoin(projects, eq(projects.id, docs.projectId))
    .where(and(eq(projects.slug, promptsProject()), isNull(docs.taskId), eq(docs.title, PROMPT_DOCS["product-owner"])))
    .limit(1);
  if (!prompt && requirePromptDoc) return { error: "PROMPT_DOC_MISSING", status: 409 };

  const taken = new Set((await db.select({ p: projects.keyPrefix }).from(projects)).map((r) => r.p));
  if (input.key_prefix !== undefined && taken.has(input.key_prefix)) return { error: "KEY_PREFIX_TAKEN", status: 409, field: "key_prefix" };
  const keyPrefix = input.key_prefix ?? prefixCandidates(slug).find((c) => !taken.has(c)) ?? `${slug.slice(0, 1).toUpperCase()}${Date.now() % 100}`;

  const settings: ProjectSettings = {
    plan_approval: true,
    ...(input.github_repo ? { github: { repo: input.github_repo } } : {}),
    ...(input.repo_path ? { local: { repo_path: input.repo_path } } : {}),
  };
  const [ceo] = await db.select({ id: agents.id }).from(agents).where(eq(agents.slug, "ceo")).limit(1);
  const [created] = await db
    .insert(projects)
    .values({ slug, title: name, keyPrefix, runsPaused: true, runsPausedAt: new Date(), settings })
    .returning();
  const project = created!;
  try {
    const ctx = opts.ctx ?? { ...webCtx, tool: "screen.new_project" };
    // Only the creation event carries the caller's request id; the writes after it are new requests.
    const quiet = { ...ctx, requestId: undefined };
    await writeTx(db, project, ctx, async (_tx, emit) => {
      await emit("project.created", null, { slug, title: name, key_prefix: keyPrefix, template: "company", paused: true });
    });
    await setProject(db, { project: slug, version: 1, title: name, body: PROJECT_BODY }, { ...quiet, tool: "set_project" });
    if (goal) await setGoal(db, { project: slug, title: goal }, { ...quiet, tool: "set_goal" });
    // NEWPROJ-1: the PO runs on the same adapter config as its teammates (it was saved with {}).
    await setAgent(db, {
      slug: po,
      name: poName,
      role: "product-owner",
      title: "Product owner",
      kind: "bot",
      ...(ceo ? { reports_to: "ceo" } : {}),
      capabilities: [slug],
      adapter: RUNNER_CONFIG.adapter,
      adapter_config: RUNNER_CONFIG.adapterConfig as Record<string, string>,
      heartbeat_minutes: null,
      note: prompt ? `Prompt: doc «${PROMPT_DOCS["product-owner"]}» (${prompt.id}).` : `Prompt: doc «${PROMPT_DOCS["product-owner"]}».`,
    });
    await ensureTeam(db, { id: project.id, slug, title: name });
  } catch (err) {
    await db.delete(agents).where(inArray(agents.slug, team));
    await db.delete(projects).where(eq(projects.id, project.id));
    throw err;
  }
  return { slug, key_prefix: keyPrefix, paused: true, po, team, prompt_doc_id: prompt?.id ?? null };
}
