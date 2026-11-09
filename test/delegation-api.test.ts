// PLA-I23-3: the screen reads comments and routine runs. A Bearer does not open them.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type pg from "pg";
import { TEST_BEARER, resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const { app } = await import("../src/app.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const { makeDb } = await import("../src/db/client.js");
const { seedLegacyOrg: seedOrg } = await import("./fixtures/legacy-org.js");
const { comment, recordRoutineRun } = await import("../src/mcp/delegation.js");
const writes = await import("../src/mcp/writes.js");

let raw: pg.Client;
let closeDb: () => Promise<void>;
const cookie = () => `${SESSION_COOKIE}=${createSession()}`;
const ctx = { actor: { agent: "test-agent", session_id: "s-i23-3" } };

function req(path: string, headers: Record<string, string> = {}) {
  return app.request(path, { method: "GET", headers });
}

before(async () => {
  raw = await resetTestDb();
  const opened = makeDb();
  closeDb = opened.close;
  await seedOrg(opened.db);
  const created = await writes.createTask(
    opened.db,
    { project: "micasa", key: "MIC-I23-1", title: "Hilo", scope: "pantalla", checks: ["c"] },
    ctx,
  );
  await comment(opened.db, { project: "micasa", key: created.key, body: "primera nota" }, ctx);
  await comment(opened.db, { project: "micasa", key: created.key, body: "segunda nota" }, ctx);
  await recordRoutineRun(opened.db, {
    agent: "ceo",
    routine: "morning-brief",
    started_at: "2026-11-01T08:00:00.000Z",
    status: "ok",
    summary: "uno",
  });
  await recordRoutineRun(opened.db, {
    agent: "ceo",
    routine: "hourly-triage",
    started_at: "2026-11-03T08:00:00.000Z",
    status: "fail",
    summary: "tres",
  });
});

after(async () => {
  await closeDb?.();
  await raw?.end();
});

test("comments and routines need the session cookie", async () => {
  const missing = await req("/api/delegation/comments?project=micasa&key=MIC-I23-1");
  assert.equal(missing.status, 401);
  const bearer = await req("/api/delegation/routines", { Authorization: `Bearer ${TEST_BEARER}` });
  assert.equal(bearer.status, 401);
});

test("the thread is oldest first and routines are newest first", async () => {
  const headers = { Cookie: cookie() };
  const comments = await req("/api/delegation/comments?project=micasa&key=MIC-I23-1", headers);
  assert.equal(comments.status, 200);
  const thread = (await comments.json()) as { comments: { body: string; author_agent: string }[] };
  assert.deepEqual(
    thread.comments.map((row) => row.body),
    ["primera nota", "segunda nota"],
  );
  assert.equal(thread.comments[0]!.author_agent, "test-agent");

  const routines = await req("/api/delegation/routines?agent=ceo", headers);
  assert.equal(routines.status, 200);
  const body = (await routines.json()) as { runs: { summary: string; status: string }[] };
  assert.deepEqual(
    body.runs.map((run) => [run.summary, run.status]),
    [
      ["tres", "fail"],
      ["uno", "ok"],
    ],
  );
  const text = JSON.stringify(body);
  assert.equal(text.includes("@"), false);
});
