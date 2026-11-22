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
  await raw.query(`update runner_settings set company_paused = false, max_concurrent = 1, cooldown_minutes = 0, plan_guard_pct = 70, reserve_tokens = 1000`);
  await raw.query(`update projects set runs_paused = false where slug = 'micasa'`);
  await raw.query(`update projects set runs_paused = true where slug <> 'micasa'`);
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
  // Created straight into Ready is not a move: an unassigned ticket queues nothing.
  await backlog("EV-NEW", { status: "Ready" });
  assert.deepEqual(await wakes(), []);
  // PLA-103: one created Ready and given to Taller (the PO splits a «Hacerlo ya» into one) wakes Taller on it.
  await backlog("EV-GIVEN", { status: "Ready", owner_agent: "taller" });
  assert.deepEqual((await wakes()).map((x) => [x.agent, x.task_key]), [["taller", "EV-GIVEN"]]);
  await raw.query(`delete from agent_runs`);
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

test("PLA-151: an initiative turning Active wakes Taller on its first Ready step; a step born Ready under an Active one does too", async () => {
  await raw.query(`delete from agent_runs`);
  await writes.createTask(db, { project: "micasa", kind: "initiative", key: "EV-INI", title: "Catálogo", scope: "Plan" } as never, ctx);
  await backlog("EV-S1", { parent_key: "EV-INI", phase: 1, status: "Ready" });
  await backlog("EV-S2", { parent_key: "EV-INI", phase: 2, blocked_by: ["EV-S1"] });
  assert.deepEqual(await wakes(), [], "steps filed under a Planning initiative wake nobody");
  const { version } = (await raw.query(`select version from tasks where key = 'EV-INI'`)).rows[0];
  await writes.setTask(db, { project: "micasa", key: "EV-INI", status: "Active", version } as never, ctx);
  const w = await wakes();
  assert.deepEqual(w.map((x) => [x.agent, x.task_key]), [["taller", "EV-S1"]]);
  assert.match(w[0]!.summary, /initiative EV-INI started/);
  await raw.query(`delete from agent_runs`);
  await backlog("EV-S3", { parent_key: "EV-INI", phase: 3, status: "Ready" });
  assert.deepEqual((await wakes()).map((x) => [x.agent, x.task_key]), [["taller", "EV-S3"]], "born Ready under an Active initiative");
  await raw.query(`delete from agent_runs`);
  await backlog("EV-S4", { parent_key: "EV-INI", phase: 4, status: "Ready", blocked_by: ["EV-S2"] });
  assert.deepEqual(await wakes(), [], "a blocked step still waits for its landing");
});

test("PLA-164: after «Constrúyelo» the idea's promotion wakes Taller on step 1, even with the initiative still Planning", async () => {
  await raw.query(`delete from agent_runs`);
  const idea = await writes.createTask(db, { project: "micasa", kind: "idea", title: "Cómo llegar" } as never, ctx);
  const ideaKey = (idea as { key: string }).key;
  const pid = await id("projects", "micasa");
  await raw.query(`insert into events (project_id, task_id, task_key, type, actor, payload) select $1, id, key, 'pedido.construir', '{"agent":"owner","session_id":"web"}'::jsonb, '{}'::jsonb from tasks where key = $2`, [pid, ideaKey]);
  await writes.createTask(db, { project: "micasa", kind: "initiative", key: "EV-BUILT", title: "Cómo llegar", scope: "Plan" } as never, ctx);
  await backlog("EV-B1", { parent_key: "EV-BUILT", phase: 1, status: "Ready" });
  assert.deepEqual(await wakes(), [], "before the promotion the initiative is just Planning");
  const { version } = (await raw.query(`select version from tasks where key = $1`, [ideaKey])).rows[0];
  await writes.setTask(db, { project: "micasa", key: ideaKey, promoted_to: "EV-BUILT", version } as never, ctx);
  const w = await wakes();
  assert.deepEqual(w.map((x) => [x.agent, x.task_key]), [["taller", "EV-B1"]]);
  assert.match(w[0]!.summary, /built from/);
  await raw.query(`delete from agent_runs`);
  await backlog("EV-B2", { parent_key: "EV-BUILT", phase: 2, status: "Ready" });
  assert.deepEqual((await wakes()).map((x) => [x.agent, x.task_key]), [["taller", "EV-B2"]], "a later step born Ready under it wakes Taller too");
});

test("PLA-164: an ordinary Planning initiative (no «Constrúyelo») still wakes nobody on a step born Ready", async () => {
  await raw.query(`delete from agent_runs`);
  await writes.createTask(db, { project: "micasa", kind: "initiative", key: "EV-PLAIN", title: "Otro plan", scope: "Plan" } as never, ctx);
  await backlog("EV-P1", { parent_key: "EV-PLAIN", phase: 1, status: "Ready" });
  assert.deepEqual(await wakes(), []);
});

test("PLA-167: a note on a step an ended run still holds frees it and wakes Taller with the note; a live run is left alone", async () => {
  await raw.query(`delete from agent_runs`);
  await backlog("EV-NOTE", { status: "Ready" });
  await raw.query(`delete from agent_runs`);
  await writes.claim(db, { project: "micasa", key: "EV-NOTE" } as never, { actor: { agent: "plania-runner", session_id: "run-0b4b01d4271a4e8f", machine: "m" } } as never);
  const { noteForAgent } = await import("../src/api/company-runs.js");
  const out = await noteForAgent(db, "micasa", "EV-NOTE", "Arregla la prueba inestable y vuelve a entregar.");
  assert.deepEqual(out, { noted: true, woke: true });
  assert.equal((await raw.query(`select status from tasks where key = 'EV-NOTE'`)).rows[0].status, "Ready", "the ended run's lease is released");
  const w = await wakes();
  assert.deepEqual(w.map((x) => [x.agent, x.task_key]), [["taller", "EV-NOTE"]]);
  assert.match(w[0]!.summary, /note from the owner: Arregla la prueba inestable/);
  // While a run is queued or running on the step, the note waits for its next step: nothing more is queued.
  const again = await noteForAgent(db, "micasa", "EV-NOTE", "Otra cosa.");
  assert.deepEqual(again, { noted: true, woke: false });
  assert.equal((await wakes()).length, 1);
});

test("PLA-167: a person's own lease is never released by a note", async () => {
  await raw.query(`delete from agent_runs`);
  await backlog("EV-NOTE2", { status: "Ready" });
  await raw.query(`delete from agent_runs`);
  await writes.claim(db, { project: "micasa", key: "EV-NOTE2" } as never, { actor: { agent: "Claude Code", session_id: "cc-someone-working", machine: "m" } } as never);
  const { noteForAgent } = await import("../src/api/company-runs.js");
  assert.deepEqual(await noteForAgent(db, "micasa", "EV-NOTE2", "Hola."), { noted: true, woke: false });
  assert.equal((await raw.query(`select status from tasks where key = 'EV-NOTE2'`)).rows[0].status, "In progress");
});

test("PLA-155: a PO run that leaves its ticket In progress with uncommitted code hands it to Taller, who wakes", async () => {
  await raw.query(`delete from agent_runs`);
  await backlog("EV-PO", { status: "Ready", owner_agent: "housi" });
  await raw.query(`delete from agent_runs`);
  await writes.claim(db, { project: "micasa", key: "EV-PO" } as never, { actor: { agent: "plania-runner", session_id: "run-0a4a01d4271a4e8f", machine: "m" } } as never);
  const project = (await raw.query(`select * from projects where slug = 'micasa'`)).rows[0];
  const p = { ...project, settings: project.settings, id: project.id, slug: project.slug };
  const clean = async () => ({ code: 0, stdout: "", stderr: "" });
  assert.equal(await runner.handPoCodeToTaller(db, p as never, "EV-PO", "/tmp/x", clean), false, "nothing uncommitted: left alone");
  const dirty = async () => ({ code: 0, stdout: " M src/app/foto.tsx\n?? src/app/nueva.tsx\n", stderr: "" });
  assert.equal(await runner.handPoCodeToTaller(db, p as never, "EV-PO", "/tmp/x", dirty), true);
  const t = (await raw.query(`select t.status, a.slug from tasks t left join agents a on a.id = t.owner_agent where t.key = 'EV-PO'`)).rows[0];
  assert.deepEqual([t.status, t.slug], ["Ready", "taller"]);
  const note = (await raw.query(`select payload from events where type = 'note' and task_key = 'EV-PO' order by id desc limit 1`)).rows[0];
  assert.match(note.payload.text, /src\/app\/foto\.tsx, src\/app\/nueva\.tsx/);
  assert.deepEqual((await wakes()).map((x) => [x.agent, x.task_key]), [["taller", "EV-PO"]], "Taller wakes on it");
  assert.equal(await runner.handPoCodeToTaller(db, p as never, "EV-PO", "/tmp/x", dirty), false, "not In progress any more: once");
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

test("I31-1 #2 (PLA-I60): 3 events on 3 tickets queue 3 runs; events do not wait for the rest; the seat's cap starts one at a time", async () => {
  await raw.query(`update runner_settings set cooldown_minutes = 30`);
  // Taller's last run ended a minute ago. Before PLA-I60 that rest held event wakes; now it paces only cadence runs.
  await raw.query(
    `insert into agent_runs (agent_id, project_id, role, status, started_at, ended_at, queued_at, summary, trigger)
     values ($1, $2, 'taller', 'ok', now() - interval '5 minutes', now() - interval '1 minute', now() - interval '5 minutes', 'ok: seed', 'cadence')`,
    [await id("agents", "taller"), await id("projects", "micasa")],
  );
  for (const key of ["EV-C1", "EV-C2", "EV-C3"]) {
    await backlog(key);
    await toReady(key);
  }
  let w = await wakes();
  assert.deepEqual(w.map((x) => x.task_key).sort(), ["EV-C1", "EV-C2", "EV-C3"], "one queued run per ticket");
  // A second event on a ticket that already has a queued run coalesces into it.
  await raw.query(`update tasks set status = 'Backlog' where key = 'EV-C1'`);
  await toReady("EV-C1");
  assert.equal((await wakes()).length, 3);

  const f = fakes();
  // The rest does not hold an event wake; the seat's cap (1 by default) starts one.
  let drained = await runner.drainQueue(db, new Date(), f.deps as never);
  assert.equal(drained.started, 1);
  assert.equal(f.spawned.length, 1);
  w = await wakes();
  assert.equal(w.filter((x) => x.status === "queued").length, 2);
  f.spawned[0]!.finish();
  await runner.waitForAllRuns();
  // The next one starts when the slot frees, from the heartbeat's drain.
  const counts = await runHeartbeat(db, new Date(), { runner: f.deps as never });
  assert.equal(counts.started_from_queue, 1);
  assert.equal(f.spawned.length, 2);
  f.spawned[1]!.finish();
  await runner.waitForAllRuns();
  drained = await runner.drainQueue(db, new Date(), f.deps as never);
  assert.equal(drained.started, 1);
  f.spawned[2]!.finish();
  await runner.waitForAllRuns();
  const runs = (await raw.query(`select count(*)::int as n from agent_runs r join agents a on a.id = r.agent_id where a.slug = 'taller' and r.status = 'ok' and r.summary <> 'ok: seed'`)).rows[0].n;
  assert.equal(runs, 3);
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

test("I31-1: resuming a project queues its PO's first wake; an answer on a ticket is its own work item (PLA-I60)", async () => {
  await raw.query(`update projects set runs_paused = true where slug = 'micasa'`);
  await setProjectPaused(db, "micasa", false);
  let w = await wakes();
  assert.equal(w.length, 1);
  assert.deepEqual({ agent: w[0]!.agent, task: w[0]!.task_key }, { agent: "housi", task: null });
  assert.match(w[0]!.summary, /project resumed/);
  // PLA-I60: the answer wakes housi on that ticket, a work item of its own; a second answer there coalesces.
  await backlog("EV-CO");
  for (const n of [1, 2]) {
    const q = (await questions.ask(db, { project: "micasa", key: "EV-CO", question: `¿${n}?` }, { actor: { agent: "housi", session_id: "h1" } })) as { question_id: string };
    await questions.answer(db, { project: "micasa", question_id: q.question_id, answer: "Sí" }, webCtx);
  }
  w = await wakes();
  assert.deepEqual(w.filter((x) => x.agent === "housi").map((x) => x.task_key).sort(), ["EV-CO", null].sort());
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

test("PLA-15: several tickets freed at once: Jorge's pick first, then priority; the next landing queues its own run (PLA-I60)", async () => {
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

  // PLA-I60: Taller already has a run queued (LD-H3); the next landing frees another ticket, a work item of its
  // own, so it gets its own queued run (the seat's cap decides when it starts).
  await backlog("LD-I1");
  await step("LD-I2", ["LD-I1"]);
  await land("LD-I1");
  assert.deepEqual((await wakes()).map((x) => x.task_key), ["LD-H3", "LD-I2"]);
});

// ---- PLA-54: a PO's plan files its steps in Backlog; the landing of step N moves step N+1 to Ready and wakes Taller.

const { promoteDue } = await import("../src/jobs/blockers.js");
const leg = async (status: string): Promise<string> => {
  const i = await writes.createTask(db, { project: "micasa", kind: "initiative", title: `Tramo ${status}`, scope: "PRD" } as never, ctx);
  await raw.query(`update tasks set status = $2 where key = $1`, [i.key, status]);
  return i.key;
};
const statusOf = async (key: string) => (await raw.query(`select status from tasks where key = $1`, [key])).rows[0].status as string;

test("PLA-54 #1: landing step 1 of a Backlog chain moves step 2 to Ready and queues one Taller wake; step 3 waits", async () => {
  const i = await leg("Active");
  await backlog("CH-A1", { parent_key: i, phase: 1, status: "Ready" });
  await backlog("CH-A2", { parent_key: i, phase: 2, blocked_by: ["CH-A1"] });
  await backlog("CH-A3", { parent_key: i, phase: 3, blocked_by: ["CH-A2"] });
  await raw.query(`delete from agent_runs`);

  await land("CH-A1");
  assert.equal(await statusOf("CH-A2"), "Ready");
  assert.equal(await statusOf("CH-A3"), "Backlog");
  assert.deepEqual((await wakes()).map((x) => [x.agent, x.task_key, x.summary]), [["taller", "CH-A2", "queued: event unblocked by CH-A1"]]);
  const moved = (await raw.query(`select actor, payload from events where task_key = 'CH-A2' and type = 'task.status' order by id`)).rows;
  assert.deepEqual(moved.map((e) => [e.actor.session_id, e.payload.from, e.payload.to, e.payload.unblocked_by]), [["system", "Backlog", "Ready", ["CH-A1"]]]);

  // Merged → Released → Done is the same landing: nothing new.
  await raw.query(`delete from agent_runs`);
  await move("CH-A1", "Released");
  await move("CH-A1", "Done");
  assert.deepEqual(await wakes(), []);
  assert.equal(await statusOf("CH-A3"), "Backlog");
});

test("PLA-54 #2: a step put back in Backlog, under a Planning or On hold initiative, or behind an In review step stays put", async () => {
  // Put back in Backlog by someone: postponed on purpose.
  const active = await leg("Active");
  await backlog("CH-B1", { parent_key: active, status: "Ready" });
  await backlog("CH-B2", { parent_key: active, blocked_by: ["CH-B1"] });
  await toReady("CH-B2");
  await move("CH-B2", "Backlog");
  // Behind a step that is only In review: its code is not in the branch yet.
  await backlog("CH-C1", { parent_key: active, status: "Ready" });
  await backlog("CH-C2", { parent_key: active, blocked_by: ["CH-C1"] });
  await raw.query(`update tasks set status = 'In review' where key = 'CH-C1'`);
  // An initiative not building: Planning, On hold.
  const planning = await leg("Planning");
  await backlog("CH-D1", { parent_key: planning, status: "Ready" });
  await backlog("CH-D2", { parent_key: planning, blocked_by: ["CH-D1"] });
  const held = await leg("On hold");
  await backlog("CH-E1", { parent_key: held, status: "Ready" });
  await backlog("CH-E2", { parent_key: held, blocked_by: ["CH-E1"] });
  // A loose ticket (no initiative) and one with another blocker still open.
  await backlog("CH-F1", { status: "Ready" });
  await backlog("CH-F2", { blocked_by: ["CH-F1"] });
  await backlog("CH-G1", { parent_key: active, status: "Ready" });
  await backlog("CH-G2", { parent_key: active, blocked_by: ["CH-G1", { human_action: { text: "Crear la llave" } }] });

  await raw.query(`delete from agent_runs`); // the setup's own move of CH-B2 to Ready
  for (const k of ["CH-B1", "CH-D1", "CH-E1", "CH-F1", "CH-G1"]) await land(k);
  assert.equal(await promoteDue(db), 0, "the sweep finds nothing either");
  for (const k of ["CH-B2", "CH-C2", "CH-D2", "CH-E2", "CH-F2", "CH-G2"]) assert.equal(await statusOf(k), "Backlog", k);
  assert.deepEqual(await wakes(), []);

  // The On hold initiative resumes: its step whose blocker landed moves then.
  await raw.query(`update tasks set status = 'Active' where key = $1`, [held]);
  await land("CH-C1");
  assert.equal(await statusOf("CH-C2"), "Ready");
  assert.equal(await statusOf("CH-E2"), "Ready");
});

test("PLA-54 #3: the blockers job sweeps a chain step whose blocker landed before the fix", async () => {
  const i = await leg("Active");
  await backlog("CH-H1", { parent_key: i, status: "Ready" });
  await backlog("CH-H2", { parent_key: i, blocked_by: ["CH-H1"] });
  await raw.query(`update tasks set status = 'Done' where key = 'CH-H1'`);
  await raw.query(`delete from agent_runs`);
  assert.equal(await statusOf("CH-H2"), "Backlog");

  assert.equal(await promoteDue(db), 1);
  assert.equal(await statusOf("CH-H2"), "Ready");
  assert.deepEqual((await wakes()).map((x) => [x.agent, x.task_key, x.summary]), [["taller", "CH-H2", "queued: event unblocked by CH-H1"]]);
  assert.equal(await promoteDue(db), 0, "once");
});

// ---- PLA-16: a run that failed holding its ticket is retried once; a second failure in a row goes to Jorge.

const { sweepFailedRuns, failureWords } = await import("../src/runner/failed.js");
const { resolveHumanAction } = await import("../src/mcp/blockers.js");
const { writeTx, WEB_ACTOR } = await import("../src/mcp/tx.js");
const MAX_TURNS = "fail: error_max_turns (41 turns, session 491bc14d)";

// The ticket In progress, leased to the runner session of that run (run-<first 8 of its id>).
async function leaseTo(key: string, runId: string, lease = "now() + interval '110 minutes'", session = `run-${runId.slice(0, 8)}`): Promise<void> {
  const owner = JSON.stringify({ agent: "plania-runner", session_id: session, machine: "test" });
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

test("PLA-95: a run that wrote as run-<16 hex> (PLA-I60-1) is found too: its ticket is freed and retried", async () => {
  await backlog("FR-N16");
  const run = await endedRunHolding("FR-N16");
  await leaseTo("FR-N16", run, "now() + interval '110 minutes'", `run-${run.replace(/-/g, "").slice(0, 16)}`);
  assert.deepEqual(await sweepFailedRuns(db), { retried: 1, held: 0 });
  const t = await ticket("FR-N16");
  assert.deepEqual([t.status, t.owner], ["Ready", null]);
  assert.match((await eventsOf("FR-N16", "claim.released"))[0].owner.session_id, /^run-[0-9a-f]{16}$/);
  await raw.query(`delete from agent_runs`);
});

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
  assert.match(t.blocked_note, /^Owner: Taller falló dos veces seguidas en este paso \(error_max_turns \(41 turns\)\)/);
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

test("PLA-16: the retry waits for a closed switch, not for a busy agent (PLA-I60); a stopped run, a run that ended ok and a person's lease are left alone", async () => {
  // PLA-I60: Taller busy on another ticket no longer holds the retry: FR-B1 is a work item of its own.
  await backlog("FR-B0");
  await endedRunHolding("FR-B0");
  await raw.query(`insert into agent_runs (agent_id, project_id, task_key, role, status, summary, work_key) values ($1, $2, 'FR-OTHER', 'taller', 'queued', 'queued: event ticket ready', 'task:FR-OTHER')`, [
    await id("agents", "taller"),
    await id("projects", "micasa"),
  ]);
  assert.deepEqual(await sweepFailedRuns(db), { retried: 1, held: 0 });
  await raw.query(`delete from agent_runs`);
  await backlog("FR-B1");
  await endedRunHolding("FR-B1");

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
  assert.deepEqual([counts.retried_after_fail, counts.handed_to_owner, counts.started_from_queue], [1, 0, 1]);
  assert.equal(f.spawned.length, 1);
  // (PLA-I60-4: the same tick may also queue a retry for an idea an earlier test left in a stage with no run.)
  const running = (await wakes()).filter((x) => x.agent === "taller");
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

// ---- PLA-18: a run a limit stopped lets go of its ticket; the work is queued again when the limit opens.

const { sweepStoppedRuns, requeueHeld, limitOf } = await import("../src/runner/failed.js");
const { resumeRun } = await import("../src/api/company-runs.js");
const BUDGET_STOP = "BUDGET_STOPPED project micasa";

// A Taller run on the ticket that a limit stopped, still holding its lease. tokens: what it spent.
async function stoppedRunHolding(key: string, reason: string, tokens = 0): Promise<string> {
  const run = (
    await raw.query(
      `insert into agent_runs (agent_id, project_id, task_key, role, status, summary, stop_reason, tokens_total, queued_at, started_at, ended_at)
       values ($1, $2, $3, 'taller', 'stopped', $4, $5, $6, now() - interval '10 minutes', now() - interval '10 minutes', now() - interval '1 minute') returning id`,
      [await id("agents", "taller"), await id("projects", "micasa"), key, `stopped: ${reason} (error_during_execution, 5 turns, session 491bc14d)`, reason, tokens],
    )
  ).rows[0].id as string;
  await leaseTo(key, run);
  return run;
}

test("PLA-18: which stops and drops are limits that open again", () => {
  assert.equal(limitOf("stopped", "", BUDGET_STOP), "budget");
  assert.equal(limitOf("stopped", "", "BUDGET_STOPPED asistente"), "budget");
  assert.equal(limitOf("stopped", "", "company paused"), "switch");
  assert.equal(limitOf("stopped", "", "project micasa paused"), "switch");
  assert.equal(limitOf("skipped", "skipped: BUDGET_STOPPED project micasa at 157%", null), "budget");
  assert.equal(limitOf("skipped", "skipped: plan guard (five_hour 80% >= 70%)", null), "plan");
  assert.equal(limitOf("skipped", "skipped: server restarted", null), "restart");
  // Jorge's Detener, a timeout, an orphan and a dropped wake for any other reason are not.
  assert.equal(limitOf("stopped", "", "detenido desde Compañía"), null);
  assert.equal(limitOf("stopped", "", "timeout"), null);
  assert.equal(limitOf("skipped", "skipped: cooldown", null), null);
  assert.equal(limitOf("skipped", "skipped: no goal", null), null);
  assert.equal(limitOf("ok", "ok: success", null), null);
});

test("PLA-21: a run a budget stopped before PLA-21 frees its ticket with a note and is queued again on the next tick", async () => {
  await backlog("BS-A1");
  await stoppedRunHolding("BS-A1", BUDGET_STOP, 12_000_000);

  assert.deepEqual(await sweepStoppedRuns(db), { freed: 1 });
  const t = await ticket("BS-A1");
  assert.deepEqual([t.status, t.owner, t.lease_until], ["Ready", null, null]);
  assert.equal((await eventsOf("BS-A1", "claim.released"))[0].reason, "run stopped");
  assert.match((await eventsOf("BS-A1", "note"))[0].text, /se detuvo: se acabó el presupuesto semanal\. Plania liberó el ticket; se retoma enseguida: ya no hay límite semanal\./);
  // No budget is left to open: the same tick's requeue queues Taller on the ticket, once.
  assert.deepEqual(await requeueHeld(db), { requeued: 1 });
  const w = await wakes();
  assert.deepEqual(w.map((x) => [x.agent, x.task_key, x.status, x.summary]), [["taller", "BS-A1", "queued", "queued: event budget open again"]]);
  assert.equal((await eventsOf("BS-A1", "wake.queued"))[0].from_event, "run.held");
  assert.deepEqual(await requeueHeld(db), { requeued: 0 }, "the queued run is now the newest");
  assert.deepEqual(await sweepStoppedRuns(db), { freed: 0 });
});

test("PLA-56: with the override on, a plan-guard skip is queued again once the «rejected» window has reset", async () => {
  await backlog("PG-A1", { status: "Ready" });
  await raw.query(`delete from agent_runs`);
  await raw.query(
    `insert into agent_runs (agent_id, project_id, task_key, role, status, summary, trigger, queued_at, ended_at)
     values ($1, $2, 'PG-A1', 'taller', 'skipped', 'skipped: plan guard (status rejected, resetsAt x)', 'event', now() - interval '20 minutes', now() - interval '20 minutes')`,
    [await id("agents", "taller"), await id("projects", "micasa")],
  );
  await raw.query(`update runner_settings set guard_override = true`);
  try {
    // The window is still closed: nothing.
    await raw.query(`delete from plan_readings`);
    await raw.query(`insert into plan_readings (at, source, status, five_hour_pct, five_hour_resets_at) values (now() - interval '1 hour', 'stream', 'rejected', 100, now() + interval '1 hour')`);
    assert.deepEqual(await requeueHeld(db), { requeued: 0 });
    // The last reading is the morning's, its reset long past (MIA-I7-2, 2026-11-17): queued again, once.
    await raw.query(`delete from plan_readings`);
    await raw.query(`insert into plan_readings (at, source, status, five_hour_pct, five_hour_resets_at) values (now() - interval '10 hours', 'stream', 'rejected', 100, now() - interval '8 hours')`);
    assert.deepEqual(await requeueHeld(db), { requeued: 1 });
    assert.deepEqual((await wakes()).map((x) => [x.agent, x.task_key, x.summary]), [["taller", "PG-A1", "queued: event plan has room again"]]);
    assert.deepEqual(await requeueHeld(db), { requeued: 0 }, "once");
  } finally {
    await raw.query(`update runner_settings set guard_override = false`);
  }
});

test("PLA-18: a switch stop frees the ticket and the work is queued again on resume; Jorge's Detener is not", async () => {
  await backlog("BS-C1");
  await stoppedRunHolding("BS-C1", "project micasa paused");
  await raw.query(`update projects set runs_paused = true where slug = 'micasa'`);
  assert.deepEqual(await sweepStoppedRuns(db), { freed: 1 });
  assert.match((await eventsOf("BS-C1", "note"))[0].text, /se pusieron en pausa\. Plania liberó el ticket; se retoma al reanudar\./);
  assert.deepEqual(await requeueHeld(db), { requeued: 0 });
  await raw.query(`update projects set runs_paused = false where slug = 'micasa'`);
  assert.deepEqual(await requeueHeld(db), { requeued: 1 });
  assert.deepEqual((await wakes()).map((x) => [x.agent, x.task_key, x.summary]), [["taller", "BS-C1", "queued: event runs resumed"]]);
  await raw.query(`delete from agent_runs`);

  // Detener: the screen already released it; nothing queues it again (Seguir is Jorge's).
  await backlog("BS-D1");
  await stoppedRunHolding("BS-D1", "detenido desde Compañía");
  await raw.query(`update tasks set status = 'Ready', owner = null, lease_until = null where key = 'BS-D1'`);
  assert.deepEqual(await requeueHeld(db), { requeued: 0 });
  assert.deepEqual(await wakes(), []);
});

// A PO wake on an idea that a server restart dropped while it waited in the queue.
async function droppedIdeaWake(key: string, agent = "housi"): Promise<void> {
  await raw.query(
    `insert into agent_runs (agent_id, project_id, task_key, role, status, summary, queued_at, ended_at)
     values ($1, $2, $3, 'product-owner', 'skipped', 'skipped: server restarted', now() - interval '10 minutes', now() - interval '1 minute')`,
    [await id("agents", agent), await id("projects", "micasa"), key],
  );
}

test("PLA-48: an open idea whose wake a restart dropped is queued again once, for the same agent", async () => {
  const { key } = (await writes.createTask(db, { project: "micasa", kind: "idea", title: "Darle forma" } as never, ctx)) as { key: string };
  await raw.query(`delete from agent_runs`);
  await droppedIdeaWake(key);

  assert.deepEqual(await requeueHeld(db), { requeued: 1 });
  assert.deepEqual((await wakes()).map((x) => [x.agent, x.task_key, x.summary]), [["housi", key, "queued: event server restarted"]]);
  assert.equal((await eventsOf(key, "wake.queued"))[0].from_event, "run.held");
  assert.deepEqual(await requeueHeld(db), { requeued: 0 }, "the queued run is now the newest");
});

test("PLA-48: a promoted or closed idea is not queued again", async () => {
  const { key: promoted } = (await writes.createTask(db, { project: "micasa", kind: "idea", title: "Ya promovida" } as never, ctx)) as { key: string };
  const { key: closed } = (await writes.createTask(db, { project: "micasa", kind: "idea", title: "Cerrada" } as never, ctx)) as { key: string };
  await raw.query(`update tasks set promoted_to = 'MC-I9' where key = $1`, [promoted]);
  await raw.query(`update tasks set status = 'Done' where key = $1`, [closed]);
  await raw.query(`delete from agent_runs`);
  await droppedIdeaWake(promoted);
  await droppedIdeaWake(closed);

  assert.deepEqual(await requeueHeld(db), { requeued: 0 });
  assert.deepEqual(await wakes(), []);
});

test("PLA-21: a heavy week no longer drops a queued wake", async () => {
  await raw.query(
    `insert into agent_runs (agent_id, project_id, task_key, role, status, summary, tokens_total, queued_at, started_at, ended_at)
     values ($1, $2, 'BS-OTHER', 'taller', 'ok', 'ok: seed', 900000000, now() - interval '2 hours', now() - interval '2 hours', now() - interval '2 hours')`,
    [await id("agents", "taller"), await id("projects", "micasa")],
  );
  await backlog("BS-E1");
  await toReady("BS-E1");
  assert.deepEqual((await wakes()).map((x) => x.task_key), ["BS-E1"], "the move to Ready queues the event wake");
  const f = fakes();
  const drained = await runner.drainQueue(db, new Date(), f.deps as never);
  assert.deepEqual(drained, { started: 1, dropped: 0 });
  assert.equal(f.spawned.length, 1);
  f.spawned[0]!.finish();
  await runner.waitForAllRuns();
});

test("PLA-18 #3: Seguir on a run a budget stopped releases its lease and wakes the agent", async () => {
  await backlog("BS-F1");
  const run = await stoppedRunHolding("BS-F1", BUDGET_STOP, 12_000_000);
  const f = fakes();
  const out = await resumeRun(db, run, { runner: f.deps as never });
  assert.deepEqual(out, { woke: true, reason: "ok", ticket: "BS-F1" });
  assert.equal(f.spawned.length, 1);
  assert.notEqual((await ticket("BS-F1")).owner?.session_id, `run-${run.slice(0, 8)}`, "the stopped run no longer holds it");
  assert.equal((await eventsOf("BS-F1", "claim.released"))[0].owner.session_id, `run-${run.slice(0, 8)}`);
  f.spawned[0]!.finish();
  await runner.waitForAllRuns();
});

// ---- PLA-I73-2: stacked steps. A step whose one blocker is delivered (In review, with a branch) starts on top of it.
const stack = await import("../src/runner/stack.js");
const deliver = async (key: string, branch: string) => {
  await raw.query(`update tasks set status = 'In review', branch = $2 where key = $1`, [key, branch]);
  await writeTxSweep();
};
const writeTxSweep = async () => {
  const { promoteDue: due } = await import("../src/jobs/blockers.js");
  await due(db);
};
const taskId = async (key: string) => (await raw.query(`select id from tasks where key = $1`, [key])).rows[0].id as string;

test("PLA-I73-2 #1: a step behind one delivered step goes Ready, wakes Taller and is cut from that step's branch", async () => {
  const i = await leg("Active");
  await backlog("ST-A1", { parent_key: i, phase: 1, status: "Ready" });
  await backlog("ST-A2", { parent_key: i, phase: 2, blocked_by: ["ST-A1"] });
  await backlog("ST-A3", { parent_key: i, phase: 3, blocked_by: ["ST-A2"] });
  await raw.query(`delete from agent_runs`);
  await deliver("ST-A1", "plania/st-a1");
  assert.equal(await statusOf("ST-A2"), "Ready");
  assert.equal(await statusOf("ST-A3"), "Backlog", "only one step ahead: ST-A2 has not been delivered");
  assert.deepEqual((await wakes()).map((x) => [x.agent, x.task_key]), [["taller", "ST-A2"]]);
  assert.deepEqual(await stack.stackBaseOf(db, await taskId("ST-A2")), { key: "ST-A1", title: "Ticket ST-A1", branch: "plania/st-a1", status: "In review" });
  // Not accepted before the step under it.
  assert.equal((await stack.stackHold(db, await taskId("ST-A2")))?.key, "ST-A1");
  await land("ST-A1");
  assert.equal(await stack.stackHold(db, await taskId("ST-A2")), null);
  assert.equal(await stack.stackBaseOf(db, await taskId("ST-A2")), null, "once landed, the start branch has its code");
});

test("PLA-I73-2 #2: no stacking with apilar off, with no branch, or behind two open steps", async () => {
  const i = await leg("Active");
  await backlog("ST-B1", { parent_key: i, status: "Ready" });
  await backlog("ST-B2", { parent_key: i, blocked_by: ["ST-B1"] });
  await raw.query(`update tasks set status = 'In review' where key = 'ST-B1'`); // no branch
  await backlog("ST-C1", { parent_key: i, status: "Ready" });
  await backlog("ST-C2", { parent_key: i, status: "Ready" });
  await backlog("ST-C3", { parent_key: i, blocked_by: ["ST-C1", "ST-C2"] });
  await raw.query(`update tasks set status = 'In review', branch = 'plania/st-c1' where key = 'ST-C1'`);
  await writeTxSweep();
  assert.equal(await statusOf("ST-B2"), "Backlog");
  assert.equal(await statusOf("ST-C3"), "Backlog", "two steps still open under it");

  await raw.query(`update projects set settings = jsonb_set(settings, '{velocidad}', '{"apilar": false}') where slug = 'micasa'`);
  try {
    await backlog("ST-D1", { parent_key: i, status: "Ready" });
    await backlog("ST-D2", { parent_key: i, blocked_by: ["ST-D1"] });
    await deliver("ST-D1", "plania/st-d1");
    assert.equal(await statusOf("ST-D2"), "Backlog", "apilar off waits for the merge as before");
  } finally {
    await raw.query(`update projects set settings = settings - 'velocidad' where slug = 'micasa'`);
  }
});

test("PLA-I73-2 #3: a step sent back from review leaves a note on the step stacked on it", async () => {
  const i = await leg("Active");
  await backlog("ST-E1", { parent_key: i, status: "Ready" });
  await backlog("ST-E2", { parent_key: i, blocked_by: ["ST-E1"] });
  await deliver("ST-E1", "plania/st-e1");
  assert.equal(await statusOf("ST-E2"), "Ready");
  await move("ST-E1", "Ready");
  const notes = (await raw.query(`select payload from events where task_key = 'ST-E2' and type = 'note' order by id`)).rows.map((r) => r.payload.text as string);
  assert.ok(notes.some((t) => /volvió a Taller/.test(t) && t.includes("ST-E1")), JSON.stringify(notes));
});

// ---- PLA-I73-6: the early skeleton and the step's effort.
const { deliverStage } = await import("../src/mcp/stage-docs.js");
const { resolveMotor } = await import("../src/runner/motor.js");
const planData = (esqueleto: boolean) => ({
  steps: [
    { title: "El esqueleto del catálogo", done_when: "Las tablas del catálogo existen y las pantallas vacías abren sin error", try_it: "Abre el panel y la ruta del catálogo y mira las pantallas vacías", ...(esqueleto ? { esqueleto: true, effort: "high" } : {}) },
    { title: "La novia hojea el catálogo", done_when: "La novia ve la revista con fotos grandes desde el enlace de su cita", try_it: "Abre el enlace de una cita de prueba y recorre la revista", depends_on: [0], files: ["src/app/catalogo/**"] },
  ],
  risks: ["Las fotos pueden pesar"],
});

test("PLA-I73-6 #1: a plan whose first step is the skeleton wakes Taller on the idea; step 1 then starts from that branch", async () => {
  await raw.query(`delete from agent_runs`);
  const idea = (await writes.createTask(db, { project: "micasa", kind: "idea", title: "Catálogo temprano", scope: "s" } as never, ctx)) as { key: string };
  await raw.query(`update tasks set stage = 'planning' where key = $1`, [idea.key]);
  const r = (await deliverStage(db, { project: "micasa", key: idea.key, stage: "planning", data: planData(true) } as never, ctx)) as { early_skeleton?: string };
  assert.ok(r.early_skeleton, JSON.stringify(r));
  const w = await wakes();
  assert.deepEqual(w.map((x) => [x.agent, x.task_key]), [["taller", idea.key]]);
  assert.match((await raw.query(`select summary from agent_runs where task_key = $1`, [idea.key])).rows[0].summary, /early skeleton/);

  // «Constrúyelo»: the initiative and its tickets; step 1 adopts the early branch, step 2 gets its blocker and files.
  const i = await leg("Active");
  await raw.query(`update tasks set promoted_to = $2 where key = $1`, [idea.key, i]);
  await backlog("EK-1", { parent_key: i, phase: 1, status: "Ready" });
  await backlog("EK-2", { parent_key: i, phase: 2 });
  const s1 = await stack.earlyBaseOf(db, await taskId("EK-1"));
  assert.equal(s1?.branch, r.early_skeleton);
  assert.equal(await stack.earlyBaseOf(db, await taskId("EK-2")), null, "only step 1");
  const two = (await raw.query(`select t.areas, (select array_agg(b.key) from task_blockers tb join tasks b on b.id = tb.blocker_id where tb.task_id = t.id) as blockers from tasks t where key = 'EK-2'`)).rows[0];
  assert.deepEqual(two.blockers, ["EK-1"], "blocked_by filled from depends_on");
  assert.deepEqual(two.areas, ["src/app/catalogo/**"], "areas filled from files");

  // A new plan version: the early branch no longer counts.
  await deliverStage(db, { project: "micasa", key: idea.key, stage: "planning", data: planData(false) } as never, ctx);
  assert.equal(await stack.earlyBaseOf(db, await taskId("EK-1")), null);
});

test("PLA-I73-6 #2: no early run when the plan has no skeleton or the project turned it off", async () => {
  await raw.query(`delete from agent_runs`);
  const a = (await writes.createTask(db, { project: "micasa", kind: "idea", title: "Sin esqueleto", scope: "s" } as never, ctx)) as { key: string };
  const r = (await deliverStage(db, { project: "micasa", key: a.key, stage: "planning", data: planData(false) } as never, ctx)) as { early_skeleton?: string };
  assert.equal(r.early_skeleton, undefined);
  await raw.query(`update projects set settings = settings || '{"velocidad": {"esqueleto_temprano": false}}'::jsonb where slug = 'micasa'`);
  try {
    const b = (await writes.createTask(db, { project: "micasa", kind: "idea", title: "Apagado", scope: "s" } as never, ctx)) as { key: string };
    const r2 = (await deliverStage(db, { project: "micasa", key: b.key, stage: "planning", data: planData(true) } as never, ctx)) as { early_skeleton?: string };
    assert.equal(r2.early_skeleton, undefined);
    assert.deepEqual(await wakes(), []);
  } finally {
    await raw.query(`update projects set settings = settings - 'velocidad' where slug = 'micasa'`);
  }
});

test("PLA-I73-6 #3: a step's effort wins over the seat's, never over a question's", () => {
  const base = { seat: { model: "claude-sonnet-5-5", effort: "medium", consultaEffort: "low" }, company: { model: null, effort: null } };
  assert.equal(resolveMotor({ ...base, stepEffort: "high" }).effort, "high");
  assert.equal(resolveMotor({ ...base, stepEffort: "high" }).source.effort, "step");
  assert.equal(resolveMotor({ ...base, stepEffort: null }).effort, "medium");
  assert.equal(resolveMotor({ ...base, consulta: true, stepEffort: "high" }).effort, "low");
});
