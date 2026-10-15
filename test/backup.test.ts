// The nightly backup job (2.9 fix b): when it runs, what it keeps, what it records, and that the dump restores.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { after, before, describe, test } from "node:test";
import pg from "pg";
import { TEST_DATABASE_URL, resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const { app } = await import("../src/app.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const { makeDb } = await import("../src/db/client.js");
const { runBackup, prune, backupState, backupFindings, KEEP } = await import("../src/jobs/backup.js");

let raw: pg.Client;
let db: ReturnType<typeof makeDb>["db"];
const TZ = "America/Mexico_City";
// 2026-10-15 in Mexico City (UTC-6): 02:30 and 04:00 local, then the next day at 05:00.
const NIGHT = new Date("2026-10-15T08:30:00Z");
const MORNING = new Date("2026-10-15T10:00:00Z");
const NEXT = new Date("2026-10-16T11:00:00Z");

before(async () => {
  raw = await resetTestDb();
  ({ db } = makeDb());
});

after(async () => {
  await raw?.end();
});

describe("runBackup", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "plania-backup-"));

  test("waits until 03:00 local time", async () => {
    assert.deepEqual(await runBackup(db, NIGHT, { dir, tz: TZ }), { dumped: 0, pruned: 0, failed: 0 });
    assert.deepEqual(readdirSync(dir), []);
  });

  test("dumps once that day into plania-<YYYYMMDD>.sql.gz and records it", async () => {
    assert.equal((await runBackup(db, MORNING, { dir, tz: TZ })).dumped, 1);
    const file = path.join(dir, "plania-20261015.sql.gz");
    assert.ok(existsSync(file));
    const sql = gunzipSync(readFileSync(file)).toString("utf8");
    assert.match(sql, /CREATE TABLE public\.tasks/);
    assert.doesNotMatch(sql, /OWNER TO/, "--no-owner");
    const s = await backupState(db);
    assert.equal(s.path, file);
    assert.equal(s.day, "2026-10-15");
    assert.equal(s.error, null);
    assert.ok(s.bytes! > 1000);
    // the same day again: nothing
    assert.deepEqual(await runBackup(db, new Date(MORNING.getTime() + 3600_000), { dir, tz: TZ }), { dumped: 0, pruned: 0, failed: 0 });
  });

  test("the dump restores into an empty database", async () => {
    const name = `${new URL(TEST_DATABASE_URL).pathname.slice(1)}_restore`;
    const admin = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await admin.connect();
    await admin.query(`drop database if exists ${name} with (force)`);
    await admin.query(`create database ${name}`);
    try {
      const url = new URL(TEST_DATABASE_URL);
      url.pathname = `/${name}`;
      const psql = path.join(path.dirname(realpathSync(execFileSync("which", ["pg_dump"]).toString().trim())), "psql");
      execFileSync(psql, ["-q", "-v", "ON_ERROR_STOP=1", url.toString()], { input: gunzipSync(readFileSync(path.join(dir, "plania-20261015.sql.gz"))) });
      const restored = new pg.Client({ connectionString: url.toString() });
      await restored.connect();
      const { rows } = await restored.query("select count(*)::int as n from projects");
      await restored.end();
      assert.equal(rows[0].n, 4);
    } finally {
      await admin.query(`drop database if exists ${name} with (force)`);
      await admin.end();
    }
  });

  test("a failed run keeps the last good dump and records the error; the next hour retries", async () => {
    const r = await runBackup(db, NEXT, { dir, tz: TZ, pgDump: "/nonexistent/pg_dump" });
    assert.equal(r.failed, 1);
    const s = await backupState(db);
    assert.equal(s.day, "2026-10-15", "the good dump stays the last one");
    assert.match(s.error!, /ENOENT|nonexistent/);
    assert.ok(!readdirSync(dir).some((f) => f.endsWith(".partial")));
    assert.equal((await runBackup(db, new Date(NEXT.getTime() + 3600_000), { dir, tz: TZ })).dumped, 1);
    assert.equal((await backupState(db)).error, null);
  });

  test("GET /api/machine carries the backup", async () => {
    const res = await app.request("/api/machine", { headers: { Cookie: `${SESSION_COOKIE}=${createSession()}` } });
    const body = (await res.json()) as Record<string, any>;
    assert.equal(body.backup.path, path.join(dir, "plania-20261016.sql.gz"));
    assert.equal(typeof body.backup.bytes, "number");
    assert.equal(body.backup.error, null);
  });
});

describe("prune", () => {
  test(`keeps the newest ${KEEP} daily dumps and never touches plania-pre-*`, async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "plania-prune-"));
    for (let d = 1; d <= 20; d++) writeFileSync(path.join(dir, `plania-202610${String(d).padStart(2, "0")}.sql.gz`), "x");
    writeFileSync(path.join(dir, "plania-pre-0022-20261015T060000Z.sql"), "x");
    writeFileSync(path.join(dir, "notes.txt"), "x");
    const removed = await prune(dir);
    assert.deepEqual(removed, ["plania-20261001.sql.gz", "plania-20261002.sql.gz", "plania-20261003.sql.gz", "plania-20261004.sql.gz", "plania-20261005.sql.gz", "plania-20261006.sql.gz"]);
    const left = readdirSync(dir).sort();
    assert.equal(left.filter((f) => /^plania-\d{8}/.test(f)).length, KEEP);
    assert.ok(left.includes("plania-pre-0022-20261015T060000Z.sql"));
    assert.ok(left.includes("notes.txt"));
  });
});

describe("BACKUP_STALE", () => {
  const now = new Date("2026-10-20T12:00:00Z");
  test("quiet before the first attempt and while the last copy is under 48 h old", () => {
    assert.deepEqual(backupFindings({ at: null, error: null, attempted_at: null }, now), []);
    assert.deepEqual(backupFindings({ at: "2026-10-19T09:00:00Z", error: null, attempted_at: "2026-10-19T09:00:00Z" }, now), []);
  });
  test("a finding with project null once the copy is older than 48 h, with the last error", () => {
    const [f] = backupFindings({ at: "2026-10-18T09:00:00Z", error: "connection refused", attempted_at: "2026-10-20T11:00:00Z" }, now);
    assert.equal(f!.code, "BACKUP_STALE");
    assert.equal(f!.key, null);
    assert.match(f!.detail, /connection refused/);
    assert.equal(backupFindings({ at: null, error: "boom", attempted_at: "2026-10-20T11:00:00Z" }, now)[0]!.code, "BACKUP_STALE");
  });
});
