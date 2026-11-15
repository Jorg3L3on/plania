// PLA-I48-1: the machines of a floor. GET /api/projects/:slug/maquinas reads the test copy's server (live, off,
// failed with its reason, started outside Plania) and the local base from the machine job's footprints (on, off,
// none); a floor without capture settings says configured false with the scripts found in package.json, and
// Usar estos comandos writes them. Restart is stop then start with the same port rule; the log keeps 200 lines
// and none of Plania's own values; the base lever runs brew through a fake exec and refuses what is not a brew
// service on 127.0.0.1, and Plania's own Postgres. Fake processes, fake footprints, test DB only.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const TMP = mkdtempSync(path.join(tmpdir(), "plania-i48-maq-"));
process.env.PLANIA_CAPTURES_DIR = path.join(TMP, "captures");
const WT_ROOT = path.join(TMP, "worktrees");
const { app } = await import("../src/app.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const { makeDb } = await import("../src/db/client.js");
const prueba = await import("../src/captures/prueba.js");
const maquinas = await import("../src/maquinas/machines.js");
type Deps = import("../src/captures/prueba.js").PruebaDeps;
type Json = Record<string, any>;

const jorge = () => ({ Cookie: `${SESSION_COOKIE}=${createSession()}` });
const get = async (url: string): Promise<{ status: number; body: Json }> => {
  const r = await app.request(url, { headers: jorge() });
  return { status: r.status, body: (await r.json()) as Json };
};
const post = async (url: string): Promise<{ status: number; body: Json }> => {
  const r = await app.request(url, { method: "POST", headers: jorge() });
  return { status: r.status, body: (await r.json()) as Json };
};
const until = async (f: () => boolean | Promise<boolean>, ms = 5000) => {
  const end = Date.now() + ms;
  while (!(await f())) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
};

let raw: pg.Client;
let db: ReturnType<typeof makeDb>["db"];

const SANDBOX = "5a4db0c5a4db0c5a4db0c5a4db0c5a4db0c5a4db";
const fakeGit = async (args: string[]) => {
  if (args[0] === "worktree" && args[1] === "add") mkdirSync(args[3]!, { recursive: true });
  if (args[0] === "rev-parse" && args[1] === "--abbrev-ref") return { code: 0, stdout: "HEAD\n", stderr: "" };
  if (args[0] === "rev-parse") return { code: 0, stdout: `${SANDBOX}\n`, stderr: "" };
  return { code: 0, stdout: "", stderr: "" };
};
type FakeChild = { pid: number; command: string; print: (s: string) => void; exit: (code: number) => void };
let children: FakeChild[] = [];
let killed: [number, string][] = [];
let nextPid = 9000;
const fakeSpawn: Deps["spawn"] = (command) => {
  const listeners: Record<string, ((...a: any[]) => void)[]> = {};
  const stream = () => ({ on: (_e: string, f: (d: string) => void) => (listeners.data ??= []).push(f) });
  const c = {
    pid: nextPid++,
    command,
    stdout: stream(),
    stderr: stream(),
    once: (e: string, f: (...a: any[]) => void) => (listeners[e] ??= []).push(f),
    print: (s: string) => listeners.data?.[0]?.(s), // stdout only
    exit: (code: number) => {
      for (const f of listeners.data ?? []) f("Error: no arrancó, falta DATABASE_URL\n");
      for (const f of listeners.exit ?? []) f(code, null);
    },
  };
  children.push(c as FakeChild);
  return c as any;
};
let upPorts = new Set<number>();
let busyPorts = new Set<number>();
let execs: string[] = [];

const pruebaDeps = (): Deps => ({
  git: fakeGit,
  spawn: fakeSpawn,
  kill: (pid, sig) => void killed.push([pid, sig]),
  alive: () => false,
  exec: async () => ({ code: 0, stdout: "", stderr: "" }),
  up: async (url) => upPorts.has(Number(new URL(url).port)),
  portBusy: async (port) => busyPorts.has(port),
  capture: async (_db, input) => ({ run_id: "r", project: input.project, task_key: null, commit: null, branch: null, base_url: input.base_url!, ok: 2, failed: 0, stills: [] }),
  env: { ...process.env, PLANIA_WORKTREES_ROOT: WT_ROOT },
  pollMs: 5,
  readyMs: 2_000,
  stopGraceMs: 10,
  sweep: false,
  signals: false,
});

const SETTINGS = (port: number) => ({ start_command: "npm run dev -- --port {port}", port, pages: [{ key: "inicio", path: "/", label: "Inicio" }] });
const REPO = (slug: string) => path.join(TMP, "repos", slug);
const setSettings = (slug: string, patch: Json) => raw.query(`update projects set settings = settings || $1::jsonb where slug = $2`, [JSON.stringify(patch), slug]);
const projectId = async (slug: string) => (await raw.query(`select id from projects where slug = $1`, [slug])).rows[0].id as string;
const fp = (kind: string, locator: string, details: Json, projectSlug: string | null = null, state = "live") =>
  raw.query(
    `insert into footprints (machine, kind, locator, project_id, details, state, source, last_seen_at) values ('test-mac', $1, $2, (select id from projects where slug = $3), $4::jsonb, $5, 'observed', now())`,
    [kind, locator, projectSlug, JSON.stringify(details), state],
  );
const writeEnv = (slug: string, text: string) => writeFileSync(path.join(REPO(slug), ".env.local"), text);

before(async () => {
  raw = await resetTestDb();
  ({ db } = makeDb());
  for (const slug of ["zigzag", "workia", "filmia", "micasa"]) {
    mkdirSync(REPO(slug), { recursive: true });
    await setSettings(slug, { local: { repo_path: REPO(slug) } });
  }
  await setSettings("zigzag", { capture: SETTINGS(3000) });
  await setSettings("workia", { capture: SETTINGS(3100) });
  // Filmia has no capture settings: a Next.js app with npm.
  writeFileSync(
    path.join(REPO("filmia"), "package.json"),
    JSON.stringify({ scripts: { dev: "next dev -p 3005", build: "next build", test: "vitest run", "db:migrate": "tsx scripts/db-migrate.ts", "db:seed": "tsx scripts/db-seed.ts" } }),
  );
  writeFileSync(path.join(REPO("filmia"), "package-lock.json"), "{}");
  void db;
});

after(async () => {
  prueba.stopAll();
  await raw.end();
  rmSync(TMP, { recursive: true, force: true });
});

beforeEach(async () => {
  prueba.resetPrueba();
  prueba.setPruebaDeps(pruebaDeps());
  maquinas.setMaquinasDeps({
    env: { ...process.env, PLANIA_WORKTREES_ROOT: WT_ROOT },
    portBusy: async (port) => busyPorts.has(port),
    exec: async (command) => {
      execs.push(command);
      const m = /^brew services (start|stop) /.exec(command);
      if (m) m[1] === "start" ? busyPorts.add(5433) : busyPorts.delete(5433);
      return { code: 0, stdout: "", stderr: "" };
    },
  });
  children = [];
  killed = [];
  upPorts = new Set();
  busyPorts = new Set();
  execs = [];
  await raw.query(`delete from footprints`);
});

describe("the server of a floor", () => {
  test("an off copy: configured, phase off, the command it would run, no found scripts", async () => {
    const r = await get("/api/projects/zigzag/maquinas");
    assert.equal(r.status, 200);
    assert.equal(r.body.configured, true);
    assert.equal(r.body.server.phase, "off");
    assert.equal(r.body.server.managed, false);
    assert.equal(r.body.server.command, "npm run dev -- --port 3000");
    assert.equal(r.body.found, null);
    assert.deepEqual(r.body.pages.map((p: Json) => p.key), ["inicio"]);
    assert.equal(children.length, 0, "reading never starts anything");
  });

  test("a live copy: phase live, managed, port, url, command, branch, commit, worktree and who started it", async () => {
    await post("/api/projects/zigzag/captures/encender");
    await until(() => children.length === 1);
    upPorts.add(3000);
    await until(async () => (await get("/api/projects/zigzag/maquinas")).body.server.phase === "live");
    const s = (await get("/api/projects/zigzag/maquinas")).body.server;
    assert.equal(s.managed, true);
    assert.equal(s.port, 3000);
    assert.equal(s.url, "http://localhost:3000");
    assert.equal(s.command, "npm run dev -- --port 3000");
    assert.equal(s.branch, "sandbox");
    assert.equal(s.commit, SANDBOX);
    assert.equal(s.worktree, path.join(WT_ROOT, "zigzag", "_prueba"));
    assert.equal(s.started_by, "Plania, desde el piso");
    assert.ok(s.started_at);
  });

  test("a failed copy: phase failed with the reason", async () => {
    await post("/api/projects/zigzag/captures/encender");
    await until(() => children.length === 1);
    children[0]!.exit(1);
    await until(async () => (await get("/api/projects/zigzag/maquinas")).body.server.phase === "failed");
    const s = (await get("/api/projects/zigzag/maquinas")).body.server;
    assert.match(s.error, /se cerró al arrancar \(código 1\)/);
    assert.match(s.detail, /falta DATABASE_URL/);
  });

  test("a copy started outside Plania: running, managed false, and Plania cannot stop or restart it", async () => {
    upPorts.add(3100);
    const s = (await get("/api/projects/workia/maquinas")).body.server;
    assert.equal(s.phase, "running");
    assert.equal(s.managed, false);
    assert.equal(s.started_by, "fuera de Plania");
    const off = await post("/api/projects/workia/captures/apagar");
    assert.equal(off.status, 200);
    assert.equal(killed.length, 0, "nothing of Plania's to stop");
    assert.equal((await get("/api/projects/workia/maquinas")).body.server.phase, "running");
    const again = await post("/api/projects/workia/captures/reiniciar");
    assert.equal(again.status, 400);
    assert.equal(children.length, 0, "no second copy started beside it");
  });

  test("a floor without capture settings: configured false with the scripts found, and Usar estos comandos writes them", async () => {
    const r = (await get("/api/projects/filmia/maquinas")).body;
    assert.equal(r.configured, false);
    assert.equal(r.server.phase, "off");
    assert.equal(r.found.manager, "npm");
    assert.equal(r.found.dev, "npm run dev -- --port {port}");
    assert.equal(r.found.port, 3005);
    assert.equal(r.found.migrate, "npm run db:migrate");
    assert.equal(r.found.seed, "npm run db:seed");
    assert.equal(r.found.test, "npm run test");
    assert.deepEqual(r.found.scripts.map((s: Json) => s.name).sort(), ["build", "db:migrate", "db:seed", "dev", "test"]);
    const set = await post("/api/projects/filmia/maquinas/configurar");
    assert.equal(set.status, 200);
    assert.equal(set.body.configured, true);
    const stored = (await raw.query(`select settings->'capture' as c from projects where slug = 'filmia'`)).rows[0].c;
    assert.deepEqual(stored, { start_command: "npm run dev -- --port {port}", port: 3005, pages: [{ key: "inicio", path: "/", label: "Inicio" }] });
    // Without a dev script there is nothing to set.
    const none = await post("/api/projects/micasa/maquinas/configurar");
    assert.equal(none.status, 400);
    assert.equal(none.body.error, "NOT_CONFIGURED");
    await setSettings("filmia", { capture: null });
    await raw.query(`update projects set settings = settings - 'capture' where slug = 'filmia'`);
  });

  test("reiniciar is stop then start, with the same port rule", async () => {
    await post("/api/projects/zigzag/captures/encender");
    await until(() => children.length === 1);
    upPorts.add(3000);
    await until(async () => (await get("/api/projects/zigzag/maquinas")).body.server.phase === "live");
    const first = children[0]!;
    // Something else took 3000 meanwhile? No: the copy's own port is freed by the stop and picked again.
    const r = await post("/api/projects/zigzag/captures/reiniciar");
    assert.equal(r.status, 200);
    assert.equal(r.body.prueba.phase, "starting");
    assert.deepEqual(killed, [[first.pid, "SIGTERM"]], "the old process group stopped first");
    await until(() => children.length === 2);
    assert.equal(children[1]!.command, "npm run dev -- --port 3000", "the first free port from 3000 up again");
    // With 3000 now held by something else, the rule moves it up.
    upPorts.add(3000);
    await until(async () => (await get("/api/projects/zigzag/maquinas")).body.server.phase === "live");
    busyPorts.add(3000);
    upPorts.add(3001);
    await post("/api/projects/zigzag/captures/reiniciar");
    await until(() => children.length === 3);
    assert.equal(children[2]!.command, "npm run dev -- --port 3001");
  });

  test("the log keeps at most 200 lines and nothing of Plania's own environment", async () => {
    await post("/api/projects/zigzag/captures/encender");
    await until(() => children.length === 1);
    const c = children[0]!;
    c.print(Array.from({ length: 260 }, (_, i) => `línea ${i + 1}`).join("\n") + "\n");
    c.print(`conectando con ${process.env.DATABASE_URL} y ${process.env.SESSION_SECRET}\n`);
    const r = await get("/api/projects/zigzag/maquinas/bitacora");
    assert.equal(r.status, 200);
    assert.equal(r.body.lines.length, 200);
    assert.equal(r.body.lines[0], "línea 62");
    const text = JSON.stringify(r.body);
    assert.ok(!text.includes(process.env.SESSION_SECRET!), "Plania's session secret is scrubbed");
    assert.ok(!text.includes(process.env.DATABASE_URL!), "Plania's database address is scrubbed");
    assert.match(r.body.lines.at(-1), /\(oculto\)/);
    // The Ventana's «Ver detalle» still shows the last 12 only.
    const v = (await get("/api/projects/zigzag/captures")).body;
    assert.equal(v.prueba.detail.split("\n").length, 12);
  });

  test("session cookie only", async () => {
    const r = await app.request("/api/projects/zigzag/maquinas");
    assert.equal(r.status, 401);
    const b = await app.request("/api/projects/zigzag/maquinas/base/apagar", { method: "POST" });
    assert.equal(b.status, 401);
  });
});

describe("the base of a floor, from the machine job's footprints", () => {
  const seedBase = async () => {
    await fp("db_server", "postgres:5433", { engine: "postgres", port: 5433, data_dir: "/opt/homebrew/var/postgresql@17", version: "17.2" }, null, "system");
    await fp("service", "brew:postgresql@17", { manager: "brew", name: "postgresql@17", status: "started" }, null, "system");
    await fp("service", "brew:redis", { manager: "brew", name: "redis", status: "started" }, null, "system");
    await fp("database", "zigzag_dev@127.0.0.1:5433", { name: "zigzag_dev", port: 5433, size_bytes: 8_000_000, version: "17.2" }, "zigzag");
    await fp("database", "workia_dev@127.0.0.1:5433", { name: "workia_dev", port: 5433, size_bytes: 9_000_000, version: "17.2" }, "workia");
  };

  test("on: engine, version, port, the databases, size, the brew service, who shares it, and the lever", async () => {
    await seedBase();
    writeEnv("zigzag", "DATABASE_URL=postgres://zig:fake-pass-77@127.0.0.1:5433/zigzag_dev\n");
    busyPorts.add(5433);
    const b = (await get("/api/projects/zigzag/maquinas")).body.base;
    assert.equal(b.state, "on");
    assert.equal(b.engine, "postgres");
    assert.equal(b.version, "17.2");
    assert.equal(b.port, 5433);
    assert.equal(b.host, "127.0.0.1");
    assert.deepEqual(b.databases, [{ name: "zigzag_dev", size_bytes: 8_000_000, app: true }]);
    assert.equal(b.size_bytes, 8_000_000);
    assert.equal(b.service, "postgresql@17");
    assert.deepEqual(b.shared_with, ["workia"]);
    assert.deepEqual(b.lever, { can: true, reason: null });
    assert.equal(b.env_file, ".env.local");
    assert.ok(!JSON.stringify(b).includes("fake-pass-77"), "no password in the read");
  });

  test("off: the server's port does not answer", async () => {
    await seedBase();
    writeEnv("zigzag", "DATABASE_URL=postgres://zig@127.0.0.1:5433/zigzag_dev\n");
    const b = (await get("/api/projects/zigzag/maquinas")).body.base;
    assert.equal(b.state, "off");
    assert.equal(b.service, "postgresql@17");
  });

  test("none: no database of this floor in the footprints and none in its env", async () => {
    await seedBase();
    writeFileSync(path.join(REPO("micasa"), ".env.local"), "NEXT_PUBLIC_X=1\n");
    const b = (await get("/api/projects/micasa/maquinas")).body.base;
    assert.equal(b.state, "none");
    assert.deepEqual(b.databases, []);
    assert.equal(b.lever.can, false);
  });

  test("the lever runs brew services start|stop through exec, and the read follows", async () => {
    await seedBase();
    writeEnv("zigzag", "DATABASE_URL=postgres://zig@127.0.0.1:5433/zigzag_dev\n");
    const on = await post("/api/projects/zigzag/maquinas/base/encender");
    assert.equal(on.status, 200);
    assert.equal(on.body.base.state, "on");
    const off = await post("/api/projects/zigzag/maquinas/base/apagar");
    assert.equal(off.body.base.state, "off");
    assert.deepEqual(execs, ["brew services start postgresql@17", "brew services stop postgresql@17"]);
  });

  test("the lever refuses a server that is not a brew service, a remote base, and Plania's own Postgres", async () => {
    await seedBase();
    // Not a brew service: a Postgres run by hand from another data directory.
    await fp("db_server", "postgres:5434", { engine: "postgres", port: 5434, data_dir: "/Users/x/pgdata" }, null, "system");
    writeEnv("zigzag", "DATABASE_URL=postgres://zig@127.0.0.1:5434/zigzag_dev\n");
    const handMade = await post("/api/projects/zigzag/maquinas/base/apagar");
    assert.equal(handMade.status, 403);
    assert.equal(handMade.body.error, "BASE_LEVER_REFUSED");
    assert.match(handMade.body.hint, /servicio de brew/);
    // A hosted base.
    writeEnv("zigzag", "DATABASE_URL=postgres://zig:x@db.example.com:5433/zigzag_dev\n");
    const remote = await post("/api/projects/zigzag/maquinas/base/apagar");
    assert.equal(remote.status, 403);
    assert.match(remote.body.hint, /no está en esta Mac/);
    // Plania's own Postgres (the primary port, 5432), even as a brew service.
    await fp("db_server", "postgres:5432", { engine: "postgres", port: 5432, data_dir: "/opt/homebrew/var/postgresql@14" }, null, "system");
    await fp("service", "brew:postgresql@14", { manager: "brew", name: "postgresql@14", status: "started" }, null, "system");
    writeEnv("zigzag", "DATABASE_URL=postgres://zig@localhost:5432/zigzag_dev\n");
    const own = await post("/api/projects/zigzag/maquinas/base/apagar");
    assert.equal(own.status, 403);
    assert.match(own.body.hint, /Postgres de Plania/);
    const r = (await get("/api/projects/zigzag/maquinas")).body.base;
    assert.equal(r.lever.can, false);
    assert.deepEqual(execs, [], "brew never ran");
    await projectId("zigzag");
  });
});
