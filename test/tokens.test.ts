// Per-agent tokens (2.1, R-04): issued on screen, scoped, identifying the agent, revocable.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type pg from "pg";
import { TEST_BEARER, resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const { app } = await import("../src/app.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const { makeDb } = await import("../src/db/client.js");
const { createTask } = await import("../src/mcp/writes.js");

type Json = Record<string, any>;
let raw: pg.Client;
let cookie: string;
let secrets: Record<string, string> = {};
let ids: Record<string, string> = {};

const headers = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
const rpc = (token: string | undefined, body: unknown) =>
  app.request("/mcp", { method: "POST", headers: { ...headers, ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
const tools = async (token: string): Promise<string[]> => {
  const r = (await (await rpc(token, { jsonrpc: "2.0", id: 1, method: "tools/list" })).json()) as Json;
  return r.result.tools.map((t: Json) => t.name).sort();
};
const callTool = async (token: string, name: string, args: Json): Promise<Json> => {
  const r = (await (await rpc(token, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name, arguments: args } })).json()) as Json;
  if (r.error) return { __rpc: r.error };
  const data = JSON.parse(r.result.content[0].text);
  return r.result.isError ? { __error: data.error, __status: data.status, ...data } : data;
};
const api = (method: string, path: string, body?: unknown) =>
  app.request(path, { method, headers: { Cookie: cookie, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });

before(async () => {
  raw = await resetTestDb();
  cookie = `${SESSION_COOKIE}=${createSession()}`;
  const { db, close } = makeDb();
  try {
    await createTask(db, { project: "filmia", key: "FIL-01", title: "x", scope: "s", checks: ["c"] }, { actor: { agent: "t", session_id: "s0" } });
  } finally {
    await close();
  }
});

after(async () => {
  await raw?.end();
});

describe("issuing", () => {
  test("the screen issues a token once, with its scopes, agent and machine; the list never shows the secret", async () => {
    for (const [name, agent, machine, scopes] of [
      ["mac-claude", "Claude Code", "MacBook-Air", ["read", "write"]],
      ["cloud-codex", "Codex", "cloud-1", ["read", "write", "ops"]],
      ["planner", "Cursor", undefined, ["read"]],
    ] as const) {
      const res = await api("POST", "/api/tokens", { name, agent, machine, scopes });
      assert.equal(res.status, 201);
      const out = (await res.json()) as Json;
      assert.match(out.secret, /^pla_[A-Za-z0-9_-]{40}$/);
      assert.deepEqual(out.token.scopes, scopes);
      secrets[name] = out.secret;
      ids[name] = out.token.id;
    }
    const list = (await (await api("GET", "/api/tokens")).json()) as Json[];
    assert.deepEqual(list.map((t) => t.name).sort(), ["cloud-codex", "mac-claude", "planner"]);
    assert.ok(!JSON.stringify(list).includes(secrets["mac-claude"]!));
    assert.equal(list[0]!.prefix.length, 10);
    assert.equal((await api("POST", "/api/tokens", { name: "x", agent: "jorge", scopes: ["read"] })).status, 400);
    assert.equal((await api("POST", "/api/tokens", { name: "x", agent: "a", scopes: ["admin"] })).status, 400);
    assert.equal((await app.request("/api/tokens")).status, 401, "cookie only");
  });
});

describe("using", () => {
  test("scopes decide the tools: read sees reads, write adds writes, ops adds set_env and reserve_sequence", async () => {
    const reads = await tools(secrets["planner"]!);
    assert.ok(reads.includes("get_task") && !reads.includes("set_task"));
    const writes = await tools(secrets["mac-claude"]!);
    assert.ok(writes.includes("set_task") && writes.includes("claim") && writes.includes("batch"));
    assert.ok(!writes.includes("set_env") && !writes.includes("reserve_sequence"));
    const ops = await tools(secrets["cloud-codex"]!);
    assert.ok(ops.includes("set_env") && ops.includes("reserve_sequence"));
    assert.deepEqual(ops, await tools(TEST_BEARER), "the static token still has everything");
    assert.equal((await rpc("pla_nope", { jsonrpc: "2.0", id: 1, method: "tools/list" })).status, 401);
  });

  test("the token fills the actor, refuses a different one, and lands on every event", async () => {
    const filled = await callTool(secrets["mac-claude"]!, "set_task", { project: "filmia", key: "FIL-01", note: "hi", actor: { session_id: "s1" } });
    assert.equal(filled.key, "FIL-01");
    const { rows } = await raw.query("select actor, token_id from events where type = 'note' order by id desc limit 1");
    assert.deepEqual(rows[0].actor, { session_id: "s1", agent: "Claude Code", machine: "MacBook-Air" });
    assert.equal(rows[0].token_id, ids["mac-claude"]);

    const mismatch = await callTool(secrets["mac-claude"]!, "set_task", { project: "filmia", key: "FIL-01", note: "x", actor: { agent: "Codex", session_id: "s1" } });
    assert.equal(mismatch.__error, "ACTOR_MISMATCH");
    assert.equal(mismatch.__status, 403);
    assert.equal(mismatch.expected, "Claude Code");
    const machine = await callTool(secrets["mac-claude"]!, "set_task", { project: "filmia", key: "FIL-01", note: "x", actor: { session_id: "s1", machine: "other" } });
    assert.equal(machine.__error, "ACTOR_MISMATCH");
    const same = await callTool(secrets["mac-claude"]!, "set_task", { project: "filmia", key: "FIL-01", note: "x", actor: { agent: "Claude Code", session_id: "s1", machine: "MacBook-Air" } });
    assert.equal(same.changed[0], "note");
    // A token without a machine takes the caller's; the static token fills nothing and needs agent.
    const noMachine = await callTool(secrets["cloud-codex"]!, "set_task", { project: "filmia", key: "FIL-01", note: "x", actor: { session_id: "s2" } });
    assert.equal(noMachine.key, "FIL-01");
    const required = await callTool(TEST_BEARER, "set_task", { project: "filmia", key: "FIL-01", note: "x", actor: { session_id: "s3" } });
    assert.equal(required.__error, "ACTOR_REQUIRED");
    const legacy = await callTool(TEST_BEARER, "set_task", { project: "filmia", key: "FIL-01", note: "x", actor: { agent: "t", session_id: "s3" } });
    assert.equal(legacy.key, "FIL-01");
    const { rows: last } = await raw.query("select token_id from events order by id desc limit 1");
    assert.equal(last[0].token_id, null);
  });

  test("a revoked token stops at its next call", async () => {
    const res = await api("DELETE", `/api/tokens/${ids["planner"]}?reason=laptop lost`);
    assert.equal(res.status, 200);
    assert.ok(((await res.json()) as Json).revoked_at);
    assert.equal((await rpc(secrets["planner"], { jsonrpc: "2.0", id: 1, method: "tools/list" })).status, 401);
    assert.equal((await api("DELETE", "/api/tokens/00000000-0000-0000-0000-000000000000")).status, 404);
    const list = (await (await api("GET", "/api/tokens")).json()) as Json[];
    assert.equal(list.find((t) => t.name === "planner")!.revoked_reason, "laptop lost");
  });
});
