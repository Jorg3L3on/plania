// PLA-I22-3: the goals screen API. The cookie, the tree, a project filter, and an edit.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const { app } = await import("../src/app.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const { makeDb } = await import("../src/db/client.js");
const writes = await import("../src/mcp/writes.js");
const { hashPassword } = await import("../src/auth/password.js");

const ctx = { actor: { agent: "test-agent", session_id: "s-goals-api" } };
type Json = Record<string, any>;

let raw: pg.Client;
let cookie: string;

function req(method: string, path: string, opts: { body?: unknown; cookie?: string | null } = {}) {
  const headers: Record<string, string> = {};
  const sent = opts.cookie === undefined ? cookie : opts.cookie;
  if (sent) headers.Cookie = sent;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  return app.request(path, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
}

before(async () => {
  process.env.PLANIA_PASSWORD_HASH = await hashPassword("test-password-123");
  raw = await resetTestDb();
  cookie = `${SESSION_COOKIE}=${createSession()}`;
});

after(async () => {
  await raw?.end();
});

describe("goals API", () => {
  test("the list needs the cookie and starts empty", async () => {
    assert.equal((await req("GET", "/api/goals", { cookie: null })).status, 401);
    const list = (await (await req("GET", "/api/goals")).json()) as Json;
    assert.deepEqual(list.goals, []);
    const dated = await req("POST", "/api/goals", { body: { title: "Fecha mala", target_on: "2026-02-31" } });
    assert.equal(dated.status, 400);
    assert.equal(((await dated.json()) as Json).error, "INVALID_GOAL");
    const missing = await req("GET", "/api/goals?project=no-esta");
    assert.equal(missing.status, 404);
    assert.equal(((await missing.json()) as Json).error, "PROJECT_NOT_FOUND");
  });

  test("a company goal rolls up its project goal, and the screen can edit the title", async () => {
    const companyRes = await req("POST", "/api/goals", { body: { title: "Una dirección", why: "para que todo empuje igual" } });
    assert.equal(companyRes.status, 201);
    const company = (await companyRes.json()) as Json;
    assert.equal(company.project, null);
    assert.deepEqual(company.progress, { done: 0, total: 0 });

    const childRes = await req("POST", "/api/goals", {
      body: { project: "workia", parent_id: company.id, title: "Cobros claros", why: "el cliente entiende qué paga", target_on: "2026-12-01" },
    });
    assert.equal(childRes.status, 201);
    const child = (await childRes.json()) as Json;
    assert.equal(child.project, "workia");
    assert.equal(child.parent_id, company.id);

    const nested = await req("POST", "/api/goals", { body: { title: "Otra raíz", parent_id: company.id } });
    assert.equal(nested.status, 400);
    assert.equal(((await nested.json()) as Json).error, "INVALID_GOAL");

    const { db, close } = makeDb();
    try {
      const init = await writes.createTask(db, { project: "workia", kind: "initiative", title: "Cobros", scope: "PRD", goal_id: child.id }, ctx);
      const ticket = await writes.createTask(
        db,
        { project: "workia", title: "Uno", scope: "alcance", work_type: "decision-needed", parent_key: init.key, status: "Backlog" },
        ctx,
      );
      const done = await writes.setTask(db, { project: "workia", key: ticket.key, status: "Done", version: ticket.version }, ctx);
      assert.equal(done.status, "Done");
    } finally {
      await close();
    }

    const tree = (await (await req("GET", "/api/goals")).json()) as Json;
    const root = tree.goals.find((goal: Json) => goal.id === company.id);
    assert.equal(root.children.length, 1);
    assert.deepEqual(root.progress, { done: 1, total: 1 });
    assert.deepEqual(root.children[0].progress, { done: 1, total: 1 });

    const only = (await (await req("GET", "/api/goals?project=workia")).json()) as Json;
    assert.deepEqual(only.goals.map((goal: Json) => goal.id), [child.id]);
    assert.deepEqual(only.goals[0].children, []);

    const patched = await req("PATCH", `/api/goals/${child.id}`, { body: { title: "Cobros al día", status: "done" } });
    assert.equal(patched.status, 200);
    const updated = (await patched.json()) as Json;
    assert.equal(updated.title, "Cobros al día");
    assert.equal(updated.status, "done");
    assert.equal(updated.why, "el cliente entiende qué paga");

    const unknown = await req("PATCH", "/api/goals/00000000-0000-4000-8000-000000000099", { body: { title: "Nada" } });
    assert.equal(unknown.status, 404);
    assert.equal(((await unknown.json()) as Json).error, "GOAL_NOT_FOUND");
  });
});
