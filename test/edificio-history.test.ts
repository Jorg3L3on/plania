// PLA-I39-2: GET /api/company/history. Runs clipped to the window, events oldest first with the role that did
// them, and the cookie guard. Throwaway DB, fake values only.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type pg from "pg";
import { TEST_BEARER, resetTestDb, useOwnerCode, useTestEnv } from "./helpers.js";

useTestEnv();
await useOwnerCode();
process.env.PLANIA_HOME_PROJECT = "zigzag";
process.env.PLANIA_PROMPTS_PROJECT = "micasa";
const { makeDb } = await import("../src/db/client.js");
const { app } = await import("../src/app.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const { seedOrg } = await import("../scripts/seed-org.js");
const writes = await import("../src/mcp/writes.js");
const questions = await import("../src/mcp/questions.js");
const { companyHistory } = await import("../src/api/company-history.js");

type Json = Record<string, any>;
let raw: pg.Client;
let db: ReturnType<typeof makeDb>["db"];
let closeDb: () => Promise<void>;
const jorge = () => ({ Cookie: `${SESSION_COOKIE}=${createSession()}` });
const id = async (table: string, slug: string) => (await raw.query(`select id from ${table} where slug = $1`, [slug])).rows[0].id as string;
const as = (agent: string) => ({ actor: { agent, session_id: `s-${agent}` } });
const NOW = new Date("2026-11-10T20:00:00Z");
const ago = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

before(async () => {
  raw = await resetTestDb();
  ({ db, close: closeDb } = makeDb());
  await seedOrg(db);
});

after(async () => {
  await closeDb?.();
  await raw?.end();
});

const run = async (agent: string, status: string, startedH: number | null, endedH: number | null, ticket: string | null = null) =>
  raw.query(`insert into agent_runs (agent_id, project_id, role, status, task_key, started_at, ended_at) values ($1, $2, $3, $4, $5, $6, $7)`, [
    await id("agents", agent),
    await id("projects", "filmia"),
    agent.startsWith("po-") ? "product-owner" : agent.split("-")[0],
    status,
    ticket,
    startedH == null ? null : ago(startedH),
    endedH == null ? null : ago(endedH),
  ]);

test("I39-2 #1: runs clipped to the window; a live run has to null; older, queued and skipped runs are absent", async () => {
  const t = (await writes.createTask(db, { project: "filmia", title: "Corte del tráiler", scope: "s", checks: ["c"] } as never, as("po-filmia"))) as { key: string };
  await run("taller-filmia", "ok", 25, 18, t.key); // starts before the window, ends inside
  await run("research-filmia", "fail", 30, 22); // ended before the window
  await run("po-filmia", "running", 1, null); // live
  await run("artist-filmia", "queued", null, null);
  await run("artist-filmia", "skipped", 2, 2);

  const h = await companyHistory(db, 20, NOW);
  assert.equal(h.from, ago(20));
  assert.equal(h.to, NOW.toISOString());
  const runs = h.projects.find((p) => p.slug === "filmia")!.runs;
  assert.deepEqual(
    runs.map((r) => [r.agent, r.status, r.from, r.to, r.ticket, r.title]),
    [
      ["taller-filmia", "ok", ago(20), ago(18), t.key, "Corte del tráiler"],
      ["po-filmia", "running", ago(1), null, null, null],
    ],
  );
});

test("I39-2 #2: deliveries, questions asked and answered, and orders, oldest first, each with its role", async () => {
  const p = await id("projects", "workia");
  const { projectThread } = await import("../src/runner/threads.js");
  const thread = (await projectThread(db, p)).id;
  await raw.query(`insert into thread_messages (thread_id, author_agent, author_role, body, links, at) values ($1, 'artist-workia', 'artist', 'Listo el boceto', $2, $3)`, [
    thread,
    JSON.stringify([{ kind: "doc", ref: "d-1", title: "Boceto del carrito" }]),
    ago(3),
  ]);
  await raw.query(`insert into thread_messages (thread_id, author_agent, author_role, body, links, at) values ($1, 'po-workia', 'product-owner', 'Sigo con lo mío', '[]', $2)`, [thread, ago(2)]);
  const order = (await writes.createTask(db, { project: "workia", title: "Una tienda de prueba", scope: "s", checks: ["c"] } as never, as("po-workia"))) as { key: string };
  await raw.query(`update tasks set origin = 'jorge', created_at = $2 where project_id = $1 and key = $3`, [p, ago(5), order.key]);
  await questions.ask(db, { project: "workia", key: order.key, question: "¿Qué tienda?", options: ["A", "B"] } as never, as("research-workia"));
  const qid = (await raw.query(`select id from questions where project_id = $1`, [p])).rows[0].id;
  await raw.query(`update questions set asked_at = $2, answered_at = $3, answer = 'A' where id = $1`, [qid, ago(4), ago(1)]);

  const events = (await companyHistory(db, 20, NOW)).projects.find((x) => x.slug === "workia")!.events;
  assert.deepEqual(
    events.map((e) => [e.kind, e.role, e.title, e.at]),
    [
      ["ordered", "jorge", "Una tienda de prueba", ago(5)],
      ["asked", "research", "¿Qué tienda?", ago(4)],
      ["delivered", "artist", "Boceto del carrito", ago(3)],
      ["answered", "jorge", "¿Qué tienda?", ago(1)],
    ],
  );
});

test("I39-2 #3: hours outside 1 to 72 is 400; a Bearer is 403; no cookie is 401", async () => {
  const ok = await app.request("/api/company/history", { headers: jorge() });
  assert.equal(ok.status, 200);
  const body = (await ok.json()) as Json;
  assert.equal(Date.parse(body.to) - Date.parse(body.from), 20 * 3_600_000);
  assert.equal((await app.request("/api/company/history?hours=72", { headers: jorge() })).status, 200);
  for (const bad of ["0", "73", "-1", "abc", "2.5"]) assert.equal((await app.request(`/api/company/history?hours=${bad}`, { headers: jorge() })).status, 400, bad);
  assert.equal((await app.request("/api/company/history", { headers: { ...jorge(), Authorization: `Bearer ${TEST_BEARER}` } })).status, 403);
  assert.equal((await app.request("/api/company/history")).status, 401);
});
