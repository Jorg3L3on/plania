// PLA-I31-1: events wake the right role through the runner's queue; the cadence stays as fallback.
// Fake children, fake git, fake GitHub; throwaway DB (test/helpers.ts). No real claude.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { after, before, beforeEach, test } from "node:test";
import { resetTestStore, useTestEnv, type TestStore } from "./helpers.js";
import { ne, type NewRow } from "../src/store/types.js";

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
let store: TestStore;
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
  return table === "agents" ? (await store.get("agents", { slug }))!.id : store.projectId(slug);
}

const minutesAgo = (n: number): Date => new Date(Date.now() - n * 60_000);
const inMinutes = (n: number): Date => new Date(Date.now() + n * 60_000);

// The runner's one settings row. The migration seeds it on Postgres; a fresh devva store has none until first read.
const runnerSettings = (patch: Partial<NewRow<"runnerSettings">>) =>
  store.fix(async (uow) => ((await uow.get("runnerSettings", { id: 1 })) ? uow.update("runnerSettings", { id: 1 }, patch) : uow.insert("runnerSettings", { id: 1, ...patch })));

const setRunsPaused = (slug: string, runsPaused: boolean) => store.fix((uow) => uow.update("projects", { slug }, { runsPaused }));

// Queued or running runner rows, per agent slug.
async function wakes(): Promise<{ agent: string; task_key: string | null; status: string; summary: string }[]> {
  const slugs = new Map((await store.find("agents")).map((a) => [a.id, a.slug]));
  return (await store.find("agentRuns", { status: ["queued", "running"] }))
    .filter((r) => slugs.has(r.agentId))
    .map((r) => ({ at: r.queuedAt.getTime(), agent: slugs.get(r.agentId)!, task_key: r.taskKey, status: r.status, summary: r.summary }))
    .sort((a, b) => a.at - b.at || (a.agent < b.agent ? -1 : a.agent > b.agent ? 1 : 0))
    .map(({ at: _, ...w }) => w);
}

async function backlog(key: string, extra: Record<string, unknown> = {}): Promise<void> {
  await writes.createTask(db, { project: "micasa", key, title: `Ticket ${key}`, scope: "Scope", checks: ["Done"], ...extra } as never, ctx);
}
const toReady = async (key: string) => {
  const { version } = (await store.get("tasks", { key }))!;
  return writes.setTask(db, { project: "micasa", key, status: "Ready", version } as never, ctx);
};

before(async () => {
  store = await resetTestStore();
  ({ db, close: closeDb } = makeDb());
  await seedOrg(db);
  mkdirSync(repo, { recursive: true });
  const micasa = await id("projects", "micasa");
  await store.fix(async (uow) => {
    await uow.update("agents", {}, { heartbeatMinutes: null, adapter: "none", adapterConfig: {} });
    await uow.update("agents", { slug: ["housi", "taller", "research", "artist", "asistente"] }, { adapter: "claude_code" });
    await uow.update("projects", { slug: "micasa" }, { settings: { local: { repo_path: repo }, github: { repo: "acme/micasa" } } });
    const actor = { agent: "test", session_id: "s" };
    for (const title of ["Prompt: Product owner", "Prompt: Taller", "Prompt: Research", "Prompt: Artist", "Prompt: Asistente"]) {
      await uow.insert("docs", { projectId: micasa, title, markdown: `# ${title}`, actor });
    }
    await uow.insert("goals", { projectId: micasa, title: "Ship the MiCasa beta" });
  });
});

beforeEach(async () => {
  await runner.waitForAllRuns();
  runner.resetRunnerForTests();
  await store.fix(async (uow) => {
    await uow.delete("agentRuns", {});
    await uow.delete("heartbeatRuns", {});
  });
  await runnerSettings({ companyPaused: false, maxConcurrent: 1, cooldownMinutes: 0, planGuardPct: 70, reserveTokens: 1000 });
  await store.fix(async (uow) => {
    await uow.update("projects", { slug: "micasa" }, { runsPaused: false });
    await uow.update("projects", { slug: ne("micasa") }, { runsPaused: true });
    await uow.delete("planReadings", {});
    const now = new Date();
    await uow.insert("planReadings", { at: now, source: "stream", status: "allowed", fiveHourPct: 10, sevenDayPct: 19, fiveHourResetsAt: new Date(now.getTime() + 3 * 3_600_000) });
  });
});

after(async () => {
  await runner.waitForAllRuns();
  await closeDb?.();
  await store?.end();
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
  const logged = await store.find("events", { type: "wake.queued", taskKey: "EV-READY" });
  assert.equal(logged.length, 1);
  assert.equal(logged[0]!.payload.agent, "taller");
  // A [PRUEBA] ticket and a ticket owned by another agent wake nobody.
  await store.fix((uow) => uow.delete("agentRuns", {}));
  await backlog("EV-PRUEBA", { title: "[PRUEBA] nada" });
  await toReady("EV-PRUEBA");
  await backlog("EV-OWNED", { owner_agent: "research" });
  await toReady("EV-OWNED");
  assert.deepEqual(await wakes(), []);
});

test("I31-1 #1b: a question answered wakes whoever asked it (a runner session, or a roster slug)", async () => {
  await backlog("EV-ASK");
  // housi (PO) asked from a runner session run-<8 hex of its run id>.
  const [agentId, projectId] = [await id("agents", "housi"), await id("projects", "micasa")];
  const twoHoursAgo = minutesAgo(120);
  const run = await store.fix((uow) =>
    uow.insert("agentRuns", { agentId, projectId, role: "product-owner", status: "ok", startedAt: twoHoursAgo, endedAt: twoHoursAgo, queuedAt: twoHoursAgo }),
  );
  const asked = (await questions.ask(db, { project: "micasa", key: "EV-ASK", question: "¿A o B?" }, { actor: { agent: "Claude Code", session_id: `run-${String(run.id).slice(0, 8)}` } })) as { question_id: string };
  // PLA-I32-5: a PO's question goes to Asistente first.
  assert.deepEqual((await wakes()).map((x) => [x.agent, x.task_key, x.summary]), [["asistente", "EV-ASK", "queued: event question from housi"]]);
  await store.fix((uow) => uow.delete("agentRuns", { status: "queued" }));
  await questions.answer(db, { project: "micasa", question_id: asked.question_id, answer: "A" }, webCtx);
  let w = await wakes();
  assert.equal(w.length, 1);
  assert.deepEqual({ agent: w[0]!.agent, task: w[0]!.task_key }, { agent: "housi", task: "EV-ASK" });
  assert.match(w[0]!.summary, /question answered/);

  // An asker named by its roster slug.
  await store.fix((uow) => uow.delete("agentRuns", {}));
  await backlog("EV-ASK2");
  const q2 = (await questions.ask(db, { project: "micasa", key: "EV-ASK2", question: "¿Fuente?" }, { actor: { agent: "research", session_id: "r1" } })) as { question_id: string };
  await questions.answer(db, { project: "micasa", question_id: q2.question_id, answer: "La primera" }, webCtx);
  w = await wakes();
  assert.equal(w.length, 1);
  assert.equal(w[0]!.agent, "research");

  // An asker that is not on the roster wakes nobody.
  await store.fix((uow) => uow.delete("agentRuns", {}));
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
  await store.fix((uow) => uow.update("tasks", { key }, { status: "In review", prUrl: `https://github.com/acme/micasa/pull/${number}` }));
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
  const project = (await store.get("projects", { slug: "micasa" }))!;
  const s = await pollGithubProject(db, project as never, { fetch: fetch as never, env: { GITHUB_TOKEN: "ghp_test" } });
  assert.equal(s.reviews, 1);
  const w = await wakes();
  assert.equal(w.length, 1);
  assert.deepEqual({ agent: w[0]!.agent, task: w[0]!.task_key }, { agent: "taller", task: "EV-REV" });
  assert.match(w[0]!.summary, /pr review/);
  assert.equal(await store.count("events", { type: "pr.reviewed", taskKey: "EV-REV" }), 1);
});

test("I31-1 #1c: CI red wakes Taller once, even though the ticket also moves back to Ready", async () => {
  await inReview("EV-CI", 12);
  const fetch = fakeFetch({
    "/repos/acme/micasa/pulls?": [pr(12, "EV-CI", "b".repeat(40))],
    "/repos/acme/micasa/commits/": { check_runs: [{ name: "test", status: "completed", conclusion: "failure", html_url: "https://ci/1", head_sha: "b".repeat(40) }] },
  });
  const p = (await store.get("projects", { slug: "micasa" }))!;
  await pollGithubProject(db, p as never, { fetch: fetch as never, env: { GITHUB_TOKEN: "ghp_test" } });
  assert.equal((await store.get("tasks", { key: "EV-CI" }))!.status, "Ready");
  const w = await wakes();
  assert.equal(w.length, 1);
  assert.deepEqual({ agent: w[0]!.agent, task: w[0]!.task_key }, { agent: "taller", task: "EV-CI" });
  assert.match(w[0]!.summary, /ci red/);
});

test("I31-1 #1d: an idea moving to research wakes Research; to design wakes Artist", async () => {
  const made = (await writes.createTask(db, { project: "micasa", kind: "idea", title: "Una idea" } as never, ctx)) as { key: string };
  const key = made.key;
  await attachDoc(db, { project: "micasa", key, title: "Idea", markdown: "# Idea\n## Problem\nx\n## Who it is for\ny\n## Why now\nz" }, ctx);
  let t = (await store.get("tasks", { key }))!;
  await writes.setTask(db, { project: "micasa", key, stage: "research", version: t.version } as never, ctx);
  let w = await wakes();
  assert.equal(w.length, 1);
  assert.deepEqual({ agent: w[0]!.agent, task: w[0]!.task_key }, { agent: "research", task: key });
  assert.match(w[0]!.summary, /idea stage research/);

  await store.fix((uow) => uow.delete("agentRuns", {}));
  await attachDoc(db, { project: "micasa", key, title: "Research", markdown: "# R\n## What we learned\nx\n## Options\ny\n## Recommendation\nz" }, ctx);
  t = (await store.get("tasks", { key }))!;
  await writes.setTask(db, { project: "micasa", key, stage: "design", version: t.version } as never, ctx);
  w = await wakes();
  assert.equal(w.length, 1);
  assert.deepEqual({ agent: w[0]!.agent, task: w[0]!.task_key }, { agent: "artist", task: key });
});

test("I31-1 #2 (PLA-I60): 3 events on 3 tickets queue 3 runs; events do not wait for the rest; the seat's cap starts one at a time", async () => {
  await runnerSettings({ cooldownMinutes: 30 });
  // Taller's last run ended a minute ago. Before PLA-I60 that rest held event wakes; now it paces only cadence runs.
  const [agentId, projectId] = [await id("agents", "taller"), await id("projects", "micasa")];
  await store.fix((uow) =>
    uow.insert("agentRuns", { agentId, projectId, role: "taller", status: "ok", startedAt: minutesAgo(5), endedAt: minutesAgo(1), queuedAt: minutesAgo(5), summary: "ok: seed", trigger: "cadence" }),
  );
  for (const key of ["EV-C1", "EV-C2", "EV-C3"]) {
    await backlog(key);
    await toReady(key);
  }
  let w = await wakes();
  assert.deepEqual(w.map((x) => x.task_key).sort(), ["EV-C1", "EV-C2", "EV-C3"], "one queued run per ticket");
  // A second event on a ticket that already has a queued run coalesces into it.
  await store.fix((uow) => uow.update("tasks", { key: "EV-C1" }, { status: "Backlog" }));
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
  const runs = await store.count("agentRuns", { agentId: await id("agents", "taller"), status: "ok", summary: ne("ok: seed") });
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
  const row = (await store.get("tasks", { key: "EV-K2" }))!;
  const t = { id: row.id, key: row.key };
  await setRunsPaused("micasa", false);
  const pid = await id("projects", "micasa");
  const out = await store.fix((uow) => events.onWriteEvent(uow.sql, { id: pid, slug: "micasa" }, "task.status", t, { from: "Backlog", to: "Ready" }, {}));
  assert.equal(out, null);
  assert.equal(events.eventWakesEnabled({}), false);
  assert.equal(events.eventWakesEnabled({ PLANIA_JOBS: "1" }), true);
  assert.deepEqual(await wakes(), []);
});

test("I31-1: resuming a project queues its PO's first wake; an answer on a ticket is its own work item (PLA-I60)", async () => {
  await setRunsPaused("micasa", true);
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
  const { version } = (await store.get("tasks", { key }))!;
  return writes.setTask(db, { project: "micasa", key, status, version } as never, webCtx);
};
// In review with its PR, then Merged the way the screen moves it (no scan pass: PLA-20).
async function land(key: string): Promise<void> {
  const number = ++prNumber;
  const head = number.toString(16).padStart(40, "0");
  const url = `https://github.com/acme/micasa/pull/${number}`;
  const projectId = await id("projects", "micasa");
  await store.fix(async (uow) => {
    const [t] = await uow.update("tasks", { key }, { status: "In review", prUrl: url });
    await uow.insert("pullRequests", {
      projectId, repo: "acme/micasa", number, url, title: key, taskId: t!.id, state: "open", headSha: head, headBranch: `jl/${key.toLowerCase()}`, baseBranch: "sandbox",
    });
  });
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
  const logged = await store.find("events", { type: "wake.queued", taskKey: "LD-A1" });
  assert.equal(logged.length, 1);
  assert.deepEqual(
    { agent: logged[0]!.payload.agent, reason: logged[0]!.payload.reason, from: logged[0]!.payload.from_event },
    { agent: "taller", reason: "unblocked by LD-A1", from: "task.status" },
  );

  // #3: Merged → Released → Done is the same landing: no second wake.
  await store.fix((uow) => uow.delete("agentRuns", {}));
  await move("LD-A1", "Released");
  await move("LD-A1", "Done");
  assert.equal((await store.get("tasks", { key: "LD-A1" }))!.status, "Done");
  assert.deepEqual(await wakes(), []);
});

test("PLA-15 #2: a landing queues nothing when the next ticket is not Taller's to start yet", async () => {
  // Another ticket it waits on is only In review (its code is not in the branch): held until that one lands too.
  await backlog("LD-B1");
  await backlog("LD-B2");
  await step("LD-B3", ["LD-B1", "LD-B2"]);
  await store.fix((uow) => uow.update("tasks", { key: "LD-B2" }, { status: "In review" }));
  await land("LD-B1");
  assert.deepEqual(await wakes(), [], "LD-B2 has not landed");
  await land("LD-B2");
  assert.deepEqual((await wakes()).map((x) => [x.agent, x.task_key, x.summary]), [["taller", "LD-B3", "queued: event unblocked by LD-B2"]]);
  await store.fix((uow) => uow.delete("agentRuns", {}));

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
  await setRunsPaused("micasa", false);
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

  await store.fix((uow) => uow.delete("agentRuns", {}));
  await backlog("LD-H1");
  await step("LD-H2", ["LD-H1"], { priority: "P1" });
  await step("LD-H3", ["LD-H1"], { priority: "P3" });
  await store.fix(async (uow) => {
    const p = (await uow.get("projects", { slug: "micasa" }))!;
    await uow.update("projects", { slug: "micasa" }, { settings: { ...p.settings, next_first: "LD-H3" } });
  });
  await land("LD-H1");
  assert.deepEqual((await wakes()).map((x) => x.task_key), ["LD-H3"]);
  await store.fix(async (uow) => {
    const { next_first: _, ...settings } = (await uow.get("projects", { slug: "micasa" }))!.settings;
    await uow.update("projects", { slug: "micasa" }, { settings });
  });

  // PLA-I60: Taller already has a run queued (LD-H3); the next landing frees another ticket, a work item of its
  // own, so it gets its own queued run (the seat's cap decides when it starts).
  await backlog("LD-I1");
  await step("LD-I2", ["LD-I1"]);
  await land("LD-I1");
  assert.deepEqual((await wakes()).map((x) => x.task_key), ["LD-H3", "LD-I2"]);
});

// ---- PLA-16: a run that failed holding its ticket is retried once; a second failure in a row goes to Jorge.

const { sweepFailedRuns, failureWords } = await import("../src/runner/failed.js");
const { resolveHumanAction } = await import("../src/mcp/blockers.js");
const { writeTx, WEB_ACTOR } = await import("../src/mcp/tx.js");
const MAX_TURNS = "fail: error_max_turns (41 turns, session 491bc14d)";

// The ticket In progress, leased to the runner session of that run (run-<first 8 of its id>).
async function leaseTo(key: string, runId: string, lease = inMinutes(110)): Promise<void> {
  const owner = { agent: "plania-runner", session_id: `run-${runId.slice(0, 8)}`, machine: "test" };
  await store.fix((uow) => uow.update("tasks", { key }, { status: "In progress", owner, claimedAt: minutesAgo(9), leaseUntil: lease }));
}
// A Taller run on the ticket that ended (fail by default) and still holds its lease.
async function endedRunHolding(key: string, status = "fail", summary = MAX_TURNS): Promise<string> {
  const [agentId, projectId] = [await id("agents", "taller"), await id("projects", "micasa")];
  const run = (
    await store.fix((uow) =>
      uow.insert("agentRuns", { agentId, projectId, taskKey: key, role: "taller", status, summary, queuedAt: minutesAgo(10), startedAt: minutesAgo(10), endedAt: minutesAgo(1) }),
    )
  ).id;
  await leaseTo(key, run);
  return run;
}
type Json = Record<string, any>;
const ticket = async (key: string): Promise<Json> => {
  const t = (await store.get("tasks", { key }))!;
  return { id: t.id, status: t.status, owner: t.owner, lease_until: t.leaseUntil, blocked_note: t.blockedNote };
};
const eventsOf = async (key: string, type: string): Promise<any[]> => (await store.find("events", { taskKey: key, type }, { orderBy: [{ column: "id" }] })).map((r) => r.payload);
// The queued run marked failed now, the way the runner ends it; its id.
const failQueued = async (summary: string): Promise<string> => {
  const now = new Date();
  return (await store.fix((uow) => uow.update("agentRuns", { status: "queued" }, { status: "fail", summary, startedAt: now, endedAt: now })))[0]!.id;
};

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
  const retryRun = await failQueued(MAX_TURNS);
  await leaseTo("FR-A1", retryRun);
  assert.deepEqual(await sweepFailedRuns(db), { retried: 0, held: 1 });
  t = await ticket("FR-A1");
  assert.deepEqual([t.status, t.owner, t.lease_until], ["Blocked", null, null]);
  assert.match(t.blocked_note, /^Jorge: Taller falló dos veces seguidas en este paso \(error_max_turns \(41 turns\)\)/);
  assert.deepEqual(await wakes(), []);
  assert.equal((await eventsOf("FR-A1", "claim.released"))[1].reason, "run failed twice");
  const steps = (await store.find("blockers", { taskId: t.id, type: "human_action" })).map((b) => ({ id: b.id, spec: b.spec, satisfied_at: b.satisfiedAt }));
  assert.equal(steps.length, 1, "one step in Jorge's inbox");
  assert.equal(steps[0]!.satisfied_at, null);
  assert.deepEqual(await sweepFailedRuns(db), { retried: 0, held: 0 });

  // Jorge marks it done: Ready again, and the move wakes Taller. A third failure is the first of a new pair.
  const p = { id: await id("projects", "micasa"), slug: "micasa" };
  await writeTx(db, p, webCtx, (tx, emit) => resolveHumanAction(tx, emit, p.id, steps[0]!.id, WEB_ACTOR));
  assert.equal((await ticket("FR-A1")).status, "Ready");
  w = await wakes();
  assert.deepEqual(w.map((x) => [x.agent, x.task_key, x.summary]), [["taller", "FR-A1", "queued: event ticket ready"]]);
  const third = await failQueued(MAX_TURNS);
  await leaseTo("FR-A1", third);
  assert.deepEqual(await sweepFailedRuns(db), { retried: 1, held: 0 });
});

test("PLA-16: the retry waits for a closed switch, not for a busy agent (PLA-I60); a stopped run, a run that ended ok and a person's lease are left alone", async () => {
  // PLA-I60: Taller busy on another ticket no longer holds the retry: FR-B1 is a work item of its own.
  await backlog("FR-B0");
  await endedRunHolding("FR-B0");
  const [agentId, projectId] = [await id("agents", "taller"), await id("projects", "micasa")];
  await store.fix((uow) => uow.insert("agentRuns", { agentId, projectId, taskKey: "FR-OTHER", role: "taller", status: "queued", summary: "queued: event ticket ready", workKey: "task:FR-OTHER" }));
  assert.deepEqual(await sweepFailedRuns(db), { retried: 1, held: 0 });
  await store.fix((uow) => uow.delete("agentRuns", {}));
  await backlog("FR-B1");
  await endedRunHolding("FR-B1");

  // A paused project, then a paused company.
  await setRunsPaused("micasa", true);
  assert.deepEqual(await sweepFailedRuns(db), { retried: 0, held: 0 });
  await setRunsPaused("micasa", false);
  await runnerSettings({ companyPaused: true });
  assert.deepEqual(await sweepFailedRuns(db), { retried: 0, held: 0 });
  assert.equal((await ticket("FR-B1")).status, "In progress");
  await runnerSettings({ companyPaused: false });
  assert.deepEqual(await sweepFailedRuns(db), { retried: 1, held: 0 });
  assert.deepEqual((await wakes()).map((x) => x.task_key), ["FR-B1"]);
  await store.fix((uow) => uow.delete("agentRuns", {}));

  // Not failures, and not runner leases.
  await backlog("FR-C1");
  await endedRunHolding("FR-C1", "stopped", "stopped: project micasa paused (no result)");
  await backlog("FR-C2");
  await endedRunHolding("FR-C2", "ok", "ok: success, 12 turns, session 0a1b2c3d");
  await backlog("FR-C3");
  await store.fix((uow) => uow.update("tasks", { key: "FR-C3" }, { status: "In progress", owner: { agent: "Claude Code", session_id: "cc-a-person" }, leaseUntil: inMinutes(20) }));
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
  // (PLA-I60-4: the same tick may also queue a retry for an idea an earlier test left in a stage with no run.)
  const running = (await wakes()).filter((x) => x.agent === "taller");
  assert.deepEqual(running.map((x) => [x.agent, x.task_key, x.status]), [["taller", "FR-D1", "running"]]);
  f.spawned[0]!.finish();
  await runner.waitForAllRuns();
});

test("PLA-16 #3: a runner run's lease that runs out wakes Taller on the ticket; a person's expired lease wakes nobody", async () => {
  await backlog("FR-E1");
  const run = await endedRunHolding("FR-E1", "ok", "ok: success, 12 turns, session 0a1b2c3d");
  await leaseTo("FR-E1", run, minutesAgo(1));
  await backlog("FR-E2");
  await store.fix((uow) => uow.update("tasks", { key: "FR-E2" }, { status: "In progress", owner: { agent: "Claude Code", session_id: "cc-a-person" }, leaseUntil: minutesAgo(1) }));
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
  const [agentId, projectId] = [await id("agents", "taller"), await id("projects", "micasa")];
  const run = (
    await store.fix((uow) =>
      uow.insert("agentRuns", {
        agentId, projectId, taskKey: key, role: "taller", status: "stopped", summary: `stopped: ${reason} (error_during_execution, 5 turns, session 491bc14d)`, stopReason: reason, tokensTotal: tokens,
        queuedAt: minutesAgo(10), startedAt: minutesAgo(10), endedAt: minutesAgo(1),
      }),
    )
  ).id;
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

test("PLA-18: a switch stop frees the ticket and the work is queued again on resume; Jorge's Detener is not", async () => {
  await backlog("BS-C1");
  await stoppedRunHolding("BS-C1", "project micasa paused");
  await setRunsPaused("micasa", true);
  assert.deepEqual(await sweepStoppedRuns(db), { freed: 1 });
  assert.match((await eventsOf("BS-C1", "note"))[0].text, /se pusieron en pausa\. Plania liberó el ticket; se retoma al reanudar\./);
  assert.deepEqual(await requeueHeld(db), { requeued: 0 });
  await setRunsPaused("micasa", false);
  assert.deepEqual(await requeueHeld(db), { requeued: 1 });
  assert.deepEqual((await wakes()).map((x) => [x.agent, x.task_key, x.summary]), [["taller", "BS-C1", "queued: event runs resumed"]]);
  await store.fix((uow) => uow.delete("agentRuns", {}));

  // Detener: the screen already released it; nothing queues it again (Seguir is Jorge's).
  await backlog("BS-D1");
  await stoppedRunHolding("BS-D1", "detenido desde Compañía");
  await store.fix((uow) => uow.update("tasks", { key: "BS-D1" }, { status: "Ready", owner: null, leaseUntil: null }));
  assert.deepEqual(await requeueHeld(db), { requeued: 0 });
  assert.deepEqual(await wakes(), []);
});

// A PO wake on an idea that a server restart dropped while it waited in the queue.
async function droppedIdeaWake(key: string, agent = "housi"): Promise<void> {
  const [agentId, projectId] = [await id("agents", agent), await id("projects", "micasa")];
  await store.fix((uow) =>
    uow.insert("agentRuns", { agentId, projectId, taskKey: key, role: "product-owner", status: "skipped", summary: "skipped: server restarted", queuedAt: minutesAgo(10), endedAt: minutesAgo(1) }),
  );
}

test("PLA-48: an open idea whose wake a restart dropped is queued again once, for the same agent", async () => {
  const { key } = (await writes.createTask(db, { project: "micasa", kind: "idea", title: "Darle forma" } as never, ctx)) as { key: string };
  await store.fix((uow) => uow.delete("agentRuns", {}));
  await droppedIdeaWake(key);

  assert.deepEqual(await requeueHeld(db), { requeued: 1 });
  assert.deepEqual((await wakes()).map((x) => [x.agent, x.task_key, x.summary]), [["housi", key, "queued: event server restarted"]]);
  assert.equal((await eventsOf(key, "wake.queued"))[0].from_event, "run.held");
  assert.deepEqual(await requeueHeld(db), { requeued: 0 }, "the queued run is now the newest");
});

test("PLA-48: a promoted or closed idea is not queued again", async () => {
  const { key: promoted } = (await writes.createTask(db, { project: "micasa", kind: "idea", title: "Ya promovida" } as never, ctx)) as { key: string };
  const { key: closed } = (await writes.createTask(db, { project: "micasa", kind: "idea", title: "Cerrada" } as never, ctx)) as { key: string };
  await store.fix(async (uow) => {
    await uow.update("tasks", { key: promoted }, { promotedTo: "MC-I9" });
    await uow.update("tasks", { key: closed }, { status: "Done" });
    await uow.delete("agentRuns", {});
  });
  await droppedIdeaWake(promoted);
  await droppedIdeaWake(closed);

  assert.deepEqual(await requeueHeld(db), { requeued: 0 });
  assert.deepEqual(await wakes(), []);
});

test("PLA-21: a heavy week no longer drops a queued wake", async () => {
  const [agentId, projectId] = [await id("agents", "taller"), await id("projects", "micasa")];
  const twoHoursAgo = minutesAgo(120);
  await store.fix((uow) =>
    uow.insert("agentRuns", {
      agentId, projectId, taskKey: "BS-OTHER", role: "taller", status: "ok", summary: "ok: seed", tokensTotal: 900_000_000, queuedAt: twoHoursAgo, startedAt: twoHoursAgo, endedAt: twoHoursAgo,
    }),
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
