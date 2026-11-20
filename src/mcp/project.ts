import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { projects, type Project, type ProjectSettings } from "../db/schema.js";
import { ToolError } from "./errors.js";
import { headlineWarnings } from "./owner-lines.js";
import { checkReleaseSettings } from "./release-plan.js";
import { parseCaptureSettings } from "../captures/settings.js";
import { parseQaSettings } from "../runner/qa-settings.js";
import { parseMaquinasSettings } from "../maquinas/settings.js";
import { parseLocalSettings } from "../runner/repo-check.js";
import { startBranchProblem } from "../runner/start-branch.js";
import { TEXT_LIMITS } from "./limits.js";
import { ENV_NAME, settableKeys } from "./settings-registry.js";
import { findProject } from "./queries.js";
import { iso, writeTx, type Ctx, type Q } from "./tx.js";

// The project's own text: title, body (stack, repo, prod, constraints), rules (project-specific
// additions to the protocol) and the headline (one line on where it stands, ≤ 280 chars).
// Replaced with the version you read; rules_version moves with the rules, headline_version with the headline.


// settings merge key by key; null removes one. Secrets never: integrations name env vars.
// PLA-I2-6: an owner-only key (src/mcp/settings-registry.ts) is taken only from the owner's screen (ctx.human); from
// an agent it is refused like an unknown key, so an agent cannot weaken a control the owner keeps (I46-10 #4).
function mergeSettings(current: ProjectSettings, patch: Record<string, unknown>, human: boolean): ProjectSettings {
  const allowed = settableKeys(human);
  const next: Record<string, unknown> = { ...current };
  for (const [k, v] of Object.entries(patch)) {
    if (!(allowed as readonly string[]).includes(k)) throw new ToolError("INVALID_FILTER", { field: `settings.${k}`, allowed });
    if (v === null) delete next[k];
    else next[k] = v;
  }
  if (next.release_on !== undefined && !["env", "branch"].includes(String(next.release_on))) throw new ToolError("INVALID_FILTER", { field: "settings.release_on", allowed: ["env", "branch"] });
  if (next.auto_done !== undefined && typeof next.auto_done !== "boolean") throw new ToolError("INVALID_FILTER", { field: "settings.auto_done", allowed: [true, false] });
  if (next.claim_from !== undefined && !["backlog", "ready"].includes(String(next.claim_from))) throw new ToolError("INVALID_FILTER", { field: "settings.claim_from", allowed: ["backlog", "ready"] });
  if (next.branch_pattern !== undefined) {
    try {
      new RegExp(String(next.branch_pattern));
    } catch {
      throw new ToolError("INVALID_FILTER", { field: "settings.branch_pattern", hint: "a valid regular expression" });
    }
  }
  if (next.release_target !== undefined && !/^[a-z][a-z0-9_-]{0,29}$/.test(String(next.release_target))) throw new ToolError("INVALID_FILTER", { field: "settings.release_target" });
  // PLA-I2-6: the keys the screen writes, now in the one list (src/mcp/settings-registry.ts). Checked when sent, so
  // an odd value stored before never blocks an unrelated save.
  for (const k of ["plan_approval", "auto_accept", "auto_accept_invisible"] as const) {
    if (patch[k] != null && typeof next[k] !== "boolean") throw new ToolError("INVALID_FILTER", { field: `settings.${k}`, allowed: [true, false] });
  }
  if (patch.preview_url != null) {
    const u = String(next.preview_url);
    if (typeof next.preview_url !== "string" || u.length > 300 || !/^https?:\/\/\S+$/.test(u)) throw new ToolError("INVALID_FILTER", { field: "settings.preview_url", hint: "an http or https address" });
  }
  if (patch.next_first != null && (typeof next.next_first !== "string" || !/^[A-Z][A-Z0-9]*-[A-Z0-9-]+$/.test(next.next_first))) throw new ToolError("INVALID_FILTER", { field: "settings.next_first", hint: "a ticket key" });
  if (patch.runner != null && (typeof next.runner !== "object" || next.runner === null || Array.isArray(next.runner))) throw new ToolError("INVALID_FILTER", { field: "settings.runner" });
  // PLA-I2-6: a token is named by its variable, never given: a value that is not a variable's name is refused.
  for (const k of ["github", "vercel"] as const) {
    const te = (patch[k] as { token_env?: unknown } | null | undefined)?.token_env;
    if (te !== undefined && (typeof te !== "string" || !ENV_NAME.test(te))) throw new ToolError("INVALID_FILTER", { field: `settings.${k}.token_env`, hint: "the NAME of an environment variable (A-Z, 0-9, _), never the token" });
  }
  if (next.release !== undefined) next.release = checkReleaseSettings(next.release);
  // PLA-I46-6: how Plania reaches the running app (src/captures/settings.ts).
  if (next.capture !== undefined) {
    const c = parseCaptureSettings(next.capture);
    if (!c.ok) throw new ToolError("INVALID_FILTER", { field: c.field, hint: c.hint });
    next.capture = c.settings;
  }
  // PLA-I46-9: the QA lane's verify list (src/runner/qa-settings.ts).
  if (next.qa !== undefined) {
    const q = parseQaSettings(next.qa);
    if (!q.ok) throw new ToolError("INVALID_FILTER", { field: q.field, hint: q.hint });
    next.qa = q.settings;
  }
  // PLA-I48-2: the floor's Máquinas (src/maquinas/settings.ts): env file name, migrate and seed commands, migrations folder.
  if (next.maquinas !== undefined) {
    const m = parseMaquinasSettings(next.maquinas);
    if (!m.ok) throw new ToolError("INVALID_FILTER", { field: m.field, hint: m.hint });
    next.maquinas = m.settings;
  }
  // NEWPROJ-3: where the code is on this machine (repo_path) or that there is none yet (no_code). Shape only.
  if (next.local !== undefined) {
    const l = parseLocalSettings(next.local);
    if (!l.ok) throw new ToolError("INVALID_FILTER", { field: l.field, hint: l.hint });
    next.local = l.settings;
  }
  // PLA-I2-5: the start branch (src/runner/start-branch.ts): a valid branch name, never a protected one.
  if (next.start_branch !== undefined) {
    const problem = startBranchProblem(next.start_branch);
    if (problem) throw new ToolError("INVALID_FILTER", { field: "settings.start_branch", hint: problem });
  }
  if (next.marca !== undefined && next.marca !== null) {
    const m = next.marca as { native?: unknown; extras?: unknown };
    // PLA-I69-3: extras, the extra surfaces switched on: {avisos, atajos, capturas, prueba} as booleans.
    const EX = ["avisos", "atajos", "capturas", "prueba"];
    const ex = m && typeof m === "object" ? (m.extras as Record<string, unknown> | undefined) : undefined;
    const badExtras = ex !== undefined && (typeof ex !== "object" || ex === null || Array.isArray(ex) || Object.entries(ex).some(([k, v]) => !EX.includes(k) || typeof v !== "boolean"));
    if (typeof m !== "object" || Array.isArray(m) || Object.keys(m).some((k) => k !== "native" && k !== "extras") || (m.native !== undefined && typeof m.native !== "boolean") || badExtras) {
      throw new ToolError("INVALID_FILTER", { field: "settings.marca", hint: "{native: true | false, extras: {avisos, atajos, capturas, prueba: true | false}}" });
    }
  }
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
    const settings = input.settings ? mergeSettings(current.settings, input.settings, ctx.human === true) : undefined;
    if (settings && JSON.stringify(settings) !== JSON.stringify(current.settings)) changes.settings = [current.settings, settings];
    if (!Object.keys(changes).length) return projectShape(current);
    // 2.10: an owner line in the headline only warns; it makes no blocker.
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
