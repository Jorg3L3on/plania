// PLA-I52-3: antes y después. (Harness copied from i46-prueba.test.ts.) Was: PLA-I46-8: Encenderla. The test copy starts only on the click, runs origin/sandbox in Plania's own worktree,
// gets a free port (two floors and a runner's dev server never clash), takes fresh stills, says En vivo, is a
// registered footprint and is gone after Apagar, the idle sweep or a failed start. One run starts a real process
// (a tiny node server in a throwaway git repo) and checks the process group is gone after teardown. Test store only.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";
import { resetTestStore, useTestEnv, type TestStore } from "./helpers.js";

useTestEnv();
const TMP = mkdtempSync(path.join(tmpdir(), "plania-pares-test-"));
process.env.PLANIA_CAPTURES_DIR = path.join(TMP, "captures");
const WT_ROOT = path.join(TMP, "worktrees");
const { app } = await import("../src/app.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const { makeDb } = await import("../src/db/client.js");
const writes = await import("../src/mcp/writes.js");
const probador = await import("../src/captures/probador.js");
const stillStore = await import("../src/captures/store.js");
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

let store: TestStore;
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
  store.fix(async (uow) => {
    const p = (await uow.get("projects", { slug }))!;
    await uow.update("projects", { slug }, { settings: { ...p.settings, capture, local: { repo_path: repo } } as typeof p.settings });
  });

const REPO = path.join(TMP, "repo");

before(async () => {
  store = await resetTestStore();
  ({ db } = makeDb());
  mkdirSync(REPO, { recursive: true });
  await setCapture("zigzag", SETTINGS(3000), REPO);
  await setCapture("workia", SETTINGS(3000), REPO);
});

after(async () => {
  prueba.stopAll();
  await store.end();
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
  await store.fix((uow) => uow.update("footprints", { releasedAt: null }, { releasedAt: uow.now }));
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
const fakeCapture = async (d: typeof db, input: Json) => {
  const p = (await store.get("projects", { slug: input.project }))!;
  const t = (await store.get("tasks", { projectId: p.id, key: input.task_key }))!;
  const runId = crypto.randomUUID();
  const stills: Json[] = [];
  for (const vp of ["desktop", "phone"] as const) {
    for (const v of input.views) {
      const base = { projectId: p.id, taskId: t.id, runId, pageKey: v.key, pageLabel: v.label, path: v.path, viewport: vp, width: vp === "desktop" ? 1280 : 390, height: 100, commit: input.commit ?? null, branch: input.branch, actor: input.actor, side: input.side };
      let row;
      if (input.side === "antes" && v.key === "sucursales") row = await stillStore.recordStill(d, input.project, { ...base, ok: false, error: "no existe todavía", url: null, missing: true });
      else if (input.side === "despues" && failDespues) row = await stillStore.recordStill(d, input.project, { ...base, ok: false, error: "pidió entrar otra vez", url: null });
      else row = await stillStore.recordStill(d, input.project, { ...base, ok: true, png: png(40, 30, input.side === "despues" && v.key === "apagada" ? { x: 10, y: 5, w: 8, h: 6 } : undefined), url: null });
      stills.push({ page: v.key, viewport: vp, status: row.status, id: row.id, error: row.error ?? undefined });
    }
  }
  const ok = stills.filter((s) => s.status === "ok").length;
  return { run_id: runId, project: input.project, task_key: input.task_key, commit: null, branch: input.branch, base_url: input.base_url, ok, failed: stills.length - ok, stills } as any;
};

async function delivery(title: string): Promise<string> {
  const t = await writes.createTask(db, { project: "zigzag", title, scope: "s", checks: ["ok"] } as never, ctx as never);
  await setTask(t.key, { muestra: MUESTRA, branch: `jl/${t.key.toLowerCase()}`, status: "In review" });
  return t.key;
}
const taskRow = async (key: string) => (await store.get("tasks", { key }))!;
const setTask = (key: string, patch: Json) => store.fix((uow) => uow.update("tasks", { key }, patch));
const project = async () => (await store.get("projects", { slug: "zigzag" }))!;
const pass = (key: string, over: Json = {}) => {
  // Both copies answer as soon as they start.
  upPorts.add(3000);
  upPorts.add(3001);
  return probador.probar(db, "zigzag", key, { capture: fakeCapture as any, pollMs: 5, waitMs: 3000, ...over });
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

describe("antes y después", () => {
  test("photographs both sides; a path that was not there is nueva; the change is boxed; then the card may show", async () => {
    const key = await delivery("Pantalla de sucursales");
    const t0 = await taskRow(key);
    const p = await project();
    assert.equal(probador.probadorGate(p, t0, null).pending, true, "no pictures yet: not the owner's turn");
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
      const ev = (await store.find("events", { taskKey: key })).map((r) => r.type);
      assert.ok(ev.includes("probador.returned"));
      const p = await project();
      assert.equal(probador.probadorGate(p, t1, null).pending, true);
      await setTask(key, { status: "In review" });
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

  test("a delivery copy that never answers is a failure, not a blind card", async () => {
    const key = await delivery("Nunca arranca");
    upPorts = new Set();
    const s = await probador.probar(db, "zigzag", key, { capture: fakeCapture as any, pollMs: 5, waitMs: 200, returnToTaller: false });
    assert.equal(s?.state, "fallo");
    assert.match(s!.error!, /no arrancó a tiempo|no respondió/);
  });

  test("without a muestra nothing happens and nothing is held", async () => {
    const t = await writes.createTask(db, { project: "zigzag", title: "Sin muestra", scope: "s", checks: ["ok"] } as never, ctx as never);
    assert.equal(await probador.probar(db, "zigzag", t.key, { capture: fakeCapture as any }), null);
    assert.equal(probador.probadorGate(await project(), await taskRow(t.key), null).pending, false);
  });
});

// PLA-52: a pass lives in one process. What an earlier server left half-taken, what never started, what failed without
// going back, and pictures of an older commit are taken again by the sweep; nothing stays hidden for good.
describe("PLA-52: the sweep takes the pictures again", () => {
  const sweepDeps = (over: Json = {}) => ({ force: true, capture: fakeCapture as any, pollMs: 5, waitMs: 3000, ...over });
  const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString();
  const up = () => {
    upPorts.add(3000);
    upPorts.add(3001);
  };
  // Adds to the ticket's probador state (jsonb || in main).
  const mergeProbador = (key: string, extra: Json) =>
    store.fix(async (uow) => {
      const t = (await uow.get("tasks", { key }))!;
      await uow.update("tasks", { id: t.id }, { probador: { ...t.probador!, ...extra } });
    });
  beforeEach(async () => {
    // Only this test's delivery is In review on the floor.
    await store.fix((uow) => uow.update("tasks", { status: "In review" }, { status: "Done" }));
  });

  test("a delivery an earlier server left «tomando» gets its pass again; a pass that just started is left alone", async () => {
    const key = await delivery("Reinicio a media foto");
    await setTask(key, { probador: { state: "tomando", attempts: 0, error: null, commit: null, at: minutesAgo(0) } });
    up();
    assert.deepEqual(await probador.sweepProbador(db, new Date(), sweepDeps()), { restarted: 0, opened: 0 }, "a fresh «tomando» may be another server's live pass");
    await setTask(key, { probador: { state: "tomando", attempts: 0, error: null, commit: null, at: minutesAgo(10) } });
    assert.equal(probador.probadorGate(await project(), await taskRow(key), null).pending, true);
    assert.deepEqual(await probador.sweepProbador(db, new Date(), sweepDeps()), { restarted: 1, opened: 0 });
    assert.deepEqual(await probador.sweepProbador(db, new Date(), sweepDeps()), { restarted: 0, opened: 0 }, "one pass at a time per floor");
    await probador.waitForProbador();
    const t = await taskRow(key);
    assert.equal(t.probador!.state, "lista");
    assert.equal(probador.probadorGate(await project(), t, null).pending, false, "the card may show");
  });

  test("a delivery whose pass never started is photographed", async () => {
    const key = await delivery("Nunca empezó");
    await store.fix((uow) => uow.update("tasks", { key }, { statusChangedAt: new Date(uow.now.getTime() - 10 * 60_000) }));
    up();
    assert.equal((await probador.sweepProbador(db, new Date(), sweepDeps())).restarted, 1);
    await probador.waitForProbador();
    assert.equal((await taskRow(key)).probador!.state, "lista");
  });

  test("an error of Plania's own never leaves «tomando»: it is logged, tried once more, then the card shows with the reason", async () => {
    const key = await delivery("Falla por dentro");
    // A capture that hands back no summary makes the diff step throw past every handled failure. (Main used a run id
    // that is not a uuid, which Postgres refused; the store has no column types to refuse it.)
    const broken = async (_d: typeof db, _input: Json) => null as any;
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
      assert.equal((await probador.sweepProbador(db, new Date(), sweepDeps({ capture: broken, settleMs: 0 }))).restarted, 1);
      await probador.waitForProbador();
    } finally {
      console.log = log;
    }
    const t2 = await taskRow(key);
    assert.equal(t2.probador!.state, "lista");
    assert.equal(t2.probador!.attempts, 2);
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
    await store.fix((uow) => uow.insert("pullRequests", { projectId: p.id, repo: "o/r", number: 520, url: "https://github.com/o/r/pull/520", taskId: t0.id, state: "open", headSha: HEAD, ciState: "success" }));
    if (!t0.probador!.commit) await mergeProbador(key, { commit: "aaaaaaa" });
    assert.equal(probador.probadorGate(p, await taskRow(key), HEAD).pending, true, "pictures of an older commit hide the card");
    up();
    assert.deepEqual(await probador.sweepProbador(db, new Date(), sweepDeps()), { restarted: 1, opened: 0 });
    await probador.waitForProbador();
    const t1 = await taskRow(key);
    assert.equal(t1.probador!.for_head, HEAD);
    if (!t1.probador!.commit) await mergeProbador(key, { commit: "aaaaaaa" });
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
    const pr = { projectId: p.id, repo: "o/r", number: 521 };
    await store.fix(async (uow) => {
      await uow.insert("pullRequests", { ...pr, url: "https://github.com/o/r/pull/521", taskId: t.id, state: "open", headSha: "abc1234", ciState: "success" });
      const th = (await uow.get("threads", { kind: "project", projectId: p.id })) ?? (await uow.insert("threads", { kind: "project", projectId: p.id }));
      await uow.insert("threadMessages", { threadId: th.id, authorAgent: "taller-zigzag", authorRole: "taller", body: "queda En revisión", links: [{ kind: "ticket", ref: key, title: "x" }] });
    });
    const pd = await project();
    const stage = async () => (await projectEtapas(db, pd)).byTicket.get(key)!.etapa;
    const e1 = await stage();
    assert.equal(e1.etapa, "en_revision", "no pictures yet: not the owner's turn on the board either");
    assert.equal(e1.reason, "Plania toma las fotos de la entrega.");
    const limbo = async () => (await auditProject(db, pd)).filter((f) => f.code === "REVIEW_NOBODYS_TURN" && f.key === key);
    assert.equal((await limbo()).length, 0, "not in its first half hour");
    await store.fix((uow) => uow.update("tasks", { key }, { statusChangedAt: new Date(uow.now.getTime() - 45 * 60_000) }));
    const found = await limbo();
    assert.equal(found.length, 1);
    assert.match(found[0]!.detail, /fotos/);
    await store.fix((uow) => uow.update("pullRequests", pr, { ciState: "pending" }));
    assert.equal((await limbo()).length, 0, "PR checks running: someone is on it");
    await store.fix((uow) => uow.update("pullRequests", pr, { ciState: "success" }));
    // Pictures done: the board says Te toca, as the card does, and the audit is quiet.
    await setTask(key, { probador: { state: "lista", attempts: 0, error: null, commit: "abc1234", at: minutesAgo(1) } });
    assert.equal((await stage()).etapa, "te_toca");
    assert.equal((await limbo()).length, 0);
  });
});
