import { eq, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { projects, type Project } from "../db/schema.js";
import { ToolError } from "./errors.js";
import { findProject } from "./queries.js";
import { writeTx, type Ctx } from "./tx.js";

// The project's own text: title, body (stack, repo, prod, constraints) and rules (project-specific
// additions to the protocol). Replaced with the version you read; rules_version moves with the rules.

export async function setProject(
  db: Db,
  input: { project: string; version?: number; title?: string; body?: string; rules?: string },
  ctx: Ctx,
) {
  const p = await findProject(db, input.project);
  if (input.version === undefined) throw new ToolError("VERSION_REQUIRED");
  return writeTx(db, p, ctx, async (tx, emit) => {
    const [current] = (await tx.select().from(projects).where(eq(projects.id, p.id))) as [Project];
    if (current.version !== input.version) throw new ToolError("STALE_VERSION", { current_version: current.version });
    const changes: Record<string, [unknown, unknown]> = {};
    if (input.title !== undefined && input.title !== current.title) changes.title = [current.title, input.title];
    if (input.body !== undefined && input.body !== current.body) changes.body = [current.body, input.body];
    if (input.rules !== undefined && input.rules !== current.rulesText) changes.rules = [current.rulesText, input.rules];
    if (!Object.keys(changes).length) return projectShape(current);
    const [u] = await tx
      .update(projects)
      .set({
        ...(changes.title ? { title: input.title } : {}),
        ...(changes.body ? { body: input.body } : {}),
        ...(changes.rules ? { rulesText: input.rules, rulesVersion: sql`${projects.rulesVersion} + 1` } : {}),
        version: sql`${projects.version} + 1`,
        updatedAt: sql`now()`,
      })
      .where(eq(projects.id, p.id))
      .returning();
    await emit("project.updated", null, { changes });
    return projectShape(u!);
  });
}

function projectShape(p: Project) {
  return { project: p.slug, title: p.title, body: p.body, rules: p.rulesText, rules_version: p.rulesVersion, version: p.version };
}
