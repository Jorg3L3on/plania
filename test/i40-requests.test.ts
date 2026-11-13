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
import type pg from "pg";
import { resetTestDb, useOwnerCode, useTestEnv } from "./helpers.js";

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

type Json = Record<string, any>;
let raw: pg.Client;
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
const id = async (table: string, slug: string) => (await raw.query(`select id from ${table} where slug = $1`, [slug])).rows[0].id as string;
const queuedFor = async (slug: string) =>
  (await raw.query(`select r.task_key, r.summary from agent_runs r join agents a on a.id = r.agent_id where a.slug = $1 and r.status = 'queued'`, [slug])).rows as { task_key: string | null; summary: string }[];
// A request as the screen makes it; the hook queues the PO's wake, which each test clears or keeps.
const request = async (text: string) => {
  const out = (await actions.askPo(db, "micasa", text)) as Json;
  assert.ok(out.key, JSON.stringify(out));
  return out.key as string;
};
const age = (key: string, minutes: number) => raw.query(`update tasks set created_at = now() - $2 * interval '1 minute', status_changed_at = null where key = $1`, [key, minutes]);

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
  raw = await resetTestDb();
  ({ db, close: closeDb } = makeDb());
  await seedOrg(db);
  const actor = JSON.stringify({ agent: "test", session_id: "s" });
  await raw.query(`insert into docs (project_id, title, markdown, actor) values ($1, 'Prompt: Product owner', '# PO', $2)`, [await id("projects", "micasa"), actor]);
  await raw.query(`insert into goals (project_id, title) values ($1, 'Lanzar la beta')`, [await id("projects", "micasa")]);
});

beforeEach(async () => {
  await runner.waitForAllRuns();
  runner.resetRunnerForTests();
  await raw.query(`delete from agent_runs`);
  await raw.query(`update tasks set status = 'Done' where kind = 'ticket' and status in ('Ready', 'In progress')`);
  await raw.query(`update runner_settings set company_paused = false, max_concurrent = 2, cooldown_minutes = 0`);
  await raw.query(`update projects set runs_paused = (slug <> 'micasa')`);
  await raw.query(`delete from plan_readings`);
  await raw.query(`insert into plan_readings (at, source, status, five_hour_pct, five_hour_resets_at) values (now(), 'stream', 'allowed', 10, now() + interval '3 hours')`);
});

after(async () => {
  await runner.waitForAllRuns();
  await closeDb?.();
  await raw?.end();
  rmSync(scratch, { recursive: true, force: true });
});

test("I40-6 #2: a request Ready for 61 minutes with no run is flagged and leaves the PO's queue; at 59, or with a run queued, it is not", async () => {
  const key = await request("Dile a Taller que siga");
  await raw.query(`delete from agent_runs`);
  const po = async () => (await card("micasa")).team.find((m: Json) => m.role === "product-owner") as Json;

  await age(key, 59);
  assert.deepEqual((await card("micasa")).stale_requests, []);
  assert.deepEqual((await po()).queue.map((q: Json) => q.key), [key]);

  await age(key, 61);
  const c = await card("micasa");
  assert.deepEqual(c.stale_requests.map((r: Json) => [r.key, r.title]), [[key, "Dile a Taller que siga"]]);
  assert.deepEqual((await po()).queue, [], "it no longer poses as the PO's next job");
  assert.equal((await po()).next_start, null);

  await raw.query(`insert into agent_runs (agent_id, project_id, role, status, summary, task_key) values ($1, $2, 'product-owner', 'queued', 'event: ticket ready', $3)`, [await id("agents", "po-micasa"), await id("projects", "micasa"), key]);
  assert.deepEqual((await card("micasa")).stale_requests, [], "a queued run means someone will take it");
});

test("I40-6 #3: a PO whose run ends well with another request waiting gets one new queued wake, never for the ticket it ran", async () => {
  const f = fakes();
  const first = await request("Arma el plan del catálogo");
  const second = await request("Y revisa los textos de la portada");
  assert.deepEqual((await queuedFor("po-micasa")).map((r) => r.task_key), [first], "the second request was coalesced: nothing would wake the PO for it");

  assert.equal((await runner.drainQueue(db, new Date(), f.deps as never)).started, 1);
  f.spawned[0]!.finish();
  await runner.waitForAllRuns();
  const next = await queuedFor("po-micasa");
  assert.deepEqual(next.map((r) => r.task_key), [second]);
  assert.match(next[0]!.summary, /request waiting/);
  const woke = (await raw.query(`select payload from events where type = 'wake.queued' and task_key = $1`, [second])).rows;
  assert.equal(woke.length, 1);
  assert.equal(woke[0].payload.from_event, "run.ended");

  // That run ends too. Only the ticket it just ran is still Ready besides the first: the first is not its own.
  await raw.query(`update tasks set status = 'Done' where key = $1`, [first]);
  assert.equal((await runner.drainQueue(db, new Date(), f.deps as never)).started, 1);
  f.spawned[1]!.finish();
  await runner.waitForAllRuns();
  assert.deepEqual(await queuedFor("po-micasa"), [], "no loop on the ticket it just ran");
});

test("I40-6 #4: Reenviar queues the PO's wake again and the warning goes; Cerrar closes the request", async () => {
  const key = await request("Dile a Taller que siga");
  await raw.query(`delete from agent_runs`);
  await age(key, 90);
  assert.equal((await card("micasa")).stale_requests.length, 1);

  const sent = await post(`/api/company/projects/micasa/requests/${key}/resend`);
  assert.deepEqual([sent.status, ((await sent.json()) as Json).wake], [200, "queued"]);
  assert.deepEqual((await queuedFor("po-micasa")).map((r) => r.task_key), [key]);
  assert.deepEqual((await card("micasa")).stale_requests, []);
  const again = await post(`/api/company/projects/micasa/requests/${key}/resend`);
  assert.equal(((await again.json()) as Json).wake, "busy", "one wake, not two");
  assert.equal((await queuedFor("po-micasa")).length, 1);

  await raw.query(`delete from agent_runs`);
  assert.equal((await card("micasa")).stale_requests.length, 1);
  const closed = await post(`/api/company/projects/micasa/orders/${key}/cancel`);
  assert.equal(closed.status, 200);
  assert.equal((await raw.query(`select status from tasks where key = $1`, [key])).rows[0].status, "Won't do");
  assert.deepEqual((await card("micasa")).stale_requests, []);

  assert.equal((await post(`/api/company/projects/micasa/requests/MIC-999/resend`)).status, 404);
  assert.equal((await app.request(`/api/company/projects/micasa/requests/${key}/resend`, { method: "POST", headers: { Authorization: "Bearer x" } })).status, 403);
});

test("I40-6: latest carries a publish with its count and a delivery by title, newest first, three at most", async () => {
  const t = (await writes.createTask(db, { project: "micasa", title: "Listado de casas", scope: "s", checks: ["c"], status: "Ready" } as never, { actor: { agent: "po-micasa", session_id: "s" } })) as Json;
  const pid = await id("projects", "micasa");
  const ev = (type: string, payload: Json, key: string | null, ago: number) =>
    raw.query(`insert into events (project_id, task_id, task_key, type, actor, payload, created_at) select $1, (select id from tasks where key = $3), $3, $2, '{"agent":"jorge","session_id":"web"}', $4::jsonb, now() - $5 * interval '1 minute'`, [pid, type, key, JSON.stringify(payload), ago]);
  await raw.query(`delete from events where project_id = $1 and type in ('release.merged', 'task.status')`, [pid]);
  await ev("task.status", { to: "In review", from: "In progress" }, t.key, 30);
  await ev("task.status", { to: "Merged", from: "In review" }, t.key, 20);
  await ev("release.merged", { tickets: ["a", "b", "c"] }, null, 10);
  const { latest } = await card("micasa");
  assert.deepEqual(latest.map((l: Json) => [l.kind, l.title, l.n]), [["published", null, 3], ["delivered", "Listado de casas", null]]);
});
