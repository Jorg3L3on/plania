// PLA-I2-2: first start without hand-made rows. From a database built only from the migrations (no project, no
// agent, no password, no runner token in the env, PLANIA_JOBS unset) the first-start screen makes the owner, and a
// request on a new project starts a run with the fake Claude: no hash-password, seed-org, /tokens, .env edit or
// restart. Throwaway DB and kit; every process is a fake child.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { after, before, beforeEach, test } from "node:test";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";

const scratch = mkdtempSync(path.join(tmpdir(), "plania-i2-2-"));
const kit = path.join(scratch, "kit");
mkdirSync(path.join(kit, "roles"), { recursive: true });
for (const r of ["product-owner", "research", "artist", "taller"]) writeFileSync(path.join(kit, "roles", `${r}.md`), `# ${r}\n\nFixture prompt.\n`);
process.env.PLANIA_KIT_DIR = kit;
useTestEnv();
// A new install: none of the values a hand-made install pastes into .env.
for (const k of ["PLANIA_JOBS", "PLANIA_EVENT_WAKES", "PLANIA_PASSWORD_HASH", "PLANIA_RUNNER_TOKEN", "PLANIA_BRIEF_TOKEN", "PLANIA_TZ", "PLANIA_HOME_PROJECT", "PLANIA_PROMPTS_PROJECT", "PLANIA_CEO_NAME"]) delete process.env[k];

const { makeDb } = await import("../src/db/client.js");
const { app } = await import("../src/app.js");
const { SESSION_COOKIE } = await import("../src/auth/session.js");
const { hashPassword } = await import("../src/auth/password.js");
const limit = await import("../src/auth/login-limit.js");
const state = await import("../src/install-state.js");
const { issueSetupCode } = await import("../src/db/install.js");
const { jobsToStart } = await import("../src/jobs/index.js");
const { eventWakesEnabled } = await import("../src/runner/events.js");
const { ownerGivenName, resetOwnerName } = await import("../src/owner.js");
const runner = await import("../src/runner/runner.js");
const { waitForAskWakes } = await import("../src/api/company-actions.js");

type Json = Record<string, any>;
let raw: pg.Client;
let db: ReturnType<typeof makeDb>["db"];
let closeDb: () => Promise<void>;
const CODE = "ABCD-EFGH-JKMN";
const PASSWORD = "una contraseña larga";
const LOOPBACK = { incoming: { socket: { remoteAddress: "127.0.0.1" } } };
const REMOTE = { incoming: { socket: { remoteAddress: "100.64.0.7" } } };
const json = { "Content-Type": "application/json" };
const form = (over: Json = {}) => ({ code: CODE, name: "Ana", password: PASSWORD, time_zone: "Europe/Madrid", ...over });
const firstStart = (body: Json, env: unknown = LOOPBACK, headers: Record<string, string> = {}) =>
  app.request("http://localhost:3737/api/first-start", { method: "POST", headers: { ...json, ...headers }, body: JSON.stringify(body) }, env);
const login = (password: string) => app.request("/api/login", { method: "POST", headers: json, body: JSON.stringify({ password }) });
let cookie = "";
const signedIn = () => ({ Cookie: cookie, ...json });
const get = (url: string) => app.request(url, { headers: signedIn() });
const post = (url: string, body: unknown = {}) => app.request(url, { method: "POST", headers: signedIn(), body: JSON.stringify(body) });
const count = async (q: string) => (await raw.query(q)).rows[0].n as number;
const envFile = path.join(scratch, ".env");

class FakeChild extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  constructor(readonly pid: number) {
    super();
  }
  finish(): void {
    const result = { type: "result", subtype: "success", is_error: false, num_turns: 1, session_id: "sess-i2-2", result: "OK", modelUsage: {} };
    this.stdout.write(`${JSON.stringify(result)}\n`);
    this.stdout.end();
    setImmediate(() => this.emit("exit", 0, null));
  }
}

before(async () => {
  raw = await resetTestDb();
  await raw.query(`delete from projects`);
  ({ db, close: closeDb } = makeDb());
  state.resetInstallState();
  resetOwnerName();
});

beforeEach(() => limit.resetLimits());

after(async () => {
  await runner.waitForAllRuns();
  state.resetInstallState();
  await closeDb?.();
  await raw?.end();
  rmSync(scratch, { recursive: true, force: true });
});

test("I2-2: the install command stores a one-time code while no owner exists", async () => {
  assert.equal(await count(`select count(*)::int as n from agents`), 0, "a migrations-only database has no agent");
  writeFileSync(envFile, "DATABASE_URL=x\n");
  // Each run of the install replaces the code; the last one printed is the one that works.
  assert.equal(await issueSetupCode(raw, envFile, () => "ZZZZ-ZZZZ-ZZZZ"), "ZZZZ-ZZZZ-ZZZZ");
  assert.equal(await issueSetupCode(raw, envFile, () => CODE), CODE);
  const row = (await raw.query(`select setup_code_hash from install_state`)).rows[0];
  assert.equal(row.setup_code_hash, state.hashSetupCode(CODE), "only the hash is stored");
  assert.notEqual(row.setup_code_hash, CODE);
  // An install with a password in .env (the existing one) gets no code.
  writeFileSync(path.join(scratch, ".env.hand"), "PLANIA_PASSWORD_HASH=$argon2id$x\n");
  assert.equal(await issueSetupCode(raw, path.join(scratch, ".env.hand"), () => "NOPE-NOPE-NOPE"), null);
  assert.equal((await raw.query(`select setup_code_hash from install_state`)).rows[0].setup_code_hash, state.hashSetupCode(CODE));
});

test("I2-2 #2: first start refuses without the code, from a non-loopback address and through a proxy", async () => {
  const open = await app.request("http://localhost:3737/api/first-start", {}, LOOPBACK);
  assert.deepEqual(await open.json(), { open: true, loopback: true });
  // The login page sends the owner here: the screen reads `open` without a session.
  assert.equal((await login(PASSWORD)).status, 401);

  const noCode = await firstStart(form({ code: "" }));
  assert.equal(noCode.status, 403);
  assert.equal(((await noCode.json()) as Json).error, "SETUP_CODE_INVALID");
  const wrong = await firstStart(form({ code: "ABCD-EFGH-XXXX" }));
  assert.equal(((await wrong.json()) as Json).error, "SETUP_CODE_INVALID");

  const remote = await firstStart(form(), REMOTE);
  assert.equal(remote.status, 403);
  assert.equal(((await remote.json()) as Json).error, "NOT_LOOPBACK");
  // tailscale serve connects from 127.0.0.1 and says so in its headers.
  const proxied = await firstStart(form(), LOOPBACK, { "X-Forwarded-For": "100.64.0.7" });
  assert.equal(((await proxied.json()) as Json).error, "NOT_LOOPBACK");
  const otherHost = await app.request("http://plania.example.ts.net/api/first-start", { method: "POST", headers: json, body: JSON.stringify(form()) }, LOOPBACK);
  assert.equal(((await otherHost.json()) as Json).error, "NOT_LOOPBACK");
  // The machine check it links is loopback only as well.
  assert.equal((await app.request("http://localhost:3737/api/first-start/machine-check", {}, REMOTE)).status, 403);

  const short = await firstStart(form({ password: "corta" }));
  assert.equal(short.status, 400);
  assert.deepEqual(await short.json(), { error: "INVALID_BODY", field: "password" });
  const zone = await firstStart(form({ time_zone: "Marte/Olympus" }));
  assert.deepEqual(await zone.json(), { error: "INVALID_BODY", field: "time_zone" });

  assert.equal(await count(`select count(*)::int as n from agents`), 0, "a refusal writes nothing");
  assert.equal(await count(`select count(*)::int as n from projects`), 0);
});

test("I2-2 #1: first start makes the owner; login works and the company page shows an empty, paused company", async () => {
  const res = await firstStart(form());
  assert.equal(res.status, 201, await res.clone().text());
  assert.deepEqual(await res.json(), { ok: true, home: "plania" });
  cookie = (res.headers.get("set-cookie") ?? "").split(";")[0]!;
  assert.match(cookie, new RegExp(`^${SESSION_COOKIE}=`), "first start signs the owner in");

  // One writeTx made the company rows, the home project, the tokens and the stored values.
  assert.deepEqual((await raw.query(`select slug from agents order by slug`)).rows.map((r) => r.slug), ["asistente", "ceo"]);
  const asis = (await raw.query(`select a.adapter, a.role_template, p.slug as boss from agents a join agents p on p.id = a.reports_to where a.slug = 'asistente'`)).rows[0];
  assert.deepEqual(asis, { adapter: "claude_code", role_template: "asistente", boss: "ceo" });
  assert.deepEqual((await raw.query(`select slug, runs_paused from projects`)).rows, [{ slug: "plania", runs_paused: true }]);
  assert.equal((await raw.query(`select company_paused from runner_settings`)).rows[0].company_paused, true, "a new install starts paused");
  assert.equal((await raw.query(`select display_name from owner_profile`)).rows[0].display_name, "Ana");
  assert.equal(ownerGivenName(), "Ana");
  const st = (await raw.query(`select * from install_state`)).rows[0];
  assert.equal(st.setup_code_hash, null, "the code is spent");
  assert.match(st.password_hash, /^\$argon2id\$/);
  assert.equal(st.time_zone, "Europe/Madrid");
  assert.ok(st.first_start_at);
  const tokens = (await raw.query(`select agent, scopes from agent_tokens order by agent`)).rows;
  assert.deepEqual(tokens, [
    { agent: "morning-brief", scopes: ["read"] },
    { agent: "plania-runner", scopes: ["read", "write"] },
  ]);
  assert.equal(process.env.PLANIA_TZ, "Europe/Madrid", "the zone is in use without a restart");
  assert.equal(await count(`select count(*)::int as n from events where type = 'install.first_start'`), 1);

  // No restart: the password works at once, and a wrong one does not.
  assert.equal((await login("otra contraseña larga")).status, 401);
  const ok = await login(PASSWORD);
  assert.equal(ok.status, 204);

  const company = (await (await get("/api/company")).json()) as Json;
  assert.equal(company.company.paused, true);
  assert.deepEqual(
    company.projects.map((p: Json) => p.slug),
    ["plania"],
    "only the home project",
  );
  assert.equal(await count(`select count(*)::int as n from tasks`), 0, "no work yet");
  assert.equal(await count(`select count(*)::int as n from agent_runs`), 0, "nothing ran");
});

test("I2-2 #2: once an owner exists first start is closed for good, the machine check too", async () => {
  const again = await firstStart(form({ name: "Intruso" }));
  assert.equal(again.status, 410);
  assert.equal(((await again.json()) as Json).error, "FIRST_START_CLOSED");
  assert.deepEqual(await (await app.request("http://localhost:3737/api/first-start", {}, LOOPBACK)).json(), { open: false, loopback: true });
  assert.equal((await app.request("http://localhost:3737/api/first-start/machine-check", {}, LOOPBACK)).status, 410);
  assert.equal((await raw.query(`select display_name from owner_profile`)).rows[0].display_name, "Ana");
  // A fresh install code cannot reopen it either.
  assert.equal(await issueSetupCode(raw, envFile, () => "RRRR-RRRR-RRRR"), null);
});

test("I2-2: an install configured in .env is unchanged: its hash wins and first start never opens", async () => {
  const before = { hash: process.env.PLANIA_PASSWORD_HASH };
  process.env.PLANIA_PASSWORD_HASH = await hashPassword("la contraseña del env");
  try {
    assert.equal((await login(PASSWORD)).status, 401, "the .env hash wins over the stored one");
    assert.equal((await login("la contraseña del env")).status, 204);
  } finally {
    if (before.hash === undefined) delete process.env.PLANIA_PASSWORD_HASH;
    else process.env.PLANIA_PASSWORD_HASH = before.hash;
  }
  // Wakes: PLANIA_JOBS=0 keeps them off even here; =1 turns them on; unset is on only after first start.
  assert.equal(state.wakesOn({ PLANIA_JOBS: "0" }), false);
  assert.equal(state.wakesOn({ PLANIA_JOBS: "1" }), true);
  assert.equal(state.wakesOn({}), true);
  state.resetInstallState();
  assert.equal(state.wakesOn({}), false, "an install not made by first start keeps PLANIA_JOBS=1 as the switch");
  assert.equal(eventWakesEnabled({}), false);
  await state.loadInstallState(db);
  assert.equal(eventWakesEnabled(), true);
  assert.ok(jobsToStart().some((j) => j.name === "heartbeat"), "the heartbeat joins the jobs with PLANIA_JOBS unset");
});

test("I2-2 #5: ten wrong passwords in a minute are refused with a wait, then the door opens again", async () => {
  let now = 1_000_000;
  limit.limitClock.now = () => now;
  try {
    for (let i = 0; i < 10; i++) assert.equal((await login(`mala-${i}-xxxxxxxx`)).status, 401);
    const refused = await login(PASSWORD);
    assert.equal(refused.status, 429, "the eleventh try waits, even with the right password");
    assert.equal(((await refused.json()) as Json).error, "TOO_MANY_TRIES");
    assert.equal(refused.headers.get("Retry-After"), "60");
    now += 30_000;
    assert.equal((await login(PASSWORD)).headers.get("Retry-After"), "30");
    now += 30_001;
    assert.equal((await login(PASSWORD)).status, 204);
  } finally {
    limit.limitClock.now = () => Date.now();
  }
});

test("I2-2 #3: after first start a request on a new project starts a run, with no .env value and no restart", async () => {
  assert.equal(process.env.PLANIA_RUNNER_TOKEN, undefined);
  // The sheet creates a project from the kit's role prompts, as on any new install.
  const made = await post("/api/company/projects", { name: "Primero", goal: "Probar que una instalación nueva arranca." });
  assert.equal(made.status, 201, await made.clone().text());
  // The owner presses resume on the company and the project.
  assert.equal((await post("/api/company/switch", { paused: false })).status, 200);
  assert.equal((await post("/api/company/projects/primero/switch", { paused: false })).status, 200);
  await raw.query(`update runner_settings set cooldown_minutes = 0`);
  await raw.query(`insert into plan_readings (at, source, status, five_hour_pct, five_hour_resets_at) values (now(), 'stream', 'allowed', 10, now() + interval '3 hours')`);

  const ask = await post("/api/company/projects/primero/ask", { text: "Haz la primera página", now: false });
  assert.equal(ask.status, 201, await ask.clone().text());
  const asked = (await ask.json()) as Json;
  assert.equal(asked.po, "po-primero");
  assert.match(asked.key, /^PRI/, "a Ready ticket for the PO");
  // Wakes are on with PLANIA_JOBS unset: the request queued the PO's run (or found the one the resume queued).
  assert.ok(["queued", "busy"].includes(asked.wake), JSON.stringify(asked));
  await waitForAskWakes();
  await runner.waitForAllRuns();

  const spawned: { env: NodeJS.ProcessEnv; child: FakeChild }[] = [];
  let pid = 70_000;
  const deps = {
    // The run's env as the server would build it: no PLANIA_RUNNER_TOKEN anywhere.
    env: { HOME: scratch, PATH: "/usr/bin:/bin", CLAUDE_CODE_BIN: "/fake/bin/claude", PLANIA_KIT_DIR: kit } as NodeJS.ProcessEnv,
    logDir: path.join(scratch, "logs"),
    tmpDir: path.join(scratch, "tmp"),
    worktreeRoot: path.join(scratch, "worktrees"),
    graceMs: 10,
    liveFlushMs: 0,
    footprints: false,
    git: async () => ({ code: 0, stdout: "", stderr: "" }),
    spawn: (_cmd: string, _args: string[], opts: { env?: NodeJS.ProcessEnv }) => {
      const child = new FakeChild(++pid);
      spawned.push({ env: opts.env ?? {}, child });
      setImmediate(() => child.finish());
      return child;
    },
    kill: () => undefined,
    reportTokens: async () => undefined,
    probeUsage: async () => null,
    machine: () => ({ freeMemBytes: 64 * 2 ** 30, freeDiskBytes: 500 * 2 ** 30 }),
  };
  const queued = (await raw.query(`select r.status from agent_runs r join agents a on a.id = r.agent_id where a.slug = 'po-primero'`)).rows;
  // The resume queued one wake and the request another; nothing started before the heartbeat drains the queue.
  assert.ok(queued.length >= 1 && queued.every((r) => r.status === "queued"), JSON.stringify(queued));
  // The heartbeat's drain, with the run's env holding no token.
  const drained = await runner.drainQueue(db, new Date(), deps as never);
  assert.ok(drained.started >= 1, JSON.stringify(drained));
  await runner.waitForAllRuns();

  const runs = (await raw.query(`select r.status, r.summary from agent_runs r join agents a on a.id = r.agent_id where a.slug = 'po-primero' order by r.queued_at nulls last`)).rows;
  assert.ok(spawned.length >= 1, `a run started: ${JSON.stringify(runs)}`);
  assert.ok(!runs.some((r) => /missing env PLANIA_RUNNER_TOKEN/.test(r.summary ?? "")), JSON.stringify(runs));
  const stored = (await raw.query(`select runner_token from install_state`)).rows[0].runner_token as string;
  assert.equal(spawned[0]!.env.PLANIA_RUNNER_TOKEN, stored, "the run got the token first start stored");
  // That token opens the MCP like a token issued on /tokens.
  const mcp = await app.request("/mcp", {
    method: "POST",
    headers: { Authorization: `Bearer ${stored}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  });
  assert.equal(mcp.status, 200);
});

test("I2-2: the first-start screen's words and rules (ui/src/lib/primer-arranque.ts)", async () => {
  const ui = await import("../ui/src/lib/primer-arranque.js");
  const ok = { code: CODE, name: "Ana", password: PASSWORD, repeat: PASSWORD, time_zone: "Europe/Madrid", projects_root: ui.DEFAULT_PROJECTS_ROOT, worktrees_root: ui.DEFAULT_WORKTREES_ROOT };
  assert.equal(ui.formProblem(ok), null);
  assert.match(ui.formProblem({ ...ok, password: "corta", repeat: "corta" })!, /12 caracteres/);
  assert.match(ui.formProblem({ ...ok, repeat: "otra" })!, /no son iguales/);
  assert.match(ui.formProblem({ ...ok, code: " " })!, /código/);
  assert.match(ui.formProblem({ ...ok, projects_root: " " })!, /carpetas/); // PLA-I2-3
  assert.equal(ui.waitText(30), "Demasiados intentos. Espera 30 segundos y vuelve a probar.");
  assert.equal(ui.refusalText("TOO_MANY_TRIES", { retry_after: 1 }), "Demasiados intentos. Espera 1 segundo y vuelve a probar.");
  assert.match(ui.refusalText("SETUP_CODE_INVALID"), /instalación/);
  assert.match(ui.refusalText("FIRST_START_CLOSED"), /contraseña/);
  assert.equal(ui.browserTimeZone({ DateTimeFormat: () => ({ resolvedOptions: () => ({ timeZone: "Asia/Tokyo" }) }) } as never), "Asia/Tokyo");
  assert.equal(ui.PASSWORD_MIN, 12);
  // Words the owner reads: no ticket key, branch name or the word sandbox.
  const text = Object.values(ui.WORDS).join(" ");
  assert.doesNotMatch(text, /PLA-|sandbox|jl\//i);
});
