// PLA-I41-1: migration 0045 (Morning brief). Writes and reads each of the five tables through Drizzle on the
// throwaway plania_test_<hash> database (resetTestDb applies every migration); never the live plania database.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { eq } from "drizzle-orm";
import type pg from "pg";
import { resetTestDb, TEST_DATABASE_URL, useTestEnv } from "./helpers.js";

useTestEnv();
const { makeDb } = await import("../src/db/client.js");
const { morningBriefs, briefRuns, briefPlanRequests, briefChecks, briefSettings } = await import("../src/db/schema.js");

type Db = ReturnType<typeof makeDb>["db"];
let raw: pg.Client;
let db: Db;
let closeDb: () => Promise<void>;
function one<T>(rows: T[]): T {
  assert.equal(rows.length, 1);
  return rows[0]!;
}
const MIGRATION = new URL("../drizzle/migrations/0045_morning_brief.sql", import.meta.url);

before(async () => {
  assert.match(TEST_DATABASE_URL, /\/plania_test_[0-9a-f]{6}$/);
  raw = await resetTestDb();
  ({ db, close: closeDb } = makeDb());
});

after(async () => {
  await closeDb();
  await raw.end();
});

test("0045 applies again cleanly (idempotent)", async () => {
  await raw.query(readFileSync(MIGRATION, "utf8"));
  const { rows } = await raw.query(
    `select table_name from information_schema.tables where table_schema = 'public'
       and table_name in ('morning_briefs', 'brief_runs', 'brief_plan_requests', 'brief_checks', 'brief_settings')
     order by table_name`,
  );
  assert.deepEqual(
    rows.map((r) => r.table_name),
    ["brief_checks", "brief_plan_requests", "brief_runs", "brief_settings", "morning_briefs"],
  );
});

test("brief_runs and morning_briefs: write and read", async () => {
  const run = one(await db
    .insert(briefRuns)
    .values({ trigger: "schedule", status: "running", passes: { brief: { status: "ok", turns: 4, tokens: 1200, log_file: "brief-a.log" } } })
    .returning());
  assert.equal(run.summary, "");
  assert.ok(run.startedAt instanceof Date);
  assert.equal(run.endedAt, null);

  await db.update(briefRuns).set({ status: "ok", endedAt: new Date(), summary: "2 passes ok" }).where(eq(briefRuns.id, run.id));
  const readRun = one(await db.select().from(briefRuns).where(eq(briefRuns.id, run.id)));
  assert.equal(readRun.status, "ok");
  assert.equal(readRun.passes.brief?.log_file, "brief-a.log");

  const data = { version: 1, mode: "full", items: [], ideas: [{ id: "d|workia|abc", code: "W1" }] };
  await db.insert(morningBriefs).values([
    { localDate: "2026-11-13", trigger: "schedule", mode: "full", data, runId: run.id, generatedAt: new Date("2026-11-13T13:04:00Z") },
    { localDate: "2026-11-13", trigger: "manual", mode: "partial", data, generatedAt: new Date("2026-11-13T15:00:00Z") },
  ]);
  const rows = await db.select().from(morningBriefs).where(eq(morningBriefs.localDate, "2026-11-13"));
  assert.equal(rows.length, 2, "several briefs a day are fine");
  const sched = rows.find((r) => r.trigger === "schedule")!;
  assert.equal(sched.runId, run.id);
  assert.deepEqual(sched.data, data);

  await assert.rejects(raw.query(`insert into morning_briefs (local_date, trigger, mode, data) values ('2026-11-13', 'cron', 'full', '{}')`), /morning_briefs_trigger_check/);
  await assert.rejects(raw.query(`insert into morning_briefs (local_date, trigger, mode, data) values ('2026-11-13', 'cli', 'half', '{}')`), /morning_briefs_mode_check/);
  await assert.rejects(raw.query(`insert into brief_runs (trigger, status) values ('cli', 'done')`), /brief_runs_status_check/);
});

test("brief_plan_requests: write, read, cascade with its brief", async () => {
  const brief = one(await db.insert(morningBriefs).values({ localDate: "2026-11-14", trigger: "cli", mode: "facts_only", data: {} }).returning());
  const req = one(await db
    .insert(briefPlanRequests)
    .values({
      briefId: brief.id,
      codes: ["W1", "Z3", "X1"],
      ideas: [{ code: "W1", app: "workia", title: "T", why: "W" }],
      targets: [{ slug: "workia", po_agent: "po-workia", codes: ["W1"], state: "queued", results: [] }],
    })
    .returning());
  assert.equal(req.status, "open");
  const read = one(await db.select().from(briefPlanRequests).where(eq(briefPlanRequests.id, req.id)));
  assert.deepEqual(read.codes, ["W1", "Z3", "X1"]);
  assert.equal(read.targets[0]?.state, "queued");

  await assert.rejects(raw.query(`update brief_plan_requests set status = 'closed' where id = $1`, [req.id]), /brief_plan_requests_status_check/);
  await db.delete(morningBriefs).where(eq(morningBriefs.id, brief.id));
  assert.equal((await db.select().from(briefPlanRequests).where(eq(briefPlanRequests.id, req.id))).length, 0);
});

test("brief_checks: check, read, uncheck", async () => {
  await db.insert(briefChecks).values([{ itemId: "i|workia|0123456789ab" }, { itemId: "d|cross|ba9876543210" }]);
  const rows = await db.select().from(briefChecks);
  assert.deepEqual(rows.map((r) => r.itemId).sort(), ["d|cross|ba9876543210", "i|workia|0123456789ab"]);
  assert.ok(rows[0]?.checkedAt instanceof Date);
  await assert.rejects(db.insert(briefChecks).values({ itemId: "i|workia|0123456789ab" }));
  await db.delete(briefChecks).where(eq(briefChecks.itemId, "i|workia|0123456789ab"));
  assert.equal((await db.select().from(briefChecks)).length, 1);
});

test("brief_settings: one row with the spec defaults, fallback_at 11:00", async () => {
  const s = one(await db.insert(briefSettings).values({}).returning());
  assert.equal(s.id, 1);
  assert.equal(s.enabled, true);
  assert.equal(s.runAt, "07:00:00");
  assert.equal(s.fallbackAt, "11:00:00");
  assert.equal(s.language, "en");
  assert.deepEqual(s.hiddenRefs, []);
  assert.equal(s.maxItemsPerApp, 5);
  assert.equal(s.ideasPerProject, 3);
  assert.equal(s.ideasEnabled, true);
  assert.deepEqual(s.passTimeouts, { brief: 10, ideas: 20, plan: 30 });
  assert.deepEqual(s.projects, {});
  assert.equal(s.githubMode, "poller");
  assert.equal(s.timezone, null);

  await db
    .update(briefSettings)
    .set({ fallbackAt: "12:00", language: "es", hiddenRefs: ["MIC-99"], projects: { micasa: { include: true, letter: "C", order: 1 } } })
    .where(eq(briefSettings.id, 1));
  const read = one(await db.select().from(briefSettings));
  assert.equal(read.fallbackAt, "12:00:00");
  assert.equal(read.language, "es");
  assert.deepEqual(read.hiddenRefs, ["MIC-99"]);
  assert.equal(read.projects.micasa?.letter, "C");

  await assert.rejects(raw.query(`insert into brief_settings (id) values (2)`), /brief_settings_id_check/);
  await assert.rejects(raw.query(`update brief_settings set language = 'fr'`), /brief_settings_language_check/);
  await assert.rejects(raw.query(`update brief_settings set github_mode = 'api'`), /brief_settings_github_mode_check/);
});
