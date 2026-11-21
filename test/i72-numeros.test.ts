// PLA-I72-2: the numbers of each machine. A running copy reads CPU, memory, disk split, uptime and response; a stopped
// one reads dashes. Base numbers come from injected SQL, pending migrations included. Nothing runs while no screen
// has the door open. Borrar la caché removes only the copy's build cache folders. The macOS and Linux memory readers
// are pure parsers, covered on any system. Fake ps, du, SQL, disk and memory; test DB only.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, beforeEach, test } from "node:test";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";
import { APP_URL, CAPTURE, fakeMachine, repoOf } from "./i72-fixtures.js";

useTestEnv();
const TMP = mkdtempSync(path.join(tmpdir(), "plania-i72-num-"));
process.env.PLANIA_CAPTURES_DIR = path.join(TMP, "captures");
const WT_ROOT = path.join(TMP, "worktrees");
const { app } = await import("../src/app.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const prueba = await import("../src/captures/prueba.js");
const maquinas = await import("../src/maquinas/machines.js");
const numeros = await import("../src/maquinas/numeros.js");
type Json = Record<string, any>;

const jorge = () => ({ Cookie: `${SESSION_COOKIE}=${createSession()}`, "content-type": "application/json" });
const call = async (method: string, url: string, body?: Json): Promise<{ status: number; body: Json }> => {
  const r = await app.request(url, { method, headers: jorge(), body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: (await r.json()) as Json };
};
const act = (id: string, action: string) => call("POST", `/api/projects/zigzag/maquinas/copias/${id}/${action}`);
const read = async () => (await call("GET", "/api/projects/zigzag/maquinas/numeros")).body as Json;
const until = async (f: () => boolean | Promise<boolean>, ms = 5000) => {
  const end = Date.now() + ms;
  while (!(await f())) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
};

let raw: pg.Client;
const fm = fakeMachine(WT_ROOT);
const REPO = repoOf(TMP);
const MB = 1024 * 1024;

let clock = 5_000_000;
let calls = { ps: 0, du: 0, query: 0 };
let psText = "";
let duBytes = new Map<string, number>();
let sqlAnswers: ((sql: string, url: string, params?: unknown[]) => Json[] | null)[] = [];

before(async () => {
  raw = await resetTestDb();
  mkdirSync(REPO, { recursive: true });
  writeFileSync(path.join(REPO, ".env.local"), `DATABASE_URL=${APP_URL}\n`);
  const pid = (await raw.query(`select id from projects where slug = 'zigzag'`)).rows[0].id;
  await raw.query(`update projects set settings = settings || $1::jsonb where slug = 'zigzag'`, [JSON.stringify(CAPTURE(REPO))]);
  await raw.query(`insert into tasks (project_id, key, title, kind, status, scope, branch) values ($1, 'ZZ-I1', 'Carrito', 'initiative', 'Active', 's', 'jl/zz-carrito'), ($1, 'ZZ-I2', 'Pagos', 'initiative', 'Active', 's', 'jl/zz-pagos')`, [pid]);
});
after(async () => {
  prueba.stopAll();
  numeros.resetNumeros();
  await raw.end();
  rmSync(TMP, { recursive: true, force: true });
});
beforeEach(async () => {
  prueba.resetPrueba();
  fm.reset();
  prueba.setPruebaDeps(fm.deps({ now: () => clock }));
  maquinas.setMaquinasDeps({ env: { ...process.env, PLANIA_WORKTREES_ROOT: WT_ROOT }, portBusy: async () => false, exec: fm.exec });
  await raw.query(`update maquina_copias set deleted_at = now() where deleted_at is null`);
  rmSync(WT_ROOT, { recursive: true, force: true });
  calls = { ps: 0, du: 0, query: 0 };
  psText = "";
  duBytes = new Map();
  sqlAnswers = [];
  numeros.setNumerosDeps({
    ps: async () => {
      calls.ps += 1;
      return psText;
    },
    du: async (dir) => {
      calls.du += 1;
      return duBytes.get(dir) ?? 0;
    },
    query: async (url, sql, params) => {
      calls.query += 1;
      for (const f of sqlAnswers) {
        const r = f(sql, url, params);
        if (r) return r;
      }
      throw new Error("no answer");
    },
    disk: () => ({ free: 200_000 * MB, total: 500_000 * MB }),
    memory: async () => ({ free: 6_000 * MB, total: 16_000 * MB }),
    now: () => clock,
    timers: false,
  });
});

const live = async (id: string) => until(async () => (await call("GET", "/api/projects/zigzag/maquinas/copias")).body.copias.find((c: Json) => c.id === id)?.phase === "live");

test("I72-2 #1: a running copy reads CPU, memory, disk split, uptime and response; a stopped one reads dashes", async () => {
  await act("ZZ-I1", "encender");
  await live("ZZ-I1");
  const child = fm.m.children[0]!;
  const wt = prueba.iniWorktree("zigzag", "ZZ-I1");
  psText = [`${child.pid} 1 12.5 51200`, `${child.pid + 500} ${child.pid} 7.5 30720`, `${child.pid + 501} ${child.pid + 500} 0.0 1024`, `99999 1 80.0 999999`].join("\n");
  mkdirSync(path.join(wt, "node_modules"), { recursive: true });
  mkdirSync(path.join(wt, ".next", "cache"), { recursive: true });
  duBytes.set(wt, 900 * MB);
  duBytes.set(path.join(wt, "node_modules"), 600 * MB);
  duBytes.set(path.join(wt, ".next/cache"), 200 * MB);
  writeFileSync(path.join(wt, "next.log"), "x".repeat(1000));
  child.print("Ready in 2s\n GET / 200 in 120ms\n GET /carrito 200 in 80ms\n POST /api/x 500 in 1.5s\n");
  clock += 90_000;
  const n = await read();
  const s = n.servers["ZZ-I1"];
  assert.equal(s.on, true);
  assert.equal(s.cpu, 20);
  assert.equal(s.mem_bytes, (51200 + 30720 + 1024) * 1024);
  assert.equal(s.uptime_s, 90);
  assert.equal(s.response_ms, Math.round((120 + 80 + 1500) / 3));
  assert.equal(s.disk.total, 900 * MB);
  assert.equal(s.disk.deps, 600 * MB);
  assert.equal(s.disk.cache, 200 * MB);
  assert.equal(s.disk.log, 1000);
  assert.equal(s.disk.code, 900 * MB - 600 * MB - 200 * MB - 1000);
  assert.deepEqual(s.cpu_samples, [20]);
  // A second sample while the door is open.
  psText = psText.replace("12.5", "2.5");
  assert.equal(await numeros.sampleTick(), 1);
  assert.deepEqual((await read()).servers["ZZ-I1"].cpu_samples, [20, 10]);
  // Stopped: dashes, the folder still counted.
  await act("ZZ-I1", "apagar");
  const off = (await read()).servers["ZZ-I1"];
  assert.equal(off.on, false);
  assert.equal(off.cpu, null);
  assert.equal(off.mem_bytes, null);
  assert.equal(off.uptime_s, null);
  assert.equal(off.response_ms, null);
  assert.equal(off.disk.total, 900 * MB);
  // The never-made initiative has no entry; the start copy (off, no folder) reads dashes and no disk.
  const all = await read();
  assert.equal(all.servers["ZZ-I2"], undefined);
  assert.equal(all.servers.inicio.on, false);
  assert.equal(all.servers.inicio.disk, null);
  assert.deepEqual(all.mac, { disk_free: 200_000 * MB, disk_total: 500_000 * MB, mem_free: 6_000 * MB, mem_total: 16_000 * MB });
});

test("I72-2 #2: base numbers come from SQL, with the migrations the copy's own branch has pending; the engine reads its own line", async () => {
  await act("ZZ-I1", "encender");
  await live("ZZ-I1");
  const wt = prueba.iniWorktree("zigzag", "ZZ-I1");
  mkdirSync(path.join(wt, "drizzle"), { recursive: true });
  writeFileSync(path.join(wt, "drizzle", "0000_init.sql"), "create table a (id int);");
  writeFileSync(path.join(wt, "drizzle", "0001_carrito.sql"), "create table carrito (id int);");
  const h0 = createHash("sha256").update("create table a (id int);").digest("hex");
  sqlAnswers.push((sql, url) => (/pg_database_size/.test(sql) ? [{ size: String(12 * MB), tables: "4", rows: "57", connections: "3", _db: url }] : null));
  sqlAnswers.push((sql) => (/to_regclass/.test(sql) ? [{ ok: true }] : null));
  sqlAnswers.push((sql) => (/select hash from/.test(sql) ? [{ hash: h0 }] : null));
  let engineParams: unknown[] | undefined;
  sqlAnswers.push((sql, _url, params) => {
    if (!/server_version/.test(sql)) return null;
    engineParams = params;
    return [{ version: "17.2", uptime: "86400", connections: "11", max_connections: "100", project_bases: "3" }];
  });
  const n = await read();
  const b = n.bases["ZZ-I1"];
  assert.equal(b.name, "zz_dev_ini_zz_i1");
  assert.equal(b.reachable, true);
  assert.equal(b.size_bytes, 12 * MB);
  assert.equal(b.tables, 4);
  assert.equal(b.rows, 57);
  assert.equal(b.connections, 3);
  assert.deepEqual(b.migrations, { applied: 1, pending: 1 });
  assert.equal(b.origin.from, "inicio");
  assert.ok(b.origin.at);
  // The start copy's base comes from the app's; it has no folder here, so its migrations are the repo's (none).
  assert.equal(n.bases.inicio.name, "zz_dev_prueba");
  assert.equal(n.bases.inicio.origin.from, "app");
  assert.deepEqual(n.engine, { on: true, version: "17.2", uptime_s: 86400, connections: 11, max_connections: 100, project_bases: 3 });
  assert.deepEqual(engineParams, ["zz_dev", "zz_dev\\_%"]);
  // An unreachable engine: off, dashes.
  sqlAnswers = [];
  const off = await read();
  assert.equal(off.engine.on, false);
  assert.equal(off.bases["ZZ-I1"].reachable, false);
  assert.equal(off.bases["ZZ-I1"].rows, null);
});

test("I72-2 #3: no command runs while no screen has the door open, and sampling stops once nobody reads", async () => {
  await act("ZZ-I1", "encender");
  await live("ZZ-I1");
  psText = `${fm.m.children[0]!.pid} 1 5.0 1024`;
  assert.equal(await numeros.sampleTick(), 0);
  assert.deepEqual(calls, { ps: 0, du: 0, query: 0 }, "nothing ran before the door opened");
  await read();
  assert.ok(calls.ps > 0);
  assert.equal(numeros.sampling(), true);
  const ps = calls.ps;
  assert.equal(await numeros.sampleTick(), 1);
  assert.equal(calls.ps, ps + 1);
  clock += numeros.OPEN_MS + 1;
  const before = { ...calls };
  assert.equal(await numeros.sampleTick(), 0);
  assert.deepEqual(calls, before, "the door closed: nothing more ran");
  assert.equal(numeros.sampling(), false);
});

test("I72-2 #4: Borrar la caché removes only the copy's build cache folders", async () => {
  await act("ZZ-I1", "encender");
  await live("ZZ-I1");
  const wt = prueba.iniWorktree("zigzag", "ZZ-I1");
  for (const d of [".next/cache/webpack", ".next/server/app", "node_modules/react", "node_modules/.cache/x", "src"]) {
    mkdirSync(path.join(wt, d), { recursive: true });
    writeFileSync(path.join(wt, d, "f"), "x");
  }
  const other = prueba.iniWorktree("zigzag", "ZZ-I2");
  mkdirSync(path.join(other, ".next/cache"), { recursive: true });
  const r = await call("POST", "/api/projects/zigzag/maquinas/copias/ZZ-I1/borrar-cache");
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.removed.sort(), [".next/cache", "node_modules/.cache"]);
  assert.ok(!existsSync(path.join(wt, ".next/cache")));
  assert.ok(!existsSync(path.join(wt, "node_modules/.cache")));
  for (const d of [".next/server/app/f", "node_modules/react/f", "src/f"]) assert.ok(existsSync(path.join(wt, d)), d);
  assert.ok(existsSync(path.join(other, ".next/cache")), "another copy's cache stays");
  assert.equal((await call("POST", "/api/projects/zigzag/maquinas/copias/ZZ-I2/borrar-cache")).body.error, "NO_TEST_COPY");
});

test("I72-2 #5: the macOS and Linux memory readers and the process tree", () => {
  const vm = `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                               10000.
Pages active:                            200000.
Pages inactive:                           50000.
Pages speculative:                         2000.
Pages throttled:                              0.
Pages wired down:                         90000.
Pages purgeable:                           1000.`;
  assert.equal(numeros.parseVmStat(vm), (10000 + 50000 + 2000 + 1000) * 16384);
  assert.equal(numeros.parseVmStat("garbage"), null);
  const mi = "MemTotal:       16303820 kB\nMemFree:         1093240 kB\nMemAvailable:    9876544 kB\n";
  assert.deepEqual(numeros.parseMeminfo(mi), { free: 9876544 * 1024, total: 16303820 * 1024 });
  assert.equal(numeros.parseMeminfo("MemTotal: 1 kB"), null);
  const procs = numeros.parsePs("  10     1  1.5  100\n  11    10  2.5  200\n  12    11  1.0  300\n  13     1  9.9  999\n");
  assert.deepEqual(numeros.treeUsage(procs, 10), { cpu: 5, rss: 600 * 1024 });
  assert.equal(numeros.treeUsage(procs, 77), null);
  assert.equal(numeros.responseMs(["nothing here"]), null);
});
