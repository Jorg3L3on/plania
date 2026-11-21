// PLA-I72-1: one copy per open initiative. Two initiatives of one project run at once on their own ports with their
// own bases (<db>_ini_<key>) next to the start copy; encender, apagar, reiniciar, borrar and «No apagarla sola» act
// on the named copy only; borrar drops the base and the worktree and releases their footprints; the start copy and
// a protected base name are refused; after a simulated restart the copies are listed again, off. Fake git, fake
// processes and a fake psql that keeps each database's rows in memory. Test DB only.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, beforeEach, test } from "node:test";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const TMP = mkdtempSync(path.join(tmpdir(), "plania-i72-copias-"));
process.env.PLANIA_CAPTURES_DIR = path.join(TMP, "captures");
const WT_ROOT = path.join(TMP, "worktrees");
const { app } = await import("../src/app.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const { makeDb } = await import("../src/db/client.js");
const prueba = await import("../src/captures/prueba.js");
const maquinas = await import("../src/maquinas/machines.js");
const copias = await import("../src/maquinas/copias.js");
type Deps = import("../src/captures/prueba.js").PruebaDeps;
type Json = Record<string, any>;

const jorge = () => ({ Cookie: `${SESSION_COOKIE}=${createSession()}`, "content-type": "application/json" });
const call = async (method: string, url: string, body?: Json): Promise<{ status: number; body: Json }> => {
  const r = await app.request(url, { method, headers: jorge(), body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: (await r.json()) as Json };
};
const act = (id: string, action: string, body?: Json) => call("POST", `/api/projects/zigzag/maquinas/copias/${id}/${action}`, body);
const list = async () => (await call("GET", "/api/projects/zigzag/maquinas/copias")).body.copias as Json[];
const until = async (f: () => boolean | Promise<boolean>, ms = 5000) => {
  const end = Date.now() + ms;
  while (!(await f())) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
};

let raw: pg.Client;
let db: ReturnType<typeof makeDb>["db"];

// Git: worktree add makes the folder; remove deletes it.
const HEAD = "1a2b3c4d1a2b3c4d1a2b3c4d1a2b3c4d1a2b3c4d";
let gitCalls: string[][] = [];
const fakeGit = async (args: string[]) => {
  gitCalls.push(args);
  if (args[0] === "worktree" && args[1] === "add") mkdirSync(args[3]!, { recursive: true });
  if (args[0] === "worktree" && args[1] === "remove") rmSync(args[3]!, { recursive: true, force: true });
  if (args[0] === "rev-parse" && args[1] === "--abbrev-ref") return { code: 0, stdout: "HEAD\n", stderr: "" };
  if (args[0] === "rev-parse") return { code: 0, stdout: `${HEAD}\n`, stderr: "" };
  return { code: 0, stdout: "", stderr: "" };
};

// Processes: each spawn answers on its PORT at once.
type Child = { pid: number; port: number; env: NodeJS.ProcessEnv; cwd: string };
let children: Child[] = [];
let killed: number[] = [];
let nextPid = 12000;
let upPorts = new Set<number>();
const fakeSpawn: Deps["spawn"] = (_command, { cwd, env }) => {
  const listeners: Record<string, ((...a: any[]) => void)[]> = {};
  const c = { pid: nextPid++, stdout: { on: () => undefined }, stderr: { on: () => undefined }, once: (e: string, f: any) => (listeners[e] ??= []).push(f) };
  const port = Number(env.PORT);
  children.push({ pid: c.pid, port, env, cwd });
  upPorts.add(port);
  return c as any;
};

// psql: one map of database → rows. Every command Plania runs against a base is read here.
let bases = new Map<string, string[]>();
let execs: string[] = [];
const nameOf = (url: string | undefined) => (url ? decodeURIComponent(new URL(url).pathname.slice(1)) : "");
const fakeExec: Deps["exec"] = async (command, opts) => {
  execs.push(command);
  const e = (opts?.env ?? {}) as Record<string, string>;
  const listQ = /datname in \('([^']+)', '([^']+)'\)/.exec(command);
  if (listQ) return { code: 0, stdout: [listQ[1], listQ[2]].filter((n) => bases.has(n!)).join("\n"), stderr: "" };
  const create = /create database ([A-Za-z0-9_]+)/.exec(command);
  if (create) {
    bases.set(create[1]!, [...(bases.get(nameOf(e.PLANIA_FROM_URL)) ?? [])]);
    return { code: 0, stdout: "", stderr: "" };
  }
  const drop = /drop database if exists ([A-Za-z0-9_]+)/.exec(command);
  if (drop) {
    bases.delete(drop[1]!);
    return { code: 0, stdout: "", stderr: "" };
  }
  return { code: 0, stdout: "", stderr: "" }; // install, migrate
};
// The app writing a row into the base its server was started with.
const writeRow = (child: Child, row: string) => bases.get(nameOf(child.env.DATABASE_URL))!.push(row);

const deps = (): Deps => ({
  git: fakeGit,
  spawn: fakeSpawn,
  kill: (pid) => void killed.push(pid),
  alive: () => false,
  exec: fakeExec,
  up: async (url) => upPorts.has(Number(new URL(url).port)),
  portBusy: async () => false,
  env: { ...process.env, PLANIA_WORKTREES_ROOT: WT_ROOT },
  pollMs: 5,
  readyMs: 2_000,
  stopGraceMs: 10,
  sweep: false,
  signals: false,
});

const REPO = path.join(TMP, "repos", "zigzag");
const APP_URL = "postgres://zz@localhost:5432/zz_dev";
let pid = "";
const initiative = async (key: string, branch: string | null, status = "Active") =>
  raw.query(`insert into tasks (project_id, key, title, kind, status, scope, branch, base_branch) values ($1, $2, $3, 'initiative', $4, 's', $5, 'main') returning id`, [pid, key, `Iniciativa ${key}`, status, branch]);

before(async () => {
  raw = await resetTestDb();
  ({ db } = makeDb());
  mkdirSync(REPO, { recursive: true });
  writeFileSync(path.join(REPO, ".env.local"), `DATABASE_URL=${APP_URL}\n`);
  pid = (await raw.query(`select id from projects where slug = 'zigzag'`)).rows[0].id;
  const capture = { start_command: "npm run dev -- --port {port}", port: 3200, pages: [{ key: "inicio", path: "/", label: "Inicio" }], database: { env_var: "DATABASE_URL", migrate_command: "npm run db:migrate" } };
  await raw.query(`update projects set settings = settings || $1::jsonb where slug = 'zigzag'`, [JSON.stringify({ capture, local: { repo_path: REPO } })]);
  await initiative("ZZ-I1", "jl/zz-carrito");
  await initiative("ZZ-I2", "jl/zz-pagos");
  await initiative("ZZ-I3", "jl/zz-viejo", "Done");
});

after(async () => {
  prueba.stopAll();
  await raw.end();
  rmSync(TMP, { recursive: true, force: true });
});

beforeEach(async () => {
  prueba.resetPrueba();
  prueba.setPruebaDeps(deps());
  maquinas.setMaquinasDeps({ env: { ...process.env, PLANIA_WORKTREES_ROOT: WT_ROOT }, portBusy: async () => false, exec: fakeExec });
  await raw.query(`update maquina_copias set deleted_at = now() where deleted_at is null`);
  rmSync(WT_ROOT, { recursive: true, force: true });
  bases = new Map([["zz_dev", ["app-row"]], ["zz_dev_prueba", ["inicio-row"]]]);
  gitCalls = [];
  children = [];
  killed = [];
  execs = [];
  upPorts = new Set();
});

const live = async (id: string) => until(async () => (await list()).find((c) => c.id === id)?.phase === "live");
const serverOf = (key: string) => children.find((c) => c.cwd.endsWith(prueba.iniSuffix(key)))!;

test("I72-1: the migration is 0078 and safe to run twice", async () => {
  const sql = readFileSync(new URL("../drizzle/migrations/0078_maquina_copias.sql", import.meta.url), "utf8");
  await raw.query(sql);
  await raw.query(sql);
  assert.equal((await raw.query(`select count(*)::int as n from information_schema.tables where table_name = 'maquina_copias'`)).rows[0].n, 1);
});

test("I72-1: the list has the start copy first and one copy per open initiative, closed ones left out", async () => {
  const c = await list();
  assert.deepEqual(c.map((x) => x.id), ["inicio", "ZZ-I1", "ZZ-I2"]);
  assert.equal(c[0]!.kind, "inicio");
  assert.equal(c[0]!.database, "zz_dev_prueba");
  assert.equal(c[1]!.branch, "jl/zz-carrito");
  assert.equal(c[1]!.phase, "off");
  assert.equal(c[1]!.made, false);
});

test("I72-1 #1: two initiatives run at once on different ports with their own bases; a row in one is in neither the other nor the start copy", async () => {
  assert.equal((await act("ZZ-I1", "encender")).status, 200);
  assert.equal((await act("ZZ-I2", "encender")).status, 200);
  await live("ZZ-I1");
  await live("ZZ-I2");
  const a = serverOf("ZZ-I1");
  const b = serverOf("ZZ-I2");
  assert.notEqual(a.port, b.port);
  assert.equal(nameOf(a.env.DATABASE_URL), "zz_dev_ini_zz_i1");
  assert.equal(nameOf(b.env.DATABASE_URL), "zz_dev_ini_zz_i2");
  // Made from the start copy's base, not the app's.
  assert.deepEqual(bases.get("zz_dev_ini_zz_i1"), ["inicio-row"]);
  writeRow(a, "carrito-row");
  assert.ok(bases.get("zz_dev_ini_zz_i1")!.includes("carrito-row"));
  assert.ok(!bases.get("zz_dev_ini_zz_i2")!.includes("carrito-row"));
  assert.ok(!bases.get("zz_dev_prueba")!.includes("carrito-row"));
  assert.ok(!bases.get("zz_dev")!.includes("carrito-row"));
  // Each on its own branch, in its own worktree.
  assert.ok(gitCalls.some((g) => g[0] === "worktree" && g[1] === "add" && g[3]!.endsWith("_ini_zz_i1") && g[4] === "origin/jl/zz-carrito"));
  const c = await list();
  assert.equal(c.find((x) => x.id === "ZZ-I1")!.url, `http://localhost:${a.port}`);
  assert.equal(c.find((x) => x.id === "inicio")!.phase, "off", "the start copy did not change");
  const servers = (await raw.query(`select locator, details from footprints where kind = 'server' and released_at is null`)).rows;
  assert.deepEqual(servers.map((s) => s.locator).sort(), [`port:${a.port}`, `port:${b.port}`].sort());
});

test("I72-1: a second start keeps the base as it was (made once), and the branch's migrations run each time", async () => {
  await act("ZZ-I1", "encender");
  await live("ZZ-I1");
  writeRow(serverOf("ZZ-I1"), "probado");
  await act("ZZ-I1", "reiniciar");
  await until(() => children.length === 2);
  await live("ZZ-I1");
  assert.ok(bases.get("zz_dev_ini_zz_i1")!.includes("probado"));
  assert.equal(execs.filter((e) => /create database zz_dev_ini_zz_i1/.test(e)).length, 1);
  assert.equal(execs.filter((e) => e === "npm run db:migrate").length, 2);
});

test("I72-1 #2: apagar, reiniciar and quedarse act only on the named copy; borrar drops its base and worktree and releases their footprints", async () => {
  await act("ZZ-I1", "encender");
  await act("ZZ-I2", "encender");
  await live("ZZ-I1");
  await live("ZZ-I2");
  const a = serverOf("ZZ-I1");
  const b = serverOf("ZZ-I2");
  await act("ZZ-I1", "apagar");
  assert.deepEqual(killed, [a.pid]);
  let c = await list();
  assert.equal(c.find((x) => x.id === "ZZ-I1")!.phase, "off");
  assert.equal(c.find((x) => x.id === "ZZ-I2")!.phase, "live");
  // «No apagarla sola» on ZZ-I2 only: the idle sweep stops nothing of it.
  assert.equal((await act("ZZ-I2", "quedarse", { keep: true })).status, 200);
  prueba.setPruebaDeps({ ...deps(), idleMs: 0 });
  await act("inicio", "encender");
  await live("inicio");
  const gone = await prueba.sweepIdle(db);
  assert.deepEqual(gone, ["zigzag"], "the start copy idled off, ZZ-I2 stayed");
  assert.equal((await raw.query(`select keep from maquina_copias where initiative_key = 'ZZ-I2' and deleted_at is null`)).rows[0].keep, true);
  prueba.setPruebaDeps(deps());
  // Borrar ZZ-I2: its server, base and worktree go; ZZ-I1's base and the start copy's stay.
  const wt = prueba.iniWorktree("zigzag", "ZZ-I2");
  assert.ok(existsSync(wt));
  const r = await act("ZZ-I2", "borrar");
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.borrada.dropped, true);
  assert.equal(r.body.borrada.removed, true);
  assert.ok(killed.includes(b.pid));
  assert.ok(!bases.has("zz_dev_ini_zz_i2"));
  assert.ok(bases.has("zz_dev_ini_zz_i1"));
  assert.ok(bases.has("zz_dev_prueba") && bases.has("zz_dev"));
  assert.ok(!existsSync(wt));
  assert.ok(existsSync(prueba.iniWorktree("zigzag", "ZZ-I1")));
  const open = (await raw.query(`select kind, locator from footprints where released_at is null and (locator like '%zz_i2%' or locator = $1)`, [`port:${b.port}`])).rows;
  assert.deepEqual(open, [], "every footprint of ZZ-I2 released");
  const still = (await raw.query(`select kind from footprints where released_at is null and locator like '%zz_i1%' order by kind`)).rows.map((x) => x.kind);
  assert.deepEqual(still, ["database", "worktree"]);
  c = await list();
  const i2 = c.find((x) => x.id === "ZZ-I2")!;
  assert.equal(i2.made, false);
  assert.equal(i2.worktree, null);
  const ev = (await raw.query(`select type, payload from events where type = 'machine.copy_deleted' order by id desc limit 1`)).rows[0];
  assert.equal(ev.payload.key, "ZZ-I2");
});

test("I72-1 #3: borrar on the start copy, or on a row naming the app's or the start copy's base, is refused and drops nothing", async () => {
  const s = await act("inicio", "borrar");
  assert.equal(s.status, 403);
  assert.equal(s.body.error, "COPY_NOT_DELETABLE");
  await act("ZZ-I1", "encender");
  await live("ZZ-I1");
  for (const name of ["zz_dev", "zz_dev_prueba"]) {
    await raw.query(`update maquina_copias set database = $1 where initiative_key = 'ZZ-I1' and deleted_at is null`, [name]);
    const r = await act("ZZ-I1", "borrar");
    assert.equal(r.status, 403, name);
    assert.equal(r.body.error, "BASE_PROTECTED");
  }
  assert.ok(bases.has("zz_dev") && bases.has("zz_dev_prueba") && bases.has("zz_dev_ini_zz_i1"));
  assert.equal((await list()).find((x) => x.id === "ZZ-I1")!.phase, "live", "nothing was stopped either");
  assert.ok(!execs.some((e) => /drop database/.test(e)));
});

test("I72-1: a closed initiative's copy does not start; an unknown id is not found", async () => {
  assert.equal((await act("ZZ-I3", "encender")).body.error, "INITIATIVE_CLOSED");
  assert.equal((await act("ZZ-I9", "encender")).status, 404);
  assert.equal((await call("POST", "/api/projects/zigzag/maquinas/copias/ZZ-I1/romper")).status, 404);
});

test("I72-1 #4: after a simulated restart the copies are listed again, off, with their names and «No apagarla sola» kept", async () => {
  await act("ZZ-I1", "encender");
  await live("ZZ-I1");
  await act("ZZ-I1", "quedarse", { keep: true });
  // Plania stops: every process gets SIGTERM and the memory is gone.
  prueba.stopAll();
  prueba.resetPrueba();
  assert.equal((await raw.query(`select state from maquina_copias where initiative_key = 'ZZ-I1' and deleted_at is null`)).rows[0].state, "on");
  assert.equal(await copias.reconcileCopias(db), 1);
  const c = (await list()).find((x) => x.id === "ZZ-I1")!;
  assert.equal(c.phase, "off");
  assert.equal(c.keep, true);
  assert.equal(c.database, "zz_dev_ini_zz_i1");
  assert.equal(c.made, true);
  assert.equal((await raw.query(`select state from maquina_copias where initiative_key = 'ZZ-I1' and deleted_at is null`)).rows[0].state, "off");
  // Encender brings it back on the same base.
  await act("ZZ-I1", "encender");
  await live("ZZ-I1");
  assert.equal(execs.filter((e) => /create database zz_dev_ini_zz_i1/.test(e)).length, 1);
  assert.equal(await copias.reconcileCopias(db), 0, "a copy running in memory is left alone");
});

test("I72-1: the screen cookie is required", async () => {
  const r = await app.request("/api/projects/zigzag/maquinas/copias");
  assert.equal(r.status, 401);
});
