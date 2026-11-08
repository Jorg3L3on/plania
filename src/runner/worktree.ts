// PLA-I29-4: one worktree per ticket, outside every repo, cut from origin/sandbox.
// Never `claude -w`: it writes into <repo>/.claude/worktrees, which breaks the no-repo rule.
// PLA-I29-5: the runner refuses main as the branch and any base other than sandbox.
import { execFile } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export const ALLOWED_BASE = "sandbox";
const PROTECTED = new Set(["main", "master", "production", "prod"]);

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
  path.resolve(expandHome(env.PLANIA_WORKTREES_ROOT || path.join(homedir(), "Developer", ".plania-worktrees")));

export const projectsRoot = (env: NodeJS.ProcessEnv = process.env): string =>
  path.resolve(expandHome(env.PLANIA_PROJECTS_ROOT || path.join(homedir(), "Developer", "Projects")));

export const repoPathOf = (slug: string, settings: { local?: { repo_path?: string } } | null, env: NodeJS.ProcessEnv = process.env): string =>
  path.resolve(expandHome(settings?.local?.repo_path || path.join(projectsRoot(env), slug)));

const SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;

export const branchFor = (key: string): string => `jl/${key.toLowerCase()}`;

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

export function checkBase(branch: string | null, base: string | null): BaseCheck {
  const b = (branch ?? "").trim();
  const from = (base ?? ALLOWED_BASE).trim() || ALLOWED_BASE;
  if (b && PROTECTED.has(b.replace(/^origin\//, ""))) return { ok: false, summary: "fail: base not allowed (branch main)" };
  if (from !== ALLOWED_BASE) return { ok: false, summary: `fail: base not allowed (${from.slice(0, 40)})` };
  return { ok: true };
}

export type WorktreeOutcome = { ok: true; path: string; branch: string; created: boolean } | { ok: false; summary: string };

// Creates (or reuses) <root>/<project>/<KEY> on its branch from origin/sandbox.
export async function ensureWorktree(
  input: { repo: string; root: string; project: string; key: string; branch: string },
  git: GitFn = defaultGit,
): Promise<WorktreeOutcome> {
  const base = checkBase(input.branch, ALLOWED_BASE);
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
    const check = checkBase(current, ALLOWED_BASE);
    if (!check.ok) return check;
    return { ok: true, path: target, branch: current, created: false };
  }

  const fetched = await git(["fetch", "origin", ALLOWED_BASE], input.repo);
  if (fetched.code !== 0) return { ok: false, summary: "fail: fetch origin/sandbox" };
  mkdirSync(path.dirname(target), { recursive: true });
  const exists = (await git(["rev-parse", "--verify", "--quiet", `refs/heads/${input.branch}`], input.repo)).code === 0;
  const args = exists
    ? ["worktree", "add", target, input.branch]
    : ["worktree", "add", "--no-track", target, "-b", input.branch, `origin/${ALLOWED_BASE}`];
  const added = await git(args, input.repo);
  if (added.code !== 0) return { ok: false, summary: "fail: worktree add" };
  const head = await git(["rev-parse", "--abbrev-ref", "HEAD"], target);
  const check = checkBase(head.stdout.trim(), ALLOWED_BASE);
  if (!check.ok) return check;
  return { ok: true, path: target, branch: input.branch, created: true };
}

export async function removeWorktree(input: { repo: string; path: string }, git: GitFn = defaultGit): Promise<boolean> {
  const out = await git(["worktree", "remove", input.path], input.repo);
  return out.code === 0;
}
