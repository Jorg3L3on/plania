// batch (2.1, R-29): several writes in one call, atomic or not, replayed by request_id.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const { makeDb } = await import("../src/db/client.js");
const { createMcpServer } = await import("../src/mcp/register.js");
const { runBatch } = await import("../src/mcp/batch.js");

type Json = Record<string, any>;
const A = { agent: "test-agent", session_id: "s1", machine: "ci" };
const P = { project: "workia" };

let client: Client;
let raw: pg.Client;
let closeDb: () => Promise<void>;

async function call(name: string, args: Json): Promise<Json> {
  const r = (await client.callTool({ name, arguments: { actor: A, ...args } })) as { isError?: boolean; content: { text: string }[] };
  const text = r.content[0]!.text;
  let data: Json;
  try {
    data = JSON.parse(text);
  } catch {
    return { __error: "INVALID_INPUT", __text: text }; // the SDK refused the input before Plania ran
  }
  return r.isError ? { __error: data.error, __status: data.status, ...data } : data;
}

async function eventCount(): Promise<number> {
  const { rows } = await raw.query("select count(*)::int as n from events");
  return rows[0].n;
}

before(async () => {
  raw = await resetTestDb();
  const { db, close } = makeDb();
  closeDb = close;
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createMcpServer(db).connect(serverSide);
  client = new Client({ name: "test", version: "0" });
  await client.connect(clientSide);
});

after(async () => {
  await client?.close();
  await closeDb?.();
  await raw?.end();
});

describe("batch", () => {
  test("atomic: creates an initiative and its phases in one call, chaining versions", async () => {
    const r = await call("batch", {
      ...P,
      ops: [
        { op: "create_task", kind: "initiative", title: "Split", scope: "PRD" },
        { op: "create_task", title: "F1", scope: "s", checks: ["a", "b"], parent_key: "WRK-I1", phase: 1 },
        { op: "create_task", title: "F2", scope: "s", checks: ["c"], parent_key: "WRK-I1", phase: 2, blocked_by: ["WRK-I1-1"] },
        { op: "set_task", key: "WRK-I1", status: "Active" },
        { op: "note", key: "WRK-I1-1", text: "planned together" },
        { op: "add_decision", text: "One PR per initiative", task_key: "WRK-I1", pin: true },
      ],
    });
    assert.equal(r.applied, 6);
    assert.deepEqual(r.results.map((x: Json) => x.key ?? x.decision?.task_key), ["WRK-I1", "WRK-I1-1", "WRK-I1-2", "WRK-I1", "WRK-I1-1", "WRK-I1"]);
    assert.equal(r.results[3].status, "Active", "set_task without version used the version the create produced");
    assert.ok(JSON.stringify(r).length < 1024 * 6, "compact replies");
    const t = await call("get_task", { ...P, key: "WRK-I1-2" });
    assert.deepEqual(t.blocked_by.map((b: Json) => b.task), ["WRK-I1-1"]);
  });

  test("atomic: one failing op rolls the whole batch back and names its index", async () => {
    const before = await eventCount();
    const r = await call("batch", {
      ...P,
      ops: [
        { op: "note", key: "WRK-I1-1", text: "first" },
        { op: "set_task", key: "WRK-I1-1", status: "Ready", version: 999 },
        { op: "note", key: "WRK-I1-1", text: "never" },
      ],
    });
    assert.equal(r.__error, "BATCH_FAILED");
    assert.equal(r.__status, 409);
    assert.equal(r.index, 1);
    assert.equal(r.op, "set_task");
    assert.equal(r.failed.error, "STALE_VERSION");
    assert.equal(typeof r.failed.current_version, "number");
    assert.equal(await eventCount(), before, "nothing written");
    // The tool schema already refuses an unknown op; the body refuses it too for direct callers.
    const { db, close } = makeDb();
    try {
      await assert.rejects(
        runBatch(db, { project: "workia", ops: [{ op: "nope", key: "x" }] }, { actor: A }),
        (e: Error & { code?: string; detail?: Json }) => e.code === "BATCH_FAILED" && e.detail?.failed.error === "INVALID_BATCH_OP",
      );
    } finally {
      await close();
    }
    const viaTool = (await client.callTool({ name: "batch", arguments: { ...P, actor: A, ops: [{ op: "nope", key: "x" }] } })) as Json;
    assert.equal(viaTool.isError, true);
  });

  test("non-atomic: failures show inline, the rest commits, and a retry replays what went through", async () => {
    const before = await eventCount();
    const args = {
      ...P,
      atomic: false,
      request_id: "batch-1",
      ops: [
        { op: "set_check", key: "WRK-I1-1", n: 1, done: true },
        { op: "set_check", key: "WRK-I1-1", n: 9, done: true },
        { op: "add_result", key: "WRK-I1-1", kind: "unit", verdict: "pass", cite: "3 pass" },
      ],
    };
    const r = await call("batch", args);
    assert.equal(r.applied, 2);
    assert.deepEqual(r.results.map((x: Json) => x.error ?? x.changed[0]), ["checks", "CHECK_NOT_FOUND", "results"]);
    assert.equal(await eventCount(), before + 2);
    const again = await call("batch", args);
    assert.deepEqual(again, r, "same request_id: the first answers come back");
    assert.equal(await eventCount(), before + 2, "and nothing is written twice");
    const reused = await call("set_task", { ...P, key: "WRK-I1-1", note: "x", request_id: "batch-1:0" });
    assert.equal(reused.__error, "REQUEST_ID_REUSED");
  });

  test("verbose adds the full task to each op that returns one", async () => {
    const r = await call("batch", { ...P, verbose: true, ops: [{ op: "note", key: "WRK-I1-1", text: "v" }] });
    assert.equal(r.results[0].task.scope, "s");
    assert.equal(r.results[0].task.log, undefined, "never the log");
  });
});
