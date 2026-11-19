// NEWPROJ-2: where a role's prompt comes from, in one place. The runner, project creation and the hire
// sheet all ask here, so a seat that can run is a seat that can be created or hired, and the other way round.
// The Plania doc `Prompt: <role>` in the prompts project is the live copy; with no doc the repo's
// kit/roles/<role>.md is used (AUDIT-2). Neither the project nor the doc has to exist.
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { docs, projects } from "../db/schema.js";
import { roleFile, sha } from "./kit.js";
import { PROMPT_DOCS, type RunnerRole } from "./limits.js";
import { defineWords, say } from "../words.js";

// PLA-I2-10: a seat's note about its prompt, in the install's language; the Spanish is unchanged.
export const PROMPT_WORDS = defineWords({
  es: { doc: (title: string, id?: string) => (id ? `Prompt: doc «${title}» (${id}).` : `Prompt: doc «${title}».`) },
  en: { doc: (title: string, id?: string) => (id ? `Prompt: doc "${title}" (${id}).` : `Prompt: doc "${title}".`) },
});

// The project whose project-level docs hold the role prompts.
export const promptsProject = (env: NodeJS.ProcessEnv = process.env): string => env.PLANIA_PROMPTS_PROJECT || "plania";

// A role's prompt: its text, its version ("<doc version>:<sha>" for a doc, "git:<sha>" for a kit file), and
// where it came from. docId is set only for a doc.
export type RolePrompt = { markdown: string; version: string; source: "doc" | "kit"; docId: string | null };

// The prompts for several roles in one read. A role with neither a non-empty doc nor a kit file is left out.
export async function rolePrompts(db: Db, roles: readonly RunnerRole[], env: NodeJS.ProcessEnv = process.env): Promise<Map<RunnerRole, RolePrompt>> {
  const out = new Map<RunnerRole, RolePrompt>();
  if (roles.length === 0) return out;
  const rows = await db
    .select({ id: docs.id, title: docs.title, markdown: docs.markdown, version: docs.version })
    .from(docs)
    .innerJoin(projects, eq(projects.id, docs.projectId))
    .where(and(eq(projects.slug, promptsProject(env)), isNull(docs.taskId), inArray(docs.title, roles.map((r) => PROMPT_DOCS[r]))));
  for (const role of roles) {
    const doc = rows.find((r) => r.title === PROMPT_DOCS[role] && r.markdown);
    if (doc) {
      out.set(role, { markdown: doc.markdown, version: `${doc.version}:${sha(doc.markdown, 12)}`, source: "doc", docId: doc.id });
      continue;
    }
    const file = roleFile(role, env);
    if (file) out.set(role, { markdown: file, version: `git:${sha(file, 12)}`, source: "kit", docId: null });
  }
  return out;
}

export async function rolePrompt(db: Db, role: RunnerRole, env: NodeJS.ProcessEnv = process.env): Promise<RolePrompt | null> {
  return (await rolePrompts(db, [role], env)).get(role) ?? null;
}

// The roles, in the order given, that have no prompt at all.
export async function rolesWithoutPrompt(db: Db, roles: readonly RunnerRole[], env: NodeJS.ProcessEnv = process.env): Promise<RunnerRole[]> {
  const have = await rolePrompts(db, roles, env);
  return roles.filter((r) => !have.has(r));
}

// What a seat's note says about its prompt.
export const promptNote = (role: RunnerRole, prompt: RolePrompt | null | undefined): string =>
  prompt?.docId ? say(PROMPT_WORDS).doc(PROMPT_DOCS[role], prompt.docId) : prompt?.source === "kit" ? `Prompt: kit/roles/${role}.md.` : say(PROMPT_WORDS).doc(PROMPT_DOCS[role]);
