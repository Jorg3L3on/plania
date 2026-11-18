// AUDIT-5: the quality scoreboard (src/api/scoreboard.ts) on a seeded throwaway database: several groups, empty
// denominators as null, a QA return and an owner's send-back attributed to the Taller run that made the delivery,
// a ticket Blocked after two failures in a row, and nothing but safe text in the reading list.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const { makeDb, resetPool } = await import("../src/db/client.js");
const { app } = await import("../src/app.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const { scoreboard, failureReason, scrub } = await import("../src/api/scoreboard.js");

type Db = ReturnType<typeof makeDb>["db"];
let raw: pg.Client;
let db: Db;
const NOW = new Date();
const DAY = 86_400_000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);
const cookie = () => `${SESSION_COOKIE}=${createSession()}`;

const projectId = new Map<string, string>();
const agentId = new Map<string, string>();
const taskId = new Map<string, string>();

async function agent(slug: string, role: string, project: string): Promise<void> {
  const r = await raw.query("insert into agents (slug, name, role, kind, project_id, role_template) values ($1, $1, $2, 'coder', $3, $2) returning id", [slug, role, projectId.get(project)]);
  agentId.set(slug, r.rows[0].id);
}

async function ticket(project: string, key: string, status: string, changedDaysAgo: number): Promise<void> {
  const r = await raw.query(
    "insert into tasks (project_id, kind, key, title, status, work_type, status_changed_at, updated_at) values ($1, 'ticket', $2, $3, $4, 'code', $5, $5) returning id",
    [projectId.get(project), key, `Ticket ${key}`, status, ago(changedDaysAgo)],
  );
  taskId.set(key, r.rows[0].id);
}

type RunSeed = {
  agent: string;
  project: string;
  key: string | null;
  role: string;
  status: string;
  summary: string;
  endedDaysAgo: number;
  resumed?: boolean;
  model?: string | null;
  prompt?: string | null;
  skills?: string[];
  input?: number;
  output?: number;
  context?: number | null;
};
async function run(s: RunSeed): Promise<void> {
  const ended = ago(s.endedDaysAgo);
  const started = new Date(ended.getTime() - 30 * 60_000);
  const live = s.status === "queued";
  await raw.query(
    `insert into agent_runs (agent_id, project_id, task_key, role, status, summary, resumed, queued_at, started_at, ended_at, input_tokens, output_tokens,
       requested_model, prompt_version, skills, context_tokens, cwd, worktree_path, log_path, work_key)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, '/secret/cwd', '/secret/worktree', '/secret/log.jsonl', $17)`,
    [
      agentId.get(s.agent),
      projectId.get(s.project),
      s.key,
      s.role,
      s.status,
      s.summary,
      s.resumed ?? false,
      started,
      live ? null : started,
      live ? null : ended,
      s.input ?? 0,
      s.output ?? 0,
      s.model ?? null,
      s.prompt ?? null,
      s.skills ?? [],
      s.context ?? null,
      s.key ?? "general",
    ],
  );
}

async function lane(project: string, key: string, attempt: number, status: string, createdDaysAgo: number, endedDaysAgo: number, returned: boolean, notes: string): Promise<void> {
  await raw.query(
    "insert into qa_lanes (project_id, task_id, task_key, attempt, status, returned, notes, created_at, started_at, ended_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9)",
    [projectId.get(project), taskId.get(key), key, attempt, status, returned, notes, ago(createdDaysAgo), ago(endedDaysAgo)],
  );
}

async function statusEvent(project: string, key: string, from: string, to: string, daysAgo: number, actor: Record<string, string> = { agent: "plania", session_id: "system" }): Promise<void> {
  await raw.query("insert into events (project_id, task_id, task_key, type, actor, payload, created_at) values ($1, $2, $3, 'task.status', $4, $5, $6)", [
    projectId.get(project),
    taskId.get(key),
    key,
    JSON.stringify(actor),
    JSON.stringify({ from, to }),
    ago(daysAgo),
  ]);
}

const TDD = "tdd@11111111";
const REVIEW = "review@22222222";
const V1 = "v3:aaaaaaaaaaaa";
const V2 = "v4:bbbbbbbbbbbb";

async function seed(): Promise<void> {
  for (const r of (await raw.query("select id, slug from projects")).rows) projectId.set(r.slug, r.id);
  await agent("taller-zig", "taller", "zigzag");
  await agent("qa-zig", "qa", "zigzag");
  await agent("taller-mic", "taller", "micasa");

  // ZIG-1: one clean delivery on opus; QA passes on the first try; landed two days ago. An older run on it sits
  // outside the period and still counts toward what the ticket cost.
  await ticket("zigzag", "ZIG-1", "Merged", 2);
  await statusEvent("zigzag", "ZIG-1", "In review", "Merged", 2);
  await run({ agent: "taller-zig", project: "zigzag", key: "ZIG-1", role: "taller", status: "ok", summary: "ok: success, 9 turns", endedDaysAgo: 40, model: "opus", prompt: V1, skills: [TDD], input: 5000, output: 500 });
  await run({ agent: "taller-zig", project: "zigzag", key: "ZIG-1", role: "taller", status: "ok", summary: "ok: success, 12 turns", endedDaysAgo: 5, model: "opus", prompt: V1, skills: [TDD], input: 1000, output: 200, context: 50_000 });
  await lane("zigzag", "ZIG-1", 1, "pass", 4.9, 4.8, false, "Todo bien.");
  await run({ agent: "qa-zig", project: "zigzag", key: "ZIG-1", role: "qa", status: "ok", summary: "ok: success, 4 turns", endedDaysAgo: 4.8, model: "sonnet", input: 300, output: 100 });

  // ZIG-2: on sonnet. The first delivery (a fresh run on prompt V2) fails QA and is returned; the second (resumed)
  // passes and the owner sends it back; the third (resumed) passes and lands.
  await ticket("zigzag", "ZIG-2", "Merged", 1);
  await statusEvent("zigzag", "ZIG-2", "In review", "Merged", 1);
  await run({ agent: "taller-zig", project: "zigzag", key: "ZIG-2", role: "taller", status: "ok", summary: "ok: success, 30 turns, session b1", endedDaysAgo: 6, model: "sonnet", prompt: V2, skills: [TDD, REVIEW], input: 2000, output: 400, context: 80_000 });
  await lane("zigzag", "ZIG-2", 1, "fail", 5.95, 5.9, true, "Falla el test de login en /Users/jorge/Developer/zigzag/src/login.ts con SESSION_SECRET=abc123 puesto.");
  await run({ agent: "taller-zig", project: "zigzag", key: "ZIG-2", role: "taller", status: "ok", summary: "ok: success, 8 turns, session b1", endedDaysAgo: 5, resumed: true, model: "sonnet", skills: [TDD, REVIEW], input: 500, output: 100, context: 90_000 });
  await lane("zigzag", "ZIG-2", 2, "pass", 4.95, 4.9, false, "Pasa: el login ya responde.");
  const thread = await raw.query("insert into threads (kind, project_id) values ('project', $1) returning id", [projectId.get("zigzag")]);
  await raw.query("insert into thread_messages (thread_id, author_agent, author_role, body, action_state, at) values ($1, 'taller-zig', 'taller', 'Entrega de ZIG-2', $2, $3)", [
    thread.rows[0].id,
    JSON.stringify({ action: "cambios", at: ago(4).toISOString(), result: { ticket: "ZIG-2", status: "Ready", text: "El botón no se ve en el teléfono.", wake: "queued" } }),
    ago(4.5),
  ]);
  await run({ agent: "taller-zig", project: "zigzag", key: "ZIG-2", role: "taller", status: "ok", summary: "ok: success, 6 turns, session b1", endedDaysAgo: 3.5, resumed: true, model: "sonnet", skills: [TDD, REVIEW], input: 600, output: 100, context: 100_000 });
  await lane("zigzag", "ZIG-2", 2, "pass", 3.45, 3.4, false, "Pasa.");

  // ZIG-3: two failures in a row (max turns, then another reason) and Plania blocks it.
  await ticket("zigzag", "ZIG-3", "Blocked", 1.8);
  await run({ agent: "taller-zig", project: "zigzag", key: "ZIG-3", role: "taller", status: "fail", summary: "fail: error_max_turns (41 turns, session c1)", endedDaysAgo: 2, model: "opus", prompt: V1, skills: [TDD], input: 100, output: 10 });
  await run({ agent: "taller-zig", project: "zigzag", key: "ZIG-3", role: "taller", status: "fail", summary: "fail: error_during_execution (3 turns, session c1)", endedDaysAgo: 1.9, resumed: true, model: "opus", skills: [TDD], input: 100, output: 10 });
  await statusEvent("zigzag", "ZIG-3", "Ready", "Blocked", 1.8);

  // ZIG-4: one timeout, then Plania blocks it for another reason: not "two failures in a row". A stopped run
  // after it is nobody's failure, and a queued and a skipped run never ran.
  await ticket("zigzag", "ZIG-4", "Blocked", 1.45);
  await run({ agent: "taller-zig", project: "zigzag", key: "ZIG-4", role: "taller", status: "fail", summary: "fail: no result after timeout", endedDaysAgo: 1.5, model: "opus", prompt: V1, skills: [TDD] });
  await statusEvent("zigzag", "ZIG-4", "Ready", "Blocked", 1.45);
  await run({ agent: "taller-zig", project: "zigzag", key: "ZIG-4", role: "taller", status: "stopped", summary: "stopped: company paused (success, 2 turns)", endedDaysAgo: 1.4, model: "opus", prompt: V1, skills: [TDD] });
  await run({ agent: "taller-zig", project: "zigzag", key: "ZIG-6", role: "taller", status: "skipped", summary: "skipped: company paused", endedDaysAgo: 1, model: "opus" });
  await run({ agent: "taller-zig", project: "zigzag", key: "ZIG-7", role: "taller", status: "queued", summary: "", endedDaysAgo: 0.1, model: "opus" });

  // ZIG-5 landed before the period. MIC-1 is another project's: one haiku run, no QA.
  await ticket("zigzag", "ZIG-5", "Done", 40);
  await statusEvent("zigzag", "ZIG-5", "In review", "Done", 40);
  await ticket("micasa", "MIC-1", "Done", 1);
  await statusEvent("micasa", "MIC-1", "In review", "Done", 1, { agent: "Jorge", session_id: "web" });
  await run({ agent: "taller-mic", project: "micasa", key: "MIC-1", role: "taller", status: "ok", summary: "ok: success, 2 turns", endedDaysAgo: 2, model: "haiku", input: 10, output: 10 });
}

before(async () => {
  raw = await resetTestDb();
  ({ db } = makeDb());
});

after(async () => {
  await raw.end();
  await resetPool();
});

const group = (board: Awaited<ReturnType<typeof scoreboard>>, key: string | null) => {
  const g = board.groups.find((x) => x.key === key);
  assert.ok(g, `group ${key} is missing: ${board.groups.map((x) => x.key).join(" | ")}`);
  return g;
};

test("an empty database: no groups, every rate null, nothing to read", async () => {
  const board = await scoreboard(db, { now: NOW });
  assert.equal(board.empty, true);
  assert.deepEqual(board.groups, []);
  assert.deepEqual(board.to_read, []);
  assert.equal(board.days, 28);
  assert.equal(board.by, "role");
  const t = board.total;
  assert.equal(t.runs, 0);
  assert.equal(t.tickets_landed, 0);
  for (const v of [t.runs_per_ticket, t.tokens_per_ticket, t.qa_first.rate, t.sent_back.rate, t.resumed.share, t.resumed.ok_rate_resumed, t.resumed.ok_rate_fresh, t.context_tokens_median]) assert.equal(v, null);
  assert.deepEqual(t.failures, { total: 0, max_turns: 0, other: 0, by_reason: [] });
});

test("failureReason and scrub", () => {
  assert.equal(failureReason("fail: error_max_turns (41 turns, session 491bc14d)"), "error_max_turns");
  assert.equal(failureReason("fail: start (spawn /Users/x/bin/claude ENOENT)"), "start");
  assert.equal(failureReason("fail: error_during_execution (5 turns) after timeout"), "timeout");
  assert.equal(failureReason("fail: no result"), "no result");
  assert.equal(failureReason(""), "unknown");
  assert.equal(scrub(""), null);
  assert.equal(scrub("lee C:\\Users\\jorge\\repo\\a.ts y ~/x/y"), "lee [ruta] y [ruta]");
  assert.equal(scrub("src/login.ts falla; ver https://github.com/o/r/pull/3"), "src/login.ts falla; ver https://github.com/o/r/pull/3");
  assert.equal(scrub("usa ghp_abcdefghijklmnopqrstuvwxyz012345 y Bearer abcdefghijklmnop"), "usa [oculto] y Bearer [oculto]");
});

test("by model: runs, landed tickets and their cost, QA, send-backs, failures, Blocked, resumed, context", async () => {
  await seed();
  const board = await scoreboard(db, { by: "model", now: NOW });
  assert.equal(board.empty, false);
  assert.deepEqual(board.groups.map((g) => g.key), ["opus", "sonnet", "haiku"]);

  const opus = group(board, "opus");
  assert.equal(opus.runs, 5); // skipped and queued never ran; the 40-day-old run is outside the period
  assert.equal(opus.tickets_landed, 1);
  assert.equal(opus.runs_per_ticket, 2); // the old run still counts toward ZIG-1
  assert.equal(opus.tokens_per_ticket, 6700);
  assert.deepEqual(opus.qa_first, { passed: 1, concluded: 1, rate: 1 });
  assert.deepEqual(opus.sent_back, { count: 0, passed: 1, rate: 0 });
  assert.deepEqual(opus.failures, {
    total: 3,
    max_turns: 1,
    other: 2,
    by_reason: [
      { reason: "error_during_execution", count: 1 },
      { reason: "error_max_turns", count: 1 },
      { reason: "timeout", count: 1 },
    ],
  });
  assert.equal(opus.blocked_after_two, 1); // ZIG-3 only: ZIG-4 had one failure
  assert.deepEqual(opus.resumed, { runs: 1, fresh_runs: 3, share: 0.25, ok_rate_resumed: 0, ok_rate_fresh: 1 / 3 });
  assert.equal(opus.context_tokens_median, 50_000);

  const sonnet = group(board, "sonnet");
  assert.equal(sonnet.runs, 4);
  assert.equal(sonnet.tickets_landed, 2); // the QA run on ZIG-1 and the three Taller runs on ZIG-2
  assert.equal(sonnet.runs_per_ticket, 2);
  assert.equal(sonnet.tokens_per_ticket, 2050);
  assert.deepEqual(sonnet.qa_first, { passed: 0, concluded: 1, rate: 0 });
  assert.deepEqual(sonnet.sent_back, { count: 1, passed: 2, rate: 0.5 });
  assert.equal(sonnet.failures.total, 0);
  assert.equal(sonnet.blocked_after_two, 0);
  assert.deepEqual(sonnet.resumed, { runs: 2, fresh_runs: 2, share: 0.5, ok_rate_resumed: 1, ok_rate_fresh: 1 });
  assert.equal(sonnet.context_tokens_median, 90_000);

  // No QA lane, no resumed run, no context recorded: null, not zero.
  const haiku = group(board, "haiku");
  assert.equal(haiku.runs, 1);
  assert.equal(haiku.tickets_landed, 1);
  assert.equal(haiku.tokens_per_ticket, 20);
  assert.equal(haiku.qa_first.rate, null);
  assert.equal(haiku.sent_back.rate, null);
  assert.equal(haiku.resumed.ok_rate_resumed, null);
  assert.equal(haiku.resumed.ok_rate_fresh, 1);
  assert.equal(haiku.resumed.share, 0);
  assert.equal(haiku.context_tokens_median, null);

  const t = board.total;
  assert.equal(t.runs, 10);
  assert.equal(t.tickets_landed, 3);
  assert.equal(t.runs_per_ticket, 7 / 3);
  assert.deepEqual(t.qa_first, { passed: 1, concluded: 2, rate: 0.5 });
  assert.deepEqual(t.sent_back, { count: 1, passed: 3, rate: 1 / 3 });
  assert.equal(t.failures.total, 3);
  assert.equal(t.blocked_after_two, 1);
  assert.equal(t.context_tokens_median, 85_000);
});

test("QA and the owner's outcomes go to the Taller run that made each delivery", async () => {
  // The returned delivery was made on prompt V2; the two resumed runs after it carry no prompt version.
  const byPrompt = await scoreboard(db, { by: "prompt_version", now: NOW });
  assert.deepEqual(group(byPrompt, V2).qa_first, { passed: 0, concluded: 1, rate: 0 });
  assert.deepEqual(group(byPrompt, V2).sent_back, { count: 0, passed: 0, rate: null });
  assert.deepEqual(group(byPrompt, V1).qa_first, { passed: 1, concluded: 1, rate: 1 });
  assert.deepEqual(group(byPrompt, null).sent_back, { count: 1, passed: 2, rate: 0.5 });
  assert.deepEqual(group(byPrompt, null).qa_first, { passed: 0, concluded: 0, rate: null });

  const byResumed = await scoreboard(db, { by: "resumed", now: NOW });
  assert.deepEqual(group(byResumed, "fresh").qa_first, { passed: 1, concluded: 2, rate: 0.5 });
  assert.deepEqual(group(byResumed, "resumed").sent_back, { count: 1, passed: 2, rate: 0.5 });
  assert.equal(group(byResumed, "resumed").blocked_after_two, 1); // the second failure was the resumed run
  assert.equal(group(byResumed, "fresh").blocked_after_two, 0);

  // By role everything QA and the owner said sits on Taller, never on the QA role's own runs.
  const byRole = await scoreboard(db, { by: "role", now: NOW });
  assert.deepEqual(group(byRole, "taller").qa_first, { passed: 1, concluded: 2, rate: 0.5 });
  assert.deepEqual(group(byRole, "taller").sent_back, { count: 1, passed: 3, rate: 1 / 3 });
  assert.deepEqual(group(byRole, "qa").qa_first, { passed: 0, concluded: 0, rate: null });
  assert.equal(group(byRole, "qa").runs, 1);

  const bySkills = await scoreboard(db, { by: "skills", now: NOW });
  assert.deepEqual(bySkills.groups.map((g) => g.key).sort(), [`${REVIEW}, ${TDD}`, TDD, null].sort());
  assert.deepEqual(group(bySkills, `${REVIEW}, ${TDD}`).sent_back, { count: 1, passed: 2, rate: 0.5 });
  assert.equal(group(bySkills, null).runs, 2); // the QA run and micasa's
});

test("project and period filters", async () => {
  const mic = await scoreboard(db, { project: "micasa", by: "model", now: NOW });
  assert.equal(mic.project, "micasa");
  assert.deepEqual(mic.groups.map((g) => g.key), ["haiku"]);
  assert.equal(mic.total.tickets_landed, 1);
  assert.deepEqual(mic.to_read, []);

  // One day: only what ended in the last 24 hours. ZIG-2 landed then; its runs are older and still its cost.
  const day = await scoreboard(db, { days: 1, project: "zigzag", by: "model", now: NOW });
  assert.equal(day.total.runs, 0);
  assert.equal(day.total.tickets_landed, 1);
  assert.equal(day.total.runs_per_ticket, 3);
  assert.equal(day.total.qa_first.rate, null);

  // Sixty days reaches ZIG-5 and the old run.
  const wide = await scoreboard(db, { days: 60, project: "zigzag", by: "model", now: NOW });
  assert.equal(wide.total.tickets_landed, 3);
  assert.equal(group(wide, "opus").runs, 6);
});

test("to_read: newest first, with the run summary, the QA notes and the owner's words, and nothing unsafe", async () => {
  const board = await scoreboard(db, { by: "role", now: NOW });
  assert.deepEqual(board.to_read.map((i) => `${i.kind} ${i.key}`), ["failed ZIG-4", "failed ZIG-3", "failed ZIG-3", "sent_back ZIG-2", "returned ZIG-2"]);

  const returned = board.to_read.find((i) => i.kind === "returned")!;
  assert.equal(returned.role, "taller");
  assert.equal(returned.title, "Ticket ZIG-2");
  assert.equal(returned.attempt, 1);
  assert.equal(returned.summary, "ok: success, 30 turns, session b1"); // the first delivery's run, not a later one
  assert.equal(returned.qa_notes, "Falla el test de login en [ruta] con SESSION_SECRET=[oculto] puesto.");

  const sent = board.to_read.find((i) => i.kind === "sent_back")!;
  assert.equal(sent.owner_text, "El botón no se ve en el teléfono.");
  assert.equal(sent.qa_notes, "Pasa: el login ya responde."); // the pass the owner was answering
  assert.equal(sent.summary, "ok: success, 8 turns, session b1");
  assert.equal(sent.role, "taller");

  const failed = board.to_read.find((i) => i.kind === "failed")!;
  assert.equal(failed.summary, "fail: no result after timeout");
  assert.equal(failed.qa_notes, null);

  const text = JSON.stringify(board);
  for (const unsafe of ["/secret/", "/Users/", "abc123", "log_path", "worktree", "cwd"]) assert.ok(!text.includes(unsafe), `the response carries ${unsafe}`);
});

test("to_read keeps the latest 30", async () => {
  for (let i = 0; i < 35; i++) {
    await run({ agent: "taller-mic", project: "micasa", key: `MIC-${100 + i}`, role: "taller", status: "fail", summary: "fail: error_max_turns (50 turns)", endedDaysAgo: 10 + i / 100, model: "haiku" });
  }
  const board = await scoreboard(db, { by: "role", now: NOW });
  assert.equal(board.to_read.length, 30);
  assert.equal(board.to_read[0]!.key, "ZIG-4");
  assert.equal(board.total.failures.max_turns, 36);
  await raw.query("delete from agent_runs where task_key like 'MIC-1__'");
});

test("GET /api/scoreboard: the screen's cookie only, and the filters are checked", async () => {
  assert.equal((await app.request("/api/scoreboard")).status, 401);
  assert.equal((await app.request("/api/scoreboard", { headers: { Authorization: "Bearer test-token" } })).status, 401);

  const ok = await app.request("/api/scoreboard?days=28&by=model&project=zigzag", { headers: { Cookie: cookie() } });
  assert.equal(ok.status, 200);
  const body = (await ok.json()) as Awaited<ReturnType<typeof scoreboard>>;
  assert.equal(body.by, "model");
  assert.equal(body.project, "zigzag");
  assert.deepEqual(body.groups.map((g) => g.key), ["opus", "sonnet"]);
  assert.equal(body.to_read.length, 5);

  const defaults = (await (await app.request("/api/scoreboard", { headers: { Cookie: cookie() } })).json()) as Awaited<ReturnType<typeof scoreboard>>;
  assert.equal(defaults.days, 28);
  assert.equal(defaults.by, "role");

  for (const q of ["by=agent", "days=0", "days=366", "days=abc", "days=1.5"]) {
    const bad = await app.request(`/api/scoreboard?${q}`, { headers: { Cookie: cookie() } });
    assert.equal(bad.status, 400, q);
    assert.equal(((await bad.json()) as { error: string }).error, "INVALID_FILTER");
  }
  const missing = await app.request("/api/scoreboard?project=nope", { headers: { Cookie: cookie() } });
  assert.equal(missing.status, 404);
});
