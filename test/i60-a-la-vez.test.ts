// PLA-I60: many agents at once. Throwaway store, fake values only.
//   T1  one active run per (agent, project, work key); meaning in columns, not in summary; 16-hex run sessions.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { after, before, beforeEach, test } from "node:test";
import type { NewRow, UnitOfWork, Where } from "../src/store/types.js";
import { resetTestStore, useTestEnv, type TestStore } from "./helpers.js";

useTestEnv();
process.env.PLANIA_EVENT_WAKES = "1";
const { makeDb } = await import("../src/db/client.js");
const { seedOrg } = await import("../scripts/seed-org.js");
const queue = await import("../src/runner/queue.js");
const events = await import("../src/runner/events.js");
const sessions = await import("../src/runner/run-session.js");
const consultas = await import("../src/pedidos/consultas.js");

let store: TestStore;
let db: ReturnType<typeof makeDb>["db"];
const agentRow = async (slug: string) => (await store.get("agents", { slug }))!;
const agentId = async (slug: string) => (await agentRow(slug)).id;
const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000);

// Every run and what pointed at one (run_locks went with its run through the foreign key on Postgres).
const deleteRuns = (uow: UnitOfWork) => uow.delete("runLocks", {}).then(() => uow.delete("agentRuns", {}));
const runsWhere = (where: Where<"agentRuns"> = {}) => store.find("agentRuns", where);

before(async () => {
  store = await resetTestStore();
  ({ db } = makeDb());
  await seedOrg(db);
});

beforeEach(async () => {
  await store.fix(async (uow) => {
    await deleteRuns(uow);
    await uow.delete("consultas", {});
    await uow.update("runnerSettings", { id: 1 }, { companyPaused: false });
    await uow.update("projects", {}, { runsPaused: false });
  });
});

// ---- T1

test("I60-1 #1: two parallel inserts for one (agent, project, work key) leave one row; the other coalesces", async () => {
  const po = await agentRow("po-micasa");
  const project = { id: await store.projectId("micasa") };
  const base = { agent: po, project, role: "product-owner", taskKey: "MIC-7", trigger: "event" as const, summary: "queued: event x" };
  const outs = await Promise.all(Array.from({ length: 6 }, (_, i) => queue.insertRun(db, { ...base, reason: `reason ${i}` })));
  assert.equal(outs.filter((o) => o.kind === "queued").length, 1, JSON.stringify(outs.map((o) => o.kind)));
  assert.equal(outs.filter((o) => o.kind === "coalesced").length, 5);
  const rows = await runsWhere();
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.workKey, "task:MIC-7");
  assert.equal(rows[0]!.trigger, "event");
  assert.equal(rows[0]!.lane, "work");
  // The coalesced wakes added their reasons to the queued run, once each.
  for (let i = 0; i < 6; i++) assert.ok(rows[0]!.reason!.includes(`reason ${i}`), rows[0]!.reason!);
  // Different work keys: two more rows for the same agent.
  await queue.insertRun(db, { ...base, taskKey: "MIC-8" });
  await queue.insertRun(db, { ...base, taskKey: null });
  const keys = (await store.find("agentRuns", {}, { orderBy: [{ column: "workKey" }] })).map((r) => r.workKey);
  assert.deepEqual(keys, ["general", "task:MIC-7", "task:MIC-8"]);
});

test("I60-1 #1b: a wake for a live run is kept as absorbed; once the run ends the key is free again", async () => {
  const po = await agentRow("po-micasa");
  const project = { id: await store.projectId("micasa") };
  const base = { agent: po, project, role: "product-owner", taskKey: "MIC-9", trigger: "event" as const, summary: "s" };
  const first = await queue.insertRun(db, { ...base, reason: "first" });
  assert.equal(first.kind, "queued");
  await store.fix((uow) => uow.update("agentRuns", {}, { status: "running" }));
  const second = await queue.insertRun(db, { ...base, reason: "while you worked" });
  assert.equal(second.kind, "coalesced");
  const [row] = await runsWhere();
  assert.equal(row!.reason, "first");
  assert.equal(row!.absorbed, "while you worked");
  await store.fix((uow) => uow.update("agentRuns", {}, { status: "ok", endedAt: uow.now }));
  assert.equal((await queue.insertRun(db, { ...base, reason: "again" })).kind, "queued");
});

test("I60-1 #1c: enqueueWake for a question uses its own work key and lane", async () => {
  const po = await agentRow("po-micasa");
  const project = { id: await store.projectId("micasa"), slug: "micasa" };
  const c = (await store.fix((uow) => uow.insert("consultas", { projectId: project.id, agentId: po.id, text: "¿Hay forma de exportar a Excel?" }))).id;
  const busy = await events.enqueueWake(db, { agent: po, project, taskKey: null, reason: "general work" });
  assert.equal(busy.kind, "queued");
  const q = await events.enqueueWake(db, { agent: po, project, taskKey: null, reason: consultas.consultaReason(c), trigger: "consulta", consultaId: c });
  assert.equal(q.kind, "queued", "a question does not coalesce into the PO's other work");
  const row = (await store.get("agentRuns", { id: (q as { runId: string }).runId }))!;
  assert.deepEqual({ work_key: row.workKey, lane: row.lane, trigger: row.trigger }, { work_key: `consulta:${c}`, lane: "consulta", trigger: "consulta" });
});

// I60-1 #2 checked migration 0060's backfill SQL; the store has no migrations, so it is gone.

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
  const project = await store.projectId("micasa");
  const a = "abcdef12-0000-4000-8000-000000000001";
  const b = "abcdef12-1111-4000-8000-000000000002";
  await store.fix(async (uow) => {
    await uow.insert("agentRuns", { id: a, agentId: po.id, projectId: project, role: "product-owner", status: "ok", summary: "s", queuedAt: minutesAgo(60), workKey: "general" });
    await uow.insert("agentRuns", { id: b, agentId: taller.id, projectId: project, role: "taller", status: "ok", summary: "s", queuedAt: minutesAgo(120), workKey: "general" });
  });
  assert.equal(sessions.runSession(a), "run-abcdef1200004000");
  assert.ok(sessions.isRunSession(sessions.runSession(b)));
  assert.ok(sessions.isRunSession("run-abcdef12"), "the old 8-hex form still reads");
  assert.equal((await events.agentOfActor(db, { agent: "x", session_id: sessions.runSession(a) }))?.slug, "po-micasa");
  assert.equal((await events.agentOfActor(db, { agent: "x", session_id: sessions.runSession(b) }))?.slug, "taller-micasa");
  // answer_consulta: only the question's own run (either spelling) may answer for the PO.
  const c = (await store.fix((uow) => uow.insert("consultas", { projectId: project, agentId: po.id, text: "¿Quién puede ver el panel?", runId: a }))).id;
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

const ticketIn = async (project: string, title: string, extra: Record<string, unknown> = {}) =>
  ((await writes.createTask(db, { project, title, scope: "s", checks: ["c"], status: "Ready", ...extra } as never, ACT)) as { key: string }).key;
// A queued run of the agent (role: its template, else its role), on a ticket or a question.
const queueRun = async (agent: string, project: string, key: string | null, lane: "work" | "consulta" = "work") => {
  const a = await agentRow(agent);
  const projectId = await store.projectId(project);
  const workKey = lane === "consulta" ? `consulta:${crypto.randomUUID()}` : key ? `task:${key}` : "general";
  return (
    await store.fix((uow) =>
      uow.insert("agentRuns", { agentId: a.id, projectId, role: a.roleTemplate ?? a.role, status: "queued", summary: "queued: event x", taskKey: key, workKey, trigger: "event", lane }),
    )
  ).id;
};
const liveRun = async (agent: string, project: string, key: string) => {
  const [a, projectId] = [await agentId(agent), await store.projectId(project)];
  await store.fix((uow) =>
    uow.insert("agentRuns", { agentId: a, projectId, role: "taller", status: "running", summary: "running", taskKey: key, workKey: `task:${key}`, trigger: "event", startedAt: minutesAgo(10), workerId: "other:main" }),
  );
};
const statusOf = async (runId: string) => {
  const r = (await store.get("agentRuns", { id: runId }))!;
  return { status: r.status, held_code: r.heldCode };
};
const settingsOf = async (slug: string) => (await store.get("projects", { slug }))!.settings;
const setRunner = async (slug: string, runner: Record<string, unknown>) => {
  const settings = await settingsOf(slug);
  await store.fix((uow) => uow.update("projects", { slug }, { settings: { ...settings, runner } }));
};
const setSettings = (patch: Partial<NewRow<"runnerSettings">>) => store.fix((uow) => uow.update("runnerSettings", { id: 1 }, patch));
const reading = (pct: number, at = new Date()) =>
  store.fix(async (uow) => {
    await uow.delete("planReadings", {});
    await uow.insert("planReadings", { at, source: "stream", status: "allowed", fiveHourPct: pct, fiveHourResetsAt: new Date(Date.now() + 3 * 3_600_000) });
  });

const t2Reset = async () => {
  await runner.waitForAllRuns();
  runner.resetRunnerForTests();
  await store.fix(async (uow) => {
    await deleteRuns(uow);
    await uow.delete("runnerReservations", {});
    await uow.update("runnerSettings", { id: 1 }, { maxConcurrent: 10, cooldownMinutes: 0, maxStartsPerMinute: 100 });
    for (const p of await uow.find("projects")) {
      const { runner: _, ...settings } = p.settings;
      await uow.update("projects", { id: p.id }, { settings });
    }
  });
  await reading(10);
  for (const slug of ["micasa", "workia"]) {
    const repo = path.join(scratch, `repo-${slug}`);
    mkdirSync(repo, { recursive: true });
    const projectId = await store.projectId(slug);
    await store.fix(async (uow) => {
      const p = (await uow.get("projects", { id: projectId }))!;
      await uow.update("projects", { id: projectId }, { settings: { ...p.settings, local: { repo_path: repo } } });
      for (const title of ["Prompt: Taller", "Prompt: Research"]) {
        if (!(await uow.get("docs", { projectId, title }))) await uow.insert("docs", { projectId, title, markdown: `# ${title}`, actor: { agent: "test", session_id: "s" } });
      }
    });
  }
};
const finishAll = async (f: ReturnType<typeof fakes>) => {
  for (const c of f.spawned) c.finish();
  await runner.waitForAllRuns();
};
const allRuns = async () => JSON.stringify((await runsWhere()).map((r) => ({ status: r.status, held_code: r.heldCode, summary: r.summary })));

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
  assert.equal(r.started, 3, await allRuns());
  const states = await Promise.all(runs.map(statusOf));
  assert.deepEqual(states.map((s) => s.status).sort(), ["queued", "running", "running"]);
  assert.equal(states.find((s) => s.status === "queued")!.held_code, "agent_cap");
  assert.equal((await statusOf(po)).status, "running");
  await finishAll(f);
});

test("I60-2 #3: the ceiling minus a reservation holds everything else (ceiling)", async () => {
  await t2Reset();
  await setSettings({ maxConcurrent: 3 });
  await setRunner("micasa", { max_concurrent: 5, max_per_agent: 5 });
  await store.fix((uow) => uow.insert("runnerReservations", { label: "brief", slots: 1, holder: "other", expiresAt: new Date(Date.now() + 3_600_000) }));
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
  await store.fix((uow) => uow.update("tasks", { key: [k1, k2] }, { branch: "jl/shared-branch" }));
  const r1 = await queueRun("taller-micasa", "micasa", k1);
  const r2 = await queueRun("taller-micasa", "micasa", k2);
  const f = fakes();
  assert.equal((await runner.drainQueue(db, new Date(), f.deps as never)).started, 1);
  assert.equal((await statusOf(r1)).status, "running");
  assert.deepEqual(await statusOf(r2), { status: "queued", held_code: "lock" });
  await finishAll(f);
  assert.equal(await store.count("runLocks"), 0, "a finished run frees its keys");
  assert.equal((await runner.drainQueue(db, new Date(), f.deps as never)).started, 1);
  assert.equal((await statusOf(r2)).status, "running");
  await finishAll(f);
});

test("I60-2 #5: plan projection: at 60% with a 70% guard and 3% per Opus run, at most 3 start; the rest wait (plan)", async () => {
  await t2Reset();
  await setRunner("micasa", { max_concurrent: 10, max_per_agent: 10 });
  await setSettings({ defaultModel: "opus", defaultEffort: "medium", estPctPerRun: 3 });
  await reading(60, minutesAgo(1));
  const ids = [];
  for (const t of ["A", "B", "C", "D", "E"]) ids.push(await queueRun("taller-micasa", "micasa", await ticketIn("micasa", `Plan ${t}`)));
  const f = fakes();
  const r = await runner.drainQueue(db, new Date(), f.deps as never);
  assert.equal(r.started, 3);
  assert.equal((await Promise.all(ids.map(statusOf))).filter((s) => s.held_code === "plan").length, 2);
  await setSettings({ defaultModel: null, defaultEffort: null });
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
  const deps = { ...f.deps, git, spawn: undefined, detached: true, pollMs: 50, env: { ...f.deps.env, CLAUDE_CODE_BIN: FAKE, FAKE_MS: String(ms), PATH: process.env.PATH } };
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
  await store.fix((uow) => uow.update("agents", { slug: "taller-micasa" }, { maxParallel: 1 }));
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
    assert.equal((await store.get("agentRuns", { id: runId }))!.status, "ok");
    assert.equal(await store.count("heartbeatRuns", { taskKey: key }), 1, "finished exactly once though two followers saw it end");
    assert.equal(await store.count("runLocks", { runId }), 0);
  } finally {
    await store.fix((uow) => uow.update("agents", { slug: "taller-micasa" }, { maxParallel: null }));
  }
});

test("I60-3 #3: a worker whose lease ran out has its runs ended (worker lost) and their keys freed", async () => {
  await t2Reset();
  const k = await ticketIn("micasa", "Trabajador perdido");
  const [a, projectId] = [await agentId("taller-micasa"), await store.projectId("micasa")];
  const rid = (
    await store.fix(async (uow) => {
      const run = await uow.insert("agentRuns", {
        agentId: a, projectId, role: "taller", status: "running", summary: "running", taskKey: k, workKey: `task:${k}`, trigger: "event", startedAt: minutesAgo(20), workerId: "gone:main", leaseUntil: minutesAgo(5),
      });
      await uow.insert("runLocks", { lockKey: `task:x:${k}`, runId: run.id });
      return run;
    })
  ).id;
  await runner.drainQueue(db, new Date(), fakes().deps as never);
  const row = (await store.get("agentRuns", { id: rid }))!;
  assert.deepEqual({ status: row.status, summary: row.summary }, { status: "fail", summary: "fail: worker lost" });
  assert.equal(await store.count("runLocks"), 0);
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
  const micasa = { id: await store.projectId("micasa"), slug: "micasa" };
  const w = await events.enqueueWake(db, { agent: taller, project: micasa, taskKey: key, reason: "ci red" });
  assert.equal(w.kind, "none");
  await store.fix((uow) => uow.update("agentRuns", { id: rid }, { stopRequested: "detenido desde el teléfono" }));
  assert.equal(await runner.actOnStopRequests(db), 1);
  assert.deepEqual(killed.slice(0, 1), ["SIGINT"]);
  f.spawned[0]!.finish();
  await runner.waitForAllRuns();
  // Stopped runs do not retry what they absorbed; an ok one does.
  const rid2 = await queueRun("taller-micasa", "micasa", await ticketIn("micasa", "Otro"));
  await runner.drainQueue(db, new Date(), f.deps as never);
  const k2 = (await store.get("agentRuns", { id: rid2 }))!.taskKey!;
  await events.enqueueWake(db, { agent: taller, project: micasa, taskKey: k2, reason: "review" });
  f.spawned[1]!.finish();
  await runner.waitForAllRuns();
  const retry = await runsWhere({ workKey: `task:${k2}`, status: "queued" });
  assert.equal(retry.length, 1);
  assert.equal(retry[0]!.trigger, "retry");
  assert.match(retry[0]!.reason!, /review/);
});

// ---- T4: the idea pipeline

const { sweepStalledIdeas } = await import("../src/runner/stalled.js");

const ideaIn = async (title: string, stage: string) => {
  const key = ((await writes.createTask(db, { project: "micasa", kind: "idea", title, scope: "s" } as never, ACT)) as { key: string }).key;
  if (stage !== "idea") await store.fix((uow) => uow.update("tasks", { key }, { stage }));
  return key;
};
const runsOn = async (key: string) => {
  const slugs = new Map((await store.find("agents")).map((a) => [a.id, a.slug]));
  return (await store.find("agentRuns", { taskKey: key }, { orderBy: [{ column: "queuedAt" }] }))
    .filter((r) => slugs.has(r.agentId))
    .map((r) => ({ slug: slugs.get(r.agentId)!, status: r.status, trigger: r.trigger }));
};

test("I60-4 #1: an idea moved to planning wakes the PO on it (before, nothing did)", async () => {
  await t2Reset();
  await store.fix((uow) => uow.update("projects", { slug: "micasa" }, { runsPaused: false }));
  const key = await ideaIn("Usar shadcn en toda la app", "design");
  await store.fix(deleteRuns);
  const v = (await store.get("tasks", { key }))!.version;
  // The stage move as an agent makes it (no doc requirement is checked for an event's target).
  await writes.setTask(db, { project: "micasa", key, stage: "planning", version: v } as never, ACT).catch(async () => {
    // Without the Design doc the move is refused; write the event the hook reads instead.
    const t = (await store.fix(async (uow) => (await uow.update("tasks", { key }, { stage: "planning" }))[0]))!;
    const { onWriteEvent } = await import("../src/runner/events.js");
    await onWriteEvent(db, { id: await store.projectId("micasa"), slug: "micasa" }, "task.updated", { id: t.id, key }, { changes: { stage: ["design", "planning"] } }, { PLANIA_EVENT_WAKES: "1" } as never);
  });
  const runs = await runsOn(key);
  assert.equal(runs.length, 1, JSON.stringify(runs));
  assert.equal(runs[0]!.slug, "po-micasa");
  assert.equal(runs[0]!.status, "queued");
});

test("I60-4 #2: an idea left in a stage with no run of its owner gets one retry; a second sweep queues nothing", async () => {
  await t2Reset();
  await store.fix((uow) => uow.update("projects", { slug: "micasa" }, { runsPaused: false }));
  const key = await ideaIn("Panel de usuarios", "planning");
  await store.fix(deleteRuns);
  // Only the Artist ran on it (before it reached planning).
  const [artist, projectId] = [await agentId("artist-micasa"), await store.projectId("micasa")];
  const t = (await store.get("tasks", { key }))!;
  const twoDaysAgo = minutesAgo(2 * 24 * 60);
  await store.fix(async (uow) => {
    await uow.insert("agentRuns", { agentId: artist, projectId, role: "artist", status: "ok", summary: "ok", taskKey: key, workKey: `task:${key}`, trigger: "event", queuedAt: twoDaysAgo, endedAt: twoDaysAgo });
    await uow.insert("events", { projectId, taskId: t.id, taskKey: key, type: "task.updated", actor: { agent: "artist-micasa", session_id: "s" }, payload: { changes: { stage: ["design", "planning"] } } });
  });
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
  await setSettings({ cooldownMinutes: 30 });
  await setRunner("micasa", { max_concurrent: 5, max_per_agent: 5 });
  const micasa = await store.projectId("micasa");
  await store.fix(async (uow) => {
    if (!(await uow.get("goals", { projectId: micasa }))) await uow.insert("goals", { projectId: micasa, title: "Meta" });
  });
  const po = await agentId("po-micasa");
  // The PO just answered a question.
  await store.fix((uow) =>
    uow.insert("agentRuns", {
      agentId: po, projectId: micasa, role: "product-owner", status: "ok", summary: "ok", workKey: "consulta:00000000-0000-4000-8000-000000000001", trigger: "consulta", lane: "consulta", startedAt: minutesAgo(3), endedAt: minutesAgo(1),
    }),
  );
  // A Ready ticket owned by the PO: the event hook queues the PO's run on it.
  const owned = await ticketIn("micasa", "Pedido del dueño", { owner_agent: "po-micasa" });
  const ev = (await store.get("agentRuns", { workKey: `task:${owned}`, status: "queued" }))?.id ?? (await queueRun("po-micasa", "micasa", owned));
  await store.fix(async (uow) => {
    if (!(await uow.get("docs", { projectId: micasa, title: "Prompt: Product owner" }))) {
      await uow.insert("docs", { projectId: micasa, title: "Prompt: Product owner", markdown: "# PO", actor: { agent: "t", session_id: "s" } });
    }
  });
  const f = fakes();
  await runner.drainQueue(db, new Date(), f.deps as never);
  assert.equal((await statusOf(ev)).status, "running", "the question did not start a rest");
  await finishAll(f);
  // A cadence run of the PO after a cadence run that just ended waits its rest.
  const cad = (
    await store.fix(async (uow) => {
      await uow.insert("agentRuns", { agentId: po, projectId: micasa, role: "product-owner", status: "ok", summary: "ok", workKey: "task:OLD", trigger: "cadence", startedAt: minutesAgo(3), endedAt: minutesAgo(1) });
      return uow.insert("agentRuns", { agentId: po, projectId: micasa, role: "product-owner", status: "queued", summary: "queued", workKey: "general", trigger: "cadence" });
    })
  ).id;
  await runner.drainQueue(db, new Date(), f.deps as never);
  assert.deepEqual(await statusOf(cad), { status: "queued", held_code: "rest" });
  await setSettings({ cooldownMinutes: 0 });
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
