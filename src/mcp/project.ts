import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { projects, type Project } from "../db/schema.js";
import { ToolError } from "./errors.js";
import { TEXT_LIMITS } from "./limits.js";
import { findProject, legacyCard } from "./queries.js";
import { iso, writeTx, type Ctx, type Q } from "./tx.js";

// The project's own text: title, body (stack, repo, prod, constraints), rules (project-specific
// additions to the protocol) and the headline (one line on where it stands, ≤ 280 chars).
// Replaced with the version you read; rules_version moves with the rules, headline_version with the headline.

export async function setProject(
  db: Db,
  input: { project: string; version?: number; title?: string; body?: string; rules?: string; headline?: string },
  ctx: Ctx,
) {
  const p = await findProject(db, input.project);
  if (input.version === undefined) throw new ToolError("VERSION_REQUIRED");
  if (input.headline !== undefined && input.headline.length > TEXT_LIMITS.headline!) {
    throw new ToolError("TOO_LARGE", { field: "headline", max: TEXT_LIMITS.headline });
  }
  return writeTx(db, p, ctx, async (tx, emit) => {
    const [current] = (await tx.select().from(projects).where(eq(projects.id, p.id))) as [Project];
    if (current.version !== input.version) throw new ToolError("STALE_VERSION", { current_version: current.version });
    const changes: Record<string, [unknown, unknown]> = {};
    if (input.title !== undefined && input.title !== current.title) changes.title = [current.title, input.title];
    if (input.body !== undefined && input.body !== current.body) changes.body = [current.body, input.body];
    if (input.rules !== undefined && input.rules !== current.rulesText) changes.rules = [current.rulesText, input.rules];
    const headline = input.headline?.trim();
    if (headline !== undefined && headline !== current.headline) changes.headline = [current.headline, headline];
    if (!Object.keys(changes).length) return projectShape(current);
    const [u] = await tx
      .update(projects)
      .set({
        ...(changes.title ? { title: input.title } : {}),
        ...(changes.body ? { body: input.body } : {}),
        ...(changes.rules ? { rulesText: input.rules, rulesVersion: sql`${projects.rulesVersion} + 1` } : {}),
        ...(changes.headline
          ? { headline, headlineVersion: sql`${projects.headlineVersion} + 1`, headlineAt: sql`now()`, headlineStale: false }
          : {}),
        version: sql`${projects.version} + 1`,
        updatedAt: sql`now()`,
      })
      .where(eq(projects.id, p.id))
      .returning();
    await emit("project.updated", null, { changes });
    return projectShape(u!);
  });
}

export function headlineShape(p: Project) {
  return { text: p.headline, version: p.headlineVersion, at: iso(p.headlineAt), stale: p.headlineStale };
}

function projectShape(p: Project) {
  return {
    project: p.slug,
    title: p.title,
    body: p.body,
    rules: p.rulesText,
    rules_version: p.rulesVersion,
    headline: headlineShape(p),
    version: p.version,
  };
}

// The headline describes a moment; an env change, an initiative moving or a ticket reaching Done
// after it was written makes it stale until set_project writes a new one.
export async function markHeadlineStale(tx: Q, projectId: string): Promise<void> {
  await tx
    .update(projects)
    .set({ headlineStale: true })
    .where(and(eq(projects.id, projectId), sql`${projects.headline} <> ''`, eq(projects.headlineStale, false)));
}

// R-01: the v1 hand-written card moves into the event log, with its full text, and is gone for good.
export async function archiveLegacyCard(db: Db, input: { project: string; reason: string }, ctx: Ctx) {
  const p = await findProject(db, input.project);
  return writeTx(db, p, ctx, async (tx, emit) => {
    const [current] = (await tx.select().from(projects).where(eq(projects.id, p.id))) as [Project];
    const card = legacyCard(current);
    if (!card) throw new ToolError("LEGACY_CARD_EMPTY");
    await tx
      .update(projects)
      .set({ resumeInProgress: "", resumeNextAction: "", resumeBranchOrProd: "", resumeMustKeepDecision: "", updatedAt: sql`now()` })
      .where(eq(projects.id, p.id));
    await emit("legacy_card.archived", null, { card, reason: input.reason });
    return { archived: card, reason: input.reason };
  });
}
