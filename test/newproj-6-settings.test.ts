// NEWPROJ-6: the project's settings view (src/api/project-settings.ts, the routes in src/api/company.ts) and its
// Spanish wording (ui/src/lib/ajustes.ts). Writes go through setProject and attachDoc, so each one leaves its event.
// Git and the filesystem are injected; no real git runs. Throwaway DB and kit.
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";

const TMP = mkdtempSync(path.join(tmpdir(), "plania-newproj6-"));
const kit = path.join(TMP, "kit");
mkdirSync(path.join(kit, "roles"), { recursive: true });
for (const r of ["product-owner", "research", "artist", "taller"]) writeFileSync(path.join(kit, "roles", `${r}.md`), `# ${r}\n\nFixture prompt.\n`);
// The real context templates, so the test reads what the screen offers.
cpSync(path.resolve(import.meta.dirname, "../kit/context"), path.join(kit, "context"), { recursive: true });
process.env.PLANIA_KIT_DIR = kit;
process.env.PLANIA_CAPTURES_DIR = path.join(TMP, "captures");
delete process.env.PLANIA_PROMPTS_PROJECT;
useTestEnv();
const { makeDb } = await import("../src/db/client.js");
const { app } = await import("../src/app.js");
const { setNewProjectRepoCheck, setReadinessDeps } = await import("../src/api/company.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const { verifyItems, verifyName } = await import("../src/api/project-settings.js");
const { READINESS_IDS } = await import("../src/runner/readiness.js");
const aj = await import("../ui/src/lib/ajustes.js");
type GitFn = import("../src/runner/worktree.js").GitFn;
type SettingsRead = import("../src/api/project-settings.js").SettingsRead;

type Db = ReturnType<typeof makeDb>["db"];
let raw: pg.Client;
let closeDb: () => Promise<void>;
const jorge = () => ({ Cookie: `${SESSION_COOKIE}=${createSession()}`, "Content-Type": "application/json" });
const SLUG = "recetario";
const base = `/api/company/projects/${SLUG}/settings`;
const put = (p: string, body: unknown) => app.request(`${base}${p}`, { method: "PUT", headers: jorge(), body: JSON.stringify(body) });
const read = async (): Promise<SettingsRead> => {
  const res = await app.request(base, { headers: jorge() });
  assert.equal(res.status, 200, await res.clone().text());
  return (await res.json()) as SettingsRead;
};
const stored = async () => (await raw.query(`select settings, version from projects where slug = $1`, [SLUG])).rows[0] as { settings: Record<string, any>; version: number };
// PLA-I74-1: the owner.click every screen write leaves is not the write's own event.
const eventsSince = async (id: number) => (await raw.query(`select id, type, payload from events where id > $1 and project_id = (select id from projects where slug = $2) and type <> 'owner.click' order by id`, [id, SLUG])).rows as { id: number; type: string; payload: any }[];
const lastEvent = async () => Number((await raw.query(`select coalesce(max(id), 0) as n from events`)).rows[0].n);

let gitCalls: string[][] = [];
function fakeGit(r: { exists?: boolean; git?: boolean; branch?: boolean } = {}) {
  const fn: GitFn = async (args) => {
    gitCalls.push(args);
    if (args[0] === "rev-parse") return r.git === false ? { code: 128, stdout: "", stderr: "not a git repo" } : { code: 0, stdout: "true\n", stderr: "" };
    if (args[0] === "remote") return { code: 0, stdout: "git@github.com:o/r.git\n", stderr: "" };
    if (args[0] === "ls-remote") return r.branch === false ? { code: 2, stdout: "", stderr: "" } : { code: 0, stdout: "abc\trefs/heads/sandbox\n", stderr: "" };
    return { code: 1, stdout: "", stderr: "unexpected" };
  };
  return { git: fn, isDir: () => r.exists !== false };
}

before(async () => {
  raw = await resetTestDb();
  ({ close: closeDb } = makeDb() as { db: Db; close: () => Promise<void> });
  setNewProjectRepoCheck(fakeGit());
  setReadinessDeps({ repoCheck: fakeGit(), env: { ...process.env, PLANIA_RUNNER_TOKEN: "x" }, exists: () => true, githubAccess: async () => "ok" });
  const res = await app.request("/api/company/projects", { method: "POST", headers: jorge(), body: JSON.stringify({ name: "Recetario", goal: "Recetas en un minuto.", no_code: true }) });
  assert.equal(res.status, 201, await res.clone().text());
});

after(async () => {
  setNewProjectRepoCheck(null);
  setReadinessDeps(null);
  await closeDb?.();
  await raw?.end();
  rmSync(TMP, { recursive: true, force: true });
});

test("NEWPROJ-6: the settings read is the owner's only: a Bearer is 403, no cookie is 401", async () => {
  assert.equal((await app.request(base)).status, 401);
  assert.equal((await app.request(base, { headers: { ...jorge(), Authorization: "Bearer x" } })).status, 403);
  assert.equal((await app.request(`${base}/code`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: 1, no_code: true }) })).status, 401);
  const s = await read();
  assert.deepEqual(s.code, { repo_path: null, github_repo: null, no_code: true });
  assert.equal(s.release, null);
  assert.deepEqual(s.verify, []);
  assert.deepEqual(
    s.context.map((c) => [c.id, c.doc_id, c.template.startsWith(`# ${c.id === "glossary" ? "Glossary" : c.id === "commands" ? "Commands" : "Map"} — Recetario`)]),
    [
      ["glossary", null, true],
      ["commands", null, true],
      ["map", null, true],
    ],
  );
});

test("NEWPROJ-6: setting the folder checks it, saves settings.local through set_project, and the readiness list follows", async () => {
  const before = await read();
  const ev = await lastEvent();
  gitCalls = [];
  const res = await put("/code", { version: before.version, repo_path: "/Users/o/recetario", github_repo: "o/recetario" });
  assert.equal(res.status, 200, await res.clone().text());
  const s = (await res.json()) as SettingsRead;
  assert.deepEqual(s.code, { repo_path: "/Users/o/recetario", github_repo: "o/recetario", no_code: false });
  assert.equal(s.version, before.version + 1);
  assert.deepEqual(gitCalls.map((a) => a[0]), ["rev-parse", "remote", "ls-remote"]);
  const db = await stored();
  assert.deepEqual(db.settings.local, { repo_path: "/Users/o/recetario" });
  assert.deepEqual(db.settings.github, { repo: "o/recetario" });
  const events = await eventsSince(ev);
  assert.deepEqual(events.map((e) => e.type), ["project.updated"]);
  const r = (await (await app.request(`/api/company/projects/${SLUG}/readiness`, { headers: jorge() })).json()) as { items: { id: string; state: string }[] };
  assert.equal(r.items.find((i) => i.id === "code")?.state, "ready");
  assert.equal(r.items.find((i) => i.id === "github")?.state, "ready");
});

test("NEWPROJ-6: a folder that fails the repo check is refused with its code and nothing is saved", async () => {
  const before = await stored();
  const ev = await lastEvent();
  setNewProjectRepoCheck(fakeGit({ git: false }));
  try {
    const res = await put("/code", { version: before.version, repo_path: "/Users/o/otra" });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: string; field: string; path: string };
    assert.equal(body.error, "REPO_NOT_GIT");
    assert.equal(body.field, "repo_path");
    assert.equal(body.path, "/Users/o/otra");
    setNewProjectRepoCheck(fakeGit({ exists: false }));
    assert.equal(((await (await put("/code", { version: before.version, repo_path: "/Users/o/otra" })).json()) as { error: string }).error, "REPO_FOLDER_MISSING");
  } finally {
    setNewProjectRepoCheck(fakeGit());
  }
  assert.deepEqual(await stored(), before);
  assert.deepEqual(await eventsSince(ev), []);
  // Shapes are refused before git runs.
  gitCalls = [];
  assert.equal(((await (await put("/code", { version: before.version, repo_path: "recetario" })).json()) as { field: string }).field, "repo_path");
  assert.equal(((await (await put("/code", { version: before.version, github_repo: "no es un repo" })).json()) as { field: string }).field, "github_repo");
  assert.equal(((await (await put("/code", { version: before.version, no_code: true, github_repo: "o/r" })).json()) as { field: string }).field, "no_code");
  assert.deepEqual(gitCalls, []);
  // A version that moved is refused too.
  assert.equal(((await (await put("/code", { version: before.version - 1, github_repo: "o/r" })).json()) as { error: string }).error, "STALE_VERSION");
});

test("NEWPROJ-6: only GitHub drops the folder, keeps the token's variable name, and no code clears both", async () => {
  await raw.query(`update projects set settings = jsonb_set(settings, '{github,token_env}', '"RECETARIO_GH_TOKEN"') where slug = $1`, [SLUG]);
  let s = await read();
  const res = await put("/code", { version: s.version, github_repo: "o/recetario-2" });
  assert.equal(res.status, 200, await res.clone().text());
  let db = await stored();
  assert.equal(db.settings.local, undefined);
  assert.deepEqual(db.settings.github, { repo: "o/recetario-2", token_env: "RECETARIO_GH_TOKEN" });
  s = (await res.json()) as SettingsRead;
  // PLA-I2-6: the code section carries no token field. PLA-133: the variable's NAME is edited on Despliegue's GitHub
  // card now, not in «Avanzado».
  assert.equal(JSON.stringify(s.code).includes("token"), false, "the code section never carries a token field");
  assert.equal(s.avanzado.some((f) => (f.field as string) === "github_token_env"), false);
  assert.equal((await put("/code", { version: s.version, no_code: true })).status, 200);
  db = await stored();
  assert.deepEqual(db.settings.local, { no_code: true });
  assert.equal(db.settings.github, undefined);
});

test("NEWPROJ-6: no control takes a secret where a variable name goes: token fields are not in any body", async () => {
  const { version } = await stored();
  for (const [p, body] of [
    ["/code", { version, github_repo: "o/r", token_env: "ghp_123456789012345678901234567890123456" }],
    ["/code", { version, github_repo: "o/r", token: "ghp_123456789012345678901234567890123456" }],
    ["/release", { version, release: { from: "sandbox", into: "main", env: "prod", token_env: "x" } }],
    ["/verify", { version, commands: ["pnpm test"], env: { TOKEN: "x" } }],
  ] as const) {
    const res = await put(p, body);
    assert.equal(res.status, 400, `${p} ${JSON.stringify(body)}`);
    assert.equal(((await res.json()) as { error: string }).error, "INVALID_BODY");
  }
  assert.equal((await stored()).version, version);
  // The wording names no field for a token at all.
  assert.equal(JSON.stringify(aj).toLowerCase().includes("token"), false);
});

test("NEWPROJ-6: the release step is validated as set_project does, saved, and taken away with null", async () => {
  let { version } = await stored();
  const ev = await lastEvent();
  const bad = await put("/release", { version, release: { from: "main", into: "main", env: "prod" } });
  assert.equal(bad.status, 400);
  assert.deepEqual((await bad.json()) as object, { error: "INVALID_FILTER", field: "settings.release", hint: "from and into are different branches" });
  assert.equal(((await (await put("/release", { version, release: { from: "sandbox", into: "main", env: "Prod" } })).json()) as { error: string }).error, "INVALID_FILTER");
  assert.deepEqual(await eventsSince(ev), []);
  const res = await put("/release", { version, release: { from: "sandbox", into: "main", env: "prod", mode: "merge" } });
  assert.equal(res.status, 200, await res.clone().text());
  assert.deepEqual(((await res.json()) as SettingsRead).release, { from: "sandbox", into: "main", env: "prod", mode: "merge", prod_migrations: null });
  assert.deepEqual((await stored()).settings.release, { from: "sandbox", into: "main", env: "prod", mode: "merge" });
  // mode command is the default and is not stored.
  ({ version } = await stored());
  await put("/release", { version, release: { from: "sandbox", into: "main", env: "prod", mode: "command" } });
  assert.deepEqual((await stored()).settings.release, { from: "sandbox", into: "main", env: "prod" });
  assert.deepEqual((await eventsSince(ev)).map((e) => e.type), ["project.updated", "project.updated"]);
  ({ version } = await stored());
  assert.equal((await put("/release", { version, release: null })).status, 200);
  assert.equal((await stored()).settings.release, undefined);
});

test("NEWPROJ-6: the verify list is one command per line; names come from the command and the rest of settings.qa stays", async () => {
  await raw.query(`update projects set settings = settings || '{"qa": {"enabled": true, "model": "opus", "verify": [{"name": "unit", "command": "pnpm test", "timeout_minutes": 9}]}}'::jsonb where slug = $1`, [SLUG]);
  let { version } = await stored();
  const ev = await lastEvent();
  const res = await put("/verify", { version, commands: ["pnpm test", "", "  pnpm exec tsc --noEmit  ", "pnpm lint"] });
  assert.equal(res.status, 200, await res.clone().text());
  const qa = (await stored()).settings.qa;
  assert.deepEqual(qa, {
    enabled: true,
    model: "opus",
    verify: [
      { name: "unit", command: "pnpm test", timeout_minutes: 9 },
      { name: "tsc", command: "pnpm exec tsc --noEmit" },
      { name: "lint", command: "pnpm lint" },
    ],
  });
  assert.deepEqual(((await res.json()) as SettingsRead).verify.map((v) => v.command), ["pnpm test", "pnpm exec tsc --noEmit", "pnpm lint"]);
  assert.deepEqual((await eventsSince(ev)).map((e) => e.type), ["project.updated"]);
  // set_project's own check refuses a list it would refuse from MCP (a command too long).
  ({ version } = await stored());
  const long = await put("/verify", { version, commands: ["x".repeat(301)] });
  assert.equal(long.status, 400);
  // An empty list empties it; the readiness item follows.
  assert.equal((await put("/verify", { version, commands: [] })).status, 200);
  assert.deepEqual((await stored()).settings.qa.verify, []);
});

test("NEWPROJ-6: verify names are short, unique and set_project's shape", () => {
  assert.equal(verifyName("pnpm test"), "test");
  assert.equal(verifyName("npx playwright test --project=chromium"), "playwright");
  assert.equal(verifyName("./scripts/check.sh"), "check-sh");
  assert.equal(verifyName("--"), "paso");
  assert.deepEqual(
    verifyItems(["pnpm test", "pnpm test:unit", "npm test"]).map((v) => v.name),
    ["test", "test-unit", "test 2"],
  );
});

test("NEWPROJ-6: the preview address and plan approval use the options route; the read shows them", async () => {
  const res = await app.request(`/api/company/projects/${SLUG}/options`, { method: "PUT", headers: jorge(), body: JSON.stringify({ preview_url: "https://recetario.example.com", plan_approval: false }) });
  assert.equal(res.status, 200, await res.clone().text());
  const s = await read();
  assert.equal(s.preview_url, "https://recetario.example.com");
  assert.equal(s.plan_approval, false);
  assert.equal((await stored()).settings.preview_url, "https://recetario.example.com");
  const bad = await app.request(`/api/company/projects/${SLUG}/options`, { method: "PUT", headers: jorge(), body: JSON.stringify({ preview_url: "javascript:alert(1)" }) });
  assert.equal(bad.status, 400);
});

test("NEWPROJ-6: each context doc is created from its template, edited with its version, and a stale version is refused", async () => {
  for (const id of ["glossary", "commands", "map"] as const) {
    const s = await read();
    const c = s.context.find((x) => x.id === id)!;
    assert.equal(c.doc_id, null);
    const ev = await lastEvent();
    const made = await put(`/context/${id}`, { markdown: c.template });
    assert.equal(made.status, 200, await made.clone().text());
    const after1 = ((await made.json()) as SettingsRead).context.find((x) => x.id === id)!;
    assert.ok(after1.doc_id);
    assert.equal(after1.version, 1);
    assert.equal(after1.markdown, c.template);
    // Creating twice is refused: the doc is there.
    assert.equal(((await (await put(`/context/${id}`, { markdown: "otra" })).json()) as { error: string }).error, "DOC_EXISTS");
    const edited = await put(`/context/${id}`, { markdown: `# ${id}\n\nEditado.`, version: 1 });
    assert.equal(edited.status, 200);
    assert.equal(((await edited.json()) as SettingsRead).context.find((x) => x.id === id)!.version, 2);
    // A second screen still holding version 1 is refused, not overwritten.
    const stale = await put(`/context/${id}`, { markdown: "pisado", version: 1 });
    assert.equal(stale.status, 409);
    assert.deepEqual((await stale.json()) as object, { error: "STALE_VERSION", current_version: 2 });
    const doc = (await raw.query(`select markdown, version from docs where id = $1`, [after1.doc_id])).rows[0];
    assert.deepEqual(doc, { markdown: `# ${id}\n\nEditado.`, version: 2 });
    assert.deepEqual((await eventsSince(ev)).map((e) => e.type), ["doc.put", "doc.put"]);
  }
  assert.equal((await put("/context/otro", { markdown: "x" })).status, 404);
  const r = (await (await app.request(`/api/company/projects/${SLUG}/readiness`, { headers: jorge() })).json()) as { items: { id: string; state: string }[] };
  assert.deepEqual(r.items.filter((i) => i.id.startsWith("context.")).map((i) => i.state), ["ready", "ready", "ready"]);
});

// ---- wording (ui/src/lib/ajustes.ts), no browser

test("NEWPROJ-6: the view's refusals are plain Spanish, never the code", () => {
  for (const code of ["REPO_FOLDER_MISSING", "REPO_NOT_GIT", "REPO_NO_ORIGIN", "REPO_ORIGIN_UNREACHABLE", "REPO_NO_START_BRANCH", "STALE_VERSION", "DOC_EXISTS", "INVALID_FILTER", "INVALID_BODY", "HTTP_500"]) {
    const line = aj.ajustesError(code, { path: "/Users/o/r", branch: "sandbox", field: "settings.release", hint: "from and into are different branches" });
    assert.ok(line.startsWith("No se guardó"), `${code}: ${line}`);
    assert.equal(line.includes(code), false, code);
    assert.equal(/sandbox|PLA-|NEWPROJ/i.test(line), false, `${code}: ${line}`);
  }
  assert.match(aj.ajustesError("REPO_NOT_GIT", { path: "/Users/o/r" }), /\/Users\/o\/r tiene archivos pero no es un repositorio/);
  assert.match(aj.ajustesError("STALE_VERSION", {}), /cambió/);
  assert.match(aj.ajustesError(null), /No se guardó/);
});

test("NEWPROJ-6: the verify lines are checked before sending", () => {
  assert.deepEqual(aj.comandos("pnpm test\n\n  pnpm lint \n"), ["pnpm test", "pnpm lint"]);
  assert.equal(aj.comandosAviso(aj.comandos("a\nb\nc\nd\ne\nf\ng\nh\ni")), "Caben 8 comandos como máximo.");
  assert.equal(aj.comandosAviso(["x".repeat(301)]), "Cada comando cabe en 300 caracteres.");
  assert.equal(aj.comandosAviso(["pnpm test"]), null);
});

test("NEWPROJ-6: each context doc and the readiness items it fixes have their words", () => {
  for (const id of ["glossary", "commands", "map"]) {
    const w = aj.CONTEXTO[id as keyof typeof aj.CONTEXTO];
    assert.ok(w.titulo && w.para, id);
    assert.ok((READINESS_IDS as readonly string[]).includes(`context.${id}`));
  }
  assert.equal(aj.contextoEstado({ doc_id: null, markdown: "" }), "No existe todavía.");
  assert.match(aj.contextoEstado({ doc_id: "x", markdown: "  " }), /vacío/);
  assert.match(aj.contextoEstado({ doc_id: "x", markdown: "# a\nb\nc" }), /3 líneas/);
});
