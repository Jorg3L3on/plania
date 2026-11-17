// PLA-I52-2: la copia de la entrega. (Harness copied from i46-prueba.test.ts.) Was: PLA-I46-8: Encenderla. The test copy starts only on the click, runs origin/sandbox in Plania's own worktree,
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
const TMP = mkdtempSync(path.join(tmpdir(), "plania-entrega-test-"));
process.env.PLANIA_CAPTURES_DIR = path.join(TMP, "captures");
const WT_ROOT = path.join(TMP, "worktrees");
const { app } = await import("../src/app.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const { makeDb } = await import("../src/db/client.js");
const writes = await import("../src/mcp/writes.js");
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
const liveServers = async (): Promise<any[]> =>
  (await store.find("footprints", { kind: "server", releasedAt: null }, { orderBy: [{ column: "locator" }] })).map((f) => ({ locator: f.locator, purpose: f.purpose, teardown: f.teardown, details: f.details }));

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


const ctx = { actor: { agent: "t", session_id: "s-i52-2", machine: "ci" } };
const entrega = async (slug: string): Promise<Json> => (await (await app.request(`/api/projects/${slug}/entrega`, { headers: jorge() })).json()) as Json;
const MUESTRA = { frase: "Se ve.", vistas: [{ key: "a", label: "A", path: "/a" }], pasos: ["uno", "dos", "tres"] };

describe("la copia de la entrega", () => {
  test("runs the PR branch on the next free port, next to sandbox, in its own worktree, and is live once it answers", async () => {
    await post("zigzag", "encender");
    await until(() => children.length === 1);
    upPorts.add(3000);
    await until(async () => (await read("zigzag")).prueba.phase === "live");
    const r = await prueba.encenderEntrega(db, "zigzag", { key: "ZIG-9", branch: "jl/zig-9" });
    assert.equal(r.phase, "starting");
    assert.equal(r.key, "ZIG-9");
    await until(() => children.length === 2);
    const c = children[1]!;
    const wt = path.join(WT_ROOT, "zigzag", "_entrega");
    assert.equal(c.cwd, wt);
    assert.equal(c.command, "npm run dev -- --port 3001", "3000 is the sandbox copy's");
    assert.ok(gitCalls.some((g) => g.join(" ") === `fetch origin jl/zig-9 @${REPO}`));
    assert.ok(gitCalls.some((g) => g.slice(0, 5).join(" ") === `worktree add --detach ${wt} origin/jl/zig-9`));
    upPorts.add(3001);
    await until(() => prueba.entregaRead("zigzag")?.phase === "live");
    assert.equal(captures.length, 1, "only the sandbox copy took the Ventana's stills");
    assert.equal((await read("zigzag")).prueba.port, 3000, "the Ventana still reads sandbox");
    const e = await entrega("zigzag");
    assert.deepEqual([e.entrega.port, e.entrega.branch, e.entrega.key], [3001, "jl/zig-9", "ZIG-9"]);
    const fp = await liveServers();
    assert.deepEqual(fp.map((f: Json) => f.locator), ["port:3000", "port:3001"]);
    assert.match(fp[1].purpose, /Copia de la entrega ZIG-9 de Zigzag \(jl\/zig-9\)/);
    assert.equal(fp[1].details.declared?.lane ?? fp[1].details.lane, "entrega");
  });

  test("both copies stop on idle and release their footprints", async () => {
    await post("zigzag", "encender");
    await prueba.encenderEntrega(db, "zigzag", { key: "ZIG-9", branch: "jl/zig-9" });
    await until(() => children.length === 2);
    upPorts.add(3000);
    upPorts.add(3001);
    await until(() => prueba.entregaRead("zigzag")?.phase === "live");
    await until(async () => (await read("zigzag")).prueba.phase === "live");
    clock += 21 * 60_000;
    const gone = await prueba.sweepIdle(db);
    assert.deepEqual(gone.sort(), ["zigzag", "zigzag::entrega"]);
    assert.equal((await liveServers()).length, 0);
    assert.equal(prueba.entregaRead("zigzag"), null);
  });

  test("a second delivery in the same project replaces the first; the same one is not started twice", async () => {
    await prueba.encenderEntrega(db, "workia", { key: "WRK-1", branch: "jl/wrk-1" });
    await until(() => children.length === 1);
    upPorts.add(3000);
    await until(() => prueba.entregaRead("workia")?.phase === "live");
    await prueba.encenderEntrega(db, "workia", { key: "WRK-1", branch: "jl/wrk-1" });
    assert.equal(children.length, 1, "same delivery: nothing new");
    const first = children[0]!.pid;
    await prueba.encenderEntrega(db, "workia", { key: "WRK-2", branch: "jl/wrk-2" });
    assert.deepEqual(killed, [[first, "SIGTERM"]]);
    await until(() => children.length === 2);
    assert.equal(prueba.entregaRead("workia")?.key, "WRK-2");
    await prueba.apagarEntrega(db, "workia");
    assert.equal(prueba.entregaRead("workia"), null);
    assert.equal((await liveServers()).length, 0);
  });

  test("never main or sandbox, never a flag-looking branch", async () => {
    for (const branch of ["main", "sandbox", "--upload-pack=x", "a..b"]) {
      await assert.rejects(prueba.encenderEntrega(db, "zigzag", { key: "ZIG-1", branch }), /INVALID_FILTER/);
    }
    assert.equal(children.length, 0);
  });

  test("the screen's Encender reads the delivery's muestra and branch; without a muestra it refuses", async () => {
    const t = await writes.createTask(db, { project: "zigzag", title: "Pantalla", scope: "s", checks: ["ok"] } as never, ctx as never);
    const res0 = await app.request(`/api/projects/zigzag/entrega/encender`, { method: "POST", headers: { ...jorge(), "Content-Type": "application/json" }, body: JSON.stringify({ key: t.key }) });
    assert.equal(res0.status, 400, "no muestra yet");
    await store.fix((uow) => uow.update("tasks", { key: t.key }, { muestra: MUESTRA, branch: "jl/zig-pantalla" }));
    const res = await app.request(`/api/projects/zigzag/entrega/encender`, { method: "POST", headers: { ...jorge(), "Content-Type": "application/json" }, body: JSON.stringify({ key: t.key }) });
    assert.equal(res.status, 200);
    assert.equal(((await res.json()) as Json).entrega.branch, "jl/zig-pantalla");
    await until(() => children.length === 1);
    assert.equal((await app.request(`/api/projects/zigzag/entrega/apagar`, { method: "POST", headers: jorge() })).status, 200);
    assert.equal((await entrega("zigzag")).entrega, null);
    const anon = await app.request(`/api/projects/zigzag/entrega`);
    assert.notEqual(anon.status, 200, "only the screen's session reads it");
  });
});
