// Usage: pnpm project:add <slug> --title <Title> [--prefix <PFX>] [--repo owner/name] [--path /abs/repo]
// Registers a project (2.7). NEWPROJ-1: a new slug goes through createProjectFromTemplate, the same
// function as the screen's sheet and the MCP tool create_company_project, so it gets its team, plan
// approval and a checked key prefix (picked from the slug when --prefix is left out). Safe to rerun:
// an existing slug only gets its settings filled where empty. Emits project.created once.
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { eq } from "drizzle-orm";
import { withDb, type Db } from "../src/db/client.js";
import { projects, type ProjectSettings } from "../src/db/schema.js";
import type { Ctx } from "../src/mcp/tx.js";
import { createProjectFromTemplate } from "../src/runner/new-project.js";

const ACTOR = { agent: "jorge-cli", session_id: "register-project" };

export type RegisterInput = { slug: string; title: string; prefix?: string; repo?: string; path?: string };

export async function registerProject(db: Db, input: RegisterInput): Promise<{ created: boolean; slug: string }> {
  if (!/^[a-z][a-z0-9-]*$/.test(input.slug)) throw new Error(`slug must be lowercase letters, digits and dashes: ${input.slug}`);
  if (input.prefix !== undefined && !/^[A-Z]{2,5}$/.test(input.prefix)) throw new Error(`prefix must be 2–5 capital letters: ${input.prefix}`);
  const [existing] = await db.select().from(projects).where(eq(projects.slug, input.slug)).limit(1);
  if (existing) {
    const settings: ProjectSettings = {
      ...(input.repo ? { github: { repo: input.repo } } : {}),
      ...(input.path ? { local: { repo_path: input.path } } : {}),
    };
    const merged: ProjectSettings = { ...settings, ...existing.settings };
    await db.update(projects).set({ settings: merged }).where(eq(projects.id, existing.id));
    return { created: false, slug: existing.slug };
  }
  const ctx: Ctx = { actor: ACTOR, requestId: `project-created:${input.slug}`, tool: "register-project" };
  const out = await createProjectFromTemplate(
    db,
    { name: input.title, slug: input.slug, key_prefix: input.prefix, github_repo: input.repo, repo_path: input.path },
    { requirePromptDoc: false, ctx },
  );
  if ("error" in out) throw new Error(`${out.error}${out.field ? ` (${out.field})` : ""}: ${input.slug}`);
  return { created: true, slug: out.slug };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { title: { type: "string" }, prefix: { type: "string" }, repo: { type: "string" }, path: { type: "string" } },
  });
  const slug = positionals[0];
  if (!slug || !values.title) {
    console.error("Usage: pnpm project:add <slug> --title <Title> [--prefix <PFX>] [--repo owner/name] [--path /abs/repo]");
    process.exit(1);
  }
  const r = await withDb((db) => registerProject(db, { slug, title: values.title!, prefix: values.prefix, repo: values.repo, path: values.path }));
  console.log(`${r.slug}: ${r.created ? "created" : "already existed; settings filled where empty"}`);
}
