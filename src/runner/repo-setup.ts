// PLA-I2-5: Plania prepares the product's repository from the screen (Ajustes, «Dónde está el código»), so a project
// with no code reaches a ready code item without a terminal. The owner chose: Plania creates the repository and the
// working branch when asked, never in a folder that already has content.
//
// createRepo runs the steps in order, each one skipped when it is already done, and stops at the first failure,
// leaving what was done and saying what is missing:
//   folder        make it when it does not exist; refuse a folder with files that is not a git repository
//   git           git init (only in an empty folder)
//   first_commit  one empty commit (no file: nothing of Plania's ever goes into the product repo, ADR 0002)
//   github        gh repo create with the owner's own gh login, private by default, as origin (only when asked)
//   push          the default branch to origin
//   start_branch  the working branch on origin, from the default branch (createStartBranch)
// createStartBranch is also the readiness list's action when origin lacks the working branch: one git fetch of the
// default branch and one git push of that commit to the new branch name. No file is added.
//
// checkGithubRepo is the GitHub choice's check (the folder choice has checkRepoFolder): the repository exists for
// this gh login, the login can write to it, and it holds the working branch.
// git, gh and the filesystem are injected.
import { execFile } from "node:child_process";
import { mkdirSync, readdirSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { expandHome, type GitFn, type GitResult } from "./worktree.js";

export type GhFn = (args: string[], cwd: string) => Promise<GitResult>;
export type SetupFs = {
  /** The entries of a folder; null when it does not exist; "file" when the path is a file. */
  list: (dir: string) => string[] | null | "file";
  mkdir: (dir: string) => void;
};
export type RepoSetupDeps = { git: GitFn; gh: GhFn; fs: SetupFs };

export type SetupStepId = "folder" | "git" | "first_commit" | "github" | "push" | "start_branch";
export const SETUP_STEPS: readonly SetupStepId[] = ["folder", "git", "first_commit", "github", "push", "start_branch"];
/** done: made now. already: it was there. failed: this step stopped the setup. pending: not reached. */
export type SetupStepState = "done" | "already" | "failed" | "pending";
export type SetupCode =
  | "REPO_FOLDER_NOT_EMPTY"
  | "REPO_GIT_FAILED"
  | "REPO_NO_IDENTITY"
  | "REPO_NO_ORIGIN"
  | "REPO_GITHUB_SIGNED_OUT"
  | "REPO_GITHUB_NO_GH"
  | "REPO_GITHUB_NOT_FOUND"
  | "REPO_GITHUB_NO_WRITE"
  | "REPO_GITHUB_FAILED"
  | "REPO_ORIGIN_UNREACHABLE"
  | "REPO_PUSH_FAILED";
export type SetupStep = { id: SetupStepId; state: SetupStepState; code: SetupCode | null };
export type SetupResult = { ok: boolean; path: string; github_repo: string | null; steps: SetupStep[]; failed: SetupCode | null };

export type CreateRepoInput = {
  folder: string;
  /** The working branch (startBranchOf). */
  start: string;
  /** Make the GitHub repository with the owner's gh login. null: only when origin already exists. */
  github: { name: string; private: boolean } | null;
  /** An existing GitHub repository (owner/name): an empty or missing folder is cloned from it instead of init. */
  clone?: string | null;
  /** Any git URL (the guide's SSH choice): cloned with git itself, ssh in batch mode, instead of gh. */
  clone_url?: string | null;
};

/** ssh that never waits for a prompt (passphrase, unknown host): it fails, and the failure says why. */
export const BATCH_SSH = "ssh -o BatchMode=yes";

const run = (cmd: string, extraEnv: NodeJS.ProcessEnv) => (args: string[], cwd: string) =>
  new Promise<GitResult>((resolve) => {
    execFile(cmd, args, { cwd, timeout: 120_000, env: { ...process.env, ...extraEnv } }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as { code?: unknown }).code === "number" ? (err as { code: number }).code : 127) : 0;
      resolve({ code, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
    });
  });

const defaultFs: SetupFs = {
  list: (dir) => {
    try {
      if (!statSync(dir).isDirectory()) return "file";
      return readdirSync(dir);
    } catch {
      return null;
    }
  },
  mkdir: (dir) => void mkdirSync(dir, { recursive: true }),
};

/** gh with its own login: no prompt, and no GH_TOKEN so a token file never decides who creates the repository. */
export const defaultRepoSetupDeps: RepoSetupDeps = {
  git: run("git", { GIT_TERMINAL_PROMPT: "0" }),
  gh: (args, cwd) => run("gh", { GH_PROMPT_DISABLED: "1", GH_TOKEN: "", GITHUB_TOKEN: "" })(args, cwd),
  fs: defaultFs,
};

const SIGNED_OUT = /not logged in|gh auth login|authentication|HTTP 401/i;
const NOT_FOUND = /could not resolve|not found|HTTP 404/i;
/** What a failed gh call means. code 127 (or none) is gh not installed. */
function ghFailure(r: GitResult): SetupCode {
  const text = `${r.stderr}\n${r.stdout}`;
  if (r.code === 127 || /ENOENT|command not found/i.test(text)) return "REPO_GITHUB_NO_GH";
  if (SIGNED_OUT.test(text)) return "REPO_GITHUB_SIGNED_OUT";
  if (NOT_FOUND.test(text)) return "REPO_GITHUB_NOT_FOUND";
  return "REPO_GITHUB_FAILED";
}

/** origin's default branch and its commit, from `git ls-remote --symref origin HEAD`. */
async function originDefault(git: GitFn, dir: string): Promise<{ branch: string; sha: string } | null> {
  const r = await git(["ls-remote", "--symref", "origin", "HEAD"], dir);
  if (r.code !== 0) return null;
  const branch = /^ref: refs\/heads\/(\S+)\s+HEAD$/m.exec(r.stdout)?.[1];
  const sha = /^([0-9a-f]{40})\s+HEAD$/m.exec(r.stdout)?.[1];
  return branch && sha ? { branch, sha } : null;
}

/**
 * Makes the working branch on origin from origin's default branch: one fetch, one push of that commit. Already there
 * is fine. No file is added and nothing local changes but the fetched objects.
 */
export async function createStartBranch(folder: string, start: string, git: GitFn): Promise<{ state: "done" | "already" | "failed"; code: SetupCode | null }> {
  const dir = path.resolve(expandHome(folder));
  const has = await git(["ls-remote", "--exit-code", "--heads", "origin", start], dir);
  if (has.code === 0) return { state: "already", code: null };
  if (has.code !== 2) return { state: "failed", code: "REPO_ORIGIN_UNREACHABLE" };
  const def = await originDefault(git, dir);
  if (!def) return { state: "failed", code: "REPO_ORIGIN_UNREACHABLE" };
  const fetched = await git(["fetch", "origin", def.branch], dir);
  if (fetched.code !== 0) return { state: "failed", code: "REPO_ORIGIN_UNREACHABLE" };
  const pushed = await git(["push", "origin", `${def.sha}:refs/heads/${start}`], dir);
  return pushed.code === 0 ? { state: "done", code: null } : { state: "failed", code: "REPO_PUSH_FAILED" };
}

// The same folder however it is spelled (a symlinked temp folder on macOS, a short name on Windows).
const realOf = (p: string): string => {
  try {
    return realpathSync.native(path.resolve(p));
  } catch {
    return path.resolve(p);
  }
};

export async function createRepo(input: CreateRepoInput, deps: RepoSetupDeps = defaultRepoSetupDeps): Promise<SetupResult> {
  const dir = path.resolve(expandHome(input.folder));
  const steps: SetupStep[] = SETUP_STEPS.map((id) => ({ id, state: "pending", code: null }));
  let githubRepo: string | null = null;
  const set = (id: SetupStepId, state: SetupStepState, code: SetupCode | null = null) => {
    const s = steps.find((x) => x.id === id)!;
    s.state = state;
    s.code = code;
  };
  const stop = (id: SetupStepId, code: SetupCode): SetupResult => {
    set(id, "failed", code);
    return { ok: false, path: dir, github_repo: githubRepo, steps, failed: code };
  };
  const git = (args: string[]) => deps.git(args, dir);
  const isRepo = async () => {
    const r = await git(["rev-parse", "--show-toplevel"]);
    // Only the folder itself: a folder inside another repository is not this project's repository.
    return r.code === 0 && realOf(r.stdout.trim()) === realOf(dir);
  };

  // folder: never touch one with content unless it already is this repository.
  const entries = deps.fs.list(dir);
  if (entries === "file") return stop("folder", "REPO_FOLDER_NOT_EMPTY");
  if (entries === null) {
    try {
      deps.fs.mkdir(dir);
    } catch {
      return stop("folder", "REPO_GIT_FAILED");
    }
    set("folder", "done");
  } else set("folder", "already");
  const repo = entries !== null && entries.includes(".git") && (await isRepo());
  if (entries !== null && entries.length > 0 && !repo) return stop("folder", "REPO_FOLDER_NOT_EMPTY");

  // git: an existing GitHub repository is cloned into the empty folder; otherwise git init.
  if (repo) set("git", "already");
  else if (input.clone_url) {
    const cloned = await deps.git(["-c", `core.sshCommand=${BATCH_SSH}`, "clone", "--", input.clone_url, dir], path.dirname(dir));
    if (cloned.code !== 0) return stop("git", "REPO_GIT_FAILED");
    set("git", "done");
  } else if (input.clone) {
    const cloned = await deps.gh(["repo", "clone", input.clone, dir], path.dirname(dir));
    if (cloned.code !== 0) return stop("git", ghFailure(cloned));
    set("git", "done");
  } else {
    const init = await git(["init", "--initial-branch=main"]);
    if (init.code !== 0) return stop("git", "REPO_GIT_FAILED");
    set("git", "done");
  }

  // first_commit: empty, so the repository holds no file of Plania's.
  if ((await git(["rev-parse", "--verify", "--quiet", "HEAD"])).code === 0) set("first_commit", "already");
  else {
    let made = await git(["commit", "--allow-empty", "-m", "First commit"]);
    if (made.code !== 0 && /tell me who you are|user\.email|user\.name/i.test(made.stderr)) {
      // No git identity on this machine: the owner's GitHub login signs it (its no-reply address).
      const who = await deps.gh(["api", "user", "--jq", '.id + " " + .login'], dir);
      const [id, login] = who.code === 0 ? who.stdout.trim().split(/\s+/) : [];
      if (!id || !login) return stop("first_commit", "REPO_NO_IDENTITY");
      made = await git(["-c", `user.name=${login}`, "-c", `user.email=${id}+${login}@users.noreply.github.com`, "commit", "--allow-empty", "-m", "First commit"]);
    }
    if (made.code !== 0) return stop("first_commit", "REPO_GIT_FAILED");
    set("first_commit", "done");
  }

  // github: origin as it is, or a new repository with the owner's gh login.
  const origin = await git(["remote", "get-url", "origin"]);
  if (origin.code === 0) set("github", "already");
  else if (!input.github) return stop("github", "REPO_NO_ORIGIN");
  else {
    const made = await deps.gh(["repo", "create", input.github.name, input.github.private ? "--private" : "--public", "--source", dir, "--remote", "origin"], dir);
    if (made.code !== 0) return stop("github", ghFailure(made));
    set("github", "done");
  }
  const view = await deps.gh(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"], dir);
  githubRepo = view.code === 0 && view.stdout.trim() ? view.stdout.trim() : null;

  // push: only into an empty origin (a repository just made, or one with no branch yet). An origin that already has
  // branches is left exactly as it is.
  const heads = await git(["ls-remote", "--heads", "origin"]);
  if (heads.code !== 0) return stop("push", "REPO_ORIGIN_UNREACHABLE");
  if (heads.stdout.trim()) set("push", "already");
  else {
    const pushed = await git(["push", "--set-upstream", "origin", "HEAD"]);
    if (pushed.code !== 0) return stop("push", "REPO_PUSH_FAILED");
    set("push", "done");
  }

  // start_branch
  const branch = await createStartBranch(dir, input.start, deps.git);
  if (branch.state === "failed") return stop("start_branch", branch.code!);
  set("start_branch", branch.state);
  return { ok: true, path: dir, github_repo: githubRepo, steps, failed: null };
}

/**
 * The working branch made on GitHub itself, for a project with a GitHub repository and no folder on this machine yet:
 * a ref at the default branch's commit (gh api). No file is added.
 */
export async function createStartBranchOnGithub(repo: string, start: string, gh: GhFn, cwd: string): Promise<{ state: "done" | "already" | "failed"; code: SetupCode | null }> {
  const has = await gh(["api", `repos/${repo}/branches/${encodeURIComponent(start)}`, "--jq", ".name"], cwd);
  if (has.code === 0) return { state: "already", code: null };
  if (!NOT_FOUND.test(`${has.stderr}${has.stdout}`)) return { state: "failed", code: ghFailure(has) };
  const def = await gh(["api", `repos/${repo}`, "--jq", ".default_branch"], cwd);
  if (def.code !== 0 || !def.stdout.trim()) return { state: "failed", code: ghFailure(def) };
  const sha = await gh(["api", `repos/${repo}/git/ref/heads/${encodeURIComponent(def.stdout.trim())}`, "--jq", ".object.sha"], cwd);
  if (sha.code !== 0 || !/^[0-9a-f]{40}$/.test(sha.stdout.trim())) return { state: "failed", code: ghFailure(sha) };
  const made = await gh(["api", "-X", "POST", `repos/${repo}/git/refs`, "-f", `ref=refs/heads/${start}`, "-f", `sha=${sha.stdout.trim()}`], cwd);
  return made.code === 0 ? { state: "done", code: null } : { state: "failed", code: ghFailure(made) };
}

// ---- the GitHub choice's check

export type GithubCheckCode = "REPO_GITHUB_SIGNED_OUT" | "REPO_GITHUB_NO_GH" | "REPO_GITHUB_NOT_FOUND" | "REPO_GITHUB_NO_WRITE" | "REPO_GITHUB_FAILED" | "REPO_NO_START_BRANCH";
export type GithubCheck = { ok: boolean; repo: string; branch: string; failed: GithubCheckCode | null };
const WRITE = new Set(["ADMIN", "MAINTAIN", "WRITE"]);

/** The repository exists for this gh login, the login can write to it, and it holds the working branch. */
export async function checkGithubRepo(repo: string, start: string, gh: GhFn, cwd: string): Promise<GithubCheck> {
  const out = (failed: GithubCheckCode | null): GithubCheck => ({ ok: !failed, repo, branch: start, failed });
  const view = await gh(["repo", "view", repo, "--json", "viewerPermission", "--jq", ".viewerPermission"], cwd);
  if (view.code !== 0) return out(ghFailure(view) as GithubCheckCode);
  if (!WRITE.has(view.stdout.trim().toUpperCase())) return out("REPO_GITHUB_NO_WRITE");
  const branch = await gh(["api", `repos/${repo}/branches/${encodeURIComponent(start)}`, "--jq", ".name"], cwd);
  if (branch.code !== 0) return out(NOT_FOUND.test(`${branch.stderr}${branch.stdout}`) ? "REPO_NO_START_BRANCH" : (ghFailure(branch) as GithubCheckCode));
  return out(null);
}
