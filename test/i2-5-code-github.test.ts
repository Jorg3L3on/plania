// PLA-I2-5: Plania prepares the product's repository from the screen; the working branch is a project setting; the
// server's merges use gh's own login on an install made by first start. Throwaway DB. gh is always a fake; git is a
// fake where the steps' order matters and real git on throwaway folders (a local bare repository as origin, no
// network, no global git config) where the repository's content is the point.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
process.env.PLANIA_EVENT_WAKES = "1";
delete process.env.PLANIA_GH_FALLBACK;
const { makeDb } = await import("../src/db/client.js");
const { app } = await import("../src/app.js");
const { createMcpServer } = await import("../src/mcp/register.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const { seedOrg } = await import("../scripts/seed-org.js");
const { releaseGh, runReleaseGh } = await import("../src/mcp/release-ship.js");
const writes = await import("../src/mcp/writes.js");
const { setProject } = await import("../src/mcp/project.js");
const { loadInstallState, resetInstallState, ghLoginOn } = await import("../src/install-state.js");
const { githubToken, resetGithubAuthCache } = await import("../src/jobs/github.js");
const { createRepo, createStartBranch, checkGithubRepo, SETUP_STEPS } = await import("../src/runner/repo-setup.js");
const { preparar, crearRama, setRepoSetupDeps } = await import("../src/api/repo-setup.js");
const { projectReadiness } = await import("../src/runner/readiness.js");
const { checkRepoFolder } = await import("../src/runner/repo-check.js");
const { startBranchOf, startBranchProblem, DEFAULT_START_BRANCH } = await import("../src/runner/start-branch.js");
const { checkBase, ensureWorktree, ensureReadCopy } = await import("../src/runner/worktree.js");
const { createProjectFromTemplate } = await import("../src/runner/new-project.js");
const listo = await import("../ui/src/lib/listo.js");
const { acciones, porQue, resumen, ramaDicho, PASO } = await import("../ui/src/lib/preparar-codigo.js");
const { nuevoProyectoError } = await import("../ui/src/lib/nuevo-proyecto.js");
const { ajustesError } = await import("../ui/src/lib/ajustes.js");

type GitResult = { code: number; stdout: string; stderr: string };
type Db = ReturnType<typeof makeDb>["db"];
let raw: pg.Client;
let db: Db;
let closeDb: () => Promise<void>;
let client: Client;
let thread: string;
const realGh = releaseGh.run;
const scratch = realpathSync.native(mkdtempSync(path.join(tmpdir(), "plania-i2-5-")));
const ACT = { actor: { agent: "test", session_id: "s" } } as never;
const HUMAN = { actor: { agent: "screen", session_id: "screen" }, human: true } as never;

// ---- real git on throwaway folders: no global or system config (no hooks, no signing), a fixed identity.
const emptyConfig = path.join(scratch, "gitconfig");
writeFileSync(emptyConfig, "");
const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: emptyConfig, GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0", GIT_AUTHOR_NAME: "Someone", GIT_AUTHOR_EMAIL: "someone@example.test", GIT_COMMITTER_NAME: "Someone", GIT_COMMITTER_EMAIL: "someone@example.test" };
const realGit = (args: string[], cwd: string) =>
  new Promise<GitResult>((resolve) => {
    execFile("git", args, { cwd, env: GIT_ENV }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as { code?: unknown }).code === "number" ? (err as { code: number }).code : 1) : 0;
      resolve({ code, stdout: String(stdout), stderr: String(stderr) });
    });
  });
const isDir = (p: string) => {
  try {
    readdirSync(p);
    return true;
  } catch {
    return false;
  }
};
const realFs = {
  list: (d: string) => {
    try {
      return readdirSync(d);
    } catch {
      return null;
    }
  },
  mkdir: (d: string) => void mkdirSync(d, { recursive: true }),
};
/** A bare repository standing in for GitHub. */
async function bareOrigin(name: string): Promise<string> {
  const dir = path.join(scratch, "github", `${name}.git`);
  mkdirSync(dir, { recursive: true });
  assert.equal((await realGit(["init", "--bare", "--initial-branch=main"], dir)).code, 0);
  return dir;
}
/** A fake gh: `repo create` makes a bare repository and adds it as origin; `repo view` names it. */
function fakeGh(calls: string[][]) {
  return async (args: string[], cwd: string): Promise<GitResult> => {
    calls.push(args);
    if (args[0] === "repo" && args[1] === "create") {
      const bare = await bareOrigin(args[2]!);
      const src = args[args.indexOf("--source") + 1]!;
      await realGit(["remote", "add", "origin", bare], src);
      return { code: 0, stdout: `https://github.com/someone/${args[2]}\n`, stderr: "" };
    }
    if (args[0] === "repo" && args[1] === "view") {
      const url = (await realGit(["remote", "get-url", "origin"], cwd)).stdout.trim();
      return { code: 0, stdout: `someone/${path.basename(url, ".git")}\n`, stderr: "" };
    }
    return { code: 1, stdout: "", stderr: "unexpected gh call" };
  };
}
const readinessDeps = { env: { PLANIA_RUNNER_TOKEN: "t", HOME: scratch } as NodeJS.ProcessEnv, repoCheck: { git: realGit, isDir }, exists: () => true, githubAccess: async () => "ok" as const };
const codeItem = async (slug: string) => (await projectReadiness(db, slug, readinessDeps)).items.find((i) => i.id === "code")!;
const version = async (slug: string) => Number((await raw.query(`select version from projects where slug = $1`, [slug])).rows[0].version);

const jorge = () => ({ Cookie: `${SESSION_COOKIE}=${createSession()}`, "Content-Type": "application/json" });

before(async () => {
  raw = await resetTestDb();
  ({ db, close: closeDb } = makeDb());
  await seedOrg(db);
  await raw.query(`update projects set runs_paused = false where slug = 'micasa'`);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createMcpServer(db).connect(serverSide);
  client = new Client({ name: "i2-5", version: "0" });
  await client.connect(clientSide);
  thread = ((await (await app.request("/api/threads/micasa", { headers: jorge() })).json()) as { id: string }).id;
});

after(async () => {
  releaseGh.run = realGh;
  setRepoSetupDeps(null);
  resetInstallState();
  await client?.close();
  await closeDb?.();
  await raw?.end();
  rmSync(scratch, { recursive: true, force: true });
});

// ---- #1, #3: a project with no code reaches a ready code item from the screen

test("I2-5 #1 #3: a project with no code gets its folder, repository and working branch from Ajustes; the code item turns ready; the repo holds no file", async () => {
  const made = await createProjectFromTemplate(db, { name: "Recetario", goal: "Guardar recetas.", no_code: true }, { requirePromptDoc: false, ctx: ACT });
  assert.ok(!("error" in made), JSON.stringify(made));
  assert.equal((await codeItem("recetario")).state, "not_needed");

  const folder = path.join(scratch, "projects", "recetario");
  const calls: string[][] = [];
  setRepoSetupDeps({ git: realGit, gh: fakeGh(calls), fs: realFs });
  // Through the screen's route, with the screen's cookie.
  const res = await app.request("/api/company/projects/recetario/settings/code/preparar", {
    method: "POST",
    headers: jorge(),
    body: JSON.stringify({ version: await version("recetario"), repo_path: folder, github: { name: "recetario" } }),
  });
  assert.equal(res.status, 200, await res.clone().text());
  const out = (await res.json()) as { setup: { ok: boolean; steps: { id: string; state: string }[]; github_repo: string }; saved: boolean; settings: { code: { repo_path: string; github_repo: string; no_code: boolean } } };
  assert.equal(out.setup.ok, true, JSON.stringify(out.setup));
  assert.deepEqual(out.setup.steps.map((s) => [s.id, s.state]), SETUP_STEPS.map((id) => [id, "done"]));
  assert.deepEqual(out.settings.code, { repo_path: folder, github_repo: "someone/recetario", no_code: false });
  // gh: private by default, the owner's own login (the fake saw the call), the project's slug as the name.
  const create = calls.find((a) => a[1] === "create")!;
  assert.deepEqual(create.slice(0, 4), ["repo", "create", "recetario", "--private"]);

  const code = await codeItem("recetario");
  assert.equal(code.state, "ready", JSON.stringify(code));
  assert.equal(code.branch, DEFAULT_START_BRANCH);
  assert.match(listo.listoLinea(code).texto, /está lista/);

  // #3: nothing of Plania's in the product repository: the folder holds only .git, and origin's working branch is
  // one empty commit.
  assert.deepEqual(readdirSync(folder), [".git"]);
  const origin = path.join(scratch, "github", "recetario.git");
  assert.equal((await realGit(["ls-tree", "-r", "--name-only", DEFAULT_START_BRANCH], origin)).stdout, "");
  assert.equal((await realGit(["rev-list", "--count", DEFAULT_START_BRANCH], origin)).stdout.trim(), "1");
  assert.equal((await realGit(["rev-parse", "main"], origin)).stdout, (await realGit(["rev-parse", DEFAULT_START_BRANCH], origin)).stdout);

  // A second press changes nothing: every step was already there.
  const again = await preparar("recetario", { version: await version("recetario"), repo_path: folder, github: { name: "recetario" } });
  assert.ok(!("error" in again));
  assert.deepEqual(again.setup.steps.map((s) => s.state), SETUP_STEPS.map(() => "already"));
  assert.equal(calls.filter((a) => a[1] === "create").length, 1);
});

test("I2-5 #1: a step that fails keeps what was done and says what is missing", async () => {
  const folder = path.join(scratch, "projects", "despensa");
  const calls: string[][] = [];
  const signedOut = async (args: string[]): Promise<GitResult> => {
    calls.push(args);
    return { code: 1, stdout: "", stderr: "To get started with GitHub CLI, please run:  gh auth login" };
  };
  const out = await createRepo({ folder, start: DEFAULT_START_BRANCH, github: { name: "despensa", private: true } }, { git: realGit, gh: signedOut, fs: realFs });
  assert.equal(out.ok, false);
  assert.equal(out.failed, "REPO_GITHUB_SIGNED_OUT");
  assert.deepEqual(out.steps.map((s) => [s.id, s.state]), [["folder", "done"], ["git", "done"], ["first_commit", "done"], ["github", "failed"], ["push", "pending"], ["start_branch", "pending"]]);
  assert.deepEqual(readdirSync(folder), [".git"], "what was done stays");
  assert.match(resumen(out), /^Lo que se hizo se queda\. Falta el repositorio en github: GitHub no tiene la sesión iniciada/);
  // No git identity on the machine: the owner's GitHub login signs the empty commit.
  const fake: string[][] = [];
  const noIdentity = async (args: string[]) => {
    fake.push(args);
    if (args[0] === "rev-parse" && args[1] === "--show-toplevel") return { code: 128, stdout: "", stderr: "" };
    if (args[0] === "rev-parse") return { code: 1, stdout: "", stderr: "" };
    if (args[0] === "commit") return { code: 128, stdout: "", stderr: "Author identity unknown\n*** Please tell me who you are." };
    if (args[0] === "remote") return { code: 2, stdout: "", stderr: "" };
    return { code: 0, stdout: "", stderr: "" };
  };
  const who = async (args: string[]) => (args[1] === "user" ? { code: 0, stdout: "42 someone\n", stderr: "" } : { code: 1, stdout: "", stderr: "" });
  const r = await createRepo({ folder: path.join(scratch, "projects", "sin-nombre"), start: "sandbox", github: null }, { git: noIdentity, gh: who, fs: realFs });
  assert.deepEqual(fake.find((a) => a[0] === "-c"), ["-c", "user.name=someone", "-c", "user.email=42+someone@users.noreply.github.com", "commit", "--allow-empty", "-m", "First commit"]);
  assert.equal(r.failed, "REPO_NO_ORIGIN", "no GitHub asked and no origin: the code still lacks its repository");
});

// ---- #2: a folder with content is never initialised or overwritten

test("I2-5 #2: a folder with files that is not the repository is never initialised or written to", async () => {
  const folder = path.join(scratch, "projects", "con-archivos");
  mkdirSync(folder, { recursive: true });
  writeFileSync(path.join(folder, "notas.txt"), "mías");
  const gitCalls: string[][] = [];
  const ghCalls: string[][] = [];
  const spyGit = async (args: string[], cwd: string) => (gitCalls.push(args), realGit(args, cwd));
  const out = await createRepo({ folder, start: "sandbox", github: { name: "x", private: true } }, { git: spyGit, gh: fakeGh(ghCalls), fs: realFs });
  assert.equal(out.failed, "REPO_FOLDER_NOT_EMPTY");
  assert.deepEqual(out.steps.map((s) => s.state), ["failed", "pending", "pending", "pending", "pending", "pending"]);
  assert.deepEqual(readdirSync(folder), ["notas.txt"]);
  assert.equal(gitCalls.some((a) => ["init", "commit", "push", "remote"].includes(a[0]!)), false, gitCalls.map((a) => a[0]).join(","));
  assert.equal(ghCalls.length, 0);
  // A path that is a file is refused the same way; so is a folder inside another repository.
  const file = path.join(folder, "notas.txt");
  assert.equal((await createRepo({ folder: file, start: "sandbox", github: null }, { git: spyGit, gh: fakeGh(ghCalls), fs: { ...realFs, list: () => "file" } })).failed, "REPO_FOLDER_NOT_EMPTY");
  const outer = path.join(scratch, "projects", "exterior");
  mkdirSync(path.join(outer, "dentro"), { recursive: true });
  await realGit(["init"], outer);
  writeFileSync(path.join(outer, "dentro", "a.txt"), "x");
  assert.equal((await createRepo({ folder: path.join(outer, "dentro"), start: "sandbox", github: null }, { git: realGit, gh: fakeGh(ghCalls), fs: realFs })).failed, "REPO_FOLDER_NOT_EMPTY");
  // The screen says so in words, without a terminal step.
  assert.match(porQue("REPO_FOLDER_NOT_EMPTY"), /Plania no la toca/);
});

// ---- #5: origin without the working branch gets it from the screen

test("I2-5 #5: a repository whose origin lacks the working branch gets it from the screen and the code item turns ready", async () => {
  const origin = await bareOrigin("workia");
  const folder = path.join(scratch, "projects", "workia");
  assert.equal((await realGit(["clone", origin, folder], scratch)).code, 0);
  await realGit(["commit", "--allow-empty", "-m", "app"], folder);
  await realGit(["push", "origin", "HEAD:main"], folder);
  await setProject(db, { project: "workia", version: await version("workia"), settings: { local: { repo_path: folder } } }, HUMAN);
  const before = await codeItem("workia");
  assert.deepEqual([before.state, before.why], ["missing", "REPO_NO_START_BRANCH"]);
  assert.deepEqual(acciones(before, { no_code: false }), { preparar: false, rama: true });
  assert.match(listo.listoLinea(before).texto, /«Crear la rama de trabajo»/);

  const gitCalls: string[][] = [];
  setRepoSetupDeps({ git: async (a, c) => (gitCalls.push(a), realGit(a, c)), gh: fakeGh([]), fs: realFs });
  const res = await app.request("/api/company/projects/workia/settings/code/rama", { method: "POST", headers: jorge(), body: "{}" });
  assert.equal(res.status, 200, await res.clone().text());
  const out = (await res.json()) as { state: string; via: string };
  assert.deepEqual([out.state, out.via], ["done", "git"]);
  assert.equal(gitCalls.filter((a) => a[0] === "push").length, 1, "one git push");
  assert.equal(gitCalls.some((a) => a[0] === "commit" || a[0] === "add"), false, "no file added");
  assert.equal(ramaDicho({ state: "done", code: null }), "Listo: la rama de trabajo ya está en GitHub, creada desde la rama principal.");
  assert.equal((await codeItem("workia")).state, "ready");
  // The branch is main's commit, and pressing again is fine.
  assert.equal((await realGit(["rev-parse", "sandbox"], origin)).stdout, (await realGit(["rev-parse", "main"], origin)).stdout);
  assert.equal((await crearRama("workia")).state, "already");
  // Its own name, when the project sets one.
  await setProject(db, { project: "workia", version: await version("workia"), settings: { start_branch: "develop" } }, HUMAN);
  assert.equal((await codeItem("workia")).why, "REPO_NO_START_BRANCH");
  assert.equal((await crearRama("workia")).state, "done");
  const after = await codeItem("workia");
  assert.deepEqual([after.state, after.branch], ["ready", "develop"]);
  await setProject(db, { project: "workia", version: await version("workia"), settings: { start_branch: null, local: null } }, HUMAN);
});

// ---- the working branch as a setting

test("I2-5: the working branch is a setting read through one function; protected names are refused everywhere", async () => {
  assert.equal(startBranchOf({}), "sandbox");
  assert.equal(startBranchOf({ start_branch: "develop" }), "develop");
  for (const bad of ["main", "master", "production", "prod", "Main", "a..b", "x.lock", "-x", "", "a//b", 7]) {
    assert.ok(startBranchProblem(bad), String(bad));
    assert.equal(startBranchOf({ start_branch: bad }), "sandbox", `a stored ${String(bad)} never widens the target`);
  }
  const v = await version("micasa");
  await assert.rejects(setProject(db, { project: "micasa", version: v, settings: { start_branch: "main" } }, HUMAN), (e: { code?: string }) => e.code === "INVALID_FILTER");
  // The runner's base check: only the project's start branch, never a protected one even if passed as allowed.
  assert.equal(checkBase("jl/x", null, "develop").ok, true);
  assert.equal(checkBase("jl/x", "sandbox", "develop").ok, false);
  assert.equal(checkBase("jl/x", "main", "main").ok, false);
  assert.equal(checkBase("main", null, "develop").ok, false);
  // Worktrees and the read copy are cut from origin/<start branch>.
  const calls: string[][] = [];
  // A new ticket: its branch does not exist yet (rev-parse --verify fails), so it is cut from origin/<start branch>.
  const git = async (args: string[]) => (calls.push(args), args[1] === "--verify" ? { code: 1, stdout: "", stderr: "" } : { code: 0, stdout: args[0] === "rev-parse" ? "jl/mic-1\n" : "", stderr: "" });
  const repo = path.join(scratch, "repo-micasa");
  mkdirSync(repo, { recursive: true });
  await ensureWorktree({ repo, root: path.join(scratch, "wt"), project: "micasa", key: "MIC-1", branch: "jl/mic-1", base: "develop" }, git);
  assert.deepEqual(calls.find((a) => a[0] === "fetch"), ["fetch", "origin", "develop"]);
  assert.ok(calls.find((a) => a[0] === "worktree")!.includes("origin/develop"));
  calls.length = 0;
  await ensureReadCopy({ repo, root: path.join(scratch, "wt"), project: "micasa", base: "develop" }, git);
  assert.deepEqual(calls.find((a) => a[0] === "fetch"), ["fetch", "origin", "develop"]);
  assert.equal((await ensureReadCopy({ repo, root: path.join(scratch, "wt"), project: "micasa", base: "main" }, git)).ok, false);
});

// ---- the GitHub choice runs a check like the folder choice

test("I2-5: the GitHub choice is checked like the folder: reachable, writable, with the working branch", async () => {
  const gh = (view: GitResult, branch: GitResult) => async (args: string[]) => (args[0] === "repo" ? view : branch);
  const ok = { code: 0, stdout: "WRITE\n", stderr: "" };
  const has = { code: 0, stdout: "sandbox\n", stderr: "" };
  assert.equal((await checkGithubRepo("o/r", "sandbox", gh(ok, has), ".")).failed, null);
  assert.equal((await checkGithubRepo("o/r", "sandbox", gh({ code: 0, stdout: "READ\n", stderr: "" }, has), ".")).failed, "REPO_GITHUB_NO_WRITE");
  assert.equal((await checkGithubRepo("o/r", "sandbox", gh({ code: 1, stdout: "", stderr: "GraphQL: Could not resolve to a Repository" }, has), ".")).failed, "REPO_GITHUB_NOT_FOUND");
  assert.equal((await checkGithubRepo("o/r", "sandbox", gh({ code: 4, stdout: "", stderr: "You are not logged into any GitHub hosts. To log in, run: gh auth login" }, has), ".")).failed, "REPO_GITHUB_SIGNED_OUT");
  assert.equal((await checkGithubRepo("o/r", "sandbox", gh({ code: 127, stdout: "", stderr: "" }, has), ".")).failed, "REPO_GITHUB_NO_GH");
  assert.equal((await checkGithubRepo("o/r", "sandbox", gh(ok, { code: 1, stdout: "", stderr: "gh: Branch not found (HTTP 404)" }), ".")).failed, "REPO_NO_START_BRANCH");
  // On save in Ajustes and at creation, with the check's gh injected.
  const repoCheck = { git: realGit, isDir, gh: gh({ code: 0, stdout: "READ\n", stderr: "" }, has) };
  const made = await createProjectFromTemplate(db, { name: "Agenda", goal: "Citas.", github_repo: "o/agenda" }, { requirePromptDoc: false, repoCheck, ctx: ACT });
  assert.deepEqual("error" in made ? [made.error, made.field] : made, ["REPO_GITHUB_NO_WRITE", "github_repo"]);
  assert.match(nuevoProyectoError("REPO_GITHUB_NO_WRITE"), /^No se creó nada: tu cuenta de GitHub no puede escribir/);
  assert.match(ajustesError("REPO_GITHUB_SIGNED_OUT"), /^No se guardó: GitHub no tiene la sesión iniciada/);
});

// ---- #6: no readiness sentence for code sends the owner to a terminal

test("I2-5 #6: no readiness sentence for the code or GitHub sends the owner to a terminal or names a branch", () => {
  const TERMINAL = /terminal|git init|corre |gh auth|\.env|sandbox|origin\b/i;
  const whys = ["REPO_FOLDER_MISSING", "REPO_NOT_GIT", "REPO_NO_ORIGIN", "REPO_ORIGIN_UNREACHABLE", "REPO_NO_START_BRANCH", undefined];
  for (const why of whys) {
    const t = listo.listoLinea({ id: "code", state: "missing", blocks: true, why, path: "/x/y", branch: "sandbox" }).texto;
    assert.doesNotMatch(t, TERMINAL, `${why}: ${t}`);
  }
  assert.doesNotMatch(listo.listoLinea({ id: "code", state: "ready", blocks: false, path: "/x/y", branch: "sandbox" }).texto, TERMINAL);
  for (const why of ["gh_absent", "gh_signed_out", "gh_no_write", "no_token", undefined]) {
    const t = listo.listoLinea({ id: "github", state: "missing", blocks: false, why }).texto;
    assert.doesNotMatch(t, TERMINAL, `${why}: ${t}`);
  }
  for (const code of ["REPO_FOLDER_MISSING", "REPO_NOT_GIT", "REPO_NO_ORIGIN", "REPO_ORIGIN_UNREACHABLE", "REPO_NO_START_BRANCH", "REPO_GITHUB_NO_GH", "REPO_GITHUB_SIGNED_OUT"]) {
    assert.doesNotMatch(nuevoProyectoError(code, { path: "/x/y", branch: "sandbox" }), TERMINAL, code);
    assert.doesNotMatch(ajustesError(code, { path: "/x/y", branch: "sandbox" }), TERMINAL, code);
  }
  for (const code of ["REPO_FOLDER_NOT_EMPTY", "REPO_GIT_FAILED", "REPO_NO_IDENTITY", "REPO_NO_ORIGIN", "REPO_PUSH_FAILED", "REPO_ORIGIN_UNREACHABLE", "REPO_GITHUB_NO_GH", "REPO_GITHUB_SIGNED_OUT", "REPO_GITHUB_NOT_FOUND", "REPO_GITHUB_NO_WRITE", "REPO_GITHUB_FAILED", null]) {
    assert.doesNotMatch(porQue(code), TERMINAL, String(code));
  }
  for (const w of Object.values(PASO)) assert.doesNotMatch(w, TERMINAL);
});

// ---- #4: gh's own login merges a delivery when there is no token file

async function reviewTicket(title: string, pr: string): Promise<{ key: string; message: string }> {
  const PO = { agent: "po-micasa", session_id: "s-po" };
  const t = (await writes.createTask(db, { project: "micasa", title, scope: "s", checks: ["c"], work_type: "code" } as never, { actor: PO })) as { key: string };
  await raw.query(`update tasks set status = 'In review', pr_url = $2 where key = $1`, [t.key, pr]);
  await raw.query(`update checks set done = true, done_at = now() where task_id = (select id from tasks where key = $1)`, [t.key]);
  const r = (await client.callTool({ name: "thread_post", arguments: { actor: PO, thread: "micasa", body: `${t.key} listo`, links: [{ kind: "ticket", ref: t.key, title }, { kind: "pr", ref: pr, title: "PR" }] } })) as { content: { text: string }[] };
  return { key: t.key, message: JSON.parse(r.content[0]!.text).message.id };
}

test("I2-5 #4: with gh signed in and no token file, Aceptar merges a delivery on an install made by first start", async () => {
  const home = path.join(scratch, "home-sin-token");
  mkdirSync(home, { recursive: true });
  const env: NodeJS.ProcessEnv = { ...process.env, PLANIA_GITHUB_TOKEN_FILE: path.join(home, "github-token"), PLANIA_GITHUB_RELEASE_TOKEN_FILE: path.join(home, "github-release-token"), GH_TOKEN: "" };
  delete env.PLANIA_GH_FALLBACK;
  const seen: { args: string[]; token: string | undefined }[] = [];
  const group = async (_cmd: string, args: string[], opts: { env?: NodeJS.ProcessEnv }) => {
    seen.push({ args, token: opts.env?.GH_TOKEN });
    if (args[1] === "view" && args.includes("baseRefName,state,headRefOid,url")) return { ok: true as const, stdout: JSON.stringify({ baseRefName: "sandbox", state: "OPEN", headRefOid: "f".repeat(40), url: "https://github.com/example/micasa/pull/31" }), stderr: "" };
    if (args[1] === "view" && args.includes("mergeable")) return { ok: true as const, stdout: JSON.stringify({ mergeable: "MERGEABLE" }), stderr: "" };
    if (args[1] === "merge") return { ok: true as const, stdout: "", stderr: "" };
    if (args[1] === "view") return { ok: true as const, stdout: JSON.stringify({ mergeCommit: { oid: "b".repeat(40) }, url: "https://github.com/example/micasa/pull/31" }), stderr: "" };
    return { ok: false as const, reason: "exit" as const, stdout: "", stderr: "unexpected" };
  };
  releaseGh.run = (args) => runReleaseGh(args, { env, group });
  const act = (message: string) => app.request(`/api/threads/${thread}/actions`, { method: "POST", headers: jorge(), body: JSON.stringify({ message_id: message, action: "fusionar" }) });

  // A hand-configured install (no first start): no token file means no merge, before any gh process.
  await raw.query(`delete from install_state`);
  await loadInstallState(db, env);
  assert.equal(ghLoginOn(env), false);
  const first = await reviewTicket("Sin token, a mano", "https://github.com/example/micasa/pull/30");
  const refused = await act(first.message);
  assert.equal(refused.status, 409);
  assert.equal(((await refused.json()) as { error: string }).error, "MERGE_FAILED");
  assert.equal(seen.length, 0, "gh never ran");

  // An install made by first start: gh's own login merges, with no GH_TOKEN handed to it.
  await raw.query(`insert into install_state (id, first_start_at) values (1, now())`);
  await loadInstallState(db, env);
  assert.equal(ghLoginOn(env), true);
  const t = await reviewTicket("Con la sesión de gh", "https://github.com/example/micasa/pull/31");
  const res = await act(t.message);
  assert.equal(res.status, 200, await res.clone().text());
  const out = (await res.json()) as { action_state: { result: { merged: boolean; sha: string } } };
  assert.deepEqual([out.action_state.result.merged, out.action_state.result.sha], [true, "b".repeat(40)]);
  assert.ok(seen.some((s) => s.args[1] === "merge"));
  assert.ok(seen.every((s) => !s.token), "no token: gh used its own login");
  assert.equal((await raw.query(`select status from tasks where key = $1`, [t.key])).rows[0].status, "Merged");
  // PLANIA_GH_FALLBACK=0 turns it off even after first start; a token file still wins when it has one.
  assert.equal(ghLoginOn({ ...env, PLANIA_GH_FALLBACK: "0" }), false);
  writeFileSync(env.PLANIA_GITHUB_TOKEN_FILE!, "ghp_fake_token_value_for_tests\n", { mode: 0o600 });
  seen.length = 0;
  await runReleaseGh(["pr", "view", "1"], { env, group }).catch(() => undefined);
  assert.equal(seen[0]?.token, "ghp_fake_token_value_for_tests");
  rmSync(env.PLANIA_GITHUB_TOKEN_FILE!);

  // The poller too: gh auth token after first start, without PLANIA_GH_FALLBACK.
  resetGithubAuthCache();
  const tok = await githubToken({ fetch: (async () => null) as never, env, tokenFile: () => ({ token: null }), ghRun: async () => ({ ok: true, stdout: "gho_from_gh\n", stderr: "" }) }, {});
  assert.deepEqual(tok, { token: "gho_from_gh", source: "gh auth token" });
  await raw.query(`delete from install_state`);
  await loadInstallState(db, env);
  resetGithubAuthCache();
  const none = await githubToken({ fetch: (async () => null) as never, env, tokenFile: () => ({ token: null }), ghRun: async () => ({ ok: true, stdout: "gho_from_gh\n", stderr: "" }) }, {});
  assert.equal(none.token, null);
});

test("I2-5: Aceptar merges into the project's working branch and refuses the default one when the setting differs", async () => {
  await setProject(db, { project: "micasa", version: await version("micasa"), settings: { start_branch: "develop" } }, HUMAN);
  const bases: Record<string, string> = { "40": "sandbox", "41": "develop" };
  releaseGh.run = async (args) => {
    const n = args[2]!;
    if (args[1] === "view" && args.includes("baseRefName,state,headRefOid,url")) return { ok: true, stdout: JSON.stringify({ baseRefName: bases[n], state: "OPEN", headRefOid: "c".repeat(40), url: `https://github.com/example/micasa/pull/${n}` }), stderr: "" };
    if (args[1] === "view" && args.includes("mergeable")) return { ok: true, stdout: "{}", stderr: "" };
    if (args[1] === "merge") return { ok: true, stdout: "", stderr: "" };
    return { ok: true, stdout: JSON.stringify({ mergeCommit: { oid: "d".repeat(40) }, url: `https://github.com/example/micasa/pull/${n}` }), stderr: "" };
  };
  const act = (message: string) => app.request(`/api/threads/${thread}/actions`, { method: "POST", headers: jorge(), body: JSON.stringify({ message_id: message, action: "fusionar" }) });
  const wrong = await reviewTicket("A la rama de siempre", "https://github.com/example/micasa/pull/40");
  const refused = await act(wrong.message);
  assert.equal(refused.status, 409);
  const body = (await refused.json()) as { error: string; hint: string };
  assert.equal(body.error, "BASE_NOT_SANDBOX");
  assert.doesNotMatch(body.hint, /sandbox|develop/, "no branch name on screen");
  const right = await reviewTicket("A su rama", "https://github.com/example/micasa/pull/41");
  const ok = await act(right.message);
  assert.equal(ok.status, 200, await ok.clone().text());
  assert.equal(((await ok.json()) as { action_state: { result: { base: string } } }).action_state.result.base, "develop");
  await setProject(db, { project: "micasa", version: await version("micasa"), settings: { start_branch: null } }, HUMAN);
});

test("I2-5: the folder check reads the project's working branch", async () => {
  const seen: string[][] = [];
  const git = async (args: string[]) => (seen.push(args), { code: 0, stdout: args[0] === "rev-parse" ? "true\n" : "", stderr: "" });
  await checkRepoFolder(path.join(scratch, "x"), { git, isDir: () => true }, "develop");
  assert.deepEqual(seen.at(-1), ["ls-remote", "--exit-code", "--heads", "origin", "develop"]);
  // createStartBranch alone: one fetch of the default branch and one push of its commit to the new name.
  const calls: string[][] = [];
  const g = async (args: string[]) => {
    calls.push(args);
    if (args[0] === "ls-remote" && args[1] === "--exit-code") return { code: 2, stdout: "", stderr: "" };
    if (args[0] === "ls-remote") return { code: 0, stdout: `ref: refs/heads/trunk\tHEAD\n${"e".repeat(40)}\tHEAD\n`, stderr: "" };
    return { code: 0, stdout: "", stderr: "" };
  };
  assert.deepEqual(await createStartBranch(path.join(scratch, "x"), "develop", g), { state: "done", code: null });
  assert.deepEqual(calls.slice(2), [["fetch", "origin", "trunk"], ["push", "origin", `${"e".repeat(40)}:refs/heads/develop`]]);
});
