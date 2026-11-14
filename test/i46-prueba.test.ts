// PLA-I46-8: Encenderla. The test copy starts only on the click, runs origin/sandbox in Plania's own worktree,
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
const TMP = mkdtempSync(path.join(tmpdir(), "plania-prueba-test-"));
process.env.PLANIA_CAPTURES_DIR = path.join(TMP, "captures");
const WT_ROOT = path.join(TMP, "worktrees");
const { app } = await import("../src/app.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const { makeDb } = await import("../src/db/client.js");
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

describe("Encenderla", () => {
  test("nothing starts without the click: reading the Ventana only looks", async () => {
    const r = await read("zigzag");
    assert.equal(r.prueba.phase, "off");
    assert.equal(children.length, 0);
    assert.equal(gitCalls.length, 0);
  });

  test("off → one click → Cargando → fresh stills → En vivo, on origin/sandbox in Plania's own worktree", async () => {
    const res = await post("zigzag", "encender");
    assert.equal(res.status, 200);
    assert.equal(((await res.json()) as Json).prueba.phase, "starting");
    await until(() => children.length === 1);
    const c = children[0]!;
    const wt = path.join(WT_ROOT, "zigzag", "_prueba");
    assert.equal(c.cwd, wt);
    assert.equal(c.command, "npm run dev -- --port 3000");
    assert.equal(c.env.PORT, "3000");
    assert.equal(c.env.DATABASE_URL, undefined, "Plania's database never reaches the app");
    assert.ok(gitCalls.some((g) => g.join(" ") === `fetch origin sandbox @${REPO}`));
    assert.ok(gitCalls.some((g) => g.slice(0, 5).join(" ") === `worktree add --detach ${wt} origin/sandbox`));
    assert.ok(!gitCalls.some((g) => g.includes("main") || g.includes("origin/main")), "never main");
    assert.equal((await read("zigzag")).prueba.phase, "starting", "still Cargando until the app answers");
    upPorts.add(3000);
    await until(async () => (await read("zigzag")).prueba.phase === "live");
    assert.equal(captures.length, 1);
    assert.equal(captures[0]!.base_url, "http://localhost:3000");
    assert.equal(captures[0]!.checkout, wt);
    assert.equal(captures[0]!.branch, "sandbox");
    const r = await read("zigzag");
    assert.deepEqual([r.prueba.managed, r.prueba.url], [true, "http://localhost:3000"]);
    // Registered with its teardown.
    const fp = await liveServers();
    assert.equal(fp.length, 1);
    assert.equal(fp[0].locator, "port:3000");
    assert.equal(fp[0].teardown, `kill -TERM -${c.pid}`);
    assert.match(fp[0].purpose, /Copia de prueba de Zigzag \(sandbox\)/);
    // A second click while it is on starts nothing new.
    await post("zigzag", "encender");
    assert.equal(children.length, 1);
    // Apagar: the group gets SIGTERM and the footprint is released.
    assert.equal((await post("zigzag", "apagar")).status, 200);
    assert.deepEqual(killed, [[c.pid, "SIGTERM"]]);
    assert.equal((await liveServers()).length, 0);
    upPorts.delete(3000);
    assert.equal((await read("zigzag")).prueba.phase, "off");
  });

  test("a failed start shows Error with what it printed, and Reintentar starts it again", async () => {
    await post("zigzag", "encender");
    await until(() => children.length === 1);
    children[0]!.exit(1);
    await until(async () => (await read("zigzag")).prueba.phase === "failed");
    const r = await read("zigzag");
    assert.match(r.prueba.error, /se cerró al arrancar \(código 1\)/);
    assert.match(r.prueba.detail, /falló el arranque/);
    assert.equal((await liveServers()).length, 0, "nothing left registered");
    // Reintentar = Encenderla again.
    await post("zigzag", "encender");
    await until(() => children.length === 2);
    upPorts.add(3000);
    await until(async () => (await read("zigzag")).prueba.phase === "live");
    await post("zigzag", "apagar");
  });

  test("an app that never answers fails after the wait, and its process is stopped", async () => {
    prueba.setPruebaDeps(fakeDeps({ readyMs: 30, now: Date.now }));
    await post("zigzag", "encender");
    await until(async () => (await read("zigzag")).prueba.phase === "failed");
    assert.match((await read("zigzag")).prueba.error, /no respondió/);
    assert.equal(killed[0]![1], "SIGTERM");
    assert.equal((await liveServers()).length, 0);
  });

  test("a test copy with unsaved changes is not touched", async () => {
    mkdirSync(path.join(WT_ROOT, "zigzag", "_prueba"), { recursive: true });
    prueba.setPruebaDeps(fakeDeps({ git: async (args, cwd) => (args[0] === "status" ? { code: 0, stdout: " M src/app.ts\n", stderr: "" } : fakeGit(args, cwd)) }));
    await post("zigzag", "encender");
    await until(async () => (await read("zigzag")).prueba.phase === "failed");
    assert.match((await read("zigzag")).prueba.error, /cambios sin guardar/);
    assert.equal(children.length, 0);
  });

  test("dependencies install once per lockfile, from the lockfile's tool", async () => {
    const wt = path.join(WT_ROOT, "zigzag", "_prueba");
    mkdirSync(wt, { recursive: true });
    writeFileSync(path.join(wt, "package-lock.json"), '{"v":1}');
    const ran: string[] = [];
    prueba.setPruebaDeps(fakeDeps({ exec: async (cmd, o) => (ran.push(`${cmd} @${o.cwd} db=${o.env?.DATABASE_URL ?? "-"}`), { code: 0, stdout: "", stderr: "" }) }));
    upPorts.add(3000);
    await post("zigzag", "encender");
    await until(async () => (await read("zigzag")).prueba.phase === "live");
    await post("zigzag", "apagar");
    await post("zigzag", "encender");
    await until(async () => (await read("zigzag")).prueba.phase === "live");
    await post("zigzag", "apagar");
    assert.deepEqual(ran, [`npm ci @${wt} db=-`]);
    writeFileSync(path.join(wt, "package-lock.json"), '{"v":2}');
    await post("zigzag", "encender");
    await until(async () => (await read("zigzag")).prueba.phase === "live");
    await post("zigzag", "apagar");
    assert.equal(ran.length, 2);
  });

  test("two floors turn on without a port clash, and a runner's dev server keeps its port", async () => {
    busyPorts.add(3000); // a runner worktree's dev server already listens on 3000
    upPorts = new Set([3001, 3002]);
    await post("zigzag", "encender");
    await post("workia", "encender");
    await until(async () => (await read("zigzag")).prueba.phase === "live" && (await read("workia")).prueba.phase === "live");
    const ports = [(await read("zigzag")).prueba.port, (await read("workia")).prueba.port].sort();
    assert.deepEqual(ports, [3001, 3002]);
    assert.deepEqual(children.map((c) => c.env.PORT).sort(), ["3001", "3002"]);
    assert.deepEqual((await liveServers()).map((r) => r.locator), ["port:3001", "port:3002"]);
    await post("zigzag", "apagar");
    await post("workia", "apagar");
  });

  test("a port another session registered is skipped too", async () => {
    await raw.query(`insert into footprints (machine, kind, locator, source, purpose, teardown, state) values ('otra', 'server', 'port:3000', 'declared', 'dev server de un ticket', 'kill 1', 'live')`);
    upPorts.add(3001);
    await post("zigzag", "encender");
    await until(async () => (await read("zigzag")).prueba.phase === "live");
    assert.equal((await read("zigzag")).prueba.port, 3001);
    await post("zigzag", "apagar");
  });

  test("it stops when nobody looks for a while; looking keeps it on", async () => {
    upPorts.add(3000);
    await post("zigzag", "encender");
    await until(async () => (await read("zigzag")).prueba.phase === "live");
    clock += prueba.IDLE_MS - 1000;
    await read("zigzag"); // the floor polls: somebody is looking
    clock += 2000;
    assert.deepEqual(await prueba.sweepIdle(db), []);
    clock += prueba.IDLE_MS;
    assert.deepEqual(await prueba.sweepIdle(db), ["zigzag"]);
    assert.equal(killed.length, 1);
    assert.equal((await liveServers()).length, 0);
  });

  test("Reintentar on a capture error takes the stills again from the running copy", async () => {
    upPorts.add(3000);
    await post("zigzag", "encender");
    await until(async () => (await read("zigzag")).prueba.phase === "live");
    await post("zigzag", "tomar");
    await until(() => captures.length === 2);
    await until(async () => (await read("zigzag")).prueba.phase === "live");
    assert.equal(captures[1]!.base_url, "http://localhost:3000");
    await post("zigzag", "apagar");
  });

  test("only the screen can click: no cookie is 401, an unknown project 404, no settings 400", async () => {
    assert.equal((await post("zigzag", "encender", {})).status, 401);
    assert.equal((await post("nadie", "encender")).status, 404);
    assert.equal((await post("micasa", "encender")).status, 400);
    assert.equal(children.length, 0);
  });

  test("a copy an earlier server left on is stopped at the next start, only when that server is gone", async () => {
    const holder = JSON.stringify({ agent: "plania", session_id: "plania-prueba", machine: "m" });
    const ins = (port: number, serverPid: number) =>
      raw.query(
        `insert into footprints (machine, kind, locator, project_id, session_id, holder, source, purpose, teardown, details, state)
         select 'm', 'server', $1, id, 'plania-prueba', $2::jsonb, 'declared', 'Copia de prueba', 'kill -TERM -4242', $3::jsonb, 'live' from projects where slug = 'zigzag'`,
        [`port:${port}`, holder, JSON.stringify({ pid: 4242, command: "npm run dev -- --port " + port, server_pid: serverPid })],
      );
    await ins(3005, 999_999); // its server is gone
    await ins(3006, 4343); // its server is alive (a dev server on the same database must not stop it)
    prueba.setPruebaDeps(fakeDeps({ alive: (pid) => pid === 4343 }));
    const n = await prueba.reapOrphans(db, async (pid) => (pid === 4242 ? "sh -c npm run dev -- --port 3005" : null));
    assert.equal(n, 1);
    assert.deepEqual(killed, [[4242, "SIGTERM"]]);
    assert.deepEqual((await liveServers()).map((r) => r.locator), ["port:3006"]);
  });
});

describe("Encenderla with a real process", () => {
  test("a real test copy starts from origin/sandbox, answers, and its process group is gone after Apagar", async (t) => {
    // A throwaway origin with a sandbox branch holding a tiny server, and a clone as the project's repo.
    const origin = path.join(TMP, "origin.git");
    const seed = path.join(TMP, "seed");
    const repo = path.join(TMP, "clone");
    const sh = (args: string[], cwd: string) => execFileSync("git", args, { cwd, stdio: "pipe" }).toString().trim();
    execFileSync("git", ["init", "--bare", "-q", origin]);
    mkdirSync(seed);
    sh(["init", "-q", "-b", "sandbox"], seed);
    writeFileSync(
      path.join(seed, "server.mjs"),
      `import http from "node:http";\nconst port = Number(process.argv[2]);\nhttp.createServer((q, r) => r.end("registro")).listen(port, "127.0.0.1");\n`,
    );
    sh(["add", "."], seed);
    sh(["-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "-m", "sandbox"], seed);
    sh(["remote", "add", "origin", origin], seed);
    sh(["push", "-q", "origin", "sandbox"], seed);
    execFileSync("git", ["clone", "-q", origin, repo]);
    const port = 47_310;
    await setCapture("filmia", SETTINGS(port, { start_command: `${process.execPath} server.mjs {port}` }), repo);
    prueba.setPruebaDeps({
      env: { ...process.env, PLANIA_WORKTREES_ROOT: WT_ROOT },
      capture: async (_db, input) => (captures.push(input as Json), { run_id: "r", project: input.project, task_key: null, commit: null, branch: null, base_url: input.base_url!, ok: 1, failed: 0, stills: [] }),
      pollMs: 50,
      readyMs: 10_000,
      stopGraceMs: 200,
      sweep: false,
      signals: false,
    });
    await post("filmia", "encender");
    await until(async () => (await read("filmia")).prueba.phase === "live", 15_000);
    const r = await read("filmia");
    assert.equal(r.prueba.port, port);
    assert.equal(await (await fetch(`http://127.0.0.1:${port}/registro/ejemplo`)).text(), "registro");
    const wt = path.join(WT_ROOT, "filmia", "_prueba");
    assert.equal(sh(["rev-parse", "HEAD"], wt), sh(["rev-parse", "origin/sandbox"], repo));
    const [fp] = (await liveServers()).filter((x) => x.locator === `port:${port}`);
    assert.ok(fp, "registered");
    const pid = Number(fp.details.declared?.pid ?? fp.details.pid);
    await post("filmia", "apagar");
    const gone = async () => {
      try {
        process.kill(-pid, 0);
        return false;
      } catch {
        return true;
      }
    };
    await until(gone, 5000);
    await until(async () => {
      try {
        await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(300) });
        return false;
      } catch {
        return true;
      }
    }, 5000);
    assert.equal((await liveServers()).filter((x) => x.locator === `port:${port}`).length, 0, "released");
    t.diagnostic(`real copy on :${port}, pid ${pid}, stopped`);
    execFileSync("git", ["worktree", "remove", "--force", wt], { cwd: repo });
  });
});
