// PLA-I2-1: one-command install, the migration record, baseline, and the start-up check. Every database here is this
// checkout's plania_test_<hash> (test/helpers.ts); nothing touches the live plania database. No network: the server
// that "answers" is served on 127.0.0.1 inside this process.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { parseEnv } from "node:util";
import pg from "pg";
import { ADMIN_URL, TEST_DATABASE_URL, TEST_DB, useTestEnv } from "./helpers.js";

useTestEnv();
const { resetPool } = await import("../src/db/client.js");
const { install, InstallError } = await import("../src/db/install.js");
const { baseline, MIGRATIONS_TABLE, MigrateError, migrate, readMigrations, startupProblem } = await import(
  "../src/db/migrate.js"
);

const REPO = path.resolve(import.meta.dirname, "..");
const FILES = readMigrations();
const scratch = mkdtempSync(path.join(tmpdir(), "plania-install-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

assert.match(TEST_DB, /^plania_test_[0-9a-f]{6}$/);

async function admin<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: ADMIN_URL });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}
async function dropTestDb(): Promise<void> {
  await resetPool();
  await admin((c) => c.query(`drop database if exists ${TEST_DB} with (force)`));
}
async function emptyTestDb(): Promise<void> {
  await dropTestDb();
  await admin((c) => c.query(`create database ${TEST_DB}`));
}
async function client(): Promise<pg.Client> {
  const c = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await c.connect();
  return c;
}
async function recordedNames(c: pg.Client): Promise<string[]> {
  const { rows } = await c.query(`select name from ${MIGRATIONS_TABLE} order by name`);
  return rows.map((r) => r.name);
}
async function tableExists(c: pg.Client, name: string): Promise<boolean> {
  const { rows } = await c.query("select to_regclass($1) is not null as p", [`public.${name}`]);
  return rows[0].p;
}

test("check 1: on an empty Postgres, install creates the database, records every migration, and the server answers", async () => {
  await dropTestDb();
  const envPath = path.join(scratch, "one.env");
  const calls: string[] = [];
  const r = await install({
    url: TEST_DATABASE_URL,
    named: false,
    envPath,
    examplePath: path.join(REPO, ".env.example"),
    machineCheck: async () => {
      calls.push("check");
      return { ok: true, lines: ["máquina bien"] };
    },
    buildScreen: async () => {
      calls.push("screen");
    },
  });
  assert.equal(r.created, true);
  assert.deepEqual(r.applied, FILES.map((f) => f.name));
  assert.deepEqual(calls, ["check", "screen"]);

  const env = parseEnv(readFileSync(envPath, "utf8"));
  assert.equal(env.DATABASE_URL, TEST_DATABASE_URL);
  assert.ok((env.SESSION_SECRET ?? "").length >= 32);
  assert.match(env.MCP_BEARER_TOKEN ?? "", /^[0-9a-f]{64}$/);
  // The rest of .env.example is kept, so every other setting is still there to fill.
  assert.ok("PLANIA_TZ" in env);

  const c = await client();
  assert.deepEqual(await recordedNames(c), FILES.map((f) => f.name));
  await c.end();

  assert.equal(await startupProblem(TEST_DATABASE_URL), null);
  const { serve } = await import("@hono/node-server");
  const { app } = await import("../src/app.js");
  const server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" });
  await new Promise((res) => server.once("listening", res));
  try {
    const port = (server.address() as AddressInfo).port;
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
  } finally {
    await new Promise((res) => server.close(res));
  }

  // A second run creates nothing, applies nothing and keeps the generated secrets.
  const again = await install({ url: TEST_DATABASE_URL, named: false, envPath, buildScreen: async () => {} });
  assert.equal(again.created, false);
  assert.deepEqual(again.applied, []);
  assert.deepEqual(again.envKeys, []);
  assert.deepEqual(parseEnv(readFileSync(envPath, "utf8")), env);
});

test("install stops on a failed machine check before creating anything", async () => {
  await dropTestDb();
  await assert.rejects(
    install({
      url: TEST_DATABASE_URL,
      named: false,
      envPath: path.join(scratch, "check.env"),
      machineCheck: async () => ({ ok: false, lines: ["falta git"] }),
    }),
    InstallError,
  );
  const exists = await admin((c) => c.query("select 1 from pg_database where datname = $1", [TEST_DB]));
  assert.equal(exists.rows.length, 0);
});

test("install refuses a database it did not create unless it is named", async () => {
  await emptyTestDb();
  const envPath = path.join(scratch, "refuse.env");
  await assert.rejects(
    install({ url: TEST_DATABASE_URL, named: false, envPath }),
    (e: Error) => e instanceof InstallError && e.message.includes(`--database ${TEST_DB}`),
  );
  assert.throws(() => readFileSync(envPath));
  const r = await install({ url: TEST_DATABASE_URL, named: true, envPath });
  assert.equal(r.created, false);
  assert.equal(r.applied.length, FILES.length);
});

test("check 2: running migrate twice applies nothing the second time", async () => {
  await emptyTestDb();
  const c = await client();
  const first = await migrate(c, { named: true });
  assert.equal(first.bootstrapped, true);
  assert.equal(first.applied.length, FILES.length);
  const second = await migrate(c);
  assert.deepEqual(second, { applied: [], changed: [], bootstrapped: false });
  await c.end();
});

test("check 2: the migrate command run twice says nothing to apply the second time", async () => {
  await emptyTestDb();
  const run = () =>
    spawnSync(process.execPath, ["--import", "tsx", "scripts/migrate.ts", "--url", TEST_DATABASE_URL], {
      cwd: REPO,
      encoding: "utf8",
    });
  const one = run();
  assert.equal(one.status, 0, one.stderr);
  assert.match(one.stdout, new RegExp(`${FILES.length} migraciones aplicadas`));
  const two = run();
  assert.equal(two.status, 0, two.stderr);
  assert.match(two.stdout, /nada que aplicar/);
});

test("a database with no record that was not named is refused; with tables it needs a baseline", async () => {
  await emptyTestDb();
  const c = await client();
  await assert.rejects(migrate(c), (e: Error) => e instanceof MigrateError && e.code === "NOT_NAMED");
  await c.query("create table owner_data (x int)");
  await assert.rejects(migrate(c, { named: true }), (e: Error) => e instanceof MigrateError && e.code === "NEEDS_BASELINE");
  assert.equal(await tableExists(c, MIGRATIONS_TABLE), false);
  await c.end();
});

test("check 3: a database with migrations and no record is baselined without running one; migrate then applies only newer files", async () => {
  await emptyTestDb();
  const c = await client();
  const upTo = FILES.length - 3;
  // The owner's database: files applied by hand with no record.
  for (const f of FILES.slice(0, upTo)) await c.query(f.sql);
  const target = FILES[upTo - 1]!.name;
  await c.query("create table baseline_probe (n int)");

  // Baseline runs nothing: a file re-run would fail (most early files are not idempotent) or change the probe.
  const { marked } = await baseline(c, target);
  assert.deepEqual(marked, FILES.slice(0, upTo).map((f) => f.name));
  assert.deepEqual(await recordedNames(c), marked);
  await assert.rejects(baseline(c, target), (e: Error) => e instanceof MigrateError && e.code === "BASELINE_REFUSED");

  const r = await migrate(c);
  assert.deepEqual(r.applied, FILES.slice(upTo).map((f) => f.name));
  assert.deepEqual(await recordedNames(c), FILES.map((f) => f.name));
  await c.end();
});

test("baseline refuses an empty database and an unknown file", async () => {
  await emptyTestDb();
  const c = await client();
  await assert.rejects(baseline(c, FILES[0]!.name), (e: Error) => e instanceof MigrateError && e.code === "BASELINE_REFUSED");
  await assert.rejects(baseline(c, "9999_nope.sql"), (e: Error) => e instanceof MigrateError && e.code === "UNKNOWN_FILE");
  await c.end();
});

test("check 5: a failed migration leaves the database as before that file, no record, and names the file", async () => {
  await emptyTestDb();
  const c = await client();
  const bad = {
    name: "9999_bad.sql",
    sql: "create table half_done (x int);\ninsert into half_done values (1);\nselect 1/0;",
    checksum: "x",
  };
  const after = { name: "9999_zz_after.sql", sql: "create table never_reached (x int);", checksum: "y" };
  await assert.rejects(
    migrate(c, { named: true, files: [...FILES, bad, after] }),
    (e: Error) => e instanceof MigrateError && e.code === "MIGRATION_FAILED" && e.file === "9999_bad.sql" && e.message.includes("9999_bad.sql"),
  );
  assert.equal(await tableExists(c, "half_done"), false);
  assert.equal(await tableExists(c, "never_reached"), false);
  assert.deepEqual(await recordedNames(c), FILES.map((f) => f.name));
  await c.end();
});

test("a recorded file whose content changed is reported, never re-applied", async () => {
  await emptyTestDb();
  const c = await client();
  await migrate(c, { named: true });
  const edited = FILES.map((f, i) => (i === 0 ? { ...f, sql: `${f.sql}\n-- edited`, checksum: "changed" } : f));
  const r = await migrate(c, { files: edited });
  assert.deepEqual(r, { applied: [], changed: [FILES[0]!.name], bootstrapped: false });
  await c.end();
});

test("CRLF and LF copies of a file have the same checksum", async () => {
  const { checksumOf } = await import("../src/db/migrate.js");
  assert.equal(checksumOf("a;\r\nb;\r\n"), checksumOf("a;\nb;\n"));
});

test("check 7: the start-up check gives one sentence for an unreachable database and for an unapplied migration", async () => {
  await dropTestDb();
  const missing = await startupProblem(TEST_DATABASE_URL);
  assert.ok(missing && !missing.includes("\n"));
  assert.match(missing, new RegExp(`No se pudo abrir la base ${TEST_DB}`));
  assert.match((await startupProblem(undefined)) ?? "", /DATABASE_URL/);

  await admin((c) => c.query(`create database ${TEST_DB}`));
  assert.match((await startupProblem(TEST_DATABASE_URL)) ?? "", /está vacía/);

  const c = await client();
  await migrate(c, { named: true });
  assert.equal(await startupProblem(TEST_DATABASE_URL), null);
  const last = FILES.at(-1)!.name;
  await c.query(`delete from ${MIGRATIONS_TABLE} where name = $1`, [last]);
  await c.end();
  const pending = await startupProblem(TEST_DATABASE_URL);
  assert.ok(pending && !pending.includes("\n"));
  assert.match(pending, new RegExp(`1 migración sin aplicar \\(desde ${last}\\)`));
});

test("check 7: the server refuses to start, with one sentence, when the database is unreachable", async () => {
  await dropTestDb();
  const r = spawnSync(process.execPath, ["--import", "tsx", "scripts/dev.ts", "--port", "3999"], {
    cwd: REPO,
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL, PLANIA_UI_BUILD: "0", PLANIA_JOBS: "0" },
    timeout: 60_000,
  });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  const lines = r.stderr.trim().split(/\r?\n/);
  assert.equal(lines.length, 1, r.stderr);
  assert.match(lines[0] ?? "", /No se pudo abrir la base/);
  assert.doesNotMatch(r.stdout, /plania on http/);
});
