// PLA-I2-4: Plania off a Mac (macOS and Linux; Windows through WSL). Claude found on PATH, run logs in the system's
// own places, the owner's code in a store per system, pg_dump and psql beyond Homebrew, PATH joined with the
// system's separator, and «No disponible en este sistema» where a machine-bound part cannot work. Tests that need a
// POSIX system skip with their reason (test/platform.ts). Throwaway database, fake programs only.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { after, before, describe, test } from "node:test";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";
import { needs } from "./platform.js";

useTestEnv();
process.env.PLANIA_PROMPTS_PROJECT = "micasa";
const { makeDb, resetPool } = await import("../src/db/client.js");
const { app } = await import("../src/app.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const { hashPassword } = await import("../src/auth/password.js");
const { base32Decode, totp } = await import("../src/auth/owner-totp.js");
const store = await import("../src/auth/owner-store.js");
const { seedOrg } = await import("../scripts/seed-org.js");
const runner = await import("../src/runner/runner.js");
const writes = await import("../src/mcp/writes.js");
const { projectReadiness, claudeFound } = await import("../src/runner/readiness.js");
const { deleteProjectDeps } = await import("../src/runner/delete-project.js");
const { resolveClaudeBin, findOnPath } = await import("../src/lib/claude-bin.js");
const { commandOf } = await import("../src/brief/claude.js");
const { defaultRunLogDir, defaultRunTmpDir, defaultBriefTmpDir } = await import("../src/lib/run-dirs.js");
const { pgToolFor, pgSearchPath } = await import("../src/lib/pg-bin.js");
const { pgDumpFor } = await import("../src/jobs/backup.js");
const { commandPath } = await import("../src/jobs/machine/run.js");
const { toolPath } = await import("../src/captures/run.js");
const support = await import("../src/lib/system-support.js");
const { probadorGate } = await import("../src/captures/probador.js");
const { resetPrueba } = await import("../src/captures/prueba.js");
// The screen's pure logic, imported the way other tests do (the server's type-check does not cover ui/).
type View = { state: string; title?: string | null; button?: unknown; caption?: string; word?: string; server: { lever: unknown } };
const { ventanaView } = (await import(new URL("../ui/src/lib/ventana.ts", import.meta.url).href)) as { ventanaView: (r: unknown) => View };
const { maqView } = (await import(new URL("../ui/src/lib/maquinas.ts", import.meta.url).href)) as { maqView: (r: unknown) => View };
const { NO_DISPONIBLE, NO_DISPONIBLE_POR } = support;

const FAKE_CLAUDE = path.join(import.meta.dirname, "fixtures/fake-claude.mjs");
const scratch = mkdtempSync(path.join(tmpdir(), "plania-i2-4-"));
const ACTOR = JSON.stringify({ agent: "test", session_id: "s" });
let raw: pg.Client;
let db: ReturnType<typeof makeDb>["db"];
const screen = () => ({ Cookie: `${SESSION_COOKIE}=${createSession()}`, "Content-Type": "application/json" });
const idOf = async (table: string, slug: string) => (await raw.query(`select id from ${table} where slug = $1`, [slug])).rows[0].id as string;
const only = (files: string[]) => (p: string) => files.includes(p);
async function queueRun(workKey: string): Promise<string> {
  const key = ((await writes.createTask(db, { project: "micasa", title: `Corrida ${workKey}`, scope: "s", checks: ["c"], status: "Ready" } as never, { actor: { agent: "test", session_id: "s" } } as never)) as { key: string }).key;
  return (
    await raw.query(
      `insert into agent_runs (agent_id, project_id, role, status, summary, task_key, work_key, trigger, lane) values ($1, $2, 'taller', 'queued', 'queued: event x', $3, 'task:' || $3, 'event', 'work') returning id`,
      [await idOf("agents", "taller-micasa"), await idOf("projects", "micasa"), key],
    )
  ).rows[0].id as string;
}

before(async () => {
  raw = await resetTestDb();
  ({ db } = makeDb());
  await seedOrg(db);
  await raw.query(`update runner_settings set max_concurrent = 10, cooldown_minutes = 0, max_starts_per_minute = 100, company_paused = false`);
  await raw.query(`insert into plan_readings (at, source, status, five_hour_pct, five_hour_resets_at) values (now(), 'stream', 'allowed', 10, now() + interval '3 hours')`);
  const repo = path.join(scratch, "repo-micasa");
  mkdirSync(repo, { recursive: true });
  await raw.query(`update projects set runs_paused = false, settings = coalesce(settings, '{}'::jsonb) || $2::jsonb where slug = $1`, ["micasa", JSON.stringify({ local: { repo_path: repo } })]);
  const micasa = await idOf("projects", "micasa");
  for (const title of ["Prompt: Product owner", "Prompt: Taller", "Prompt: Research", "Prompt: Artist", "Prompt: Asistente"]) {
    await raw.query(`insert into docs (project_id, title, markdown, actor) values ($1, $2, $3, $4)`, [micasa, title, `# ${title}`, ACTOR]);
  }
});

after(async () => {
  support.useSystemSupport(null);
  await runner.waitForAllRuns();
  await raw?.end();
  await resetPool().catch(() => undefined);
  rmSync(scratch, { recursive: true, force: true });
});

// ---- Check 6: Claude's command

describe("Claude found on PATH (check 6)", () => {
  const bin = path.join(scratch, "pathbin");
  const claude = path.join(bin, "claude");
  const home = path.join(scratch, "home-empty");

  test("with only PATH, the runner, the brief and the machine check resolve the same file", () => {
    const env = { HOME: home, PATH: [path.join(scratch, "nothing"), bin].join(path.delimiter) };
    const exists = only([claude]);
    assert.equal(resolveClaudeBin(env, { exists }), claude);
    assert.equal(findOnPath("claude", env, exists), claude);
  });

  test("the order: the adapter's variable, CLAUDE_CODE_BIN, ~/.local/bin/claude, then PATH; else the bare name", () => {
    const local = path.join(home, ".local", "bin", "claude");
    const env = { HOME: home, PATH: bin, MY_CLAUDE: "/x/mine", CLAUDE_CODE_BIN: "/x/set" };
    assert.equal(resolveClaudeBin(env, { commandEnv: "MY_CLAUDE", exists: only([claude, local]) }), "/x/mine");
    assert.equal(resolveClaudeBin(env, { exists: only([claude, local]) }), "/x/set");
    assert.equal(resolveClaudeBin({ HOME: home, PATH: bin }, { exists: only([claude, local]) }), local);
    assert.equal(resolveClaudeBin({ HOME: home, PATH: bin }, { exists: only([]) }), "claude");
    // An adapter variable that is not a plain name is ignored.
    assert.equal(resolveClaudeBin({ ...env, "bad name": "/x" }, { commandEnv: "bad name", exists: only([]) }), "/x/set");
  });

  test("the readiness item is ready with Claude only on PATH, and missing with it nowhere", async () => {
    const env = { HOME: home, PATH: bin, PLANIA_RUNNER_TOKEN: "t" };
    assert.equal(claudeFound(env, only([claude])), true);
    assert.equal(claudeFound(env, only([])), false);
    const r = await projectReadiness(db, "micasa", { env, exists: only([claude]) });
    assert.equal(r.items.find((i) => i.id === "claude_bin")?.state, "ready");
    const r2 = await projectReadiness(db, "micasa", { env, exists: only([]) });
    assert.equal(r2.items.find((i) => i.id === "claude_bin")?.state, "missing");
  });

  test("a run starts with Claude only on PATH: the runner spawns the file it found", async () => {
    mkdirSync(bin, { recursive: true });
    writeFileSync(claude, "#!/bin/sh\n");
    mkdirSync(home, { recursive: true });
    const env = { HOME: home, PATH: bin, PLANIA_RUNNER_TOKEN: "runner-token", PLANIA_PROMPTS_PROJECT: "micasa", PLANIA_WORKER_ID: "test:main" } as NodeJS.ProcessEnv;
    assert.equal(commandOf(env), claude, "the brief resolves the same file");
    const runId = await queueRun("path");
    const spawned: { command: string; child: FakeChild }[] = [];
    const deps = {
      env,
      logDir: path.join(scratch, "logs"),
      tmpDir: path.join(scratch, "tmp"),
      worktreeRoot: path.join(scratch, "worktrees"),
      graceMs: 10,
      liveFlushMs: 0,
      footprints: false,
      git: async () => ({ code: 0, stdout: "", stderr: "" }),
      spawn: (command: string) => {
        const child = new FakeChild(71_000 + spawned.length);
        spawned.push({ command, child });
        return child;
      },
      kill: () => undefined,
      reportTokens: async () => undefined,
      probeUsage: async () => null,
      machine: () => ({ freeMb: 99_999, freeDiskGb: 999 }),
    };
    await runner.drainQueue(db, new Date(), deps as never);
    assert.equal(spawned.length, 1, `the run started: ${JSON.stringify((await raw.query(`select status, summary from agent_runs where id = $1`, [runId])).rows[0])}`);
    assert.equal(spawned[0]!.command, claude);
    spawned[0]!.child.end();
    await runner.waitForAllRuns();
    assert.ok((await raw.query(`select status from agent_runs where id = $1`, [runId])).rows[0].status !== "queued");
  });
});

class FakeChild extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  constructor(readonly pid: number) {
    super();
  }
  end(): void {
    this.stdout.end();
    this.stderr.end();
    setImmediate(() => this.emit("exit", 0, null));
  }
}

// ---- Run logs and temp files

test("run logs and temp files go to the system's own places", () => {
  const env = { HOME: "/home/ana" };
  assert.equal(defaultRunLogDir(env, "darwin"), path.join("/home/ana", "Library", "Logs", "plania-runs"), "macOS as before");
  assert.equal(defaultRunLogDir(env, "linux"), path.join("/home/ana", ".local", "state", "plania", "runs"));
  assert.equal(defaultRunTmpDir(env, "linux"), path.join("/home/ana", ".cache", "plania", "runs"));
  assert.equal(defaultBriefTmpDir(env, "linux"), path.join("/home/ana", ".cache", "plania", "brief"));
  const xdg = { HOME: "/home/ana", XDG_STATE_HOME: "/var/st", XDG_CACHE_HOME: "/var/ca" };
  assert.equal(defaultRunLogDir(xdg, "linux"), path.join("/var/st", "plania", "runs"));
  assert.equal(defaultRunTmpDir(xdg, "linux"), path.join("/var/ca", "plania", "runs"));
  // A relative XDG value is ignored, as the spec says.
  assert.equal(defaultRunLogDir({ HOME: "/home/ana", XDG_STATE_HOME: "rel" }, "linux"), path.join("/home/ana", ".local", "state", "plania", "runs"));
  assert.equal(path.basename(defaultRunTmpDir(env, "darwin")), "plania-runs");
});

// ---- Check 2: the owner's code, a store per system

describe("the owner's code store per system (check 2)", () => {
  const secret = Buffer.alloc(20, 9);

  test("the file store keeps the secret, replaces it, and reads a missing or broken file as not enrolled", async () => {
    const file = path.join(scratch, "cfg", "plania", "owner-secret");
    const s = new store.FileOwnerSecretStore(file);
    assert.equal(await s.get(), null);
    await s.set(secret);
    assert.deepEqual(await s.get(), secret);
    const other = Buffer.alloc(20, 3);
    await s.set(other);
    assert.deepEqual(await s.get(), other, "enrolling again replaces it");
    assert.deepEqual(readFileSync(file, "utf8").trim().length > 0, true);
    writeFileSync(file, "not base32!\n");
    if (process.platform !== "win32") chmodSync(file, 0o600);
    assert.equal(await s.get(), null);
    assert.equal(existsSync(`${file}.${process.pid}.tmp`), false, "no temporary file is left");
  });

  test("the file and its folder are readable only by the user (0600, 0700)", { skip: needs({ posix: true }) }, async () => {
    const file = path.join(scratch, "cfg-mode", "plania", "owner-secret");
    await new store.FileOwnerSecretStore(file).set(secret);
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.equal(statSync(path.dirname(file)).mode & 0o777, 0o700);
  });

  test("a file the group or others can read is not trusted", { skip: needs({ posix: true }) }, async () => {
    const file = path.join(scratch, "cfg-open", "plania", "owner-secret");
    const s = new store.FileOwnerSecretStore(file);
    await s.set(secret);
    chmodSync(file, 0o644);
    assert.equal(await s.get(), null);
    await s.set(secret);
    assert.deepEqual(await s.get(), secret, "enrolling again writes it at 0600");
  });

  test("the path: PLANIA_OWNER_SECRET_FILE, else $XDG_CONFIG_HOME/plania, else ~/.config/plania", () => {
    assert.equal(store.ownerSecretFilePath({ PLANIA_OWNER_SECRET_FILE: "/s/f", HOME: "/h" }), "/s/f");
    assert.equal(store.ownerSecretFilePath({ XDG_CONFIG_HOME: "/xc", HOME: "/h" }), path.join("/xc", "plania", "owner-secret"));
    assert.equal(store.ownerSecretFilePath({ HOME: "/h" }), path.join("/h", ".config", "plania", "owner-secret"));
  });

  test("the keychain store (macOS) writes through `security` on stdin and reads it back", async () => {
    let item: string | null = null;
    const calls: string[][] = [];
    store.useSecurityRunner(async (args, stdin) => {
      calls.push(args);
      if (args[0] === "-i" && stdin.startsWith("delete-generic-password")) {
        if (!item) throw Object.assign(new Error("fail"), { stderr: "The specified item could not be found in the keychain." });
        item = null;
        return "";
      }
      if (args[0] === "-i" && stdin.startsWith("add-generic-password")) {
        item = stdin.trim().split(" ").pop()!;
        return "";
      }
      if (args[0] === "find-generic-password") {
        if (!item) throw new Error("not found");
        return `${item}\n`;
      }
      throw new Error(`unexpected ${args.join(" ")}`);
    });
    try {
      const k = new store.KeychainOwnerSecretStore();
      assert.equal(await k.get(), null);
      await k.set(secret);
      assert.deepEqual(await k.get(), secret);
      assert.ok(calls.every((a) => !a.some((x) => /^[A-Z2-7]{16,}$/.test(x))), "the secret is never in argv");
    } finally {
      store.useSecurityRunner(null);
    }
  });

  test("the store is picked by system: the keychain on a Mac with `security`, the file elsewhere", () => {
    const env = { HOME: "/h" };
    assert.ok(store.systemOwnerStore({ platform: "darwin", env, exists: () => true }) instanceof store.KeychainOwnerSecretStore);
    assert.ok(store.systemOwnerStore({ platform: "darwin", env, exists: () => false }) instanceof store.FileOwnerSecretStore, "fallback");
    const linux = store.systemOwnerStore({ platform: "linux", env, exists: () => true });
    assert.ok(linux instanceof store.FileOwnerSecretStore);
    assert.equal((linux as InstanceType<typeof store.FileOwnerSecretStore>).file, path.join("/h", ".config", "plania", "owner-secret"));
  });

  test("with the file store, the code is enrolled and checked, and a project is deleted", async () => {
    const file = path.join(scratch, "cfg-delete", "plania", "owner-secret");
    store.useOwnerStore(new store.FileOwnerSecretStore(file));
    store.invalidateOwnerEnrolledCache();
    process.env.PLANIA_PASSWORD_HASH = await hashPassword("una-clave-de-prueba");
    Object.assign(deleteProjectDeps, { worktreeRoot: path.join(scratch, "wt-delete"), git: async () => ({ code: 0, stdout: "", stderr: "" }) });
    try {
      assert.equal(((await (await app.request("/api/company/owner-code", { headers: screen() })).json()) as { enrolled: boolean }).enrolled, false);
      const enrol = await app.request("/api/company/owner-code/enroll", { method: "POST", headers: screen(), body: JSON.stringify({ password: "una-clave-de-prueba" }) });
      assert.equal(enrol.status, 200, await enrol.clone().text());
      const { secret_base32 } = (await enrol.json()) as { secret_base32: string };
      assert.ok(existsSync(file), "the secret is in the file");
      assert.equal(((await (await app.request("/api/company/owner-code", { headers: screen() })).json()) as { enrolled: boolean }).enrolled, true);

      const created = await app.request("/api/company/projects", { method: "POST", headers: screen(), body: JSON.stringify({ name: "Taller Linux", goal: "Probar Plania fuera de una Mac." }) });
      assert.equal(created.status, 201, await created.clone().text());
      const slug = ((await created.json()) as { slug?: string; project?: { slug: string } }).slug ?? "taller-linux";

      const wrong = await app.request(`/api/company/projects/${slug}`, { method: "DELETE", headers: screen(), body: JSON.stringify({ code: "000000" }) });
      assert.equal(wrong.status, 403, "a wrong code is refused");
      const code = totp(base32Decode(secret_base32), Date.now());
      const del = await app.request(`/api/company/projects/${slug}`, { method: "DELETE", headers: screen(), body: JSON.stringify({ code }) });
      assert.equal(del.status, 200, await del.clone().text());
      assert.equal((await raw.query(`select count(*)::int as n from projects where slug = $1`, [slug])).rows[0].n, 0);
    } finally {
      for (const k of Object.keys(deleteProjectDeps)) delete (deleteProjectDeps as Record<string, unknown>)[k];
      store.useOwnerStore(new store.MemoryOwnerSecretStore());
      delete process.env.PLANIA_PASSWORD_HASH;
    }
  });
});

// ---- pg_dump and psql, PATH joins

// B4: on Windows the lookup searches the EDB and Laragon folders instead (test/install-cmd.test.ts covers both).
test("pg_dump and psql: PLANIA_PG_BIN, the server's major on macOS and Linux, PATH, then the usual folders", { skip: needs({ posix: true }) }, () => {
  const none = () => [];
  assert.equal(pgDumpFor(16, { PLANIA_PG_BIN: "/opt/pg/bin" }, () => false), path.join("/opt/pg/bin", "pg_dump"));
  assert.equal(pgDumpFor(16, { PLANIA_PG_BIN: "/opt/pg/bin/pg_dump" }, () => false), "/opt/pg/bin/pg_dump");
  assert.equal(pgToolFor("psql", 16, { env: { PLANIA_PG_BIN: "/opt/pg/bin/pg_dump" }, exists: () => false, listDir: none }), path.join("/opt/pg/bin", "psql"));
  const deb = path.join("/usr/lib/postgresql/16/bin", "pg_dump");
  const onPath = path.join("/p", "pg_dump");
  assert.equal(pgDumpFor(16, { PATH: "/p" }, only([deb, onPath]), none), deb, "the server's major first (Debian/Ubuntu)");
  assert.equal(pgDumpFor(16, { PATH: "/p" }, only([onPath]), none), onPath, "then PATH");
  assert.equal(pgDumpFor(0, { PATH: "" }, only([path.join("/usr/bin", "pg_dump")]), none), path.join("/usr/bin", "pg_dump"), "then the system's own");
  assert.equal(pgDumpFor(0, { PATH: "" }, only([path.join("/usr/lib/postgresql/15/bin", "psql"), path.join("/usr/lib/postgresql/15/bin", "pg_dump")]), () => ["14", "15", "x"]), path.join("/usr/lib/postgresql/15/bin", "pg_dump"));
  assert.equal(pgToolFor("psql", 0, { env: { PATH: "" }, exists: () => false, listDir: none }), "psql", "the bare name when none is found");
  const sp = pgSearchPath(["/a", "/b"].join(path.delimiter), { env: {}, exists: only(["/usr/lib/postgresql/16/bin"]), listDir: () => ["16"] });
  assert.deepEqual(sp.split(path.delimiter), ["/usr/lib/postgresql/16/bin", "/a", "/b"]);
});

test("PATH lists are joined with the system's separator", () => {
  assert.deepEqual(commandPath("C:\\a;C:\\b", ";").split(";").slice(0, 2), ["C:\\a", "C:\\b"]);
  assert.ok(commandPath("/x", ":").split(":").includes("/home/linuxbrew/.linuxbrew/bin"));
  assert.equal(commandPath("/x").split(path.delimiter)[0], "/x");
  assert.equal(toolPath("/a;/b", "/n/bin/node", ";"), ["/n/bin", "/opt/homebrew/bin", "/usr/local/bin", "/a", "/b"].join(";"));
});

// ---- Check 7: «No disponible en este sistema»

describe("parts this system cannot run say so (check 7)", () => {
  test("what each part needs", () => {
    assert.equal(support.missingFor("test_copy", { platform: "win32" }), "process groups and /bin/sh (native Windows)");
    assert.equal(support.missingFor("test_copy", { platform: "linux", exists: () => true }), null);
    assert.equal(support.missingFor("stills", { chrome: () => null }), "Chrome or Chromium");
    assert.equal(support.missingFor("stills", { chrome: () => "/usr/bin/chromium" }), null);
    assert.equal(support.missingFor("base_lever", { platform: "linux", env: { PATH: "" }, exists: () => false }), "brew or systemctl");
    assert.equal(support.missingFor("base_lever", { platform: "linux", env: { PATH: "" }, exists: (p) => p === path.join("/home/linuxbrew/.linuxbrew/bin", "brew") }), null);
  });

  test("the test copy, its stills and Máquinas answer a plain state over the API, never an error", async () => {
    resetPrueba();
    await raw.query(`update projects set settings = settings || $2::jsonb where slug = $1`, ["micasa", JSON.stringify({ capture: { start_command: "npm run dev -- --port {port}", port: 4999, pages: [{ key: "inicio", path: "/", label: "Inicio" }] } })]);
    // A database of this floor on a local server, so the base lever has something to say about.
    await raw.query(`insert into footprints (project_id, machine, kind, locator, details, state) values ($1, 'test', 'database', 'micasa_app@127.0.0.1:5999', $2, 'live')`, [await idOf("projects", "micasa"), JSON.stringify({ name: "micasa_app", port: 5999 })]);
    support.useSystemSupport(() => false);
    try {
      const read = await app.request("/api/projects/micasa/captures", { headers: screen() });
      assert.equal(read.status, 200, await read.clone().text());
      const prueba = ((await read.json()) as { prueba: { phase: string; stills?: string; error: string | null } }).prueba;
      assert.equal(prueba.phase, "unavailable");
      assert.equal(prueba.stills, "unavailable");
      assert.equal(prueba.error, null);

      const on = await app.request("/api/projects/micasa/captures/encender", { method: "POST", headers: screen(), body: "{}" });
      assert.equal(on.status, 200, await on.clone().text());
      assert.equal(((await on.json()) as { prueba: { phase: string } }).prueba.phase, "unavailable", "Encenderla starts nothing");
      const take = await app.request("/api/projects/micasa/captures/tomar", { method: "POST", headers: screen(), body: "{}" });
      assert.equal(take.status, 200, await take.clone().text());

      const maq = await app.request("/api/projects/micasa/maquinas", { headers: screen() });
      assert.equal(maq.status, 200, await maq.clone().text());
      const m = (await maq.json()) as { server: { phase: string }; base: { lever: { can: boolean; reason: string | null } } };
      assert.equal(m.server.phase, "unavailable");
      assert.deepEqual(m.base.lever, { can: false, reason: NO_DISPONIBLE });

      const tests = await app.request("/api/projects/micasa/maquinas/pruebas", { method: "POST", headers: screen(), body: "{}" });
      assert.equal(tests.status, 200, await tests.clone().text());
      assert.deepEqual((({ can, reason }) => ({ can, reason }))((await tests.json()) as { can: boolean; reason: string }), { can: false, reason: NO_DISPONIBLE });

      // Only the stills missing (a Linux machine without Chrome): the copy still starts, the stills say so.
      support.useSystemSupport((f) => f !== "stills");
      const r2 = ((await (await app.request("/api/projects/micasa/captures", { headers: screen() })).json()) as { prueba: { phase: string; stills?: string } }).prueba;
      assert.notEqual(r2.phase, "unavailable");
      assert.equal(r2.stills, "unavailable");

      // El Probador: the card shows at once with a plain note, not a wait for pictures that cannot come.
      const p = (await raw.query(`select * from projects where slug = 'micasa'`)).rows[0];
      const gate = probadorGate({ settings: p.settings } as never, { muestra: { vistas: [] }, probador: null } as never, null);
      assert.deepEqual(gate, { pending: false, hold: `Fotos: ${NO_DISPONIBLE.toLowerCase()}` });
      // A saved error still wins over what this machine lacks: the owner reads what happened.
      const saved = probadorGate({ settings: p.settings } as never, { muestra: { vistas: [] }, probador: { state: "lista", commit: null, error: "Sin antes: la copia de prueba no arrancó" } } as never, null);
      assert.deepEqual(saved, { pending: false, hold: "Faltan fotos: Sin antes: la copia de prueba no arrancó" });
    } finally {
      support.useSystemSupport(null);
      resetPrueba();
      await raw.query(`delete from footprints where locator = 'micasa_app@127.0.0.1:5999'`);
    }
  });

  test("the screen draws «No disponible en este sistema» for them", () => {
    const pr = { phase: "unavailable" as const, managed: false, port: null, url: null, started_at: null, error: null, detail: null };
    const read = { project: "micasa", configured: true, start: null, viewports: { desktop: { width: 1440, height: 900 }, phone: { width: 390, height: 844 } }, pages: [], last_ok_at: null, last_run_at: null, prueba: pr };
    const v = ventanaView(read as never);
    assert.equal(v.state, "apagada");
    assert.equal(v.title, NO_DISPONIBLE);
    assert.equal(v.button, null);
    assert.equal(v.caption, NO_DISPONIBLE_POR.test_copy);
    const s = ventanaView({ ...read, prueba: { ...pr, phase: "off", stills: "unavailable" } } as never);
    assert.equal(s.title, NO_DISPONIBLE);
    assert.equal(s.caption, NO_DISPONIBLE_POR.stills);
    assert.notEqual(s.state, "error");

    const maq = maqView({
      project: "micasa",
      configured: true,
      no_code: false,
      server: { ...pr, command: null, commit: null, branch: null, worktree: null, started_by: null, frameable: false },
      base: { state: "none", engine: null, version: null, host: null, port: null, databases: [], size_bytes: null, service: null, shared_with: [], lever: { can: false, reason: NO_DISPONIBLE }, env_file: null },
      found: null,
      pages: [],
      test_user: null,
    } as never);
    assert.equal(maq.state, "unavailable");
    assert.equal(maq.word, NO_DISPONIBLE);
    assert.equal(maq.server.lever, null);
  });
});

// ---- Check 4: a real run, stopped from the screen, leaves no process behind (POSIX: process groups)

test(
  "a run of the fake Claude, stopped from the screen, leaves no process behind (check 4)",
  { skip: needs({ posix: true }), timeout: 60_000 },
  async () => {
    const bin = path.join(scratch, "stopbin");
    mkdirSync(bin, { recursive: true });
    const claude = path.join(bin, "claude");
    writeFileSync(claude, `#!/bin/sh\nexec "${process.execPath}" "${FAKE_CLAUDE}" "$@"\n`);
    chmodSync(claude, 0o755);
    const pidsFile = path.join(scratch, "fake-pids");
    const home = path.join(scratch, "home-stop");
    mkdirSync(home, { recursive: true });
    const env = {
      HOME: home,
      PATH: [bin, "/usr/bin", "/bin"].join(path.delimiter),
      PLANIA_RUNNER_TOKEN: "runner-token",
      PLANIA_PROMPTS_PROJECT: "micasa",
      PLANIA_WORKER_ID: "test:main",
      CLAUDE_FAKE_MS: "60000",
      CLAUDE_FAKE_PIDS: pidsFile,
    } as NodeJS.ProcessEnv;
    const runId = await queueRun("stop");
    await runner.drainQueue(db, new Date(), {
      env,
      logDir: path.join(scratch, "logs-stop"),
      tmpDir: path.join(scratch, "tmp-stop"),
      worktreeRoot: path.join(scratch, "worktrees-stop"),
      detached: true,
      pollMs: 50,
      graceMs: 2_000,
      liveFlushMs: 0,
      footprints: false,
      // The run's cwd is its worktree: the fake git makes the folder `worktree add` would.
      git: async (args: string[]) => {
        if (args[0] === "worktree" && args[1] === "add") {
          const target = args.find((a) => a.startsWith(path.join(scratch, "worktrees-stop")));
          if (target) mkdirSync(target, { recursive: true });
        }
        if (args[0] === "rev-parse" && args[1] === "--verify") return { code: 1, stdout: "", stderr: "" };
        return { code: 0, stdout: "", stderr: "" };
      },
      reportTokens: async () => undefined,
      probeUsage: async () => null,
      machine: () => ({ freeMb: 99_999, freeDiskGb: 999 }),
    } as never);
    // A zombie has exited: only its parent (or init) has yet to reap it. Linux says so in /proc; elsewhere signal 0.
    const alive = (pid: number) => {
      try {
        process.kill(pid, 0);
      } catch {
        return false;
      }
      try {
        return !/^State:\s+Z/m.test(readFileSync(`/proc/${pid}/status`, "utf8"));
      } catch {
        return true;
      }
    };
    const until = async (ok: () => boolean, ms: number) => {
      for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 50))) if (ok()) return true;
      return ok();
    };
    if (!(await until(() => existsSync(pidsFile) && readFileSync(pidsFile, "utf8").includes(" "), 20_000))) {
      const row = (await raw.query(`select status, summary from agent_runs where id = $1`, [runId])).rows[0];
      const logs = path.join(scratch, "logs-stop");
      const tail = existsSync(logs) ? (await import("node:fs")).readdirSync(logs).map((n) => readFileSync(path.join(logs, n), "utf8").slice(-600)).join(" | ") : "no logs";
      assert.fail(`the fake Claude did not start through PATH: ${JSON.stringify(row)} ${tail}`);
    }
    const pids = readFileSync(pidsFile, "utf8").trim().split(" ").map(Number);
    assert.ok(pids.every(alive), "Claude and its tool run");

    const stop = await app.request(`/api/company/runs/${runId}/stop`, { method: "POST", headers: screen(), body: "{}" });
    assert.equal(stop.status, 200, await stop.clone().text());
    await runner.waitForAllRuns();
    assert.equal((await raw.query(`select status from agent_runs where id = $1`, [runId])).rows[0].status, "stopped");
    const state = (pid: number) => {
      try {
        return readFileSync(`/proc/${pid}/status`, "utf8").split(/\r?\n/).filter((l) => /^(State|PPid|SigIgn|SigCgt)/.test(l)).join(" ");
      } catch {
        return "?";
      }
    };
    assert.ok(await until(() => !pids.some(alive), 5_000), `still alive: ${pids.filter(alive).map((p) => `${p} ${state(p)}`).join(", ")}`);
  },
);

test("a skipped test names its reason", () => {
  assert.equal(needs({ posix: true }, { platform: "linux" }), false);
  assert.match(String(needs({ posix: true }, { platform: "win32" })), /native Windows/);
  assert.match(String(needs({ platforms: ["darwin"] }, { platform: "linux" })), /runs only on darwin/);
  assert.equal(needs({ tools: ["lsof"] }, { env: { PATH: "/u" }, exists: (p) => p === path.join("/u", "lsof"), platform: "linux" }), false);
  assert.match(String(needs({ tools: ["lsof", "ps"] }, { env: { PATH: "" }, exists: () => false, platform: "linux" })), /needs lsof, ps on PATH/);
});
