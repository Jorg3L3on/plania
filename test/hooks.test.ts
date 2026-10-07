// Inbound hooks (CI results, deploys) and the three token scopes.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type pg from "pg";
import { TEST_BEARER, TEST_CI_TOKEN, TEST_READ_TOKEN, resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const { app } = await import("../src/app.js");
const { makeDb } = await import("../src/db/client.js");
const { createTask, claim } = await import("../src/mcp/writes.js");

let raw: pg.Client;
type Json = Record<string, any>;

const post = (path: string, token: string | undefined, body: unknown) =>
  app.request(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

before(async () => {
  raw = await resetTestDb();
  const { db, close } = makeDb();
  try {
    const ctx = { actor: { agent: "t", session_id: "s1" } };
    await createTask(db, { project: "filmia", key: "FIL-H-01", scope: "s", checks: ["c"], title: "hooked" }, ctx);
    await claim(db, { project: "filmia", key: "FIL-H-01" }, ctx);
  } finally {
    await close();
  }
});

after(async () => {
  await raw?.end();
});

describe("token scopes", () => {
  const list = { jsonrpc: "2.0", id: 1, method: "tools/list" };

  test("the read token sees only read tools; the CI token cannot use /mcp", async () => {
    const ro = (await (await post("/mcp", TEST_READ_TOKEN, list)).json()) as Json;
    const names: string[] = ro.result.tools.map((t: Json) => t.name);
    assert.ok(names.includes("get_task") && names.includes("list_events"));
    assert.ok(!names.some((n) => ["set_task", "claim", "create_task", "add_result"].includes(n)));
    const rw = (await (await post("/mcp", TEST_BEARER, list)).json()) as Json;
    assert.ok(rw.result.tools.length > names.length);
    assert.equal((await post("/mcp", TEST_CI_TOKEN, list)).status, 401);
  });

  test("a write through the read token is refused", async () => {
    const call = {
      jsonrpc: "2.0", id: 2, method: "tools/call",
      params: { name: "set_task", arguments: { project: "filmia", key: "FIL-H-01", note: "x", actor: { agent: "a", session_id: "b" } } },
    };
    const r = (await (await post("/mcp", TEST_READ_TOKEN, call)).json()) as Json;
    assert.ok(r.error || r.result?.isError, "set_task is not available read-only");
  });

  test("hooks take the CI token only", async () => {
    for (const token of [undefined, TEST_BEARER, TEST_READ_TOKEN]) {
      assert.equal((await post("/hooks/result", token, {})).status, 401);
    }
  });
});

describe("POST /hooks/result", () => {
  const body = {
    project: "filmia", key: "FIL-H-01", verdict: "pass", cite: "CI green: 202 tests",
    url: "https://github.com/Jorg3L3on/filmia/actions/runs/1", pr_url: "https://github.com/Jorg3L3on/filmia/pull/130",
    branch: "jl/hooks", request_id: "gh-1-1",
  };

  test("records a ci result and the PR, as the ci actor", async () => {
    const res = await post("/hooks/result", TEST_CI_TOKEN, body);
    assert.equal(res.status, 200);
    const out = (await res.json()) as Json;
    assert.equal(out.result.kind, "ci");
    assert.equal(out.result.actor.agent, "ci");
    assert.equal(out.task.pr_url, body.pr_url);
    assert.equal(out.task.branch, "jl/hooks");
    assert.equal(out.task.claim.owner.session_id, "s1", "the lease is untouched");
  });

  test("a redelivery with the same request_id is a no-op", async () => {
    const res = await post("/hooks/result", TEST_CI_TOKEN, body);
    assert.equal(res.status, 200);
    const { rows } = await raw.query("select count(*)::int as n from results");
    assert.equal(rows[0].n, 1);
  });

  test("errors carry real HTTP status codes", async () => {
    const missing = await post("/hooks/result", TEST_CI_TOKEN, { ...body, request_id: undefined });
    assert.equal(missing.status, 400);
    assert.deepEqual(await missing.json(), { error: "INVALID_INPUT", field: "request_id" });
    assert.equal((await post("/hooks/result", TEST_CI_TOKEN, "not json")).status, 400);
    const unknown = await post("/hooks/result", TEST_CI_TOKEN, { ...body, key: "NOPE", request_id: "gh-2-1" });
    assert.equal(unknown.status, 404);
    assert.equal(((await unknown.json()) as Json).error, "TASK_NOT_FOUND");
  });
});

describe("POST /hooks/env", () => {
  test("records what prod runs", async () => {
    const res = await post("/hooks/env", TEST_CI_TOKEN, {
      project: "filmia", env: "prod", commit: "ab8f69c", branch: "main", migrations_applied: 8, deployed: true, request_id: "deploy-1",
    });
    assert.equal(res.status, 200);
    const { env } = (await res.json()) as Json;
    assert.equal(env.migrations_applied, 8);
    assert.equal(env.by.agent, "ci");
    const bad = await post("/hooks/env", TEST_CI_TOKEN, { project: "filmia", env: "prod", migrations_applied: "8", request_id: "d2" });
    assert.equal(bad.status, 400);
  });
});

describe("GET /api/export/:slug.json", () => {
  const get = (path: string, token?: string) =>
    app.request(path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });

  test("a token of scope rw or ro downloads the whole project; ci and nobody may not", async () => {
    const res = await get("/api/export/filmia.json", TEST_READ_TOKEN);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-disposition") ?? "", /attachment; filename="plania-filmia-\d{4}-\d{2}-\d{2}\.json"/);
    const data = (await res.json()) as Json;
    assert.equal(data.format, "plania-export");
    assert.equal(data.project.slug, "filmia");
    assert.deepEqual(data.tasks.map((t: Json) => t.key), ["FIL-H-01"]);
    assert.equal(data.tasks[0].results.length, 1);
    assert.equal(data.env.prod.migrations_applied, 8);
    assert.ok(data.events.length >= 4);
    assert.equal((await get("/api/export/filmia.json", TEST_BEARER)).status, 200);
    assert.equal((await get("/api/export/filmia.json", TEST_CI_TOKEN)).status, 401);
    assert.equal((await get("/api/export/filmia.json")).status, 401);
    assert.equal((await get("/api/export/nope.json", TEST_BEARER)).status, 404);
  });
});
