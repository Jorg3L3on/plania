// The nightly backup job (2.9 fix b): when it runs, what it keeps and what it records. The dump itself and
// loading it back are in devva-backup.test.ts.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { resetTestStore, useTestEnv, type TestStore } from "./helpers.js";

useTestEnv();
const { app } = await import("../src/app.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const { makeDb } = await import("../src/db/client.js");
const { runBackup, prune, backupState, backupFindings, KEEP } = await import("../src/jobs/backup.js");

let store: TestStore;
let db: ReturnType<typeof makeDb>["db"];
const TZ = "America/Mexico_City";
// 2026-10-15 in Mexico City (UTC-6): 02:30 and 04:00 local, then the next day at 05:00.
const NIGHT = new Date("2026-10-15T08:30:00Z");
const MORNING = new Date("2026-10-15T10:00:00Z");
const NEXT = new Date("2026-10-16T11:00:00Z");

before(async () => {
  store = await resetTestStore();
  ({ db } = makeDb());
});

after(async () => {
  await store?.end();
});

describe("runBackup", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "plania-backup-"));

  test("waits until 03:00 local time", async () => {
    assert.deepEqual(await runBackup(db, NIGHT, { dir, tz: TZ }), { dumped: 0, pruned: 0, failed: 0 });
    assert.deepEqual(readdirSync(dir), []);
  });

  test("a failed run keeps the last good dump and records the error; the next hour retries", async () => {
    // The 2026-10-15 dump, as the job records it.
    const good = { at: MORNING.toISOString(), path: path.join(dir, "plania-20261015.devva.jsonl.gz"), bytes: 1, day: "2026-10-15", error: null, attempted_at: MORNING.toISOString() };
    await store.fix((uow) => uow.insert("machineState", { key: "backup", value: good }));
    // A folder holds the next day's file name, so the finished dump cannot be moved into place.
    const taken = path.join(dir, "plania-20261016.devva.jsonl.gz");
    mkdirSync(taken);
    const r = await runBackup(db, NEXT, { dir, tz: TZ });
    assert.equal(r.failed, 1);
    const s = await backupState(db);
    assert.equal(s.day, "2026-10-15", "the good dump stays the last one");
    assert.match(s.error!, /EISDIR|EPERM|ENOTEMPTY|EEXIST/);
    assert.ok(!readdirSync(dir).some((f) => f.endsWith(".partial")));
    rmSync(taken, { recursive: true });
    assert.equal((await runBackup(db, new Date(NEXT.getTime() + 3600_000), { dir, tz: TZ })).dumped, 1);
    assert.equal((await backupState(db)).error, null);
  });

  test("GET /api/machine carries the backup", async () => {
    const res = await app.request("/api/machine", { headers: { Cookie: `${SESSION_COOKIE}=${createSession()}` } });
    const body = (await res.json()) as Record<string, any>;
    assert.equal(body.backup.path, path.join(dir, "plania-20261016.devva.jsonl.gz"));
    assert.equal(typeof body.backup.bytes, "number");
    assert.equal(body.backup.error, null);
  });
});

describe("prune", () => {
  test(`keeps the newest ${KEEP} daily dumps and never touches plania-pre-*`, async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "plania-prune-"));
    for (let d = 1; d <= 20; d++) writeFileSync(path.join(dir, `plania-202610${String(d).padStart(2, "0")}.devva.jsonl.gz`), "x");
    writeFileSync(path.join(dir, "plania-pre-0022-20261015T060000Z.sql"), "x");
    writeFileSync(path.join(dir, "notes.txt"), "x");
    const removed = await prune(dir);
    assert.deepEqual(removed, [
      "plania-20261001.devva.jsonl.gz",
      "plania-20261002.devva.jsonl.gz",
      "plania-20261003.devva.jsonl.gz",
      "plania-20261004.devva.jsonl.gz",
      "plania-20261005.devva.jsonl.gz",
      "plania-20261006.devva.jsonl.gz",
    ]);
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
