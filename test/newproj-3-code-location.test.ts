// NEWPROJ-3: the sheet «Nuevo proyecto» asks where the code is: a folder on this machine (checked before anything is
// created: exists, git, origin, the start branch on origin), a GitHub repo (owner/name, shape only), or no code yet
// (settings.local.no_code, which Máquinas then says in Spanish). set_project takes settings.local. Git and the
// filesystem are injected; no real git runs. Throwaway DB and kit.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";

const TMP = mkdtempSync(path.join(tmpdir(), "plania-newproj3-"));
const kit = path.join(TMP, "kit");
mkdirSync(path.join(kit, "roles"), { recursive: true });
for (const r of ["product-owner", "research", "artist", "taller"]) writeFileSync(path.join(kit, "roles", `${r}.md`), `# ${r}\n\nFixture prompt.\n`);
process.env.PLANIA_KIT_DIR = kit;
process.env.PLANIA_CAPTURES_DIR = path.join(TMP, "captures");
delete process.env.PLANIA_PROMPTS_PROJECT;
useTestEnv();
const { makeDb } = await import("../src/db/client.js");
const { app } = await import("../src/app.js");
const { setNewProjectRepoCheck } = await import("../src/api/company.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const { checkRepoFolder, parseLocalSettings } = await import("../src/runner/repo-check.js");
const { setProject } = await import("../src/mcp/project.js");
const maquinas = await import("../src/maquinas/machines.js");
const { nuevoProyectoError, codigoBody } = await import("../ui/src/lib/nuevo-proyecto.js");
// The screen's Máquinas words (ui/src/lib/maquinas.ts) import screen modules the server's type-check does not
// follow, so the module is loaded by a computed path with only the shape this test reads.
const UI_MAQUINAS = "../ui/src/lib/maquinas.ts";
type MaquinasReadUi = { _ui: true };
const { maqView, setupLine } = (await import(UI_MAQUINAS)) as {
  maqView: (r: MaquinasReadUi) => { state: string; word: string; server: { lever: unknown } };
  setupLine: (r: MaquinasReadUi) => string;
};
type GitFn = import("../src/runner/worktree.js").GitFn;

type Db = ReturnType<typeof makeDb>["db"];
let raw: pg.Client;
let db: Db;
let closeDb: () => Promise<void>;
const jorge = () => ({ Cookie: `${SESSION_COOKIE}=${createSession()}`, "Content-Type": "application/json" });
const post = (body: unknown) => app.request("/api/company/projects", { method: "POST", headers: jorge(), body: JSON.stringify(body) });
const count = async () => (await raw.query(`select count(*)::int as n from projects`)).rows[0].n as number;
const settingsOf = async (slug: string) => (await raw.query(`select settings from projects where slug = $1`, [slug])).rows[0]?.settings;
const ctx = { actor: { agent: "test", session_id: "s" }, tool: "set_project" } as const;

// A fake repo: which checks pass. Every git call is kept.
type Repo = { dir?: boolean; git?: boolean; origin?: boolean; reach?: boolean; branch?: boolean };
const calls: string[][] = [];
function fake(r: Repo = {}) {
  const { dir = true, git = true, origin = true, reach = true, branch = true } = r;
  const fn: GitFn = async (args) => {
    calls.push(args);
    const ok = { code: 0, stdout: "", stderr: "" };
    if (args[0] === "rev-parse") return git ? { ...ok, stdout: "true\n" } : { code: 128, stdout: "", stderr: "fatal: not a git repository" };
    if (args[0] === "remote") return origin ? { ...ok, stdout: "git@github.com:o/r.git\n" } : { code: 2, stdout: "", stderr: "error: No such remote 'origin'" };
    if (args[0] === "ls-remote") return !reach ? { code: 128, stdout: "", stderr: "fatal: could not read" } : branch ? { ...ok, stdout: "abc\trefs/heads/sandbox\n" } : { code: 2, stdout: "", stderr: "" };
    return { code: 1, stdout: "", stderr: "unexpected" };
  };
  return { git: fn, isDir: () => dir };
}

before(async () => {
  raw = await resetTestDb();
  ({ db, close: closeDb } = makeDb());
  maquinas.setMaquinasDeps({ env: { PLANIA_PROJECTS_ROOT: path.join(TMP, "projects") }, portBusy: async () => false, frame: async () => false });
});

after(async () => {
  setNewProjectRepoCheck(null);
  maquinas.setMaquinasDeps({});
  await closeDb?.();
  await raw?.end();
  rmSync(TMP, { recursive: true, force: true });
});

test("NEWPROJ-3: checkRepoFolder reports every check, and the first failure stops the rest", async () => {
  const ok = await checkRepoFolder("/repos/viajia", fake());
  assert.equal(ok.ok, true);
  assert.equal(ok.failed, null);
  assert.equal(ok.branch, "sandbox");
  assert.deepEqual(
    ok.checks.map((c) => [c.key, c.state]),
    [["exists", "ok"], ["git", "ok"], ["origin", "ok"], ["start_branch", "ok"]],
  );
  const cases: [Repo, string, string][] = [
    [{ dir: false }, "REPO_FOLDER_MISSING", "exists"],
    [{ git: false }, "REPO_NOT_GIT", "git"],
    [{ origin: false }, "REPO_NO_ORIGIN", "origin"],
    [{ reach: false }, "REPO_ORIGIN_UNREACHABLE", "start_branch"],
    [{ branch: false }, "REPO_NO_START_BRANCH", "start_branch"],
  ];
  for (const [repo, code, key] of cases) {
    const r = await checkRepoFolder("/repos/viajia", fake(repo));
    assert.equal(r.ok, false);
    assert.equal(r.failed, code);
    const i = r.checks.findIndex((c) => c.key === key);
    assert.deepEqual(r.checks[i], { key, state: "failed", code });
    assert.ok(r.checks.slice(0, i).every((c) => c.state === "ok"));
    assert.ok(r.checks.slice(i + 1).every((c) => c.state === "skipped"));
  }
  // The start branch is asked of origin itself.
  calls.length = 0;
  await checkRepoFolder("/repos/viajia", fake());
  assert.deepEqual(calls.at(-1), ["ls-remote", "--exit-code", "--heads", "origin", "sandbox"]);
});

test("NEWPROJ-3: a project with a folder saves settings.local.repo_path, and settings.github.repo when given", async () => {
  setNewProjectRepoCheck(fake());
  const res = await post({ name: "Carpeta", goal: "Tener su carpeta.", repo_path: "/repos/carpeta", github_repo: "jorge/carpeta" });
  assert.equal(res.status, 201, await res.clone().text());
  assert.deepEqual(await settingsOf("carpeta"), { plan_approval: true, github: { repo: "jorge/carpeta" }, local: { repo_path: "/repos/carpeta" }, release: { from: "sandbox", into: "main", env: "prod", mode: "merge" } }); // PLA-I2-6

  const solo = await post({ name: "Solo carpeta", goal: "Sin GitHub.", repo_path: "/repos/solo" });
  assert.equal(solo.status, 201);
  assert.deepEqual(await settingsOf("solo-carpeta"), { plan_approval: true, local: { repo_path: "/repos/solo" }, release: { from: "sandbox", into: "main", env: "prod", mode: "merge" } }); // PLA-I2-6

  // Only GitHub: no folder check, and the folder stays the default one.
  setNewProjectRepoCheck(fake({ dir: false }));
  const gh = await post({ name: "Nube", goal: "Solo en GitHub.", github_repo: "jorge/nube" });
  assert.equal(gh.status, 201);
  assert.deepEqual(await settingsOf("nube"), { plan_approval: true, github: { repo: "jorge/nube" }, release: { from: "sandbox", into: "main", env: "prod", mode: "merge" } }); // PLA-I2-6
});

test("NEWPROJ-3: a folder that fails a check is refused with its own code and nothing is created", async () => {
  const cases: [Repo, string][] = [
    [{ dir: false }, "REPO_FOLDER_MISSING"],
    [{ git: false }, "REPO_NOT_GIT"],
    [{ origin: false }, "REPO_NO_ORIGIN"],
    [{ reach: false }, "REPO_ORIGIN_UNREACHABLE"],
    [{ branch: false }, "REPO_NO_START_BRANCH"],
  ];
  for (const [repo, code] of cases) {
    setNewProjectRepoCheck(fake(repo));
    const before = await count();
    const res = await post({ name: "Rechazado", goal: "No debe existir.", repo_path: "/repos/rechazado" });
    assert.equal(res.status, 400, code);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body.error, code);
    assert.equal(body.field, "repo_path");
    assert.equal(body.path, "/repos/rechazado");
    assert.ok(Array.isArray(body.checks));
    assert.equal(await count(), before, `${code}: nothing created`);
    assert.equal((await raw.query(`select count(*)::int as n from agents where slug like '%-rechazado'`)).rows[0].n, 0);
  }
  setNewProjectRepoCheck(fake());
});

test("NEWPROJ-3: shapes are refused by field: owner/name, an absolute folder, and no_code alone", async () => {
  const before = await count();
  for (const [body, field] of [
    [{ github_repo: "viajia" }, "github_repo"],
    [{ github_repo: "https://github.com/jorge/viajia" }, "github_repo"],
    [{ repo_path: "repos/relativo" }, "repo_path"],
    [{ no_code: true, github_repo: "jorge/viajia" }, "no_code"],
    [{ no_code: true, repo_path: "/repos/x" }, "no_code"],
  ] as [Record<string, unknown>, string][]) {
    const res = await post({ name: "Forma", goal: "Forma mala.", ...body });
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: "INVALID_BODY", field });
  }
  assert.equal(await count(), before);
});

test("NEWPROJ-3: «no code yet» is stored, and Máquinas says so in Spanish with nothing to configure", async () => {
  const res = await post({ name: "Idea", goal: "Todavía no hay código.", no_code: true });
  assert.equal(res.status, 201);
  assert.deepEqual(await settingsOf("idea"), { plan_approval: true, local: { no_code: true } });

  const read = await maquinas.maquinasRead(db, "idea");
  assert.equal(read.configured, false);
  assert.equal(read.no_code, true);
  assert.equal(read.found, null, "nothing is looked for in a folder that does not exist");
  const v = maqView(read as unknown as MaquinasReadUi);
  assert.equal(v.state, "no-code");
  assert.equal(v.word, "Todavía sin código");
  assert.equal(v.server.lever, null);
  assert.match(setupLine(read as unknown as MaquinasReadUi), /todavía no tiene código/);
  assert.doesNotMatch(setupLine(read as unknown as MaquinasReadUi), /package\.json/);
  await assert.rejects(() => maquinas.configurar(db, "idea"), (e: Error & { code?: string }) => e.code === "NOT_CONFIGURED");

  // A project with a folder but no package.json still says what is missing.
  const other = await maquinas.maquinasRead(db, "carpeta");
  assert.equal(other.no_code, false);
  assert.equal(maqView(other as unknown as MaquinasReadUi).state, "unconfigured");
  assert.equal(setupLine(other as unknown as MaquinasReadUi), "Falta: package.json.");
});

test("NEWPROJ-3: set_project takes settings.local (a folder or no_code), validated", async () => {
  const v = (await raw.query(`select version from projects where slug = 'idea'`)).rows[0].version as number;
  const set = await setProject(db, { project: "idea", version: v, settings: { local: { repo_path: "/repos/idea" } } }, ctx);
  assert.deepEqual(set.settings.local, { repo_path: "/repos/idea" });
  for (const [local, field] of [
    [{ repo_path: "relativo" }, "settings.local.repo_path"],
    [{ repo_path: "/repos/idea", no_code: true }, "settings.local.no_code"],
    [{ no_code: "sí" }, "settings.local.no_code"],
    [{ path: "/x" }, "settings.local.path"],
    ["/repos/idea", "settings.local"],
  ] as [unknown, string][]) {
    await assert.rejects(
      () => setProject(db, { project: "idea", version: v + 1, settings: { local } }, ctx),
      (e: Error & { code?: string; detail?: { field?: string } }) => e.code === "INVALID_FILTER" && e.detail?.field === field,
      field,
    );
  }
  const back = await setProject(db, { project: "idea", version: v + 1, settings: { local: { no_code: true } } }, ctx);
  assert.deepEqual(back.settings.local, { no_code: true });
  assert.deepEqual(parseLocalSettings({ no_code: false }), { ok: true, settings: {} });
});

test("NEWPROJ-3: the sheet says what to fix for each folder check, in Spanish, with no code in capitals", () => {
  const d = { path: "/repos/viajia", branch: "sandbox" };
  assert.equal(nuevoProyectoError("REPO_FOLDER_MISSING", d), "No se creó nada: la carpeta /repos/viajia no existe en esta máquina. Revisa la ruta, o elige «Sin código» y prepáralo después desde Despliegue.");
  assert.match(nuevoProyectoError("REPO_NOT_GIT", d), /tiene archivos pero no es un repositorio/);
  assert.match(nuevoProyectoError("REPO_NO_ORIGIN", d), /no está conectada a GitHub\. Elige «Sin código»/);
  assert.match(nuevoProyectoError("REPO_ORIGIN_UNREACHABLE", d), /no pude leer el repositorio en GitHub/);
  assert.match(nuevoProyectoError("REPO_NO_START_BRANCH", d), /no tiene la rama de trabajo. Elige «Sin código»/);
  assert.match(nuevoProyectoError("INVALID_BODY", { field: "github_repo" }), /dueño\/nombre/);
  assert.match(nuevoProyectoError("INVALID_BODY", { field: "repo_path" }), /ruta completa/);
  const lines = ["REPO_FOLDER_MISSING", "REPO_NOT_GIT", "REPO_NO_ORIGIN", "REPO_ORIGIN_UNREACHABLE", "REPO_NO_START_BRANCH"].map((c) => nuevoProyectoError(c, d));
  assert.equal(new Set(lines).size, 5, "each check has its own sentence");
  for (const line of [...lines, nuevoProyectoError("REPO_NOT_GIT")]) {
    assert.match(line, /^No se creó nada/);
    assert.doesNotMatch(line, /\b[A-Z]{2,}_[A-Z_]+\b/, line);
  }
});

// «Agregar un proyecto»: Local and Nube name their way in (origen), so the route checks and clones them
// (src/runner/open-project.ts); Sin código keeps the old body. test/agregar-proyecto.test.ts covers SSH.
test("NEWPROJ-3: the sheet sends one choice, and only when its field has the right shape", () => {
  assert.equal(codigoBody(null, "/repos/x", "o/r"), null);
  assert.deepEqual(codigoBody("ninguno", "/repos/x", "o/r"), { no_code: true });
  assert.deepEqual(codigoBody("github", "/repos/x", " jorge/viajia "), { origen: "nube", repo: "jorge/viajia" });
  assert.equal(codigoBody("github", "", "viajia"), null);
  assert.deepEqual(codigoBody("carpeta", "~/Developer/Projects/viajia", ""), { origen: "local", repo_path: "~/Developer/Projects/viajia" });
  // Local reads its GitHub repository from the folder's origin; a typed one is no longer asked.
  assert.deepEqual(codigoBody("carpeta", "/repos/viajia", "jorge/viajia"), { origen: "local", repo_path: "/repos/viajia" });
  assert.equal(codigoBody("carpeta", "repos/viajia", ""), null);
});
