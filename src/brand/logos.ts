// PLA-I66-1: each project's logo, found in its repo and kept in Plania as the original. The detector reads the
// project's start branch with git (never the working tree, never a write), ranks the files (src/brand/detect.ts) and
// stores the winner once per content under <captures dir>/_marca/<project>/. A project's logo changes only when the
// branch moves and its best file changes; a logo the owner uploaded or chose from Artist's marks is never replaced by
// the repo (a later step asks instead). Reads are throttled per project, so the screen can ask on every load.
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { and, desc, eq, max } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { projectLogos, projects, type Actor, type Project, type ProjectLogo } from "../db/schema.js";
import { capturesDir } from "../captures/store.js";
import { repoPathOf } from "../runner/worktree.js";
import { startBranchOf } from "../runner/start-branch.js";
import { bus } from "../events.js";
import { detectLogo, looksLikeLogo, MAX_LOGO_BYTES, type RepoFile } from "./detect.js";

export type Git = (cwd: string, args: string[]) => Promise<{ code: number; stdout: Buffer }>;
export type LogoDeps = { git?: Git; now?: () => number; env?: NodeJS.ProcessEnv };

export const DETECTOR: Actor = { agent: "plania", session_id: "marca-detector" };
// How often one project's repo is looked at, at most. The look itself is one rev-parse unless the branch moved.
export const RECHECK_MS = 60_000;
const EXT: Record<ProjectLogo["mime"], string> = { "image/svg+xml": "svg", "image/png": "png" };
const FILE = /^[0-9a-f]{64}\.(svg|png)$/;

export const realGit: Git = (cwd, args) =>
  new Promise((resolve) => {
    execFile("git", args, { cwd, encoding: "buffer", maxBuffer: 16 * 1024 * 1024, timeout: 20_000 }, (err, stdout) =>
      resolve({ code: err ? 1 : 0, stdout: Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout ?? "") }),
    );
  });

function logoDir(slug: string): string {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) throw new Error(`bad project slug ${slug}`);
  return path.join(capturesDir(), "_marca", slug);
}

/** Writes the file once (content-addressed) and returns its name. */
export function putLogoFile(slug: string, bytes: Buffer, mime: ProjectLogo["mime"]): string {
  const name = `${createHash("sha256").update(bytes).digest("hex")}.${EXT[mime]}`;
  const dir = logoDir(slug);
  mkdirSync(dir, { recursive: true });
  const target = path.join(dir, name);
  if (!existsSync(target)) {
    const tmp = path.join(dir, `.${name}.${randomUUID()}.tmp`);
    writeFileSync(tmp, bytes);
    renameSync(tmp, target);
  }
  return name;
}

export function readLogoFile(slug: string, file: string): Buffer | null {
  if (!FILE.test(file)) return null;
  const p = path.join(logoDir(slug), file);
  return existsSync(p) ? readFileSync(p) : null;
}

/** The commit the logo is read from: the start branch, its remote twin, or HEAD when the repo has neither. */
async function startCommit(git: Git, repo: string, branch: string): Promise<string | null> {
  for (const ref of [branch, `origin/${branch}`, "HEAD"]) {
    const r = await git(repo, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
    const sha = r.stdout.toString("utf8").trim();
    if (r.code === 0 && /^[0-9a-f]{40}$/.test(sha)) return sha;
  }
  return null;
}

/** The logo-looking files at a commit, with their bytes (only the few that pass the name rules are read). */
export async function filesAt(git: Git, repo: string, commit: string, slug: string): Promise<RepoFile[]> {
  const ls = await git(repo, ["ls-tree", "-r", "-l", "-z", commit]);
  if (ls.code !== 0) return [];
  const out: RepoFile[] = [];
  for (const entry of ls.stdout.toString("utf8").split("\0")) {
    const m = entry.match(/^\d+ blob [0-9a-f]+\s+(\d+)\t(.+)$/);
    if (!m || Number(m[1]) > MAX_LOGO_BYTES || !looksLikeLogo(m[2]!, slug)) continue;
    const blob = await git(repo, ["cat-file", "blob", `${commit}:${m[2]}`]);
    if (blob.code === 0) out.push({ path: m[2]!, bytes: blob.stdout });
    if (out.length >= 40) break;
  }
  return out;
}

export async function activeLogo(db: Db, projectId: string): Promise<ProjectLogo | null> {
  const [row] = await db.select().from(projectLogos).where(and(eq(projectLogos.projectId, projectId), eq(projectLogos.active, true))).limit(1);
  return row ?? null;
}

/** A new active version; the previous one stays as history. */
export async function addLogoVersion(
  db: Db,
  project: Pick<Project, "id" | "slug">,
  v: Omit<typeof projectLogos.$inferInsert, "id" | "projectId" | "version" | "active" | "createdAt">,
): Promise<ProjectLogo> {
  const row = await db.transaction(async (tx) => {
    const [{ top } = { top: 0 }] = await tx.select({ top: max(projectLogos.version) }).from(projectLogos).where(eq(projectLogos.projectId, project.id));
    await tx.update(projectLogos).set({ active: false }).where(and(eq(projectLogos.projectId, project.id), eq(projectLogos.active, true)));
    const [created] = await tx.insert(projectLogos).values({ ...v, projectId: project.id, version: (top ?? 0) + 1, active: true }).returning();
    return created!;
  });
  bus.publish({ type: "project", project: project.slug });
  return row;
}

export type ScanResult = { status: "found" | "same" | "none" | "kept" | "no_repo"; logo: ProjectLogo | null; commit: string | null };

/** Looks at one project's repo once and records a new logo version when its best file changed. */
export async function scanProjectLogo(db: Db, project: Project, deps: LogoDeps = {}): Promise<ScanResult> {
  const git = deps.git ?? realGit;
  const current = await activeLogo(db, project.id);
  if (project.settings?.local?.no_code) return { status: "no_repo", logo: current, commit: null };
  const repo = repoPathOf(project.slug, project.settings, deps.env);
  const commit = await startCommit(git, repo, startBranchOf(project.settings));
  if (!commit) return { status: "no_repo", logo: current, commit: null };
  if (current && current.source !== "repo") return { status: "kept", logo: current, commit };
  if (current?.sourceCommit === commit) return { status: "same", logo: current, commit };
  const { best } = detectLogo(await filesAt(git, repo, commit, project.slug), project.slug);
  if (!best) return { status: "none", logo: current, commit };
  const file = putLogoFile(project.slug, best.bytes, best.mime);
  if (current && current.file === file && current.sourcePath === best.path) {
    // Same logo on a newer commit: remember the commit, no new version.
    await db.update(projectLogos).set({ sourceCommit: commit }).where(eq(projectLogos.id, current.id));
    return { status: "same", logo: { ...current, sourceCommit: commit }, commit };
  }
  const logo = await addLogoVersion(db, project, {
    file,
    mime: best.mime,
    bytes: best.bytes.length,
    width: best.width === null ? null : Math.round(best.width),
    height: best.height === null ? null : Math.round(best.height),
    variant: best.variant,
    source: "repo",
    sourcePath: best.path,
    sourceCommit: commit,
    colors: best.colors,
    actor: DETECTOR,
  });
  return { status: "found", logo, commit };
}

// When each project was last looked at, in this process. A restart looks once more, which is cheap.
const lastLook = new Map<string, number>();
let running: Promise<void> | null = null;

/** Looks at every project whose last look is older than RECHECK_MS. One pass at a time; errors leave the old logo. */
export async function refreshLogos(db: Db, deps: LogoDeps = {}): Promise<void> {
  if (running) return running;
  const now = deps.now ?? Date.now;
  running = (async () => {
    const all = await db.select().from(projects);
    for (const p of all) {
      if (now() - (lastLook.get(p.id) ?? -Infinity) < RECHECK_MS) continue;
      lastLook.set(p.id, now());
      try {
        await scanProjectLogo(db, p, deps);
      } catch (e) {
        console.error(`[marca] ${p.slug}: ${(e as Error).message}`);
      }
    }
  })().finally(() => {
    running = null;
  });
  return running;
}
export const forgetLogoLooks = (): void => lastLook.clear();

export type LogoRef = { v: number; file: string; mime: ProjectLogo["mime"]; variant: ProjectLogo["variant"]; colors: string[]; source: ProjectLogo["source"]; path: string | null };

/** Every project's active logo, by slug: what the screen needs to draw ProjectMark. */
export async function logosRead(db: Db): Promise<Record<string, LogoRef>> {
  const rows = await db
    .select({ slug: projects.slug, l: projectLogos })
    .from(projectLogos)
    .innerJoin(projects, eq(projects.id, projectLogos.projectId))
    .where(eq(projectLogos.active, true))
    .orderBy(desc(projectLogos.version));
  const out: Record<string, LogoRef> = {};
  for (const { slug, l } of rows) out[slug] = { v: l.version, file: l.file, mime: l.mime, variant: l.variant, colors: l.colors, source: l.source, path: l.sourcePath };
  return out;
}

/** The active logo's bytes for a project, or null. */
export async function logoBytes(db: Db, slug: string): Promise<{ bytes: Buffer; mime: ProjectLogo["mime"] } | null> {
  const [p] = await db.select({ id: projects.id }).from(projects).where(eq(projects.slug, slug)).limit(1);
  if (!p) return null;
  const l = await activeLogo(db, p.id);
  if (!l) return null;
  const bytes = readLogoFile(slug, l.file);
  return bytes ? { bytes, mime: l.mime } : null;
}
