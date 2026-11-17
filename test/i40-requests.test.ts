// PLA-I40-6: the owner's request nobody took (flagged after an hour, off the PO's queue, Reenviar and Cerrar),
// the wake a product owner gets when its run ends with another request waiting, and the floor's last lines.
// Throwaway DB, fake values only; every process is a fake child.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { after, before, beforeEach, test } from "node:test";
import { resetTestStore, useOwnerCode, useTestEnv, type TestStore } from "./helpers.js";

useTestEnv();
await useOwnerCode();
process.env.PLANIA_EVENT_WAKES = "1";
process.env.PLANIA_HOME_PROJECT = "zigzag";
process.env.PLANIA_PROMPTS_PROJECT = "micasa";
const { makeDb } = await import("../src/db/client.js");
const { app } = await import("../src/app.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const { seedOrg } = await import("../scripts/seed-org.js");
const writes = await import("../src/mcp/writes.js");
const actions = await import("../src/api/company-actions.js");
const runner = await import("../src/runner/runner.js");
const { ne } = await import("../src/store/types.js");

type Json = Record<string, any>;
let store: TestStore;
let db: ReturnType<typeof makeDb>["db"];
let closeDb: () => Promise<void>;
const scratch = mkdtempSync(path.join(tmpdir(), "plania-i40-requests-"));
const jorge = () => ({ Cookie: `${SESSION_COOKIE}=${createSession()}`, "Content-Type": "application/json" });
const card = async (slug: string): Promise<Json> => {
  const res = await app.request("/api/company", { headers: jorge() });
  assert.equal(res.status, 200);
  return ((await res.json()) as Json).projects.find((p: Json) => p.slug === slug) as Json;
};
const post = (url: string) => app.request(url, { method: "POST", headers: jorge() });
const id = async (table: "agents" | "projects", slug: string) => (table === "agents" ? (await store.get("agents", { slug }))!.id : store.projectId(slug));
const queuedFor = async (slug: string) =>
  (await store.find("agentRuns", { agentId: await id("agents", slug), status: "queued" })).map((r) => ({ task_key: r.taskKey, summary: r.summary }));
// Every run gone; run_locks went with them through the foreign key.
const deleteRuns = () =>
  store.fix(async (uow) => {
    await uow.delete("runLocks", {});
    await uow.delete("agentRuns", {});
  });
// A request as the screen makes it; the hook queues the PO's wake, which each test clears or keeps.
const request = async (text: string) => {
  const out = (await actions.askPo(db, "micasa", text)) as Json;
  assert.ok(out.key, JSON.stringify(out));
  return out.key as string;
};
const age = (key: string, minutes: number) => store.fix((uow) => uow.update("tasks", { key }, { createdAt: new Date(uow.now.getTime() - minutes * 60_000), statusChangedAt: null }));

class FakeChild extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  constructor(readonly pid: number) {
    super();
  }
  finish(): void {
    const result = { type: "result", subtype: "success", is_error: false, num_turns: 2, session_id: "sess-i40", result: "OK", modelUsage: { "claude-opus-5-5": { inputTokens: 10, outputTokens: 20, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 } } };
    this.stdout.write(`${JSON.stringify(result)}\n`);
    this.stdout.end();
    setImmediate(() => this.emit("exit", 0, null));
  }
}
function fakes() {
  const spawned: FakeChild[] = [];
  let n = 60_000;
  const deps = {
    env: { HOME: scratch, PATH: "/usr/bin:/bin", PLANIA_RUNNER_TOKEN: "runner-token", PLANIA_PROMPTS_PROJECT: "micasa", CLAUDE_CODE_BIN: "/fake/bin/claude", PLANIA_EVENT_WAKES: "1" } as NodeJS.ProcessEnv,
    logDir: path.join(scratch, "logs"),
    tmpDir: path.join(scratch, "tmp"),
    worktreeRoot: path.join(scratch, "worktrees"),
    graceMs: 10,
    liveFlushMs: 0,
    footprints: false,
    git: async () => ({ code: 0, stdout: "", stderr: "" }),
    spawn: () => {
      const child = new FakeChild(++n);
      spawned.push(child);
      return child;
    },
    kill: () => undefined,
    reportTokens: async () => undefined,
    probeUsage: async () => null,
  };
  return { deps, spawned };
}

before(async () => {
  store = await resetTestStore();
  ({ db, close: closeDb } = makeDb());
  await seedOrg(db);
  const actor = { agent: "test", session_id: "s" };
  const micasa = await id("projects", "micasa");
  await store.fix(async (uow) => {
    await uow.insert("docs", { projectId: micasa, title: "Prompt: Product owner", markdown: "# PO", actor });
    await uow.insert("goals", { projectId: micasa, title: "Lanzar la beta" });
  });
});

beforeEach(async () => {
  await runner.waitForAllRuns();
  runner.resetRunnerForTests();
  await deleteRuns();
  await store.fix(async (uow) => {
    await uow.update("tasks", { kind: "ticket", status: ["Ready", "In progress"] }, { status: "Done" });
    await uow.update("runnerSettings", { id: 1 }, { companyPaused: false, maxConcurrent: 2, cooldownMinutes: 0 });
    await uow.update("projects", { slug: ne("micasa") }, { runsPaused: true });
    await uow.update("projects", { slug: "micasa" }, { runsPaused: false });
    await uow.delete("planReadings", {});
    await uow.insert("planReadings", { at: uow.now, source: "stream", status: "allowed", fiveHourPct: 10, fiveHourResetsAt: new Date(uow.now.getTime() + 3 * 3_600_000) });
  });
});

after(async () => {
  await runner.waitForAllRuns();
  await closeDb?.();
  await store?.end();
  rmSync(scratch, { recursive: true, force: true });
});

test("I40-6 #2: a request Ready for 61 minutes with no run is flagged and leaves the PO's queue; at 59, or with a run queued, it is not", async () => {
  const key = await request("Dile a Taller que siga");
  await deleteRuns();
  const po = async () => (await card("micasa")).team.find((m: Json) => m.role === "product-owner") as Json;

  await age(key, 59);
  assert.deepEqual((await card("micasa")).stale_requests, []);
  assert.deepEqual((await po()).queue.map((q: Json) => q.key), [key]);

  await age(key, 61);
  const c = await card("micasa");
  assert.deepEqual(c.stale_requests.map((r: Json) => [r.key, r.title]), [[key, "Dile a Taller que siga"]]);
  assert.deepEqual((await po()).queue, [], "it no longer poses as the PO's next job");
  assert.equal((await po()).next_start, null);

  const [poId, micasa] = [await id("agents", "po-micasa"), await id("projects", "micasa")];
  await store.fix((uow) => uow.insert("agentRuns", { agentId: poId, projectId: micasa, role: "product-owner", status: "queued", summary: "event: ticket ready", taskKey: key }));
  assert.deepEqual((await card("micasa")).stale_requests, [], "a queued run means someone will take it");
});

test("I40-6 #3 (PLA-I60): two requests to a busy PO are two queued runs; the PO's cap starts one, then the other; no loop on a ticket it ran", async () => {
  const f = fakes();
  const first = await request("Arma el plan del catálogo");
  const second = await request("Y revisa los textos de la portada");
  assert.deepEqual((await queuedFor("po-micasa")).map((r) => r.task_key).sort(), [first, second].sort(), "each request is a work item of its own");

  assert.equal((await runner.drainQueue(db, new Date(), f.deps as never)).started, 1, "the PO's cap (1) starts one");
  f.spawned[0]!.finish();
  await runner.waitForAllRuns();
  assert.equal((await queuedFor("po-micasa")).length, 1);
  assert.equal((await runner.drainQueue(db, new Date(), f.deps as never)).started, 1);
  f.spawned[1]!.finish();
  await runner.waitForAllRuns();
  // Both tickets it ran are still Ready: wakePoIfWaiting never queues the ticket a run just ran; the other one is
  // queued at most once more (it has no active run).
  const left = await queuedFor("po-micasa");
  assert.ok(left.length <= 1, JSON.stringify(left));
});

test("I40-6 #4: Reenviar queues the PO's wake again and the warning goes; Cerrar closes the request", async () => {
  const key = await request("Dile a Taller que siga");
  await deleteRuns();
  await age(key, 90);
  assert.equal((await card("micasa")).stale_requests.length, 1);

  const sent = await post(`/api/company/projects/micasa/requests/${key}/resend`);
  assert.deepEqual([sent.status, ((await sent.json()) as Json).wake], [200, "queued"]);
  assert.deepEqual((await queuedFor("po-micasa")).map((r) => r.task_key), [key]);
  assert.deepEqual((await card("micasa")).stale_requests, []);
  const again = await post(`/api/company/projects/micasa/requests/${key}/resend`);
  assert.equal(((await again.json()) as Json).wake, "busy", "one wake, not two");
  assert.equal((await queuedFor("po-micasa")).length, 1);

  await deleteRuns();
  assert.equal((await card("micasa")).stale_requests.length, 1);
  const closed = await post(`/api/company/projects/micasa/orders/${key}/cancel`);
  assert.equal(closed.status, 200);
  assert.equal((await store.get("tasks", { key }))!.status, "Won't do");
  assert.deepEqual((await card("micasa")).stale_requests, []);

  assert.equal((await post(`/api/company/projects/micasa/requests/MIC-999/resend`)).status, 404);
  assert.equal((await app.request(`/api/company/projects/micasa/requests/${key}/resend`, { method: "POST", headers: { Authorization: "Bearer x" } })).status, 403);
});

test("I40-6: latest carries a publish with its count and a delivery by title, newest first, three at most", async () => {
  const t = (await writes.createTask(db, { project: "micasa", title: "Listado de casas", scope: "s", checks: ["c"], status: "Ready" } as never, { actor: { agent: "po-micasa", session_id: "s" } })) as Json;
  const pid = await id("projects", "micasa");
  const ev = (type: string, payload: Json, key: string | null, ago: number) =>
    store.fix(async (uow) => {
      const taskId = key ? ((await uow.get("tasks", { key }))?.id ?? null) : null;
      await uow.insert("events", { projectId: pid, taskId, taskKey: key, type, actor: { agent: "jorge", session_id: "web" }, payload, createdAt: new Date(uow.now.getTime() - ago * 60_000) });
    });
  await store.fix((uow) => uow.delete("events", { projectId: pid, type: ["release.merged", "task.status"] }));
  await ev("task.status", { to: "In review", from: "In progress" }, t.key, 30);
  await ev("task.status", { to: "Merged", from: "In review" }, t.key, 20);
  await ev("release.merged", { tickets: ["a", "b", "c"] }, null, 10);
  const { latest } = await card("micasa");
  assert.deepEqual(latest.map((l: Json) => [l.kind, l.title, l.n]), [["published", null, 3], ["delivered", "Listado de casas", null]]);
});
