// Plania's own code running on the devva store, with no Postgres: the MCP tools, driven as an agent would.
// Skipped unless DEVVA_TEST=1 (needs the spike's engine and client build, like store-devva.test.ts).
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { useTestEnv } from "./helpers.js";

useTestEnv();
// No database URL at all: anything that still reaches for Postgres fails loudly.
delete process.env.DATABASE_URL;
const { makeDb, useDb } = await import("../src/db/client.js");
const { DevvaStore } = await import("../src/store/devva.js");
const { createMcpServer } = await import("../src/mcp/register.js");
type Store = Awaited<ReturnType<typeof DevvaStore.open>>;

const live = process.env.DEVVA_TEST === "1";
const prefix = `app_${Date.now().toString(36)}`;
const A = { agent: "test-agent", session_id: "s1", machine: "ci" };
const B = { agent: "other-agent", session_id: "s2", machine: "ci" };
type Json = Record<string, any>;
let store: Store;
let client: Client;

async function connect(): Promise<Client> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createMcpServer(makeDb().db).connect(serverSide);
  const c = new Client({ name: "test", version: "0" });
  await c.connect(clientSide);
  return c;
}
async function call(name: string, args: Json, c: Client = client): Promise<Json> {
  const r = (await c.callTool({ name, arguments: args })) as { isError?: boolean; content: { text: string }[] };
  const text = r.content[0]!.text;
  // Input the tool's schema refuses comes back as plain text, before plania runs.
  if (!text.startsWith("{") && !text.startsWith("[")) return { __error: "INVALID_INPUT", text };
  const data = JSON.parse(text);
  return r.isError ? { __error: data.error, ...data } : data;
}

describe("plania on devva", { skip: live ? false : "set DEVVA_TEST=1 with the spike engine running" }, () => {
  before(async () => {
    store = await DevvaStore.open({ prefix });
    useDb(store.handle);
    await store.write("", {}, async (uow) => {
      await uow.insert("projects", { id: randomUUID(), slug: "zigzag", title: "Zigzag", keyPrefix: "ZIG" });
    });
    client = await connect();
  });
  after(async () => {
    await client?.close();
    useDb(null);
    await store?.purge();
    store?.close();
  });

  test("create, claim, finish: keys, versions, leases, evidence and the event log", async () => {
    const made = await call("create_task", { project: "zigzag", title: "Port the store", scope: "Run on devva", checks: ["It runs"], actor: A });
    assert.equal(made.__error, undefined, JSON.stringify(made));
    assert.equal(made.key, "ZIG-01");
    assert.equal((await call("create_task", { project: "zigzag", title: "Second", scope: "x", checks: ["y"], actor: A })).key, "ZIG-02");

    const claimed = await call("claim", { project: "zigzag", key: "ZIG-01", actor: A });
    assert.equal(claimed.status, "In progress");
    assert.equal((await call("claim", { project: "zigzag", key: "ZIG-01", actor: B })).__error, "CLAIM_HELD");

    const task = await call("get_task", { project: "zigzag", key: "ZIG-01" });
    assert.equal((await call("set_task", { project: "zigzag", key: "ZIG-01", title: "stale", version: task.version - 1, actor: A })).__error, "STALE_VERSION");
    assert.equal((await call("set_task", { project: "zigzag", key: "ZIG-01", status: "In review", version: task.version, actor: A })).__error, "EVIDENCE_REQUIRED");

    assert.equal((await call("set_check", { project: "zigzag", key: "ZIG-01", n: 1, done: true, actor: A })).__error, undefined);
    const done = await call("finish", { project: "zigzag", key: "ZIG-01", result: { kind: "test", verdict: "pass", cite: "ran on devva" }, branch: "jl/zig-01", pr_url: "https://github.com/x/y/pull/1", actor: A });
    assert.equal(done.__error, undefined, JSON.stringify(done));
    assert.equal(done.status, "In review");

    const events = (await call("list_events", { project: "zigzag" })).events as Json[];
    const types = events.map((e) => e.type);
    for (const t of ["task.created", "claim.acquired", "result.added"]) assert.ok(types.includes(t), `${t} in ${types.join(",")}`);
    assert.deepEqual(events.map((e) => e.id), [...events.map((e) => e.id)].sort((a, b) => a - b), "events come back in id order");
  });

  test("a retried request id replays the first reply", async () => {
    const args = { project: "zigzag", title: "Once", scope: "x", checks: ["y"], actor: A, request_id: "req-app-1" };
    const first = await call("create_task", args);
    const again = await call("create_task", args);
    assert.equal(first.key, again.key);
    assert.equal((await call("list_tasks", { project: "zigzag" })).tasks.filter((t: Json) => t.title === "Once").length, 1);
  });

  test("an atomic batch that fails writes nothing", async () => {
    const before = (await call("list_events", { project: "zigzag" })).events.length;
    const r = await call("batch", { project: "zigzag", actor: A, atomic: true, ops: [{ op: "create_task", title: "In a batch", scope: "x", checks: ["y"] }, { op: "set_task", key: "ZIG-99", title: "no such key" }] });
    assert.equal(r.__error, "BATCH_FAILED", JSON.stringify(r));
    assert.equal((await call("list_events", { project: "zigzag" })).events.length, before);
    assert.equal((await call("list_tasks", { project: "zigzag" })).tasks.some((t: Json) => t.title === "In a batch"), false);
  });

  test("reads: resume, project, memory, inbox and the next ticket", async () => {
    await call("add_decision", { project: "zigzag", text: "Devva holds the plan", actor: A });
    const asked = await call("ask", { project: "zigzag", key: "ZIG-02", question: "Ship it?", options: ["Yes", "No"], actor: A });
    assert.equal(asked.__error, undefined, JSON.stringify(asked));
    assert.equal((await call("get_resume", { project: "zigzag" })).__error, undefined);
    assert.equal((await call("get_project", { project: "zigzag" })).title, "Zigzag");
    assert.equal((await call("get_memory", { project: "zigzag" })).decisions[0].text, "Devva holds the plan");
    const inbox = await call("get_inbox", { project: "zigzag" });
    assert.equal(inbox.__error, undefined, JSON.stringify(inbox));
    assert.ok(JSON.stringify(inbox).includes("Ship it?"));
    assert.equal((await call("list_projects", {})).__error, undefined);
  });

  test("the same state is there after a restart, straight from devva's log", async () => {
    const tasksBefore = (await call("list_tasks", { project: "zigzag" })).tasks.map((t: Json) => [t.key, t.status, t.version]);
    const eventsBefore = (await call("list_events", { project: "zigzag" })).events.length;
    await client.close();
    useDb(null);
    store.close();
    store = await DevvaStore.open({ prefix });
    useDb(store.handle);
    client = await connect();
    assert.equal(store.recovered.repaired, 0);
    assert.deepEqual((await call("list_tasks", { project: "zigzag" })).tasks.map((t: Json) => [t.key, t.status, t.version]), tasksBefore);
    assert.equal((await call("list_events", { project: "zigzag" })).events.length, eventsBefore);
    assert.equal((await call("create_task", { project: "zigzag", title: "After the restart", scope: "x", checks: ["y"], actor: A })).__error, undefined);
  });
});
