// PLA-I28: the CEO screen v2. The rules (goal health, queue, brief, wake info) as plain functions, then the
// read and the two screen actions through the app. Titles here are fixtures; no real data.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type pg from "pg";
import { TEST_BEARER, resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
process.env.PLANIA_TZ = "America/Mexico_City";

const { app } = await import("../src/app.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const { makeDb } = await import("../src/db/client.js");
const { clearProgressCache } = await import("../src/mcp/progress.js");
const { setGoal } = await import("../src/mcp/goals.js");
const { webCtx } = await import("../src/mcp/tx.js");
const { seedOrg } = await import("../scripts/seed-org.js");
const writes = await import("../src/mcp/writes.js");
const signals = await import("../src/mcp/ceo-signals.js");

type Json = Record<string, any>;
let raw: pg.Client;
let closeDb: () => Promise<void>;
const cookie = `${SESSION_COOKIE}=${createSession()}`;
const ctx = { actor: { agent: "test-agent", session_id: "s-dash2" } };
const NOW = new Date("2026-11-07T18:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

const item = (over: Partial<import("../src/mcp/ceo-signals.js").InitiativeSignal>) => ({
  project: "filmia",
  key: "FIL-I1",
  title: "Iniciativa de ejemplo",
  status: "Active",
  goal_id: null,
  open: 3,
  ready: 2,
  in_review: 0,
  in_progress: 0,
  done: 1,
  total: 4,
  last_move: daysAgo(1),
  ...over,
});
const dayOf = (iso: string) => iso.slice(0, 10);

test("goal health: stopped, at risk, on track and no initiatives", () => {
  const stop = signals.goalSignal([item({ last_move: daysAgo(9) })], NOW, dayOf);
  assert.equal(stop.health, "stop");
  assert.match(stop.why, /^FIL-I1 sin cambios desde el 29 oct, 2 listos$/);
  const risk = signals.goalSignal([item({ in_review: 3 })], NOW, dayOf);
  assert.deepEqual(risk, { health: "risk", why: "3 esperan tu revisión" });
  const on = signals.goalSignal([item({ in_progress: 1 })], NOW, dayOf);
  assert.deepEqual(on, { health: "on", why: "1 de 4 hechos · 1 iniciativa en curso" });
  assert.equal(signals.goalSignal([], NOW, dayOf).health, "none");
  // One stalled and one moving initiative is not a stopped goal; On hold never stalls.
  assert.equal(signals.goalSignal([item({ last_move: daysAgo(9) }), item({ key: "FIL-I2" })], NOW, dayOf).health, "on");
  assert.equal(signals.initiativeStalled(item({ status: "On hold", last_move: daysAgo(30) }), NOW), false);
  assert.deepEqual(signals.companySignal([stop, on, { health: "none", why: "" }]), { health: "risk", why: "1 de 2 metas en curso" });
});

test("queue order is decide, merge, stalled, step; the brief only repeats what the queue and week hold", () => {
  const queue = signals.buildQueue(
    {
      waits: [
        { id: "a", group: "pasos", project: "micasa", key: "MIC-1", title: "Paso de ejemplo", why: "human_action", wait_s: 86_400 * 2, pr_url: null },
        { id: "b", group: "decisiones", project: "plania", key: "PLA-1", title: "Decisión de ejemplo", why: "question", wait_s: 3600, pr_url: null },
        { id: "c", group: "limpieza", project: "plania", key: null, title: null, why: "footprint", wait_s: 1, pr_url: null },
      ],
      reviews: [
        { project: "micasa", key: "MIC-I1", title: "Revisión de ejemplo", count: 8, since: daysAgo(3), pr_url: "https://example.com/pull/1" },
        { project: "workia", key: "WRK-I1", title: "Otra revisión", count: 5, since: daysAgo(4), pr_url: null },
      ],
      initiatives: [item({ project: "zigzag", key: "ZIG-I1", last_move: daysAgo(8) }), item({ key: "FIL-I9" })],
    },
    NOW,
  );
  assert.deepEqual(
    queue.map((row) => [row.kind, row.key]),
    [
      ["decidir", "PLA-1"],
      ["merge", "WRK-I1"],
      ["merge", "MIC-I1"],
      ["atorado", "ZIG-I1"],
      ["paso", "MIC-1"],
    ],
  );
  assert.equal(queue[3]!.action, "assign");
  const brief = signals.buildBrief({ queue, finished: 117, previous: 110 });
  assert.deepEqual(brief, [
    "13 tickets esperan tu revisión: MiCasa 8, Workia 5.",
    "Zigzag está quieto: ZIG-I1 sin cambios hace 8 días.",
    "1 decisión te espera: Decisión de ejemplo.",
    "Salieron 117 cosas esta semana, 6 % más que la anterior.",
  ]);
  assert.deepEqual(signals.buildBrief({ queue: [], finished: 0, previous: 0 }), ["Nada te espera hoy."]);
});

test("wake info names the missing variable and never reads its value", () => {
  const cli = { adapter: "claude_code", adapter_config: { command_env: "FAKE_BIN" }, wake_url: null };
  assert.deepEqual(signals.wakeInfo(cli, {}), { can_wake: false, wake_reason: "Falta FAKE_BIN en .env" });
  assert.deepEqual(signals.wakeInfo(cli, { FAKE_BIN: "/bin/true" }), { can_wake: true, wake_reason: null });
  assert.equal(signals.wakeInfo({ adapter: "http", adapter_config: {}, wake_url: null }, {}).can_wake, false);
  assert.equal(signals.wakeInfo({ adapter: "http", adapter_config: {}, wake_url: "https://example.com/wake" }, {}).can_wake, true);
  assert.deepEqual(signals.wakeInfo({ adapter: "none", adapter_config: {}, wake_url: null }, {}), { can_wake: false, wake_reason: "Se despierta a mano" });
});

let readyKey = "";

before(async () => {
  raw = await resetTestDb();
  const opened = makeDb();
  closeDb = opened.close;
  await seedOrg(opened.db);
  const company = await setGoal(opened.db, { title: "Rumbo de prueba", why: "ejemplo" }, webCtx);
  const goal = await setGoal(opened.db, { project: "zigzag", parent_id: company.id, title: "Meta de prueba", why: "ejemplo" }, webCtx);
  const init = await writes.createTask(
    opened.db,
    { project: "zigzag", kind: "initiative", title: "Iniciativa quieta", scope: "PRD", goal_id: goal.id },
    ctx,
  );
  const ready = await writes.createTask(
    opened.db,
    { project: "zigzag", parent_key: init.key, title: "Ticket listo", scope: "alcance", checks: ["hecho"], status: "Ready" },
    ctx,
  );
  readyKey = ready.key;
  await raw.query(`update tasks set status_changed_at = now() - interval '10 days', created_at = now() - interval '10 days' where key = $1`, [ready.key]);
  const review = await writes.createTask(opened.db, { project: "micasa", title: "En revisión de prueba", scope: "alcance", checks: ["hecho"] }, ctx);
  await raw.query(`update tasks set status = 'In review', status_changed_at = now() - interval '2 days' where key = $1`, [review.key]);
  clearProgressCache();
});

after(async () => {
  await closeDb?.();
  await raw?.end();
});

const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
  const res = await app.request(path, {
    method,
    headers: { Cookie: cookie, ...(body ? { "Content-Type": "application/json" } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: (await res.json()) as Json };
};

test("the read carries the brief, the queue, goal health, the trend and wake info", async () => {
  const res = await call("GET", "/api/dashboard");
  assert.equal(res.status, 200);
  const data = res.body;
  assert.ok(Array.isArray(data.brief) && data.brief.length >= 1 && data.brief.length <= 4);
  const kinds = data.queue.map((row: Json) => row.kind);
  assert.ok(kinds.includes("merge"));
  assert.ok(kinds.includes("atorado"));
  const goal = data.goals.find((row: Json) => row.title === "Meta de prueba");
  assert.equal(goal.health, "stop");
  assert.equal(goal.initiatives.length, 1);
  assert.equal(data.trend.weeks.length, 6);
  assert.equal(data.trend.target, 140);
  assert.equal(data.trend.in_review, 1);
  const code = data.team.agents.find((row: Json) => row.slug === "claude-code");
  assert.equal(typeof code.can_wake, "boolean");
  assert.ok("wake_reason" in code && "ready" in code);
  const ready = data.ready_tickets.find((row: Json) => row.key === readyKey);
  assert.equal(ready.owner_agent, null);
  assert.ok(ready.parent_key);
  // PLA-I24 fields stay.
  assert.ok(data.shipped && data.waits && data.usage);
});

test("wake: cookie only, unknown agent 404, no adapter answers why and records no run", async () => {
  assert.equal((await call("POST", "/api/dashboard/wake", { agent: "claude-code" }, { Authorization: `Bearer ${TEST_BEARER}` })).status, 401);
  assert.equal((await call("POST", "/api/dashboard/wake", { agent: "nadie" })).status, 404);
  const before = Number((await raw.query("select count(*) from heartbeat_runs")).rows[0].count);
  const res = await call("POST", "/api/dashboard/wake", { agent: "artist" });
  assert.equal(res.status, 200);
  assert.equal(res.body.woke, false);
  assert.equal(res.body.reason, "no_adapter");
  const afterCount = Number((await raw.query("select count(*) from heartbeat_runs")).rows[0].count);
  assert.equal(afterCount, before);
});

test("assign: cookie only, moves owner_agent, unknown agent 404", async () => {
  assert.equal(
    (await call("POST", "/api/dashboard/assign", { project: "zigzag", key: readyKey, to_agent: "taller" }, { Authorization: `Bearer ${TEST_BEARER}` })).status,
    401,
  );
  assert.equal((await call("POST", "/api/dashboard/assign", { project: "zigzag", key: readyKey, to_agent: "nadie" })).status, 404);
  const res = await call("POST", "/api/dashboard/assign", { project: "zigzag", key: readyKey, to_agent: "taller" });
  assert.equal(res.status, 200);
  assert.equal(res.body.owner_agent, "taller");
  const read = await call("GET", "/api/dashboard");
  assert.equal(read.body.team.agents.find((row: Json) => row.slug === "taller").ready, 1);
});
