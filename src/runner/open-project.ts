// PLA-180: the sheet «Agregar un proyecto» with code (POST /api/company/projects with origen, POST /api/company/carpeta), the way
// Claude's «Nuevo entorno» does it. «Sin código» stays on createProjectFromTemplate alone (no_code).
//   local  a folder already on this machine, chosen in the folder window (pickFolder) or typed. It is checked like the sheet
//          «Nuevo proyecto» checks one (checkRepoFolder: exists, git, origin, working branch on origin); its GitHub
//          repository is read from origin.
//   nube   a GitHub repository (owner/name, or its https or ssh address). The owner's gh login must reach it and
//          write to it (checkGithubRepo); it is cloned into <PLANIA_PROJECTS_ROOT>/<slug> (createRepo with clone).
//   ssh    any git repository by its SSH URL (git@host:owner/name.git, ssh://...), read and cloned by git with the
//          owner's own SSH keys, no gh (checkSshRepo, then createRepo with clone_url). ssh runs in batch mode, so a
//          key with no agent or an unknown host fails with a code instead of waiting for a prompt.
// Every way the project is then made by createProjectFromTemplate (NEWPROJ-1): paused, its team, plan approval on.
// PLA-180 (the PLA-I2-5 rule): a repository without the working branch is refused with REPO_NO_START_BRANCH until the owner says
// crear_rama, because making it is one push to his repository. Nothing of Plania's is written into the product
// repository (ADR 0002). git, gh, the filesystem and osascript are injected.
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { projects } from "../db/schema.js";
import { githubRepoDe, sshUrlDe } from "../../ui/src/lib/nuevo-proyecto.js";
import { createProjectFromTemplate, slugOf, type NewProject, type NewProjectError } from "./new-project.js";
import { checkRepoFolder, defaultRepoCheckDeps, repoPathShapeOk, type RepoCheckDeps } from "./repo-check.js";
import { BATCH_SSH, checkGithubRepo, createRepo, createStartBranch, defaultRepoSetupDeps, type RepoSetupDeps } from "./repo-setup.js";
import { DEFAULT_START_BRANCH } from "./start-branch.js";
import { expandHome, repoPathOf, type GitResult } from "./worktree.js";

export type AbrirBody =
  | { origen: "local"; name: string; goal?: string; repo_path: string; crear_rama?: boolean }
  | { origen: "nube" | "ssh"; name: string; goal?: string; repo: string; crear_rama?: boolean };

export type OpenProjectDeps = { check: RepoCheckDeps; setup: RepoSetupDeps; env?: NodeJS.ProcessEnv };
export const defaultOpenProjectDeps: OpenProjectDeps = { check: defaultRepoCheckDeps, setup: defaultRepoSetupDeps };

export type OpenProjectError = Omit<NewProjectError, "error" | "field"> & { error: string; field?: string; origen?: string };

export type SshCheckCode = "REPO_SSH_DENIED" | "REPO_SSH_HOST_UNKNOWN" | "REPO_SSH_NOT_FOUND" | "REPO_ORIGIN_UNREACHABLE" | "REPO_NO_START_BRANCH";

/** What a failed git call over SSH means. */
export function sshFailure(r: GitResult): Exclude<SshCheckCode, "REPO_NO_START_BRANCH"> {
  const text = `${r.stderr}\n${r.stdout}`;
  if (/Host key verification failed|No .*host key is known/i.test(text)) return "REPO_SSH_HOST_UNKNOWN";
  if (/Permission denied \(publickey|publickey\)|no such identity|agent refused/i.test(text)) return "REPO_SSH_DENIED";
  if (/Repository not found|does not appear to be a git repository|not found|does not exist/i.test(text)) return "REPO_SSH_NOT_FOUND";
  return "REPO_ORIGIN_UNREACHABLE";
}

/** The repository answers over SSH with these keys, and holds the working branch. One git ls-remote, nothing written. */
export async function checkSshRepo(url: string, start: string, git: RepoSetupDeps["git"], cwd: string): Promise<SshCheckCode | null> {
  const r = await git(["-c", `core.sshCommand=${BATCH_SSH}`, "ls-remote", "--heads", "--", url], cwd);
  if (r.code !== 0) return sshFailure(r);
  return r.stdout.split("\n").some((l) => l.trim().endsWith(`refs/heads/${start}`)) ? null : "REPO_NO_START_BRANCH";
}

export async function openExistingProject(db: Db, input: AbrirBody, deps: OpenProjectDeps = defaultOpenProjectDeps): Promise<NewProject | OpenProjectError> {
  const name = input.name.trim();
  const slug = slugOf(name);
  if (!name || !slug) return { error: "INVALID_BODY", status: 400, field: "name" };
  // Before any push or clone: a name that is taken stops here, not after the repository was touched.
  const [taken] = await db.select({ id: projects.id }).from(projects).where(eq(projects.slug, slug)).limit(1);
  if (taken) return { error: "PROJECT_EXISTS", status: 409, slug };
  const start = DEFAULT_START_BRANCH;
  const goal = input.goal?.trim() || undefined;

  if (input.origen === "local") {
    const folder = input.repo_path.trim();
    if (!repoPathShapeOk(folder)) return { error: "INVALID_BODY", status: 400, field: "repo_path" };
    const dir = path.resolve(expandHome(folder));
    let check = await checkRepoFolder(folder, deps.check, start);
    if (check.failed === "REPO_NO_START_BRANCH" && input.crear_rama) {
      const made = await createStartBranch(dir, start, deps.check.git);
      if (made.state === "failed") return { error: made.code!, status: 400, field: "setup", path: dir };
      check = await checkRepoFolder(folder, deps.check, start);
    }
    if (check.failed) return { error: check.failed, status: 400, field: "repo_path", path: check.path, branch: check.branch, checks: check.checks };
    const origin = await deps.check.git(["remote", "get-url", "origin"], dir);
    const githubRepo = origin.code === 0 ? githubRepoDe(origin.stdout) : null;
    return createProjectFromTemplate(db, { name, goal, repo_path: dir, ...(githubRepo ? { github_repo: githubRepo } : {}) }, { releaseFromScreen: true });
  }

  // The folder each clone goes to; a missing or empty one only (createRepo never writes over files).
  const folder = repoPathOf(slug, null, deps.env);

  if (input.origen === "ssh") {
    const url = sshUrlDe(input.repo);
    if (!url) return { error: "INVALID_BODY", status: 400, field: "repo", origen: "ssh" };
    const failed = await checkSshRepo(url, start, deps.setup.git, os.homedir());
    if (failed && !(failed === "REPO_NO_START_BRANCH" && input.crear_rama)) return { error: failed, status: 400, field: "ssh", branch: start };
    const setup = await createRepo({ folder, start, github: null, clone_url: url }, deps.setup);
    if (!setup.ok) return { error: setup.failed!, status: 400, field: "setup", path: setup.path };
    const githubRepo = setup.github_repo ?? githubRepoDe(url);
    return createProjectFromTemplate(db, { name, goal, repo_path: setup.path, ...(githubRepo ? { github_repo: githubRepo } : {}) }, { releaseFromScreen: true });
  }

  const repo = githubRepoDe(input.repo);
  if (!repo) return { error: "INVALID_BODY", status: 400, field: "repo" };
  const gh = await checkGithubRepo(repo, start, deps.setup.gh, os.homedir());
  if (gh.failed && !(gh.failed === "REPO_NO_START_BRANCH" && input.crear_rama)) return { error: gh.failed, status: 400, field: "github_repo", branch: start };
  // createRepo clones into the empty (or missing) folder and, when asked here, makes the working branch from main.
  const setup = await createRepo({ folder, start, github: null, clone: repo }, deps.setup);
  if (!setup.ok) return { error: setup.failed!, status: 400, field: "setup", path: setup.path };
  return createProjectFromTemplate(db, { name, goal, repo_path: setup.path, github_repo: setup.github_repo ?? repo }, { releaseFromScreen: true });
}

// ---- the folder window

// The machine's own window to choose a folder: Finder on macOS, the Windows folder window (PowerShell), zenity or
// kdialog on Linux. Each answers the chosen path on stdout; an empty answer or the tool's cancel code is Cancel.
export type PickRun = (cmd: string, args: string[], env?: NodeJS.ProcessEnv) => Promise<GitResult>;
export type PickFolderDeps = { platform: NodeJS.Platform; run: PickRun; env: NodeJS.ProcessEnv };

// Ten minutes to choose; then the window is left and the sheet falls back to typing.
const runPicker: PickRun = (cmd, args, env) =>
  new Promise((resolve) => {
    execFile(cmd, args, { timeout: 600_000, env: { ...process.env, ...env }, windowsHide: false }, (err, stdout, stderr) => {
      const raw = err ? (err as { code?: unknown }).code : 0;
      // ENOENT (the tool is not installed) and a timeout read as «no window here».
      const code = typeof raw === "number" ? raw : 127;
      resolve({ code, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
    });
  });

export const defaultPickFolderDeps: PickFolderDeps = { platform: process.platform, run: runPicker, env: process.env };

/** An AppleScript string literal: backslashes and quotes escaped. */
const quoted = (s: string): string => `"${s.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"`;

// Windows: the folder window on top of every other window. The title comes in through the environment, never pasted
// into the script.
const WINDOWS_SCRIPT = [
  "Add-Type -AssemblyName System.Windows.Forms",
  "$owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true }",
  "$d = New-Object System.Windows.Forms.FolderBrowserDialog",
  "$d.Description = $env:PLANIA_PICK_TITLE",
  "$d.ShowNewFolderButton = $false",
  "if ($d.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($d.SelectedPath) }",
].join("; ");

type Picked = { available: boolean; path: string | null };
const cleanPath = (out: string, sep: "/" | "\\"): string => {
  const t = out.trim();
  if (sep === "/") return t.replace(/\/+$/, "") || "/";
  return /^[A-Za-z]:\\$/.test(t) ? t : t.replace(/\\+$/, "");
};

/**
 * The folder window on this machine. path: the folder chosen, or null on Cancel. available false: no window can be
 * shown here (a service with no screen, Linux with neither zenity nor kdialog); the sheet asks to type the path.
 */
export async function pickFolder(title: string, deps: PickFolderDeps = defaultPickFolderDeps): Promise<Picked> {
  if (deps.platform === "darwin") {
    const r = await deps.run("osascript", ["-e", `activate\nPOSIX path of (choose folder with prompt ${quoted(title)})`]);
    // -128 is «User canceled».
    if (r.code !== 0) return /-128/.test(r.stderr) ? { available: true, path: null } : { available: false, path: null };
    return { available: true, path: cleanPath(r.stdout, "/") };
  }
  if (deps.platform === "win32") {
    const r = await deps.run("powershell.exe", ["-NoProfile", "-NonInteractive", "-STA", "-Command", WINDOWS_SCRIPT], { PLANIA_PICK_TITLE: title });
    if (r.code !== 0) return { available: false, path: null };
    const out = r.stdout.trim();
    return { available: true, path: out ? cleanPath(out, "\\") : null };
  }
  if (deps.platform === "linux" || deps.platform === "freebsd" || deps.platform === "openbsd") {
    if (!deps.env.DISPLAY && !deps.env.WAYLAND_DISPLAY) return { available: false, path: null };
    const tools: Array<[string, string[]]> = [
      ["zenity", ["--file-selection", "--directory", `--title=${title}`]],
      ["kdialog", ["--getexistingdirectory", deps.env.HOME || "/", "--title", title]],
    ];
    for (const [cmd, args] of tools) {
      const r = await deps.run(cmd, args);
      if (r.code === 127) continue; // not installed: the next tool
      // Both answer 1 on Cancel.
      if (r.code === 1 && !r.stdout.trim()) return { available: true, path: null };
      if (r.code !== 0) return { available: false, path: null };
      return { available: true, path: cleanPath(r.stdout, "/") };
    }
    return { available: false, path: null };
  }
  return { available: false, path: null };
}
