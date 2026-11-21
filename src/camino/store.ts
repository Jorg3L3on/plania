// PLA-I68-2: the camino row and its history, and the one read the screen gets (GET /api/company/projects/:slug/camino).
// Discovery runs on «Volver a comprobar», on the first open, and in the background when the last one is older than
// STALE_MS; one at a time per project. Every outside call is injected (caminoDeps) so tests never reach GitHub.
import { and, desc, eq, sql } from "drizzle-orm";
import pg from "pg";
import type { Db } from "../db/client.js";
import { camino, caminoHistory, envStates, projects, pullRequests, tasks, type CaminoDest, type Project } from "../db/schema.js";
import { githubToken } from "../jobs/github.js";
import { startBranchOf } from "../runner/start-branch.js";
import { projectsRoot, repoPathOf } from "../runner/worktree.js";
import { findProject } from "../mcp/queries.js";
import { effectiveConfig, RUNNER_WORK_PATTERN, type EffectiveConfig } from "./config.js";
import { discoverGithub, ghApi, type GhApi } from "./github.js";
import { caminoKeys } from "./keys.js";
import { discoverMac } from "./mac.js";
import { caminoSay } from "./words.js";
import { runActionlint, type Actionlint } from "./actionlint.js";
import type { HttpFetch } from "./providers.js";
import type { CaminoConfig, Discovery, ProviderId } from "./types.js";

export const STALE_MS = 15 * 60_000;

export type CaminoDeps = {
  fetch: HttpFetch;
  /** PLA-I68-5: the workflow linter (actionlint on stdin). */
  actionlint: Actionlint;
  env: NodeJS.ProcessEnv;
  now: () => Date;
  listDatabases: () => Promise<string[] | null>;
};

async function localDatabases(): Promise<string[] | null> {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  const u = new URL(url);
  u.pathname = "/postgres";
  const c = new pg.Client({ connectionString: u.toString(), connectionTimeoutMillis: 3_000 });
  try {
    await c.connect();
    const r = await c.query<{ datname: string }>("select datname from pg_database where not datistemplate order by datname");
    return r.rows.map((x) => x.datname);
  } catch {
    return null;
  } finally {
    await c.end().catch(() => {});
  }
}

export const caminoDeps: CaminoDeps = {
  fetch: (url, init) => fetch(url, init as RequestInit) as unknown as ReturnType<HttpFetch>,
  actionlint: runActionlint,
  env: process.env,
  now: () => new Date(),
  listDatabases: localDatabases,
};

/** The GitHub client for a project: its saved key in Camino, else the poller's token. Null with no token at all. */
export async function githubFor(p: Project, deps: CaminoDeps = caminoDeps): Promise<GhApi | null> {
  const saved = await caminoKeys().get(p.slug, "github");
  if (saved) return ghApi(saved, "camino", deps.fetch);
  const t = await githubToken({ fetch: deps.fetch as never, env: deps.env }, { token_env: p.settings.github?.token_env });
  return t.token ? ghApi(t.token, t.source, deps.fetch) : null;
}

/** The project's stored config ({} until the owner saves something), its version and its last discovery. */
export async function caminoRow(db: Db, projectId: string) {
  const [row] = await db.select().from(camino).where(eq(camino.projectId, projectId)).limit(1);
  return row ?? { projectId, config: {} as CaminoConfig, version: 0, discovery: null, checkedAt: null, updatedAt: null };
}

/** PLA-I70-6: the work-branch pattern the runner names branches by: the owner's, else the neutral default. */
export async function workPatternOf(db: Db, projectId: string): Promise<string> {
  const row = await caminoRow(db, projectId);
  return row.config.branches?.work_pattern?.trim() || RUNNER_WORK_PATTERN;
}

/** Runs discovery and stores it. Errors become the discovery's own ok:false, never a throw. */
export async function discover(db: Db, p: Project, deps: CaminoDeps = caminoDeps): Promise<Discovery> {
  const t0 = Date.now();
  const row = await caminoRow(db, p.id);
  const repo = p.settings.github?.repo ?? null;
  const base = effectiveConfig(p.settings, row.config, null);
  const roles = [base.branches.published, base.branches.integration].filter((b): b is string => !!b);
  const api = await githubFor(p, deps);
  const now = deps.now();
  const github: Discovery["github"] = !repo
    ? { ok: false, error: "no_repo", repos: api ? await reposOnly(api) : [] }
    : !api
      ? { ok: false, error: "no_token" }
      : await discoverGithub(api, repo, roles, now).catch((e) => ({ ok: false as const, error: "network" as const, detail: e instanceof Error ? e.message.slice(0, 200) : "" }));
  const folder = p.settings.local?.no_code ? null : repoPathOf(p.slug, p.settings, deps.env);
  const mac = await discoverMac(folder, repo, { listDatabases: deps.listDatabases, projectsRoot: projectsRoot(deps.env) });
  // PLA-I70-3: a network failure never erases the last good read; it is kept, marked stale with its age.
  const prevGh = row.discovery?.github;
  const kept: Discovery["github"] =
    !github.ok && github.error === "network" && prevGh?.ok && prevGh.repo.full_name === repo
      ? { ...prevGh, stale: { since: prevGh.stale?.since ?? row.discovery!.checked_at, error: github.detail ?? "network" } }
      : github.ok
        ? github
        : { ...github, source: api?.source ?? null };
  const d: Discovery = { checked_at: now.toISOString(), took_ms: Date.now() - t0, github: kept, mac };
  // PLA-I68-3: what changed on GitHub since the last read and was not Plania's own doing goes to Historial.
  if (row.discovery) {
    // A merge-option change Plania itself applied since the last read is not someone else's.
    const [mine] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(caminoHistory)
      .where(and(eq(caminoHistory.projectId, p.id), eq(caminoHistory.who, "owner"), eq(caminoHistory.dest, "github"), sql`${caminoHistory.at} >= ${row.discovery.checked_at}::timestamptz`));
    const ours = (mine?.n ?? 0) > 0;
    for (const h of outsideChanges(row.discovery, d)) if (!(ours && h === caminoSay().outsideMerge)) await addHistory(db, p.id, { who: "outside", label: h, dest: "github" });
  }
  await db
    .insert(camino)
    .values({ projectId: p.id, discovery: d, checkedAt: now })
    .onConflictDoUpdate({ target: camino.projectId, set: { discovery: d, checkedAt: now } });
  return d;
}

async function reposOnly(api: GhApi): Promise<string[]> {
  try {
    const r = await api.call("GET", "/user/repos?per_page=100&sort=pushed");
    return r.status === 200 ? ((await r.json()) as { full_name: string }[]).map((x) => x.full_name) : [];
  } catch {
    return [];
  }
}

const running = new Map<string, Promise<Discovery>>();
/** One discovery at a time per project; a second call waits for the first. */
export function discoverOnce(db: Db, p: Project, deps: CaminoDeps = caminoDeps): Promise<Discovery> {
  const live = running.get(p.id);
  if (live) return live;
  const job = discover(db, p, deps).finally(() => running.delete(p.id));
  running.set(p.id, job);
  return job;
}
export const discovering = (projectId: string) => running.has(projectId);

export async function addHistory(db: Db, projectId: string, h: { who: string; label: string; dest: CaminoDest; undo?: string | null; detail?: Record<string, unknown> }) {
  await db.insert(caminoHistory).values({ projectId, who: h.who, label: h.label, dest: h.dest, undo: h.undo ?? null, detail: h.detail ?? {} });
}

/** Writes the stored config with the version the screen read (STALE when someone wrote since). */
export async function writeConfig(db: Db, projectId: string, version: number, next: CaminoConfig): Promise<number> {
  const row = await caminoRow(db, projectId);
  if (row.version !== version) {
    const { ToolError } = await import("../mcp/errors.js");
    throw new ToolError("STALE_VERSION", { current_version: row.version });
  }
  const [u] = await db
    .insert(camino)
    .values({ projectId, config: next, version: version + 1, updatedAt: new Date() })
    .onConflictDoUpdate({ target: camino.projectId, set: { config: next, version: sql`${camino.version} + 1`, updatedAt: new Date() } })
    .returning({ version: camino.version });
  return u!.version;
}

export type Proposal = { number: number; title: string; url: string; state: string; base_branch: string | null; head_branch: string | null; ci_state: string | null; task_key: string | null; merged_at: string | null; updated_at: string };
export type ConnectionRead = { provider: ProviderId; saved: boolean; meta: NonNullable<CaminoConfig["connections"]>[ProviderId] | null };

export type CaminoRead = {
  slug: string;
  title: string;
  version: number;
  config: EffectiveConfig;
  settings: { repo: string | null; folder: string | null; no_code: boolean; release: { from: string; into: string; env: string; mode: "command" | "merge"; prod_migrations: string | null } | null; capture: boolean; capture_pages: string[]; vercel: boolean;
    // PLA-133: the four settings Camino edits since they left Ajustes › Avanzado, as stored (null: the default holds).
    start_branch: string | null; start_default: string; github_token_env: string | null; release_on: "env" | "branch" | null; release_target: string | null;
    vercel_config: { project_id: string; team_id: string | null; token_env: string | null; targets: Record<string, string> | null } | null };
  discovery: Discovery | null;
  checked_at: string | null;
  checking: boolean;
  plania: {
    envs: { env: string; commit: string | null; branch: string | null; migrations_applied: number | null; migrations: number; deployed_at: string | null }[];
    note_stale: boolean;
    keys_store: "keychain" | "file" | "memory";
  };
  proposals: Proposal[];
  history: { at: string; who: string; label: string; dest: CaminoDest; undo: string | null }[];
};

export async function caminoRead(db: Db, slug: string): Promise<CaminoRead> {
  const p = await findProject(db, slug);
  const row = await caminoRow(db, p.id);
  const d = row.discovery;
  const gh = d?.github.ok ? { default_branch: d.github.repo.default_branch, merge: d.github.repo.merge } : null;
  const [envRows, prRows, hist, [proj]] = await Promise.all([
    db.select().from(envStates).where(eq(envStates.projectId, p.id)),
    db
      .select({ pr: pullRequests, key: tasks.key })
      .from(pullRequests)
      .leftJoin(tasks, eq(tasks.id, pullRequests.taskId))
      .where(and(eq(pullRequests.projectId, p.id), sql`(${pullRequests.state} = 'open' or coalesce(${pullRequests.mergedAt}, ${pullRequests.updatedAt}) > now() - interval '30 days')`))
      .orderBy(desc(sql`coalesce(${pullRequests.ghUpdatedAt}, ${pullRequests.updatedAt})`))
      .limit(120),
    db.select().from(caminoHistory).where(eq(caminoHistory.projectId, p.id)).orderBy(desc(caminoHistory.at)).limit(80),
    db.select({ stale: projects.headlineNoteStale }).from(projects).where(eq(projects.id, p.id)),
  ]);
  const s = p.settings;
  return {
    slug: p.slug,
    title: p.title,
    version: row.version,
    config: effectiveConfig(s, row.config, gh),
    settings: {
      repo: s.github?.repo ?? null,
      folder: s.local?.no_code ? null : repoPathOf(p.slug, s),
      no_code: s.local?.no_code === true,
      release: s.release ? { from: s.release.from, into: s.release.into, env: s.release.env, mode: s.release.mode ?? "command", prod_migrations: s.release.prod_migrations ?? null } : null,
      capture: !!s.capture,
      capture_pages: [...new Set((s.capture?.pages ?? []).map((x) => x.path))],
      vercel: !!s.vercel,
      start_branch: s.start_branch ?? null,
      start_default: startBranchOf({}),
      github_token_env: s.github?.token_env ?? null,
      release_on: s.release_on ?? null,
      release_target: s.release_target ?? null,
      vercel_config: s.vercel ? { project_id: s.vercel.project_id, team_id: s.vercel.team_id ?? null, token_env: s.vercel.token_env ?? null, targets: s.vercel.targets ?? null } : null,
    },
    discovery: d,
    checked_at: row.checkedAt?.toISOString() ?? null,
    checking: discovering(p.id),
    plania: {
      envs: envRows.map((e) => ({ env: e.env, commit: e.commit, branch: e.branch, migrations_applied: e.migrationsApplied, migrations: e.migrations.length, deployed_at: e.deployedAt?.toISOString() ?? null })),
      note_stale: !!proj?.stale,
      keys_store: caminoKeys().kind,
    },
    proposals: prRows.map(({ pr, key }) => ({
      number: pr.number,
      title: pr.title,
      url: pr.url,
      state: pr.state,
      base_branch: pr.baseBranch,
      head_branch: pr.headBranch,
      ci_state: pr.ciState,
      task_key: key,
      merged_at: pr.mergedAt?.toISOString() ?? null,
      updated_at: (pr.ghUpdatedAt ?? pr.updatedAt).toISOString(),
    })),
    history: hist.map((h) => ({ at: h.at.toISOString(), who: h.who, label: h.label, dest: h.dest, undo: h.undo })),
  };
}

/** PLA-I68-3: the differences between two reads that someone made on GitHub outside Plania: rulesets that are not
 * Plania's (plania-*) created, deleted or changed, the default branch, and the merge options. */
export function outsideChanges(before: Discovery, after: Discovery): string[] {
  const a = before.github;
  const b = after.github;
  if (!a.ok || !b.ok || a.repo.full_name !== b.repo.full_name) return [];
  const w = caminoSay();
  const out: string[] = [];
  const key = (r: { enforcement: string; required_checks: string[]; branches: string[] }) => JSON.stringify([r.enforcement, [...r.required_checks].sort(), [...r.branches].sort()]);
  const was = new Map(a.rules.list.filter((r) => !r.plania).map((r) => [r.id, r]));
  const now = new Map(b.rules.list.filter((r) => !r.plania).map((r) => [r.id, r]));
  if (a.rules.available && b.rules.available) {
    for (const [id, r] of now) if (!was.has(id)) out.push(w.outsideRuleset(r.name, w.created));
    for (const [id, r] of was) if (!now.has(id)) out.push(w.outsideRuleset(r.name, w.removed));
    for (const [id, r] of now) if (was.has(id) && key(was.get(id)!) !== key(r)) out.push(w.outsideRuleset(r.name, w.changed));
  }
  if (b.repo.default_branch && a.repo.default_branch !== b.repo.default_branch) out.push(w.outsideDefault(b.repo.default_branch));
  // PLA-I70-2: field by field; a jsonb round trip reorders keys, so comparing the JSON text made every re-read «change».
  if (a.repo.merge && b.repo.merge && !b.stale && !a.stale) {
    const f = (m: NonNullable<typeof a.repo.merge>) => [m.squash, m.merge, m.rebase, m.delete_on_merge, m.suggest_update];
    const after = f(b.repo.merge);
    if (f(a.repo.merge).some((v, i) => v !== after[i])) out.push(w.outsideMerge);
  }
  return out;
}
