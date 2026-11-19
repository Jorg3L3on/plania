// PLA-I2-6: the one list of project settings (src/mcp/settings-registry.ts) and the screen's controls for it: every
// key the screen writes is in SETTING_KEYS, every key has a control and every advanced one a reason in the README; no
// control takes a secret; a new project ships from the screen; how the app starts and «Avanzado» save through
// set_project; the company's per-run limits; the readiness list links each missing item to its control.
// Git and the filesystem are injected; no real git runs. Throwaway DB and kit.
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";

const TMP = mkdtempSync(path.join(tmpdir(), "plania-i2-6-"));
const kit = path.join(TMP, "kit");
mkdirSync(path.join(kit, "roles"), { recursive: true });
for (const r of ["product-owner", "research", "artist", "taller"]) writeFileSync(path.join(kit, "roles", `${r}.md`), `# ${r}\n\nFixture prompt.\n`);
cpSync(path.resolve(import.meta.dirname, "../kit/context"), path.join(kit, "context"), { recursive: true });
process.env.PLANIA_KIT_DIR = kit;
process.env.PLANIA_CAPTURES_DIR = path.join(TMP, "captures");
delete process.env.PLANIA_PROMPTS_PROJECT;
useTestEnv();
const { makeDb } = await import("../src/db/client.js");
const { app } = await import("../src/app.js");
const { setNewProjectRepoCheck, setReadinessDeps } = await import("../src/api/company.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const reg = await import("../src/mcp/settings-registry.js");
const { advancedWithoutField, AVANZADO_FIELDS } = await import("../src/api/settings-avanzado.js");
const { setProject } = await import("../src/mcp/project.js");
const { READINESS_IDS } = await import("../src/runner/readiness.js");
const { NEW_PROJECT_RELEASE } = await import("../src/runner/new-project.js");
const { withTable } = await import("../scripts/settings-table.js");
const listo = await import("../ui/src/lib/listo.js");
const av = await import("../ui/src/lib/ajustes-avanzado.js");
const aj = await import("../ui/src/lib/ajustes.js");
const lc = await import("../ui/src/lib/limites-corrida.js");
type GitFn = import("../src/runner/worktree.js").GitFn;
type SettingsRead = import("../src/api/project-settings.js").SettingsRead;

type Db = ReturnType<typeof makeDb>["db"];
let raw: pg.Client;
let db: Db;
let closeDb: () => Promise<void>;
const ROOT = path.resolve(import.meta.dirname, "..");
const jorge = () => ({ Cookie: `${SESSION_COOKIE}=${createSession()}`, "Content-Type": "application/json" });
const SLUG = "cocina";
const base = `/api/company/projects/${SLUG}/settings`;
const put = (p: string, body: unknown) => app.request(`${base}${p}`, { method: "PUT", headers: jorge(), body: JSON.stringify(body) });
const read = async (): Promise<SettingsRead> => (await (await app.request(base, { headers: jorge() })).json()) as SettingsRead;
const stored = async (slug = SLUG) => (await raw.query(`select settings, version from projects where slug = $1`, [slug])).rows[0] as { settings: Record<string, any>; version: number };
const ctx = { actor: { agent: "test", session_id: "s", machine: "m", model: "x" }, human: false, tool: "set_project" } as never;

function fakeGit() {
  const fn: GitFn = async (args) => {
    if (args[0] === "rev-parse") return { code: 0, stdout: "true\n", stderr: "" };
    if (args[0] === "remote") return { code: 0, stdout: "git@github.com:o/r.git\n", stderr: "" };
    if (args[0] === "ls-remote") return { code: 0, stdout: "abc\trefs/heads/sandbox\n", stderr: "" };
    return { code: 1, stdout: "", stderr: "unexpected" };
  };
  return { git: fn, isDir: () => true };
}

before(async () => {
  raw = await resetTestDb();
  ({ db, close: closeDb } = makeDb() as { db: Db; close: () => Promise<void> });
  setNewProjectRepoCheck(fakeGit());
  // PLA-I2-5: readiness asks gh whether the repository can be reached; injected, never the real gh.
  setReadinessDeps({ repoCheck: fakeGit(), env: { ...process.env, PLANIA_RUNNER_TOKEN: "x" }, exists: () => true, githubAccess: async () => "ok" as const });
  for (const body of [
    { name: "Cocina", goal: "Recetas en un minuto.", repo_path: "/Users/o/cocina" },
    { name: "Huerto", goal: "Un huerto en casa.", no_code: true },
  ]) {
    const res = await app.request("/api/company/projects", { method: "POST", headers: jorge(), body: JSON.stringify(body) });
    assert.equal(res.status, 201, await res.clone().text());
  }
});

after(async () => {
  setNewProjectRepoCheck(null);
  setReadinessDeps(null);
  await closeDb?.();
  await raw?.end();
  rmSync(TMP, { recursive: true, force: true });
});

// ---- check 2: one list; every key the screen writes is in it; every key has a control; advanced ones in the README

const filesUnder = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? filesUnder(p) : p.endsWith(".ts") ? [p] : [];
  });

test("PLA-I2-6 check 2: every settings key the server writes outside set_project is in SETTING_KEYS", () => {
  const keys = new Set<string>(reg.SETTING_KEYS);
  const found = new Map<string, string>();
  for (const file of filesUnder(path.join(ROOT, "src")).filter((f) => !f.endsWith(path.join("db", "schema.ts")))) {
    const text = readFileSync(file, "utf8");
    // settings.<key> = …, { ...p.settings, <key>: … }, jsonb_build_object('<key>', …) on projects.settings
    for (const m of text.matchAll(/\bsettings\.([a-z_]+)\s*=(?!=)/g)) found.set(m[1]!, file);
    for (const m of text.matchAll(/\.\.\.p\.settings,\s*([a-z_]+):/g)) found.set(m[1]!, file);
    for (const m of text.matchAll(/projects\.settings[^;]*jsonb_build_object\('([a-z_]+)'/g)) found.set(m[1]!, file);
  }
  assert.ok(found.size >= 2, "the scan finds the screen's own writes (next_first, runner)");
  for (const [k, file] of found) assert.ok(keys.has(k), `${path.relative(ROOT, file)} writes settings.${k}, which is not in SETTING_KEYS`);
});

// The owner's screen: the context the cookie-gated routes pass (src/api/project-settings.ts settingsCtx).
const screen = { actor: { agent: "owner", session_id: "web", machine: "screen" }, human: true, tool: "screen.settings" } as never;

test("PLA-I2-6 check 2: set_project from the screen accepts the keys the screen writes, and still refuses an unknown one", async () => {
  const p = await stored("huerto");
  const out = await setProject(
    db,
    { project: "huerto", version: p.version, settings: { plan_approval: false, preview_url: "https://huerto.example.com", auto_accept: true, auto_accept_invisible: true, runner: { max_concurrent: 2 }, team: { idle_minutes: 30 } } },
    screen,
  );
  assert.equal((out.settings as Record<string, unknown>).preview_url, "https://huerto.example.com");
  await assert.rejects(setProject(db, { project: "huerto", version: out.version, settings: { colour: "red" } }, screen), /INVALID_FILTER/);
  await assert.rejects(setProject(db, { project: "huerto", version: out.version, settings: { preview_url: "huerto" } }, screen), /INVALID_FILTER/);
  await setProject(db, { project: "huerto", version: out.version, settings: { plan_approval: true, auto_accept: false, auto_accept_invisible: false, preview_url: null, runner: null } }, screen);
});

// A valid value for each owner-only key; the test fails when a key is marked owner-only without one here.
const OWNER_ONLY_SAMPLE: Record<string, unknown> = {
  preview_url: "https://huerto.example.com",
  plan_approval: false,
  auto_accept: true,
  auto_accept_invisible: true,
  runner: { max_concurrent: 4 },
  next_first: "HUE-1",
};

test("PLA-I2-6: every owner-only key is refused from an agent (INVALID_FILTER, nothing written) and taken from the screen", async () => {
  assert.deepEqual([...reg.OWNER_ONLY_KEYS].sort(), ["auto_accept", "auto_accept_invisible", "next_first", "plan_approval", "preview_url", "runner"]);
  for (const k of reg.OWNER_ONLY_KEYS) {
    assert.ok(k in OWNER_ONLY_SAMPLE, `a sample value for ${k}`);
    const value = OWNER_ONLY_SAMPLE[k];
    const before = await stored("huerto");
    await assert.rejects(setProject(db, { project: "huerto", version: before.version, settings: { [k]: value } }, ctx), /INVALID_FILTER/, `${k} from an agent`);
    // Clearing one is weakening it too (plan_approval null is off).
    await assert.rejects(setProject(db, { project: "huerto", version: before.version, settings: { [k]: null } }, ctx), /INVALID_FILTER/, `${k}: null from an agent`);
    assert.equal((await stored("huerto")).version, before.version, `${k}: nothing written`);
    const out = await setProject(db, { project: "huerto", version: before.version, settings: { [k]: value } }, screen);
    assert.deepEqual((out.settings as Record<string, unknown>)[k], value, `${k} from the screen`);
  }
  // Keys that are not owner-only stay open to agents.
  const p = await stored("huerto");
  await setProject(db, { project: "huerto", version: p.version, settings: { claim_from: "ready" } }, ctx);
  for (const k of reg.OWNER_ONLY_KEYS) assert.ok(readFileSync(path.join(ROOT, "README.md"), "utf8").includes(`| \`${k}\` |`), `README lists ${k} as owner-only`);
});

test("PLA-I2-6 check 2: every key has a control and a sentence; every advanced key has a field, a reason, a Spanish default and a README row", () => {
  for (const k of reg.SETTING_KEYS) {
    const d: import("../src/mcp/settings-registry.js").SettingDef = reg.SETTINGS[k];
    assert.ok(d.control, `${k} has a control`);
    assert.ok(d.frase.trim() && d.default.trim(), `${k} has a sentence and a default`);
    if (d.tier === "advanced") {
      assert.equal(d.control, "ajustes.avanzado", `${k}: an advanced key lives in «Avanzado»`);
      assert.ok(d.reason?.trim(), `${k}: an advanced key says why it can be left alone`);
      assert.ok(d.defecto?.trim(), `${k}: an advanced key says its default in Spanish`);
    }
  }
  assert.deepEqual(advancedWithoutField(), [], "every advanced key has a field in «Avanzado»");
  for (const f of AVANZADO_FIELDS) assert.ok(av.AVANZADO_ETIQUETAS[f], `«Avanzado» has a label for ${f}`);
  // The screen's sections that the registry names exist in the Ajustes view.
  const view = ["ajustes.tsx", "ajustes-avanzado.tsx"].map((f) => readFileSync(path.join(ROOT, "ui/src/components/corriente", f), "utf8")).join("\n");
  for (const c of new Set(reg.SETTING_KEYS.map((k) => reg.SETTINGS[k].control).filter((c) => c.startsWith("ajustes.")))) {
    assert.match(view, new RegExp(`(id|data-ajustes)="${c.slice("ajustes.".length)}"`), `the Ajustes view has the section ${c}`);
  }
  // The README's table is the registry's.
  const readme = readFileSync(path.join(ROOT, "README.md"), "utf8");
  assert.equal(withTable(readme).replace(/\r\n/g, "\n"), readme.replace(/\r\n/g, "\n"), "README's advanced table is stale: pnpm exec tsx scripts/settings-table.ts");
  for (const k of reg.ADVANCED_KEYS) assert.ok(readme.includes(`| \`${k}\` |`), `README lists ${k}`);
});

// ---- check 3: no control accepts a secret value

test("PLA-I2-6 check 3: no control takes a secret: token fields take a variable's name, a secret-shaped value is refused unwritten", async () => {
  // github first, so the token variable has a repo to sit on.
  let s = await read();
  let res = await put("/code", { version: s.version, repo_path: "/Users/o/cocina", github_repo: "o/cocina" });
  assert.equal(res.status, 200, await res.clone().text());
  s = await read();
  const before = await stored();
  const refusals: [string, unknown, string][] = [
    ["github_token_env", "ghp_abcdefghijklmnopqrstuvwxyz0123456789", "SECRET_VALUE"],
    ["github_token_env", "my token", "NOT_A_VARIABLE_NAME"],
    ["vercel", { project_id: "prj_1", token_env: "abc123secret" }, "NOT_A_VARIABLE_NAME"],
    ["vercel", { project_id: "prj_1", note: "sk-ant-abcdefghijklmnopqrstuvwxyz" }, "SECRET_VALUE"],
    ["maquinas", { migrate: "psql postgres://app:hunter2@db.example.com/app -f m.sql" }, "SECRET_VALUE"],
  ];
  for (const [field, value, code] of refusals) {
    res = await put("/advanced", { version: s.version, field, value });
    assert.equal(res.status, 400, `${field} ${JSON.stringify(value)}`);
    assert.equal(((await res.json()) as { error: string }).error, code);
  }
  res = await put("/capture", { version: s.version, capture: { start_command: "GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123456789 pnpm dev", port: 3000, install_command: null, ready_path: null, pages: [{ path: "/", label: "Inicio" }] } });
  assert.equal(res.status, 400);
  assert.equal((await stored()).version, before.version, "nothing was written");
  // set_project itself refuses a token_env that is not a variable's name.
  await assert.rejects(setProject(db, { project: SLUG, version: before.version, settings: { github: { repo: "o/cocina", token_env: "ghp_x" } } }, ctx), /INVALID_FILTER/);
  // A name is taken, and the screen shows it back.
  res = await put("/advanced", { version: s.version, field: "github_token_env", value: "COCINA_GITHUB_TOKEN" });
  assert.equal(res.status, 200, await res.clone().text());
  assert.deepEqual((await stored()).settings.github, { repo: "o/cocina", token_env: "COCINA_GITHUB_TOKEN" });
  assert.equal(av.avanzadoValor("env", "ghp_abc").ok, false);
  assert.match(aj.ajustesError("SECRET_VALUE"), /nunca va su valor/);
});

// ---- check 4: a new project ships from the screen

test("PLA-I2-6 check 4: a new project with code ships from the screen (mode merge); one with no code has no release step", async () => {
  const cocina = await stored();
  assert.deepEqual(cocina.settings.release, NEW_PROJECT_RELEASE);
  assert.equal(cocina.settings.release.mode, "merge");
  assert.equal((await stored("huerto")).settings.release, undefined);
  const s = await read();
  assert.equal(s.release?.mode, "merge", "Ajustes shows it as shipping from Plania");
  const plan = await app.request(`/api/projects/${SLUG}/release`, { headers: jorge() });
  if (plan.status === 200) {
    const body = (await plan.json()) as { mode?: string; release?: { mode?: string } };
    assert.equal(body.mode ?? body.release?.mode, "merge");
  }
});

// ---- Avanzado and how the app starts, through set_project

test("PLA-I2-6: «Avanzado» fields save through set_project, and empty puts the default back", async () => {
  let s = await read();
  assert.deepEqual(
    s.avanzado.map((f) => f.field),
    [...AVANZADO_FIELDS],
  );
  const save = async (field: string, value: unknown) => {
    const res = await put("/advanced", { version: s.version, field, value });
    assert.equal(res.status, 200, `${field}: ${await res.clone().text()}`);
    s = (await res.json()) as SettingsRead;
  };
  await save("claim_from", "ready");
  // PLA-I2-5's working branch lives here: a name is taken, a protected branch is refused, empty is the default.
  await save("start_branch", "pruebas");
  assert.equal((await stored()).settings.start_branch, "pruebas");
  assert.notEqual((await put("/advanced", { version: s.version, field: "start_branch", value: "main" })).status, 200);
  await save("start_branch", null);
  assert.equal((await stored()).settings.start_branch, undefined);
  await save("team", 30);
  await save("auto_done", false);
  // QA's other switches keep the verify list.
  await put("/verify", { version: s.version, commands: ["pnpm test"] });
  s = await read();
  await save("qa", { browser: true });
  let st = (await stored()).settings;
  assert.equal(st.claim_from, "ready");
  assert.deepEqual(st.team, { idle_minutes: 30 });
  assert.equal(st.auto_done, false);
  assert.deepEqual(st.qa, { browser: true, verify: [{ name: "test", command: "pnpm test" }] });
  await save("claim_from", null);
  await save("auto_done", null);
  st = (await stored()).settings;
  assert.equal(st.claim_from, undefined);
  assert.equal(st.auto_done, undefined);
  assert.equal(s.avanzado.find((f) => f.field === "team")?.value, 30);
  const res = await put("/advanced", { version: s.version, field: "qa", value: { verify: [] } });
  assert.equal(res.status, 400, "the verify list is not edited from «Avanzado»");
});

test("PLA-I2-6: how the app starts is edited from Ajustes; page keys and flags stay with their path", async () => {
  let s = await read();
  await setProject(
    db,
    { project: SLUG, version: s.version, settings: { capture: { start_command: "pnpm dev", port: 3000, pages: [{ key: "inicio", path: "/", label: "Inicio" }, { key: "cuenta", path: "/cuenta", label: "Cuenta", full_page: true }], ui_globs: ["src/**"] } } },
    ctx,
  );
  s = await read();
  assert.deepEqual(s.capture, { start_command: "pnpm dev", port: 3000, install_command: null, ready_path: null, pages: [{ path: "/", label: "Inicio" }, { path: "/cuenta", label: "Cuenta" }] });
  const form = av.arranqueForm(s.capture);
  const out = av.arranqueBody({ ...form, start_command: "pnpm exec vite --port {port}", port: "5180", pages: "/cuenta Mi cuenta\n/recetas Recetas" });
  assert.ok(out.ok);
  const res = await put("/capture", { version: s.version, capture: out.capture });
  assert.equal(res.status, 200, await res.clone().text());
  const c = (await stored()).settings.capture;
  assert.equal(c.start_command, "pnpm exec vite --port {port}");
  assert.equal(c.port, 5180);
  assert.deepEqual(c.pages, [
    { key: "cuenta", path: "/cuenta", label: "Mi cuenta", full_page: true },
    { key: "recetas", path: "/recetas", label: "Recetas" },
  ]);
  assert.deepEqual(c.ui_globs, ["src/**"], "what the form does not show is kept");
  assert.deepEqual(av.arranqueBody({ ...form, port: "80" }), { ok: false, aviso: "El puerto va de 1024 a 65535." });
  assert.equal(av.paginas("cuenta Cuenta"), null);
});

// ---- the options route goes through set_project too

test("PLA-I2-6: the preview address and plan approval are written through set_project (a version and an event)", async () => {
  const before = await stored("huerto");
  const res = await app.request(`/api/company/projects/huerto/options`, { method: "PUT", headers: jorge(), body: JSON.stringify({ preview_url: null, plan_approval: true }) });
  assert.equal(res.status, 200, await res.clone().text());
  const after = await stored("huerto");
  assert.equal(after.version, before.version + 1);
  assert.equal(after.settings.preview_url, undefined);
  assert.equal(after.settings.plan_approval, true);
});

// ---- company limits

test("PLA-I2-6: the per-run limits have controls with the route's bounds and the table's defaults", async () => {
  assert.equal(lc.limiteValor("max_turns", "0"), null);
  assert.equal(lc.limiteValor("max_turns", "60"), 60);
  assert.equal(lc.limiteValor("cooldown_minutes", "0"), 0);
  assert.equal(lc.limiteValor("timeout_minutes", "601"), null);
  assert.equal(lc.limiteValor("timeout_minutes", "4.5"), null);
  const res = await app.request("/api/company/settings", { method: "PUT", headers: jorge(), body: JSON.stringify({ max_turns: 60, timeout_minutes: 30, cooldown_minutes: 0 }) });
  assert.equal(res.status, 200, await res.clone().text());
  assert.deepEqual((await raw.query(`select max_turns, timeout_minutes, cooldown_minutes from runner_settings where id = 1`)).rows[0], { max_turns: 60, timeout_minutes: 30, cooldown_minutes: 0 });
  // The defaults the screen states are the table's.
  const d = (await raw.query(`select column_name, column_default from information_schema.columns where table_name = 'runner_settings' and column_name in ('max_turns','timeout_minutes','cooldown_minutes')`)).rows as { column_name: string; column_default: string }[];
  for (const r of d) assert.equal(Number(r.column_default), lc.LIMITES_CORRIDA[r.column_name as "max_turns"].defecto, r.column_name);
});

// ---- check 1: a new install reaches «listo» from the screen

// Items with no control in Ajustes and who settles them without .env or an MCP tool: the seats' prompts ship in
// kit/roles (PLA-I2-2, PLA-I2-20), the runner token is made at first start (PLA-I2-2), the claude program is the
// installer's and the machine check's (PLA-I2-1, PLA-I2-12).
const NOT_IN_AJUSTES = (id: string) => id.startsWith("prompt.") || id === "runner_token" || id === "claude_bin";

test("PLA-I2-6 check 1: every readiness item is set from Ajustes or needs no setting; none says to edit .env", () => {
  for (const id of READINESS_IDS) {
    if (NOT_IN_AJUSTES(id)) continue;
    assert.ok(listo.listoAjuste(id), `${id} links to its control in Ajustes`);
  }
  for (const id of READINESS_IDS) {
    const t = listo.listoLinea({ id, state: "missing", blocks: true }).texto;
    assert.doesNotMatch(t, /PLANIA_RUNNER_TOKEN|\.env|set_project/, `${id}: «${t}»`);
  }
});

test("PLA-I2-6 check 1: a new project reaches «listo» with the screen's own writes only", async () => {
  let s = await read();
  for (const id of ["glossary", "commands", "map"] as const) {
    const res = await put(`/context/${id}`, { markdown: `# ${id}\n\nAlgo que el equipo debe saber.\n` });
    assert.equal(res.status, 200, await res.clone().text());
  }
  s = await read();
  const r = (await (await app.request(`/api/company/projects/${SLUG}/readiness`, { headers: jorge() })).json()) as { items: { id: string; state: string }[]; blocking: number };
  const missing = r.items.filter((i) => i.state === "missing").map((i) => i.id);
  assert.deepEqual(missing, [], `still missing: ${missing.join(", ")}`);
  assert.equal(r.blocking, 0);
  assert.ok(s.version > 1);
});
