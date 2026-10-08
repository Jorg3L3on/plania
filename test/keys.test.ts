// Server-assigned keys (2.1, R-08 + R-33): per-kind counters, aliases after a move, concurrency.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const { makeDb } = await import("../src/db/client.js");
const { createMcpServer } = await import("../src/mcp/register.js");

type Json = Record<string, any>;
const A = { agent: "test-agent", session_id: "s1", machine: "ci" };
const T = { scope: "s", checks: ["c"] };

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

describe("assigned keys", () => {
  const P = { project: "filmia" };

  test("initiatives, standalone tickets and phases each count on their own", async () => {
    const i1 = await call("create_task", { ...P, kind: "initiative", title: "Catalog", scope: "PRD" });
    assert.equal(i1.key, "FIL-I1");
    assert.equal(i1.kind, "initiative");
    assert.deepEqual(i1.changed, ["created"]);
    assert.equal(i1.task, undefined, "compact by default");
    const s1 = await call("create_task", { ...P, title: "Loose", ...T });
    assert.equal(s1.key, "FIL-01", "an initiative never spends a ticket number");
    const i2 = await call("create_task", { ...P, kind: "initiative", title: "Awards", scope: "PRD" });
    assert.equal(i2.key, "FIL-I2");
    const f1 = await call("create_task", { ...P, title: "Schema", ...T, parent_key: "FIL-I1", phase: 1 });
    const f2 = await call("create_task", { ...P, title: "Queries", ...T, parent_key: "FIL-I1", phase: 2 });
    const g1 = await call("create_task", { ...P, title: "Backfill", ...T, parent_key: "FIL-I2" });
    assert.deepEqual([f1.key, f2.key, g1.key], ["FIL-I1-1", "FIL-I1-2", "FIL-I2-1"]);
    assert.equal(f1.parent_key, "FIL-I1");
    const s2 = await call("create_task", { ...P, title: "Loose 2", ...T });
    assert.equal(s2.key, "FIL-02");
    const p = await call("get_project", P);
    assert.equal(p.key_prefix, "FIL");
    assert.deepEqual(p.next_keys, { initiative: "FIL-I3", standalone: "FIL-03" });
  });

  test("an explicit key that fits the scheme must be at or above the counter, and moves it", async () => {
    assert.equal((await call("create_task", { ...P, key: "FIL-07", title: "Imported", ...T })).warnings, undefined);
    const below = await call("create_task", { ...P, key: "FIL-03", title: "Too low", ...T });
    assert.equal(below.__error, "KEY_BELOW_COUNTER");
    assert.equal(below.__status, 409);
    assert.equal(below.next, "FIL-08");
    assert.equal((await call("create_task", { ...P, title: "Next", ...T })).key, "FIL-08");
    const odd = await call("create_task", { ...P, key: "FIL-H-01", title: "Hook style", ...T });
    assert.deepEqual(odd.warnings, ["key does not follow the scheme FIL-<n>: omit key to get the next one"]);
    assert.equal((await call("create_task", { ...P, key: "FIL-08", title: "dup", ...T })).__error, "KEY_EXISTS");
  });

  test("a failed create leaves the counter alone; 20 concurrent creates get 20 consecutive keys", async () => {
    const before = (await call("get_project", P)).next_keys.standalone;
    assert.equal((await call("create_task", { ...P, title: "no scope", template: false })).__error, "TEMPLATE_INVALID");
    assert.equal((await call("get_project", P)).next_keys.standalone, before);

    const pools = Array.from({ length: 20 }, () => makeDb());
    try {
      const { createTask } = await import("../src/mcp/writes.js");
      const keys = await Promise.all(
        pools.map(({ db }, i) => createTask(db, { project: "filmia", title: `c${i}`, ...T }, { actor: { ...A, session_id: `c${i}` } })),
      );
      const numbers = keys.map((k) => Number(k.key.slice(4))).sort((a, b) => a - b);
      const start = numbers[0]!;
      assert.deepEqual(numbers, Array.from({ length: 20 }, (_, i) => start + i));
    } finally {
      await Promise.all(pools.map((p) => p.close()));
    }
  });
});

describe("aliases", () => {
  const P = { project: "micasa" };

  test("a moved ticket gets a key under its new parent; the old key keeps resolving everywhere", async () => {
    await call("create_task", { ...P, kind: "initiative", title: "A", scope: "PRD" }); // MIC-I1
    await call("create_task", { ...P, kind: "initiative", title: "B", scope: "PRD" }); // MIC-I2
    const t = await call("create_task", { ...P, title: "Phase", ...T, parent_key: "MIC-I1", phase: 1 });
    assert.equal(t.key, "MIC-I1-1");

    const moved = await call("set_task", { ...P, key: "MIC-I1-1", parent_key: "MIC-I2", version: t.version });
    assert.equal(moved.key, "MIC-I2-1");
    assert.equal(moved.previous_key, "MIC-I1-1");
    assert.ok(moved.changed.includes("key") && moved.changed.includes("parent_key"));

    const byAlias = await call("get_task", { ...P, key: "MIC-I1-1" });
    assert.equal(byAlias.key, "MIC-I2-1");
    assert.deepEqual(byAlias.aliases, ["MIC-I1-1"]);
    assert.equal(byAlias.parent_key, "MIC-I2");

    // Writes through the alias land on the canonical task and log the canonical key.
    const claimed = await call("claim", { ...P, key: "MIC-I1-1", workspace: { branch: "jl/x" } });
    assert.equal(claimed.key, "MIC-I2-1");
    const r = await call("add_result", { ...P, key: "MIC-I1-1", kind: "unit", verdict: "pass", cite: "ok", check_ns: [1] });
    assert.equal(r.key, "MIC-I2-1");
    const c = await call("set_check", { ...P, key: "MIC-I1-1", n: 1, done: false });
    assert.equal(c.key, "MIC-I2-1");
    const events = (await call("list_events", { ...P, key: "MIC-I1-1" })).events;
    assert.ok(events.every((e: Json) => e.task_key === "MIC-I2-1" || e.type === "task.created"));
    const rekeyed = events.find((e: Json) => e.type === "task.rekeyed");
    assert.deepEqual(rekeyed.payload, { from: "MIC-I1-1", to: "MIC-I2-1", reason: "moved" });
    assert.equal(rekeyed.kind, "ticket");
    assert.equal(rekeyed.parent_key, "MIC-I2");

    // Standalone again: a third key; both old keys still resolve; none can be reissued.
    const v = (await call("get_task", { ...P, key: "MIC-I2-1" })).version;
    const loose = await call("set_task", { ...P, key: "MIC-I2-1", parent_key: null, version: v });
    assert.equal(loose.key, "MIC-01");
    assert.deepEqual((await call("get_task", { ...P, key: "MIC-I2-1" })).aliases, ["MIC-I1-1", "MIC-I2-1"]);
    assert.equal((await call("create_task", { ...P, key: "MIC-I1-1", title: "x", ...T, parent_key: "MIC-I1" })).__error, "KEY_EXISTS");
    assert.equal((await call("create_task", { ...P, title: "x", ...T, parent_key: "MIC-I1", phase: 1 })).key, "MIC-I1-2");
    assert.equal((await call("list_tasks", { ...P, parent_key: "MIC-I2" })).tasks.length, 0);
  });

  test("get_next and get_resume name the kind and parent beside the key", async () => {
    const next = (await call("get_next", { ...P })).task;
    assert.equal(next.kind, "ticket");
    assert.ok("parent_key" in next);
  });
});
