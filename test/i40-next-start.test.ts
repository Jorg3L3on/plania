// PLA-I40-1: why a teammate's next step has not started. The pure verdict (src/runner/hold.ts), then
// GET /api/company's next_start against the runner's own check (canStart) on the same state. Throwaway DB,
// fake values only.
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { eq } from "drizzle-orm";
import type pg from "pg";
import { resetTestDb, useOwnerCode, useTestEnv } from "./helpers.js";

useTestEnv();
await useOwnerCode();
process.env.PLANIA_HOME_PROJECT = "zigzag";
process.env.PLANIA_PROMPTS_PROJECT = "micasa";
const { makeDb } = await import("../src/db/client.js");
const { app } = await import("../src/app.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const { seedOrg } = await import("../scripts/seed-org.js");
const writes = await import("../src/mcp/writes.js");
const schema = await import("../src/db/schema.js");
const { canStart, resetRunnerForTests } = await import("../src/runner/runner.js");
const { holdOf, agentHold, capacityHold } = await import("../src/runner/hold.js");
const { planView } = await import("../src/runner/limits.js");

type Json = Record<string, any>;
let raw: pg.Client;
let db: ReturnType<typeof makeDb>["db"];
let closeDb: () => Promise<void>;
const jorge = () => ({ Cookie: `${SESSION_COOKIE}=${createSession()}`, "Content-Type": "application/json" });
const member = async (slug: string, role: string): Promise<Json> => {
  const res = await app.request("/api/company", { headers: jorge() });
  assert.equal(res.status, 200);
  const card = ((await res.json()) as Json).projects.find((p: Json) => p.slug === slug) as Json;
  return card.team.find((m: Json) => m.role === role) as Json;
};
const as = (agent: string) => ({ actor: { agent, session_id: `s-${agent}` } });
const id = async (table: string, slug: string) => (await raw.query(`select id from ${table} where slug = $1`, [slug])).rows[0].id as string;
const ticket = (project: string, title: string, patch: Json = {}) =>
  writes.createTask(db, { project, title, scope: "s", checks: ["c"], status: "Ready", ...patch } as never, as(`po-${project}`)) as Promise<{ key: string }>;
const reading = (pct: number, status = "allowed") =>
  raw.query(`insert into plan_readings (source, status, five_hour_pct, five_hour_resets_at) values ('stream', $1, $2, now() + interval '3 hours')`, [status, pct]);
const run = (agent: string, project: string, sql: string, key: string | null = null) =>
  raw.query(`insert into agent_runs (agent_id, project_id, role, status, summary, task_key, queued_at, started_at, ended_at) select $1, $2, 'taller', ${sql}`, [agent, project, key]);
// What the runner itself says for this agent and ticket, without probing usage.
const runner = async (agentSlug: string, projectSlug: string, key: string) => {
  const [agent] = await db.select().from(schema.agents).where(eq(schema.agents.slug, agentSlug)).limit(1);
  return canStart(db, agent!, await id("projects", projectSlug), key, new Date(), { probeUsage: async () => null });
};

let key = "";
let taller = "";
let workia = "";

before(async () => {
  raw = await resetTestDb();
  ({ db, close: closeDb } = makeDb());
  await seedOrg(db);
  await raw.query(`update projects set runs_paused = false`);
  key = (await ticket("workia", "Ficha del producto")).key;
  taller = await id("agents", "taller-workia");
  workia = await id("projects", "workia");
});

beforeEach(async () => {
  resetRunnerForTests();
  await raw.query(`delete from agent_runs`);
  await raw.query(`delete from plan_readings`);
  await raw.query(`update projects set runs_paused = false`);
  await raw.query(`update runner_settings set company_paused = false, max_concurrent = 1, cooldown_minutes = 30, guard_override = false`);
  await reading(10);
});

after(async () => {
  await closeDb?.();
  await raw?.end();
});

// ---- the pure verdict

const NOW = new Date("2026-11-13T20:44:00Z");
const own = (patch: Json = {}) => ({ companyPaused: false, projectPaused: false, role: "taller", cooldownMinutes: 30, lastEndedAt: null, hasGoal: true, now: NOW, ...patch }) as never;
const okPlan = planView({ at: NOW, status: "allowed", fiveHourPct: 10, fiveHourResetsAt: new Date("2026-11-13T23:00:00Z") } as never, 70, NOW);
const cap = (patch: Json = {}) => ({ plan: okPlan, running: 0, maxConcurrent: 1, now: NOW, ...patch }) as never;

test("I40-1 #1: each hold, in the runner's order, and none when nothing holds", () => {
  assert.equal(holdOf(own(), cap()), null);
  assert.deepEqual(holdOf(own({ companyPaused: true, projectPaused: true }), cap()), { code: "paused", scope: "company", startsAt: null });
  assert.deepEqual(holdOf(own({ projectPaused: true }), cap()), { code: "paused", scope: "project", startsAt: null });
  assert.equal(agentHold(own({ projectPaused: true, role: "asistente" })), null, "the project switch does not hold Asistente");

  const rest = holdOf(own({ lastEndedAt: new Date("2026-11-13T20:22:00Z") }), cap());
  assert.deepEqual(rest, { code: "rest", startsAt: new Date("2026-11-13T20:52:00Z") });
  assert.equal(holdOf(own({ lastEndedAt: new Date("2026-11-13T20:14:00Z") }), cap()), null, "the rest is over at 30 minutes");
  assert.equal(holdOf(own({ lastEndedAt: new Date("2026-11-13T20:43:00Z"), cooldownMinutes: 0 }), cap()), null);

  assert.deepEqual(holdOf(own({ role: "product-owner", hasGoal: false }), cap()), { code: "no_goal", startsAt: null });
  assert.equal(holdOf(own({ role: "taller", hasGoal: false }), cap()), null, "only a product owner needs the goal");

  const over = planView({ at: NOW, status: "allowed", fiveHourPct: 77, fiveHourResetsAt: new Date("2026-11-13T23:00:00Z") } as never, 70, NOW);
  assert.deepEqual(capacityHold(cap({ plan: over })), { code: "usage", startsAt: new Date("2026-11-13T23:00:00Z") });
  assert.deepEqual(capacityHold(cap({ plan: planView(null, 70, NOW) })), { code: "usage", startsAt: null }, "an unknown reading holds, with no time");
  assert.deepEqual(capacityHold(cap({ running: 1 })), { code: "slot", startsAt: null });
  // The rest comes before usage and the cap, as in preflight.
  assert.equal(holdOf(own({ lastEndedAt: new Date("2026-11-13T20:40:00Z") }), cap({ plan: over, running: 1 }))!.code, "rest");
});

// ---- GET /api/company against the runner

test("I40-1 #2: Ready work nobody woke is unqueued; a teammate with nothing has no next_start", async () => {
  const m = await member("workia", "taller");
  assert.deepEqual([m.next_start.hold, m.next_start.key, m.next_start.title, m.next_start.starts_at], ["unqueued", key, "Ficha del producto", null]);
  assert.equal((await member("workia", "research")).next_start, null);
  assert.deepEqual(await runner("taller-workia", "workia", key), { ok: true, summary: "" });
});

test("I40-1 #3: a queued event wake inside the cooldown says rest and when it starts; the runner agrees", async () => {
  await run(taller, workia, `'ok', 'listo', $3::text, now() - interval '9 minutes', now() - interval '8 minutes', now() - interval '2 minutes'`);
  await run(taller, workia, `'queued', 'event: unblocked', $3::text, now(), null, null`, key);
  const ended = (await raw.query(`select ended_at from agent_runs where status = 'ok'`)).rows[0].ended_at as Date;

  const m = await member("workia", "taller");
  assert.equal(m.next_start.hold, "rest");
  assert.equal(m.next_start.starts_at, new Date(ended.getTime() + 30 * 60_000).toISOString());
  assert.equal(m.next_start.title, "Ficha del producto");
  assert.equal(/WRK-|\$/.test(m.next_start.text), false, "no keys or money in the sentence");
  assert.deepEqual(await runner("taller-workia", "workia", key), { ok: true, summary: "skipped: cooldown" });
});

test("I40-1 #4: once the rest is over a queued wake starts in a moment", async () => {
  await run(taller, workia, `'ok', 'listo', $3::text, now() - interval '50 minutes', now() - interval '49 minutes', now() - interval '40 minutes'`);
  await run(taller, workia, `'queued', 'event: unblocked', $3::text, now(), null, null`, key);
  assert.equal((await member("workia", "taller")).next_start.hold, "soon");
  assert.deepEqual(await runner("taller-workia", "workia", key), { ok: true, summary: "" });
});

test("I40-1 #5: usage over the guard holds with the numbers; the runner skips for the same reason", async () => {
  await reading(77);
  const m = await member("workia", "taller");
  assert.equal(m.next_start.hold, "usage");
  assert.match(m.next_start.text, /77 %.*70 %/);
  assert.ok(m.next_start.starts_at, "the five-hour reset is the time");
  const r = await runner("taller-workia", "workia", key);
  assert.equal(r.ok, false);
  assert.match(r.summary, /^skipped: plan guard \(five_hour 77% >= 70%/);
});

test("I40-1 #6: with every slot taken the hold is slot, and the runner would queue", async () => {
  await run(await id("agents", "taller-micasa"), await id("projects", "micasa"), `'running', 'starting', $3::text, now(), now(), null`);
  assert.equal((await member("workia", "taller")).next_start.hold, "slot");
  assert.deepEqual(await runner("taller-workia", "workia", key), { ok: true, summary: "queued: cap reached" });
});

test("I40-1 #7: a paused project holds as paused; the runner says the same", async () => {
  await raw.query(`update projects set runs_paused = true where slug = 'workia'`);
  const m = await member("workia", "taller");
  assert.deepEqual([m.next_start.hold, m.next_start.text], ["paused", "El proyecto está en pausa."]);
  assert.deepEqual(await runner("taller-workia", "workia", key), { ok: false, summary: "skipped: project workia paused" });
});

test("I40-1 #8: a product owner without a goal holds as no_goal", async () => {
  const t = await ticket("zigzag", "Entrevistar a tres tiendas", { work_type: "research" });
  await raw.query(`delete from goals where project_id = $1`, [await id("projects", "zigzag")]);
  assert.equal((await member("zigzag", "product-owner")).next_start.hold, "no_goal");
  assert.deepEqual(await runner("po-zigzag", "zigzag", t.key), { ok: false, summary: "skipped: no goal" });
});

test("I40-1 #9: a step behind a delivery waits on the owner; behind anything else it waits on a step", async () => {
  const a = await ticket("filmia", "Listado de películas");
  const b = await ticket("filmia", "Ficha de la película", { blocked_by: [a.key] });
  const first = async () => (await member("filmia", "taller")).next_start as Json;

  await raw.query(`update tasks set status = 'In review' where key = $1`, [a.key]);
  assert.deepEqual([(await first()).hold, (await first()).title, (await first()).key], ["waiting_owner", "Ficha de la película", b.key]);

  await raw.query(`update tasks set status = 'Backlog' where key = $1`, [a.key]);
  assert.equal((await first()).hold, "waiting_step");

  await raw.query(`update tasks set status = 'Merged' where key = $1`, [a.key]);
  assert.equal((await first()).hold, "unqueued");
});

test("I40-1 #10: a teammate that is working has no next_start", async () => {
  await run(taller, workia, `'running', 'starting', $3::text, now(), now(), null`, key);
  const m = await member("workia", "taller");
  assert.equal(m.state, "running");
  assert.equal(m.next_start, null);
});
