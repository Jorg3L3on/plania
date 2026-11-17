// PLA-I49-5: the brief's wake actions (Give to PO, Start now, Start building) through POST /api/brief/act with the
// session cookie: who wakes and about how long before (GET state), and the run's state on the row after. Throwaway
// test store; every process is a fake child; nothing reaches a real claude or repo.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { after, before, beforeEach, test } from "node:test";
import { resetTestStore, useTestEnv, type TestStore } from "./helpers.js";

useTestEnv();
process.env.PLANIA_EVENT_WAKES = "1";
process.env.PLANIA_TZ = "America/Mexico_City";
process.env.PLANIA_HOME_PROJECT = "workia";
process.env.PLANIA_PROMPTS_PROJECT = "micasa";
const { app } = await import("../src/app.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const { makeDb } = await import("../src/db/client.js");
const { seedOrg } = await import("../scripts/seed-org.js");
const { createTask } = await import("../src/mcp/writes.js");
const { saveBriefSettings } = await import("../src/brief/settings.js");
const { wakeDeps } = await import("../src/brief/actions.js");
const { setProjectPaused } = await import("../src/runner/company.js");
const { resetRunnerForTests } = await import("../src/runner/runner.js");

type Json = Record<string, any>;
let store: TestStore;
let db: ReturnType<typeof makeDb>["db"];
const scratch = mkdtempSync(path.join(tmpdir(), "plania-brief-wake-"));
const ctx = { actor: { agent: "po-workia", session_id: "s-po", machine: "ci" } };
const cookie = () => ({ Cookie: `${SESSION_COOKIE}=${createSession()}`, "Content-Type": "application/json" });
let n = 0;
const rid = () => `wake-${Date.now()}-${(n += 1)}`;
let briefId = "";
async function act(item: string, action: string, extra: Json = {}) {
  const res = await app.request("/api/brief/act", { method: "POST", headers: cookie(), body: JSON.stringify({ brief_id: briefId, item_id: item, action, request_id: rid(), ...extra }) });
  return { http: res.status, body: (await res.json()) as Json };
}
const state = async () => ((await (await app.request(`/api/brief/${briefId}/state`, { headers: cookie() })).json()) as Json).items as Record<string, Json>;
const agentId = async (slug: string) => (await store.get("agents", { slug }))!.id;
const runsOf = async (agent: string) =>
  (await store.find("agentRuns", { agentId: await agentId(agent) }, { orderBy: [{ column: "queuedAt" }] })).map((r) => ({ status: r.status, task_key: r.taskKey, summary: r.summary }));
const setRuns = (where: import("../src/store/types.js").Where<"agentRuns">, patch: Partial<import("../src/store/types.js").NewRow<"agentRuns">>) => store.fix((uow) => uow.update("agentRuns", where, patch));
const workiaTasks = async () => (await store.find("tasks", { projectId: await store.projectId("workia") }, { orderBy: [{ column: "key" }] })).map((t) => ({ key: t.key, status: t.status }));

class FakeChild extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  constructor(readonly pid: number) {
    super();
    // The run ends at once, as a successful claude would.
    setImmediate(() => {
      const result = { type: "result", subtype: "success", is_error: false, num_turns: 1, session_id: "sess-wake", result: "OK", modelUsage: {} };
      this.stdout.write(`${JSON.stringify(result)}\n`);
      this.stdout.end();
      this.stderr.end();
      setImmediate(() => this.emit("exit", 0, null));
    });
  }
}
const spawned: string[][] = [];
wakeDeps.heartbeat = {
  runner: {
    env: { HOME: scratch, PATH: "/usr/bin:/bin", PLANIA_RUNNER_TOKEN: "runner-token", PLANIA_PROMPTS_PROJECT: "micasa", CLAUDE_CODE_BIN: "/fake/bin/claude" } as NodeJS.ProcessEnv,
    logDir: path.join(scratch, "logs"),
    tmpDir: path.join(scratch, "tmp"),
    worktreeRoot: path.join(scratch, "worktrees"),
    graceMs: 10,
    liveFlushMs: 0,
    footprints: false,
    git: async () => ({ code: 0, stdout: "", stderr: "" }),
    spawn: (_c: string, args: string[]) => {
      spawned.push(args);
      return new FakeChild(60_000 + spawned.length) as never;
    },
    kill: () => undefined,
    reportTokens: async () => undefined,
    probeUsage: async () => null,
  } as never,
};

const I = {
  give: "i|workia|0000000000a1",
  givePaused: "i|micasa|0000000000a2",
  start: "i|workia|0000000000a3",
  startPaused: "i|micasa|0000000000a4",
  build: "i|workia|0000000000a5",
  cross: "i|cross|0000000000a6",
};
const keys: Record<string, string> = {};

before(async () => {
  store = await resetTestStore();
  ({ db } = makeDb());
  await seedOrg(db);
  await saveBriefSettings(db, { github_mode: "off" });
  await store.fix(async (uow) => {
    await uow.update("projects", {}, { runsPaused: false });
    await uow.update("projects", { slug: "micasa" }, { runsPaused: true });
    await uow.update("runnerSettings", { id: 1 }, { companyPaused: false, maxConcurrent: 2, cooldownMinutes: 0 });
    await uow.insert("planReadings", { source: "stream", status: "allowed", fiveHourPct: 5, fiveHourResetsAt: new Date(uow.now.getTime() + 3 * 3600_000) });
  });
  keys.start = ((await createTask(db, { project: "workia", title: "Fix expediente crash", scope: "s", checks: ["c"], status: "Ready" } as never, ctx)) as { key: string }).key;
  keys.startPaused = ((await createTask(db, { project: "micasa", title: "Programados kit", scope: "s", checks: ["c"], status: "Ready" } as never, ctx)) as { key: string }).key;
  keys.ini = ((await createTask(db, { project: "workia", kind: "initiative", title: "Payroll", scope: "PRD" } as never, ctx)) as { key: string }).key;
  for (const [phase, title, status] of [[1, "Pay slip model", "Backlog"], [1, "Pay slip email", "Backlog"], [2, "Pay slip history", "Backlog"], [3, "Pay slip export", "Backlog"]] as const) {
    const k = ((await createTask(db, { project: "workia", title, scope: "s", checks: ["c"], parent_key: keys.ini, phase, status } as never, ctx)) as { key: string }).key;
    keys[`p${phase}-${title}`] = k;
  }
  const t = (kind: string, project: string, key?: string) => [{ kind, project, ...(key ? { key } : {}) }];
  const data = {
    ...JSON.parse(readFileSync(new URL("./fixtures/brief-sample.json", import.meta.url), "utf8")),
    version: 2,
    items: [
      { id: I.give, app: "workia", status: "needs_you", title: "Decide the renewal notice", detail: "The PO has a draft.", ref: "WRK-I14" },
      { id: I.givePaused, app: "micasa", status: "needs_you", title: "Reconcile the MiCasa release" },
      { id: I.start, app: "workia", status: "next", ref: keys.start, title: "Fix expediente crash", targets: t("ticket", "workia", keys.start) },
      { id: I.startPaused, app: "micasa", status: "next", ref: keys.startPaused, title: "Programados kit", targets: t("ticket", "micasa", keys.startPaused) },
      { id: I.build, app: "workia", status: "next", ref: keys.ini, title: "Payroll is planned and waiting", targets: t("initiative", "workia", keys.ini) },
      { id: I.cross, app: "cross", status: "needs_you", title: "Close the leftover PRs" },
    ],
  };
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date());
  briefId = (await store.fix((uow) => uow.insert("morningBriefs", { localDate: today, generatedAt: uow.now, trigger: "manual", mode: "full", data }))).id;
});

beforeEach(() => resetRunnerForTests());

after(async () => {
  wakeDeps.heartbeat = undefined;
  await store?.end();
  rmSync(scratch, { recursive: true, force: true });
});

test("before a wake: GET state says who wakes, about how long, and whether the project is paused", async () => {
  const s = await state();
  const give = s[I.give]!.actions.find((a: Json) => a.id === "give_to_po");
  assert.equal(give.level, "wake");
  assert.deepEqual([give.wake.agent, give.wake.role, give.wake.low, give.wake.high, give.wake.paused], ["po-workia", "product-owner", 10, 25, false]);
  const start = s[I.start]!.actions.find((a: Json) => a.id === "start_now");
  assert.deepEqual([start.wake.agent, start.wake.role, start.wake.paused], ["taller-workia", "taller", false]);
  const build = s[I.build]!.actions.find((a: Json) => a.id === "start_building");
  assert.equal(build.wake.agent, "taller-workia");
  assert.equal(s[I.cross]!.actions.find((a: Json) => a.id === "give_to_po").wake.agent, "po-workia", "a cross row goes to the home project's PO");
  // A paused project's Ready ticket: no Start now; Turn on runs instead; Give to PO says it waits.
  const paused = s[I.startPaused]!.actions.map((a: Json) => a.id);
  assert.ok(!paused.includes("start_now"));
  assert.ok(paused.includes("resume_runs"));
  assert.equal(s[I.givePaused]!.actions.find((a: Json) => a.id === "give_to_po").wake.paused, true);
});

test("check 2: Give to PO creates exactly one Ready PO ticket, origin jorge, and one queued wake with the brief's reason", async () => {
  const before = await store.count("tasks");
  const a = await act(I.give, "give_to_po", { input: { note: "Keep it short" } });
  assert.equal(a.body.status, "done", JSON.stringify(a.body));
  const key = a.body.state.line.match(/WRK-\d+/)?.[0] as string;
  assert.ok(key, a.body.state.line);
  assert.equal(await store.count("tasks"), before + 1);
  const task = (await store.get("tasks", { key }))!;
  const t = { status: task.status, origin: task.origin, scope: task.scope, owner: (await store.get("agents", { id: task.ownerAgent! }))!.slug };
  assert.deepEqual([t.status, t.origin, t.owner], ["Ready", "jorge", "po-workia"]);
  assert.match(t.scope, /Decide the renewal notice[\s\S]*The PO has a draft[\s\S]*Keep it short/);
  const runs = (await runsOf("po-workia")).filter((r) => r.task_key === key);
  assert.equal(runs.length, 1);
  assert.equal(runs[0]!.status, "queued");
  assert.match(runs[0]!.summary, /order from the morning brief: Decide the renewal notice/);
  // The row follows the order: queued, then done.
  assert.match(a.body.state.line, /po-workia queued/);
  await setRuns({ taskKey: key }, { status: "ok", summary: "Planned in WRK-I20" });
  assert.match((await state())[I.give]!.line, /po-workia done: Planned in WRK-I20/);
  await setRuns({ taskKey: key }, { status: "fail", summary: "Ran out of turns" });
  assert.match((await state())[I.give]!.line, /po-workia failed: Ran out of turns/);
});

test("busy PO (PLA-I60): Give to PO while the PO is busy makes the ticket and queues its own run; the seat's cap decides when it starts", async () => {
  // po-workia still has a run on the earlier order: mark it running.
  await setRuns({ agentId: await agentId("po-workia") }, { status: "running" });
  const a = await act(I.cross, "give_to_po");
  assert.equal(a.body.status, "done", JSON.stringify(a.body));
  const key = a.body.state.line.match(/WRK-\d+/)?.[0] as string;
  assert.equal((await store.get("tasks", { key }))!.status, "Ready", "the order waits Ready until the PO's run on it starts");
  const mine = (await runsOf("po-workia")).filter((r) => r.task_key === key);
  assert.deepEqual(mine.map((r) => r.status), ["queued"], "a work item of its own: queued, not coalesced into the running one");
  assert.match(a.body.state.line, new RegExp(`${key} · po-workia queued`));
  await setRuns({ agentId: await agentId("po-workia") }, { status: "ok" });
});

test("check 4: a paused project gets no wake until it is resumed, then exactly one", async () => {
  const a = await act(I.givePaused, "give_to_po");
  assert.equal(a.body.status, "done", JSON.stringify(a.body));
  const key = a.body.state.line.match(/MIC-\d+/)?.[0];
  assert.ok(key);
  assert.equal((await runsOf("po-micasa")).length, 0, "no wake while paused");
  assert.equal(await store.count("threadMessages"), 0, "no message either");
  await setProjectPaused(db, "micasa", false);
  const runs = await runsOf("po-micasa");
  assert.equal(runs.length, 1, "resuming wakes the PO once");
  assert.equal(runs[0]!.status, "queued");
  await store.fix((uow) => uow.update("projects", { slug: "micasa" }, { runsPaused: true }));
});

test("failed: Start now that cannot start says why, records the failure and leaves the row open", async () => {
  const f = await act(I.start, "start_now");
  assert.equal(f.http, 409);
  assert.equal(f.body.status, "failed");
  assert.match(f.body.hint, /no prompt doc/);
  assert.equal((await state())[I.start]!.state, "open");
});

test("Start now: the ticket's owner starts at once with the reason; a paused project refuses with a state, not an error", async () => {
  const micasa = await store.projectId("micasa");
  const taller = await agentId("taller-workia");
  await store.fix(async (uow) => {
    await uow.insert("docs", { projectId: micasa, title: "Prompt: Taller", markdown: "# Taller", actor: ctx.actor });
    await uow.delete("agentRuns", { agentId: taller });
  });
  const a = await act(I.start, "start_now");
  assert.equal(a.body.status, "done", JSON.stringify(a.body));
  assert.match(a.body.line, /taller-workia (started|queued)/);
  const runs = await runsOf("taller-workia");
  assert.equal(runs.length, 1);
  assert.ok(spawned.length, "a run started");
  assert.match(spawned.at(-1)!.join(" "), /Why you woke: started from the morning brief: WRK-\d+/, "the bot reads why it woke");
  const p = await act(I.startPaused, "start_now");
  assert.equal(p.body.status, "stale", "a paused project offers Turn on runs, not Start now");
});

test("check 3: Start building moves only the first open phase to Ready and nothing else", async () => {
  const before = await workiaTasks();
  const a = await act(I.build, "start_building");
  assert.equal(a.body.status, "done", JSON.stringify(a.body));
  const after = await workiaTasks();
  const moved = after.filter((r, i) => r.status !== before.find((b) => b.key === r.key)?.status || i < 0).map((r) => r.key).sort();
  assert.deepEqual(moved, [keys["p1-Pay slip email"], keys["p1-Pay slip model"]].sort());
  assert.equal(after.find((r) => r.key === keys["p2-Pay slip history"])!.status, "Backlog");
  assert.equal(after.find((r) => r.key === keys["p3-Pay slip export"])!.status, "Backlog");
  assert.equal((await act(I.build, "start_building")).body.status, "stale", "phase 1 is no longer in Backlog");
});

test("check 6: no ticket becomes Ready from a brief action other than start_now and start_building", async () => {
  // Every task.status → Ready event since the brief, by tool: only the brief's start_building, plus the PO
  // tickets Give to PO created (created Ready, not moved there).
  const rows = (await store.find("events", { type: "task.status" })).filter((e) => (e.payload as { to?: unknown }).to === "Ready");
  const moved = rows.map((r) => r.taskKey).sort();
  assert.deepEqual(moved, [keys["p1-Pay slip email"], keys["p1-Pay slip model"]].sort());
});
