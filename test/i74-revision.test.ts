// PLA-I74-6 / PLA-I74-7: «Revisar proyecto». The check-up runs its eight steps on a fresh copy and records a result
// and a time for each; installed packages never cross package managers; a missing or refused host token is red; it
// runs at setup and nightly; «Constrúyelo» warns when the last pass is red or old; the copies' waits come from its
// measured cold start. Every outside call is a fake (git, the shell, the process, the browser, the host, the disk,
// the plan). Test DB only.
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const TMP = mkdtempSync(path.join(tmpdir(), "plania-i74-revision-"));
process.env.PLANIA_CAPTURES_DIR = path.join(TMP, "captures");
const WT_ROOT = path.join(TMP, "worktrees");
const { app } = await import("../src/app.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const { makeDb } = await import("../src/db/client.js");
const revision = await import("../src/captures/revision.js");
const waits = await import("../src/captures/waits.js");
const prueba = await import("../src/captures/prueba.js");
const job = await import("../src/jobs/revision.js");
const ui = await import("../ui/src/lib/revision.js");
type Json = Record<string, any>;
type RevisionDeps = import("../src/captures/revision.js").RevisionDeps;

const jorge = () => ({ Cookie: `${SESSION_COOKIE}=${createSession()}` });
let raw: pg.Client;
let db: ReturnType<typeof makeDb>["db"];

const REPO = path.join(TMP, "repo");
const PKG = { scripts: { typecheck: "tsc --noEmit", lint: "eslint .", build: "next build", "db:seed": "tsx seed.ts", dev: "next dev" } };
function writeRepo(dir: string, opts: { lock?: "npm" | "pnpm"; modules?: "npm" | "pnpm" | null; vercel?: Json } = {}) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "package.json"), JSON.stringify(PKG));
  if ((opts.lock ?? "npm") === "npm") writeFileSync(path.join(dir, "package-lock.json"), '{"lockfileVersion":3}');
  else writeFileSync(path.join(dir, "pnpm-lock.yaml"), "lockfileVersion: 9\n");
  writeFileSync(path.join(dir, ".env.local"), "DATABASE_URL=postgres://localhost:5432/app_dev\n");
  if (opts.vercel) writeFileSync(path.join(dir, "vercel.json"), JSON.stringify(opts.vercel));
  if (opts.modules === "pnpm") {
    mkdirSync(path.join(dir, "node_modules", ".pnpm"), { recursive: true });
    writeFileSync(path.join(dir, "node_modules", ".modules.yaml"), "x\n");
  }
  if (opts.modules === "npm") {
    mkdirSync(path.join(dir, "node_modules"), { recursive: true });
    writeFileSync(path.join(dir, "node_modules", ".package-lock.json"), "{}");
  }
}

// git: a worktree add copies the repo's tracked files (not node_modules, not the env file).
let gitCalls: string[][] = [];
const fakeGit = async (args: string[], cwd: string) => {
  gitCalls.push(args);
  if (args[0] === "worktree" && args[1] === "add") {
    const to = args[3]!;
    mkdirSync(to, { recursive: true });
    cpSync(cwd, to, { recursive: true, filter: (src) => !src.includes("node_modules") && !src.endsWith(".env.local") });
  }
  if (args[0] === "worktree" && args[1] === "remove") rmSync(args[3]!, { recursive: true, force: true });
  if (args[0] === "rev-parse") return { code: 0, stdout: "abc1234def5678abc1234def5678abc1234def56\n", stderr: "" };
  return { code: 0, stdout: "", stderr: "" };
};

let execCalls: { command: string; env?: NodeJS.ProcessEnv }[] = [];
let failing: RegExp | null = null;
const fakeExec: RevisionDeps["exec"] = async (command, opts) => {
  execCalls.push({ command, env: opts.env });
  if (failing && failing.test(command)) return { code: 1, stdout: "", stderr: "Error: boom\n  at line 3\n" };
  return { code: 0, stdout: "", stderr: "" };
};

let clock = 10_000_000;
let coldPolls = 3; // how many polls before the copy answers; each poll is 4 s on the fake clock
let killed: number[] = [];
let spawned: { command: string; env: NodeJS.ProcessEnv }[] = [];
const fakeSpawn: RevisionDeps["spawn"] = (command, { env }) => {
  spawned.push({ command, env });
  const stream = () => ({ on: () => undefined });
  return { pid: 9100 + spawned.length, stdout: stream(), stderr: stream(), once: () => undefined } as any;
};
let polls = 0;
const fakeUp = async () => {
  polls++;
  clock += 4_000;
  return polls > coldPolls;
};
let photo: Json = { ok: true, page: "panel", url: "http://localhost:3400/panel" };
let deploy: { status: number; body: Json } = { status: 200, body: { deployments: [{ uid: "dpl_1", state: "READY", created: 10_000_000 - 3 * 3_600_000, meta: { githubCommitSha: "f00dbabe1234" } }] } };
let fetchCalls: string[] = [];
const fakeFetch = (async (url: string) => {
  fetchCalls.push(String(url));
  return new Response(JSON.stringify(deploy.body), { status: deploy.status, headers: { "content-type": "application/json" } });
}) as unknown as typeof fetch;

const deps = (over: Partial<RevisionDeps> = {}): RevisionDeps => ({
  git: fakeGit,
  exec: fakeExec,
  spawn: fakeSpawn,
  kill: (pid) => void killed.push(pid),
  up: fakeUp,
  pickPort: async () => 3400,
  photo: async () => photo as any,
  fetch: fakeFetch,
  disk: async () => 120 * 1024 ** 3,
  plan: async () => ({ state: "ok", five_hour_pct: 20 }) as any,
  env: { ...process.env, PLANIA_WORKTREES_ROOT: WT_ROOT, VERCEL_TOKEN: "tok-test" },
  now: () => clock,
  pollMs: 1,
  footprints: true,
  serverRoot: path.join(TMP, "not-plania"),
  pgPathFor: async () => "/usr/bin",
  ...over,
});

const CAPTURE = {
  start_command: "npm run dev -- --port {port}",
  port: 3400,
  ready_path: "/",
  pages: [{ key: "panel", path: "/panel", label: "Panel", session: true }],
  session: { login_path: "/entrar", user: "prueba@example.com", user_field: "email", password_field: "password", password_command: "npm run usuario -- {user}" },
  database: { env_var: "DATABASE_URL", migrate_command: "npx prisma migrate deploy" },
};
const setSettings = (slug: string, extra: Json = {}) =>
  raw.query(`update projects set settings = settings || $1::jsonb where slug = $2`, [JSON.stringify({ capture: CAPTURE, local: { repo_path: REPO }, vercel: { project_id: "prj_1" }, ...extra }), slug]);

before(async () => {
  raw = await resetTestDb();
  ({ db } = makeDb());
  await setSettings("zigzag");
});

after(async () => {
  await raw.end();
  rmSync(TMP, { recursive: true, force: true });
});

beforeEach(async () => {
  writeRepo(REPO);
  revision.resetRevision();
  revision.setRevisionDeps(deps());
  gitCalls = [];
  execCalls = [];
  failing = null;
  killed = [];
  spawned = [];
  polls = 0;
  coldPolls = 3;
  photo = { ok: true, page: "panel", url: "http://localhost:3400/panel" };
  deploy = { status: 200, body: { deployments: [{ uid: "dpl_1", state: "READY", created: clock - 3 * 3_600_000, meta: { githubCommitSha: "f00dbabe1234" } }] } };
  fetchCalls = [];
  await raw.query(`delete from events where type = 'revision.pass'`);
  await raw.query(`update footprints set released_at = now() where released_at is null`);
});

const stepOf = (p: Json, id: string) => p.steps.find((s: Json) => s.id === id);

describe("the check-up's eight steps", () => {
  test("#1 all eight run on a fresh copy, in order, each with a result and a measured time; the pass is one event", async () => {
    const p = await revision.revisar(db, "zigzag", "owner");
    assert.deepEqual(p.steps.map((s) => s.id), ["instalar", "comprobar", "build", "base", "arranque", "foto", "deploy", "maquina"]);
    for (const s of p.steps) {
      assert.equal(s.estado, "ok", `${s.id}: ${s.detalle}`);
      assert.equal(typeof s.ms, "number");
      assert.ok(s.detalle, `${s.id} says what it found`);
    }
    assert.equal(p.ok, true);
    // A fresh worktree of the start branch, away from the repo.
    const add = gitCalls.find((a) => a[0] === "worktree" && a[1] === "add")!;
    assert.equal(add[3], path.join(WT_ROOT, "zigzag", "_revision"));
    assert.equal(add[4], "origin/sandbox");
    const cmds = execCalls.map((c) => c.command);
    // 1: the lockfile's tool (the checkout has no modules to lend).
    assert.ok(cmds.includes("npm ci"), cmds.join("\n"));
    // 2: typecheck and lint from package.json.
    assert.ok(cmds.includes("npm run typecheck") && cmds.includes("npm run lint"));
    // 3: the production build.
    assert.ok(cmds.includes("npm run build"));
    // 4: an empty throwaway base, migrated twice, then seeded, never the app's own.
    assert.ok(cmds.some((c) => c.includes("create database app_dev_revision")));
    const migrations = execCalls.filter((c) => c.command === "npx prisma migrate deploy");
    assert.equal(migrations.length, 2);
    for (const m of migrations) assert.equal(m.env!.DATABASE_URL, "postgres://localhost:5432/app_dev_revision");
    assert.ok(cmds.includes("npm run db:seed"));
    // 5: the copy on the throwaway base; its cold start is the fake clock's 4 polls of 4 s.
    assert.equal(spawned[0]!.command, "npm run dev -- --port 3400");
    assert.equal(spawned[0]!.env.DATABASE_URL, "postgres://localhost:5432/app_dev_revision");
    assert.equal(p.cold_start_ms, 16_000);
    assert.equal(stepOf(p, "arranque").ms, 16_000);
    // 6: the photo's URL is reported.
    assert.match(stepOf(p, "foto").detalle, /\/panel/);
    // 7: the host's newest production deploy, with the token.
    assert.match(fetchCalls[0]!, /target=production/);
    assert.match(stepOf(p, "deploy").detalle, /f00dbab/);
    // 8: gh, disk and plan.
    assert.ok(cmds.includes("gh auth status"));
    assert.match(stepOf(p, "maquina").detalle, /120 GB/);
    // Nothing outlives it: the server is stopped, the base dropped, the worktree gone, the footprints released.
    assert.deepEqual(killed, [9101]);
    assert.ok(cmds.some((c) => c.includes("drop database if exists app_dev_revision") && !c.includes("create")));
    assert.equal(existsSync(path.join(WT_ROOT, "zigzag", "_revision")), false);
    const live = (await raw.query(`select kind from footprints where released_at is null`)).rows;
    assert.deepEqual(live, []);
    const ev = (await raw.query(`select payload from events where type = 'revision.pass'`)).rows;
    assert.equal(ev.length, 1);
    assert.equal(ev[0].payload.steps.length, 8);
    assert.equal(ev[0].payload.cold_start_ms, 16_000);
  });

  test("#1 a failing step is red with its last lines; the steps after it that need it are not done, the rest still run", async () => {
    failing = /^npm ci$/;
    const p = await revision.revisar(db, "zigzag");
    assert.equal(p.ok, false);
    assert.equal(stepOf(p, "instalar").estado, "fallo");
    assert.match(stepOf(p, "instalar").tail, /boom/);
    for (const id of ["comprobar", "build", "base", "arranque", "foto"]) assert.equal(stepOf(p, id).estado, "omitido", id);
    assert.equal(stepOf(p, "deploy").estado, "ok");
    assert.equal(stepOf(p, "maquina").estado, "ok");
    assert.equal(p.cold_start_ms, null);
  });

  test("#1 migrations that fail on their second run are red", async () => {
    let n = 0;
    revision.setRevisionDeps(deps({ exec: async (c, o) => (c === "npx prisma migrate deploy" && ++n === 2 ? { code: 1, stdout: "", stderr: "relation already exists" } : fakeExec!(c, o)) }));
    const p = await revision.revisar(db, "zigzag");
    assert.equal(stepOf(p, "base").estado, "fallo");
    assert.match(stepOf(p, "base").detalle, /dos veces/);
  });

  test("#1 the build is the host's: vercel.json's buildCommand wins over the build script", async () => {
    writeRepo(REPO, { vercel: { buildCommand: "npm run build:prod" } });
    const p = await revision.revisar(db, "zigzag");
    assert.ok(execCalls.some((c) => c.command === "npm run build:prod"));
    assert.match(stepOf(p, "build").detalle, /build:prod/);
  });

  test("#1 a cold start that never answers is red, and the photo is not taken", async () => {
    coldPolls = 1_000;
    revision.setRevisionDeps(deps({ startMs: 20_000 }));
    const p = await revision.revisar(db, "zigzag");
    assert.equal(stepOf(p, "arranque").estado, "fallo");
    assert.match(stepOf(p, "arranque").detalle, /no respondió en 20 s/);
    assert.equal(stepOf(p, "foto").estado, "omitido");
  });

  test("#1 a photo on the wrong page is red", async () => {
    photo = { ok: false, page: "panel", error: "Foto equivocada: «Panel» salió en /entrar y debía salir en /panel" };
    const p = await revision.revisar(db, "zigzag");
    assert.equal(stepOf(p, "foto").estado, "fallo");
    assert.match(stepOf(p, "foto").detalle, /equivocada/);
  });

  test("#1 machine: gh signed out or a full disk is red, the plan brake on is red, near it is a warning", async () => {
    failing = /^gh auth status$/;
    revision.setRevisionDeps(deps({ disk: async () => 3 * 1024 ** 3, plan: async () => ({ state: "stopped", five_hour_pct: 95 }) as any }));
    let p = await revision.revisar(db, "zigzag");
    const m = stepOf(p, "maquina");
    assert.equal(m.estado, "fallo");
    assert.match(m.detalle, /gh/);
    assert.match(m.detalle, /3 GB/);
    assert.match(m.detalle, /freno/);
    failing = null;
    revision.setRevisionDeps(deps({ plan: async () => ({ state: "warn", five_hour_pct: 65 }) as any }));
    p = await revision.revisar(db, "zigzag");
    assert.equal(stepOf(p, "maquina").estado, "aviso");
  });
});

describe("#2 installed packages never cross package managers", () => {
  test("an npm-locked checkout pnpm installed is never lent: the copy installs with npm ci", async () => {
    writeRepo(REPO, { lock: "npm", modules: "pnpm" });
    const p = await revision.revisar(db, "zigzag");
    const cmds = execCalls.map((c) => c.command);
    assert.ok(cmds.includes("npm ci"));
    assert.ok(!cmds.some((c) => c.startsWith("cp -c")), "nothing cloned");
    assert.match(stepOf(p, "instalar").detalle, /pnpm.*npm/);
  });

  test("a pnpm-locked checkout pnpm installed lends its packages (on macOS)", async () => {
    writeRepo(REPO, { lock: "pnpm", modules: "pnpm" });
    const p = await revision.revisar(db, "zigzag");
    const cmds = execCalls.map((c) => c.command);
    if (process.platform === "darwin") {
      assert.ok(cmds.some((c) => c.startsWith("cp -c")));
      assert.ok(!cmds.includes("pnpm install --frozen-lockfile"));
      assert.match(stepOf(p, "instalar").detalle, /copiados/);
      assert.ok(cmds.includes("pnpm run typecheck"), "the lockfile's tool runs the scripts");
    } else assert.ok(cmds.includes("pnpm install --frozen-lockfile"));
  });
});

describe("#3 the host token", () => {
  test("a missing token is a red step", async () => {
    const env: NodeJS.ProcessEnv = { ...process.env, PLANIA_WORKTREES_ROOT: WT_ROOT };
    delete env.VERCEL_TOKEN;
    revision.setRevisionDeps(deps({ env }));
    const p = await revision.revisar(db, "zigzag");
    assert.equal(stepOf(p, "deploy").estado, "fallo");
    assert.match(stepOf(p, "deploy").detalle, /Falta la llave del host \(VERCEL_TOKEN\)/);
    assert.equal(fetchCalls.length, 0);
    assert.equal(p.ok, false);
  });

  test("an expired token (the host answers 403) is a red step", async () => {
    deploy = { status: 403, body: { error: { code: "forbidden" } } };
    const p = await revision.revisar(db, "zigzag");
    assert.equal(stepOf(p, "deploy").estado, "fallo");
    assert.match(stepOf(p, "deploy").detalle, /venció/);
  });

  test("a failed last production deploy is red; a project with no host is only a warning", async () => {
    deploy = { status: 200, body: { deployments: [{ uid: "dpl_2", state: "ERROR", created: clock, meta: { githubCommitSha: "bad0000" } }] } };
    let p = await revision.revisar(db, "zigzag");
    assert.equal(stepOf(p, "deploy").estado, "fallo");
    await raw.query(`update projects set settings = settings - 'vercel' where slug = 'zigzag'`);
    p = await revision.revisar(db, "zigzag");
    assert.equal(stepOf(p, "deploy").estado, "aviso");
    await setSettings("zigzag");
  });
});

describe("#4 at setup and nightly", () => {
  test("no pass yet is due at once (setup); then only in the night window and once a day", () => {
    const day = new Date(2026, 10, 22, 14, 0);
    const night = new Date(2026, 10, 23, 3, 0);
    assert.equal(job.dueFor(null, day), "setup");
    assert.equal(job.dueFor({ finished_at: new Date(2026, 10, 22, 13, 0).toISOString() }, day), null, "daytime");
    assert.equal(job.dueFor({ finished_at: new Date(2026, 10, 22, 3, 0).toISOString() }, night), "nightly");
    assert.equal(job.dueFor({ finished_at: new Date(2026, 10, 23, 2, 10).toISOString() }, night), null, "already ran tonight");
  });

  test("the job runs one due project per tick and skips projects without capture settings or a repo here", async () => {
    const ran: [string, string][] = [];
    const fake = (async (_d: unknown, slug: string, why: string) => {
      ran.push([slug, why]);
      return { ok: true } as any;
    }) as any;
    const out = await job.runRevisionJob(db, new Date(2026, 10, 22, 14, 0), { revisar: fake, exists: (p) => p === REPO, serverRoot: path.join(TMP, "x") });
    assert.deepEqual(ran, [["zigzag", "setup"]]);
    assert.deepEqual(out, { setup: 1 });
    const { JOBS } = await import("../src/jobs/index.js");
    assert.ok(JOBS.some((j) => j.name === "revision"), "the job is in the server's list");
  });
});

describe("the screen: the card and «Constrúyelo»", () => {
  test("GET reads the last pass and the measured waits; POST starts one", async () => {
    const before = (await (await app.request("/api/projects/zigzag/revision", { headers: jorge() })).json()) as Json;
    assert.equal(before.revision.last, null);
    assert.equal(before.revision.waits.ready_ms, waits.DEFAULT_WAITS.ready_ms);
    const res = await app.request("/api/projects/zigzag/revision", { method: "POST", headers: jorge() });
    assert.equal(res.status, 202);
    for (let i = 0; i < 200 && revision.revisando("zigzag"); i++) await new Promise((r) => setTimeout(r, 10));
    const read = (await (await app.request("/api/projects/zigzag/revision", { headers: jorge() })).json()) as Json;
    assert.equal(read.revision.last.steps.length, 8);
    assert.equal(read.revision.last.trigger, "owner");
    assert.equal(read.revision.waits.cold_start_ms, 16_000);
    const anon = await app.request("/api/projects/zigzag/revision");
    assert.equal(anon.status, 401);
  });

  const pass = (over: Json = {}): Json => ({ trigger: "owner", started_at: "2026-11-22T10:00:00.000Z", finished_at: "2026-11-22T10:05:00.000Z", ok: true, branch: "sandbox", commit: null, cold_start_ms: 8000, steps: ui.ORDER.map((id) => ({ id, estado: "ok", ms: 1000, detalle: "x", tail: null })), ...over });
  const read = (last: Json | null, over: Json = {}): Json => ({ last, running: null, waits: {}, available: true, ...over });
  const at = Date.parse("2026-11-22T12:00:00.000Z");

  test("#5 «Constrúyelo» warns when the last pass is red, older than a day, or missing; never when green and fresh", () => {
    assert.equal(ui.buildWarning(read(pass()) as never, at, "es"), null);
    const red = pass({ ok: false, steps: pass().steps.map((s: Json) => (s.id === "build" ? { ...s, estado: "fallo" } : s)) });
    assert.match(ui.buildWarning(read(red) as never, at, "es")!, /falló en «Build»/);
    assert.match(ui.buildWarning(read(pass()) as never, at + 25 * 3_600_000, "es")!, /hace un día|hace \d+ h/);
    assert.match(ui.buildWarning(read(null) as never, at, "es")!, /nunca se ha revisado/);
    assert.equal(ui.buildWarning(read(null, { available: false }) as never, at, "es"), null, "nothing to do about a system that cannot run it");
    assert.match(ui.buildWarning(read(red) as never, at, "en")!, /failed at «Build»/);
  });

  test("the card's line and times are plain Spanish, with no step ids or branch names", () => {
    assert.match(ui.summaryOf(read(pass()) as never, at, "es").text, /^Todo bien hace 1 h$/);
    assert.equal(ui.summaryOf(read(pass(), { running: { step: "build", trigger: "owner", started_at: "" } }) as never, at, "es").text, "Revisando: Build…");
    assert.equal(ui.timeText(400), "0,4 s");
    assert.equal(ui.timeText(16_000), "16 s");
    assert.equal(ui.timeText(185_000), "3 min 5 s");
    assert.equal(ui.stepName("foto", "es"), "Entrar y foto");
    const red = pass({ steps: pass().steps.map((s: Json) => (s.id === "deploy" ? { ...s, estado: "fallo" } : s.id === "base" ? { ...s, estado: "aviso" } : s)) });
    assert.equal(ui.firstOpen(red as never), "deploy");
  });
});

describe("PLA-I74-7: waits from the measured cold start", () => {
  test("twice the cold start, with a floor and a ceiling; no check-up keeps today's constants", () => {
    assert.deepEqual(waits.waitsFrom(null), { cold_start_ms: null, ...waits.DEFAULT_WAITS });
    const slow = waits.waitsFrom(90_000);
    assert.equal(slow.ready_ms, 180_000);
    assert.equal(slow.login_ms, 180_000);
    assert.equal(slow.form_ms, 60_000);
    assert.equal(slow.qa_start_ms, 180_000);
    const fast = waits.waitsFrom(2_000);
    assert.equal(fast.ready_ms, 60_000, "floor");
    assert.equal(fast.login_ms, 15_000, "floor");
    assert.equal(fast.form_ms, 5_000, "floor");
    assert.equal(waits.waitsFrom(30 * 60_000).ready_ms, 900_000, "ceiling");
  });

  test("#1 the copies read the last check-up's measurement; a failed later pass with no start keeps the last one", async () => {
    assert.equal((await waits.measuredWaits(db, "workia")).cold_start_ms, null, "#2 no check-up: today's constants");
    coldPolls = 30; // 31 polls of 4 s = 124 s
    await revision.revisar(db, "zigzag");
    let w = await waits.measuredWaits(db, "zigzag");
    assert.equal(w.cold_start_ms, 124_000);
    assert.equal(w.ready_ms, 248_000);
    assert.equal(w.login_ms, 180_000);
    failing = /^npm ci$/;
    await revision.revisar(db, "zigzag");
    w = await waits.measuredWaits(db, "zigzag");
    assert.equal(w.cold_start_ms, 124_000, "a pass that never started measures nothing");
  });

  test("#1 a copy's start gives up after twice the measured cold start, not after the constant", async () => {
    coldPolls = 4; // 20 s
    await revision.revisar(db, "zigzag");
    await raw.query(`update projects set settings = settings || '{"start_branch":"sandbox"}'::jsonb where slug = 'zigzag'`);
    let t = 5_000_000;
    prueba.resetPrueba();
    prueba.setPruebaDeps({
      git: async (args: string[]) => {
        if (args[0] === "worktree" && args[1] === "add") mkdirSync(args[3]!, { recursive: true });
        if (args[0] === "rev-parse" && args[1] === "--abbrev-ref") return { code: 0, stdout: "HEAD\n", stderr: "" };
        if (args[0] === "rev-parse") return { code: 0, stdout: "5a4db0c\n", stderr: "" };
        return { code: 0, stdout: "", stderr: "" };
      },
      spawn: fakeSpawn as any,
      kill: () => undefined,
      alive: () => false,
      exec: async () => ({ code: 0, stdout: "", stderr: "" }),
      up: async () => {
        t += 5_000;
        return false;
      },
      portBusy: async () => false,
      footprints: false,
      env: { ...process.env, PLANIA_WORKTREES_ROOT: WT_ROOT },
      pollMs: 1,
      stopGraceMs: 1,
      sweep: false,
      signals: false,
      now: () => t,
      serverRoot: path.join(TMP, "not-plania"),
    });
    await raw.query(`update projects set settings = settings - 'capture' || jsonb_build_object('capture', $1::jsonb) where slug = 'zigzag'`, [JSON.stringify({ ...CAPTURE, database: undefined })]);
    await prueba.encender(db, "zigzag", { stills: false });
    for (let i = 0; i < 500 && prueba.pruebaOf("zigzag")?.phase !== "failed"; i++) await new Promise((r) => setTimeout(r, 5));
    const r = prueba.pruebaOf("zigzag")!;
    assert.equal(r.phase, "failed");
    assert.match(r.error!, /no respondió en 60 s/, "2 × 20 s is under the 60 s floor");
    prueba.stopAll();
    await setSettings("zigzag");
  });
});
