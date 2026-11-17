// PLA-I49-5: the brief's wake actions (Give to PO, Start now, Start building) through POST /api/brief/act with the
// session cookie: who wakes and about how long before (GET state), and the run's state on the row after. Throwaway
// plania_test_<hash> database; every process is a fake child; nothing reaches a real claude or repo.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { after, before, beforeEach, test } from "node:test";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
process.env.PLANIA_EVENT_WAKES = "1";
process.env.PLANIA_TZ = "America/Mexico_City";
process.env.PLANIA_HOME_PROJECT = "workia";
process.env.PLANIA_PROMPTS_PROJECT = "micasa";
const { app } = await import("../src/app.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const { makeDb } = await import("../src/db/client.js");
const { seedOrg } = await import("../scripts/seed-org.js");
const { createTask } = await import("../src/mcp/writes.js");
const { saveBriefSettings } = await import("../src/brief/settings.js");
const { wakeDeps } = await import("../src/brief/actions.js");
const { setProjectPaused } = await import("../src/runner/company.js");
const { resetRunnerForTests } = await import("../src/runner/runner.js");

type Json = Record<string, any>;
let raw: pg.Client;
let db: ReturnType<typeof makeDb>["db"];
let closeDb: () => Promise<void>;
const scratch = mkdtempSync(path.join(tmpdir(), "plania-brief-wake-"));
const ctx = { actor: { agent: "po-workia", session_id: "s-po", machine: "ci" } };
const cookie = () => ({ Cookie: `${SESSION_COOKIE}=${createSession()}`, "Content-Type": "application/json" });
let n = 0;
const rid = () => `wake-${Date.now()}-${(n += 1)}`;
let briefId = "";
async function act(item: string, action: string, extra: Json = {}) {
  const res = await app.request("/api/brief/act", { method: "POST", headers: cookie(), body: JSON.stringify({ brief_id: briefId, item_id: item, action, request_id: rid(), ...extra }) });
  return { http: res.status, body: (await res.json()) as Json };
}
const state = async () => ((await (await app.request(`/api/brief/${briefId}/state`, { headers: cookie() })).json()) as Json).items as Record<string, Json>;
const runsOf = async (agent: string) => (await raw.query(`select r.status, r.task_key, r.summary from agent_runs r join agents a on a.id = r.agent_id where a.slug = $1 order by r.queued_at`, [agent])).rows;

class FakeChild extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  constructor(readonly pid: number) {
    super();
    // The run ends at once, as a successful claude would.
    setImmediate(() => {
      const result = { type: "result", subtype: "success", is_error: false, num_turns: 1, session_id: "sess-wake", result: "OK", modelUsage: {} };
      this.stdout.write(`${JSON.stringify(result)}\n`);
      this.stdout.end();
      this.stderr.end();
      setImmediate(() => this.emit("exit", 0, null));
    });
  }
}
const spawned: string[][] = [];
wakeDeps.heartbeat = {
  runner: {
    env: { HOME: scratch, PATH: "/usr/bin:/bin", PLANIA_RUNNER_TOKEN: "runner-token", PLANIA_PROMPTS_PROJECT: "micasa", CLAUDE_CODE_BIN: "/fake/bin/claude" } as NodeJS.ProcessEnv,
    logDir: path.join(scratch, "logs"),
    tmpDir: path.join(scratch, "tmp"),
    worktreeRoot: path.join(scratch, "worktrees"),
    graceMs: 10,
    liveFlushMs: 0,
    footprints: false,
    git: async () => ({ code: 0, stdout: "", stderr: "" }),
    spawn: (_c: string, args: string[]) => {
      spawned.push(args);
      return new FakeChild(60_000 + spawned.length) as never;
    },
    kill: () => undefined,
    reportTokens: async () => undefined,
    probeUsage: async () => null,
  } as never,
};

const I = {
  give: "i|workia|0000000000a1",
  givePaused: "i|micasa|0000000000a2",
  start: "i|workia|0000000000a3",
  startPaused: "i|micasa|0000000000a4",
  build: "i|workia|0000000000a5",
  cross: "i|cross|0000000000a6",
};
const keys: Record<string, string> = {};

before(async () => {
  raw = await resetTestDb();
  ({ db, close: closeDb } = makeDb());
  await seedOrg(db);
  await saveBriefSettings(db, { github_mode: "off" });
  await raw.query(`update projects set runs_paused = false where slug <> 'micasa'`);
  await raw.query(`update projects set runs_paused = true where slug = 'micasa'`);
  await raw.query(`update runner_settings set company_paused = false, max_concurrent = 2, cooldown_minutes = 0`);
  await raw.query(`insert into plan_readings (source, status, five_hour_pct, five_hour_resets_at) values ('stream', 'allowed', 5, now() + interval '3 hours')`);
  keys.start = ((await createTask(db, { project: "workia", title: "Fix expediente crash", scope: "s", checks: ["c"], status: "Ready" } as never, ctx)) as { key: string }).key;
  keys.startPaused = ((await createTask(db, { project: "micasa", title: "Programados kit", scope: "s", checks: ["c"], status: "Ready" } as never, ctx)) as { key: string }).key;
  keys.ini = ((await createTask(db, { project: "workia", kind: "initiative", title: "Payroll", scope: "PRD" } as never, ctx)) as { key: string }).key;
  for (const [phase, title, status] of [[1, "Pay slip model", "Backlog"], [1, "Pay slip email", "Backlog"], [2, "Pay slip history", "Backlog"], [3, "Pay slip export", "Backlog"]] as const) {
    const k = ((await createTask(db, { project: "workia", title, scope: "s", checks: ["c"], parent_key: keys.ini, phase, status } as never, ctx)) as { key: string }).key;
    keys[`p${phase}-${title}`] = k;
  }
  const t = (kind: string, project: string, key?: string) => [{ kind, project, ...(key ? { key } : {}) }];
  const data = {
    ...JSON.parse(readFileSync(new URL("./fixtures/brief-sample.json", import.meta.url), "utf8")),
    version: 2,
    items: [
      { id: I.give, app: "workia", status: "needs_you", title: "Decide the renewal notice", detail: "The PO has a draft.", ref: "WRK-I14" },
      { id: I.givePaused, app: "micasa", status: "needs_you", title: "Reconcile the MiCasa release" },
      { id: I.start, app: "workia", status: "next", ref: keys.start, title: "Fix expediente crash", targets: t("ticket", "workia", keys.start) },
      { id: I.startPaused, app: "micasa", status: "next", ref: keys.startPaused, title: "Programados kit", targets: t("ticket", "micasa", keys.startPaused) },
      { id: I.build, app: "workia", status: "next", ref: keys.ini, title: "Payroll is planned and waiting", targets: t("initiative", "workia", keys.ini) },
      { id: I.cross, app: "cross", status: "needs_you", title: "Close the leftover PRs" },
    ],
  };
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date());
  briefId = (await raw.query(`insert into morning_briefs (local_date, generated_at, trigger, mode, data) values ($1, now(), 'manual', 'full', $2) returning id`, [today, JSON.stringify(data)])).rows[0].id;
});

beforeEach(() => resetRunnerForTests());

after(async () => {
  wakeDeps.heartbeat = undefined;
  await closeDb?.();
  await raw?.end();
  rmSync(scratch, { recursive: true, force: true });
});

test("before a wake: GET state says who wakes, about how long, and whether the project is paused", async () => {
  const s = await state();
  const give = s[I.give]!.actions.find((a: Json) => a.id === "give_to_po");
  assert.equal(give.level, "wake");
  assert.deepEqual([give.wake.agent, give.wake.role, give.wake.low, give.wake.high, give.wake.paused], ["po-workia", "product-owner", 10, 25, false]);
  const start = s[I.start]!.actions.find((a: Json) => a.id === "start_now");
  assert.deepEqual([start.wake.agent, start.wake.role, start.wake.paused], ["taller-workia", "taller", false]);
  const build = s[I.build]!.actions.find((a: Json) => a.id === "start_building");
  assert.equal(build.wake.agent, "taller-workia");
  assert.equal(s[I.cross]!.actions.find((a: Json) => a.id === "give_to_po").wake.agent, "po-workia", "a cross row goes to the home project's PO");
  // A paused project's Ready ticket: no Start now; Turn on runs instead; Give to PO says it waits.
  const paused = s[I.startPaused]!.actions.map((a: Json) => a.id);
  assert.ok(!paused.includes("start_now"));
  assert.ok(paused.includes("resume_runs"));
  assert.equal(s[I.givePaused]!.actions.find((a: Json) => a.id === "give_to_po").wake.paused, true);
});

test("check 2: Give to PO creates exactly one Ready PO ticket, origin jorge, and one queued wake with the brief's reason", async () => {
  const before = (await raw.query(`select count(*)::int as n from tasks`)).rows[0].n;
  const a = await act(I.give, "give_to_po", { input: { note: "Keep it short" } });
  assert.equal(a.body.status, "done", JSON.stringify(a.body));
  const key = a.body.state.line.match(/WRK-\d+/)?.[0];
  assert.ok(key, a.body.state.line);
  assert.equal((await raw.query(`select count(*)::int as n from tasks`)).rows[0].n, before + 1);
  const [t] = (await raw.query(`select t.status, t.origin, t.scope, a.slug as owner from tasks t join agents a on a.id = t.owner_agent where t.key = $1`, [key])).rows;
  assert.deepEqual([t.status, t.origin, t.owner], ["Ready", "jorge", "po-workia"]);
  assert.match(t.scope, /Decide the renewal notice[\s\S]*The PO has a draft[\s\S]*Keep it short/);
  const runs = (await runsOf("po-workia")).filter((r) => r.task_key === key);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].status, "queued");
  assert.match(runs[0].summary, /order from the morning brief: Decide the renewal notice/);
  // The row follows the order: queued, then done.
  assert.match(a.body.state.line, /po-workia queued/);
  await raw.query(`update agent_runs set status = 'ok', summary = 'Planned in WRK-I20' where task_key = $1`, [key]);
  assert.match((await state())[I.give]!.line, /po-workia done: Planned in WRK-I20/);
  await raw.query(`update agent_runs set status = 'fail', summary = 'Ran out of turns' where task_key = $1`, [key]);
  assert.match((await state())[I.give]!.line, /po-workia failed: Ran out of turns/);
});

test("busy PO (PLA-I60): Give to PO while the PO is busy makes the ticket and queues its own run; the seat's cap decides when it starts", async () => {
  // po-workia still has a run on the earlier order: mark it running.
  await raw.query(`update agent_runs set status = 'running' where agent_id = (select id from agents where slug = 'po-workia')`);
  const a = await act(I.cross, "give_to_po");
  assert.equal(a.body.status, "done", JSON.stringify(a.body));
  const key = a.body.state.line.match(/WRK-\d+/)?.[0];
  assert.equal((await raw.query(`select status from tasks where key = $1`, [key])).rows[0].status, "Ready", "the order waits Ready until the PO's run on it starts");
  const mine = (await runsOf("po-workia")).filter((r) => r.task_key === key);
  assert.deepEqual(mine.map((r) => r.status), ["queued"], "a work item of its own: queued, not coalesced into the running one");
  assert.match(a.body.state.line, new RegExp(`${key} · po-workia queued`));
  await raw.query(`update agent_runs set status = 'ok' where agent_id = (select id from agents where slug = 'po-workia')`);
});

test("check 4: a paused project gets no wake until it is resumed, then exactly one", async () => {
  const a = await act(I.givePaused, "give_to_po");
  assert.equal(a.body.status, "done", JSON.stringify(a.body));
  const key = a.body.state.line.match(/MIC-\d+/)?.[0];
  assert.ok(key);
  assert.equal((await runsOf("po-micasa")).length, 0, "no wake while paused");
  assert.equal((await raw.query(`select count(*)::int as n from thread_messages`)).rows[0].n, 0, "no message either");
  await setProjectPaused(db, "micasa", false);
  const runs = await runsOf("po-micasa");
  assert.equal(runs.length, 1, "resuming wakes the PO once");
  assert.equal(runs[0].status, "queued");
  await raw.query(`update projects set runs_paused = true where slug = 'micasa'`);
});

test("failed: Start now that cannot start says why, records the failure and leaves the row open", async () => {
  const f = await act(I.start, "start_now");
  assert.equal(f.http, 409);
  assert.equal(f.body.status, "failed");
  assert.match(f.body.hint, /no prompt doc/);
  assert.equal((await state())[I.start]!.state, "open");
});

test("Start now: the ticket's owner starts at once with the reason; a paused project refuses with a state, not an error", async () => {
  await raw.query(`insert into docs (project_id, title, markdown, actor) select id, 'Prompt: Taller', '# Taller', $1::jsonb from projects where slug = 'micasa'`, [JSON.stringify(ctx.actor)]);
  await raw.query(`delete from agent_runs where agent_id = (select id from agents where slug = 'taller-workia')`);
  const a = await act(I.start, "start_now");
  assert.equal(a.body.status, "done", JSON.stringify(a.body));
  assert.match(a.body.line, /taller-workia (started|queued)/);
  const runs = await runsOf("taller-workia");
  assert.equal(runs.length, 1);
  assert.ok(spawned.length, "a run started");
  assert.match(spawned.at(-1)!.join(" "), /Why you woke: started from the morning brief: WRK-\d+/, "the bot reads why it woke");
  const p = await act(I.startPaused, "start_now");
  assert.equal(p.body.status, "stale", "a paused project offers Turn on runs, not Start now");
});

test("check 3: Start building moves only the first open phase to Ready and nothing else", async () => {
  const before = (await raw.query(`select key, status from tasks where project_id = (select id from projects where slug = 'workia') order by key`)).rows;
  const a = await act(I.build, "start_building");
  assert.equal(a.body.status, "done", JSON.stringify(a.body));
  const after = (await raw.query(`select key, status from tasks where project_id = (select id from projects where slug = 'workia') order by key`)).rows;
  const moved = after.filter((r, i) => r.status !== before.find((b) => b.key === r.key)?.status || i < 0).map((r) => r.key).sort();
  assert.deepEqual(moved, [keys["p1-Pay slip email"], keys["p1-Pay slip model"]].sort());
  assert.equal(after.find((r) => r.key === keys["p2-Pay slip history"])!.status, "Backlog");
  assert.equal(after.find((r) => r.key === keys["p3-Pay slip export"])!.status, "Backlog");
  assert.equal((await act(I.build, "start_building")).body.status, "stale", "phase 1 is no longer in Backlog");
});

test("check 6: no ticket becomes Ready from a brief action other than start_now and start_building", async () => {
  // Every task.status → Ready event since the brief, by tool: only the brief's start_building, plus the PO
  // tickets Give to PO created (created Ready, not moved there).
  const rows = (await raw.query(`select e.payload, e.task_key, e.type from events e where e.type = 'task.status' and e.payload->>'to' = 'Ready'`)).rows;
  const moved = rows.map((r) => r.task_key).sort();
  assert.deepEqual(moved, [keys["p1-Pay slip email"], keys["p1-Pay slip model"]].sort());
});
