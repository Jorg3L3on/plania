// PLA-I72-3: Sobrantes and the clean-up. Moving an initiative to Done or Won't do deletes its copy and releases its
// footprints; so does every ticket merging. The sweep lists an orphan base, a running server of a closed initiative
// and an orphan folder, each with origin and size; the app's base, the start copy's base and another project's base
// never appear, even with matching names; Borrar todo with a stale total is refused. Fake psql, git, ps; test DB only.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, beforeEach, test } from "node:test";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";
import { APP_URL, CAPTURE, fakeMachine, repoOf } from "./i72-fixtures.js";

useTestEnv();
const TMP = mkdtempSync(path.join(tmpdir(), "plania-i72-sob-"));
process.env.PLANIA_CAPTURES_DIR = path.join(TMP, "captures");
const WT_ROOT = path.join(TMP, "worktrees");
const { app } = await import("../src/app.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const { makeDb } = await import("../src/db/client.js");
const prueba = await import("../src/captures/prueba.js");
const maquinas = await import("../src/maquinas/machines.js");
const numeros = await import("../src/maquinas/numeros.js");
const sobrantes = await import("../src/maquinas/sobrantes.js");
const { registerFootprint } = await import("../src/mcp/footprint.js");
type Json = Record<string, any>;

const jorge = () => ({ Cookie: `${SESSION_COOKIE}=${createSession()}`, "content-type": "application/json" });
const call = async (method: string, url: string, body?: Json): Promise<{ status: number; body: Json }> => {
  const r = await app.request(url, { method, headers: jorge(), body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: (await r.json()) as Json };
};
const act = (id: string, action: string) => call("POST", `/api/projects/zigzag/maquinas/copias/${id}/${action}`);
const list = async () => (await call("GET", "/api/projects/zigzag/maquinas/sobrantes")).body as Json;
const until = async (f: () => boolean | Promise<boolean>, ms = 5000) => {
  const end = Date.now() + ms;
  while (!(await f())) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
};

let raw: pg.Client;
let db: ReturnType<typeof makeDb>["db"];
const fm = fakeMachine(WT_ROOT);
const REPO = repoOf(TMP);
let pid = "";
let killed: number[] = [];

const setStatus = (key: string, status: string) => raw.query(`update tasks set status = $1, resolved_at = case when $1 in ('Done', 'Won''t do') then now() else null end where key = $2`, [status, key]);
const live = async (id: string) => until(async () => (await call("GET", "/api/projects/zigzag/maquinas/copias")).body.copias.find((c: Json) => c.id === id)?.phase === "live");
const openFps = async (like: string) => (await raw.query(`select kind from footprints where released_at is null and locator like $1 order by kind`, [like])).rows.map((r) => r.kind);
const sys = { actor: { agent: "plania", session_id: "plania-prueba", machine: "test-mac" }, system: true };

before(async () => {
  raw = await resetTestDb();
  ({ db } = makeDb());
  mkdirSync(REPO, { recursive: true });
  writeFileSync(path.join(REPO, ".env.local"), `DATABASE_URL=${APP_URL}\n`);
  pid = (await raw.query(`select id from projects where slug = 'zigzag'`)).rows[0].id;
  await raw.query(`update projects set settings = settings || $1::jsonb where slug = 'zigzag'`, [JSON.stringify(CAPTURE(REPO))]);
  const ins = (key: string, title: string) => raw.query(`insert into tasks (project_id, key, title, kind, status, scope, branch) values ($1, $2, $3, 'initiative', 'Active', 's', $4) returning id`, [pid, key, title, `jl/${key.toLowerCase()}`]);
  for (const [k, t] of [["ZZ-I1", "Carrito"], ["ZZ-I2", "Pagos"], ["ZZ-I3", "Envíos"], ["ZZ-I4", "Cupones"]] as const) await ins(k, t);
  const i4 = (await raw.query(`select id from tasks where key = 'ZZ-I4'`)).rows[0].id;
  await raw.query(`insert into tasks (project_id, parent_id, key, title, kind, status, scope, work_type, phase) values ($1, $2, 'ZZ-I4-1', 'Paso 1', 'ticket', 'Merged', 's', 'code', 1), ($1, $2, 'ZZ-I4-2', 'Paso 2', 'ticket', 'In review', 's', 'code', 2)`, [pid, i4]);
});
after(async () => {
  prueba.stopAll();
  await raw.end();
  rmSync(TMP, { recursive: true, force: true });
});
beforeEach(async () => {
  prueba.resetPrueba();
  fm.reset();
  prueba.setPruebaDeps(fm.deps());
  maquinas.setMaquinasDeps({ env: { ...process.env, PLANIA_WORKTREES_ROOT: WT_ROOT }, portBusy: async () => false, exec: fm.exec });
  killed = [];
  sobrantes.setSobrantesDeps({ git: fm.git as any, kill: (p) => void killed.push(p), cmdOf: async () => "sh -c npm run dev -- --port 3290" });
  numeros.setNumerosDeps({
    // pg_database: whatever the fake psql holds, with sizes.
    query: async (_url, sql, params) => {
      if (/from pg_database where datname like/.test(sql)) {
        const [like, entrega] = params as string[];
        const prefix = like!.replace(/\\_/g, "_").replace(/%$/, "");
        return [...fm.m.bases.keys()].filter((n) => n.startsWith(prefix) || n === entrega).map((n) => ({ name: n, size: 8 * 1024 * 1024 }));
      }
      throw new Error("no answer");
    },
    ps: async () => "4242 1 1.0 20480\n",
    du: async () => 300 * 1024 * 1024,
    timers: false,
  });
});

test("I72-3 #1: moving an initiative to Done or Won't do deletes its copy and releases its footprints", async () => {
  await act("ZZ-I1", "encender");
  await act("ZZ-I2", "encender");
  await live("ZZ-I1");
  await live("ZZ-I2");
  assert.deepEqual(await openFps("%zz_i1%"), ["database", "worktree"]);
  await setStatus("ZZ-I1", "Done");
  await setStatus("ZZ-I2", "Won't do");
  assert.equal(await sobrantes.cleanClosedCopies(db), 2);
  for (const k of ["zz_i1", "zz_i2"]) {
    assert.deepEqual(await openFps(`%${k}%`), [], k);
    assert.ok(!fm.m.bases.has(`zz_dev_ini_${k}`));
    assert.ok(!existsSync(path.join(WT_ROOT, "zigzag", `_ini_${k}`)));
  }
  assert.equal((await raw.query(`select count(*)::int as n from footprints where kind = 'server' and released_at is null`)).rows[0].n, 0);
  const ev = (await raw.query(`select payload from events where type = 'machine.copy_deleted' order by id`)).rows.map((r) => r.payload.why);
  assert.deepEqual(ev, ["closed", "closed"]);
  assert.equal(await sobrantes.cleanClosedCopies(db), 0, "nothing left to clean");
});

test("I72-3: a copy whose tickets are all merged goes too; one with a ticket still in review stays", async () => {
  await act("ZZ-I4", "encender");
  await live("ZZ-I4");
  assert.equal(await sobrantes.cleanClosedCopies(db), 0);
  await setStatus("ZZ-I4-2", "Merged");
  assert.equal(await sobrantes.cleanClosedCopies(db), 1);
  assert.ok(!fm.m.bases.has("zz_dev_ini_zz_i4"));
  await setStatus("ZZ-I4-2", "In review");
});

test("I72-3 #2 #3: the sweep lists an orphan base, a closed initiative's server and an orphan folder; protected and foreign bases never", async () => {
  // ZZ-I3 is open with a live copy: nothing of it is a leftover.
  await act("ZZ-I3", "encender");
  await live("ZZ-I3");
  // An orphan base Plania registered for a closed initiative.
  await setStatus("ZZ-I2", "Done");
  fm.m.bases.set("zz_dev_ini_zz_i2", []);
  await registerFootprint(db, { project: "zigzag", kind: "database", locator: "zz_dev_ini_zz_i2@localhost:5432", purpose: "copia", teardown: "dropdb zz_dev_ini_zz_i2" }, sys as any);
  // A base with Plania's name pattern Plania never registered: not a candidate.
  fm.m.bases.set("zz_dev_ini_ajena", []);
  // Names that match but are protected or another project's.
  fm.m.bases.set("zz_dev_prueba", []);
  for (const loc of ["zz_dev@localhost:5432", "zz_dev_prueba@localhost:5432", "otro_dev_ini_zz_i9@localhost:5432"]) {
    await registerFootprint(db, { project: loc.startsWith("otro") ? "workia" : "zigzag", kind: "database", locator: loc, purpose: "x", teardown: "x" }, sys as any);
  }
  fm.m.bases.set("otro_dev_ini_zz_i9", []);
  // A server of the closed initiative still registered, not running in this process.
  await registerFootprint(db, { project: "zigzag", kind: "server", locator: "port:3290", purpose: "copia", teardown: "kill -TERM -4242", details: { pid: 4242, command: "npm run dev -- --port 3290", lane: "iniciativa", task_key: "ZZ-I2", copy_id: "zigzag::ini::ZZ-I2" } }, sys as any);
  // An orphan folder of the closed initiative, registered.
  const folder = path.join(WT_ROOT, "zigzag", "_ini_zz_i2");
  mkdirSync(folder, { recursive: true });
  await registerFootprint(db, { project: "zigzag", kind: "worktree", locator: folder, purpose: "copia", teardown: "git worktree remove" }, sys as any);
  // A folder Plania never registered.
  mkdirSync(path.join(WT_ROOT, "zigzag", "_ini_suelta"), { recursive: true });

  const r = await list();
  const ids = r.sobrantes.map((s: Json) => s.id).sort();
  assert.deepEqual(ids, ["base:zz_dev_ini_zz_i2", "carpeta:_ini_zz_i2", "servidor:port:3290"]);
  const base = r.sobrantes.find((s: Json) => s.kind === "base");
  assert.equal(base.initiative.key, "ZZ-I2");
  assert.equal(base.initiative.title, "Pagos");
  assert.ok(base.initiative.closed_at);
  assert.equal(base.size_bytes, 8 * 1024 * 1024);
  assert.equal(r.sobrantes.find((s: Json) => s.kind === "servidor").mem_bytes, 20480 * 1024);
  assert.equal(r.sobrantes.find((s: Json) => s.kind === "carpeta").size_bytes, 300 * 1024 * 1024);
  assert.equal(r.total, 3);
  for (const s of r.sobrantes) for (const bad of ["zz_dev_prueba", "otro_dev", "ajena", "suelta", "zz_i3"]) assert.ok(!JSON.stringify(s).includes(bad), `${bad} in ${s.id}`);
  assert.ok(!r.sobrantes.some((s: Json) => s.name === "zz_dev"));

  // #4: Borrar todo with a stale total is refused and deletes nothing.
  const stale = await call("DELETE", "/api/projects/zigzag/maquinas/sobrantes", { expected: 2 });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error, "LEFTOVERS_CHANGED");
  assert.equal(stale.body.total, 3);
  assert.ok(fm.m.bases.has("zz_dev_ini_zz_i2") && existsSync(folder));
  // One by one, then all.
  const one = await call("DELETE", `/api/projects/zigzag/maquinas/sobrantes/${encodeURIComponent("servidor:port:3290")}`);
  assert.equal(one.status, 200, JSON.stringify(one.body));
  assert.deepEqual(killed, [4242]);
  assert.equal(one.body.total, 2);
  assert.equal((await call("DELETE", `/api/projects/zigzag/maquinas/sobrantes/${encodeURIComponent("servidor:port:3290")}`)).body.error, "LEFTOVER_NOT_FOUND");
  const all = await call("DELETE", "/api/projects/zigzag/maquinas/sobrantes", { expected: 2 });
  assert.equal(all.status, 200, JSON.stringify(all.body));
  assert.equal(all.body.borrados, 2);
  assert.equal(all.body.total, 0);
  assert.ok(!fm.m.bases.has("zz_dev_ini_zz_i2"));
  assert.ok(!existsSync(folder));
  // What was protected or not Plania's is all still there; ZZ-I3's copy too.
  for (const n of ["zz_dev", "zz_dev_prueba", "otro_dev_ini_zz_i9", "zz_dev_ini_ajena", "zz_dev_ini_zz_i3"]) assert.ok(fm.m.bases.has(n), n);
  assert.ok(existsSync(path.join(WT_ROOT, "zigzag", "_ini_suelta")));
  assert.deepEqual(await openFps("%zz_i2%"), []);
});

test("I72-3: the nightly sweep cleans closed copies and records the leftovers it found", async () => {
  await act("ZZ-I3", "encender");
  await live("ZZ-I3");
  await setStatus("ZZ-I3", "Won't do");
  const r = await sobrantes.nightlySweep(db, new Date());
  assert.equal(r.cleaned, 1);
  const rec = (await raw.query(`select value from machine_state where key = 'maquinas:sweep:zigzag'`)).rows[0].value;
  assert.equal(rec.total, r.leftovers);
  assert.ok((await list()).swept_at);
  await setStatus("ZZ-I3", "Active");
});
