// PLA-I40-2: Que empiece ya. One teammate's queued run starts now, skipping the rest between runs once; with
// none queued, one run on its Ready work. The switches, the plan guard (unless past_guard) and the cap stand.
// Every process is a fake child; throwaway DB; nothing reaches a real claude or repo.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { after, before, beforeEach, test } from "node:test";
import { resetTestStore, useTestEnv, type TestStore } from "./helpers.js";

useTestEnv();
process.env.PLANIA_EVENT_WAKES = "1";
process.env.PLANIA_HOME_PROJECT = "zigzag";
process.env.PLANIA_PROMPTS_PROJECT = "micasa";
const { makeDb } = await import("../src/db/client.js");
const { app } = await import("../src/app.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const { seedOrg } = await import("../scripts/seed-org.js");
const writes = await import("../src/mcp/writes.js");
const runner = await import("../src/runner/runner.js");
const actions = await import("../src/api/company-actions.js");
const { EVENT_SUMMARY } = await import("../src/runner/events.js");
const { ne } = await import("../src/store/types.js");

type Db = ReturnType<typeof makeDb>["db"];
let store: TestStore;
let db: Db;
let closeDb: () => Promise<void>;
const scratch = mkdtempSync(path.join(tmpdir(), "plania-i40-start-"));
const A = { actor: { agent: "test-agent", session_id: "s-i40-start" } };
const jorge = () => ({ Cookie: `${SESSION_COOKIE}=${createSession()}`, "Content-Type": "application/json" });

class FakeChild extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  constructor(readonly pid: number) {
    super();
  }
  finish(subtype = "success"): void {
    const result = { type: "result", subtype, is_error: subtype !== "success", num_turns: 2, session_id: "sess-i32", result: "OK", modelUsage: { "claude-opus-5-5": { inputTokens: 10, outputTokens: 20, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 } } };
    this.stdout.write(`${JSON.stringify(result)}\n`);
    this.stdout.end();
    setImmediate(() => this.emit("exit", subtype === "success" ? 0 : 1, null));
  }
}

function fakes() {
  const spawned: { args: string[]; cwd: string; child: FakeChild }[] = [];
  let pid = 50_000;
  const deps = {
    env: { HOME: scratch, PATH: "/usr/bin:/bin", PLANIA_RUNNER_TOKEN: "runner-token", PLANIA_PROMPTS_PROJECT: "micasa", CLAUDE_CODE_BIN: "/fake/bin/claude" } as NodeJS.ProcessEnv,
    logDir: path.join(scratch, "logs"),
    tmpDir: path.join(scratch, "tmp"),
    worktreeRoot: path.join(scratch, "worktrees"),
    graceMs: 10,
    liveFlushMs: 0,
    footprints: false,
    git: async () => ({ code: 0, stdout: "", stderr: "" }),
    spawn: (_command: string, args: string[], options: { cwd: string }) => {
      const child = new FakeChild(++pid);
      spawned.push({ args, cwd: options.cwd, child });
      return child;
    },
    kill: () => undefined,
    reportTokens: async () => undefined,
    probeUsage: async () => null,
  };
  return { deps, spawned };
}

const pid = async (slug: string) => store.projectId(slug);
const aid = async (slug: string) => (await store.get("agents", { slug }))!.id;
// The agent's runs, oldest first (queued_at, then id).
const runs = async (slug: string) =>
  (await store.find("agentRuns", { agentId: await aid(slug) }, { orderBy: [{ column: "queuedAt" }, { column: "id" }] })).map((r) => ({ id: r.id, status: r.status, task_key: r.taskKey }));
const ticket = async (title: string) => ((await writes.createTask(db, { project: "micasa", title, scope: "s", checks: ["c"], status: "Ready" } as never, A)) as { key: string }).key;
const queue = async (key: string) => {
  const [agentId, projectId] = [await aid("taller-micasa"), await pid("micasa")];
  // PLA-I60: the agent's own periodic wake (trigger cadence) is the one the rest paces.
  const row = await store.fix((uow) =>
    uow.insert("agentRuns", { agentId, projectId, role: "taller", status: "queued", summary: `${EVENT_SUMMARY} unblocked`, taskKey: key, workKey: `task:${key}`, trigger: "cadence" }),
  );
  return row.id;
};
const rested = (minutesAgo: number) =>
  store.fix((uow) => {
    const hourAgo = new Date(uow.now.getTime() - 3_600_000);
    return uow.insert("agentRuns", {
      agentId: aid_taller, projectId: pid_micasa, role: "taller", status: "ok", summary: "listo", queuedAt: hourAgo, startedAt: hourAgo, endedAt: new Date(uow.now.getTime() - minutesAgo * 60_000), trigger: "cadence",
    });
  });
const reading = (pct: number) =>
  store.fix((uow) => uow.insert("planReadings", { at: uow.now, source: "stream", status: "allowed", fiveHourPct: pct, fiveHourResetsAt: new Date(uow.now.getTime() + 3 * 3_600_000) }));
const setSettings = (patch: { companyPaused?: boolean; maxConcurrent?: number }) => store.fix((uow) => uow.update("runnerSettings", { id: 1 }, patch));
const setPaused = (slug: string, runsPaused: boolean) => store.fix((uow) => uow.update("projects", { slug }, { runsPaused }));
const go = (f: ReturnType<typeof fakes>, opts: Record<string, unknown> = {}) => actions.startTeammateNow(db, "micasa", "taller-micasa", opts, { runner: f.deps } as never) as Promise<Record<string, any>>;
const post = (path: string, headers: Record<string, string> = jorge(), body?: unknown) => app.request(path, { method: "POST", headers, body: body === undefined ? undefined : JSON.stringify(body) });
let aid_taller = "";
let pid_micasa = "";

before(async () => {
  store = await resetTestStore();
  ({ db, close: closeDb } = makeDb());
  await seedOrg(db);
  const actor = { agent: "test", session_id: "s" };
  const micasa = await pid("micasa");
  await store.fix(async (uow) => {
    for (const title of ["Prompt: Product owner", "Prompt: Taller"]) {
      await uow.insert("docs", { projectId: micasa, title, markdown: `# ${title}\nNever main.`, actor });
    }
  });
  aid_taller = await aid("taller-micasa");
  pid_micasa = await pid("micasa");
});

beforeEach(async () => {
  await runner.waitForAllRuns();
  runner.resetRunnerForTests();
  await store.fix(async (uow) => {
    // run_locks went with agent_runs through the foreign key.
    await uow.delete("runLocks", {});
    await uow.delete("agentRuns", {});
    await uow.delete("heartbeatRuns", {});
    await uow.delete("events", { type: "wake.forced" });
    await uow.update("tasks", { kind: "ticket", status: ["Ready", "In progress"] }, { status: "Done" });
    await uow.update("runnerSettings", { id: 1 }, { companyPaused: false, maxConcurrent: 2, cooldownMinutes: 30, planGuardPct: 70, guardOverride: false, reserveTokens: 1000 });
    await uow.update("projects", { slug: ne("micasa") }, { runsPaused: true });
    await uow.update("projects", { slug: "micasa" }, { runsPaused: false });
    await uow.delete("planReadings", {});
  });
  await reading(10);
});

after(async () => {
  await runner.waitForAllRuns();
  await closeDb?.();
  await store?.end();
  rmSync(scratch, { recursive: true, force: true });
});

test("I40-2 #1: a queued run inside the rest starts on Que empiece ya, is logged, and the next run rests in full", async () => {
  const f = fakes();
  const first = await ticket("Ficha de la casa");
  await rested(2);
  const runId = await queue(first);
  assert.equal((await runner.drainQueue(db, new Date(), f.deps as never)).started, 0, "the queue waits out the rest");

  const out = await go(f);
  assert.deepEqual([out.started, out.reason, out.ticket, out.run_id], [true, "started", first, runId]);
  assert.equal(f.spawned.length, 1);
  const forced = await store.find("events", { type: "wake.forced" });
  assert.equal(forced.length, 1);
  assert.deepEqual([forced[0]!.payload.run_id, forced[0]!.payload.agent, forced[0]!.payload.past_guard, forced[0]!.taskKey, forced[0]!.actor.agent], [runId, "taller-micasa", false, first, "jorge"]);

  f.spawned[0]!.child.finish();
  await runner.waitForRun(runId);
  const second = await ticket("Lista de casas");
  await queue(second);
  assert.equal((await runner.drainQueue(db, new Date(), f.deps as never)).started, 0, "nothing was stored: the next run waits its rest");
  const agent = await store.get("agents", { slug: "taller-micasa" });
  // PLA-I60-4: a retry (what canStart judges) does not wait for the rest.
  assert.deepEqual(await runner.canStart(db, agent!, pid_micasa, second, new Date(), f.deps as never), { ok: true, summary: "" });
  assert.equal(f.spawned.length, 1);
});

test("I40-2 #2: refused while the company or the project is paused, for a stranger, and from a Bearer", async () => {
  await ticket("Ficha de la casa");
  const url = "/api/company/projects/micasa/team/taller-micasa/start";
  const bearer = await post(url, { Authorization: "Bearer plania_x", Cookie: jorge().Cookie!, "Content-Type": "application/json" });
  assert.equal(bearer.status, 403);
  assert.equal((await post(url, { "Content-Type": "application/json" })).status, 401);
  assert.equal((await post(url, jorge(), { past_guard: "si" })).status, 400);

  await setSettings({ companyPaused: true });
  const company = await post(url);
  assert.deepEqual([company.status, ((await company.json()) as { error: string }).error], [409, "COMPANY_PAUSED"]);
  await setSettings({ companyPaused: false });
  await setPaused("micasa", true);
  const project = await post(url);
  assert.deepEqual([project.status, ((await project.json()) as { error: string }).error], [409, "PROJECT_PAUSED"]);
  await setPaused("micasa", false);
  const stranger = await post("/api/company/projects/micasa/team/taller-workia/start");
  assert.deepEqual([stranger.status, ((await stranger.json()) as { error: string }).error], [404, "AGENT_NOT_FOUND"]);
  assert.deepEqual(await runs("taller-micasa"), [], "no refusal left a run behind");
});

test("I40-2 #3: with Ready work and no queued run it queues and starts one run; asked again while it works, it is busy", async () => {
  const f = fakes();
  const key = await ticket("Ficha de la casa");
  await rested(2);
  const out = await go(f);
  assert.deepEqual([out.started, out.reason, out.ticket], [true, "started", key]);
  const again = await go(f);
  assert.deepEqual([again.started, again.reason], [false, "busy"]);
  assert.deepEqual((await runs("taller-micasa")).filter((r) => r.status !== "ok").map((r) => [r.status, r.task_key]), [["running", key]]);
  assert.equal(f.spawned.length, 1);
  f.spawned[0]!.child.finish();
});

test("I40-2 #4: with nothing Ready and nothing queued it says idle and starts nothing", async () => {
  const f = fakes();
  const out = await go(f);
  assert.deepEqual([out.started, out.reason, out.run_id], [false, "idle", null]);
  assert.equal(f.spawned.length, 0);
});

test("I40-2 #5: over the plan guard it is held and stays queued; past_guard starts it this once", async () => {
  const f = fakes();
  const runId = await queue(await ticket("Ficha de la casa"));
  await reading(77);
  const held = await go(f);
  assert.deepEqual([held.started, held.reason], [false, "held"]);
  assert.match(held.summary, /^skipped: plan guard \(five_hour 77% >= 70%/);
  assert.deepEqual((await runs("taller-micasa")).map((r) => r.status), ["queued"]);

  const out = await go(f, { past_guard: true });
  assert.deepEqual([out.started, out.run_id], [true, runId]);
  assert.equal((await store.find("events", { type: "wake.forced" }))[0]!.payload.past_guard, true);
  assert.equal((await store.get("runnerSettings", { id: 1 }))!.guardOverride, false, "the switch itself is untouched");
  f.spawned[0]!.child.finish();
});

test("I40-2 #6: with every slot taken it stays queued for the next one and nothing starts", async () => {
  const f = fakes();
  await setSettings({ maxConcurrent: 1 });
  const po = await aid("po-micasa");
  await store.fix((uow) => uow.insert("agentRuns", { agentId: po, projectId: pid_micasa, role: "product-owner", status: "running", summary: "starting", startedAt: uow.now }));
  const key = await ticket("Ficha de la casa");
  const out = await go(f);
  assert.deepEqual([out.started, out.reason, out.ticket], [false, "queued", key]);
  assert.deepEqual((await runs("taller-micasa")).map((r) => r.status), ["queued"]);
  assert.equal(f.spawned.length, 0);
  assert.equal(await store.count("events", { type: "wake.forced" }), 0);
});
