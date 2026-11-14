// PLA-I41-6: the scheduled Morning brief (spec §4 triggers, §11; D1, D4) on a test clock. Throwaway test DB
// (test/helpers.ts), a fake spawnPass and a fake liveRuns only: no claude process, no live database, no network.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, beforeEach, test } from "node:test";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const { makeDb } = await import("../src/db/client.js");
const schedule = await import("../src/brief/schedule.js");
const { saveBriefSettings } = await import("../src/brief/settings.js");
const { BriefData } = await import("../src/brief/types.js");
const runner = await import("../src/runner/runner.js");
const { seedOrg } = await import("../scripts/seed-org.js");
type PassOutcome = import("../src/brief/claude.js").PassOutcome<unknown>;

type Db = ReturnType<typeof makeDb>["db"];
let raw: pg.Client;
let db: Db;
const scratch = mkdtempSync(path.join(tmpdir(), "plania-brief-schedule-test-"));
const ENV = { HOME: scratch, PLANIA_TZ: "America/Mexico_City", PLANIA_HOME_PROJECT: "workia", PLANIA_BRIEF_TOKEN: "brief-read-token-value" } as NodeJS.ProcessEnv;

const ok = (data: unknown): PassOutcome => ({ ok: true, data, attempts: 1, turns: 2, tokens: { input: 1, output: 2, cacheRead: 0, cacheCreate: 0, total: 3 }, models: [], logPath: "/tmp/fake-brief-pass.jsonl" });
const ITEMS = { items: [{ app: "zigzag", status: "blocker", ref: "ZIG-3", title: "Prod checkout is broken" }] };
const IDEAS = { ideas: [{ app: "workia", title: "Renewal board", why: "Contracts due soon." }] };

// The test clock: local Mexico City time (UTC-6 in November) on a given day.
const at = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00-06:00`);
let clock = new Date();
let live: unknown[] = [];
let spawned: { pass: string; at: string }[] = [];
const spawnPass = async (_db: unknown, input: { pass: string }) => {
  spawned.push({ pass: input.pass, at: clock.toISOString() });
  return (input.pass === "brief" ? ok(ITEMS) : ok(IDEAS)) as never;
};
const deps = { env: ENV, brief: { now: () => clock, liveRuns: () => live, pollMs: 2, spawnPass, tmpDir: path.join(scratch, "tmp"), buildBrief: async () => ["Corren 4 proyectos."] } };

/** One tick at a local time; with settle, waits for a scheduled run it started (or one already going) to end. */
async function tick(date: string, hhmm: string, settle = true) {
  clock = at(date, hhmm);
  const out = await schedule.scheduledBrief(db, clock, deps);
  if (settle) await schedule.waitForScheduledBrief();
  return out;
}
const briefsOn = async (date: string) =>
  (await raw.query(`select b.mode, b.trigger, b.data, r.status from morning_briefs b left join brief_runs r on r.id = b.run_id where b.local_date = $1 order by b.generated_at`, [date])).rows;
const runStatus = async (id: string | null) => (await raw.query(`select status from brief_runs where id = $1`, [id])).rows[0]?.status as string | undefined;
// Lets the pipeline's poll loop run on real timers.
const settleLoop = () => new Promise((r) => setTimeout(r, 30));
// Waits (real time, up to 5 s) until cond holds: the pipeline runs in the background.
async function until(cond: () => boolean | Promise<boolean>, what: string) {
  for (let i = 0; i < 500; i += 1) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`timed out waiting for ${what}`);
}

before(async () => {
  raw = await resetTestDb();
  ({ db } = makeDb());
  await seedOrg(db);
  await raw.query(`delete from plan_readings`);
  await saveBriefSettings(db, { github_mode: "off" });
});

beforeEach(async () => {
  // A run left waiting by a failed test is stopped and awaited, so it frees the lock.
  live = [];
  const prev = schedule.waitForScheduledBrief();
  schedule.resetScheduleForTests();
  await prev;
  runner.releaseReservation();
  spawned = [];
  await saveBriefSettings(db, { enabled: true, run_at: "07:00", fallback_at: "11:00" });
  await raw.query(`delete from plan_readings`);
});

after(async () => {
  schedule.resetScheduleForTests();
  await raw.end();
  rmSync(scratch, { recursive: true, force: true });
});

test("check 1: 06:59 nothing, 07:00 one run, later the same day nothing, next day one, a 09:12 wake one", async () => {
  assert.equal((await tick("2026-11-20", "06:59")).started, 0);
  assert.equal((await briefsOn("2026-11-20")).length, 0);
  assert.equal((await tick("2026-11-20", "07:00")).started, 1);
  for (const t of ["07:01", "07:30", "09:00", "11:00", "15:00", "23:59"]) assert.equal((await tick("2026-11-20", t)).started, 0, `nothing at ${t}`);
  const first = await briefsOn("2026-11-20");
  assert.equal(first.length, 1);
  assert.deepEqual([first[0].trigger, first[0].mode, first[0].status], ["schedule", "full", "ok"]);
  BriefData.parse(first[0].data);

  // The next day: the same, and its brief is full too (yesterday's ideas are read without error).
  assert.equal((await tick("2026-11-21", "06:59")).started, 0);
  assert.equal((await tick("2026-11-21", "07:00")).started, 1);
  assert.equal((await tick("2026-11-21", "08:00")).started, 0);
  assert.deepEqual((await briefsOn("2026-11-21")).map((b) => b.mode), ["full"]);

  // Asleep from before 07:00 until 09:12: one run on the first tick after waking, none after.
  assert.equal((await tick("2026-11-22", "09:12")).started, 1);
  assert.equal((await tick("2026-11-22", "09:13")).started, 0);
  assert.equal((await tick("2026-11-22", "10:30")).started, 0);
  assert.deepEqual((await briefsOn("2026-11-22")).map((b) => b.mode), ["full"]);
  assert.deepEqual(
    spawned.map((s) => s.at),
    [at("2026-11-20", "07:00"), at("2026-11-20", "07:00"), at("2026-11-21", "07:00"), at("2026-11-21", "07:00"), at("2026-11-22", "09:12"), at("2026-11-22", "09:12")].map((d) => d.toISOString()),
    "pass A and pass B once a day",
  );
});

test("check 1: run_at moves the start; brief_settings.enabled off means no scheduled run", async () => {
  await saveBriefSettings(db, { run_at: "08:30" });
  assert.equal((await tick("2026-11-23", "08:29")).started, 0);
  assert.equal((await tick("2026-11-23", "08:30")).started, 1);
  await saveBriefSettings(db, { enabled: false });
  for (const t of ["07:00", "09:00", "12:00"]) assert.equal((await tick("2026-11-24", t)).started, 0);
  assert.equal((await briefsOn("2026-11-24")).length, 0);
});

test("check 2: a build live 06:50-08:40: the brief waits with the slot reserved, no new run starts, then runs right after 08:40", async () => {
  live = [{ runId: "taller-build", role: "taller" }];
  assert.equal((await tick("2026-11-25", "06:50")).started, 0, "before run_at");
  assert.equal((await tick("2026-11-25", "07:00", false)).started, 1);
  await until(() => runner.slotReservation() !== null, "the reservation");
  const runId = schedule.scheduledRunId();
  assert.equal(await runStatus(runId), "waiting");
  assert.equal(runner.slotReservation()?.label, "morning-brief", "the brief reservation is up");

  // A Taller run queued meanwhile stays queued: drainQueue starts nothing while the reservation is up.
  const ids = (await raw.query(`select a.id as agent, p.id as project from agents a, projects p where a.slug like 'taller%' and p.slug = 'micasa' order by a.slug limit 1`)).rows[0];
  const queued = (await raw.query(`insert into agent_runs (agent_id, project_id, role, status, queued_at, summary) values ($1, $2, 'taller', 'queued', now(), 'queued: test') returning id`, [ids.agent, ids.project])).rows[0].id;
  const realSpawns: string[] = [];
  for (const t of ["07:30", "08:00", "08:39"]) {
    clock = at("2026-11-25", t);
    assert.deepEqual(await schedule.scheduledBrief(db, clock, deps), { started: 0, fallback: 0, ceiling: 0, waiting: 0 }, `still waiting at ${t}`);
    const drained = await runner.drainQueue(db, clock, { spawn: (() => { realSpawns.push(t); throw new Error("no spawn in tests"); }) as never });
    assert.equal(drained.started, 0);
    await settleLoop();
    assert.equal(await runStatus(runId), "waiting");
  }
  assert.deepEqual(realSpawns, []);
  assert.equal((await raw.query(`select status from agent_runs where id = $1`, [queued])).rows[0].status, "queued", "no new Taller run started in between");
  assert.equal(spawned.length, 0, "no brief pass while the build runs");

  // 08:40: the build ends; the brief starts on the next poll, before anything else.
  clock = at("2026-11-25", "08:40");
  live = [];
  const res = await schedule.waitForScheduledBrief();
  assert.equal(res?.status, "ok");
  assert.deepEqual(spawned.map((s) => s.at), [clock.toISOString(), clock.toISOString()], "brief and ideas at 08:40");
  assert.equal(runner.slotReservation(), null, "the slot is released after pass B");
  assert.deepEqual((await briefsOn("2026-11-25")).map((b) => b.mode), ["full"]);
  await raw.query(`delete from agent_runs where id = $1`, [queued]);
});

const crossItems = (data: { items: { app: string; title: string; detail?: string }[] }) => data.items.filter((i) => i.app === "cross");

test("check 3: a build live until 11:05: a facts-only brief at 11:00 with one cross item, and no Claude brief that day", async () => {
  live = [{ runId: "long-build", role: "taller" }];
  assert.equal((await tick("2026-11-26", "07:00", false)).started, 1);
  await settleLoop();
  for (const t of ["09:00", "10:59"]) assert.equal((await tick("2026-11-26", t, false)).ceiling, 0, `no ceiling at ${t}`);
  await settleLoop();
  assert.equal(await runStatus(schedule.scheduledRunId()), "waiting");

  const out = await tick("2026-11-26", "11:00", false);
  assert.equal(out.ceiling, 1);
  const res = await schedule.waitForScheduledBrief();
  assert.equal(res?.status, "fallback");
  assert.equal(res?.mode, "facts_only");
  const [b] = await briefsOn("2026-11-26");
  assert.deepEqual([b.mode, b.status], ["facts_only", "fallback"]);
  const cross = crossItems(BriefData.parse(b.data));
  assert.equal(cross.length, 1, "one cross item");
  assert.match(`${cross[0]!.title} ${cross[0]!.detail}`, /didn't run by 11:00 because a build was still running/);
  assert.match(`${cross[0]!.detail}`, /Corren 4 proyectos/, "the buildBrief() lines are in it");
  assert.equal(runner.slotReservation(), null, "the reservation is dropped");

  // The build ends at 11:05; no automatic Claude brief runs later that day.
  live = [];
  for (const t of ["11:05", "11:06", "13:00", "18:00", "23:59"]) assert.equal((await tick("2026-11-26", t)).started, 0, `nothing at ${t}`);
  assert.equal(spawned.length, 0, "no Claude pass that day");
  assert.equal((await briefsOn("2026-11-26")).length, 1);
});

test("check 3: fallback_at 12:00 moves the ceiling", async () => {
  await saveBriefSettings(db, { fallback_at: "12:00" });
  live = [{ runId: "long-build", role: "taller" }];
  assert.equal((await tick("2026-11-27", "07:00", false)).started, 1);
  await settleLoop();
  assert.equal((await tick("2026-11-27", "11:00", false)).ceiling, 0, "11:00 is not the ceiling any more");
  await settleLoop();
  assert.equal(await runStatus(schedule.scheduledRunId()), "waiting");
  assert.equal((await tick("2026-11-27", "11:59", false)).ceiling, 0);
  assert.equal((await tick("2026-11-27", "12:00", false)).ceiling, 1);
  await schedule.waitForScheduledBrief();
  const [b] = await briefsOn("2026-11-27");
  assert.equal(b.mode, "facts_only");
  assert.match(JSON.stringify(crossItems(b.data)), /didn't run by 12:00/);
  live = [];
  assert.equal((await tick("2026-11-27", "12:30")).started, 0);
  assert.equal(spawned.length, 0);
});

test("asleep past fallback_at: a facts-only brief on the first tick, once; the plan guard at its limit waits until fallback_at", async () => {
  // Asleep until 11:30.
  const late = await tick("2026-11-28", "11:30");
  assert.deepEqual([late.started, late.fallback], [1, 1]);
  assert.equal((await tick("2026-11-28", "12:00")).started, 0);
  const [b] = await briefsOn("2026-11-28");
  assert.equal(b.mode, "facts_only");
  assert.equal(spawned.length, 0);

  // The plan guard: a reading at 95 % stops the start (waiting), and fallback_at gives the facts-only brief.
  for (const t of ["07:00", "09:00", "10:59"]) {
    // A fresh reading each time (an old one reads as unknown, which does not stop a run).
    await raw.query(`insert into plan_readings (at, source, status, five_hour_pct, five_hour_resets_at) values ($1, 'stream', 'allowed', 95, $2)`, [at("2026-11-29", t), at("2026-11-29", "12:00")]);
    const out = await tick("2026-11-29", t);
    assert.deepEqual([out.started, out.waiting], [0, 1], `waiting on the plan guard at ${t}`);
  }
  await raw.query(`insert into plan_readings (at, source, status, five_hour_pct, five_hour_resets_at) values ($1, 'stream', 'allowed', 95, $2)`, [at("2026-11-29", "11:00"), at("2026-11-29", "12:00")]);
  const fb = await tick("2026-11-29", "11:00");
  assert.deepEqual([fb.started, fb.fallback], [1, 1]);
  const [g] = await briefsOn("2026-11-29");
  assert.equal(g.mode, "facts_only");
  assert.match(JSON.stringify(crossItems(g.data)), /Claude usage is at its limit \(95 %\)/);
  assert.equal(spawned.length, 0);
});

test("a Generate now brief since run_at counts as today's; one before run_at does not", async () => {
  const { runBrief } = await import("../src/brief/pipeline.js");
  clock = at("2026-11-30", "06:30");
  await runBrief(db, { trigger: "manual" }, deps.brief);
  assert.equal((await tick("2026-11-30", "07:00")).started, 1, "a 06:30 manual brief does not count");
  clock = at("2026-12-01", "07:00");
  // 07:00 on 12-01: a manual run started first (as if pressed at 06:59 and stored at 07:00).
  await runBrief(db, { trigger: "manual" }, deps.brief);
  assert.equal((await tick("2026-12-01", "07:01")).started, 0, "today's brief already exists");
  assert.deepEqual((await briefsOn("2026-12-01")).map((b) => b.trigger), ["manual"]);
});
