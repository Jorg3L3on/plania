// PLA-I24-1: GET /dashboard composes the week, the roster, goals and what waits on the CEO.
// An agent token is 401. Titles here are fixtures. The human row is the CEO role, never a person.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type pg from "pg";
import { TEST_BEARER, resetTestDb, useTestEnv } from "./helpers.js";

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
const { seedOrg } = await import("../scripts/seed-org.js");
const writes = await import("../src/mcp/writes.js");

type Json = Record<string, any>;
let raw: pg.Client;
let closeDb: () => Promise<void>;
const cookie = `${SESSION_COOKIE}=${createSession()}`;
const ctx = { actor: { agent: "test-agent", session_id: "s-dash" } };

const get = async (path: string, headers: Record<string, string> = {}) => {
  const res = await app.request(path, { headers: { Cookie: cookie, ...headers } });
  const body = (await res.json()) as Json;
  return { status: res.status, body };
};

before(async () => {
  raw = await resetTestDb();
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
  const filmia = (await raw.query("select id from projects where slug = 'filmia'")).rows[0].id as string;
  const at = `${week.from}T18:00:00Z`;
  await raw.query(
    `insert into tasks (project_id, kind, key, title, summary, status, work_type, resolved_at) values
     ($1, 'ticket', 'FIL-SHIP', 'Ficha de ejemplo', 'Quedó una sola ficha.', 'Done', 'code', $2),
     ($1, 'ticket', 'FIL-NOISE', '[PRUEBA] no sale', '', 'Done', 'code', $2),
     ($1, 'ticket', 'FIL-SKIP', 'Descartado de ejemplo', '', 'Won''t do', 'code', $2)`,
    [filmia, at],
  );
  await raw.query(
    `insert into pull_requests (project_id, repo, number, url, title, state, merged_at)
     values ($1, 'example/filmia', 44, 'https://example.com/pull/44', 'Ficha de ejemplo', 'merged', $2)`,
    [filmia, at],
  );
  const older = `${addDays(week.from, -7)}T18:00:00Z`;
  await raw.query(
    `insert into token_usage (project_id, agent, task_key, run_id, model, input, output, at) values
     ($1, 'cursor', 'FIL-SHIP', 'dash-week', 'fake-model', 120, 30, $2),
     ($1, 'cursor', 'FIL-SHIP', 'dash-old', 'fake-model', 9, 1, $3)`,
    [filmia, at, older],
  );

  const held = await writes.createTask(
    opened.db,
    { project: "micasa", key: "MIC-HOLD", title: "Turno quieto", scope: "pantalla", checks: ["listo"], owner_agent: "cursor" },
    ctx,
  );
  await raw.query(
    `update tasks set owner = $1::jsonb, claimed_at = now() - interval '3 hours', lease_until = now() + interval '1 hour', status = 'In progress' where key = $2`,
    [JSON.stringify({ agent: "Cursor", session_id: "s-cursor" }), held.key],
  );
  await raw.query(`update agents set last_check_in_at = now() - interval '3 hours' where slug = 'cursor'`);
  await raw.query(`update agents set last_check_in_at = now() where slug = 'housi'`);

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
  await raw?.end();
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
  const sqlWeek = await raw.query<{ week: string }>(`select to_char($1::date, 'IYYY-"W"IW') as week`, [body.today]);
  assert.equal(weekId, sqlWeek.rows[0]!.week);
  assert.equal(body.usage.label, "reportado");
  assert.equal(body.usage.week, weekId);
  assert.equal(body.usage.input, 120);
  assert.equal(body.usage.output, 30);
  assert.equal("usd" in body.usage, false);
  assert.equal(body.team.total, 14);
  assert.equal(body.team.alive, 1);
  assert.equal(body.team.stuck, 1);
  assert.equal(body.team.idle, 12);
  const cursor = body.team.agents.find((agent: Json) => agent.slug === "cursor");
  assert.equal(cursor.status, "stuck");
  assert.equal(cursor.claim.key, "MIC-HOLD");
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
  assert.equal(body.stuck[0].agent, "cursor");
  assert.equal(body.stuck[0].name, "Cursor");

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
