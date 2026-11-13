// PLA-I24-1: GET /dashboard composes the week, the roster, goals and what waits on the CEO.
// An agent token is 401. Titles here are fixtures. The human row is the CEO role, never a person.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { TEST_BEARER, resetTestStore, useTestEnv, type TestStore } from "./helpers.js";

useTestEnv();
process.env.PLANIA_TZ = "America/Mexico_City";

const { app } = await import("../src/app.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const { makeDb } = await import("../src/db/client.js");
const { addDays, clearProgressCache, dayInTz, weekRange } = await import("../src/mcp/progress.js");
const { isoWeekKey } = await import("../src/mcp/dashboard.js");
const { ask } = await import("../src/mcp/questions.js");
const { setGoal } = await import("../src/mcp/goals.js");
const { webCtx } = await import("../src/mcp/tx.js");
const { seedLegacyOrg: seedOrg } = await import("./fixtures/legacy-org.js");
const writes = await import("../src/mcp/writes.js");

type Json = Record<string, any>;
let store: TestStore;
let closeDb: () => Promise<void>;
const cookie = `${SESSION_COOKIE}=${createSession()}`;
const ctx = { actor: { agent: "test-agent", session_id: "s-dash" } };

// The ISO week of a calendar date as Postgres's to_char(date, 'IYYY-"W"IW') writes it: the week of its Thursday.
function isoWeekOf(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  const thursday = new Date(d.getTime() + (3 - ((d.getUTCDay() + 6) % 7)) * 86_400_000);
  const year = thursday.getUTCFullYear();
  const week = 1 + Math.floor((thursday.getTime() - Date.UTC(year, 0, 1)) / (7 * 86_400_000));
  return `${year}-W${String(week).padStart(2, "0")}`;
}

const get = async (path: string, headers: Record<string, string> = {}) => {
  const res = await app.request(path, { headers: { Cookie: cookie, ...headers } });
  const body = (await res.json()) as Json;
  return { status: res.status, body };
};

before(async () => {
  store = await resetTestStore();
  const opened = makeDb();
  closeDb = opened.close;
  await seedOrg(opened.db);

  const company = await setGoal(opened.db, { title: "Rumbo de ejemplo", why: "una dirección de prueba" }, webCtx);
  const project = await setGoal(
    opened.db,
    { project: "filmia", parent_id: company.id, title: "Catálogo limpio", why: "sin fichas repetidas" },
    webCtx,
  );
  const initiative = await writes.createTask(
    opened.db,
    { project: "filmia", kind: "initiative", title: "Catálogo de ejemplo", scope: "PRD", goal_id: project.id },
    ctx,
  );
  const done = await writes.createTask(
    opened.db,
    {
      project: "filmia",
      title: "Ficha única",
      scope: "alcance",
      work_type: "decision-needed",
      parent_key: initiative.key,
      status: "Backlog",
    },
    ctx,
  );
  await writes.setTask(opened.db, { project: "filmia", key: done.key, status: "Done", version: done.version }, ctx);
  await writes.createTask(
    opened.db,
    {
      project: "filmia",
      title: "Ficha todavía abierta",
      scope: "alcance",
      work_type: "decision-needed",
      parent_key: initiative.key,
      status: "Backlog",
    },
    ctx,
  );

  const today = dayInTz(new Date());
  const week = weekRange(today);
  const filmia = await store.projectId("filmia");
  const at = `${week.from}T18:00:00Z`;
  const older = `${addDays(week.from, -7)}T18:00:00Z`;
  await store.fix(async (uow) => {
    const ticket = (key: string, title: string, summary: string, status: string) =>
      uow.insert("tasks", { projectId: filmia, kind: "ticket", key, title, summary, status, workType: "code", resolvedAt: new Date(at) });
    await ticket("FIL-SHIP", "Ficha de ejemplo", "Quedó una sola ficha.", "Done");
    await ticket("FIL-NOISE", "[PRUEBA] no sale", "", "Done");
    await ticket("FIL-SKIP", "Descartado de ejemplo", "", "Won't do");
    await uow.insert("pullRequests", { projectId: filmia, repo: "example/filmia", number: 44, url: "https://example.com/pull/44", title: "Ficha de ejemplo", state: "merged", mergedAt: new Date(at) });
    await uow.insert("tokenUsage", { projectId: filmia, agent: "taller", taskKey: "FIL-SHIP", runId: "dash-week", model: "fake-model", input: 120, output: 30, at: new Date(at) });
    await uow.insert("tokenUsage", { projectId: filmia, agent: "taller", taskKey: "FIL-SHIP", runId: "dash-old", model: "fake-model", input: 9, output: 1, at: new Date(older) });
  });

  const held = await writes.createTask(
    opened.db,
    { project: "micasa", key: "MIC-HOLD", title: "Turno quieto", scope: "pantalla", checks: ["listo"], owner_agent: "taller" },
    ctx,
  );
  await store.fix(async (uow) => {
    const now = Date.now();
    await uow.update("tasks", { key: held.key }, {
      owner: { agent: "Taller", session_id: "s-taller" },
      claimedAt: new Date(now - 3 * 3_600_000),
      leaseUntil: new Date(now + 3_600_000),
      status: "In progress",
    });
    await uow.update("agents", { slug: "taller" }, { lastCheckInAt: new Date(now - 3 * 3_600_000) });
    await uow.update("agents", { slug: "housi" }, { lastCheckInAt: new Date(now) });
  });

  const question = await writes.createTask(
    opened.db,
    { project: "micasa", title: "Pregunta de ejemplo", scope: "una duda", work_type: "decision-needed" },
    ctx,
  );
  await ask(opened.db, { project: "micasa", key: question.key, question: "¿Seguimos con el ejemplo?" }, ctx);
  clearProgressCache();
});

after(async () => {
  await closeDb?.();
  await store?.end();
});

test("an agent token is 401 with or without the screen cookie", async () => {
  const both = await get("/api/dashboard", { Authorization: `Bearer ${TEST_BEARER}` });
  assert.equal(both.status, 401);
  assert.deepEqual(both.body, { error: "UNAUTHORIZED" });
  const bearer = await app.request("/api/dashboard", { headers: { Authorization: `Bearer ${TEST_BEARER}` } });
  assert.equal(bearer.status, 401);
  assert.deepEqual(await bearer.json(), { error: "UNAUTHORIZED" });
  const none = await app.request("/api/dashboard");
  assert.equal(none.status, 401);
});

test("the cookie read is the week, the roster, goals, stuck work and what waits on the CEO", async () => {
  const res = await get("/api/dashboard");
  assert.equal(res.status, 200);
  const body = res.body;
  assert.equal(body.role, "CEO");
  assert.equal(body.name, "Jorge");
  const weekId = isoWeekKey(body.today);
  assert.equal(weekId, isoWeekOf(body.today));
  assert.equal(body.usage.label, "reportado");
  assert.equal(body.usage.week, weekId);
  assert.equal(body.usage.input, 120);
  assert.equal(body.usage.output, 30);
  assert.equal("usd" in body.usage, false);
  assert.equal(body.team.total, 11);
  assert.equal(body.team.alive, 1);
  assert.equal(body.team.stuck, 1);
  assert.equal(body.team.idle, 9);
  const taller = body.team.agents.find((agent: Json) => agent.slug === "taller");
  assert.equal(taller.status, "stuck");
  assert.equal(taller.claim.key, "MIC-HOLD");
  assert.equal(body.team.agents.find((agent: Json) => agent.slug === "ceo").name, "CEO");

  const catalog = body.goals.find((goal: Json) => goal.title === "Catálogo limpio");
  assert.equal(catalog.project, "filmia");
  assert.deepEqual(catalog.progress, { done: 1, total: 2 });
  const company = body.goals.find((goal: Json) => goal.title === "Rumbo de ejemplo");
  assert.equal(company.project, null);
  assert.deepEqual(company.progress, { done: 1, total: 2 });

  assert.equal(body.shipped.buckets.length, 7);
  assert.equal(body.shipped.finished, 2);
  assert.equal(body.shipped.prs, 1);
  assert.equal(
    body.shipped.buckets.reduce((sum: number, bucket: Json) => sum + bucket.total, 0),
    2,
  );
  const winKeys = body.shipped.wins.map((win: Json) => win.key);
  assert.equal(winKeys.includes("FIL-SHIP"), true);
  assert.equal(winKeys.includes("FIL-NOISE"), false);
  assert.equal(winKeys.includes("FIL-SKIP"), false);

  assert.deepEqual(body.stuck.map((item: Json) => item.key), ["MIC-HOLD"]);
  assert.equal(body.stuck[0].agent, "taller");
  assert.equal(body.stuck[0].name, "Taller");

  assert.equal(body.waits.length, 1);
  assert.equal(body.waits[0].group, "decisiones");
  assert.equal(body.waits[0].why, "¿Seguimos con el ejemplo?");
  assert.equal(body.waits.every((item: Json) => item.group !== "limpieza"), true);

  const text = JSON.stringify(body);
  assert.equal(text.includes("wake_url"), false);
  assert.equal(text.includes("budget"), false);
  assert.equal(text.includes("approval"), false);
  assert.equal(text.includes("\"cost\""), false);
  assert.equal(text.includes("token"), false);
});

test("PLANIA_CEO_NAME sets the greeting and a blank value stays Jorge", async () => {
  const previous = process.env.PLANIA_CEO_NAME;
  try {
    process.env.PLANIA_CEO_NAME = "  Demo  ";
    const named = await get("/api/dashboard");
    assert.equal(named.status, 200);
    assert.equal(named.body.name, "Demo");
    assert.equal(named.body.role, "CEO");
    process.env.PLANIA_CEO_NAME = " \n ";
    const blank = await get("/api/dashboard");
    assert.equal(blank.body.name, "Jorge");
  } finally {
    if (previous === undefined) delete process.env.PLANIA_CEO_NAME;
    else process.env.PLANIA_CEO_NAME = previous;
  }
});
