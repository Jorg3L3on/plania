// PLA-I52-3: antes y después. (Harness copied from i46-prueba.test.ts.) Was: PLA-I46-8: Encenderla. The test copy starts only on the click, runs origin/sandbox in Plania's own worktree,
// gets a free port (two floors and a runner's dev server never clash), takes fresh stills, says En vivo, is a
// registered footprint and is gone after Apagar, the idle sweep or a failed start. One run starts a real process
// (a tiny node server in a throwaway git repo) and checks the process group is gone after teardown. Test DB only.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const TMP = mkdtempSync(path.join(tmpdir(), "plania-pares-test-"));
process.env.PLANIA_CAPTURES_DIR = path.join(TMP, "captures");
const WT_ROOT = path.join(TMP, "worktrees");
const { app } = await import("../src/app.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const { makeDb } = await import("../src/db/client.js");
const writes = await import("../src/mcp/writes.js");
const probador = await import("../src/captures/probador.js");
const store = await import("../src/captures/store.js");
const { decodePng, pngDiff } = await import("../src/captures/diff.js");
const { deflateSync } = await import("node:zlib");
const prueba = await import("../src/captures/prueba.js");
type Deps = import("../src/captures/prueba.js").PruebaDeps;
type Json = Record<string, any>;

const jorge = () => ({ Cookie: `${SESSION_COOKIE}=${createSession()}` });
const post = async (slug: string, act: string, headers: Record<string, string> = jorge()) => app.request(`/api/projects/${slug}/captures/${act}`, { method: "POST", headers });
const read = async (slug: string): Promise<Json> => (await (await app.request(`/api/projects/${slug}/captures`, { headers: jorge() })).json()) as Json;
const until = async (f: () => boolean | Promise<boolean>, ms = 5000) => {
  const end = Date.now() + ms;
  while (!(await f())) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
};

let raw: pg.Client;
let db: ReturnType<typeof makeDb>["db"];

// A fake git that answers what start() asks; every call is kept.
const SANDBOX = "5a4db0c5a4db0c5a4db0c5a4db0c5a4db0c5a4db";
let gitCalls: string[][] = [];
const fakeGit = async (args: string[], cwd: string) => {
  gitCalls.push([...args, `@${cwd}`]);
  if (args[0] === "worktree" && args[1] === "add") mkdirSync(args[3]!, { recursive: true });
  if (args[0] === "rev-parse" && args[1] === "--abbrev-ref") return { code: 0, stdout: "HEAD\n", stderr: "" };
  if (args[0] === "rev-parse") return { code: 0, stdout: `${SANDBOX}\n`, stderr: "" };
  return { code: 0, stdout: "", stderr: "" };
};

// Fake processes: each spawn is a child whose exit the test triggers.
type FakeChild = { pid: number; command: string; cwd: string; env: NodeJS.ProcessEnv; exit: (code: number) => void; stdout: any; stderr: any; once: any };
let children: FakeChild[] = [];
let killed: [number, string][] = [];
let nextPid = 7000;
const fakeSpawn: Deps["spawn"] = (command, { cwd, env }) => {
  const listeners: Record<string, ((...a: any[]) => void)[]> = {};
  const stream = () => ({ on: (_e: string, f: (d: string) => void) => (listeners.data ??= []).push(f) });
  const c: FakeChild = {
    pid: nextPid++,
    command,
    cwd,
    env,
    stdout: stream(),
    stderr: stream(),
    once: (e: string, f: (...a: any[]) => void) => (listeners[e] ??= []).push(f),
    exit: (code) => {
      for (const f of listeners.data ?? []) f("Error: falló el arranque\n");
      for (const f of listeners.exit ?? []) f(code, null);
    },
  };
  children.push(c);
  return c as any;
};
let upPorts = new Set<number>();
let busyPorts = new Set<number>();
let captures: Json[] = [];
let clock = 1_000_000;

const fakeDeps = (over: Partial<Deps> = {}): Deps => ({
  git: fakeGit,
  spawn: fakeSpawn,
  kill: (pid, sig) => void killed.push([pid, sig]),
  alive: () => false,
  exec: async () => ({ code: 0, stdout: "", stderr: "" }),
  up: async (url) => upPorts.has(Number(new URL(url).port)),
  portBusy: async (port) => busyPorts.has(port),
  capture: async (_db, input) => {
    captures.push(input as Json);
    return { run_id: "r", project: input.project, task_key: null, commit: null, branch: null, base_url: input.base_url!, ok: 6, failed: 0, stills: [] };
  },
  env: { ...process.env, PLANIA_WORKTREES_ROOT: WT_ROOT },
  pollMs: 5,
  readyMs: 2_000,
  stopGraceMs: 10,
  sweep: false,
  signals: false,
  now: () => clock,
  ...over,
});

const SETTINGS = (port: number, extra: Json = {}) => ({
  start_command: "npm run dev -- --port {port}",
  port,
  ready_path: "/registro/ejemplo",
  pages: [{ key: "formulario", path: "/registro/ejemplo", label: "Formulario de bienvenida" }],
  ...extra,
});
const setCapture = (slug: string, capture: Json, repo: string) =>
  raw.query(`update projects set settings = settings || jsonb_build_object('capture', $1::jsonb, 'local', jsonb_build_object('repo_path', $2::text)) where slug = $3`, [JSON.stringify(capture), repo, slug]);
const liveServers = async () => (await raw.query(`select locator, purpose, teardown, details from footprints where kind = 'server' and released_at is null order by locator`)).rows;

const REPO = path.join(TMP, "repo");

before(async () => {
  raw = await resetTestDb();
  ({ db } = makeDb());
  mkdirSync(REPO, { recursive: true });
  await setCapture("zigzag", SETTINGS(3000), REPO);
  await setCapture("workia", SETTINGS(3000), REPO);
});

after(async () => {
  prueba.stopAll();
  await raw.end();
  rmSync(TMP, { recursive: true, force: true });
});

beforeEach(async () => {
  prueba.resetPrueba();
  prueba.setPruebaDeps(fakeDeps());
  gitCalls = [];
  children = [];
  killed = [];
  upPorts = new Set();
  busyPorts = new Set();
  captures = [];
  await raw.query(`update footprints set released_at = now() where released_at is null`);
});


const ctx = { actor: { agent: "t", session_id: "s-i52-3", machine: "ci" } };
const MUESTRA = {
  frase: "Las asesoras pueden apagar sucursales.",
  vistas: [
    { key: "sucursales", label: "Sucursales", path: "/panel/sucursales" },
    { key: "apagada", label: "Formulario apagado", path: "/registro/satelite" },
  ],
  pasos: ["uno", "dos", "tres"],
};

// A tiny PNG writer (RGB, filter 0) so the stills are real images the diff can read.
function crc(buf: Buffer): number {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
}
function png(w: number, h: number, box?: { x: number; y: number; w: number; h: number }): Buffer {
  const rows: Buffer[] = [];
  for (let y = 0; y < h; y++) {
    const row = Buffer.alloc(1 + w * 3, 240);
    row[0] = 0;
    if (box && y >= box.y && y < box.y + box.h) for (let x = box.x; x < box.x + box.w; x++) row.fill(20, 1 + x * 3, 4 + x * 3);
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0))]);
}

// A fake capture that writes real rows: antes of «sucursales» is a new screen (404), antes and después of «apagada»
// differ in one box. failDespues makes every después still fail.
let failDespues = false;
let despuesError = "pidió entrar otra vez";
const fakeCapture = async (d: typeof db, input: Json) => {
  const [p] = (await raw.query(`select id from projects where slug = $1`, [input.project])).rows;
  const [t] = (await raw.query(`select id from tasks where key = $1`, [input.task_key])).rows;
  const runId = crypto.randomUUID();
  const stills: Json[] = [];
  for (const vp of ["desktop", "phone"] as const) {
    for (const v of input.views) {
      const base = { projectId: p.id, taskId: t.id, runId, pageKey: v.key, pageLabel: v.label, path: v.path, viewport: vp, width: vp === "desktop" ? 1280 : 390, height: 100, commit: input.commit ?? null, branch: input.branch, actor: input.actor, side: input.side };
      let row;
      if (input.side === "antes" && v.key === "sucursales") row = await store.recordStill(d, input.project, { ...base, ok: false, error: "no existe todavía", url: null, missing: true });
      else if (input.side === "despues" && failDespues) row = await store.recordStill(d, input.project, { ...base, ok: false, error: despuesError, url: null });
      else row = await store.recordStill(d, input.project, { ...base, ok: true, png: png(40, 30, input.side === "despues" && v.key === "apagada" ? { x: 10, y: 5, w: 8, h: 6 } : undefined), url: null });
      stills.push({ page: v.key, viewport: vp, status: row.status, id: row.id, error: row.error ?? undefined });
    }
  }
  const ok = stills.filter((s) => s.status === "ok").length;
  return { run_id: runId, project: input.project, task_key: input.task_key, commit: null, branch: input.branch, base_url: input.base_url, ok, failed: stills.length - ok, stills } as any;
};

async function delivery(title: string): Promise<string> {
  const t = await writes.createTask(db, { project: "zigzag", title, scope: "s", checks: ["ok"] } as never, ctx as never);
  await raw.query(`update tasks set muestra = $1::jsonb, branch = $2, status = 'In review' where key = $3`, [JSON.stringify(MUESTRA), `jl/${t.key.toLowerCase()}`, t.key]);
  return t.key;
}
const taskRow = async (key: string) => (await raw.query(`select * from tasks where key = $1`, [key])).rows[0];
const pass = (key: string, over: Json = {}) => {
  // Both copies answer as soon as they start.
  upPorts.add(3000);
  upPorts.add(3001);
  return probador.probar(db, "zigzag", key, { capture: fakeCapture as any, pollMs: 5, waitMs: 3000, ...over });
}
async function passEvents(key: string): Promise<{ type: string; payload: Json }[]> {
  const schema = await import("../src/db/schema.js");
  const { and, asc, eq, like } = await import("drizzle-orm");
  return (await db.select({ type: schema.events.type, payload: schema.events.payload }).from(schema.events).where(and(eq(schema.events.taskKey, key), like(schema.events.type, "probador.%"))).orderBy(asc(schema.events.id))) as never;
};

describe("the PNG diff", () => {
  test("reads Chrome-like PNGs and boxes what changed, in fractions", () => {
    const a = png(40, 30);
    const b = png(40, 30, { x: 10, y: 5, w: 8, h: 6 });
    assert.deepEqual([decodePng(a)?.width, decodePng(a)?.height], [40, 30]);
    assert.equal(pngDiff(a, a), null, "the same picture changes nothing");
    const box = pngDiff(a, b) as Json;
    assert.ok(box.x >= 0.2 && box.x <= 0.3 && box.y >= 0.1 && box.y <= 0.25, JSON.stringify(box));
    assert.ok(box.w > 0.1 && box.w < 0.35 && box.ratio > 0, JSON.stringify(box));
    assert.equal(pngDiff(Buffer.from("nope"), b), "unreadable");
  });
});

describe("PLA-154: antes never comes from Plania's own delivery copy", () => {
  test("after a restart, the delivery copy on the app's port is not taken for the app's own server", async () => {
    // A delivery copy from an earlier pass holds settings.port (3000); the sandbox copy is gone (a restart reaped it).
    upPorts.add(3000);
    upPorts.add(3001);
    await prueba.encenderEntrega(db, "zigzag", { key: "OTRA", branch: "jl/otra" });
    for (let i = 0; i < 200 && prueba.entregaRead("zigzag")?.phase !== "live"; i++) await new Promise((r) => setTimeout(r, 5));
    assert.equal(prueba.entregaRead("zigzag")?.port, 3000, "the delivery copy took the app's port");
    assert.equal(prueba.pruebaOf("zigzag"), null, "no sandbox copy");
    const key = await delivery("Catálogo como revista");
    const out: Json[] = [];
    await probador.probar(db, "zigzag", key, { capture: (async (d: unknown, input: Json) => { out.push(input); return fakeCapture(d as never, input as never); }) as any, pollMs: 5, waitMs: 3000 });
    const antes = out.find((x) => x.side === "antes");
    const despues = out.find((x) => x.side === "despues");
    assert.ok(antes && despues, "both sides were taken");
    assert.notEqual(antes!.base_url, despues!.base_url, "antes is not the delivery copy");
  });
});

describe("PLA-158 (F-27): a pass never waits silently", () => {
  test("the delivery copy held by another delivery (a live copy left open) closes and the pass goes on, saying so meanwhile", async () => {
    upPorts.add(3000);
    upPorts.add(3001);
    await prueba.encenderEntrega(db, "zigzag", { key: "OTRA", branch: "jl/otra" });
    for (let i = 0; i < 200 && prueba.entregaRead("zigzag")?.phase !== "live"; i++) await new Promise((r) => setTimeout(r, 5));
    const key = await delivery("Entrega nueva gana la copia");
    let during: Json | null = null;
    const s = await pass(key, {
      apagarEntrega: async (d: typeof db, slug: string) => {
        during = (await taskRow(key)).probador;
        return prueba.apagarEntrega(d, slug);
      },
    });
    assert.equal(s?.state, "lista");
    assert.equal(during!.state, "tomando");
    assert.match(during!.waiting, /copia en vivo de otra entrega/, "the card says what the pass waits on");
    assert.equal(prueba.entregaRead("zigzag")?.key, key, "the new delivery holds the copy now");
    assert.equal((await taskRow(key)).probador.waiting ?? null, null, "nothing to wait on once done");    // PLA-I73-1: the pass's start and end are events, for the stopwatch.
    const kinds = await passEvents(key);
    assert.deepEqual(kinds.map((e) => e.type), ["probador.started", "probador.pass"]);
    assert.equal(kinds[1]!.payload.ok, true);
    assert.ok(Array.isArray(kinds[1]!.payload.phases));
  });

  test("a pass behind another one of the same project says it waits for it, then works", async () => {
    const first = await delivery("Primera en la fila");
    const second = await delivery("Segunda en la fila");
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow = async (d: unknown, input: Json) => {
      await gate;
      return fakeCapture(d as never, input as never);
    };
    const a = pass(first, { capture: slow });
    await until(async () => (await taskRow(first)).probador?.state === "tomando");
    const b = pass(second);
    await until(async () => !!(await taskRow(second)).probador?.waiting);
    const waiting = (await taskRow(second)).probador;
    assert.equal(waiting.state, "tomando");
    assert.equal(waiting.waiting, "Espera a que terminen las fotos de otra entrega.");
    release();
    assert.equal((await a)?.state, "lista");
    assert.equal((await b)?.state, "lista");
    assert.equal((await taskRow(second)).probador.waiting ?? null, null);
  });
});

describe("antes y después", () => {
  test("photographs both sides; a path that was not there is nueva; the change is boxed; then the card may show", async () => {
    const key = await delivery("Pantalla de sucursales");
    const t0 = await taskRow(key);
    const [p] = (await raw.query(`select * from projects where slug = 'zigzag'`)).rows;
    assert.equal(probador.probadorGate(p, { ...t0, muestra: t0.muestra, probador: t0.probador } as any, null).pending, true, "no pictures yet: not the owner's turn");
    const s = await pass(key);
    assert.equal(s?.state, "lista");
    assert.equal(s?.error, null);
    const r = (await (await app.request(`/api/projects/zigzag/probador/${key}`, { headers: jorge() })).json()) as Json;
    assert.deepEqual(r.vistas.map((v: Json) => [v.key, v.kind]), [["sucursales", "nueva"], ["apagada", "cambio"]]);
    assert.equal(r.vistas[0].desktop.antes.missing, true);
    assert.ok(r.vistas[0].desktop.despues.still.image_url.endsWith(".png"));
    assert.ok(r.vistas[1].phone.diff && r.vistas[1].phone.diff.w > 0);
    assert.ok(r.vistas[1].desktop.antes.still, "antes of a changed view is there");
    const t1 = await taskRow(key);
    assert.equal(probador.probadorGate(p, t1, null).pending, false);
    assert.equal(probador.probadorGate(p, t1, null).hold, null);
    // The Ventana does not show a delivery's pairs.
    const v = await read("zigzag");
    assert.ok(!v.pages.some((pg: Json) => pg.key === "sucursales" || pg.key === "apagada"));
  });

  test("no picture of the delivery: back to Taller with the reason; the second time the card shows with the reason", async () => {
    failDespues = true;
    try {
      const key = await delivery("Pantalla rota");
      const s1 = await pass(key);
      assert.equal(s1?.state, "fallo");
      assert.match(s1!.error!, /pidió entrar otra vez/);
      const t1 = await taskRow(key);
      assert.equal(t1.status, "Ready", "returned to Taller");
      const ev = (await raw.query(`select type from events where task_key = $1`, [key])).rows.map((r: Json) => r.type);
      assert.ok(ev.includes("probador.returned"));
      const [p] = (await raw.query(`select * from projects where slug = 'zigzag'`)).rows;
      assert.equal(probador.probadorGate(p, t1, null).pending, true);
      await raw.query(`update tasks set status = 'In review' where key = $1`, [key]);
      const s2 = await pass(key);
      assert.equal(s2?.state, "lista");
      assert.equal(s2?.attempts, 2);
      const t2 = await taskRow(key);
      assert.equal(t2.status, "In review", "not returned a second time");
      const g = probador.probadorGate(p, t2, null);
      assert.equal(g.pending, false);
      assert.match(g.hold!, /^Faltan fotos: /);
    } finally {
      failDespues = false;
    }
  });

  test("PLA-76: a después page that crashed reads «error», not «cambió», and holds the card with the error's line", async () => {
    failDespues = true;
    despuesError = '/panel/sucursales muestra un error: Unhandled Runtime Error: Error: relation "citas" does not exist';
    try {
      const key = await delivery("Pantalla que truena");
      const s1 = await pass(key, { returnToTaller: false });
      assert.equal(s1?.state, "fallo", "nothing but crashes: Taller's to fix first");
      assert.match(s1!.error ?? "", /muestra un error: Unhandled Runtime Error/);
      const s = await pass(key, { returnToTaller: false });
      assert.equal(s?.state, "lista");
      const r = (await (await app.request(`/api/projects/zigzag/probador/${key}`, { headers: jorge() })).json()) as Json;
      assert.deepEqual(r.vistas.map((v: Json) => v.kind), ["error", "error"]);
      assert.match(r.vistas[0].desktop.despues.error, /relation "citas" does not exist/);
      const [p] = (await raw.query(`select * from projects where slug = 'zigzag'`)).rows;
      const g = probador.probadorGate(p, await taskRow(key), null);
      assert.match(g.hold!, /^Faltan fotos: .*muestra un error/, "held back from Aceptar");
      assert.equal(probador.crashed("pidió entrar otra vez"), false);
      assert.equal(probador.crashed("/x respondió 502"), true);
      assert.equal(probador.crashed("/x respondió 404"), false);
    } finally {
      failDespues = false;
      despuesError = "pidió entrar otra vez";
    }
  });

  test("a delivery copy that never answers is a failure, not a blind card", async () => {
    const key = await delivery("Nunca arranca");
    upPorts = new Set();
    const s = await probador.probar(db, "zigzag", key, { capture: fakeCapture as any, pollMs: 5, waitMs: 200, returnToTaller: false });
    assert.equal(s?.state, "fallo");
    assert.match(s!.error!, /no arrancó a tiempo|no respondió/);    const ends = (await passEvents(key)).filter((e) => e.type === "probador.pass");
    assert.equal(ends.at(-1)!.payload.ok, false, "a failed pass ends with an event too (PLA-I73-1)");
  });

  test("without a muestra nothing happens and nothing is held", async () => {
    const t = await writes.createTask(db, { project: "zigzag", title: "Sin muestra", scope: "s", checks: ["ok"] } as never, ctx as never);
    assert.equal(await probador.probar(db, "zigzag", t.key, { capture: fakeCapture as any }), null);
    const [p] = (await raw.query(`select * from projects where slug = 'zigzag'`)).rows;
    assert.equal(probador.probadorGate(p, await taskRow(t.key), null).pending, false);
  });
});

// PLA-52: a pass lives in one process. What an earlier server left half-taken, what never started, what failed without
// going back, and pictures of an older commit are taken again by the sweep; nothing stays hidden for good.
describe("PLA-52: the sweep takes the pictures again", () => {
  const sweepDeps = (over: Json = {}) => ({ force: true, capture: fakeCapture as any, pollMs: 5, waitMs: 3000, ...over });
  const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString();
  const project = async () => (await raw.query(`select * from projects where slug = 'zigzag'`)).rows[0];
  const up = () => {
    upPorts.add(3000);
    upPorts.add(3001);
  };
  beforeEach(async () => {
    // Only this test's delivery is In review on the floor.
    await raw.query(`update tasks set status = 'Done' where status = 'In review'`);
  });

  test("a delivery an earlier server left «tomando» gets its pass again; a pass that just started is left alone", async () => {
    const key = await delivery("Reinicio a media foto");
    await raw.query(`update tasks set probador = $1::jsonb where key = $2`, [JSON.stringify({ state: "tomando", attempts: 0, error: null, commit: null, at: minutesAgo(0) }), key]);
    up();
    assert.deepEqual(await probador.sweepProbador(db, new Date(), sweepDeps()), { restarted: 0, opened: 0 }, "a fresh «tomando» may be another server's live pass");
    await raw.query(`update tasks set probador = $1::jsonb where key = $2`, [JSON.stringify({ state: "tomando", attempts: 0, error: null, commit: null, at: minutesAgo(10) }), key]);
    assert.equal(probador.probadorGate(await project(), await taskRow(key), null).pending, true);
    assert.deepEqual(await probador.sweepProbador(db, new Date(), sweepDeps()), { restarted: 1, opened: 0 });
    assert.deepEqual(await probador.sweepProbador(db, new Date(), sweepDeps()), { restarted: 0, opened: 0 }, "one pass at a time per floor");
    await probador.waitForProbador();
    const t = await taskRow(key);
    assert.equal(t.probador.state, "lista");
    assert.equal(probador.probadorGate(await project(), t, null).pending, false, "the card may show");
  });

  test("a delivery whose pass never started is photographed", async () => {
    const key = await delivery("Nunca empezó");
    await raw.query(`update tasks set status_changed_at = now() - interval '10 minutes' where key = $1`, [key]);
    up();
    assert.equal((await probador.sweepProbador(db, new Date(), sweepDeps())).restarted, 1);
    await probador.waitForProbador();
    assert.equal((await taskRow(key)).probador.state, "lista");
  });

  test("an error of Plania's own never leaves «tomando»: it is logged, tried once more, then the card shows with the reason", async () => {
    const key = await delivery("Falla por dentro");
    // A capture whose run id is not a uuid makes the diff step throw past every handled failure.
    const broken = async (_d: typeof db, input: Json) => ({ run_id: "no-es-uuid", project: input.project, task_key: input.task_key, commit: null, branch: input.branch, base_url: input.base_url, ok: 1, failed: 0, stills: [] }) as any;
    const lines: string[] = [];
    const log = console.log;
    console.log = (...a: unknown[]) => void lines.push(a.join(" "));
    try {
      up();
      const s1 = await probador.probar(db, "zigzag", key, { capture: broken, pollMs: 5, waitMs: 3000 });
      assert.equal(s1?.state, "fallo");
      assert.equal(s1?.attempts, 1);
      const t1 = await taskRow(key);
      assert.equal(t1.status, "In review", "not Taller's to fix: it stays In review");
      assert.ok(lines.some((l) => l.includes(`[probador] zigzag/${key} failed`)), "the error is in the log");
      up();
      // A second later: on a fast machine the failure and this sweep can share a millisecond, and age > 0 is false.
      assert.equal((await probador.sweepProbador(db, new Date(Date.now() + 1000), sweepDeps({ capture: broken, settleMs: 0 }))).restarted, 1);
      await probador.waitForProbador();
    } finally {
      console.log = log;
    }
    const t2 = await taskRow(key);
    assert.equal(t2.probador.state, "lista");
    assert.equal(t2.probador.attempts, 2);
    const g = probador.probadorGate(await project(), t2, null);
    assert.equal(g.pending, false);
    assert.match(g.hold!, /Plania falló al tomar las fotos/);
  });

  test("the PR moved after the pictures: one retake; still another commit, the card shows and says so", async () => {
    const key = await delivery("Empuje después de las fotos");
    up();
    const s = await pass(key);
    assert.equal(s?.state, "lista");
    const t0 = await taskRow(key);
    const p = await project();
    const HEAD = "f".repeat(40);
    await raw.query(`insert into pull_requests (project_id, repo, number, url, task_id, state, head_sha, ci_state) values ($1, 'o/r', 520, 'https://github.com/o/r/pull/520', $2, 'open', $3, 'success')`, [p.id, t0.id, HEAD]);
    if (!t0.probador.commit) await raw.query(`update tasks set probador = probador || '{"commit":"aaaaaaa"}'::jsonb where key = $1`, [key]);
    assert.equal(probador.probadorGate(p, await taskRow(key), HEAD).pending, true, "pictures of an older commit hide the card");
    up();
    assert.deepEqual(await probador.sweepProbador(db, new Date(), sweepDeps()), { restarted: 1, opened: 0 });
    await probador.waitForProbador();
    const t1 = await taskRow(key);
    assert.equal(t1.probador.for_head, HEAD);
    if (!t1.probador.commit) await raw.query(`update tasks set probador = probador || '{"commit":"aaaaaaa"}'::jsonb where key = $1`, [key]);
    assert.deepEqual(await probador.sweepProbador(db, new Date(), sweepDeps()), { restarted: 0, opened: 1 }, "asked once for this head already");
    const t2 = await taskRow(key);
    const g = probador.probadorGate(p, t2, HEAD);
    assert.equal(g.pending, false);
    assert.match(g.hold!, /commit anterior/);
    assert.deepEqual(await probador.sweepProbador(db, new Date(), sweepDeps()), { restarted: 0, opened: 0 }, "and it does not loop");
  });

  test("the board and the audit agree with the card: no Te toca before the pictures, and limbo is a finding", async () => {
    const { projectEtapas } = await import("../src/api/etapa.js");
    const { auditProject } = await import("../src/mcp/audit.js");
    const key = await delivery("Entregada sin fotos");
    const p = await project();
    const t = await taskRow(key);
    await raw.query(`insert into pull_requests (project_id, repo, number, url, task_id, state, head_sha, ci_state) values ($1, 'o/r', 521, 'https://github.com/o/r/pull/521', $2, 'open', 'abc1234', 'success')`, [p.id, t.id]);
    const th = (await raw.query(`insert into threads (kind, project_id) values ('project', $1) on conflict do nothing returning id`, [p.id])).rows[0] ?? (await raw.query(`select id from threads where project_id = $1`, [p.id])).rows[0];
    await raw.query(`insert into thread_messages (thread_id, author_agent, author_role, body, links) values ($1, 'taller-zigzag', 'taller', 'queda En revisión', $2::jsonb)`, [th.id, JSON.stringify([{ kind: "ticket", ref: key, title: "x" }])]);
    const [pd] = await db.select().from((await import("../src/db/schema.js")).projects).where((await import("drizzle-orm")).eq((await import("../src/db/schema.js")).projects.slug, "zigzag"));
    const stage = async () => (await projectEtapas(db, pd!)).byTicket.get(key)!.etapa;
    const e1 = await stage();
    assert.equal(e1.etapa, "en_revision", "no pictures yet: not the owner's turn on the board either");
    assert.equal(e1.reason, "Plania toma las fotos de la entrega.");
    const limbo = async () => (await auditProject(db, pd!)).filter((f) => f.code === "REVIEW_NOBODYS_TURN" && f.key === key);
    assert.equal((await limbo()).length, 0, "not in its first half hour");
    await raw.query(`update tasks set status_changed_at = now() - interval '45 minutes' where key = $1`, [key]);
    const found = await limbo();
    assert.equal(found.length, 1);
    assert.match(found[0]!.detail, /fotos/);
    await raw.query(`update pull_requests set ci_state = 'pending' where number = 521`);
    assert.equal((await limbo()).length, 0, "PR checks running: someone is on it");
    await raw.query(`update pull_requests set ci_state = 'success' where number = 521`);
    // Pictures done: the board says Te toca, as the card does, and the audit is quiet.
    await raw.query(`update tasks set probador = $1::jsonb where key = $2`, [JSON.stringify({ state: "lista", attempts: 0, error: null, commit: "abc1234", at: minutesAgo(1) }), key]);
    assert.equal((await stage()).etapa, "te_toca");
    assert.equal((await limbo()).length, 0);
  });
});

// PLA-78: the muestra's fake rows reach both throwaway copies' databases (never the app's own) before the pictures.
describe("PLA-78: the muestra's datos", () => {
  const DATOS = "insert into cita (novia, hora) values ('Novia Ejemplo 1', now() + interval '2 hours');";
  let execs: { command: string; stdin?: string; env?: NodeJS.ProcessEnv }[] = [];
  let failOn: RegExp | null = null;
  const dbExec: Deps["exec"] = async (command, opts) => {
    execs.push({ command, stdin: opts.stdin, env: opts.env });
    if (failOn && command.startsWith("psql") && failOn.test(opts.env?.PLANIA_COPY_URL ?? "")) return { code: 3, stdout: "", stderr: 'psql:<stdin>:1: ERROR:  relation "cita" does not exist\nLINE 1: insert into cita\n' };
    return { code: 0, stdout: "", stderr: "" };
  };
  const loads = () => execs.filter((e) => e.command.includes("--single-transaction")).map((e) => [new URL(e.env!.PLANIA_COPY_URL!).pathname, e.stdin]);
  before(async () => {
    writeFileSync(path.join(REPO, ".env.local"), "DATABASE_URL=postgres://localhost:5432/zigzag_dev\n");
    await setCapture("zigzag", SETTINGS(3000, { database: { env_var: "DATABASE_URL", migrate_command: "npm run db:migrate" } }), REPO);
  });
  after(async () => {
    rmSync(path.join(REPO, ".env.local"), { force: true });
    await setCapture("zigzag", SETTINGS(3000), REPO);
  });
  beforeEach(() => {
    execs = [];
    failOn = null;
    // Nothing answers on the port before Plania starts its own copies (else the test copy is someone else's server).
    prueba.setPruebaDeps(fakeDeps({ exec: dbExec, up: async () => children.length > 0 }));
  });
  const pass = (key: string, over: Json = {}) => probador.probar(db, "zigzag", key, { capture: fakeCapture as any, pollMs: 5, waitMs: 3000, ...over });
  const withDatos = async (title: string, datos: string | null) => {
    const key = await delivery(title);
    if (datos) await raw.query(`update tasks set muestra = muestra || jsonb_build_object('datos', $1::text) where key = $2`, [datos, key]);
    return key;
  };

  test("the rows go into <db>_entrega and <db>_prueba in one transaction; a retake does not load them twice", async () => {
    const key = await withDatos("Citas de hoy", DATOS);
    const s = await pass(key);
    assert.equal(s?.state, "lista", JSON.stringify(s));
    assert.deepEqual(loads().sort(), [["/zigzag_dev_entrega", DATOS], ["/zigzag_dev_prueba", DATOS]]);
    assert.ok(!execs.some((e) => e.env?.PLANIA_COPY_URL?.endsWith("/zigzag_dev")), "never the app's own database");
    assert.equal(prueba.datosDe("zigzag", "entrega"), prueba.hashDatos(DATOS));
    execs = [];
    await pass(key);
    assert.deepEqual(loads(), [], "same copy, same rows: nothing loaded again");
  });

  test("another delivery gets clean copies: the ones holding other rows start again", async () => {
    const a = await withDatos("Citas con datos", DATOS);
    await pass(a);
    const pidsBefore = children.map((c) => c.pid);
    const b = await withDatos("Sin datos", null);
    execs = [];
    killed = [];
    const s = await pass(b);
    assert.equal(s?.state, "lista");
    assert.ok(pidsBefore.every((pid) => killed.some(([k]) => k === pid)), "both copies with A's rows were stopped");
    assert.equal(prueba.datosDe("zigzag", "sandbox"), null);
    assert.equal(prueba.datosDe("zigzag", "entrega"), null);
    assert.deepEqual(loads(), []);
  });

  test("rows that fail on the delivery's own database go back to Taller with the error; failing on Antes is fine", async () => {
    failOn = /_prueba$/;
    const ok = await withDatos("Columna nueva", DATOS);
    execs = [];
    assert.equal((await pass(ok))?.state, "lista", "Antes may lack the branch's new table");
    // PLA-110 (F-42): the one transaction failed on Antes, so each statement was tried on its own; what fits stays.
    const each = execs.filter((e) => e.command.includes("ON_ERROR_STOP=0"));
    assert.equal(each.length, 1);
    assert.match(each[0]!.env!.PLANIA_COPY_URL!, /_prueba$/);
    assert.equal(each[0]!.stdin, DATOS);
    assert.equal(prueba.datosDe("zigzag", "sandbox"), prueba.hashDatos(DATOS));
    failOn = /_entrega$/;
    const bad = await withDatos("SQL roto", DATOS.replace("cita", "cita2"));
    const s = await pass(bad, { returnToTaller: false });
    assert.equal(s?.state, "fallo");
    assert.equal(s?.error, 'Los datos de la muestra no se cargaron: ERROR:  relation "cita" does not exist');
  });

  test("PLA-97: a step's copies also get the rows of its initiative's earlier accepted steps, after its own, statement by statement", async () => {
    failOn = null;
    const ini = (await writes.createTask(db, { project: "zigzag", kind: "initiative", title: "Agenda", scope: "s" } as never, ctx as never)) as Json;
    const HOURS = "insert into horario values (1);";
    const first = await withDatos("Paso 1: horario", HOURS);
    const later = await withDatos("Paso 2: la novia agenda", DATOS);
    await raw.query(`update tasks set parent_id = (select id from tasks where key = $1), phase = 1, status = 'Merged' where key = $2`, [ini.key, first]);
    await raw.query(`update tasks set parent_id = (select id from tasks where key = $1), phase = 2 where key = $2`, [ini.key, later]);
    await prueba.apagar(db, "zigzag").catch(() => null);
    await prueba.apagarEntrega(db, "zigzag").catch(() => null);
    execs = [];
    assert.equal((await pass(later))?.state, "lista");
    const psql = execs.filter((e) => e.command.startsWith("psql") && e.env?.PLANIA_COPY_URL?.endsWith("_entrega"));
    assert.deepEqual(psql.map((e) => [e.command.includes("--single-transaction") ? "own" : "earlier", e.stdin]), [["own", DATOS], ["earlier", HOURS]], "its own rows first, then step 1's");
    assert.ok(execs.some((e) => e.stdin === HOURS && e.env?.PLANIA_COPY_URL?.endsWith("_prueba")), "on Antes too");
    execs = [];
    await pass(later);
    assert.ok(!execs.some((e) => e.stdin === HOURS), "a retake on the same copy loads none twice");
  });

  test("a copy without its own database never gets the rows; finish takes datos in the muestra", async () => {
    const { parseMuestra } = await import("../src/captures/muestra.js");
    assert.equal(parseMuestra({ ...MUESTRA, datos: DATOS }).ok, true);
    assert.equal(parseMuestra({ ...MUESTRA, datos: "x".repeat(20_001) }).ok, false);
    assert.equal(prueba.copyDatabase({ DATABASE_URL: "postgres://localhost/zigzag_dev" }), null);
    assert.equal(prueba.copyDatabase(null), null);
    assert.deepEqual(prueba.copyDatabase({ DATABASE_URL: "postgres://localhost/zigzag_dev_prueba" }), { url: "postgres://localhost/zigzag_dev_prueba", name: "zigzag_dev_prueba" });
  });
});
