// JSON API for the screen and the live event stream (UI v2, phase 2).
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type pg from "pg";
import { TEST_BEARER, resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const { app } = await import("../src/app.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const { makeDb } = await import("../src/db/client.js");
const writes = await import("../src/mcp/writes.js");
const { hashPassword } = await import("../src/auth/password.js");

let raw: pg.Client;
let cookie: string;
type Json = Record<string, any>;

function req(method: string, path: string, opts: { body?: unknown; cookie?: string | null; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { ...opts.headers };
  const c = opts.cookie === undefined ? cookie : opts.cookie;
  if (c) headers.Cookie = c;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  return app.request(path, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
}

async function row(key: string) {
  const { rows } = await raw.query("select status, priority, blocked_note, resolved_at from tasks where key = $1", [key]);
  return rows[0];
}

before(async () => {
  process.env.PLANIA_PASSWORD_HASH = await hashPassword("test-password-123");
  raw = await resetTestDb();
  cookie = `${SESSION_COOKIE}=${createSession()}`;
  const { db, close } = makeDb();
  try {
    await writes.updateResume(db, "micasa", { in_progress: "ip", next_action: "na", branch_or_prod: "main", must_keep_decision: "" });
    await writes.createInitiative(db, { project: "micasa", key: "MIC-01", title: "Init", body: "PRD", summary: "one line" });
    await writes.createTask(db, { project: "micasa", key: "MIC-01-F1", title: "F1", body: "secret body", parent_key: "MIC-01" });
    await writes.createTask(db, { project: "micasa", key: "MIC-01-F2", title: "F2", body: "", parent_key: "MIC-01", priority: "P0" });
    await writes.createTask(db, { project: "micasa", key: "MIC-B-01", title: "Spec", body: "", status: "Done" });
  } finally {
    await close();
  }
});

after(async () => {
  await raw?.end();
});

describe("session", () => {
  test("every API route but login and logout needs the cookie", async () => {
    for (const [method, path] of [
      ["GET", "/api/session"], ["GET", "/api/projects"], ["GET", "/api/projects/micasa"],
      ["PATCH", "/api/projects/micasa/tasks/MIC-01-F1"], ["GET", "/api/events"], ["GET", "/api/nope"],
    ] as const) {
      const res = await req(method, path, { cookie: null, body: method === "PATCH" ? { status: "Done" } : undefined });
      assert.equal(res.status, 401, `${method} ${path}`);
      assert.deepEqual(await res.json(), { error: "UNAUTHORIZED" });
    }
    assert.equal((await row("MIC-01-F1")).status, "Backlog");
  });

  test("the MCP Bearer does not open the API", async () => {
    const res = await req("GET", "/api/projects", { cookie: null, headers: { Authorization: `Bearer ${TEST_BEARER}` } });
    assert.equal(res.status, 401);
  });

  test("login sets the cookie; a wrong password is 401", async () => {
    const bad = await req("POST", "/api/login", { cookie: null, body: { password: "nope" } });
    assert.equal(bad.status, 401);
    assert.deepEqual(await bad.json(), { error: "INVALID_PASSWORD" });
    const good = await req("POST", "/api/login", { cookie: null, body: { password: "test-password-123" } });
    assert.equal(good.status, 204);
    assert.match(good.headers.get("set-cookie") ?? "", /^plania_session=v1\.\d+\..+HttpOnly; Secure; SameSite=Lax/);
    const formLogin = await app.request("/api/login", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "password=test-password-123",
    });
    assert.equal(formLogin.status, 415, "forms cannot post to the API");
  });

  test("session and logout", async () => {
    assert.equal((await req("GET", "/api/session")).status, 204);
    const out = await req("POST", "/api/logout");
    assert.equal(out.status, 204);
    assert.match(out.headers.get("set-cookie") ?? "", /plania_session=; Max-Age=0/);
  });
});

describe("reads", () => {
  test("GET /api/projects lists projects with their resume card", async () => {
    const list = (await (await req("GET", "/api/projects")).json()) as Json[];
    assert.deepEqual(list.map((p) => p.slug), ["filmia", "micasa", "workia", "zigzag"]);
    const micasa = list.find((p) => p.slug === "micasa")!;
    assert.deepEqual(micasa.resume, {
      project: "micasa", in_progress: "ip", next_action: "na", branch_or_prod: "main", must_keep_decision: "",
    });
    // Each project carries its tasks without bodies, in the same shape as GET /api/projects/:slug.
    const detail = (await (await req("GET", "/api/projects/micasa")).json()) as Json;
    assert.deepEqual(micasa.tasks, detail.tasks);
    assert.ok(!JSON.stringify(list).includes("secret body"));
    assert.ok(!JSON.stringify(list).includes("project_id"));
    assert.deepEqual(list.find((p) => p.slug === "zigzag")!.tasks, []);
  });

  test("GET /api/projects/:slug returns every task without bodies, P0 first", async () => {
    const res = await req("GET", "/api/projects/micasa");
    assert.equal(res.status, 200);
    const p = (await res.json()) as Json;
    assert.equal(p.title, "MiCasa");
    assert.deepEqual(p.tasks.map((t: Json) => t.key), ["MIC-01-F2", "MIC-B-01", "MIC-01-F1", "MIC-01"]);
    const f1 = p.tasks.find((t: Json) => t.key === "MIC-01-F1");
    assert.deepEqual(Object.keys(f1).sort(), [
      "base_branch", "blocked_note", "branch", "key", "kind", "parent_key", "pr_url", "priority", "status", "summary",
      "title", "updated_at",
    ]);
    assert.equal(f1.parent_key, "MIC-01");
    // Branches feed the "Rama y prod" graph: initiatives carry their base branch.
    assert.equal(p.tasks.find((t: Json) => t.key === "MIC-01").base_branch, "main");
    assert.ok(!JSON.stringify(p).includes("secret body"));
  });

  test("GET /api/projects/:slug/tasks/:key returns the get_task shape with the body", async () => {
    const res = await req("GET", "/api/projects/micasa/tasks/MIC-01");
    assert.equal(res.status, 200);
    const t = (await res.json()) as Json;
    assert.equal(t.body, "PRD");
    assert.equal(t.kind, "initiative");
    assert.deepEqual(t.child_keys, ["MIC-01-F1", "MIC-01-F2"]);
    assert.equal(t.base_branch, "main");
    assert.ok(t.updated_at);
    const f1 = (await (await req("GET", "/api/projects/micasa/tasks/MIC-01-F1")).json()) as Json;
    assert.equal(f1.body, "secret body");
    assert.equal(f1.parent_key, "MIC-01");
    const missing = await req("GET", "/api/projects/micasa/tasks/NOPE");
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { error: "TASK_NOT_FOUND" });
    assert.equal((await req("GET", "/api/projects/micasa/tasks/MIC-01", { cookie: null })).status, 401);
  });

  test("unknown project or path is a JSON 404", async () => {
    const res = await req("GET", "/api/projects/nope");
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: "PROJECT_NOT_FOUND" });
    assert.deepEqual(await (await req("GET", "/api/nope")).json(), { error: "NOT_FOUND" });
  });
});

describe("PATCH /api/projects/:slug/tasks/:key", () => {
  const patch = (key: string, body: unknown) => req("PATCH", `/api/projects/micasa/tasks/${key}`, { body });

  test("changes status and priority and returns the get_task shape", async () => {
    const res = await patch("MIC-01-F1", { status: "In progress", priority: "P1" });
    assert.equal(res.status, 200);
    const t = (await res.json()) as Json;
    assert.equal(t.status, "In progress");
    assert.equal(t.priority, "P1");
    assert.equal(t.body, "secret body", "get_task shape includes the body");
    assert.equal((await row("MIC-01-F1")).priority, "P1");
  });

  test("Blocked needs a note; Done stamps resolved_at; initiatives take their own statuses", async () => {
    let res = await patch("MIC-01-F2", { status: "Blocked" });
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: "BLOCKED_REQUIRES_NOTE" });
    res = await patch("MIC-01-F2", { status: "Blocked", note: "waiting on bank" });
    assert.equal(res.status, 200);
    assert.equal((await row("MIC-01-F2")).blocked_note, "waiting on bank");
    res = await patch("MIC-01-F1", { status: "Done" });
    assert.ok((await row("MIC-01-F1")).resolved_at instanceof Date);
    res = await patch("MIC-01", { status: "Shipping" });
    assert.equal(res.status, 200);
    assert.equal((await row("MIC-01")).status, "Shipping");
  });

  test("error codes map to HTTP statuses", async () => {
    const cases: [string, unknown, number, string][] = [
      ["MIC-01-F2", { status: "Planning" }, 400, "INVALID_STATUS"],
      ["MIC-01-F2", { priority: "P9" }, 400, "INVALID_PRIORITY"],
      ["NOPE", { status: "Done" }, 404, "TASK_NOT_FOUND"],
      ["MIC-01-F2", { status: 7 }, 400, "INVALID_BODY"],
    ];
    for (const [key, body, status, error] of cases) {
      const res = await patch(key, body);
      assert.equal(res.status, status, JSON.stringify(body));
      assert.deepEqual(await res.json(), { error });
    }
  });
});

describe("GET /api/events", () => {
  // Reads SSE frames until one with the given event name arrives.
  async function nextEvent(reader: ReadableStreamDefaultReader<Uint8Array>, name: string): Promise<Json> {
    const decoder = new TextDecoder();
    let buffer = "";
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const event = /^event: (.+)$/m.exec(frame)?.[1];
        const data = /^data: (.*)$/m.exec(frame)?.[1];
        if (event === name) return JSON.parse(data ?? "{}");
      }
    }
    throw new Error(`no ${name} event`);
  }

  test("streams a change when an agent writes over MCP and when the screen writes", async () => {
    const res = await req("GET", "/api/events");
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /text\/event-stream/);
    const reader = res.body!.getReader();
    await nextEvent(reader, "ready");

    // An agent write, through the same function the set_task tool calls.
    const { db, close } = makeDb();
    await writes.setTask(db, { project: "micasa", key: "MIC-B-01", status: "In review" });
    await close();
    assert.deepEqual(await nextEvent(reader, "change"), { type: "task", project: "micasa", key: "MIC-B-01" });

    // A screen write through the API.
    await req("PATCH", "/api/projects/micasa/tasks/MIC-B-01", { body: { priority: "P3" } });
    assert.deepEqual(await nextEvent(reader, "change"), { type: "task", project: "micasa", key: "MIC-B-01" });

    await reader.cancel();
  });
});
