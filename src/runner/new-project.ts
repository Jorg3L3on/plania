// PLA-I31-3: a new project from the company template. Jorge's screen only (POST /api/company/projects).
// A name and a one-sentence goal make: the project (switch off, so it starts paused), its active goal,
// a product owner on the runner (adapter claude_code, reports to ceo, no cadence) whose prompt is the
// `Prompt: Product owner` doc, and a default weekly token limit for the project. PLA-I32-2: the PO comes
// with its team, Research, Artist and Taller (research-<slug>, ...), all with project_id and role_template. Nothing is queued:
// the PO's first wake comes when Jorge resumes the project (project.runs_resumed, src/runner/events.ts).
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { agents, docs, projects, tokenBudgets } from "../db/schema.js";
import { setGoal } from "../mcp/goals.js";
import { setProject } from "../mcp/project.js";
import { setAgent } from "../mcp/team.js";
import { webCtx, writeTx } from "../mcp/tx.js";
import { PROMPT_DOCS } from "./limits.js";
import { CORE_TEMPLATES, ensureTeam, teamSlug } from "./team.js";

// Tokens per week (input + output + cache). About 15 runs at the 60k reserve; Jorge changes it on screen.
export const DEFAULT_PROJECT_WEEKLY_LIMIT = 1_000_000;
// Where the role prompt docs live; the runner reads them from the same project.
const promptsProject = () => process.env.PLANIA_PROMPTS_PROJECT || "plania";
const PROJECT_BODY = "Company project. The plan lives in Plania.";

export type NewProject = { slug: string; key_prefix: string; paused: true; po: string; team: string[]; prompt_doc_id: string };
export type NewProjectError = { error: "INVALID_BODY" | "PROJECT_EXISTS" | "PROMPT_DOC_MISSING"; status: 400 | 409; field?: string; slug?: string };

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

export async function createProjectFromTemplate(db: Db, input: { name: string; goal: string }): Promise<NewProject | NewProjectError> {
  const name = input.name.trim();
  const goal = input.goal.trim();
  if (!name || name.length > 40) return { error: "INVALID_BODY", status: 400, field: "name" };
  if (!goal || goal.length > 280) return { error: "INVALID_BODY", status: 400, field: "goal" };
  const slug = slugOf(name);
  if (!slug) return { error: "INVALID_BODY", status: 400, field: "name" };
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
  if (!prompt) return { error: "PROMPT_DOC_MISSING", status: 409 };

  const taken = new Set((await db.select({ p: projects.keyPrefix }).from(projects)).map((r) => r.p));
  const keyPrefix = prefixCandidates(slug).find((c) => !taken.has(c)) ?? `${slug.slice(0, 1).toUpperCase()}${Date.now() % 100}`;

  const [ceo] = await db.select({ id: agents.id }).from(agents).where(eq(agents.slug, "ceo")).limit(1);
  const [created] = await db
    .insert(projects)
    .values({ slug, title: name, keyPrefix, runsPaused: true, runsPausedAt: new Date(), settings: { plan_approval: true } })
    .returning();
  const project = created!;
  try {
    const ctx = { ...webCtx, tool: "screen.new_project" };
    await writeTx(db, project, ctx, async (_tx, emit) => {
      await emit("project.created", null, { slug, title: name, key_prefix: keyPrefix, template: "company", paused: true });
    });
    await setProject(db, { project: slug, version: 1, title: name, body: PROJECT_BODY }, { ...ctx, tool: "set_project" });
    await setGoal(db, { project: slug, title: goal }, { ...ctx, tool: "set_goal" });
    await setAgent(db, {
      slug: po,
      name: `PO ${name}`.slice(0, 60),
      role: "product-owner",
      title: "Product owner",
      kind: "bot",
      ...(ceo ? { reports_to: "ceo" } : {}),
      capabilities: [slug],
      adapter: "claude_code",
      adapter_config: {},
      heartbeat_minutes: null,
      note: `Prompt: doc «${PROMPT_DOCS["product-owner"]}» (${prompt.id}).`,
    });
    await ensureTeam(db, { id: project.id, slug, title: name });
    await db.insert(tokenBudgets).values({ scope: "project", projectId: project.id, weeklyLimit: DEFAULT_PROJECT_WEEKLY_LIMIT });
  } catch (err) {
    await db.delete(agents).where(inArray(agents.slug, team));
    await db.delete(projects).where(eq(projects.id, project.id));
    throw err;
  }
  return { slug, key_prefix: keyPrefix, paused: true, po, team, prompt_doc_id: prompt.id };
}
