// PLA-I60: many agents at once. Throwaway DB, fake values only.
//   T1  one active run per (agent, project, work key) in SQL; meaning in columns, not in summary; 16-hex run sessions.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { after, before, beforeEach, test } from "node:test";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
process.env.PLANIA_EVENT_WAKES = "1";
const { makeDb } = await import("../src/db/client.js");
const { seedOrg } = await import("../scripts/seed-org.js");
const queue = await import("../src/runner/queue.js");
const events = await import("../src/runner/events.js");
const sessions = await import("../src/runner/run-session.js");
const consultas = await import("../src/pedidos/consultas.js");
const { agents } = await import("../src/db/schema.js");
const { eq } = await import("drizzle-orm");

let raw: pg.Client;
let db: ReturnType<typeof makeDb>["db"];
const id = async (table: string, slug: string) => (await raw.query(`select id from ${table} where slug = $1`, [slug])).rows[0].id as string;
const agentRow = async (slug: string) => (await db.select().from(agents).where(eq(agents.slug, slug)).limit(1))[0]!;

before(async () => {
  raw = await resetTestDb();
  ({ db } = makeDb());
  await seedOrg(db);
});

beforeEach(async () => {
  await raw.query(`delete from agent_runs`);
  await raw.query(`delete from consultas`);
  await raw.query(`update runner_settings set company_paused = false`);
  await raw.query(`update projects set runs_paused = false`);
});

after(async () => {
  await raw?.end();
});

// ---- T1

test("I60-1 #1: two parallel inserts for one (agent, project, work key) leave one row; the other coalesces", async () => {
  const po = await agentRow("po-micasa");
  const project = { id: await id("projects", "micasa") };
  const base = { agent: po, project, role: "product-owner", taskKey: "MIC-7", trigger: "event" as const, summary: "queued: event x" };
  const outs = await Promise.all(
    Array.from({ length: 6 }, (_, i) => db.transaction((tx) => queue.insertRun(tx, { ...base, reason: `reason ${i}` }))),
  );
  assert.equal(outs.filter((o) => o.kind === "queued").length, 1, JSON.stringify(outs.map((o) => o.kind)));
  assert.equal(outs.filter((o) => o.kind === "coalesced").length, 5);
  const rows = (await raw.query(`select work_key, trigger, lane, reason from agent_runs`)).rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].work_key, "task:MIC-7");
  assert.equal(rows[0].trigger, "event");
  assert.equal(rows[0].lane, "work");
  // The coalesced wakes added their reasons to the queued run, once each.
  for (let i = 0; i < 6; i++) assert.ok(rows[0].reason.includes(`reason ${i}`), rows[0].reason);
  // Different work keys: two more rows for the same agent.
  await queue.insertRun(db, { ...base, taskKey: "MIC-8" });
  await queue.insertRun(db, { ...base, taskKey: null });
  const keys = (await raw.query(`select work_key from agent_runs order by work_key`)).rows.map((r) => r.work_key);
  assert.deepEqual(keys, ["general", "task:MIC-7", "task:MIC-8"]);
});

test("I60-1 #1b: a wake for a live run is kept as absorbed; once the run ends the key is free again", async () => {
  const po = await agentRow("po-micasa");
  const project = { id: await id("projects", "micasa") };
  const base = { agent: po, project, role: "product-owner", taskKey: "MIC-9", trigger: "event" as const, summary: "s" };
  const first = await queue.insertRun(db, { ...base, reason: "first" });
  assert.equal(first.kind, "queued");
  await raw.query(`update agent_runs set status = 'running'`);
  const second = await queue.insertRun(db, { ...base, reason: "while you worked" });
  assert.equal(second.kind, "coalesced");
  const row = (await raw.query(`select reason, absorbed from agent_runs`)).rows[0];
  assert.equal(row.reason, "first");
  assert.equal(row.absorbed, "while you worked");
  await raw.query(`update agent_runs set status = 'ok', ended_at = now()`);
  assert.equal((await queue.insertRun(db, { ...base, reason: "again" })).kind, "queued");
});

test("I60-1 #1c: enqueueWake for a question uses its own work key and lane", async () => {
  const po = await agentRow("po-micasa");
  const project = { id: await id("projects", "micasa"), slug: "micasa" };
  const c = (await raw.query(`insert into consultas (project_id, agent_id, text) values ($1, $2, '¿Hay forma de exportar a Excel?') returning id`, [project.id, po.id])).rows[0].id as string;
  const busy = await events.enqueueWake(db, { agent: po, project, taskKey: null, reason: "general work" });
  assert.equal(busy.kind, "queued");
  const q = await events.enqueueWake(db, { agent: po, project, taskKey: null, reason: consultas.consultaReason(c), trigger: "consulta", consultaId: c });
  assert.equal(q.kind, "queued", "a question does not coalesce into the PO's other work");
  const row = (await raw.query(`select work_key, lane, trigger from agent_runs where id = $1`, [(q as { runId: string }).runId])).rows[0];
  assert.deepEqual(row, { work_key: `consulta:${c}`, lane: "consulta", trigger: "consulta" });
});

test("I60-1 #2: the migration backfills work_key, trigger, lane and reason, and ends duplicate active rows", async () => {
  const po = await id("agents", "po-micasa");
  const project = await id("projects", "micasa");
  const sql = readFileSync(path.join(import.meta.dirname, "../drizzle/migrations", readdirSync(path.join(import.meta.dirname, "../drizzle/migrations")).find((f) => f.startsWith("0060_"))!), "utf8");
  const updates = sql
    .split("--> statement-breakpoint")
    .map((x) => x.trim())
    .filter((x) => /^UPDATE/i.test(x));
  assert.equal(updates.length, 5);
  // Rows as they looked before 0060: defaults in the new columns, meaning in summary.
  await raw.query(`drop index agent_runs_active_work_unique`);
  try {
    const c = (await raw.query(`insert into consultas (project_id, agent_id, text) values ($1, $2, '¿Dónde se guarda el teléfono?') returning id`, [project, po])).rows[0].id;
    const ins = async (task: string | null, status: string, summary: string, at: string) =>
      (await raw.query(`insert into agent_runs (agent_id, project_id, task_key, role, status, summary, queued_at) values ($1, $2, $3, 'product-owner', $4, $5, $6) returning id`, [po, project, task, status, summary, at])).rows[0].id as string;
    const ev = await ins("MIC-1", "ok", "queued: event ticket ready", "2026-11-01T00:00:00Z");
    const dupOld = await ins("MIC-2", "queued", "queued: cap reached", "2026-11-02T00:00:00Z");
    const dupNew = await ins("MIC-2", "queued", "queued: cap reached", "2026-11-03T00:00:00Z");
    const q = await ins(null, "queued", `queued: event [pregunta] [consulta ${c}] El dueño pregunta`, "2026-11-04T00:00:00Z");
    await raw.query(`update consultas set run_id = $1 where id = $2`, [q, c]);
    for (const u of updates) await raw.query(u);
    const get = async (rid: string) => (await raw.query(`select work_key, trigger, lane, reason, status from agent_runs where id = $1`, [rid])).rows[0];
    assert.deepEqual(await get(ev), { work_key: "task:MIC-1", trigger: "event", lane: "work", reason: "ticket ready", status: "ok" });
    assert.equal((await get(dupOld)).status, "queued", "the oldest duplicate stays");
    assert.equal((await get(dupNew)).status, "skipped", "the newer duplicate is ended");
    const qr = await get(q);
    assert.equal(qr.work_key, `consulta:${c}`);
    assert.equal(qr.lane, "consulta");
    assert.match(qr.reason, /\[pregunta\]/);
  } finally {
    await raw.query(`delete from agent_runs`);
    await raw.query(`create unique index agent_runs_active_work_unique on agent_runs (agent_id, project_id, work_key) where status in ('queued', 'starting', 'running')`);
  }
});

test("I60-1 #3: nothing reads a run's meaning from its summary", () => {
  const root = path.join(import.meta.dirname, "../src");
  const files: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (p.endsWith(".ts")) files.push(p);
    }
  };
  walk(root);
  const bad: string[] = [];
  for (const f of files) {
    const text = readFileSync(f, "utf8");
    for (const [n, line] of text.split("\n").entries()) {
      if (/consultaIdOf\([^)]*summary/.test(line) || /summary\.(startsWith|includes)\((EVENT_SUMMARY|PREGUNTA_MARK)/.test(line)) bad.push(`${path.relative(root, f)}:${n + 1}`);
    }
  }
  assert.deepEqual(bad, []);
});

test("I60-1 #4: run sessions are 16 hex; two runs sharing their first 8 hex map to the right agent and run", async () => {
  const po = await agentRow("po-micasa");
  const taller = await agentRow("taller-micasa");
  const project = await id("projects", "micasa");
  const a = "abcdef12-0000-4000-8000-000000000001";
  const b = "abcdef12-1111-4000-8000-000000000002";
  await raw.query(`insert into agent_runs (id, agent_id, project_id, role, status, summary, queued_at, work_key) values ($1, $2, $3, 'product-owner', 'ok', 's', now() - interval '1 hour', 'general'), ($4, $5, $3, 'taller', 'ok', 's', now() - interval '2 hours', 'general')`, [a, po.id, project, b, taller.id]);
  assert.equal(sessions.runSession(a), "run-abcdef1200004000");
  assert.ok(sessions.isRunSession(sessions.runSession(b)));
  assert.ok(sessions.isRunSession("run-abcdef12"), "the old 8-hex form still reads");
  assert.equal((await events.agentOfActor(db, { agent: "x", session_id: sessions.runSession(a) }))?.slug, "po-micasa");
  assert.equal((await events.agentOfActor(db, { agent: "x", session_id: sessions.runSession(b) }))?.slug, "taller-micasa");
  // answer_consulta: only the question's own run (either spelling) may answer for the PO.
  const c = (await raw.query(`insert into consultas (project_id, agent_id, text, run_id) values ($1, $2, '¿Quién puede ver el panel?', $3) returning id`, [project, po.id, a])).rows[0].id as string;
  const answer = { project: "micasa", id: c, short: "Sí." };
  await assert.rejects(consultas.answerConsulta(db, answer, { agent: "Claude Code", session_id: sessions.runSession(b) }), (e: { code?: string }) => e.code === "CONSULTA_FORBIDDEN");
  const ok = await consultas.answerConsulta(db, answer, { agent: "Claude Code", session_id: sessions.runSession(a) });
  assert.equal(ok.id, c);
});

// ---- T2: admission

const runner = await import("../src/runner/runner.js");
const writes = await import("../src/mcp/writes.js");
const { carefulGit } = await import("../src/runner/worktree.js");
const { EventEmitter } = await import("node:events");
const { PassThrough } = await import("node:stream");
const { mkdirSync, mkdtempSync, rmSync } = await import("node:fs");
const { tmpdir } = await import("node:os");

const scratch = mkdtempSync(path.join(tmpdir(), "plania-i60-"));
const ACT = { actor: { agent: "test", session_id: "s" } } as never;

class FakeChild extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  constructor(readonly pid: number) {
    super();
  }
  finish(): void {
    const result = { type: "result", subtype: "success", is_error: false, num_turns: 1, session_id: "sess-i60", result: "OK", modelUsage: { "claude-opus-5-5": { inputTokens: 1, outputTokens: 1, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 } } };
    this.stdout.write(`${JSON.stringify(result)}\n`);
    this.stdout.end();
    setImmediate(() => this.emit("exit", 0, null));
  }
}
function fakes(gitCalls: string[][] = []) {
  const spawned: FakeChild[] = [];
  let n = 90_000;
  const deps = {
    env: { HOME: scratch, PATH: "/usr/bin:/bin", PLANIA_RUNNER_TOKEN: "runner-token", PLANIA_PROMPTS_PROJECT: "micasa", CLAUDE_CODE_BIN: "/fake/bin/claude", PLANIA_EVENT_WAKES: "1", PLANIA_WORKER_ID: "test:main", PLANIA_WORKER_MAX_RUNS: "50" } as NodeJS.ProcessEnv,
    logDir: path.join(scratch, "logs"),
    tmpDir: path.join(scratch, "tmp"),
    worktreeRoot: path.join(scratch, "worktrees"),
    graceMs: 10,
    liveFlushMs: 0,
    footprints: false,
    git: async (args: string[]) => {
      gitCalls.push(args);
      return { code: 0, stdout: "", stderr: "" };
    },
    spawn: () => {
      const c = new FakeChild(++n);
      spawned.push(c);
      return c;
    },
    kill: () => undefined,
    reportTokens: async () => undefined,
    probeUsage: async () => null,
    machine: () => ({ freeMb: 99_999, freeDiskGb: 999 }),
  };
  return { deps, spawned };
}

const projectId = async (slug: string) => id("projects", slug);
const ticketIn = async (project: string, title: string, extra: Record<string, unknown> = {}) =>
  ((await writes.createTask(db, { project, title, scope: "s", checks: ["c"], status: "Ready", ...extra } as never, ACT)) as { key: string }).key;
const queueRun = async (agent: string, project: string, key: string | null, lane: "work" | "consulta" = "work") =>
  (
    await raw.query(
      `insert into agent_runs (agent_id, project_id, role, status, summary, task_key, work_key, trigger, lane) values ($1, $2, (select coalesce(role_template, role) from agents where slug = $3), 'queued', 'queued: event x', $4, $5, 'event', $6) returning id`,
      [await id("agents", agent), await projectId(project), agent, key, lane === "consulta" ? `consulta:${crypto.randomUUID()}` : key ? `task:${key}` : "general", lane],
    )
  ).rows[0].id as string;
const liveRun = async (agent: string, project: string, key: string) =>
  raw.query(
    `insert into agent_runs (agent_id, project_id, role, status, summary, task_key, work_key, trigger, started_at, worker_id) values ($1, $2, 'taller', 'running', 'running', $3, 'task:' || $3, 'event', now() - interval '10 minutes', 'other:main')`,
    [await id("agents", agent), await projectId(project), key],
  );
const statusOf = async (runId: string) => (await raw.query(`select status, held_code from agent_runs where id = $1`, [runId])).rows[0] as { status: string; held_code: string | null };
const setRunner = (slug: string, runner: Record<string, unknown>) =>
  raw.query(`update projects set settings = coalesce(settings, '{}'::jsonb) || jsonb_build_object('runner', $2::jsonb) where slug = $1`, [slug, JSON.stringify(runner)]);

const t2Reset = async () => {
  await runner.waitForAllRuns();
  runner.resetRunnerForTests();
  await raw.query(`delete from agent_runs`);
  await raw.query(`delete from run_locks`);
  await raw.query(`delete from runner_reservations`);
  await raw.query(`update runner_settings set max_concurrent = 10, cooldown_minutes = 0, max_starts_per_minute = 100`);
  await raw.query(`update projects set settings = settings - 'runner'`);
  await raw.query(`delete from plan_readings`);
  await raw.query(`insert into plan_readings (at, source, status, five_hour_pct, five_hour_resets_at) values (now(), 'stream', 'allowed', 10, now() + interval '3 hours')`);
  for (const slug of ["micasa", "workia"]) {
    const repo = path.join(scratch, `repo-${slug}`);
    mkdirSync(repo, { recursive: true });
    await raw.query(`update projects set settings = coalesce(settings, '{}'::jsonb) || $2::jsonb where slug = $1`, [slug, JSON.stringify({ local: { repo_path: repo } })]);
    const actor = JSON.stringify({ agent: "test", session_id: "s" });
    await raw.query(`insert into docs (project_id, title, markdown, actor) select $1, t.title, '# ' || t.title, $2 from (values ('Prompt: Taller'), ('Prompt: Research')) t(title) where not exists (select 1 from docs where project_id = $1 and title = t.title)`, [await projectId(slug), actor]);
  }
};
const finishAll = async (f: ReturnType<typeof fakes>) => {
  for (const c of f.spawned) c.finish();
  await runner.waitForAllRuns();
};

test("I60-2 #1: a full project waits (project_cap) while another project starts; its question still starts", async () => {
  await t2Reset();
  await setRunner("micasa", { max_concurrent: 2, max_per_agent: 5 });
  await setRunner("workia", { max_concurrent: 1 });
  await liveRun("taller-micasa", "micasa", await ticketIn("micasa", "Uno"));
  await liveRun("taller-micasa", "micasa", await ticketIn("micasa", "Dos"));
  const a = await queueRun("taller-micasa", "micasa", await ticketIn("micasa", "Tres"));
  const b = await queueRun("taller-workia", "workia", await ticketIn("workia", "Cuatro"));
  const f = fakes();
  const r = await runner.drainQueue(db, new Date(), f.deps as never);
  assert.equal(r.started, 1);
  assert.deepEqual(await statusOf(a), { status: "queued", held_code: "project_cap" });
  assert.equal((await statusOf(b)).status, "running");
  await finishAll(f);
});

test("I60-2 #2: per-agent cap: the agent's next run waits (agent_cap) while another agent of the project starts", async () => {
  await t2Reset();
  await setRunner("micasa", { max_concurrent: 5, max_per_agent: 2 });
  const f = fakes();
  const runs = [];
  for (const t of ["A", "B", "C"]) runs.push(await queueRun("taller-micasa", "micasa", await ticketIn("micasa", `Ticket ${t}`)));
  const po = await queueRun("research-micasa", "micasa", await ticketIn("micasa", "Investigar"));
  const r = await runner.drainQueue(db, new Date(), f.deps as never);
  assert.equal(r.started, 3, JSON.stringify((await raw.query(`select status, held_code, summary from agent_runs`)).rows));
  const states = await Promise.all(runs.map(statusOf));
  assert.deepEqual(states.map((s) => s.status).sort(), ["queued", "running", "running"]);
  assert.equal(states.find((s) => s.status === "queued")!.held_code, "agent_cap");
  assert.equal((await statusOf(po)).status, "running");
  await finishAll(f);
});

test("I60-2 #3: the ceiling minus a reservation holds everything else (ceiling)", async () => {
  await t2Reset();
  await raw.query(`update runner_settings set max_concurrent = 3`);
  await setRunner("micasa", { max_concurrent: 5, max_per_agent: 5 });
  await raw.query(`insert into runner_reservations (label, slots, holder, expires_at) values ('brief', 1, 'other', now() + interval '1 hour')`);
  const ids = [];
  for (const t of ["A", "B", "C"]) ids.push(await queueRun("taller-micasa", "micasa", await ticketIn("micasa", `Techo ${t}`)));
  const f = fakes();
  const r = await runner.drainQueue(db, new Date(), f.deps as never);
  assert.equal(r.started, 2);
  assert.equal((await Promise.all(ids.map(statusOf))).filter((s) => s.held_code === "ceiling").length, 1);
  await finishAll(f);
});

test("I60-2 #4: two tickets on one branch: the second waits (lock) and starts when the first ends", async () => {
  await t2Reset();
  await setRunner("micasa", { max_concurrent: 5, max_per_agent: 5 });
  const k1 = await ticketIn("micasa", "Fase uno");
  const k2 = await ticketIn("micasa", "Fase dos");
  await raw.query(`update tasks set branch = 'jl/shared-branch' where key in ($1, $2)`, [k1, k2]);
  const r1 = await queueRun("taller-micasa", "micasa", k1);
  const r2 = await queueRun("taller-micasa", "micasa", k2);
  const f = fakes();
  assert.equal((await runner.drainQueue(db, new Date(), f.deps as never)).started, 1);
  assert.equal((await statusOf(r1)).status, "running");
  assert.deepEqual(await statusOf(r2), { status: "queued", held_code: "lock" });
  await finishAll(f);
  assert.equal(Number((await raw.query(`select count(*) from run_locks`)).rows[0].count), 0, "a finished run frees its keys");
  assert.equal((await runner.drainQueue(db, new Date(), f.deps as never)).started, 1);
  assert.equal((await statusOf(r2)).status, "running");
  await finishAll(f);
});

test("I60-2 #5: plan projection: at 60% with a 70% guard and 3% per Opus run, at most 3 start; the rest wait (plan)", async () => {
  await t2Reset();
  await setRunner("micasa", { max_concurrent: 10, max_per_agent: 10 });
  await raw.query(`update runner_settings set default_model = 'opus', default_effort = 'medium', est_pct_per_run = 3`);
  await raw.query(`delete from plan_readings`);
  await raw.query(`insert into plan_readings (at, source, status, five_hour_pct, five_hour_resets_at) values (now() - interval '1 minute', 'stream', 'allowed', 60, now() + interval '3 hours')`);
  const ids = [];
  for (const t of ["A", "B", "C", "D", "E"]) ids.push(await queueRun("taller-micasa", "micasa", await ticketIn("micasa", `Plan ${t}`)));
  const f = fakes();
  const r = await runner.drainQueue(db, new Date(), f.deps as never);
  assert.equal(r.started, 3);
  assert.equal((await Promise.all(ids.map(statusOf))).filter((s) => s.held_code === "plan").length, 2);
  await raw.query(`update runner_settings set default_model = null, default_effort = null`);
  await finishAll(f);
});

test("I60-2 #6: git on one repo retries a lock error and fetches at most once a minute", async () => {
  const calls: string[][] = [];
  let failed = false;
  const git = carefulGit(
    async (args) => {
      calls.push(args);
      if (args[0] === "worktree" && !failed) {
        failed = true;
        return { code: 128, stdout: "", stderr: "fatal: Unable to create '/r/.git/index.lock': File exists." };
      }
      return { code: 0, stdout: "", stderr: "" };
    },
    async () => undefined,
  );
  assert.equal((await git(["worktree", "add", "x"], "/r")).code, 0);
  assert.equal(calls.filter((c) => c[0] === "worktree").length, 2);
  await git(["fetch", "origin", "sandbox"], "/r");
  await git(["fetch", "origin", "sandbox"], "/r");
  assert.equal(calls.filter((c) => c[0] === "fetch").length, 1);
});

after(() => rmSync(scratch, { recursive: true, force: true }));

// ---- T3: runs that outlive the server

const proc = await import("../src/runner/process.js");
const FAKE = path.join(import.meta.dirname, "fixtures/fake-claude.mjs");
const detachedDeps = (ms = 300) => {
  const f = fakes();
  // The fake git makes the worktree folder, so the wrapper has a real cwd.
  const git = async (args: string[]) => {
    if (args[0] === "worktree" && args[1] === "add") mkdirSync(args[args[2] === "--no-track" ? 3 : 2]!, { recursive: true });
    return { code: 0, stdout: "", stderr: "" };
  };
  const deps = { ...f.deps, git, spawn: undefined, detached: true, pollMs: 50, env: { ...f.deps.env, CLAUDE_CODE_BIN: FAKE, CLAUDE_FAKE_MS: String(ms), PATH: process.env.PATH } };
  return deps;
};

test("I60-3 #1: the wrapper owns the run: log and exit file on disk, the tail reads every line", async () => {
  const logPath = path.join(scratch, "logs", `wrapper-${Date.now()}.jsonl`);
  const chunks: string[] = [];
  const p = proc.superviseDetached({ command: FAKE, args: [], cwd: scratch, env: { ...process.env, FAKE_MS: "200" }, logPath, timeoutMs: 30_000, graceMs: 100, runId: "r-1", pollMs: 50, onStdout: (c) => chunks.push(c) });
  assert.ok(p.pid && p.pid > 0);
  const exit = await p.done;
  assert.equal(exit.code, 0);
  const lines = chunks.join("").trim().split("\n");
  assert.equal(JSON.parse(lines.at(-1)!).type, "result");
  assert.equal(JSON.parse(readFileSync(proc.exitPathOf(logPath), "utf8")).code, 0);
});

test("I60-3 #2: a restart in the middle of a run: queued rows stay, the live run is found again and finished once", async () => {
  await t2Reset();
  await setRunner("micasa", { max_concurrent: 5, max_per_agent: 5 });
  const deps = detachedDeps(1500);
  const key = await ticketIn("micasa", "Sobrevive al reinicio");
  const runId = await queueRun("taller-micasa", "micasa", key);
  const waiting = await queueRun("taller-micasa", "micasa", await ticketIn("micasa", "Espera en la cola"));
  await raw.query(`update agents set max_parallel = 1 where slug = 'taller-micasa'`);
  try {
    const r = await runner.drainQueue(db, new Date(), deps as never);
    assert.equal(r.started, 1);
    assert.equal((await statusOf(runId)).status, "running");
    // The server "restarts": its memory of live runs is gone; the wrapper keeps going.
    runner.resetRunnerForTests();
    assert.equal(await runner.sweepOrphans(db, deps as never), 1);
    assert.equal((await statusOf(waiting)).status, "queued", "a restart leaves queued runs queued");
    await runner.waitForAllRuns();
    await new Promise((r2) => setTimeout(r2, 300));
    const row = (await raw.query(`select status, turns from agent_runs where id = $1`, [runId])).rows[0];
    assert.equal(row.status, "ok");
    const hb = Number((await raw.query(`select count(*) from heartbeat_runs where task_key = $1`, [key])).rows[0].count);
    assert.equal(hb, 1, "finished exactly once though two followers saw it end");
    assert.equal(Number((await raw.query(`select count(*) from run_locks where run_id = $1`, [runId])).rows[0].count), 0);
  } finally {
    await raw.query(`update agents set max_parallel = null where slug = 'taller-micasa'`);
  }
});

test("I60-3 #3: a worker whose lease ran out has its runs ended (worker lost) and their keys freed", async () => {
  await t2Reset();
  const k = await ticketIn("micasa", "Trabajador perdido");
  const rid = (
    await raw.query(
      `insert into agent_runs (agent_id, project_id, role, status, summary, task_key, work_key, trigger, started_at, worker_id, lease_until) values ($1, $2, 'taller', 'running', 'running', $3, 'task:' || $3, 'event', now() - interval '20 minutes', 'gone:main', now() - interval '5 minutes') returning id`,
      [await id("agents", "taller-micasa"), await projectId("micasa"), k],
    )
  ).rows[0].id;
  await raw.query(`insert into run_locks (lock_key, run_id) values ('task:x:${k}', $1)`, [rid]);
  await runner.drainQueue(db, new Date(), fakes().deps as never);
  const row = (await raw.query(`select status, summary from agent_runs where id = $1`, [rid])).rows[0];
  assert.deepEqual(row, { status: "fail", summary: "fail: worker lost" });
  assert.equal(Number((await raw.query(`select count(*) from run_locks`)).rows[0].count), 0);
});

test("I60-3 #4: a stop asked from any process reaches the run's own worker; a wake while it runs gets one retry after", async () => {
  await t2Reset();
  await setRunner("micasa", { max_concurrent: 5, max_per_agent: 5 });
  const key = await ticketIn("micasa", "Parar desde otro lado");
  const rid = await queueRun("taller-micasa", "micasa", key);
  const killed: string[] = [];
  const f = fakes();
  const deps = { ...f.deps, kill: (_pid: number, sig: string) => killed.push(sig) };
  await runner.drainQueue(db, new Date(), deps as never);
  assert.equal((await statusOf(rid)).status, "running");
  // A wake for the same work while it runs is absorbed.
  const taller = await agentRow("taller-micasa");
  const w = await events.enqueueWake(db, { agent: taller, project: { id: await projectId("micasa"), slug: "micasa" }, taskKey: key, reason: "ci red" });
  assert.equal(w.kind, "none");
  await raw.query(`update agent_runs set stop_requested = 'detenido desde el teléfono' where id = $1`, [rid]);
  assert.equal(await runner.actOnStopRequests(db), 1);
  assert.deepEqual(killed.slice(0, 1), ["SIGINT"]);
  f.spawned[0]!.finish();
  await runner.waitForAllRuns();
  // Stopped runs do not retry what they absorbed; an ok one does.
  const rid2 = await queueRun("taller-micasa", "micasa", await ticketIn("micasa", "Otro"));
  await runner.drainQueue(db, new Date(), f.deps as never);
  const k2 = (await raw.query(`select task_key from agent_runs where id = $1`, [rid2])).rows[0].task_key;
  await events.enqueueWake(db, { agent: taller, project: { id: await projectId("micasa"), slug: "micasa" }, taskKey: k2, reason: "review" });
  f.spawned[1]!.finish();
  await runner.waitForAllRuns();
  const retry = (await raw.query(`select trigger, reason from agent_runs where work_key = 'task:' || $1 and status = 'queued'`, [k2])).rows;
  assert.equal(retry.length, 1);
  assert.equal(retry[0].trigger, "retry");
  assert.match(retry[0].reason, /review/);
});

// ---- T4: the idea pipeline

const { sweepStalledIdeas } = await import("../src/runner/stalled.js");

const ideaIn = async (title: string, stage: string) => {
  const key = ((await writes.createTask(db, { project: "micasa", kind: "idea", title, scope: "s" } as never, ACT)) as { key: string }).key;
  if (stage !== "idea") await raw.query(`update tasks set stage = $2 where key = $1`, [key, stage]);
  return key;
};
const runsOn = async (key: string) => (await raw.query(`select a.slug, r.status, r.trigger from agent_runs r join agents a on a.id = r.agent_id where r.task_key = $1 order by r.queued_at`, [key])).rows as { slug: string; status: string; trigger: string }[];

test("I60-4 #1: an idea moved to planning wakes the PO on it (before, nothing did)", async () => {
  await t2Reset();
  await raw.query(`update projects set runs_paused = false where slug = 'micasa'`);
  const key = await ideaIn("Usar shadcn en toda la app", "design");
  await raw.query(`delete from agent_runs`);
  const v = (await raw.query(`select version from tasks where key = $1`, [key])).rows[0].version;
  // The stage move as an agent makes it (no doc requirement is checked for an event's target).
  await writes.setTask(db, { project: "micasa", key, stage: "planning", version: v } as never, ACT).catch(async () => {
    // Without the Design doc the move is refused; write the event the hook reads instead.
    await raw.query(`update tasks set stage = 'planning' where key = $1`, [key]);
    const { onWriteEvent } = await import("../src/runner/events.js");
    const t = (await raw.query(`select id from tasks where key = $1`, [key])).rows[0];
    await onWriteEvent(db, { id: await projectId("micasa"), slug: "micasa" }, "task.updated", { id: t.id, key }, { changes: { stage: ["design", "planning"] } }, { PLANIA_EVENT_WAKES: "1" } as never);
  });
  const runs = await runsOn(key);
  assert.equal(runs.length, 1, JSON.stringify(runs));
  assert.equal(runs[0]!.slug, "po-micasa");
  assert.equal(runs[0]!.status, "queued");
});

test("I60-4 #2: an idea left in a stage with no run of its owner gets one retry; a second sweep queues nothing", async () => {
  await t2Reset();
  await raw.query(`update projects set runs_paused = false where slug = 'micasa'`);
  const key = await ideaIn("Panel de usuarios", "planning");
  await raw.query(`delete from agent_runs`);
  // Only the Artist ran on it (before it reached planning).
  await raw.query(`insert into agent_runs (agent_id, project_id, role, status, summary, task_key, work_key, trigger, queued_at, ended_at) values ($1, $2, 'artist', 'ok', 'ok', $3, 'task:' || $3, 'event', now() - interval '2 days', now() - interval '2 days')`, [await id("agents", "artist-micasa"), await projectId("micasa"), key]);
  const t = (await raw.query(`select id from tasks where key = $1`, [key])).rows[0];
  await raw.query(`insert into events (project_id, task_id, task_key, type, actor, payload) values ($1, $2, $3, 'task.updated', '{"agent":"artist-micasa","session_id":"s"}', '{"changes":{"stage":["design","planning"]}}')`, [await projectId("micasa"), t.id, key]);
  const env = { PLANIA_EVENT_WAKES: "1" } as NodeJS.ProcessEnv;
  assert.ok((await sweepStalledIdeas(db, new Date(), env)) >= 1);
  const runs = (await runsOn(key)).filter((r) => r.status === "queued");
  assert.deepEqual(runs.map((r) => [r.slug, r.trigger]), [["po-micasa", "retry"]]);
  assert.equal((await runsOn(key)).filter((r) => r.status === "queued").length, 1);
  await sweepStalledIdeas(db, new Date(), env);
  assert.equal((await runsOn(key)).filter((r) => r.status === "queued").length, 1, "the second sweep queues nothing more");
});

test("I60-4 #3: a question run does not start the PO's rest; an event run starts at once; a cadence run waits", async () => {
  await t2Reset();
  await raw.query(`update runner_settings set cooldown_minutes = 30`);
  await setRunner("micasa", { max_concurrent: 5, max_per_agent: 5 });
  await raw.query(`insert into goals (project_id, title) select $1, 'Meta' where not exists (select 1 from goals where project_id = $1)`, [await projectId("micasa")]);
  const po = await id("agents", "po-micasa");
  // The PO just answered a question.
  await raw.query(`insert into agent_runs (agent_id, project_id, role, status, summary, work_key, trigger, lane, started_at, ended_at) values ($1, $2, 'product-owner', 'ok', 'ok', 'consulta:00000000-0000-4000-8000-000000000001', 'consulta', 'consulta', now() - interval '3 minutes', now() - interval '1 minute')`, [po, await projectId("micasa")]);
  // A Ready ticket owned by the PO: the event hook queues the PO's run on it.
  const owned = await ticketIn("micasa", "Pedido del dueño", { owner_agent: "po-micasa" });
  const ev = (await raw.query(`select id from agent_runs where work_key = 'task:' || $1 and status = 'queued'`, [owned])).rows[0]?.id ?? (await queueRun("po-micasa", "micasa", owned));
  await raw.query(`insert into docs (project_id, title, markdown, actor) select $1, 'Prompt: Product owner', '# PO', '{"agent":"t","session_id":"s"}' where not exists (select 1 from docs where project_id = $1 and title = 'Prompt: Product owner')`, [await projectId("micasa")]);
  const f = fakes();
  await runner.drainQueue(db, new Date(), f.deps as never);
  assert.equal((await statusOf(ev)).status, "running", "the question did not start a rest");
  await finishAll(f);
  // A cadence run of the PO after a cadence run that just ended waits its rest.
  await raw.query(`insert into agent_runs (agent_id, project_id, role, status, summary, work_key, trigger, started_at, ended_at) values ($1, $2, 'product-owner', 'ok', 'ok', 'task:OLD', 'cadence', now() - interval '3 minutes', now() - interval '1 minute')`, [po, await projectId("micasa")]);
  const cad = (await raw.query(`insert into agent_runs (agent_id, project_id, role, status, summary, work_key, trigger) values ($1, $2, 'product-owner', 'queued', 'queued', 'general', 'cadence') returning id`, [po, await projectId("micasa")])).rows[0].id;
  await runner.drainQueue(db, new Date(), f.deps as never);
  assert.deepEqual(await statusOf(cad), { status: "queued", held_code: "rest" });
  await raw.query(`update runner_settings set cooldown_minutes = 0`);
});

// ---- T5: the screen's preview of admission

const alv = await import("../ui/src/lib/a-la-vez.js");



test("I60-5 #1: the preview says what Guardar would start and offers the number that unblocks the rest", () => {
  const team = [{ agent: "po-x", role: "product-owner" }, { agent: "taller-x", role: "taller" }] as never;
  const r = {
    limits: { max_concurrent: 2, consulta_slots: 1, max_per_agent: 1, serialize_areas: true },
    live: { work: 2, consulta: 0 },
    ceiling: { max: 3, live: 3, live_other_projects: 1, reserved: 0, capacity: 12 },
    plan: { pct: 42, guard: 70, state: "ok", override: false, est_pct: 3, live_weight: 0 },
    queue: [
      { run_id: "a", agent: "po-x", lane: "work", ticket: "X-1", title: "Panel de usuarios", kind: "idea", waited_min: 22, held_code: "ceiling", held_detail: null, weight: 3 },
      { run_id: "b", agent: "taller-x", lane: "work", ticket: "X-2", title: "CSV", kind: "ticket", waited_min: 9, held_code: "areas", held_detail: {}, weight: 3 },
    ],
    seats: [
      { agent: "po-x", max_parallel: null, cap: 1, live: [{ run_id: "l1" }], queued: 1 },
      { agent: "taller-x", max_parallel: null, cap: 1, live: [{ run_id: "l2" }], queued: 1 },
    ],
  } as never;
  let c = alv.countsOf(r, team)!;
  let p = alv.previewAdmission(r, c, team, "Mianovia");
  assert.equal(p.verdicts[0]!.code, "ceiling");
  assert.equal(p.verdicts[0]!.fix!.label, "Subir el tope de la Mac a 4");
  assert.equal(p.verdicts[1]!.code, "areas", "same files is not something a number fixes");
  assert.equal(p.verdicts[1]!.fix, null);
  // Apply each fix in turn, as the owner would from the queue card.
  c = p.verdicts[0]!.fix!.apply(c);
  p = alv.previewAdmission(r, c, team, "Mianovia");
  assert.equal(p.verdicts[0]!.code, "project_cap");
  c = p.verdicts[0]!.fix!.apply(c);
  p = alv.previewAdmission(r, c, team, "Mianovia");
  assert.equal(p.verdicts[0]!.code, "agent_cap");
  assert.equal(p.verdicts[0]!.fix!.label, "Dejar que PO haga 2");
  c = p.verdicts[0]!.fix!.apply(c);
  p = alv.previewAdmission(r, c, team, "Mianovia");
  assert.equal(p.verdicts[0]!.starts, true);
  assert.equal(p.planAdd, 3);
  // The save carries exactly the changed numbers.
  const save = alv.withCounts({ project: "mianovia" }, alv.countsOf(r, team), c);
  assert.deepEqual(save, { project: "mianovia", seats: [{ agent: "po-x", max_parallel: 2 }], floor: { max_concurrent: 3 }, company: { max_concurrent: 4 } });
});

// ---- PLA-58: what a run really changes, and the files every step builds on.

const touchedMod = await import("../src/runner/touched.js");
const { writeFileSync } = await import("node:fs");
const areasOf = async (key: string) => (await raw.query(`select areas from tasks where key = $1`, [key])).rows[0].areas as string[];
const heldOf = async (runId: string) => (await raw.query(`select status, held_code, held_detail from agent_runs where id = $1`, [runId])).rows[0] as { status: string; held_code: string | null; held_detail: Record<string, unknown> | null };

test("PLA-58 #1: a live Taller run's changed files outside its areas join them on the next tick; covered files add nothing", async () => {
  await t2Reset();
  const key = await ticketIn("micasa", "Registro con piezas", { areas: ["src/app/registro/**"] });
  const wt = path.join(scratch, "wt-touched");
  mkdirSync(wt, { recursive: true });
  writeFileSync(path.join(wt, ".git"), "gitdir: /nowhere\n");
  await raw.query(
    `insert into agent_runs (agent_id, project_id, role, status, summary, task_key, work_key, trigger, started_at, worker_id, worktree_path, lane)
     values ($1, $2, 'taller', 'running', 'running', $3, 'task:' || $3, 'event', now(), 'other:main', $4, 'work')`,
    [await id("agents", "taller-micasa"), await projectId("micasa"), key, wt],
  );
  const out: Record<string, string> = {
    diff3: "src/app/registro/formulario.tsx\nsrc/components/ui/native-select.tsx\n",
    diffHead: "src/app/registro/formulario.tsx\n",
    others: "src/app/registro/nuevo.tsx\n",
  };
  const git = async (args: string[]) => ({ code: 0, stderr: "", stdout: args[0] === "ls-files" ? out.others! : args[2] === "HEAD" ? out.diffHead! : out.diff3! });
  const { version } = (await raw.query(`select version from tasks where key = $1`, [key])).rows[0];

  assert.deepEqual(await touchedMod.sweepTouched(db, { git }), { grown: 1 });
  assert.deepEqual(await areasOf(key), ["src/app/registro/**", "src/components/ui/native-select.tsx"]);
  const ev = (await raw.query(`select actor, payload from events where task_key = $1 and type = 'task.areas_touched'`, [key])).rows;
  assert.deepEqual(ev.map((e) => [e.actor.session_id, e.payload.files]), [["system", ["src/components/ui/native-select.tsx"]]]);
  assert.equal((await raw.query(`select version from tasks where key = $1`, [key])).rows[0].version, version, "derived, not an edit: the run's own writes are not refused");
  assert.deepEqual(await touchedMod.sweepTouched(db, { git }), { grown: 0 }, "covered now");

  // Many new files in one folder become the folder.
  out.diff3 = Array.from({ length: 14 }, (_, i) => `src/lib/gen/f${i}.ts`).join("\n");
  assert.deepEqual(await touchedMod.sweepTouched(db, { git }), { grown: 1 });
  assert.ok((await areasOf(key)).includes("src/lib/gen/**"));
  await raw.query(`delete from agent_runs`);
});

test("PLA-58 #2: shared paths keep code runs apart and the hold names the ticket and the files", async () => {
  // MIA-I7-2 (registro) is changing the shared NativeSelect; MIA-I7-3 (panel) declares only its own folder.
  await t2Reset();
  await setRunner("micasa", { max_concurrent: 5, max_per_agent: 5 });
  const i2 = await ticketIn("micasa", "Registro", { areas: ["src/app/registro/**", "src/components/ui/native-select.tsx"] });
  await liveRun("taller-micasa", "micasa", i2);
  const i3 = await ticketIn("micasa", "Panel", { areas: ["src/app/panel/**"] });
  const q3 = await queueRun("taller-micasa", "micasa", i3);
  const f = fakes();
  await runner.drainQueue(db, new Date(), f.deps as never);
  const held = await heldOf(q3);
  assert.deepEqual([held.status, held.held_code], ["queued", "areas"]);
  assert.deepEqual(held.held_detail, { with: i2, files: ["src/components/ui/native-select.tsx"] });
  assert.equal(alv.heldText("areas", held.held_detail, "Taller"), `Espera a ${i2}: cambia src/components/ui/native-select.tsx`);
  assert.equal(alv.heldText("areas", {}, "Taller"), "Espera: otro trabajo toca los mismos archivos", "an old hold without detail still reads");

  // The project says nothing is shared: the panel starts.
  await setRunner("micasa", { max_concurrent: 5, max_per_agent: 5, shared_areas: [] });
  await runner.drainQueue(db, new Date(), f.deps as never);
  assert.equal((await heldOf(q3)).status, "running");
  await finishAll(f);
});

test("PLA-58 #3: no shared or overlapping path starts side by side; a ticket that declares a shared path waits for any live code run", async () => {
  await t2Reset();
  await setRunner("micasa", { max_concurrent: 5, max_per_agent: 5 });
  const a = await ticketIn("micasa", "Registro", { areas: ["src/app/registro/**"] });
  await liveRun("taller-micasa", "micasa", a);
  const b = await queueRun("taller-micasa", "micasa", await ticketIn("micasa", "Panel", { areas: ["src/app/panel/**"] }));
  const deps = await ticketIn("micasa", "Dependencias", { areas: ["package.json"] });
  const c = await queueRun("taller-micasa", "micasa", deps);
  const f = fakes();
  await runner.drainQueue(db, new Date(), f.deps as never);
  assert.equal((await heldOf(b)).status, "running", "separate folders, nothing shared");
  const hc = await heldOf(c);
  assert.deepEqual([hc.status, hc.held_code, (hc.held_detail as { files: string[] }).files], ["queued", "areas", ["package.json"]]);
  // The default list, as the screen and the runner read it.
  assert.ok(touchedMod.isShared("src/components/ui/button.tsx", touchedMod.sharedAreasOf(undefined)));
  assert.ok(!touchedMod.isShared("src/app/panel/page.tsx", touchedMod.sharedAreasOf(undefined)));
  await finishAll(f);
});
