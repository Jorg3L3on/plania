// 2.12 Pedir: Jorge's requests become tickets (origin jorge) that agents read first.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const { app } = await import("../src/app.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const { makeDb } = await import("../src/db/client.js");
const { createMcpServer } = await import("../src/mcp/register.js");
const { instructions, PROTOCOL_VERSION } = await import("../src/mcp/protocol.js");

type Json = Record<string, any>;
const A = { agent: "test-agent", session_id: "s1", machine: "ci" };
const P = { project: "workia" };
const T = { scope: "s", checks: ["c"] };

let raw: pg.Client;
let client: Client;
let closeDb: () => Promise<void>;
const cookie = () => `${SESSION_COOKIE}=${createSession()}`;

function req(method: string, path: string, body?: unknown, opts: { cookie?: string | null } = {}) {
  const headers: Record<string, string> = {};
  const c = opts.cookie === undefined ? cookie() : opts.cookie;
  if (c) headers.Cookie = c;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  return app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

async function call(name: string, args: Json): Promise<Json> {
  const r = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: { text: string }[] };
  const text = r.content[0]!.text;
  // A schema refusal comes back as plain text, a contract error as JSON.
  if (r.isError) return { __error: text.startsWith("{") ? JSON.parse(text).error : text };
  return JSON.parse(text);
}

before(async () => {
  raw = await resetTestDb();
  const made = makeDb();
  closeDb = made.close;
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createMcpServer(made.db).connect(serverSide);
  client = new Client({ name: "test", version: "0" });
  await client.connect(clientSide);
});

after(async () => {
  await client?.close();
  await closeDb?.();
  await raw?.end();
});

describe("POST /api/projects/:slug/tasks", () => {
  test("a sentence is a Backlog ticket as Jorge with origin jorge, a server key and task.created by jorge", async () => {
    const res = await req("POST", "/api/projects/workia/tasks", { title: "Exportar facturas a CSV" });
    assert.equal(res.status, 201);
    const t = (await res.json()) as Json;
    assert.equal(t.key, "WRK-01");
    assert.equal(t.status, "Backlog");
    assert.equal(t.priority, "P2");
    assert.equal(t.origin, "jorge");
    assert.equal(t.kind, "ticket");
    const { rows } = await raw.query("select type, actor from events where task_key = $1 order by id", ["WRK-01"]);
    assert.equal(rows[0].type, "task.created");
    assert.equal(rows[0].actor.agent, "jorge");
  });

  test("summary, priority and an initiative; a bad body, a ticket as parent and no cookie are refused", async () => {
    await call("create_task", { ...P, actor: A, kind: "initiative", title: "Multiempresa", scope: "s" }); // WRK-I1
    const res = await req("POST", "/api/projects/workia/tasks", { title: "Logo por empresa", summary: "el del cliente", priority: "P1", parent_key: "WRK-I1" });
    assert.equal(res.status, 201);
    const t = (await res.json()) as Json;
    assert.equal(t.parent_key, "WRK-I1");
    assert.equal(t.summary, "el del cliente");
    assert.equal(t.priority, "P1");
    assert.equal((await req("POST", "/api/projects/workia/tasks", { title: "  " })).status, 400);
    assert.equal((await req("POST", "/api/projects/workia/tasks", { title: "x", priority: "P9" })).status, 400);
    assert.equal((await req("POST", "/api/projects/workia/tasks", { title: "x", parent_key: "WRK-01" })).status, 400);
    assert.equal((await req("POST", "/api/projects/nope/tasks", { title: "x" })).status, 404);
    assert.equal((await req("POST", "/api/projects/workia/tasks", { title: "x" }, { cookie: null })).status, 401);
  });

  test("agents cannot claim to be Jorge: create_task refuses origin jorge", async () => {
    const r = await call("create_task", { ...P, actor: A, title: "Fake", ...T, origin: "jorge" });
    assert.ok(r.__error, "origin jorge is not in the agent schema");
    const b = await call("batch", { ...P, actor: A, ops: [{ op: "create_task", title: "Fake", ...T, origin: "jorge" }] });
    assert.ok(b.__error, "nor in batch");
    const { rows } = await raw.query("select count(*)::int as n from tasks where title = 'Fake'");
    assert.equal(rows[0].n, 0);
  });
});

describe("agents read requests first", () => {
  test("get_next offers a request before an older Backlog ticket of the same priority, not before a higher one", async () => {
    // A fresh project state: zigzag, with an agent ticket first.
    await call("create_task", { project: "zigzag", actor: A, title: "Agent ticket", ...T }); // ZIG-01, P2
    let next = await call("get_next", { project: "zigzag" });
    assert.equal(next.task.key, "ZIG-01");
    assert.equal(next.requests, undefined, "no requests, no key");

    const res = await req("POST", "/api/projects/zigzag/tasks", { title: "Lo que pide Jorge" }); // ZIG-02, P2
    assert.equal(res.status, 201);
    next = await call("get_next", { project: "zigzag" });
    assert.equal(next.task.key, "ZIG-02", "a sentence typed on the phone is the next ticket an agent claims");
    assert.equal(next.task.request, true);
    assert.deepEqual(next.requests.map((r: Json) => r.key), ["ZIG-02"]);

    await call("create_task", { project: "zigzag", actor: A, title: "Urgent", ...T, priority: "P0" }); // ZIG-03
    next = await call("get_next", { project: "zigzag" });
    assert.equal(next.task.key, "ZIG-03", "priority still wins");

    const claimed = await call("claim", { project: "zigzag", actor: A, key: "ZIG-02" });
    assert.equal(claimed.status, "In progress");
  });

  test("get_resume and get_context list open requests newest first; closed ones drop out", async () => {
    await req("POST", "/api/projects/zigzag/tasks", { title: "Segundo pedido" }); // ZIG-04
    const resume = await call("get_resume", { project: "zigzag" });
    assert.deepEqual(resume.requests.map((r: Json) => r.key), ["ZIG-04", "ZIG-02"]);
    assert.equal(resume.requests[1].claimed, true);
    assert.ok(resume.requests[0].asked_at);

    await call("set_task", { project: "zigzag", actor: A, key: "ZIG-01", branch: "jl/zig" });
    const ctx = await call("get_context", { project: "zigzag", workspace: { branch: "jl/zig" }, session_id: "s1" });
    assert.deepEqual(ctx.requests.map((r: Json) => r.key), ["ZIG-04", "ZIG-02"]);

    await raw.query("update tasks set status = 'Done' where key = 'ZIG-04'");
    const after = await call("get_resume", { project: "zigzag" });
    assert.deepEqual(after.requests.map((r: Json) => r.key), ["ZIG-02"]);
  });

  test("the screen's project read carries the requests; the protocol says to read them first", async () => {
    const res = await req("GET", "/api/projects/zigzag");
    const body = (await res.json()) as Json;
    assert.deepEqual(body.resume.requests.map((r: Json) => r.key), ["ZIG-02"]);
    assert.equal(PROTOCOL_VERSION, "2.21");
    assert.match(instructions(false), /requests \(in start, get_context, get_resume and get_next\) are what Jorge asked for on screen: read them first/);
  });
});
