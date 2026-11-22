// PLA-I29-4: one worktree per ticket, outside every repo, cut from origin/sandbox.
// Never `claude -w`: it writes into <repo>/.claude/worktrees, which breaks the no-repo rule.
// PLA-I29-5: the runner refuses main as the branch and any base other than sandbox.
import { execFile } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { PROTECTED_BRANCHES } from "./deny.js";
import { defaultFolders } from "../folders.js"; // PLA-I2-3: neutral defaults, asked at first start
import { DEFAULT_START_BRANCH } from "./start-branch.js";

// PLA-I2-5: the default start branch. A project's own is startBranchOf(project.settings) (./start-branch.ts); the
// functions below take it as `base`/`allowed` and fall back to this.
export const ALLOWED_BASE = DEFAULT_START_BRANCH;
// PLA-I2-7: one list, shared with the deny rules (deny.ts).
const PROTECTED = new Set<string>(PROTECTED_BRANCHES);

export type GitResult = { code: number; stdout: string; stderr: string };
export type GitFn = (args: string[], cwd: string) => Promise<GitResult>;

export const defaultGit: GitFn = (args, cwd) =>
  new Promise((resolve) => {
    execFile("git", args, { cwd, timeout: 120_000 }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as { code?: unknown }).code === "number" ? ((err as { code: number }).code) : 1) : 0;
      resolve({ code, stdout: String(stdout), stderr: String(stderr) });
    });
  });

export const expandHome = (p: string): string => p.replace(/^~(?=$|\/)/, homedir());

export const worktreeRoot = (env: NodeJS.ProcessEnv = process.env): string =>
  path.resolve(expandHome(env.PLANIA_WORKTREES_ROOT || defaultFolders().worktrees));

export const projectsRoot = (env: NodeJS.ProcessEnv = process.env): string =>
  path.resolve(expandHome(env.PLANIA_PROJECTS_ROOT || defaultFolders().projects));

export const repoPathOf = (slug: string, settings: { local?: { repo_path?: string } } | null, env: NodeJS.ProcessEnv = process.env): string =>
  path.resolve(expandHome(settings?.local?.repo_path || path.join(projectsRoot(env), slug)));

const SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;

/** PLA-I70-6: the neutral default for work branches; a project's Camino pattern («Ramas de trabajo») replaces it. */
export const DEFAULT_WORK_PATTERN = "plania/<clave>";
/** The work branch for a ticket: the pattern with <clave> replaced by the lower-cased key. A pattern with no <clave>, or one that
 * would not be a safe branch name, falls back to the default. */
export function branchFor(key: string, pattern: string | null | undefined = DEFAULT_WORK_PATTERN): string {
  const k = key.toLowerCase();
  const p = pattern && pattern.includes("<clave>") ? pattern : DEFAULT_WORK_PATTERN;
  const name = p.replace(/<clave>/g, k);
  return /^[A-Za-z0-9][A-Za-z0-9._/-]{0,120}$/.test(name) && !name.includes("..") && !name.endsWith("/") ? name : DEFAULT_WORK_PATTERN.replace("<clave>", k);
}

export function worktreePathFor(root: string, project: string, key: string): string {
  if (!SAFE_KEY.test(project) || !SAFE_KEY.test(key)) throw new Error("unsafe worktree name");
  return path.join(root, project, key);
}

// A folder for runs with no ticket (a PO reviewing its project). Also outside every repo.
export const scratchPathFor = (root: string, project: string, agent: string): string => path.join(root, project, `_${agent}`);

export const isInside = (child: string, parent: string): boolean => {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
};

export type BaseCheck = { ok: true } | { ok: false; summary: string };

export function checkBase(branch: string | null, base: string | null, allowed: string = ALLOWED_BASE): BaseCheck {
  const b = (branch ?? "").trim();
  const from = (base ?? allowed).trim() || allowed;
  if (b && PROTECTED.has(b.replace(/^origin\//, ""))) return { ok: false, summary: "fail: base not allowed (branch main)" };
  // PLA-I2-5: the start branch itself is never a protected one, whatever the setting says.
  if (PROTECTED.has(from) || from !== allowed) return { ok: false, summary: `fail: base not allowed (${from.slice(0, 40)})` };
  return { ok: true };
}

export type WorktreeOutcome = { ok: true; path: string; branch: string; created: boolean } | { ok: false; summary: string };

// Creates (or reuses) <root>/<project>/<KEY> on its branch from origin/sandbox.
export async function ensureWorktree(
  input: { repo: string; root: string; project: string; key: string; branch: string; base?: string; from?: string },
  git: GitFn = defaultGit,
): Promise<WorktreeOutcome> {
  const start = input.base ?? ALLOWED_BASE;
  const base = checkBase(input.branch, start, start);
  if (!base.ok) return base;
  let target: string;
  try {
    target = worktreePathFor(input.root, input.project, input.key);
  } catch {
    return { ok: false, summary: "fail: bad worktree name" };
  }
  if (isInside(target, input.repo)) return { ok: false, summary: "fail: worktree inside the repo" };
  if (!existsSync(input.repo)) return { ok: false, summary: "fail: no repo" };

  if (existsSync(target)) {
    const head = await git(["rev-parse", "--abbrev-ref", "HEAD"], target);
    if (head.code !== 0) return { ok: false, summary: "fail: worktree unreadable" };
    const current = head.stdout.trim();
    const check = checkBase(current, start, start);
    if (!check.ok) return check;
    return { ok: true, path: target, branch: current, created: false };
  }

  // The summary is a fixed reason code (start-failures.ts), whatever the branch is called.
  const fetched = await git(["fetch", "origin", start], input.repo);
  if (fetched.code !== 0) return { ok: false, summary: "fail: fetch origin/sandbox" };
  mkdirSync(path.dirname(target), { recursive: true });
  const exists = (await git(["rev-parse", "--verify", "--quiet", `refs/heads/${input.branch}`], input.repo)).code === 0;
  // PLA-I73-2: a stacked step starts from the delivered step under it, not from the start branch.
  let from = `origin/${start}`;
  if (!exists && input.from && input.from !== start) {
    const got = await git(["fetch", "origin", input.from], input.repo);
    if (got.code === 0) from = `origin/${input.from}`;
  }
  const args = exists
    ? ["worktree", "add", target, input.branch]
    : ["worktree", "add", "--no-track", target, "-b", input.branch, from];
  const added = await git(args, input.repo);
  if (added.code !== 0) return { ok: false, summary: "fail: worktree add" };
  const head = await git(["rev-parse", "--abbrev-ref", "HEAD"], target);
  const check = checkBase(head.stdout.trim(), start, start);
  if (!check.ok) return check;
  return { ok: true, path: target, branch: input.branch, created: true };
}

// PLA-66: a question (Preguntar) reads its own copy of the project, never the owner's checkout as it sits (that
// checkout was 27 commits behind and the PO answered about a 5-day-old app). <root>/<project>/_consulta is a detached
// worktree moved to a freshly fetched origin/sandbox before each question. Read-only runs only: it is reset by force.
export type ReadCopy = { ok: true; path: string; branch: string; commit: string; created: boolean } | { ok: false; summary: string };
export const readCopyPathFor = (root: string, project: string): string => {
  if (!SAFE_KEY.test(project)) throw new Error("unsafe worktree name");
  return path.join(root, project, "_consulta");
};
export async function ensureReadCopy(input: { repo: string; root: string; project: string; base?: string }, git: GitFn = defaultGit): Promise<ReadCopy> {
  const start = input.base ?? ALLOWED_BASE;
  if (!checkBase(null, start, start).ok) return { ok: false, summary: `fail: base not allowed (${start.slice(0, 40)})` };
  let target: string;
  try {
    target = readCopyPathFor(input.root, input.project);
  } catch {
    return { ok: false, summary: "fail: bad worktree name" };
  }
  if (isInside(target, input.repo)) return { ok: false, summary: "fail: worktree inside the repo" };
  if (!existsSync(input.repo)) return { ok: false, summary: "fail: no repo" };
  const ref = `origin/${start}`;
  const fetched = await git(["fetch", "origin", start], input.repo);
  if (fetched.code !== 0) return { ok: false, summary: "fail: fetch origin/sandbox" };
  let created = false;
  if (existsSync(target)) {
    const moved = await git(["checkout", "--detach", "--force", ref], target);
    if (moved.code !== 0) return { ok: false, summary: "fail: read copy checkout" };
  } else {
    mkdirSync(path.dirname(target), { recursive: true });
    await git(["worktree", "prune"], input.repo);
    const added = await git(["worktree", "add", "--detach", target, ref], input.repo);
    if (added.code !== 0) return { ok: false, summary: "fail: worktree add" };
    created = true;
  }
  const head = await git(["rev-parse", "--short", "HEAD"], target);
  if (head.code !== 0) return { ok: false, summary: "fail: worktree unreadable" };
  return { ok: true, path: target, branch: start, commit: head.stdout.trim(), created };
}

export async function removeWorktree(input: { repo: string; path: string }, git: GitFn = defaultGit): Promise<boolean> {
  const out = await git(["worktree", "remove", input.path], input.repo);
  return out.code === 0;
}

// PLA-I60-2: git on one repo from several runs at once. Transient lock errors are retried; `git fetch` of a repo
// runs at most once a minute per process (worktrees are cut from origin/sandbox, which a minute does not change).
const LOCK_ERR = /index\.lock|cannot lock ref|Unable to create .*\.lock|another git process/i;
const lastFetch = new Map<string, number>();
export function carefulGit(git: GitFn, sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))): GitFn {
  return async (args, cwd) => {
    if (args[0] === "fetch") {
      const at = lastFetch.get(cwd);
      if (at && Date.now() - at < 60_000) return { code: 0, stdout: "", stderr: "" };
    }
    let out = await git(args, cwd);
    for (const wait of [500, 2_000, 5_000]) {
      if (out.code === 0 || !LOCK_ERR.test(out.stderr)) break;
      await sleep(wait);
      out = await git(args, cwd);
    }
    if (args[0] === "fetch" && out.code === 0) lastFetch.set(cwd, Date.now());
    return out;
  };
}
export const resetGitThrottleForTests = (): void => lastFetch.clear();
