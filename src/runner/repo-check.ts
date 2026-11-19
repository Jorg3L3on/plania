// NEWPROJ-3: is a folder ready to be a project's repo? The runner cuts every ticket's worktree from
// origin/<start branch> of settings.local.repo_path (ensureWorktree in ./worktree.ts), so a folder is ready when
// it exists, is a git repo, has a remote `origin`, and `origin` holds the start branch. Git and the filesystem
// are injected: the sheet «Nuevo proyecto» checks before creating anything, and a later readiness list reuses it.
// Every check is reported (ok, failed, or skipped because an earlier one failed), not only the first failure.
import { execFile } from "node:child_process";
import { statSync } from "node:fs";
import path from "node:path";
import { defaultRepoSetupDeps, type GhFn } from "./repo-setup.js";
import { ALLOWED_BASE, expandHome, type GitFn } from "./worktree.js";

export type RepoCheckKey = "exists" | "git" | "origin" | "start_branch";
// One code per way a folder can fail; each is in src/mcp/errors.ts and has a sentence in ui/src/lib/nuevo-proyecto.ts.
export type RepoCheckCode = "REPO_FOLDER_MISSING" | "REPO_NOT_GIT" | "REPO_NO_ORIGIN" | "REPO_ORIGIN_UNREACHABLE" | "REPO_NO_START_BRANCH";
export type RepoCheckItem = { key: RepoCheckKey; state: "ok" | "failed" | "skipped"; code: RepoCheckCode | null };
export type RepoCheck = { ok: boolean; path: string; branch: string; checks: RepoCheckItem[]; failed: RepoCheckCode | null };

// PLA-I2-5: gh runs the GitHub choice's check (checkGithubRepo in ./repo-setup.ts). Absent, that check is skipped.
export type RepoCheckDeps = { git: GitFn; isDir: (p: string) => boolean; gh?: GhFn };

// No prompt for credentials and a short timeout: the sheet waits on this.
const checkGit: GitFn = (args, cwd) =>
  new Promise((resolve) => {
    execFile("git", args, { cwd, timeout: 20_000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as { code?: unknown }).code === "number" ? (err as { code: number }).code : 1) : 0;
      resolve({ code, stdout: String(stdout), stderr: String(stderr) });
    });
  });

const isDir = (p: string): boolean => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};

export const defaultRepoCheckDeps: RepoCheckDeps = { git: checkGit, isDir, gh: defaultRepoSetupDeps.gh };

export async function checkRepoFolder(folder: string, deps: RepoCheckDeps = defaultRepoCheckDeps, branch: string = ALLOWED_BASE): Promise<RepoCheck> {
  const dir = path.resolve(expandHome(folder));
  const checks: RepoCheckItem[] = [];
  let failed: RepoCheckCode | null = null;
  const step = async (key: RepoCheckKey, run: () => Promise<RepoCheckCode | null>) => {
    if (failed) return void checks.push({ key, state: "skipped", code: null });
    const code = await run();
    if (code) failed = code;
    checks.push({ key, state: code ? "failed" : "ok", code });
  };
  await step("exists", async () => (deps.isDir(dir) ? null : "REPO_FOLDER_MISSING"));
  await step("git", async () => {
    const r = await deps.git(["rev-parse", "--is-inside-work-tree"], dir);
    return r.code === 0 && r.stdout.trim() === "true" ? null : "REPO_NOT_GIT";
  });
  await step("origin", async () => ((await deps.git(["remote", "get-url", "origin"], dir)).code === 0 ? null : "REPO_NO_ORIGIN"));
  // ls-remote --exit-code answers 2 when origin has no such branch; any other failure is origin out of reach.
  await step("start_branch", async () => {
    const r = await deps.git(["ls-remote", "--exit-code", "--heads", "origin", branch], dir);
    return r.code === 0 ? null : r.code === 2 ? "REPO_NO_START_BRANCH" : "REPO_ORIGIN_UNREACHABLE";
  });
  return { ok: !failed, path: dir, branch, checks, failed };
}

// NEWPROJ-3: shapes only. A GitHub repo is `owner/name` (GitHub is never called); a folder is an absolute path
// or one under ~, at most 500 characters.
export const GITHUB_REPO = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;
export const repoPathShapeOk = (p: string): boolean => p.length > 0 && p.length <= 500 && !p.includes("\0") && (p.startsWith("~/") || path.isAbsolute(p));

// settings.local as set_project takes it: { repo_path?, no_code? }, never both.
export type LocalSettings = { repo_path?: string; no_code?: boolean };
export function parseLocalSettings(v: unknown): { ok: true; settings: LocalSettings } | { ok: false; field: string; hint: string } {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return { ok: false, field: "settings.local", hint: "an object {repo_path?, no_code?}" };
  const o = v as Record<string, unknown>;
  for (const k of Object.keys(o)) if (k !== "repo_path" && k !== "no_code") return { ok: false, field: `settings.local.${k}`, hint: "only repo_path and no_code" };
  const out: LocalSettings = {};
  if (o.repo_path !== undefined) {
    if (typeof o.repo_path !== "string" || !repoPathShapeOk(o.repo_path.trim())) return { ok: false, field: "settings.local.repo_path", hint: "an absolute path (or ~/...), at most 500 characters" };
    out.repo_path = o.repo_path.trim();
  }
  if (o.no_code !== undefined) {
    if (typeof o.no_code !== "boolean") return { ok: false, field: "settings.local.no_code", hint: "true or false" };
    if (o.no_code) out.no_code = true;
  }
  if (out.repo_path && out.no_code) return { ok: false, field: "settings.local.no_code", hint: "a project with a folder has code; drop no_code or repo_path" };
  return { ok: true, settings: out };
}
