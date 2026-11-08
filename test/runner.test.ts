// PLA-I29: the runner, its limits and kill switches. Every process is a fake child; git is a fake;
// no real claude, no real worktree, no live database (test/helpers.ts throwaway DB).
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { after, before, beforeEach, test } from "node:test";
import type pg from "pg";
import { TEST_BEARER, resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const { makeDb } = await import("../src/db/client.js");
const { app } = await import("../src/app.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const { seedOrg } = await import("../scripts/seed-org.js");
const writes = await import("../src/mcp/writes.js");
const { runHeartbeat, wakeAgent } = await import("../src/jobs/heartbeat.js");
const runner = await import("../src/runner/runner.js");
const { supervise, childEnv } = await import("../src/runner/process.js");
const { parseStream, parseUsageText } = await import("../src/runner/stream.js");
const { DENY_RULES, deniedBy } = await import("../src/runner/deny.js");
const { checkBase, ensureWorktree, isInside, worktreePathFor } = await import("../src/runner/worktree.js");
const { companyState } = await import("../src/runner/company.js");

type Db = ReturnType<typeof makeDb>["db"];
let raw: pg.Client;
let db: Db;
let closeDb: () => Promise<void>;
const scratch = mkdtempSync(path.join(tmpdir(), "plania-runner-test-"));
const repo = path.join(scratch, "repos", "micasa");
const repoWorkia = path.join(scratch, "repos", "workia");
const wtRoot = path.join(scratch, "worktrees");
const ctx = { actor: { agent: "test-agent", session_id: "s-i29" } };

// ---- Fakes

class FakeChild extends EventEmitter {
  pid: number;
  stdout = new PassThrough();
  stderr = new PassThrough();
  constructor(pid: number) {
    super();
    this.pid = pid;
  }
  write(events: unknown[]): void {
    for (const e of events) this.stdout.write(`${JSON.stringify(e)}\n`);
  }
  exit(code: number | null, signal: NodeJS.Signals | null = null): void {
    this.stdout.end();
    setImmediate(() => this.emit("exit", code, signal));
  }
}

type Spawned = { command: string; args: string[]; env: NodeJS.ProcessEnv; cwd: string; child: FakeChild };

function fakes(opts: { onSignal?: (child: FakeChild, signal: NodeJS.Signals) => void } = {}) {
  const spawned: Spawned[] = [];
  const signals: { pid: number; signal: NodeJS.Signals }[] = [];
  const reports: { model: string; input: number; output: number; cache_read?: number; cache_create?: number; run_id: string }[] = [];
  let pid = 40_000;
  const byPid = new Map<number, FakeChild>();
  const deps = {
    env: {
      HOME: scratch,
      PATH: "/usr/bin:/bin",
      ANTHROPIC_API_KEY: "sk-should-never-reach-the-child",
      ANTHROPIC_BASE_URL: "http://127.0.0.1/never",
      anthropic_auth_token: "lowercase-too",
      PLANIA_RUNNER_TOKEN: "runner-token",
      PLANIA_PROMPTS_PROJECT: "micasa",
      CLAUDE_CODE_BIN: "/fake/bin/claude",
    } as NodeJS.ProcessEnv,
    logDir: path.join(scratch, "logs"),
    tmpDir: path.join(scratch, "tmp"),
    worktreeRoot: wtRoot,
    graceMs: 10,
    liveFlushMs: 0,
    footprints: false,
    git: async (args: string[]) => {
      if (args[0] === "worktree" && args[1] === "add") {
        const target = args.find((a) => a.startsWith(wtRoot))!;
        mkdirSync(target, { recursive: true });
      }
      if (args[0] === "rev-parse" && args[1] === "--verify") return { code: 1, stdout: "", stderr: "" };
      if (args[0] === "rev-parse" && args[1] === "--abbrev-ref") return { code: 0, stdout: "jl/feature\n", stderr: "" };
      return { code: 0, stdout: "", stderr: "" };
    },
    spawn: (command: string, args: string[], options: { env: NodeJS.ProcessEnv; cwd: string }) => {
      pid += 1;
      const child = new FakeChild(pid);
      byPid.set(pid, child);
      spawned.push({ command, args, env: options.env, cwd: options.cwd, child });
      return child;
    },
    kill: (target: number, signal: NodeJS.Signals) => {
      signals.push({ pid: target, signal });
      const child = byPid.get(target);
      if (child) opts.onSignal?.(child, signal);
    },
    reportTokens: async (_db: unknown, input: { model: string; input: number; output: number; cache_read?: number; cache_create?: number; run_id: string }) => {
      reports.push(input);
      return input;
    },
    probeUsage: async () => null,
  };
  return { deps, spawned, signals, reports };
}

const resultEvent = (models: Record<string, Record<string, number>>, extra: Record<string, unknown> = {}) => ({
  type: "result",
  subtype: "success",
  is_error: false,
  num_turns: 3,
  session_id: "sess-aaaa-1111",
  result: "OK",
  total_cost_usd: 0.13,
  modelUsage: models,
  ...extra,
});

const OPUS = { inputTokens: 2, outputTokens: 4, cacheReadInputTokens: 10835, cacheCreationInputTokens: 16161, webSearchRequests: 0, costUSD: 0.13 };
const HAIKU = { inputTokens: 120, outputTokens: 45, cacheReadInputTokens: 300, cacheCreationInputTokens: 0, webSearchRequests: 0, costUSD: 0.01 };

const rateLimit = (status: string, five: number, resetsAt = 1794126000) => ({
  type: "rate_limit_event",
  rate_limit_info: {
    status,
    resetsAt,
    rateLimitType: "five_hour",
    overageStatus: "rejected",
    overageDisabledReason: "org_level_disabled",
    isUsingOverage: false,
    unifiedWindows: { five_hour: { utilization: five, resetsAt }, seven_day: { utilization: 0.19, resetsAt: 1794506400 } },
  },
});

// ---- DB helpers

async function agentId(slug: string): Promise<string> {
  return (await raw.query(`select id from agents where slug = $1`, [slug])).rows[0].id as string;
}
async function projectId(slug: string): Promise<string> {
  return (await raw.query(`select id from projects where slug = $1`, [slug])).rows[0].id as string;
}
async function freshReading(five = 10, status = "allowed"): Promise<void> {
  await raw.query(`delete from plan_readings`);
  await raw.query(
    `insert into plan_readings (at, source, status, five_hour_pct, seven_day_pct, five_hour_resets_at) values (now(), 'stream', $1, $2, 19, now() + interval '3 hours')`,
    [status, five],
  );
}
async function budget(scope: "role" | "project", key: string, limit: number): Promise<void> {
  if (scope === "role") {
    await raw.query(`delete from token_budgets where scope = 'role' and role = $1`, [key]);
    await raw.query(`insert into token_budgets (scope, role, weekly_limit) values ('role', $1, $2)`, [key, limit]);
  } else {
    const id = await projectId(key);
    await raw.query(`delete from token_budgets where scope = 'project' and project_id = $1`, [id]);
    await raw.query(`insert into token_budgets (scope, project_id, weekly_limit) values ('project', $1, $2)`, [id, limit]);
  }
}
// A finished run this week that used `tokens` in the project (role product-owner unless given).
async function usedTokens(project: string, tokens: number, role = "research"): Promise<void> {
  await raw.query(
    `insert into agent_runs (agent_id, project_id, role, status, started_at, ended_at, tokens_total, queued_at)
     values ($1, $2, $3, 'ok', now() - interval '1 minute', now() - interval '1 minute', $4, now() - interval '1 minute')`,
    [await agentId("research"), await projectId(project), role, tokens],
  );
}
async function ready(project: string, key: string, title = "Example ticket"): Promise<void> {
  await writes.createTask(db, { project, key, title, scope: "Scope", checks: ["Done"], status: "Ready" } as never, ctx);
}
async function runsOf(slug: string): Promise<{ status: string; summary: string; task_key: string | null }[]> {
  return (
    await raw.query(
      `select hr.status, hr.summary, hr.task_key from heartbeat_runs hr join agents a on a.id = hr.agent_id where a.slug = $1 order by hr.started_at, hr.id`,
      [slug],
    )
  ).rows;
}
const wake = (slug: string, deps: unknown, taskKey?: string) =>
  wakeAgent(db, { agent: slug, taskKey, now: new Date() }, { runner: deps as never });

before(async () => {
  raw = await resetTestDb();
  ({ db, close: closeDb } = makeDb());
  await seedOrg(db);
  mkdirSync(repo, { recursive: true });
  mkdirSync(repoWorkia, { recursive: true });
  await raw.query(`update agents set heartbeat_minutes = null, adapter = 'none', adapter_config = '{}'::jsonb`);
  // housi = PO of micasa, workia = PO of workia, taller = Taller. All claude_code, no cadence lock.
  await raw.query(`update agents set adapter = 'claude_code' where slug in ('housi', 'workia', 'taller', 'zigzag')`);
  await raw.query(`update projects set settings = jsonb_build_object('local', jsonb_build_object('repo_path', $1::text)) where slug = 'micasa'`, [repo]);
  await raw.query(`update projects set settings = jsonb_build_object('local', jsonb_build_object('repo_path', $1::text)) where slug = 'workia'`, [repoWorkia]);
  const actor = JSON.stringify({ agent: "test", session_id: "s" });
  for (const title of ["Prompt: Product owner", "Prompt: Taller", "Prompt: Research", "Prompt: Artist", "Prompt: Asistente"]) {
    await raw.query(`insert into docs (project_id, title, markdown, actor) values ($1, $2, $3, $4)`, [await projectId("micasa"), title, `# ${title}\nNever main.`, actor]);
  }
  await raw.query(`insert into goals (project_id, title, why) values ($1, 'Ship the MiCasa beta', 'first users'), ($2, 'Workia goal', '')`, [
    await projectId("micasa"),
    await projectId("workia"),
  ]);
});

beforeEach(async () => {
  await runner.waitForAllRuns();
  runner.resetRunnerForTests();
  await raw.query(`delete from agent_runs`);
  await raw.query(`delete from agent_sessions`);
  await raw.query(`delete from heartbeat_runs`);
  await raw.query(`delete from token_budgets`);
  await raw.query(`delete from events where type = 'budget.warning'`);
  await raw.query(`update runner_settings set company_paused = false, max_concurrent = 1, cooldown_minutes = 0, plan_guard_pct = 70, reserve_tokens = 1000`);
  await raw.query(`update projects set runs_paused = false where slug in ('micasa', 'workia')`);
  await raw.query(`delete from tasks where key like 'RUN-%'`);
  for (const role of ["product-owner", "taller", "research", "artist", "asistente"]) await budget("role", role, 10_000_000);
  for (const p of ["micasa", "workia", "zigzag"]) await budget("project", p, 10_000_000);
  await freshReading(10);
});

after(async () => {
  await runner.waitForAllRuns();
  await closeDb?.();
  await raw?.end();
  rmSync(scratch, { recursive: true, force: true });
});

// ---- PLA-I29-2: the runner

test("I29-2 #1: the child env has 0 ANTHROPIC_* keys and the args are the headless set", async () => {
  const f = fakes();
  await ready("micasa", "RUN-ENV");
  const res = await wake("taller", f.deps, "RUN-ENV");
  assert.equal(res.reason, "ok");
  assert.equal(f.spawned.length, 1);
  const { env, args, command, cwd } = f.spawned[0]!;
  assert.equal(Object.keys(env).filter((k) => /^ANTHROPIC_/i.test(k)).length, 0);
  assert.equal(env.PLANIA_RUNNER_TOKEN, "runner-token");
  assert.equal(command, "/fake/bin/claude");
  for (const flag of ["-p", "--verbose", "--strict-mcp-config", "--settings", "--mcp-config", "--max-turns", "--append-system-prompt-file"]) {
    assert.equal(args.includes(flag), true, flag);
  }
  assert.deepEqual(args.slice(args.indexOf("--output-format"), args.indexOf("--output-format") + 2), ["--output-format", "stream-json"]);
  assert.deepEqual(args.slice(args.indexOf("--permission-mode"), args.indexOf("--permission-mode") + 2), ["--permission-mode", "auto"]);
  assert.deepEqual(args.slice(args.indexOf("--permission-prompts"), args.indexOf("--permission-prompts") + 2), ["--permission-prompts", "none"]);
  assert.equal(args.includes("-w"), false);
  assert.equal(cwd.startsWith(wtRoot), true);
  // Same helper, direct.
  assert.equal(Object.keys(childEnv({ ANTHROPIC_API_KEY: "x", Anthropic_Model: "y", HOME: "/h" })).join(","), "HOME");
  f.spawned[0]!.child.write([resultEvent({ "claude-opus-5-5[1m]": OPUS })]);
  f.spawned[0]!.child.exit(0);
  await runner.waitForAllRuns();
});

test("I29-2 #2: the timeout sends SIGINT, then SIGTERM, then SIGKILL, in that order", async () => {
  const sent: NodeJS.Signals[] = [];
  const child = new FakeChild(777);
  const proc = supervise({
    command: "claude",
    args: [],
    cwd: scratch,
    env: {},
    logPath: path.join(scratch, "logs", "timeout.jsonl"),
    timeoutMs: 10,
    graceMs: 15,
    spawn: () => child,
    kill: (_pid, signal) => {
      sent.push(signal);
      if (signal === "SIGKILL") child.exit(null, "SIGKILL");
    },
  });
  const exit = await proc.done;
  assert.deepEqual(sent, ["SIGINT", "SIGTERM", "SIGKILL"]);
  assert.equal(exit.timedOut, true);

  // A child that exits on SIGTERM never gets SIGKILL.
  const sent2: NodeJS.Signals[] = [];
  const child2 = new FakeChild(778);
  const proc2 = supervise({
    command: "claude",
    args: [],
    cwd: scratch,
    env: {},
    logPath: null,
    timeoutMs: 5,
    graceMs: 15,
    spawn: () => child2,
    kill: (_pid, signal) => {
      sent2.push(signal);
      if (signal === "SIGTERM") child2.exit(143);
    },
  });
  await proc2.done;
  assert.deepEqual(sent2, ["SIGINT", "SIGTERM"]);
});

test("I29-2 #3: modelUsage for 2 models gives one report_tokens call per model with exact counts", async () => {
  const f = fakes();
  await ready("micasa", "RUN-TOK");
  await wake("taller", f.deps, "RUN-TOK");
  const child = f.spawned[0]!.child;
  child.write([
    { type: "system", subtype: "init", session_id: "sess-aaaa-1111" },
    rateLimit("allowed", 0.21),
    resultEvent({ "claude-opus-5-5[1m]": OPUS, "claude-haiku-4-5": HAIKU }),
  ]);
  child.exit(0);
  await runner.waitForAllRuns();
  assert.equal(f.reports.length, 2);
  const byModel = Object.fromEntries(f.reports.map((r) => [r.model, r]));
  assert.deepEqual(
    { input: byModel["claude-opus-5-5[1m]"]!.input, output: byModel["claude-opus-5-5[1m]"]!.output, cr: byModel["claude-opus-5-5[1m]"]!.cache_read, cc: byModel["claude-opus-5-5[1m]"]!.cache_create },
    { input: 2, output: 4, cr: 10835, cc: 16161 },
  );
  assert.deepEqual(
    { input: byModel["claude-haiku-4-5"]!.input, output: byModel["claude-haiku-4-5"]!.output, cr: byModel["claude-haiku-4-5"]!.cache_read, cc: byModel["claude-haiku-4-5"]!.cache_create },
    { input: 120, output: 45, cr: 300, cc: 0 },
  );
  assert.notEqual(f.reports[0]!.run_id, f.reports[1]!.run_id);
  const [run] = (await raw.query(`select status, summary, turns, tokens_total, claude_session_id from agent_runs`)).rows;
  assert.equal(run.status, "ok");
  assert.equal(Number(run.tokens_total), 2 + 4 + 10835 + 16161 + 120 + 45 + 300);
  assert.equal(run.turns, 3);
  assert.equal(run.claude_session_id, "sess-aaaa-1111");
  assert.equal(JSON.stringify(run).includes("0.13"), false);
  const hb = await runsOf("taller");
  assert.equal(hb.at(-1)!.status, "ok");
  assert.match(hb.at(-1)!.summary, /^ok: success, 3 turns, session sess-aaa/);
  // The stream's rate_limit_event became the plan reading.
  const reading = (await raw.query(`select status, five_hour_pct, seven_day_pct, source from plan_readings order by at desc limit 1`)).rows[0];
  assert.deepEqual({ ...reading, five_hour_pct: Number(reading.five_hour_pct) }, { status: "allowed", five_hour_pct: 21, seven_day_pct: 19, source: "stream" });
});

test("I29-2 #4: exit 143 with no result is 'fail: no result' with 0 tokens reported", async () => {
  const f = fakes();
  await ready("micasa", "RUN-143");
  await wake("taller", f.deps, "RUN-143");
  const child = f.spawned[0]!.child;
  child.write([{ type: "system", subtype: "init", session_id: "sess-143" }]);
  child.exit(143);
  await runner.waitForAllRuns();
  assert.equal(f.reports.length, 0);
  const [run] = (await raw.query(`select status, summary, tokens_total, usage_known, exit_code from agent_runs`)).rows;
  assert.deepEqual({ ...run, tokens_total: Number(run.tokens_total) }, { status: "fail", summary: "fail: no result", tokens_total: 0, usage_known: true, exit_code: 143 });
  const hb = await runsOf("taller");
  assert.equal(hb.at(-1)!.status, "fail");
  assert.equal(hb.at(-1)!.summary, "fail: no result");
});

test("I29-2: the orphan sweep stops a run left by an earlier server and closes it", async () => {
  await raw.query(
    `insert into agent_runs (agent_id, project_id, role, status, pid, started_at, task_key) values ($1, $2, 'taller', 'running', 99999, now(), 'RUN-ORPH')`,
    [await agentId("taller"), await projectId("micasa")],
  );
  const signals: string[] = [];
  let alive = true;
  const n = await runner.sweepOrphans(db, {
    graceMs: 1,
    probePid: async () => alive,
    kill: (_pid, signal) => {
      signals.push(signal);
      alive = false;
    },
  });
  assert.equal(n, 1);
  assert.deepEqual(signals, ["SIGINT"]);
  const [run] = (await raw.query(`select status, summary, usage_known from agent_runs`)).rows;
  assert.deepEqual(run, { status: "fail", summary: "fail: orphaned (usage unknown)", usage_known: false });
});

test("I29-2: stream and /usage parsers read the spike's real shapes", () => {
  const reader = parseStream(
    [
      JSON.stringify(rateLimit("allowed", 0.83)),
      JSON.stringify({ type: "assistant", message: { id: "m1", usage: { input_tokens: 5, output_tokens: 7, cache_read_input_tokens: 100, cache_creation_input_tokens: 9 } } }),
      JSON.stringify(resultEvent({ "claude-opus-5-5[1m]": OPUS }, { num_turns: 1 })),
    ].join("\n"),
  );
  assert.equal(reader.readings[0]!.fiveHourPct, 83);
  assert.equal(reader.readings[0]!.fiveHourResetsAt!.toISOString(), new Date(1794126000 * 1000).toISOString());
  assert.equal(reader.liveTurns, 1);
  assert.equal(reader.result!.models[0]!.cacheCreate, 16161);
  const usage = parseUsageText("Current session: 83% used · resets Nov 8 at 2:20am\nCurrent week (all models): 19% used · resets Nov 12");
  assert.deepEqual([usage!.fiveHourPct, usage!.sevenDayPct], [83, 19]);
});

// ---- PLA-I29-3: role prompts, goal and ticket

test("I29-3 #2: --append-system-prompt-file on a session's first run, --resume and no prompt file after", async () => {
  const f = fakes();
  await ready("micasa", "RUN-RES", "Resume me");
  await wake("taller", f.deps, "RUN-RES");
  const first = f.spawned[0]!;
  assert.equal(first.args.includes("--append-system-prompt-file"), true);
  assert.equal(first.args.includes("--resume"), false);
  const prompt = first.args[first.args.indexOf("-p") + 1]!;
  assert.match(prompt, /Project goal: Ship the MiCasa beta/);
  assert.match(prompt, /Ticket: RUN-RES: Resume me/);
  assert.match(prompt, /sandbox/);
  first.child.write([resultEvent({ "claude-opus-5-5[1m]": OPUS })]);
  first.child.exit(0);
  await runner.waitForAllRuns();

  await wake("taller", f.deps, "RUN-RES");
  const second = f.spawned[1]!;
  assert.equal(second.args.includes("--append-system-prompt-file"), false);
  assert.deepEqual(second.args.slice(second.args.indexOf("--resume"), second.args.indexOf("--resume") + 2), ["--resume", "sess-aaaa-1111"]);
  second.child.write([resultEvent({ "claude-opus-5-5[1m]": OPUS })]);
  second.child.exit(0);
  await runner.waitForAllRuns();
});

test("I29-3 #3: a PO whose project has no goal is 'skipped: no goal'", async () => {
  const f = fakes();
  await raw.query(`update projects set runs_paused = false where slug = 'zigzag'`);
  const res = await wake("zigzag", f.deps);
  assert.equal(res.run!.status, "skipped");
  assert.equal(res.run!.summary, "skipped: no goal");
  assert.equal(f.spawned.length, 0);
  await raw.query(`update projects set runs_paused = true where slug = 'zigzag'`);
});

// ---- PLA-I29-4: worktrees outside the repo

test("I29-4 #1: the worktree path is outside the repo, and a path inside it is refused", async () => {
  const target = worktreePathFor(wtRoot, "micasa", "RUN-WT");
  assert.equal(target.startsWith(repo), false);
  assert.equal(isInside(target, repo), false);
  const inside = await ensureWorktree({ repo, root: path.join(repo, ".claude", "worktrees"), project: "micasa", key: "RUN-WT", branch: "jl/run-wt" }, fakes().deps.git);
  assert.deepEqual(inside, { ok: false, summary: "fail: worktree inside the repo" });
  const made = await ensureWorktree({ repo, root: wtRoot, project: "micasa", key: "RUN-WT", branch: "jl/run-wt" }, fakes().deps.git);
  assert.equal(made.ok, true);
  assert.equal(made.ok && made.path, target);
});

test("I29-4 #3: a runner worktree is removed once its ticket is Done", async () => {
  const f = fakes();
  await ready("micasa", "RUN-DONE");
  await wake("taller", f.deps, "RUN-DONE");
  f.spawned[0]!.child.write([resultEvent({ "claude-opus-5-5[1m]": OPUS })]);
  f.spawned[0]!.child.exit(0);
  await runner.waitForAllRuns();
  const removed: string[][] = [];
  const git = async (args: string[]) => {
    removed.push(args);
    return { code: 0, stdout: "", stderr: "" };
  };
  assert.equal(await runner.cleanupWorktrees(db, { ...f.deps, git }), 0);
  await raw.query(`update tasks set status = 'Done' where key = 'RUN-DONE'`);
  assert.equal(await runner.cleanupWorktrees(db, { ...f.deps, git }), 1);
  assert.deepEqual(removed[0]!.slice(0, 2), ["worktree", "remove"]);
  assert.equal(removed[0]![2], worktreePathFor(wtRoot, "micasa", "RUN-DONE"));
});

// ---- PLA-I29-5: deny rules and base branch

test("I29-5 #1: every command on the A4 list is denied by the --settings rules", () => {
  const denied = [
    "git push origin main",
    "git push -u origin main",
    "git push origin HEAD:main",
    "git push origin feature:main",
    "git push --force origin jl/x",
    "git push -f",
    "git push origin jl/x --force",
    "git push origin jl/x --force-with-lease",
    "git push origin +jl/x",
    "git -C /tmp/wt push origin main",
    "git checkout main",
    "git switch main",
    "git checkout -B main origin/main",
    "git merge origin/main",
    "git reset --hard origin/main",
    "gh pr merge 12 --merge",
    "gh pr create --title x --base main",
    "vercel --prod",
    "vercel deploy --prod",
    "DATABASE_URL=postgres://prod-db psql",
    "cd /tmp/wt && git push origin main",
  ];
  for (const command of denied) assert.notEqual(deniedBy("Bash", command), null, command);
  for (const tool of ["mcp__plania__set_env", "mcp__plania__set_project", "mcp__plania__set_agent", "mcp__plania__answer_delegated"]) {
    assert.notEqual(deniedBy(tool, null), null, tool);
  }
  for (const ok of ["git push -u origin jl/pla-i29-x", "git commit -m 'x'", "gh pr create --base sandbox --title x", "git merge origin/sandbox", "pnpm test"]) {
    assert.equal(deniedBy("Bash", ok), null, ok);
  }
  assert.equal(deniedBy("mcp__plania__finish", null), null);
  assert.equal(DENY_RULES.length > 30, true);
});

test("I29-5 #2: a ticket on branch main is 'fail: base not allowed' and nothing spawns", async () => {
  const f = fakes();
  await ready("micasa", "RUN-MAIN");
  await raw.query(`update tasks set branch = 'main' where key = 'RUN-MAIN'`);
  const res = await wake("taller", f.deps, "RUN-MAIN");
  assert.equal(res.run!.status, "fail");
  assert.equal(res.run!.summary, "fail: base not allowed");
  assert.equal(f.spawned.length, 0);
  assert.deepEqual(checkBase("jl/x", "main"), { ok: false, summary: "fail: base not allowed (main)" });
  assert.deepEqual(checkBase("jl/x", null), { ok: true });
});

// ---- PLA-I29-6: budgets

test("I29-6 #1: at 79% a run starts with no warning; at 80% it starts and writes a warning event", async () => {
  const f = fakes();
  await budget("project", "micasa", 100_000);
  await usedTokens("micasa", 79_000);
  await ready("micasa", "RUN-B79");
  const a = await wake("taller", f.deps, "RUN-B79");
  assert.equal(a.run!.status, "running");
  assert.equal(Number((await raw.query(`select count(*) from events where type = 'budget.warning'`)).rows[0].count), 0);
  f.spawned[0]!.child.write([resultEvent({ m: { inputTokens: 1000, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 } })]);
  f.spawned[0]!.child.exit(0);
  await runner.waitForAllRuns();
  // 79k + 1k = 80%.
  const b = await wake("taller", f.deps, "RUN-B79");
  assert.equal(b.run!.status, "running");
  const ev = (await raw.query(`select payload from events where type = 'budget.warning'`)).rows;
  assert.equal(ev.length, 1);
  assert.equal(ev[0].payload.scope, "project micasa");
  assert.equal(ev[0].payload.pct, 80);
  f.spawned[1]!.child.write([resultEvent({ m: { inputTokens: 1, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 } })]);
  f.spawned[1]!.child.exit(0);
  await runner.waitForAllRuns();
});

test("I29-6 #2: at 100% a new run is refused with BUDGET_STOPPED while another project still starts", async () => {
  const f = fakes();
  await budget("project", "micasa", 50_000);
  await usedTokens("micasa", 50_000);
  await ready("micasa", "RUN-B100");
  const stopped = await wake("taller", f.deps, "RUN-B100");
  assert.equal(stopped.run!.status, "skipped");
  assert.match(stopped.run!.summary, /^skipped: BUDGET_STOPPED project micasa at 100%/);
  assert.equal(f.spawned.length, 0);
  const other = await wake("workia", f.deps);
  assert.equal(other.run!.status, "running");
  assert.equal(f.spawned.length, 1);
  f.spawned[0]!.child.write([resultEvent({ m: { inputTokens: 1, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 } })]);
  f.spawned[0]!.child.exit(0);
  await runner.waitForAllRuns();
  const state = await companyState(db);
  const micasa = state.projects.find((p) => p.slug === "micasa")!;
  assert.deepEqual([micasa.budget.state, micasa.budget.pct, micasa.budget.limit], ["stopped", 100, 50_000]);
});

test("I29-6 #3: a run whose usage is unknown blocks the next run until Jorge acknowledges it", async () => {
  const f = fakes();
  await raw.query(
    `insert into agent_runs (agent_id, project_id, role, status, started_at, ended_at, usage_known) values ($1, $2, 'taller', 'fail', now(), now(), false)`,
    [await agentId("taller"), await projectId("micasa")],
  );
  await ready("micasa", "RUN-UNK");
  const res = await wake("taller", f.deps, "RUN-UNK");
  assert.equal(res.run!.status, "skipped");
  assert.match(res.run!.summary, /BUDGET_STOPPED role taller \(usage unknown\)/);
  assert.equal(f.spawned.length, 0);
  const id = (await raw.query(`select id from agent_runs where usage_known = false`)).rows[0].id;
  const ack = await app.request(`/api/company/runs/${id}/ack-usage`, { method: "POST", headers: { Cookie: `${SESSION_COOKIE}=${createSession()}` } });
  assert.equal(ack.status, 200);
  const again = await wake("taller", f.deps, "RUN-UNK");
  assert.equal(again.run!.status, "running");
  f.spawned[0]!.child.exit(143);
  await runner.waitForAllRuns();
  // No limit set is unknown too: it stops.
  await raw.query(`delete from token_budgets where scope = 'project'`);
  const unset = await wake("taller", f.deps, "RUN-UNK");
  assert.match(unset.run!.summary, /BUDGET_STOPPED project micasa \(no limit set\)/);
});

test("I29-6 #4 and I29-8 #4: an agent token on any limit or switch write gets 403; the cookie works", async () => {
  const bearer = { Authorization: `Bearer ${TEST_BEARER}`, "Content-Type": "application/json", Cookie: `${SESSION_COOKIE}=${createSession()}` };
  const writesToTry: [string, string, unknown][] = [
    ["PUT", "/api/company/budgets", { scope: "project", project: "micasa", weekly_limit: 999_999_999 }],
    ["PUT", "/api/company/settings", { plan_guard_pct: 100, max_concurrent: 8 }],
    ["POST", "/api/company/switch", { paused: false }],
    ["POST", "/api/company/projects/micasa/switch", { paused: false }],
    ["GET", "/api/company", undefined],
  ];
  for (const [method, url, body] of writesToTry) {
    const res = await app.request(url, { method, headers: bearer, body: body === undefined ? undefined : JSON.stringify(body) });
    assert.equal(res.status, 403, `${method} ${url}`);
  }
  const none = await app.request("/api/company/switch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paused: true }) });
  assert.equal(none.status, 401);
  const jorge = { "Content-Type": "application/json", Cookie: `${SESSION_COOKIE}=${createSession()}` };
  const set = await app.request("/api/company/budgets", { method: "PUT", headers: jorge, body: JSON.stringify({ scope: "role", role: "taller", weekly_limit: 123_456 }) });
  assert.equal(set.status, 200);
  assert.equal(Number((await raw.query(`select weekly_limit from token_budgets where role = 'taller'`)).rows[0].weekly_limit), 123_456);
  const guard = await app.request("/api/company/settings", { method: "PUT", headers: jorge, body: JSON.stringify({ plan_guard_pct: 65 }) });
  assert.equal(((await guard.json()) as { plan_guard_pct: number }).plan_guard_pct, 65);
});

// ---- PLA-I29-7: cap, cooldown, plan guard

test("I29-7 #1: with cap 1 and one live run, a second wake is queued, not spawned; it starts when the slot frees", async () => {
  const f = fakes();
  await ready("micasa", "RUN-CAP");
  const first = await wake("taller", f.deps, "RUN-CAP");
  assert.equal(first.run!.status, "running");
  const second = await wake("workia", f.deps);
  assert.equal(second.reason, "queued");
  assert.equal(f.spawned.length, 1);
  // Coalescing: the same agent again writes nothing.
  const again = await wake("taller", f.deps, "RUN-CAP");
  assert.equal(again.reason, "coalesced");
  assert.equal(Number((await raw.query(`select count(*) from agent_runs`)).rows[0].count), 2);
  f.spawned[0]!.child.write([resultEvent({ m: { inputTokens: 1, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 } })]);
  f.spawned[0]!.child.exit(0);
  await runner.waitForAllRuns();
  const drained = await runner.drainQueue(db, new Date(), f.deps as never);
  assert.equal(drained.started, 1);
  assert.equal(f.spawned.length, 2);
  f.spawned[1]!.child.exit(143);
  await runner.waitForAllRuns();
});

test("I29-7 #2: a rate_limit_event allowed_warning makes the next wake 'skipped: plan guard' with resetsAt", async () => {
  const f = fakes();
  await raw.query(`delete from plan_readings`);
  await ready("micasa", "RUN-PG");
  await wake("taller", f.deps, "RUN-PG").catch(() => undefined);
  // No reading at all is unknown = stop, and the free probe found nothing.
  assert.equal((await runsOf("taller")).at(-1)!.summary, "skipped: plan guard (usage unknown)");
  await freshReading(10);
  await wake("taller", f.deps, "RUN-PG");
  const resets = Math.floor(Date.now() / 1000) + 3600;
  f.spawned[0]!.child.write([rateLimit("allowed_warning", 0.5, resets), resultEvent({ m: { inputTokens: 1, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 } })]);
  f.spawned[0]!.child.exit(0);
  await runner.waitForAllRuns();
  await new Promise((r) => setTimeout(r, 20));
  const next = await wake("taller", f.deps, "RUN-PG");
  assert.equal(next.run!.status, "skipped");
  assert.equal(next.run!.summary, `skipped: plan guard (status allowed_warning, resetsAt ${new Date(resets * 1000).toISOString()})`);
  // Over the 70% guard.
  await raw.query(`delete from plan_readings`);
  await freshReading(71);
  const over = await wake("taller", f.deps, "RUN-PG");
  assert.match(over.run!.summary, /^skipped: plan guard \(five_hour 71% >= 70%/);
  assert.equal(f.spawned.length, 1);
  // The free /usage probe fills an unknown reading.
  await raw.query(`delete from plan_readings`);
  runner.resetRunnerForTests();
  const probed = await wake("taller", { ...f.deps, probeUsage: async () => "Current session: 12% used · resets x\nCurrent week (all models): 3% used" }, "RUN-PG");
  assert.equal(probed.run!.status, "running");
  f.spawned[1]!.child.exit(143);
  await runner.waitForAllRuns();
});

test("I29-7 #3: a wake inside the cooldown is 'skipped: cooldown'", async () => {
  const f = fakes();
  await raw.query(`update runner_settings set cooldown_minutes = 30`);
  await ready("micasa", "RUN-CD");
  await wake("taller", f.deps, "RUN-CD");
  f.spawned[0]!.child.exit(143);
  await runner.waitForAllRuns();
  const next = await wake("taller", f.deps, "RUN-CD");
  assert.equal(next.run!.status, "skipped");
  assert.equal(next.run!.summary, "skipped: cooldown");
  assert.equal(f.spawned.length, 1);
});

// ---- PLA-I29-8: kill switches

const jorge = () => ({ "Content-Type": "application/json", Cookie: `${SESSION_COOKIE}=${createSession()}` });

test("I29-8 #1: company off: live runs get SIGINT and the heartbeat job spawns 0 processes", async () => {
  const f = fakes({ onSignal: (child, signal) => signal === "SIGINT" && child.exit(130) });
  await ready("micasa", "RUN-KS");
  await wake("taller", f.deps, "RUN-KS");
  const pid = f.spawned[0]!.child.pid;
  const off = await app.request("/api/company/switch", { method: "POST", headers: jorge(), body: JSON.stringify({ paused: true }) });
  assert.equal(off.status, 200);
  assert.deepEqual(await off.json(), { paused: true, stopped: 1 });
  assert.deepEqual(f.signals[0], { pid, signal: "SIGINT" });
  await runner.waitForAllRuns();
  assert.equal((await raw.query(`select status from agent_runs`)).rows[0].status, "stopped");

  await raw.query(`update agents set heartbeat_minutes = 1, last_heartbeat_at = null where slug in ('taller', 'housi', 'workia')`);
  const before = f.spawned.length;
  const counts = await runHeartbeat(db, new Date(Date.now() + 5 * 60_000), { runner: f.deps as never });
  assert.equal(f.spawned.length, before);
  assert.equal(counts.woken, 0);
  assert.equal((await runsOf("housi")).at(-1)!.summary, "skipped: company paused");
  await raw.query(`update agents set heartbeat_minutes = null where slug in ('taller', 'housi', 'workia')`);
});

test("I29-8 #2: with only micasa off, workia still runs; its live run is stopped by the switch", async () => {
  const f = fakes({ onSignal: (child, signal) => signal === "SIGINT" && child.exit(130) });
  await raw.query(`update runner_settings set max_concurrent = 2`);
  await ready("micasa", "RUN-PP");
  await wake("taller", f.deps, "RUN-PP");
  const off = await app.request("/api/company/projects/micasa/switch", { method: "POST", headers: jorge(), body: JSON.stringify({ paused: true }) });
  assert.equal(((await off.json()) as { stopped: number }).stopped, 1);
  await runner.waitForAllRuns();
  const blocked = await wake("housi", f.deps);
  assert.equal(blocked.run!.summary, "skipped: project micasa paused");
  const other = await wake("workia", f.deps);
  assert.equal(other.run!.status, "running");
  f.spawned.at(-1)!.child.exit(143);
  await runner.waitForAllRuns();
});

test("I29-8 #3: resuming the company leaves a self-paused project paused; new projects start paused", async () => {
  await app.request("/api/company/projects/micasa/switch", { method: "POST", headers: jorge(), body: JSON.stringify({ paused: true }) });
  await app.request("/api/company/switch", { method: "POST", headers: jorge(), body: JSON.stringify({ paused: true }) });
  await app.request("/api/company/switch", { method: "POST", headers: jorge(), body: JSON.stringify({ paused: false }) });
  const res = await app.request("/api/company", { headers: { Cookie: `${SESSION_COOKIE}=${createSession()}` } });
  const state = (await res.json()) as Awaited<ReturnType<typeof companyState>>;
  assert.equal(state.company.paused, false);
  assert.equal(state.projects.find((p) => p.slug === "micasa")!.paused, true);
  assert.equal(state.projects.find((p) => p.slug === "workia")!.paused, false);
  // The read API shape the Compañía page uses.
  assert.deepEqual(Object.keys(state).sort(), ["company", "plan", "projects", "roles", "runs", "settings", "week"]);
  assert.deepEqual(Object.keys(state.projects[0]!.budget).sort(), ["limit", "pct", "reason", "state", "used"]);
  assert.deepEqual(state.roles.map((r) => r.role), ["product-owner", "taller", "research", "artist", "asistente"]);
  assert.deepEqual(Object.keys(state.plan).sort(), ["five_hour_pct", "guard_pct", "read_at", "resets_at", "seven_day_pct", "seven_day_resets_at", "source", "state", "status"]);
  assert.equal(state.plan.guard_pct, 70);
  assert.equal(state.week.timezone, "America/Mexico_City");
  // A project created now starts paused (the column default PLA-I31-3 relies on).
  await raw.query(`insert into projects (slug, title, key_prefix) values ('nuevo', 'Nuevo', 'NUE')`);
  assert.equal((await raw.query(`select runs_paused from projects where slug = 'nuevo'`)).rows[0].runs_paused, true);
});
