// PLA-I21-3: /api/team is the session screen. A Bearer does not open it. Owned tasks are the open ones.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type pg from "pg";
import { TEST_BEARER, resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const { app } = await import("../src/app.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const { makeDb } = await import("../src/db/client.js");
const { seedLegacyOrg: seedOrg } = await import("./fixtures/legacy-org.js");
const writes = await import("../src/mcp/writes.js");

let raw: pg.Client;
let closeDb: () => Promise<void>;
const cookie = () => `${SESSION_COOKIE}=${createSession()}`;
const ctx = { actor: { agent: "test-agent", session_id: "s1" } };

function req(path: string, headers: Record<string, string> = {}) {
  return app.request(path, { method: "GET", headers });
}

before(async () => {
  raw = await resetTestDb();
  const opened = makeDb();
  closeDb = opened.close;
  await seedOrg(opened.db);
  await writes.createTask(opened.db, { project: "micasa", key: "MIC-EQ-1", title: "Tarea abierta", scope: "pantalla", checks: ["c"], owner_agent: "housi" }, ctx);
  await writes.createTask(opened.db, { project: "micasa", key: "MIC-EQ-2", title: "Tarea cerrada", scope: "pantalla", checks: ["c"], owner_agent: "housi" }, ctx);
  await raw.query(`update tasks set status = 'Done' where key = 'MIC-EQ-2'`);
});

after(async () => {
  await closeDb?.();
  await raw?.end();
});

test("GET /api/team needs the session cookie", async () => {
  const missing = await req("/api/team");
  assert.equal(missing.status, 401);
  assert.deepEqual(await missing.json(), { error: "UNAUTHORIZED" });
  const bearer = await req("/api/team", { Authorization: `Bearer ${TEST_BEARER}` });
  assert.equal(bearer.status, 401);
});

test("GET /api/team returns the org and only open owned tasks", async () => {
  const res = await req("/api/team", { Cookie: cookie() });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { agents: Record<string, unknown>[] };
  const bySlug = Object.fromEntries(body.agents.map((agent) => [agent.slug, agent]));
  assert.equal(body.agents.length, 11);
  assert.equal(bySlug.ceo!.name, "CEO");
  assert.equal(bySlug.ceo!.reports_to, null);
  assert.equal(bySlug.asistente!.reports_to, "ceo");
  assert.equal(bySlug.artist!.reports_to, "asistente");
  assert.equal(bySlug.housi!.reports_to, "ceo");
  assert.equal(bySlug.taller!.reports_to, "ceo");
  assert.equal(bySlug.research!.reports_to, "asistente");
  assert.equal(bySlug["owner-plania"]!.name, "Plania");
  assert.deepEqual(bySlug.housi!.tasks, [{ project: "micasa", key: "MIC-EQ-1", title: "Tarea abierta", status: "Backlog" }]);
  assert.deepEqual(bySlug.research!.tasks, []);
  const text = JSON.stringify(body);
  assert.equal(text.includes("wake_url"), false);
  assert.equal(text.includes("token"), false);
  assert.equal(text.includes("@"), false);
});
