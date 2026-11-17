// PLA-I60-6: the runner at scale. Skipped unless PLANIA_LOAD=1 (it takes a minute or two):
//   PLANIA_LOAD=1 node --import tsx --test --test-concurrency=1 test/runner-load.test.ts
// 40 projects × 6 agents, 1 200 queued runs (300 of them duplicate wakes for the same work), ceiling 200, project
// caps 1-8, seat caps 1-3. Four admitters run at once on the one store, each as its own worker id (that is how
// several processes are simulated; each admission is one serialized store write), while fake runs finish after
// 50-400 ms. Midway one worker "restarts" (its memory of live runs is dropped) and another stops renewing its leases
// (its live runs are reaped as worker lost). checkRunnerInvariants runs every 100 ms and must never find anything.
// At the end every non-duplicate run ended exactly once, and the admission and write-lock timings are printed for
// the ticket's evidence.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { after, before, test } from "node:test";
import { resetTestStore, useTestEnv, type TestStore } from "./helpers.js";

const ON = process.env.PLANIA_LOAD === "1";
useTestEnv();
process.env.PLANIA_EVENT_WAKES = "1";
const SCALE = Number(process.env.PLANIA_LOAD_SCALE ?? 1);
const PROJECTS = Math.max(2, Math.round(40 * SCALE));
const AGENTS = 6;
const RUNS = Math.round(1200 * SCALE);
const DUPES = Math.round(300 * SCALE);

const { makeDb } = await import("../src/db/client.js");
const runner = await import("../src/runner/runner.js");
const queue = await import("../src/runner/queue.js");
const { checkRunnerInvariants } = await import("../src/runner/invariants.js");
const { writeLockStats, resetWriteLockStats } = await import("../src/mcp/tx.js");

let store: TestStore;
let db: ReturnType<typeof makeDb>["db"];
const scratch = mkdtempSync(path.join(tmpdir(), "plania-load-"));
const ACTIVE = ["queued", "starting", "running"];

class FakeChild extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  constructor(readonly pid: number) {
    super();
    const ms = 50 + Math.floor(Math.random() * 350);
    setTimeout(() => {
      const result = { type: "result", subtype: "success", is_error: false, num_turns: 1, session_id: "s", result: "OK", modelUsage: { "claude-opus-5-5": { inputTokens: 1, outputTokens: 1, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 } } };
      this.stdout.write(`${JSON.stringify(result)}\n`);
      this.stdout.end();
      setImmediate(() => this.emit("exit", Math.random() < 0.05 ? 1 : 0, null));
    }, ms);
  }
}
let pid = 200_000;
const depsFor = (worker: string) => ({
  env: { HOME: scratch, PATH: "/usr/bin:/bin", PLANIA_RUNNER_TOKEN: "t", PLANIA_PROMPTS_PROJECT: "load00", CLAUDE_CODE_BIN: "/fake/claude", PLANIA_EVENT_WAKES: "1", PLANIA_WORKER_ID: worker, PLANIA_WORKER_MAX_RUNS: "120" } as NodeJS.ProcessEnv,
  logDir: path.join(scratch, "logs"),
  tmpDir: path.join(scratch, "tmp"),
  worktreeRoot: path.join(scratch, "worktrees"),
  graceMs: 10,
  liveFlushMs: 60_000,
  footprints: false,
  git: async () => ({ code: 0, stdout: "", stderr: "" }),
  spawn: () => new FakeChild(++pid),
  kill: () => undefined,
  reportTokens: async () => undefined,
  probeUsage: async () => null,
  machine: () => ({ freeMb: 99_999, freeDiskGb: 999 }),
});

before(async () => {
  if (!ON) return;
  store = await resetTestStore();
  ({ db } = makeDb());
  await store.fix(async (uow) => {
    await uow.update("runnerSettings", { id: 1 }, { maxConcurrent: 200, cooldownMinutes: 0, maxStartsPerMinute: 600, estPctPerRun: 0 });
    const now = new Date();
    await uow.insert("planReadings", { at: now, source: "stream", status: "allowed", fiveHourPct: 10, fiveHourResetsAt: new Date(now.getTime() + 3 * 3_600_000) });
  });
  const actor = { agent: "test", session_id: "s" };
  for (let p = 0; p < PROJECTS; p++) {
    const slug = `load${String(p).padStart(2, "0")}`;
    const repo = path.join(scratch, "repos", slug);
    mkdirSync(repo, { recursive: true });
    const runnerSettings = { max_concurrent: 1 + (p % 8), max_per_agent: 1 + (p % 3), consulta_slots: 1 };
    await store.fix(async (uow) => {
      const project = await uow.insert("projects", { slug, title: slug, keyPrefix: `L${String(p).padStart(2, "0")}`, runsPaused: false, settings: { local: { repo_path: repo }, runner: runnerSettings } });
      if (p === 0) await uow.insert("docs", { projectId: project.id, title: "Prompt: Taller", markdown: "# Taller", actor });
      for (let a = 0; a < AGENTS; a++) {
        const name = `taller-${slug}-${a}`;
        await uow.insert("agents", { slug: name, name, role: "taller", kind: "bot", adapter: "claude_code", adapterConfig: { command_env: "CLAUDE_CODE_BIN" }, roleTemplate: "taller", projectId: project.id });
      }
    });
  }
});

after(async () => {
  rmSync(scratch, { recursive: true, force: true });
  await store?.end();
});

test("I60-6: hundreds of runs, four admitters, a restart and a lost worker: every rule holds", { skip: !ON, timeout: 600_000 }, async () => {
  const all = await store.find("agents", { role: "taller" });
  const projectRows = (await store.find("projects")).filter((p) => p.slug.startsWith("load")).map((p) => ({ id: p.id, slug: p.slug }));
  const byId = new Map(projectRows.map((p) => [p.id, p.slug]));
  const work = Array.from({ length: RUNS }, (_, i) => {
    const agent = all[i % all.length]!;
    return { i, agent, key: `${byId.get(agent.projectId!)!.toUpperCase()}-${i}` };
  });
  // The tickets, a hundred to a write.
  for (let from = 0; from < work.length; from += 100) {
    await store.fix(async (uow) => {
      for (const { i, agent, key } of work.slice(from, from + 100)) {
        await uow.insert("tasks", { projectId: agent.projectId!, key, kind: "ticket", title: `Trabajo ${i}`, status: "Ready", scope: "s", version: 1 });
      }
    });
  }
  // Queued runs. A duplicate is a second wake for a work item already queued.
  const expected = new Set<string>();
  let coalesced = 0;
  for (const { i, agent, key } of work) {
    const out = await queue.insertRun(db, { agent, project: { id: agent.projectId! }, role: "taller", taskKey: key, trigger: "event", reason: "load", summary: "queued: event load" });
    assert.equal(out.kind, "queued");
    if (out.kind === "queued") expected.add(out.run.id);
    if (i < DUPES) {
      const dup = await queue.insertRun(db, { agent, project: { id: agent.projectId! }, role: "taller", taskKey: key, trigger: "event", reason: "load again", summary: "queued: event load" });
      assert.equal(dup.kind, "coalesced");
      coalesced += 1;
    }
  }
  assert.equal(coalesced, DUPES);
  resetWriteLockStats();

  const violations: string[] = [];
  const admitMs: number[] = [];
  const waitMs: number[] = [];
  let stop = false;
  const checker = (async () => {
    while (!stop) {
      for (const v of await checkRunnerInvariants(db)) violations.push(`${v.code} ${v.detail}`);
      await new Promise((r) => setTimeout(r, 100));
    }
  })();
  const workers = ["w1:main", "w2:main", "w3:main", "w4:main"];
  const lost = "w4:main";
  let w4Alive = true;
  const remaining = async () => store.count("agentRuns", { status: ACTIVE });
  const loops = workers.map(async (w) => {
    const deps = depsFor(w);
    while (!stop) {
      if (w === lost && !w4Alive) break;
      const r = await runner.admit(db, new Date(), deps as never).catch((e: unknown) => {
        violations.push(`admit ${w}: ${String(e)}`);
        return null;
      });
      if (r?.txMs != null) admitMs.push(r.txMs);
      if (r?.waitMs != null) waitMs.push(r.waitMs);
      await new Promise((r) => setTimeout(r, 20 + Math.floor(Math.random() * 20)));
    }
  });
  // MCP traffic: 50 agents each writing a note every ~250 ms (about 20 times what hundreds of real agents send), so
  // the global write lock's wait and hold are measured under load (spec 6.12, the gate for T7).
  const { writeTx } = await import("../src/mcp/tx.js");
  const notes = Array.from({ length: 50 }, async (_, i) => {
    const p = projectRows[i % projectRows.length]!;
    while (!stop) {
      await writeTx(db, p, { actor: { agent: `load-${i}`, session_id: `load-${i}` }, tool: "load.note" }, async (_tx, emit) => {
        await emit("note", null, { text: `nota ${i}` });
      }).catch((e: unknown) => violations.push(`write ${i}: ${String(e)}`));
      await new Promise((r) => setTimeout(r, 200 + Math.floor(Math.random() * 100)));
    }
  });
  // Chaos: a restart (live memory dropped; the fake children still finish), then a worker that stops renewing.
  setTimeout(() => runner.resetRunnerForTests(), 1500);
  setTimeout(() => {
    w4Alive = false;
    void store.fix((uow) => uow.update("agentRuns", { workerId: lost, status: "running" }, { leaseUntil: new Date(Date.now() - 5 * 60_000) })).catch(() => undefined);
  }, 3000);
  const deadline = Date.now() + 540_000;
  while ((await remaining()) > 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 250));
  await runner.waitForAllRuns();
  await new Promise((r) => setTimeout(r, 500));
  stop = true;
  await Promise.all([...loops, checker, ...notes]);

  assert.deepEqual(violations, []);
  assert.equal(await remaining(), 0, "every run ended");
  const ended = (await store.find("agentRuns")).map((r) => ({ id: r.id, status: r.status }));
  for (const r of ended) assert.ok(expected.has(r.id), "no run beyond the ones queued");
  assert.equal(ended.length, expected.size, "exactly one row per work item");
  assert.ok(ended.every((r) => ["ok", "fail", "stopped", "skipped"].includes(r.status)));
  const hb = await store.count("heartbeatRuns");
  assert.equal(hb, ended.length, "each run finished (or was ended) exactly once");
  assert.equal(await store.count("runLocks"), 0, "no lock left behind");
  const sorted = [...admitMs].sort((a, b) => a - b);
  const p95 = Math.round(sorted[Math.floor(sorted.length * 0.95)]!);
  const p50 = Math.round(sorted[Math.floor(sorted.length * 0.5)]!);
  const waits = [...waitMs].sort((a, b) => a - b);
  // How long an admission waited in the store's write queue (on Postgres: for the advisory lock).
  const wait95 = Math.round(waits[Math.floor(waits.length * 0.95)] ?? 0);
  const lock = writeLockStats();
  const lostRuns = ended.filter((r) => r.status === "fail").length;
  console.log(JSON.stringify({ runs_total: ended.length, coalesced, admission_p50_ms: p50, admission_p95_ms: p95, admit_lock_wait_p95_ms: wait95, admissions: admitMs.length, writelock: lock, failed_or_lost: lostRuns, violations: violations.length }));
});
