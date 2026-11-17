// PLA-I29: the runner, its limits and kill switches. Every process is a fake child; git is a fake;
// no real claude, no real worktree, no live database (test/helpers.ts throwaway store).
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { after, before, beforeEach, test } from "node:test";
import type { NewRow, UnitOfWork } from "../src/store/types.js";
import { TEST_BEARER, ownerCode, resetTestStore, useOwnerCode, useTestEnv, type TestStore } from "./helpers.js";

useTestEnv();
await useOwnerCode();
const { makeDb } = await import("../src/db/client.js");
const { ne } = await import("../src/store/types.js");
const { app } = await import("../src/app.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const { seedLegacyOrg: seedOrg } = await import("./fixtures/legacy-org.js");
const writes = await import("../src/mcp/writes.js");
const { runHeartbeat, wakeAgent } = await import("../src/jobs/heartbeat.js");
const runner = await import("../src/runner/runner.js");
const { supervise, childEnv } = await import("../src/runner/process.js");
const { parseStream, parseUsageText } = await import("../src/runner/stream.js");
const { DENY_RULES, deniedBy } = await import("../src/runner/deny.js");
const { checkBase, ensureWorktree, isInside, worktreePathFor } = await import("../src/runner/worktree.js");
const { companyState } = await import("../src/runner/company.js");

type Db = ReturnType<typeof makeDb>["db"];
let store: TestStore;
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
  const agent = await store.get("agents", { slug });
  if (!agent) throw new Error(`no agent ${slug}`);
  return agent.id;
}
async function projectId(slug: string): Promise<string> {
  return store.projectId(slug);
}
async function freshReading(five = 10, status = "allowed"): Promise<void> {
  await store.fix(async (uow) => {
    await uow.delete("planReadings", {});
    const now = Date.now();
    await uow.insert("planReadings", { at: new Date(now), source: "stream", status, fiveHourPct: five, sevenDayPct: 19, fiveHourResetsAt: new Date(now + 3 * 3_600_000) });
  });
}
// A finished run this week that used `tokens` in the project (role product-owner unless given).
async function usedTokens(project: string, tokens: number, role = "research"): Promise<void> {
  const [agent, projectRow] = [await agentId("research"), await projectId(project)];
  const minuteAgo = new Date(Date.now() - 60_000);
  await store.fix((uow) =>
    uow.insert("agentRuns", { agentId: agent, projectId: projectRow, role, status: "ok", startedAt: minuteAgo, endedAt: minuteAgo, inputTokens: tokens, tokensTotal: tokens, queuedAt: minuteAgo }),
  );
}
// The one runner_settings row (the migration seeds it on Postgres; on devva the first fix makes it).
async function settings(patch: Partial<NewRow<"runnerSettings">>): Promise<void> {
  await store.fix(async (uow) => {
    if (!(await uow.get("runnerSettings", { id: 1 }))) await uow.insert("runnerSettings", { id: 1 });
    await uow.update("runnerSettings", { id: 1 }, patch);
  });
}
// `delete from tasks` took with it, through the foreign keys, every row that pointed at the tickets. The store
// does not cascade, so those rows go first, children before parents, and the pointers a set null cleared are cleared.
async function deleteTasks(uow: UnitOfWork, ids: string[]): Promise<void> {
  if (!ids.length) return;
  await deleteTasks(uow, (await uow.find("tasks", { parentId: ids })).map((t) => t.id));
  const questions = (await uow.find("questions", { taskId: ids })).map((q) => q.id);
  const docs = (await uow.find("docs", { taskId: ids })).map((d) => d.id);
  const results = (await uow.find("results", { taskId: ids })).map((r) => r.id);
  if (questions.length) {
    await uow.delete("delegatedAnswers", { questionId: questions });
    await uow.update("threadMessages", { questionId: questions }, { questionId: null });
  }
  if (docs.length) await uow.update("decisions", { docId: docs }, { docId: null });
  if (results.length) await uow.update("checks", { evidenceId: results }, { evidenceId: null });
  await uow.delete("questions", { taskId: ids });
  await uow.delete("docs", { taskId: ids });
  await uow.delete("checks", { taskId: ids });
  await uow.delete("results", { taskId: ids });
  await uow.delete("blockers", { taskId: ids });
  await uow.delete("taskComments", { taskId: ids });
  await uow.delete("taskAliases", { taskId: ids });
  await uow.delete("taskBlockers", { taskId: ids });
  await uow.delete("taskBlockers", { blockerId: ids });
  await uow.update("decisions", { taskId: ids }, { taskId: null });
  await uow.update("sequenceReservations", { taskId: ids }, { taskId: null });
  await uow.update("branches", { ownerTaskId: ids }, { ownerTaskId: null });
  await uow.update("footprints", { taskId: ids }, { taskId: null });
  await uow.update("pullRequests", { taskId: ids }, { taskId: null });
  await uow.update("events", { taskId: ids }, { taskId: null });
  await uow.delete("tasks", { id: ids });
}
async function ready(project: string, key: string, title = "Example ticket"): Promise<void> {
  await writes.createTask(db, { project, key, title, scope: "Scope", checks: ["Done"], status: "Ready" } as never, ctx);
}
async function runsOf(slug: string): Promise<{ status: string; summary: string; task_key: string | null }[]> {
  const agent = await store.get("agents", { slug });
  if (!agent) return [];
  const runs = await store.find("heartbeatRuns", { agentId: agent.id }, { orderBy: [{ column: "startedAt" }, { column: "id" }] });
  return runs.map((r) => ({ status: r.status, summary: r.summary, task_key: r.taskKey }));
}
const wake = (slug: string, deps: unknown, taskKey?: string, trigger?: "cadence" | "owner") =>
  wakeAgent(db, { agent: slug, taskKey, now: new Date(), trigger }, { runner: deps as never });

before(async () => {
  store = await resetTestStore();
  ({ db, close: closeDb } = makeDb());
  await seedOrg(db);
  mkdirSync(repo, { recursive: true });
  mkdirSync(repoWorkia, { recursive: true });
  const [micasa, workia] = [await projectId("micasa"), await projectId("workia")];
  await store.fix(async (uow) => {
    await uow.update("agents", {}, { heartbeatMinutes: null, adapter: "none", adapterConfig: {} });
    // housi = PO of micasa, workia = PO of workia, taller = Taller. All claude_code, no cadence lock.
    await uow.update("agents", { slug: ["housi", "workia", "taller", "zigzag"] }, { adapter: "claude_code" });
    await uow.update("projects", { slug: "micasa" }, { settings: { local: { repo_path: repo } } });
    await uow.update("projects", { slug: "workia" }, { settings: { local: { repo_path: repoWorkia } } });
    const actor = { agent: "test", session_id: "s" };
    for (const title of ["Prompt: Product owner", "Prompt: Taller", "Prompt: Research", "Prompt: Artist", "Prompt: Asistente"]) {
      await uow.insert("docs", { projectId: micasa, title, markdown: `# ${title}\nNever main.`, actor });
    }
    await uow.insert("goals", { projectId: micasa, title: "Ship the MiCasa beta", why: "first users" });
    await uow.insert("goals", { projectId: workia, title: "Workia goal", why: "" });
  });
});

beforeEach(async () => {
  await runner.waitForAllRuns();
  runner.resetRunnerForTests();
  await store.fix(async (uow) => {
    await uow.delete("agentRuns", {});
    await uow.delete("agentSessions", {});
    await uow.delete("heartbeatRuns", {});
  });
  await settings({ companyPaused: false, maxConcurrent: 1, cooldownMinutes: 0, planGuardPct: 70, guardOverride: false, reserveTokens: 1000 });
  await store.fix(async (uow) => {
    await uow.update("projects", { slug: ["micasa", "workia"] }, { runsPaused: false });
    await deleteTasks(uow, (await uow.find("tasks")).filter((t) => t.key.startsWith("RUN-")).map((t) => t.id));
  });
  await freshReading(10);
});

after(async () => {
  await runner.waitForAllRuns();
  await closeDb?.();
  await store?.end();
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
  const [row] = await store.find("agentRuns");
  const run = { status: row!.status, summary: row!.summary, turns: row!.turns, tokens_total: row!.tokensTotal, claude_session_id: row!.claudeSessionId };
  assert.equal(run.status, "ok");
  assert.equal(Number(run.tokens_total), 2 + 4 + 10835 + 16161 + 120 + 45 + 300);
  assert.equal(run.turns, 3);
  assert.equal(run.claude_session_id, "sess-aaaa-1111");
  assert.equal(JSON.stringify(run).includes("0.13"), false);
  const hb = await runsOf("taller");
  assert.equal(hb.at(-1)!.status, "ok");
  assert.match(hb.at(-1)!.summary, /^ok: success, 3 turns, session sess-aaa/);
  // The stream's rate_limit_event became the plan reading.
  const [last] = await store.find("planReadings", {}, { orderBy: [{ column: "at", desc: true }], limit: 1 });
  const reading = { status: last!.status, five_hour_pct: last!.fiveHourPct, seven_day_pct: last!.sevenDayPct, source: last!.source };
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
  const [row] = await store.find("agentRuns");
  const run = { status: row!.status, summary: row!.summary, tokens_total: row!.tokensTotal, usage_known: row!.usageKnown, exit_code: row!.exitCode };
  assert.deepEqual({ ...run, tokens_total: Number(run.tokens_total) }, { status: "fail", summary: "fail: no result", tokens_total: 0, usage_known: true, exit_code: 143 });
  const hb = await runsOf("taller");
  assert.equal(hb.at(-1)!.status, "fail");
  assert.equal(hb.at(-1)!.summary, "fail: no result");
});

test("I29-2: the orphan sweep stops a run left by an earlier server and closes it", async () => {
  const [taller, micasa] = [await agentId("taller"), await projectId("micasa")];
  await store.fix((uow) => uow.insert("agentRuns", { agentId: taller, projectId: micasa, role: "taller", status: "running", pid: 99999, startedAt: new Date(), taskKey: "RUN-ORPH" }));
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
  const [row] = await store.find("agentRuns");
  const run = { status: row!.status, summary: row!.summary, usage_known: row!.usageKnown };
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
  await store.fix((uow) => uow.update("projects", { slug: "zigzag" }, { runsPaused: false }));
  const res = await wake("zigzag", f.deps);
  assert.equal(res.run!.status, "skipped");
  assert.equal(res.run!.summary, "skipped: no goal");
  assert.equal(f.spawned.length, 0);
  await store.fix((uow) => uow.update("projects", { slug: "zigzag" }, { runsPaused: true }));
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
  await store.fix((uow) => uow.update("tasks", { key: "RUN-DONE" }, { status: "Done" }));
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
  await store.fix((uow) => uow.update("tasks", { key: "RUN-MAIN" }, { branch: "main" }));
  const res = await wake("taller", f.deps, "RUN-MAIN");
  assert.equal(res.run!.status, "fail");
  assert.equal(res.run!.summary, "fail: base not allowed");
  assert.equal(f.spawned.length, 0);
  assert.deepEqual(checkBase("jl/x", "main"), { ok: false, summary: "fail: base not allowed (main)" });
  assert.deepEqual(checkBase("jl/x", null), { ok: true });
});

// ---- PLA-21: no token budgets (Jorge, 2026-11-12). The week's tokens are shown, never checked.

test("PLA-21 #1: however many tokens a project used this week, a new run starts and no warning is written", async () => {
  const f = fakes();
  await usedTokens("micasa", 50_000_000);
  await ready("micasa", "RUN-NOLIMIT");
  const a = await wake("taller", f.deps, "RUN-NOLIMIT");
  assert.equal(a.run!.status, "running");
  assert.doesNotMatch(a.run!.summary, /BUDGET/);
  assert.equal(await store.count("events", { type: "budget.warning" }), 0);
  f.spawned[0]!.child.write([resultEvent({ m: { inputTokens: 1000, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 } })]);
  f.spawned[0]!.child.exit(0);
  await runner.waitForAllRuns();
  const state = await companyState(db);
  const micasa = state.projects.find((p) => p.slug === "micasa")!;
  // PLA-I46-5: used is input + output; the parts travel with it.
  assert.deepEqual(micasa.usage, { used: 50_001_000, input: 50_001_000, output: 0, cache_read: 0, cache_create: 0 });
  assert.equal("budget" in micasa, false);
});

test("PLA-21 #2: a live run is never stopped for tokens; a run whose usage is unknown blocks nothing", async () => {
  const f = fakes();
  const [taller, micasa] = [await agentId("taller"), await projectId("micasa")];
  await store.fix((uow) => uow.insert("agentRuns", { agentId: taller, projectId: micasa, role: "taller", status: "fail", startedAt: uow.now, endedAt: uow.now, usageKnown: false }));
  await ready("micasa", "RUN-UNK");
  const res = await wake("taller", f.deps, "RUN-UNK");
  assert.equal(res.run!.status, "running");
  await usedTokens("micasa", 900_000_000);
  assert.equal(await runner.enforceLive(db, new Date()), 0);
  assert.equal(f.signals.length, 0);
  f.spawned[0]!.child.exit(143);
  await runner.waitForAllRuns();
});

test("I29-6 #4 and I29-8 #4: an agent token on any switch or settings write gets 403; the cookie works; no budget route", async () => {
  const bearer = { Authorization: `Bearer ${TEST_BEARER}`, "Content-Type": "application/json", Cookie: `${SESSION_COOKIE}=${createSession()}` };
  const writesToTry: [string, string, unknown][] = [
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
  // PLA-21: the budget route and Asistente's limit are gone.
  const gone = await app.request("/api/company/budgets", { method: "PUT", headers: jorge, body: JSON.stringify({ scope: "project", project: "micasa", weekly_limit: 123_456 }) });
  assert.equal(gone.status, 404);
  const asis = await app.request("/api/company/settings", { method: "PUT", headers: jorge, body: JSON.stringify({ asistente_weekly_limit: 654_321 }) });
  assert.equal(asis.status, 400);
  const guard = await app.request("/api/company/settings", { method: "PUT", headers: jorge, body: JSON.stringify({ plan_guard_pct: 65 }) });
  const saved = (await guard.json()) as Record<string, unknown>;
  assert.equal(saved.plan_guard_pct, 65);
  assert.equal("asistente_weekly_limit" in saved, false);
  // PLA-25: the override switch is the same owner-session write; an agent token gets 403.
  const asAgent = await app.request("/api/company/settings", { method: "PUT", headers: bearer, body: JSON.stringify({ guard_override: true }) });
  assert.equal(asAgent.status, 403);
  const on = await app.request("/api/company/settings", { method: "PUT", headers: jorge, body: JSON.stringify({ guard_override: true }) });
  assert.equal(((await on.json()) as Record<string, unknown>).guard_override, true);
  await settings({ guardOverride: false });
});

// ---- PLA-25: the screen switch that goes on past the plan guard

test("PLA-25 #1: with guard_override on, a wake starts at 77% over a 70% guard; off, it is skipped", async () => {
  const f = fakes();
  await ready("micasa", "RUN-OVR");
  await freshReading(77);
  const off = await wake("taller", f.deps, "RUN-OVR");
  assert.match(off.run!.summary, /^skipped: plan guard \(five_hour 77% >= 70%/);
  await settings({ guardOverride: true });
  const on = await wake("taller", f.deps, "RUN-OVR");
  assert.equal(on.run!.status, "running");
  assert.equal(f.spawned.length, 1);
  f.spawned[0]!.child.exit(143);
  await runner.waitForAllRuns();
});

test("PLA-25 #2: with guard_override on, a rejected plan still stops, and an unknown reading does not", async () => {
  const f = fakes();
  await ready("micasa", "RUN-OVR2");
  await settings({ guardOverride: true });
  await freshReading(10, "rejected");
  const rejected = await wake("taller", f.deps, "RUN-OVR2");
  assert.equal(rejected.run!.status, "skipped");
  assert.match(rejected.run!.summary, /^skipped: plan guard \(status rejected/);
  await store.fix((uow) => uow.delete("planReadings", {}));
  const unknown = await wake("taller", f.deps, "RUN-OVR2");
  assert.equal(unknown.run!.status, "running");
  f.spawned[0]!.child.exit(143);
  await runner.waitForAllRuns();
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
  assert.equal(await store.count("agentRuns"), 2);
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
  await store.fix((uow) => uow.delete("planReadings", {}));
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
  await store.fix((uow) => uow.delete("planReadings", {}));
  await freshReading(71);
  const over = await wake("taller", f.deps, "RUN-PG");
  assert.match(over.run!.summary, /^skipped: plan guard \(five_hour 71% >= 70%/);
  assert.equal(f.spawned.length, 1);
  // The free /usage probe fills an unknown reading.
  await store.fix((uow) => uow.delete("planReadings", {}));
  runner.resetRunnerForTests();
  const probed = await wake("taller", { ...f.deps, probeUsage: async () => "Current session: 12% used · resets x\nCurrent week (all models): 3% used" }, "RUN-PG");
  assert.equal(probed.run!.status, "running");
  f.spawned[1]!.child.exit(143);
  await runner.waitForAllRuns();
});

test("I29-7 #3: a periodic wake inside the cooldown is 'skipped: cooldown' (PLA-I60: the rest paces cadence runs only)", async () => {
  const f = fakes();
  await settings({ cooldownMinutes: 30 });
  await ready("micasa", "RUN-CD");
  await wake("taller", f.deps, "RUN-CD", "cadence");
  f.spawned[0]!.child.exit(143);
  await runner.waitForAllRuns();
  const next = await wake("taller", f.deps, "RUN-CD", "cadence");
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
  assert.equal((await store.find("agentRuns"))[0]!.status, "stopped");

  await store.fix((uow) => uow.update("agents", { slug: ["taller", "housi", "workia"] }, { heartbeatMinutes: 1, lastHeartbeatAt: null }));
  const before = f.spawned.length;
  const counts = await runHeartbeat(db, new Date(Date.now() + 5 * 60_000), { runner: f.deps as never });
  assert.equal(f.spawned.length, before);
  assert.equal(counts.woken, 0);
  assert.equal((await runsOf("housi")).at(-1)!.summary, "skipped: company paused");
  await store.fix((uow) => uow.update("agents", { slug: ["taller", "housi", "workia"] }, { heartbeatMinutes: null }));
});

test("I29-8 #2: with only micasa off, workia still runs; its live run is stopped by the switch", async () => {
  const f = fakes({ onSignal: (child, signal) => signal === "SIGINT" && child.exit(130) });
  await settings({ maxConcurrent: 2 });
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

test("I36-9 #2, #3: Detener ends that one run as stopped and frees its ticket; the project keeps running; Seguir queues the same ticket", async () => {
  const f = fakes({ onSignal: (child, signal) => signal === "SIGINT" && child.exit(130) });
  await settings({ maxConcurrent: 2 });
  await app.request("/api/company/projects/micasa/switch", { method: "POST", headers: jorge(), body: JSON.stringify({ paused: false }) });
  await ready("micasa", "RUN-STOP");
  const started = await wake("taller", f.deps, "RUN-STOP");
  const runId = (await store.get("agentRuns", { taskKey: "RUN-STOP", status: "running" }))?.id as string;
  assert.ok(runId, JSON.stringify(started));
  const res = await app.request(`/api/company/runs/${runId}/stop`, { method: "POST", headers: jorge() });
  assert.equal(res.status, 200, await res.clone().text());
  await runner.waitForAllRuns();
  assert.equal((await store.get("agentRuns", { id: runId }))!.status, "stopped");
  assert.equal((await store.get("projects", { slug: "micasa" }))!.runsPaused, false, "the project keeps running");
  assert.ok(f.signals.some((s) => s.signal === "SIGINT"));
  const [noteEvent] = await store.find("events", { taskKey: "RUN-STOP", type: "note" }, { orderBy: [{ column: "id", desc: true }], limit: 1 });
  const note = { text: noteEvent!.payload.text as string };
  assert.match(note.text, /Se detuvo la corrida/);
  // Seguir: the same agent on the same ticket again (cap 0 queues it instead of spawning a real process).
  await settings({ maxConcurrent: 0 });
  const again = await app.request(`/api/company/runs/${runId}/resume`, { method: "POST", headers: jorge() });
  assert.equal(again.status, 200, await again.clone().text());
  const [queued] = await store.find("agentRuns", { taskKey: "RUN-STOP", id: ne(runId) }, { orderBy: [{ column: "queuedAt", desc: true }], limit: 1 });
  assert.equal(queued!.status, "queued");
  assert.equal((await app.request(`/api/company/runs/${runId}/stop`, { method: "POST", headers: jorge() })).status, 409, "a stopped run cannot be stopped again");
  await store.fix((uow) => uow.delete("agentRuns", { taskKey: "RUN-STOP", status: "queued" }));
  await settings({ maxConcurrent: 1 });
});

test("I29-8 #3: resuming the company leaves a self-paused project paused; new projects start paused", async () => {
  await app.request("/api/company/projects/micasa/switch", { method: "POST", headers: jorge(), body: JSON.stringify({ paused: true }) });
  await app.request("/api/company/switch", { method: "POST", headers: jorge(), body: JSON.stringify({ paused: true }) });
  await app.request("/api/company/switch", { method: "POST", headers: jorge(), body: JSON.stringify({ paused: false }) });
  const cookie = { Cookie: `${SESSION_COOKIE}=${createSession()}` };
  // PLA-I32-6: GET /api/company is the Plan's read contract; the runner's plumbing is in GET /api/machine.
  const state = (await (await app.request("/api/company", { headers: cookie })).json()) as {
    company: { paused: boolean };
    week: { timezone: string };
    projects: { slug: string; paused: boolean; usage: Record<string, unknown> }[];
  };
  assert.equal(state.company.paused, false);
  assert.equal(state.projects.find((p) => p.slug === "micasa")!.paused, true);
  assert.equal(state.projects.find((p) => p.slug === "workia")!.paused, false);
  assert.deepEqual(Object.keys(state).sort(), ["asistente", "brief", "company", "decisions", "inbox", "motor_default", "plumbing", "projects", "week"]);
  assert.deepEqual(Object.keys(state.projects[0]!.usage).sort(), ["last_week", "used"]);
  assert.equal(state.week.timezone, "America/Mexico_City");
  const machine = (await (await app.request("/api/machine", { headers: cookie })).json()) as { plumbing: Awaited<ReturnType<typeof companyState>> & { usage: unknown; log: unknown } };
  const plan = machine.plumbing.plan;
  assert.deepEqual(Object.keys(plan).sort(), ["five_hour_pct", "guard_pct", "override", "read_at", "resets_at", "seven_day_pct", "seven_day_resets_at", "source", "state", "status"]);
  assert.equal(plan.guard_pct, 70);
  assert.equal("roles" in machine.plumbing, false, "no role budgets anywhere");
  // A project created now starts paused (the column default PLA-I31-3 relies on).
  await store.fix((uow) => uow.insert("projects", { slug: "nuevo", title: "Nuevo", keyPrefix: "NUE" }));
  assert.equal((await store.get("projects", { slug: "nuevo" }))!.runsPaused, true);
});

// ---- PLA-I59-1 (Motores)

test("I59-1: a seat with motor sonnet/high runs with --model sonnet --effort high and the run records them", async () => {
  const f = fakes();
  await store.fix((uow) => uow.update("agents", { slug: "taller" }, { motorModel: "sonnet", motorEffort: "high" }));
  try {
    await ready("micasa", "RUN-MOTOR");
    const res = await wake("taller", f.deps, "RUN-MOTOR");
    assert.equal(res.reason, "ok");
    const { args } = f.spawned[0]!;
    assert.deepEqual(args.slice(args.indexOf("--model"), args.indexOf("--model") + 2), ["--model", "sonnet"]);
    assert.deepEqual(args.slice(args.indexOf("--effort"), args.indexOf("--effort") + 2), ["--effort", "high"]);
    assert.deepEqual(await lastRequested(), { requested_model: "sonnet", requested_effort: "high" });
    f.spawned[0]!.child.write([resultEvent({ "claude-sonnet-5-5": OPUS })]);
    f.spawned[0]!.child.exit(0);
    await runner.waitForAllRuns();
  } finally {
    await store.fix((uow) => uow.update("agents", { slug: "taller" }, { motorModel: null, motorEffort: null }));
  }
});

// The motor the newest run asked for.
async function lastRequested(): Promise<{ requested_model: string | null; requested_effort: string | null }> {
  const [row] = await store.find("agentRuns", {}, { orderBy: [{ column: "queuedAt", desc: true }], limit: 1 });
  return { requested_model: row!.requestedModel, requested_effort: row!.requestedEffort };
}

test("I59-1: the company default reaches a seat with nothing of its own; with nothing set, neither flag is passed", async () => {
  const f = fakes();
  await settings({ defaultModel: "opus", defaultEffort: "medium" });
  try {
    await ready("micasa", "RUN-MOTOR-CO");
    await wake("taller", f.deps, "RUN-MOTOR-CO");
    const a = f.spawned[0]!.args;
    assert.equal(a[a.indexOf("--model") + 1], "opus");
    assert.equal(a[a.indexOf("--effort") + 1], "medium");
    f.spawned[0]!.child.write([resultEvent({ "claude-opus-5-5": OPUS })]);
    f.spawned[0]!.child.exit(0);
    await runner.waitForAllRuns();
  } finally {
    await settings({ defaultModel: null, defaultEffort: null });
  }
  const g = fakes();
  await ready("micasa", "RUN-MOTOR-NONE");
  await wake("taller", g.deps, "RUN-MOTOR-NONE");
  assert.equal(g.spawned[0]!.args.includes("--model"), false);
  assert.equal(g.spawned[0]!.args.includes("--effort"), false);
  assert.deepEqual(await lastRequested(), { requested_model: null, requested_effort: null });
  g.spawned[0]!.child.write([resultEvent({ "claude-opus-5-5": OPUS })]);
  g.spawned[0]!.child.exit(0);
  await runner.waitForAllRuns();
});

test("I59-1: set_agent stores, refuses with field + hint, and clears a motor; list_agents shows it; the seed still repairs it", async () => {
  const { setAgent, listAgents } = await import("../src/mcp/team.js");
  const v = await setAgent(db, { slug: "research", motor: { model: "Sonnet", effort: "high" }, consulta_motor: { model: "haiku" } });
  assert.deepEqual(v.motor, { model: "sonnet", effort: "high" });
  assert.deepEqual(v.consulta_motor, { model: "haiku", effort: null });
  await assert.rejects(() => setAgent(db, { slug: "research", motor: { model: "gpt-4" } }), (e: { code?: string; detail?: { field?: string; hint?: string } }) => e.code === "INVALID_FILTER" && e.detail?.field === "motor.model" && !!e.detail?.hint);
  await assert.rejects(() => setAgent(db, { slug: "research", motor: { effort: "ultra" } }), (e: { detail?: { field?: string } }) => e.detail?.field === "motor.effort");
  const listed = (await listAgents(db)).agents.find((a) => a.slug === "research")!;
  assert.deepEqual(listed.motor, { model: "sonnet", effort: "high" });
  // The org seed's repair only looks at adapter fields: a seat with a motor and a blank adapter is still repaired.
  const { untouchedAdapter } = await import("../src/runner/team.js");
  const row = (await store.get("agents", { slug: "research" }))!;
  assert.equal(untouchedAdapter({ ...row, adapter: "none", status: "idle", kind: "bot", wakeUrl: null } as never), true);
  const cleared = await setAgent(db, { slug: "research", motor: null, consulta_motor: { model: null } });
  assert.deepEqual(cleared.motor, { model: null, effort: null });
  assert.deepEqual(cleared.consulta_motor, { model: null, effort: null });
});

test("I59-1: PUT /settings takes the company default and refuses a bad model", async () => {
  const token = createSession();
  const put = (body: unknown) => app.request("/api/company/settings", { method: "PUT", headers: { cookie: `${SESSION_COOKIE}=${token}`, "content-type": "application/json", origin: "http://localhost" }, body: JSON.stringify(body) });
  const ok = await put({ default_model: "fable", default_effort: "low" });
  assert.equal(ok.status, 200, await ok.clone().text());
  const s = (await ok.json()) as { default_model: string; default_effort: string };
  assert.deepEqual([s.default_model, s.default_effort], ["fable", "low"]);
  assert.equal((await put({ default_model: "gpt-4" })).status, 400);
  const cleared = (await (await put({ default_model: null, default_effort: null })).json()) as { default_model: null };
  assert.equal(cleared.default_model, null);
});
