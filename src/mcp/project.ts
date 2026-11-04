import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { projects, type Project, type ProjectSettings } from "../db/schema.js";
import { ToolError } from "./errors.js";
import { headlineWarnings } from "./jorge-lines.js";
import { checkReleaseSettings } from "./release-plan.js";
import { TEXT_LIMITS } from "./limits.js";
import { findProject } from "./queries.js";
import { iso, writeTx, type Ctx, type Q } from "./tx.js";

// The project's own text: title, body (stack, repo, prod, constraints), rules (project-specific
// additions to the protocol) and the headline (one line on where it stands, ≤ 280 chars).
// Replaced with the version you read; rules_version moves with the rules, headline_version with the headline.

const SETTING_KEYS = ["release_target", "branch_pattern", "claim_from", "resources", "quotas", "github", "vercel", "release", "team"] as const;

// settings merge key by key; null removes one. Secrets never: integrations name env vars.
function mergeSettings(current: ProjectSettings, patch: Record<string, unknown>): ProjectSettings {
  const next: Record<string, unknown> = { ...current };
  for (const [k, v] of Object.entries(patch)) {
    if (!(SETTING_KEYS as readonly string[]).includes(k)) throw new ToolError("INVALID_FILTER", { field: `settings.${k}`, allowed: SETTING_KEYS });
    if (v === null) delete next[k];
    else next[k] = v;
  }
  if (next.claim_from !== undefined && !["backlog", "ready"].includes(String(next.claim_from))) throw new ToolError("INVALID_FILTER", { field: "settings.claim_from", allowed: ["backlog", "ready"] });
  if (next.branch_pattern !== undefined) {
    try {
      new RegExp(String(next.branch_pattern));
    } catch {
      throw new ToolError("INVALID_FILTER", { field: "settings.branch_pattern", hint: "a valid regular expression" });
    }
  }
  if (next.release_target !== undefined && !/^[a-z][a-z0-9_-]{0,29}$/.test(String(next.release_target))) throw new ToolError("INVALID_FILTER", { field: "settings.release_target" });
  if (next.release !== undefined) next.release = checkReleaseSettings(next.release);
  if (next.team !== undefined) {
    const team = next.team as { idle_minutes?: unknown };
    if (typeof team !== "object" || team === null || Array.isArray(team)) throw new ToolError("INVALID_FILTER", { field: "settings.team" });
    if (team.idle_minutes !== undefined && (!Number.isInteger(team.idle_minutes) || (team.idle_minutes as number) < 1 || (team.idle_minutes as number) > 24 * 60)) {
      throw new ToolError("INVALID_FILTER", { field: "settings.team.idle_minutes", hint: "minutes from 1 to 1440" });
    }
  }
  for (const [name, q] of Object.entries((next.quotas as Record<string, { daily?: unknown }> | undefined) ?? {})) {
    if (!Number.isInteger(q?.daily) || (q.daily as number) < 1) throw new ToolError("INVALID_FILTER", { field: `settings.quotas.${name}.daily`, hint: "a positive integer" });
  }
  return next as ProjectSettings;
}

export async function setProject(
  db: Db,
  input: { project: string; version?: number; title?: string; body?: string; rules?: string; headline?: string; settings?: Record<string, unknown> },
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
    if (headline !== undefined && headline !== current.headlineNote) changes.headline = [current.headlineNote, headline];
    const settings = input.settings ? mergeSettings(current.settings, input.settings) : undefined;
    if (settings && JSON.stringify(settings) !== JSON.stringify(current.settings)) changes.settings = [current.settings, settings];
    if (!Object.keys(changes).length) return projectShape(current);
    // 2.10: a Jorge line in the headline only warns; it makes no blocker.
    const warnings = changes.headline ? headlineWarnings(headline) : [];
    const [u] = await tx
      .update(projects)
      .set({
        ...(changes.title ? { title: input.title } : {}),
        ...(changes.body ? { body: input.body } : {}),
        ...(changes.rules ? { rulesText: input.rules, rulesVersion: sql`${projects.rulesVersion} + 1` } : {}),
        ...(changes.headline
          ? { headlineNote: headline, headlineNoteVersion: sql`${projects.headlineNoteVersion} + 1`, headlineNoteAt: sql`now()`, headlineNoteStale: false }
          : {}),
        ...(changes.settings ? { settings } : {}),
        version: sql`${projects.version} + 1`,
        updatedAt: sql`now()`,
      })
      .where(eq(projects.id, p.id))
      .returning();
    await emit("project.updated", null, { changes });
    return warnings.length ? { ...projectShape(u!), warnings } : projectShape(u!);
  });
}

// 2.11: what set_project headline writes is the note beside the generated headline (src/mcp/headline.ts).
export function headlineNoteShape(p: Project) {
  return { text: p.headlineNote, version: p.headlineNoteVersion, at: iso(p.headlineNoteAt), stale: p.headlineNoteStale };
}

function projectShape(p: Project) {
  return {
    project: p.slug,
    title: p.title,
    body: p.body,
    rules: p.rulesText,
    rules_version: p.rulesVersion,
    headline: headlineNoteShape(p),
    settings: p.settings,
    version: p.version,
  };
}

// The note describes a moment; an env change, an initiative moving or a ticket reaching Done
// after it was written makes it stale until set_project writes a new one. The generated headline never is.
export async function markHeadlineStale(tx: Q, projectId: string): Promise<void> {
  await tx
    .update(projects)
    .set({ headlineNoteStale: true })
    .where(and(eq(projects.id, projectId), sql`${projects.headlineNote} <> ''`, eq(projects.headlineNoteStale, false)));
}
