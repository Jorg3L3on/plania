// PLA-I72-4: Entrar y llaves. The test user's password is kept only for a test user, in a mode-600 file outside the
// repo, never in the database or a log; reading it twice gives the same value; Cambiarla sets a new one in the app
// and in every running copy (each with its own base) and keeps it. A key only an initiative branch's env example asks
// for is marked with that initiative; saving a key returns the running copies to restart. Fake exec; test DB only.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, beforeEach, test } from "node:test";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";
import { APP_URL, CAPTURE, fakeMachine, repoOf } from "./i72-fixtures.js";

const TMP = mkdtempSync(path.join(tmpdir(), "plania-i72-entrar-"));
process.env.PLANIA_TEST_PASSWORDS_FILE = path.join(TMP, "config", "plania", "test-passwords.json");
useTestEnv();
process.env.PLANIA_CAPTURES_DIR = path.join(TMP, "captures");
const WT_ROOT = path.join(TMP, "worktrees");
const { app } = await import("../src/app.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const prueba = await import("../src/captures/prueba.js");
const maquinas = await import("../src/maquinas/machines.js");
type Json = Record<string, any>;

const jorge = () => ({ Cookie: `${SESSION_COOKIE}=${createSession()}`, "content-type": "application/json" });
const call = async (method: string, url: string, body?: Json): Promise<{ status: number; body: Json }> => {
  const r = await app.request(url, { method, headers: jorge(), body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: (await r.json()) as Json };
};
const act = (id: string, action: string) => call("POST", `/api/projects/zigzag/maquinas/copias/${id}/${action}`);
const until = async (f: () => boolean | Promise<boolean>, ms = 5000) => {
  const end = Date.now() + ms;
  while (!(await f())) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
};
const live = async (id: string) => until(async () => (await call("GET", "/api/projects/zigzag/maquinas/copias")).body.copias.find((c: Json) => c.id === id)?.phase === "live");

let raw: pg.Client;
const fm = fakeMachine(WT_ROOT);
const REPO = repoOf(TMP);
const FILE = process.env.PLANIA_TEST_PASSWORDS_FILE!;
let pwRuns: { cwd: string; db: string; stdin: string }[] = [];
const SESSION = { login_path: "/entrar", user: "prueba@example.com", user_field: "email", password_field: "password", password_command: "npm run panel:usuario -- {user}" };

before(async () => {
  raw = await resetTestDb();
  mkdirSync(REPO, { recursive: true });
  writeFileSync(path.join(REPO, ".env.local"), `DATABASE_URL=${APP_URL}\nSTRIPE_KEY=sk_test_x\n`);
  writeFileSync(path.join(REPO, ".env.example"), `DATABASE_URL=\nSTRIPE_KEY=\n`);
  const pid = (await raw.query(`select id from projects where slug = 'zigzag'`)).rows[0].id;
  await raw.query(`update projects set settings = settings || $1::jsonb where slug = 'zigzag'`, [JSON.stringify(CAPTURE(REPO, { session: SESSION }))]);
  await raw.query(`insert into tasks (project_id, key, title, kind, status, scope, branch) values ($1, 'ZZ-I1', 'Carrito', 'initiative', 'Active', 's', 'jl/zz-carrito'), ($1, 'ZZ-I2', 'Pagos', 'initiative', 'Active', 's', 'jl/zz-pagos')`, [pid]);
});
after(async () => {
  prueba.stopAll();
  await raw.end();
  rmSync(TMP, { recursive: true, force: true });
});
beforeEach(async () => {
  prueba.resetPrueba();
  fm.reset();
  pwRuns = [];
  const exec: typeof fm.exec = async (command, opts) => {
    if (command.startsWith("npm run panel:usuario")) {
      pwRuns.push({ cwd: opts!.cwd, db: String((opts!.env as Json)?.DATABASE_URL ?? "(env file)"), stdin: String(opts!.stdin) });
      return { code: 0, stdout: "", stderr: "" };
    }
    if (command.startsWith("git ls-files")) return { code: 0, stdout: "", stderr: "" };
    return fm.exec!(command, opts);
  };
  prueba.setPruebaDeps(fm.deps({ exec }));
  maquinas.setMaquinasDeps({ env: { ...process.env, PLANIA_WORKTREES_ROOT: WT_ROOT }, portBusy: async () => false, exec });
  await raw.query(`update maquina_copias set deleted_at = now() where deleted_at is null`);
  rmSync(WT_ROOT, { recursive: true, force: true });
});

test("I72-4 #1 #2: the password is kept in a mode-600 file outside the repo, the same on every read, never in the database or a log", async () => {
  rmSync(FILE, { force: true });
  const lines: string[] = [];
  const log = console.log;
  console.log = (...a: unknown[]) => void lines.push(a.map(String).join(" "));
  try {
    const empty = await call("GET", "/api/projects/zigzag/maquinas/entrar");
    assert.equal(empty.body.user, "prueba@example.com");
    assert.equal(empty.body.password, null);
    assert.equal(empty.body.can_password, true);
    const c = await call("POST", "/api/projects/zigzag/maquinas/entrar/cambiar");
    assert.equal(c.status, 200, JSON.stringify(c.body));
    const pw = c.body.password as string;
    assert.match(pw, /^[A-Za-z0-9_-]{16}$/);
    const a = await call("GET", "/api/projects/zigzag/maquinas/entrar");
    const b = await call("GET", "/api/projects/zigzag/maquinas/entrar");
    assert.equal(a.body.password, pw);
    assert.equal(b.body.password, pw, "showing it twice gives the same value");
    assert.equal(pwRuns.length, 1, "reading never sets one");
    assert.ok(existsSync(FILE));
    assert.equal(statSync(FILE).mode & 0o777, 0o600);
    assert.equal(statSync(path.dirname(FILE)).mode & 0o077, 0);
    assert.ok(!path.resolve(FILE).startsWith(path.resolve(REPO) + path.sep));
    assert.ok(readFileSync(FILE, "utf8").includes(pw));
    const dump = (await raw.query(`select (select coalesce(string_agg(payload::text, ''), '') from events) || (select coalesce(string_agg(settings::text, ''), '') from projects) || (select coalesce(string_agg(value::text, ''), '') from machine_state) || (select coalesce(string_agg(details::text || purpose, ''), '') from footprints) as all`)).rows[0].all as string;
    assert.ok(!dump.includes(pw), "not in the database");
    assert.ok(!lines.some((l) => l.includes(pw)), "not in a log line");
    // A file others can read is not trusted.
    const { chmodSync } = await import("node:fs");
    chmodSync(FILE, 0o644);
    assert.equal((await call("GET", "/api/projects/zigzag/maquinas/entrar")).body.password, null);
    chmodSync(FILE, 0o600);
  } finally {
    console.log = log;
  }
});

test("I72-4 #1: a user outside the test domains is never kept nor changed", async () => {
  rmSync(FILE, { force: true });
  await raw.query(`update projects set settings = jsonb_set(settings, '{capture,session,user}', '"ana@gmail.com"') where slug = 'zigzag'`);
  try {
    const r = await call("POST", "/api/projects/zigzag/maquinas/entrar/cambiar");
    assert.equal(r.body.error, "NOT_A_TEST_USER");
    assert.equal(pwRuns.length, 0);
    assert.ok(!existsSync(FILE));
    const e = await call("GET", "/api/projects/zigzag/maquinas/entrar");
    assert.equal(e.body.can_password, false);
    assert.equal(e.body.password, null);
  } finally {
    await raw.query(`update projects set settings = jsonb_set(settings, '{capture,session,user}', '"prueba@example.com"') where slug = 'zigzag'`);
  }
});

test("I72-4 #2: Cambiarla sets the new one in the app and in every running copy's own base, and lists the copies that were off", async () => {
  await act("inicio", "encender");
  await act("ZZ-I1", "encender");
  await live("inicio");
  await live("ZZ-I1");
  // ZZ-I2 was made, then turned off: its base keeps the old sign-in.
  await act("ZZ-I2", "encender");
  await live("ZZ-I2");
  await act("ZZ-I2", "apagar");
  const r = await call("POST", "/api/projects/zigzag/maquinas/entrar/cambiar");
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const pw = r.body.password;
  assert.deepEqual(r.body.set_in.sort(), ["ZZ-I1", "inicio"]);
  assert.deepEqual(r.body.stale, ["ZZ-I2"]);
  const dbs = pwRuns.map((x) => (x.db === "(env file)" ? x.db : fm.nameOf(x.db))).sort();
  assert.deepEqual(dbs, ["(env file)", "zz_dev_ini_zz_i1", "zz_dev_prueba"]);
  assert.ok(pwRuns.every((x) => x.stdin === `${pw}\n${pw}\n`));
  const e = await call("GET", "/api/projects/zigzag/maquinas/entrar");
  assert.equal(e.body.password, pw);
  assert.deepEqual(e.body.stale, ["ZZ-I2"]);
});

test("I72-4 #3 #4: a key only an initiative branch asks for carries it; saving a key returns the running copies to restart", async () => {
  await act("ZZ-I1", "encender");
  await live("ZZ-I1");
  writeFileSync(path.join(prueba.iniWorktree("zigzag", "ZZ-I1"), ".env.example"), `DATABASE_URL=\nSTRIPE_KEY=\nCUPONES_API_KEY=\n`);
  const l = await call("GET", "/api/projects/zigzag/maquinas/llaves");
  const cup = l.body.llaves.find((x: Json) => x.name === "CUPONES_API_KEY");
  assert.deepEqual(cup.iniciativas, ["ZZ-I1"]);
  assert.equal(cup.set, false);
  assert.equal(l.body.llaves.find((x: Json) => x.name === "STRIPE_KEY").iniciativas, undefined);
  const saved = await call("POST", "/api/projects/zigzag/maquinas/llaves", { name: "CUPONES_API_KEY", value: "cup_test_123" });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.deepEqual(saved.body.reiniciar, [{ id: "ZZ-I1", title: "Carrito" }]);
  assert.ok(!JSON.stringify(saved.body).includes("cup_test_123"));
  // Reiniciar las copias encendidas: ZZ-I1 starts again (and reads the new file); nothing else starts.
  const before = fm.m.children.length;
  const rr = await call("POST", "/api/projects/zigzag/maquinas/copias/reiniciar-encendidas");
  assert.deepEqual(rr.body.reiniciadas, ["ZZ-I1"]);
  await until(() => fm.m.children.length === before + 1);
  await live("ZZ-I1");
  assert.ok(readFileSync(path.join(prueba.iniWorktree("zigzag", "ZZ-I1"), ".env.local"), "utf8").includes("CUPONES_API_KEY=cup_test_123"), "the restarted copy has the new key");
});
