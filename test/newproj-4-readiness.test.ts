// NEWPROJ-4: a project's readiness list (src/runner/readiness.ts, GET /api/company/projects/:slug/readiness) and its
// Spanish wording (ui/src/lib/listo.ts). The environment, git and the filesystem are injected: no real git, gh or
// Claude binary runs. Throwaway DB and kit.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";

const TMP = mkdtempSync(path.join(tmpdir(), "plania-newproj4-"));
const kit = path.join(TMP, "kit");
mkdirSync(path.join(kit, "roles"), { recursive: true });
const ROLES = ["product-owner", "research", "artist", "taller"];
for (const r of ROLES) writeFileSync(path.join(kit, "roles", `${r}.md`), `# ${r}\n\nFixture prompt.\n`);
process.env.PLANIA_KIT_DIR = kit;
process.env.PLANIA_CAPTURES_DIR = path.join(TMP, "captures");
delete process.env.PLANIA_PROMPTS_PROJECT;
useTestEnv();
const { makeDb } = await import("../src/db/client.js");
const { app } = await import("../src/app.js");
const { setNewProjectRepoCheck, setReadinessDeps } = await import("../src/api/company.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const { READINESS_IDS, claudeFound } = await import("../src/runner/readiness.js");
const listo = await import("../ui/src/lib/listo.js");
type GitFn = import("../src/runner/worktree.js").GitFn;
type Readiness = import("../src/runner/readiness.js").Readiness;

type Db = ReturnType<typeof makeDb>["db"];
let raw: pg.Client;
let closeDb: () => Promise<void>;
const jorge = () => ({ Cookie: `${SESSION_COOKIE}=${createSession()}`, "Content-Type": "application/json" });
const create = (body: unknown) => app.request("/api/company/projects", { method: "POST", headers: jorge(), body: JSON.stringify(body) });
const readiness = async (slug: string): Promise<Readiness> => {
  const res = await app.request(`/api/company/projects/${slug}/readiness`, { headers: jorge() });
  assert.equal(res.status, 200, await res.clone().text());
  return (await res.json()) as Readiness;
};

// Every git call is kept; a test that expects none checks the list stays empty.
const calls: string[][] = [];
function fakeGit(r: { branch?: boolean } = {}) {
  const fn: GitFn = async (args) => {
    calls.push(args);
    if (args[0] === "rev-parse") return { code: 0, stdout: "true\n", stderr: "" };
    if (args[0] === "remote") return { code: 0, stdout: "git@github.com:o/r.git\n", stderr: "" };
    if (args[0] === "ls-remote") return r.branch === false ? { code: 2, stdout: "", stderr: "" } : { code: 0, stdout: "abc\trefs/heads/sandbox\n", stderr: "" };
    return { code: 1, stdout: "", stderr: "unexpected" };
  };
  return { git: fn, isDir: () => true };
}
// The Claude binary is a path that exists only in this fake filesystem; it is never run.
const CLAUDE = path.join(TMP, "bin", "claude");
const env = (extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv => {
  const e: NodeJS.ProcessEnv = { ...process.env, CLAUDE_CODE_BIN: CLAUDE, ...extra };
  for (const [k, v] of Object.entries(extra)) if (v === undefined) delete e[k];
  return e;
};
const exists = (p: string) => p === CLAUDE;

before(async () => {
  raw = await resetTestDb();
  ({ close: closeDb } = makeDb() as { db: Db; close: () => Promise<void> });
});

after(async () => {
  setNewProjectRepoCheck(null);
  setReadinessDeps(null);
  await closeDb?.();
  await raw?.end();
  rmSync(TMP, { recursive: true, force: true });
});

test("NEWPROJ-4: a project with no code: the code item says so, each seat's prompt shows, the missing token stops a run", async () => {
  const res = await create({ name: "Recetario", goal: "Recetas en un minuto.", no_code: true });
  assert.equal(res.status, 201, await res.clone().text());
  // One seat loses its prompt after creation.
  unlinkSync(path.join(kit, "roles", "artist.md"));
  calls.length = 0;
  setReadinessDeps({ env: env({ PLANIA_RUNNER_TOKEN: undefined }), exists, repoCheck: fakeGit() });
  const r = await readiness("recetario");
  writeFileSync(path.join(kit, "roles", "artist.md"), "# artist\n\nFixture prompt.\n");

  assert.deepEqual(calls, [], "no folder is checked for a project with no code");
  const by = (id: string) => r.items.filter((i) => i.id === id);
  assert.deepEqual(by("code"), [{ id: "code", state: "not_needed", blocks: false, why: "no_code" }]);
  for (const id of ["github", "capture", "verify"]) assert.equal(by(id)[0]?.state, "not_needed", id);

  const prompts = r.items.filter((i) => i.id.startsWith("prompt."));
  assert.deepEqual(prompts.map((i) => [i.id, i.seat, i.state, i.blocks]).sort(), [
    ["prompt.artist", "artist-recetario", "missing", true],
    ["prompt.product-owner", "po-recetario", "ready", true],
    ["prompt.research", "research-recetario", "ready", true],
    ["prompt.taller", "taller-recetario", "ready", true],
  ]);
  assert.deepEqual(by("runner_token"), [{ id: "runner_token", state: "missing", blocks: true }]);
  assert.deepEqual(by("claude_bin"), [{ id: "claude_bin", state: "ready", blocks: true }]);
  for (const id of ["context.glossary", "context.commands", "context.map"]) assert.deepEqual(by(id), [{ id, state: "missing", blocks: false }]);
  assert.equal(r.blocking, 2);
  assert.equal(r.tasks, 0);

  // The screen's words: not «listo», the warning names what fails, and Reanudar does not say the team resumes work.
  assert.equal(listo.creadoTitulo("Recetario", r), "Recetario está creado, pero no listo");
  assert.equal(listo.listoAviso(r), "Faltan 2 cosas para que el equipo pueda trabajar.");
  const falla = listo.reanudarFalla(r)!;
  assert.match(falla, /la primera corrida va a fallar/);
  assert.match(falla, /el texto de instrucciones de Artist/);
  assert.match(falla, /la llave del equipo/);
  const al = listo.reanudarAlReanudar(r);
  assert.doesNotMatch(al, /retoma lo que estaba/);
  assert.match(al, /Todavía no hay pasos/);
  const grupos = listo.listoGrupos(r.items);
  assert.deepEqual(grupos.map((g) => g.key), ["falta", "listo", "no_hace_falta"]);
  assert.deepEqual(grupos[0]!.lineas.slice(0, 2).map((l) => l.para), [true, true], "what stops a run comes first");
});

test("NEWPROJ-4: a folder whose origin lacks the start branch is the single item that stops a run", async () => {
  setNewProjectRepoCheck(fakeGit());
  const res = await create({ name: "Despensa", goal: "Saber qué hay.", repo_path: "/repos/despensa", github_repo: "jorge/despensa" });
  assert.equal(res.status, 201, await res.clone().text());
  calls.length = 0;
  setReadinessDeps({ env: env({ PLANIA_RUNNER_TOKEN: "t" }), exists, repoCheck: fakeGit({ branch: false }), githubAccess: async () => "ok" });
  const r = await readiness("despensa");

  assert.ok(calls.every((c) => ["rev-parse", "remote", "ls-remote"].includes(c[0]!)), "only the injected git");
  const stops = r.items.filter((i) => i.state === "missing" && i.blocks);
  assert.equal(stops.length, 1);
  assert.equal(stops[0]!.id, "code");
  assert.equal(stops[0]!.why, "REPO_NO_START_BRANCH");
  assert.equal(stops[0]!.path, path.resolve("/repos/despensa"));
  assert.equal(r.blocking, 1);
  assert.equal(r.items.find((i) => i.id === "github")?.state, "ready");
  assert.equal(r.items.find((i) => i.id === "verify")?.state, "missing");
  const linea = listo.listoLinea(stops[0]!);
  assert.equal(linea.para, true);
  assert.match(linea.texto, /no tiene la rama de trabajo.*«Crear la rama de trabajo»/);
  assert.doesNotMatch(linea.texto, /sandbox/i);

  // With the branch there, nothing stops a run and the sheet may say «listo».
  setReadinessDeps({ env: env({ PLANIA_RUNNER_TOKEN: "t" }), exists, repoCheck: fakeGit() });
  const ok = await readiness("despensa");
  assert.equal(ok.blocking, 0);
  assert.equal(listo.creadoTitulo("Despensa", ok), "Despensa está listo");
  assert.equal(listo.listoAviso(ok), null);
  assert.equal(listo.reanudarFalla(ok), null);
});

test("NEWPROJ-4: an unknown project is a 404, and the route only reads", async () => {
  const res = await app.request("/api/company/projects/nada/readiness", { headers: jorge() });
  assert.equal(res.status, 404);
  const post = await app.request("/api/company/projects/despensa/readiness", { method: "POST", headers: jorge(), body: "{}" });
  assert.ok(post.status === 404 || post.status === 405, String(post.status));
});

test("NEWPROJ-4: the Claude binary is looked for, never run: a path directly, a bare name on PATH", () => {
  assert.equal(claudeFound({ CLAUDE_CODE_BIN: CLAUDE }, exists), true);
  assert.equal(claudeFound({ CLAUDE_CODE_BIN: path.join(TMP, "nope") }, exists), false);
  const dir = path.join(TMP, "bin");
  const seen: string[] = [];
  const onPath = claudeFound({ CLAUDE_CODE_BIN: "claude", PATH: [path.join(TMP, "x"), dir].join(path.delimiter), PATHEXT: ".EXE" }, (p) => (seen.push(p), p === CLAUDE || p === `${CLAUDE}.EXE`));
  assert.equal(onPath, true);
  assert.ok(seen.every((p) => p.startsWith(TMP)));
  // No CLAUDE_CODE_BIN: the runner's default, ~/.local/bin/claude.
  assert.equal(claudeFound({ HOME: TMP }, (p) => p === path.join(TMP, ".local", "bin", "claude")), true);
});

test("NEWPROJ-4: every item id the server can send has Spanish words for each state", () => {
  for (const id of READINESS_IDS) assert.ok(listo.tienePalabras(id), `no wording for ${id}`);
  const NO_CODE = /\b(REPO|PROMPT)_[A-Z_]+\b/;
  for (const id of READINESS_IDS) {
    for (const state of ["ready", "missing", "not_needed"] as const) {
      for (const why of [undefined, "REPO_FOLDER_MISSING", "REPO_NOT_GIT", "REPO_NO_ORIGIN", "REPO_ORIGIN_UNREACHABLE", "REPO_NO_START_BRANCH", "no_code"]) {
        const l = listo.listoLinea({ id, state, blocks: true, why, path: "/repos/x", seat: "x-y" });
        assert.ok(l.titulo && l.texto && l.nombre, `${id} ${state}`);
        assert.notEqual(l.titulo, "Otra cosa", id);
        assert.doesNotMatch(`${l.titulo} ${l.texto} ${l.nombre}`, NO_CODE, `${id} ${state} ${why}`);
        assert.doesNotMatch(`${l.titulo} ${l.texto}`, /sandbox|NEWPROJ|PLA-/i, `${id} ${state}`);
      }
    }
  }
  // Without the list (still loading), Reanudar claims nothing about earlier work.
  assert.doesNotMatch(listo.reanudarAlReanudar(null), /retoma lo que estaba/);
  assert.match(listo.reanudarAlReanudar({ tasks: 3 }), /retoma lo que estaba/);
});
