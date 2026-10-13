// Usage: pnpm project:add <slug> --title <Title> --prefix <PFX> [--repo owner/name] [--path /abs/repo]
// Registers a project (2.7). Project creation stays Jorge's: no MCP tool does this. Safe to rerun:
// an existing slug only gets its settings filled where empty. Emits project.created once.
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { eq } from "drizzle-orm";
import { withDb, type Db } from "../src/db/client.js";
import { projects, type ProjectSettings } from "../src/db/schema.js";
import { writeTx, type Ctx } from "../src/mcp/tx.js";

const ACTOR = { agent: "jorge-cli", session_id: "register-project" };

export type RegisterInput = { slug: string; title: string; prefix: string; repo?: string; path?: string };

export async function registerProject(db: Db, input: RegisterInput): Promise<{ created: boolean; slug: string }> {
  if (!/^[a-z][a-z0-9-]*$/.test(input.slug)) throw new Error(`slug must be lowercase letters, digits and dashes: ${input.slug}`);
  if (!/^[A-Z]{2,5}$/.test(input.prefix)) throw new Error(`prefix must be 2–5 capital letters: ${input.prefix}`);
  const settings: ProjectSettings = {
    ...(input.repo ? { github: { repo: input.repo } } : {}),
    ...(input.path ? { local: { repo_path: input.path } } : {}),
  };
  const [existing] = await db.select().from(projects).where(eq(projects.slug, input.slug)).limit(1);
  if (existing) {
    const merged: ProjectSettings = { ...settings, ...existing.settings };
    await db.update(projects).set({ settings: merged }).where(eq(projects.id, existing.id));
    return { created: false, slug: existing.slug };
  }
  const [p] = await db.insert(projects).values({ slug: input.slug, title: input.title, keyPrefix: input.prefix, settings }).returning();
  const ctx: Ctx = { actor: ACTOR, requestId: `project-created:${p!.slug}`, tool: "register-project" };
  await writeTx(db, p!, ctx, async (_tx, emit) => {
    await emit("project.created", null, { slug: p!.slug, title: p!.title, key_prefix: p!.keyPrefix });
  });
  return { created: true, slug: p!.slug };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { title: { type: "string" }, prefix: { type: "string" }, repo: { type: "string" }, path: { type: "string" } },
  });
  const slug = positionals[0];
  if (!slug || !values.title || !values.prefix) {
    console.error("Usage: pnpm project:add <slug> --title <Title> --prefix <PFX> [--repo owner/name] [--path /abs/repo]");
    process.exit(1);
  }
  const r = await withDb((db) => registerProject(db, { slug, title: values.title!, prefix: values.prefix!, repo: values.repo, path: values.path }));
  console.log(`${r.slug}: ${r.created ? "created" : "already existed; settings filled where empty"}`);
}
