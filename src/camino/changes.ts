// PLA-I68-3: Camino's change set. The screen collects edits and sends them together; the server applies them in
// dependency order (Plania, then the services, then GitHub's API, then PRs with a diff), one at a time, and stops at the
// first failure with its reason: what came before stays applied (each is in Historial with how to undo it), nothing
// after it runs. Plania never writes to the published branch: a repo file only changes by a PR opened with the
// owner's token (F4/F5 add those kinds). Every GitHub call goes through the project's client (src/camino/store.ts).
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client.js";
import { camino, projects, type CaminoDest, type Project } from "../db/schema.js";
import { ToolError } from "../mcp/errors.js";
import { findProject } from "../mcp/queries.js";
import { setProject } from "../mcp/project.js";
import { WEB_ACTOR } from "../mcp/tx.js";
import { startBranchProblem } from "../runner/start-branch.js";
import { GITHUB_REPO } from "../runner/repo-check.js";
import { originOf, repoOfRemote } from "./mac.js";
import { addHistory, caminoDeps, caminoRow, githubFor, type CaminoDeps } from "./store.js";
import type { GhApi } from "./github.js";
import type { BranchRule, CaminoConfig } from "./types.js";
import { caminoSay } from "./words.js";

const BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/;
const Rule = z.object({ on: z.boolean(), pr: z.boolean(), nodel: z.boolean(), agents: z.boolean() }).strict();
const label = z.string().min(1).max(300);

// Every kind of change, its fields checked here. Later phases add kinds to this union (commits, workflows, envs).
export const ChangeSchema = z.discriminatedUnion("kind", [
  // Plania: the camino record (branch roles, conventions, environments…), patched key by key.
  z.object({ kind: z.literal("config"), label, patch: z.record(z.string(), z.unknown()) }).strict(),
  // Plania: the publishing model and branch roles; also written to settings.release and settings.start_branch.
  z.object({ kind: z.literal("roles"), label, model: z.enum(["trunk", "integ", "tags"]), published: z.string().regex(BRANCH), integration: z.string().regex(BRANCH).nullable(), work_pattern: z.string().min(1).max(120) }).strict(),
  // Plania: the repository (picked from the account's, or a pasted link checked against GitHub) and the folder.
  z.object({ kind: z.literal("repo"), label, repo: z.string().regex(GITHUB_REPO) }).strict(),
  z.object({ kind: z.literal("folder"), label, path: z.string().min(1).max(500) }).strict(),
  // GitHub: one Plania-owned ruleset per role branch (plania-<branch>), in plain words.
  z.object({ kind: z.literal("ruleset"), label, branch: z.string().regex(BRANCH), rule: Rule }).strict(),
  // GitHub: the repo's merge settings.
  z.object({ kind: z.literal("repo_merge"), label, squash: z.boolean(), promo_merge: z.boolean(), delete_on_merge: z.boolean(), suggest_update: z.boolean() }).strict(),
  // GitHub: delete a branch that nobody uses, or a ruleset (by id) that blocks merges for nothing.
  z.object({ kind: z.literal("delete_branch"), label, branch: z.string().regex(BRANCH) }).strict(),
  z.object({ kind: z.literal("delete_ruleset"), label, id: z.number().int().positive(), name: z.string().min(1).max(200) }).strict(),
]);
export type Change = z.infer<typeof ChangeSchema>;
export type ChangeKind = Change["kind"];

/** Where a change is applied. A ruleset on a repo whose plan has no rules is Plania's own (it enforces it). */
export const destOf = (c: Change, rulesAvailable = true): CaminoDest =>
  c.kind === "config" || c.kind === "roles" || c.kind === "repo" || c.kind === "folder" ? "plania" : c.kind === "ruleset" && !rulesAvailable ? "plania" : "github";

const ORDER: Record<CaminoDest, number> = { plania: 0, llavero: 0, proveedor: 1, github: 2, pr: 3 };
/** The order changes are reviewed and applied in: Plania, the services, GitHub's API, then PRs; stable within each. */
export function ordered<T extends { dest: CaminoDest }>(items: T[]): T[] {
  return items.map((x, i) => [x, i] as const).sort(([a, i], [b, j]) => ORDER[a.dest] - ORDER[b.dest] || i - j).map(([x]) => x);
}

export type ApplyResult = { index: number; kind: ChangeKind; dest: CaminoDest; ok: boolean; error?: string; detail?: Record<string, unknown>; note?: string };

// ---- GitHub helpers
async function ghCall(api: GhApi, method: string, path: string, step: string, body?: unknown): Promise<any> {
  let r;
  try {
    r = await api.call(method, path, body);
  } catch {
    throw new ToolError("CAMINO_GITHUB_REFUSED", { step, status: null, message: "network" });
  }
  if (r.status === 204) return null;
  const data = await r.json().catch(() => null);
  if (r.status < 200 || r.status >= 300) throw new ToolError("CAMINO_GITHUB_REFUSED", { step, status: r.status, message: String((data as any)?.message ?? "").slice(0, 300) });
  return data;
}
const enc = (s: string) => s.split("/").map(encodeURIComponent).join("/");

/** The body of Plania's ruleset for a branch: PR only, no delete or force-push, required checks; nobody bypasses it
 * unless the owner lets agents (then repository admins may, which is also the owner's own token). */
export function rulesetBody(branch: string, rule: BranchRule, checks: string[]) {
  const rules: unknown[] = [];
  if (rule.pr) rules.push({ type: "pull_request", parameters: { required_approving_review_count: 0, dismiss_stale_reviews_on_push: false, require_code_owner_review: false, require_last_push_approval: false, required_review_thread_resolution: false } });
  if (rule.nodel) rules.push({ type: "deletion" }, { type: "non_fast_forward" });
  if (checks.length) rules.push({ type: "required_status_checks", parameters: { strict_required_status_checks_policy: false, required_status_checks: checks.map((context) => ({ context })) } });
  return {
    name: `plania-${branch}`.slice(0, 100),
    target: "branch",
    enforcement: "active",
    conditions: { ref_name: { include: [`refs/heads/${branch}`], exclude: [] } },
    rules,
    bypass_actors: rule.agents ? [{ actor_id: 5, actor_type: "RepositoryRole", bypass_mode: "always" }] : [],
  };
}

async function patchConfig(db: Db, p: Project, fn: (c: CaminoConfig) => CaminoConfig) {
  const row = await caminoRow(db, p.id);
  const config = fn(row.config);
  await db
    .insert(camino)
    .values({ projectId: p.id, config, version: 1 })
    .onConflictDoUpdate({ target: camino.projectId, set: { config, version: sql`${camino.version} + 1`, updatedAt: new Date() } });
}

async function settingsPatch(db: Db, p: Project, settings: Record<string, unknown>) {
  const [cur] = await db.select({ version: projects.version }).from(projects).where(eq(projects.id, p.id));
  await setProject(db, { project: p.slug, version: cur!.version, settings }, { actor: WEB_ACTOR, human: true });
}

type Ctx = { db: Db; p: Project; deps: CaminoDeps; api: GhApi | null; rulesAvailable: boolean };

const needGithub = (x: Ctx): { api: GhApi; repo: string } => {
  const repo = x.p.settings.github?.repo;
  if (!repo || !x.api) throw new ToolError("CAMINO_NO_GITHUB", { repo: !!repo, token: !!x.api });
  return { api: x.api, repo };
};

/** Applies one change. Returns its undo sentence (for Historial) and an optional note for the screen. */
async function applyOne(x: Ctx, c: Change): Promise<{ undo: string | null; note?: string }> {
  const w = caminoSay();
  const { db, p } = x;
  switch (c.kind) {
    case "config": {
      const allowed = new Set(["commits", "deps", "envs", "required_checks", "rules", "merge"]);
      const bad = Object.keys(c.patch).find((k) => !allowed.has(k));
      if (bad) throw new ToolError("CAMINO_CHANGE_INVALID", { field: bad });
      await patchConfig(db, p, (cfg) => ({ ...cfg, ...(c.patch as CaminoConfig) }));
      return { undo: w.undoConfig };
    }
    case "roles": {
      if (c.model === "integ" && (!c.integration || c.integration === c.published)) throw new ToolError("CAMINO_CHANGE_INVALID", { field: "integration" });
      await patchConfig(db, p, (cfg) => ({ ...cfg, model: c.model, branches: { published: c.published, integration: c.model === "integ" ? c.integration : null, work_pattern: c.work_pattern } }));
      // Taller and Publicar read these: the release step goes integration → published, and Taller starts from the
      // integration branch (never a protected one: then the start branch stays as it was, and the note says so).
      const s = p.settings;
      const patch: Record<string, unknown> = {};
      let note: string | undefined;
      if (c.model === "integ" && c.integration) {
        patch.release = { ...(s.release ?? { env: "prod" }), from: c.integration, into: c.published };
        if (startBranchProblem(c.integration) === null) patch.start_branch = c.integration;
        else note = w.startStays;
      } else if (s.release) {
        patch.release = { ...s.release, into: c.published };
        note = w.trunkNote;
      }
      if (Object.keys(patch).length) await settingsPatch(db, p, patch);
      return { undo: w.undoRoles, note };
    }
    case "repo": {
      if (x.api) await ghCall(x.api, "GET", `/repos/${enc(c.repo)}`, "repo");
      await settingsPatch(db, p, { github: { ...(p.settings.github ?? {}), repo: c.repo } });
      return { undo: w.undoRepo(p.settings.github?.repo ?? null) };
    }
    case "folder": {
      const repo = p.settings.github?.repo ?? null;
      const origin = repoOfRemote(originOf(c.path));
      if (!origin) throw new ToolError("CAMINO_CHANGE_INVALID", { field: "path", reason: "not_a_clone" });
      if (repo && origin.toLowerCase() !== repo.toLowerCase()) throw new ToolError("CAMINO_CHANGE_INVALID", { field: "path", reason: "other_repo", origin });
      await settingsPatch(db, p, { local: { repo_path: c.path } });
      return { undo: w.undoFolder(p.settings.local?.repo_path ?? null) };
    }
    case "ruleset": {
      await patchConfig(db, p, (cfg) => ({ ...cfg, rules: { ...(cfg.rules ?? {}), [c.branch]: c.rule } }));
      if (!x.rulesAvailable) return { undo: w.undoRule(c.branch), note: w.planiaEnforces };
      const { api, repo } = needGithub(x);
      const list = ((await ghCall(api, "GET", `/repos/${enc(repo)}/rulesets?per_page=100`, "list")) ?? []) as { id: number; name: string }[];
      const name = `plania-${c.branch}`.slice(0, 100);
      const mine = list.find((r) => r.name === name);
      if (!c.rule.on) {
        if (mine) await ghCall(api, "DELETE", `/repos/${enc(repo)}/rulesets/${mine.id}`, "delete");
        return { undo: w.undoRuleOff(c.branch) };
      }
      const row = await caminoRow(db, p.id);
      const body = rulesetBody(c.branch, c.rule, row.config.required_checks?.[c.branch] ?? []);
      if (mine) await ghCall(api, "PUT", `/repos/${enc(repo)}/rulesets/${mine.id}`, "update", body);
      else await ghCall(api, "POST", `/repos/${enc(repo)}/rulesets`, "create", body);
      return { undo: w.undoRule(c.branch) };
    }
    case "repo_merge": {
      const { api, repo } = needGithub(x);
      // Ticket PRs squash; a promotion (integration → published) keeps a merge commit, so both stay allowed then.
      await ghCall(api, "PATCH", `/repos/${enc(repo)}`, "merge", { allow_squash_merge: true, allow_merge_commit: c.promo_merge || !c.squash, delete_branch_on_merge: c.delete_on_merge, allow_update_branch: c.suggest_update });
      await patchConfig(db, p, (cfg) => ({ ...cfg, merge: { squash: c.squash, promo_merge: c.promo_merge, delete_on_merge: c.delete_on_merge, suggest_update: c.suggest_update } }));
      return { undo: w.undoMerge };
    }
    case "delete_branch": {
      const row = await caminoRow(db, p.id);
      const roles = [row.config.branches?.published, row.config.branches?.integration, p.settings.release?.from, p.settings.release?.into, p.settings.start_branch, "main", "master"].filter(Boolean);
      if (roles.includes(c.branch)) throw new ToolError("CAMINO_CHANGE_INVALID", { field: "branch", reason: "role_branch" });
      const { api, repo } = needGithub(x);
      await ghCall(api, "DELETE", `/repos/${enc(repo)}/git/refs/heads/${enc(c.branch)}`, "delete_branch");
      return { undo: w.undoBranch(c.branch) };
    }
    case "delete_ruleset": {
      const { api, repo } = needGithub(x);
      await ghCall(api, "DELETE", `/repos/${enc(repo)}/rulesets/${c.id}`, "delete_ruleset");
      return { undo: w.undoRuleset(c.name) };
    }
  }
}

/** Applies a change set in order; stops at the first failure. version: the camino version the screen read. */
export async function applyChanges(db: Db, slug: string, input: { version: number; changes: Change[] }, deps: CaminoDeps = caminoDeps) {
  const p = await findProject(db, slug);
  const row = await caminoRow(db, p.id);
  if (row.version !== input.version) throw new ToolError("STALE_VERSION", { current_version: row.version });
  const gh = row.discovery?.github;
  const rulesAvailable = !gh || !gh.ok || gh.rules.available;
  const items = ordered(input.changes.map((c, index) => ({ c, index, dest: destOf(c, rulesAvailable) })));
  const results: ApplyResult[] = [];
  const api = items.some((i) => i.dest === "github" || i.c.kind === "repo") ? await githubFor(p, deps) : null;
  let stopped: ApplyResult | null = null;
  for (const it of items) {
    if (stopped) break;
    const fresh = await findProject(db, slug);
    try {
      const out = await applyOne({ db, p: fresh, deps, api, rulesAvailable }, it.c);
      await addHistory(db, p.id, { who: "owner", label: it.c.label, dest: it.dest, undo: out.undo, detail: { kind: it.c.kind } });
      results.push({ index: it.index, kind: it.c.kind, dest: it.dest, ok: true, ...(out.note ? { note: out.note } : {}) });
    } catch (e) {
      const err = e instanceof ToolError ? { error: e.code, detail: e.detail } : { error: "CAMINO_GITHUB_REFUSED", detail: { message: e instanceof Error ? e.message.slice(0, 200) : "" } };
      stopped = { index: it.index, kind: it.c.kind, dest: it.dest, ok: false, ...err };
      results.push(stopped);
    }
  }
  return { results, stopped, applied: results.filter((r) => r.ok).length, skipped: items.length - results.length };
}
