// PLA-I31-1: events wake the right role through the runner's queue; the cadence stays as fallback.
// Fake children, fake git, fake GitHub; throwaway DB (test/helpers.ts). No real claude.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { after, before, beforeEach, test } from "node:test";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
process.env.PLANIA_EVENT_WAKES = "1";
const { makeDb } = await import("../src/db/client.js");
const { seedLegacyOrg: seedOrg } = await import("./fixtures/legacy-org.js");
const writes = await import("../src/mcp/writes.js");
const questions = await import("../src/mcp/questions.js");
const { attachDoc } = await import("../src/mcp/docs.js");
const { webCtx } = await import("../src/mcp/tx.js");
const { pollGithubProject } = await import("../src/jobs/github.js");
const { runHeartbeat } = await import("../src/jobs/heartbeat.js");
const runner = await import("../src/runner/runner.js");
const events = await import("../src/runner/events.js");
const { setCompanyPaused, setProjectPaused } = await import("../src/runner/company.js");

type Db = ReturnType<typeof makeDb>["db"];
let raw: pg.Client;
let db: Db;
let closeDb: () => Promise<void>;
const scratch = mkdtempSync(path.join(tmpdir(), "plania-i31-events-"));
const repo = path.join(scratch, "repos", "micasa");
const wtRoot = path.join(scratch, "worktrees");
const ctx = { actor: { agent: "test-agent", session_id: "s-i31" } };

class FakeChild extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  constructor(readonly pid: number) {
    super();
  }
  finish(): void {
    this.stdout.write(`${JSON.stringify({ type: "result", subtype: "success", is_error: false, num_turns: 1, session_id: "sess-ev", modelUsage: { m: { inputTokens: 1, outputTokens: 1, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 } } })}\n`);
    this.stdout.end();
    setImmediate(() => this.emit("exit", 0, null));
  }
}

function fakes() {
  const spawned: FakeChild[] = [];
  let pid = 50_000;
  const deps = {
    env: { HOME: scratch, PATH: "/usr/bin:/bin", PLANIA_RUNNER_TOKEN: "runner-token", PLANIA_PROMPTS_PROJECT: "micasa", CLAUDE_CODE_BIN: "/fake/bin/claude" } as NodeJS.ProcessEnv,
    logDir: path.join(scratch, "logs"),
    tmpDir: path.join(scratch, "tmp"),
    worktreeRoot: wtRoot,
    graceMs: 10,
    liveFlushMs: 0,
    footprints: false,
    git: async (args: string[]) => {
      if (args[0] === "worktree" && args[1] === "add") mkdirSync(args.find((a) => a.startsWith(wtRoot))!, { recursive: true });
      if (args[0] === "rev-parse" && args[1] === "--verify") return { code: 1, stdout: "", stderr: "" };
      return { code: 0, stdout: "", stderr: "" };
    },
    spawn: () => {
      const child = new FakeChild(++pid);
      spawned.push(child);
      return child;
    },
    kill: () => undefined,
    reportTokens: async () => undefined,
    probeUsage: async () => null,
  };
  return { deps, spawned };
}

function fakeFetch(routes: Record<string, unknown>) {
  return async (url: string) => {
    const p = url.replace(/^https:\/\/api\.github\.com/, "");
    const hit = Object.entries(routes).find(([prefix]) => p.startsWith(prefix));
    if (!hit) return { status: 404, headers: { get: () => null }, json: async () => ({}) };
    return { status: 200, headers: { get: () => null }, json: async () => hit[1] };
  };
}

async function id(table: "agents" | "projects", slug: string): Promise<string> {
  return (await raw.query(`select id from ${table} where slug = $1`, [slug])).rows[0].id as string;
}

// Queued or running runner rows, per agent slug.
async function wakes(): Promise<{ agent: string; task_key: string | null; status: string; summary: string }[]> {
  return (
    await raw.query(
      `select a.slug as agent, r.task_key, r.status, r.summary from agent_runs r join agents a on a.id = r.agent_id
       where r.status in ('queued', 'running') order by r.queued_at, a.slug`,
    )
  ).rows;
}

async function backlog(key: string, extra: Record<string, unknown> = {}): Promise<void> {
  await writes.createTask(db, { project: "micasa", key, title: `Ticket ${key}`, scope: "Scope", checks: ["Done"], ...extra } as never, ctx);
}
const toReady = async (key: string) => {
  const { version } = (await raw.query(`select version from tasks where key = $1`, [key])).rows[0];
  return writes.setTask(db, { project: "micasa", key, status: "Ready", version } as never, ctx);
};

before(async () => {
  raw = await resetTestDb();
  ({ db, close: closeDb } = makeDb());
  await seedOrg(db);
  mkdirSync(repo, { recursive: true });
  await raw.query(`update agents set heartbeat_minutes = null, adapter = 'none', adapter_config = '{}'::jsonb`);
  await raw.query(`update agents set adapter = 'claude_code' where slug in ('housi', 'taller', 'research', 'artist', 'asistente')`);
  await raw.query(`update projects set settings = jsonb_build_object('local', jsonb_build_object('repo_path', $1::text), 'github', jsonb_build_object('repo', 'acme/micasa')) where slug = 'micasa'`, [repo]);
  const actor = JSON.stringify({ agent: "test", session_id: "s" });
  for (const title of ["Prompt: Product owner", "Prompt: Taller", "Prompt: Research", "Prompt: Artist", "Prompt: Asistente"]) {
    await raw.query(`insert into docs (project_id, title, markdown, actor) values ($1, $2, $3, $4)`, [await id("projects", "micasa"), title, `# ${title}`, actor]);
  }
  await raw.query(`insert into goals (project_id, title) values ($1, 'Ship the MiCasa beta')`, [await id("projects", "micasa")]);
});

beforeEach(async () => {
  await runner.waitForAllRuns();
  runner.resetRunnerForTests();
  await raw.query(`delete from agent_runs`);
  await raw.query(`delete from heartbeat_runs`);
  await raw.query(`delete from token_budgets`);
  await raw.query(`update runner_settings set company_paused = false, max_concurrent = 1, cooldown_minutes = 0, plan_guard_pct = 70, reserve_tokens = 1000`);
  await raw.query(`update projects set runs_paused = false where slug = 'micasa'`);
  await raw.query(`update projects set runs_paused = true where slug <> 'micasa'`);
  for (const role of ["product-owner", "taller", "research", "artist", "asistente"]) {
    await raw.query(`insert into token_budgets (scope, role, weekly_limit) values ('role', $1, 10000000)`, [role]);
  }
  await raw.query(`insert into token_budgets (scope, project_id, weekly_limit) values ('project', $1, 10000000)`, [await id("projects", "micasa")]);
  await raw.query(`delete from plan_readings`);
  await raw.query(`insert into plan_readings (at, source, status, five_hour_pct, seven_day_pct, five_hour_resets_at) values (now(), 'stream', 'allowed', 10, 19, now() + interval '3 hours')`);
});

after(async () => {
  await runner.waitForAllRuns();
  await closeDb?.();
  await raw?.end();
  rmSync(scratch, { recursive: true, force: true });
});

test("I31-1 #1a: a ticket moving to Ready queues exactly one wake, for Taller, on that ticket", async () => {
  // Created straight into Ready is not a move: nothing queued.
  await backlog("EV-NEW", { status: "Ready" });
  assert.deepEqual(await wakes(), []);
  await backlog("EV-READY");
  await toReady("EV-READY");
  const w = await wakes();
  assert.equal(w.length, 1);
  assert.deepEqual({ agent: w[0]!.agent, task: w[0]!.task_key, status: w[0]!.status }, { agent: "taller", task: "EV-READY", status: "queued" });
  assert.match(w[0]!.summary, /^queued: event ticket ready$/);
  const logged = (await raw.query(`select payload from events where type = 'wake.queued' and task_key = 'EV-READY'`)).rows;
  assert.equal(logged.length, 1);
  assert.equal(logged[0].payload.agent, "taller");
  // A [PRUEBA] ticket and a ticket owned by another agent wake nobody.
  await raw.query(`delete from agent_runs`);
  await backlog("EV-PRUEBA", { title: "[PRUEBA] nada" });
  await toReady("EV-PRUEBA");
  await backlog("EV-OWNED", { owner_agent: "research" });
  await toReady("EV-OWNED");
  assert.deepEqual(await wakes(), []);
});

test("I31-1 #1b: a question answered wakes whoever asked it (a runner session, or a roster slug)", async () => {
  await backlog("EV-ASK");
  // housi (PO) asked from a runner session run-<8 hex of its run id>.
  const [run] = (
    await raw.query(
      `insert into agent_runs (agent_id, project_id, role, status, started_at, ended_at, queued_at)
       values ($1, $2, 'product-owner', 'ok', now() - interval '2 hours', now() - interval '2 hours', now() - interval '2 hours') returning id`,
      [await id("agents", "housi"), await id("projects", "micasa")],
    )
  ).rows;
  const asked = (await questions.ask(db, { project: "micasa", key: "EV-ASK", question: "¿A o B?" }, { actor: { agent: "Claude Code", session_id: `run-${String(run.id).slice(0, 8)}` } })) as { question_id: string };
  // PLA-I32-5: a PO's question goes to Asistente first.
  assert.deepEqual((await wakes()).map((x) => [x.agent, x.task_key, x.summary]), [["asistente", "EV-ASK", "queued: event question from housi"]]);
  await raw.query(`delete from agent_runs where status = 'queued'`);
  await questions.answer(db, { project: "micasa", question_id: asked.question_id, answer: "A" }, webCtx);
  let w = await wakes();
  assert.equal(w.length, 1);
  assert.deepEqual({ agent: w[0]!.agent, task: w[0]!.task_key }, { agent: "housi", task: "EV-ASK" });
  assert.match(w[0]!.summary, /question answered/);

  // An asker named by its roster slug.
  await raw.query(`delete from agent_runs`);
  await backlog("EV-ASK2");
  const q2 = (await questions.ask(db, { project: "micasa", key: "EV-ASK2", question: "¿Fuente?" }, { actor: { agent: "research", session_id: "r1" } })) as { question_id: string };
  await questions.answer(db, { project: "micasa", question_id: q2.question_id, answer: "La primera" }, webCtx);
  w = await wakes();
  assert.equal(w.length, 1);
  assert.equal(w[0]!.agent, "research");

  // An asker that is not on the roster wakes nobody.
  await raw.query(`delete from agent_runs`);
  await backlog("EV-ASK3");
  const q3 = (await questions.ask(db, { project: "micasa", key: "EV-ASK3", question: "¿?" }, { actor: { agent: "Cursor", session_id: "c1" } })) as { question_id: string };
  await questions.answer(db, { project: "micasa", question_id: q3.question_id, answer: "Sí" }, webCtx);
  assert.deepEqual(await wakes(), []);
});

const pr = (number: number, key: string, sha: string) => ({
  number,
  html_url: `https://github.com/acme/micasa/pull/${number}`,
  title: `PR ${number}`,
  state: "open",
  body: `Plania: ${key}`,
  merged_at: null,
  merge_commit_sha: null,
  updated_at: new Date().toISOString(),
  head: { sha, ref: `jl/${key.toLowerCase()}` },
  base: { ref: "sandbox" },
});

async function inReview(key: string, number: number): Promise<void> {
  await backlog(key);
  await raw.query(`update tasks set status = 'In review', pr_url = $2 where key = $1`, [key, `https://github.com/acme/micasa/pull/${number}`]);
}

test("I31-1 #1c: a PR review asking for changes wakes Taller once, on the PR's ticket", async () => {
  await inReview("EV-REV", 11);
  const fetch = fakeFetch({
    "/repos/acme/micasa/pulls?": [pr(11, "EV-REV", "a".repeat(40))],
    "/repos/acme/micasa/pulls/11/reviews": [
      { id: 901, state: "APPROVED", submitted_at: "2026-11-08T07:00:00Z" },
      { id: 902, state: "CHANGES_REQUESTED", submitted_at: "2026-11-08T08:00:00Z" },
    ],
    "/repos/acme/micasa/commits/": { check_runs: [] },
  });
  const p = (await raw.query(`select * from projects where slug = 'micasa'`)).rows[0];
  const project = { ...p, settings: p.settings, keyPrefix: p.key_prefix };
  const s = await pollGithubProject(db, project as never, { fetch: fetch as never, env: { GITHUB_TOKEN: "ghp_test" } });
  assert.equal(s.reviews, 1);
  const w = await wakes();
  assert.equal(w.length, 1);
  assert.deepEqual({ agent: w[0]!.agent, task: w[0]!.task_key }, { agent: "taller", task: "EV-REV" });
  assert.match(w[0]!.summary, /pr review/);
  assert.equal((await raw.query(`select count(*)::int as n from events where type = 'pr.reviewed' and task_key = 'EV-REV'`)).rows[0].n, 1);
});

test("I31-1 #1c: CI red wakes Taller once, even though the ticket also moves back to Ready", async () => {
  await inReview("EV-CI", 12);
  const fetch = fakeFetch({
    "/repos/acme/micasa/pulls?": [pr(12, "EV-CI", "b".repeat(40))],
    "/repos/acme/micasa/commits/": { check_runs: [{ name: "test", status: "completed", conclusion: "failure", html_url: "https://ci/1", head_sha: "b".repeat(40) }] },
  });
  const p = (await raw.query(`select * from projects where slug = 'micasa'`)).rows[0];
  await pollGithubProject(db, { ...p, keyPrefix: p.key_prefix } as never, { fetch: fetch as never, env: { GITHUB_TOKEN: "ghp_test" } });
  assert.equal((await raw.query(`select status from tasks where key = 'EV-CI'`)).rows[0].status, "Ready");
  const w = await wakes();
  assert.equal(w.length, 1);
  assert.deepEqual({ agent: w[0]!.agent, task: w[0]!.task_key }, { agent: "taller", task: "EV-CI" });
  assert.match(w[0]!.summary, /ci red/);
});

test("I31-1 #1d: an idea moving to research wakes Research; to design wakes Artist", async () => {
  const made = (await writes.createTask(db, { project: "micasa", kind: "idea", title: "Una idea" } as never, ctx)) as { key: string };
  const key = made.key;
  await attachDoc(db, { project: "micasa", key, title: "Idea", markdown: "# Idea\n## Problem\nx\n## Who it is for\ny\n## Why now\nz" }, ctx);
  let t = (await raw.query(`select version from tasks where key = $1`, [key])).rows[0];
  await writes.setTask(db, { project: "micasa", key, stage: "research", version: t.version } as never, ctx);
  let w = await wakes();
  assert.equal(w.length, 1);
  assert.deepEqual({ agent: w[0]!.agent, task: w[0]!.task_key }, { agent: "research", task: key });
  assert.match(w[0]!.summary, /idea stage research/);

  await raw.query(`delete from agent_runs`);
  await attachDoc(db, { project: "micasa", key, title: "Research", markdown: "# R\n## What we learned\nx\n## Options\ny\n## Recommendation\nz" }, ctx);
  t = (await raw.query(`select version from tasks where key = $1`, [key])).rows[0];
  await writes.setTask(db, { project: "micasa", key, stage: "design", version: t.version } as never, ctx);
  w = await wakes();
  assert.equal(w.length, 1);
  assert.deepEqual({ agent: w[0]!.agent, task: w[0]!.task_key }, { agent: "artist", task: key });
});

test("I31-1 #2: 3 events inside the cooldown produce 1 run; the queue (cadence job) starts it after", async () => {
  await raw.query(`update runner_settings set cooldown_minutes = 30`);
  // Taller's last run ended a minute ago: the cooldown is on.
  await raw.query(
    `insert into agent_runs (agent_id, project_id, role, status, started_at, ended_at, queued_at, summary)
     values ($1, $2, 'taller', 'ok', now() - interval '5 minutes', now() - interval '1 minute', now() - interval '5 minutes', 'ok: seed')`,
    [await id("agents", "taller"), await id("projects", "micasa")],
  );
  for (const key of ["EV-C1", "EV-C2", "EV-C3"]) {
    await backlog(key);
    await toReady(key);
  }
  let w = await wakes();
  assert.equal(w.length, 1, "three events, one queued wake");
  assert.equal(w[0]!.task_key, "EV-C1");

  const f = fakes();
  // Inside the cooldown the queued wake waits (not dropped, not started).
  let drained = await runner.drainQueue(db, new Date(), f.deps as never);
  assert.deepEqual(drained, { started: 0, dropped: 0 });
  assert.equal(f.spawned.length, 0);
  assert.equal((await wakes())[0]!.status, "queued");

  // Cooldown over: the heartbeat job's drain starts it, once.
  await raw.query(`update agent_runs set ended_at = now() - interval '31 minutes' where summary = 'ok: seed'`);
  const counts = await runHeartbeat(db, new Date(), { runner: f.deps as never });
  assert.equal(counts.started_from_queue, 1);
  assert.equal(f.spawned.length, 1);
  f.spawned[0]!.finish();
  await runner.waitForAllRuns();

  // More events inside the new cooldown: still no second run.
  await backlog("EV-C4");
  await toReady("EV-C4");
  drained = await runner.drainQueue(db, new Date(), f.deps as never);
  assert.equal(drained.started, 0);
  assert.equal(f.spawned.length, 1);
  const runs = (await raw.query(`select count(*)::int as n from agent_runs r join agents a on a.id = r.agent_id where a.slug = 'taller' and r.status = 'ok' and r.summary <> 'ok: seed'`)).rows[0].n;
  assert.equal(runs, 1);
});

test("I31-1 #3: with the kill switch off, events enqueue nothing (company, project, and jobs off)", async () => {
  await setCompanyPaused(db, true);
  await backlog("EV-K1");
  await toReady("EV-K1");
  assert.deepEqual(await wakes(), []);
  await setCompanyPaused(db, false);

  await setProjectPaused(db, "micasa", true);
  await backlog("EV-K2");
  await toReady("EV-K2");
  assert.deepEqual(await wakes(), []);

  // Without the heartbeat job (PLANIA_JOBS unset) the hook queues nothing either.
  const t = (await raw.query(`select id, key from tasks where key = 'EV-K2'`)).rows[0];
  await raw.query(`update projects set runs_paused = false where slug = 'micasa'`);
  const pid = await id("projects", "micasa");
  const out = await db.transaction((tx) => events.onWriteEvent(tx as never, { id: pid, slug: "micasa" }, "task.status", t, { from: "Backlog", to: "Ready" }, {}));
  assert.equal(out, null);
  assert.equal(events.eventWakesEnabled({}), false);
  assert.equal(events.eventWakesEnabled({ PLANIA_JOBS: "1" }), true);
  assert.deepEqual(await wakes(), []);
});

test("I31-1: resuming a project queues its PO's first wake; a second event while queued coalesces", async () => {
  await raw.query(`update projects set runs_paused = true where slug = 'micasa'`);
  await setProjectPaused(db, "micasa", false);
  let w = await wakes();
  assert.equal(w.length, 1);
  assert.deepEqual({ agent: w[0]!.agent, task: w[0]!.task_key }, { agent: "housi", task: null });
  assert.match(w[0]!.summary, /project resumed/);
  // Coalescing: a question housi asked, answered now, writes nothing new while the wake is queued.
  await backlog("EV-CO");
  const q = (await questions.ask(db, { project: "micasa", key: "EV-CO", question: "¿?" }, { actor: { agent: "housi", session_id: "h1" } })) as { question_id: string };
  await questions.answer(db, { project: "micasa", question_id: q.question_id, answer: "Sí" }, webCtx);
  w = await wakes();
  assert.equal(w.filter((x) => x.agent === "housi").length, 1);
  assert.deepEqual(w.filter((x) => x.agent !== "housi").map((x) => x.agent), ["asistente"], "the question itself went to Asistente");
});

// ---- PLA-15: a ticket landing wakes Taller on the Ready ticket it was blocking.
// The steps of a plan are created Ready and wait on blocked_by, so no move to Ready ever wakes Taller on them.

const { addResult } = await import("../src/mcp/evidence.js");
let prNumber = 500;
const move = async (key: string, status: string) => {
  const { version } = (await raw.query(`select version from tasks where key = $1`, [key])).rows[0];
  return writes.setTask(db, { project: "micasa", key, status, version } as never, webCtx);
};
// In review with its PR, then Merged the way the screen moves it (no scan pass: PLA-20).
async function land(key: string): Promise<void> {
  const number = ++prNumber;
  const head = number.toString(16).padStart(40, "0");
  const url = `https://github.com/acme/micasa/pull/${number}`;
  const t = (await raw.query(`update tasks set status = 'In review', pr_url = $2 where key = $1 returning id`, [key, url])).rows[0];
  await raw.query(
    `insert into pull_requests (project_id, repo, number, url, title, task_id, state, head_sha, head_branch, base_branch)
     values ($1, 'acme/micasa', $2, $3, $4, $5, 'open', $6, $7, 'sandbox')`,
    [await id("projects", "micasa"), number, url, key, t.id, head, `jl/${key.toLowerCase()}`],
  );
  await addResult(db, { project: "micasa", key, kind: "unit", verdict: "pass", cite: "test", check_ns: [1] } as never, ctx);
  await move(key, "Merged");
}
const step = (key: string, blockedBy: unknown[], extra: Record<string, unknown> = {}) => backlog(key, { status: "Ready", blocked_by: blockedBy, ...extra });

test("PLA-15 #1: a ticket landing queues one Taller wake on the Ready ticket it was blocking", async () => {
  await backlog("LD-A1");
  await step("LD-A2", ["LD-A1"]);
  await step("LD-A3", ["LD-A2"]);
  assert.deepEqual(await wakes(), [], "steps created Ready wake nobody");

  await land("LD-A1");
  const w = await wakes();
  assert.equal(w.length, 1);
  assert.deepEqual({ agent: w[0]!.agent, task: w[0]!.task_key, status: w[0]!.status }, { agent: "taller", task: "LD-A2", status: "queued" });
  assert.equal(w[0]!.summary, "queued: event unblocked by LD-A1");
  const logged = (await raw.query(`select payload from events where type = 'wake.queued' and task_key = 'LD-A1'`)).rows;
  assert.equal(logged.length, 1);
  assert.deepEqual(
    { agent: logged[0].payload.agent, reason: logged[0].payload.reason, from: logged[0].payload.from_event },
    { agent: "taller", reason: "unblocked by LD-A1", from: "task.status" },
  );

  // #3: Merged → Released → Done is the same landing: no second wake.
  await raw.query(`delete from agent_runs`);
  await move("LD-A1", "Released");
  await move("LD-A1", "Done");
  assert.equal((await raw.query(`select status from tasks where key = 'LD-A1'`)).rows[0].status, "Done");
  assert.deepEqual(await wakes(), []);
});

test("PLA-15 #2: a landing queues nothing when the next ticket is not Taller's to start yet", async () => {
  // Another ticket it waits on is only In review (its code is not in the branch): held until that one lands too.
  await backlog("LD-B1");
  await backlog("LD-B2");
  await step("LD-B3", ["LD-B1", "LD-B2"]);
  await raw.query(`update tasks set status = 'In review' where key = 'LD-B2'`);
  await land("LD-B1");
  assert.deepEqual(await wakes(), [], "LD-B2 has not landed");
  await land("LD-B2");
  assert.deepEqual((await wakes()).map((x) => [x.agent, x.task_key, x.summary]), [["taller", "LD-B3", "queued: event unblocked by LD-B2"]]);
  await raw.query(`delete from agent_runs`);

  // Not Ready, owned by another agent, a [PRUEBA] ticket, or a human action still open.
  await backlog("LD-C1");
  await backlog("LD-C2", { blocked_by: ["LD-C1"] });
  await step("LD-C3", ["LD-C1"], { owner_agent: "research" });
  await step("LD-C4", ["LD-C1"], { title: "[PRUEBA] nada" });
  await step("LD-C5", ["LD-C1", { human_action: { text: "Crear la llave" } }]);
  await land("LD-C1");
  assert.deepEqual(await wakes(), []);

  // A ticket that blocks nothing.
  await backlog("LD-D1");
  await land("LD-D1");
  assert.deepEqual(await wakes(), []);

  // The switches: a paused project, a paused company.
  await backlog("LD-E1");
  await step("LD-E2", ["LD-E1"]);
  await setProjectPaused(db, "micasa", true);
  await land("LD-E1");
  assert.deepEqual(await wakes(), []);
  await raw.query(`update projects set runs_paused = false where slug = 'micasa'`);
  await backlog("LD-F1");
  await step("LD-F2", ["LD-F1"]);
  await setCompanyPaused(db, true);
  await land("LD-F1");
  assert.deepEqual(await wakes(), []);
  await setCompanyPaused(db, false);
});

test("PLA-15: several tickets freed at once: Jorge's pick first, then priority; a busy Taller gets nothing new", async () => {
  await backlog("LD-G1");
  await step("LD-G2", ["LD-G1"], { priority: "P2" });
  await step("LD-G3", ["LD-G1"], { priority: "P1" });
  await step("LD-G4", ["LD-G1"], { priority: "P3" });
  await land("LD-G1");
  assert.deepEqual((await wakes()).map((x) => x.task_key), ["LD-G3"]);

  await raw.query(`delete from agent_runs`);
  await backlog("LD-H1");
  await step("LD-H2", ["LD-H1"], { priority: "P1" });
  await step("LD-H3", ["LD-H1"], { priority: "P3" });
  await raw.query(`update projects set settings = settings || '{"next_first": "LD-H3"}'::jsonb where slug = 'micasa'`);
  await land("LD-H1");
  assert.deepEqual((await wakes()).map((x) => x.task_key), ["LD-H3"]);
  await raw.query(`update projects set settings = settings - 'next_first' where slug = 'micasa'`);

  // Taller already has a run queued (LD-H3): the next landing coalesces.
  await backlog("LD-I1");
  await step("LD-I2", ["LD-I1"]);
  await land("LD-I1");
  assert.deepEqual((await wakes()).map((x) => x.task_key), ["LD-H3"]);
});

// ---- PLA-16: a run that failed holding its ticket is retried once; a second failure in a row goes to Jorge.

const { sweepFailedRuns, failureWords } = await import("../src/runner/failed.js");
const { resolveHumanAction } = await import("../src/mcp/blockers.js");
const { writeTx, WEB_ACTOR } = await import("../src/mcp/tx.js");
const MAX_TURNS = "fail: error_max_turns (41 turns, session 491bc14d)";

// The ticket In progress, leased to the runner session of that run (run-<first 8 of its id>).
async function leaseTo(key: string, runId: string, lease = "now() + interval '110 minutes'"): Promise<void> {
  const owner = JSON.stringify({ agent: "plania-runner", session_id: `run-${runId.slice(0, 8)}`, machine: "test" });
  await raw.query(`update tasks set status = 'In progress', owner = $2::jsonb, claimed_at = now() - interval '9 minutes', lease_until = ${lease} where key = $1`, [key, owner]);
}
// A Taller run on the ticket that ended (fail by default) and still holds its lease.
async function endedRunHolding(key: string, status = "fail", summary = MAX_TURNS): Promise<string> {
  const run = (
    await raw.query(
      `insert into agent_runs (agent_id, project_id, task_key, role, status, summary, queued_at, started_at, ended_at)
       values ($1, $2, $3, 'taller', $4, $5, now() - interval '10 minutes', now() - interval '10 minutes', now() - interval '1 minute') returning id`,
      [await id("agents", "taller"), await id("projects", "micasa"), key, status, summary],
    )
  ).rows[0].id as string;
  await leaseTo(key, run);
  return run;
}
const ticket = async (key: string) => (await raw.query(`select id, status, owner, lease_until, blocked_note from tasks where key = $1`, [key])).rows[0];
const eventsOf = async (key: string, type: string) => (await raw.query(`select payload from events where task_key = $1 and type = $2 order by id`, [key, type])).rows.map((r) => r.payload);

test("PLA-16 #1, #2: a failed run frees its ticket and the same agent is queued on it once; the second failure in a row goes to Jorge", async () => {
  assert.equal(failureWords(MAX_TURNS), "error_max_turns (41 turns)");
  await backlog("FR-A1");
  await endedRunHolding("FR-A1");

  // First failure: Ready, no lease, one Taller wake on the same ticket.
  assert.deepEqual(await sweepFailedRuns(db), { retried: 1, held: 0 });
  let t = await ticket("FR-A1");
  assert.deepEqual([t.status, t.owner, t.lease_until], ["Ready", null, null]);
  let w = await wakes();
  assert.deepEqual(w.map((x) => [x.agent, x.task_key, x.status, x.summary]), [["taller", "FR-A1", "queued", "queued: event retry after a failed run"]]);
  const released = await eventsOf("FR-A1", "claim.released");
  assert.deepEqual([released[0].from, released[0].to, released[0].reason], ["In progress", "Ready", "run failed"]);
  assert.match(released[0].owner.session_id, /^run-[0-9a-f]{8}$/);
  assert.match((await eventsOf("FR-A1", "note"))[0].text, /terminó con error \(error_max_turns \(41 turns\)\).*lo reintenta una vez/);
  const queuedLog = (await eventsOf("FR-A1", "wake.queued"))[0];
  assert.deepEqual([queuedLog.agent, queuedLog.reason, queuedLog.from_event], ["taller", "retry after a failed run", "run.failed"]);
  // Nothing left to sweep.
  assert.deepEqual(await sweepFailedRuns(db), { retried: 0, held: 0 });

  // The retry fails too, holding the ticket again: no third run. The ticket is Blocked with a step for Jorge.
  const retryRun = (await raw.query(`update agent_runs set status = 'fail', summary = $1, started_at = now(), ended_at = now() where status = 'queued' returning id`, [MAX_TURNS])).rows[0].id as string;
  await leaseTo("FR-A1", retryRun);
  assert.deepEqual(await sweepFailedRuns(db), { retried: 0, held: 1 });
  t = await ticket("FR-A1");
  assert.deepEqual([t.status, t.owner, t.lease_until], ["Blocked", null, null]);
  assert.match(t.blocked_note, /^Jorge: Taller falló dos veces seguidas en este paso \(error_max_turns \(41 turns\)\)/);
  assert.deepEqual(await wakes(), []);
  assert.equal((await eventsOf("FR-A1", "claim.released"))[1].reason, "run failed twice");
  const steps = (await raw.query(`select id, spec, satisfied_at from blockers where task_id = $1 and type = 'human_action'`, [t.id])).rows;
  assert.equal(steps.length, 1, "one step in Jorge's inbox");
  assert.equal(steps[0].satisfied_at, null);
  assert.deepEqual(await sweepFailedRuns(db), { retried: 0, held: 0 });

  // Jorge marks it done: Ready again, and the move wakes Taller. A third failure is the first of a new pair.
  const p = { id: await id("projects", "micasa"), slug: "micasa" };
  await writeTx(db, p, webCtx, (tx, emit) => resolveHumanAction(tx, emit, p.id, steps[0].id, WEB_ACTOR));
  assert.equal((await ticket("FR-A1")).status, "Ready");
  w = await wakes();
  assert.deepEqual(w.map((x) => [x.agent, x.task_key, x.summary]), [["taller", "FR-A1", "queued: event ticket ready"]]);
  const third = (await raw.query(`update agent_runs set status = 'fail', summary = $1, started_at = now(), ended_at = now() where status = 'queued' returning id`, [MAX_TURNS])).rows[0].id as string;
  await leaseTo("FR-A1", third);
  assert.deepEqual(await sweepFailedRuns(db), { retried: 1, held: 0 });
});

test("PLA-16: the retry waits for a busy agent and a closed switch; a stopped run, a run that ended ok and a person's lease are left alone", async () => {
  // Taller is busy on another ticket: FR-B1 keeps its lease until Taller is free.
  await backlog("FR-B1");
  await endedRunHolding("FR-B1");
  await raw.query(`insert into agent_runs (agent_id, project_id, task_key, role, status, summary) values ($1, $2, 'FR-OTHER', 'taller', 'queued', 'queued: event ticket ready')`, [
    await id("agents", "taller"),
    await id("projects", "micasa"),
  ]);
  assert.deepEqual(await sweepFailedRuns(db), { retried: 0, held: 0 });
  assert.equal((await ticket("FR-B1")).status, "In progress");
  await raw.query(`delete from agent_runs where status = 'queued'`);

  // A paused project, then a paused company.
  await raw.query(`update projects set runs_paused = true where slug = 'micasa'`);
  assert.deepEqual(await sweepFailedRuns(db), { retried: 0, held: 0 });
  await raw.query(`update projects set runs_paused = false where slug = 'micasa'`);
  await raw.query(`update runner_settings set company_paused = true`);
  assert.deepEqual(await sweepFailedRuns(db), { retried: 0, held: 0 });
  assert.equal((await ticket("FR-B1")).status, "In progress");
  await raw.query(`update runner_settings set company_paused = false`);
  assert.deepEqual(await sweepFailedRuns(db), { retried: 1, held: 0 });
  assert.deepEqual((await wakes()).map((x) => x.task_key), ["FR-B1"]);
  await raw.query(`delete from agent_runs`);

  // Not failures, and not runner leases.
  await backlog("FR-C1");
  await endedRunHolding("FR-C1", "stopped", "stopped: project micasa paused (no result)");
  await backlog("FR-C2");
  await endedRunHolding("FR-C2", "ok", "ok: success, 12 turns, session 0a1b2c3d");
  await backlog("FR-C3");
  await raw.query(`update tasks set status = 'In progress', owner = '{"agent":"Claude Code","session_id":"cc-a-person"}'::jsonb, lease_until = now() + interval '20 minutes' where key = 'FR-C3'`);
  assert.deepEqual(await sweepFailedRuns(db), { retried: 0, held: 0 });
  assert.deepEqual(await Promise.all(["FR-C1", "FR-C2", "FR-C3"].map(async (k) => (await ticket(k)).status)), ["In progress", "In progress", "In progress"]);
  assert.deepEqual(await wakes(), []);
});

test("PLA-16: the heartbeat tick sweeps the failed run and starts its retry in the same tick", async () => {
  await backlog("FR-D1");
  await endedRunHolding("FR-D1");
  const f = fakes();
  const counts = await runHeartbeat(db, new Date(), { runner: f.deps as never });
  assert.deepEqual([counts.retried_after_fail, counts.handed_to_jorge, counts.started_from_queue], [1, 0, 1]);
  assert.equal(f.spawned.length, 1);
  const running = await wakes();
  assert.deepEqual(running.map((x) => [x.agent, x.task_key, x.status]), [["taller", "FR-D1", "running"]]);
  f.spawned[0]!.finish();
  await runner.waitForAllRuns();
});

test("PLA-16 #3: a runner run's lease that runs out wakes Taller on the ticket; a person's expired lease wakes nobody", async () => {
  await backlog("FR-E1");
  const run = await endedRunHolding("FR-E1", "ok", "ok: success, 12 turns, session 0a1b2c3d");
  await leaseTo("FR-E1", run, "now() - interval '1 minute'");
  await backlog("FR-E2");
  await raw.query(`update tasks set status = 'In progress', owner = '{"agent":"Claude Code","session_id":"cc-a-person"}'::jsonb, lease_until = now() - interval '1 minute' where key = 'FR-E2'`);
  // Any write in the project reaps both leases.
  await backlog("FR-E3");
  assert.deepEqual(await Promise.all(["FR-E1", "FR-E2"].map(async (k) => (await ticket(k)).status)), ["Ready", "Ready"]);
  const w = await wakes();
  assert.deepEqual(w.map((x) => [x.agent, x.task_key, x.summary]), [["taller", "FR-E1", "queued: event lease expired"]]);
  assert.equal((await eventsOf("FR-E1", "wake.queued"))[0].from_event, "claim.expired");
  assert.deepEqual(await eventsOf("FR-E2", "wake.queued"), []);
});
