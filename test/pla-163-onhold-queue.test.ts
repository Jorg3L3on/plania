// PLA-163: a Ready step of an On hold initiative joins nobody's queue, so the board never offers to start it.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const { makeDb } = await import("../src/db/client.js");
const { createMcpServer } = await import("../src/mcp/register.js");
const { readyOf } = await import("../src/api/company-plan.js");
const { findProject } = await import("../src/mcp/queries.js");

type Json = Record<string, any>;
const A = { agent: "test-agent", session_id: "s1", machine: "MacBook-Air" };
const P = { project: "filmia" };

let client: Client;
let raw: pg.Client;
let db: Awaited<ReturnType<typeof makeDb>>["db"];
let closeDb: () => Promise<void>;

async function call(name: string, args: Json): Promise<Json> {
  const r = (await client.callTool({ name, arguments: { actor: A, ...args } })) as { isError?: boolean; content: { text: string }[] };
  const data = JSON.parse(r.content[0]!.text);
  return r.isError ? { __error: data.error, ...data } : data;
}

before(async () => {
  raw = await resetTestDb();
  const made = makeDb();
  db = made.db;
  closeDb = made.close;
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

test("readyOf leaves out the Ready steps of an On hold initiative, and lists them again once resumed", async () => {
  const ini = await call("create_task", { ...P, kind: "initiative", title: "Plan de pagos", scope: "s" });
  const step = await call("create_task", { ...P, parent_key: ini.key, phase: 1, title: "Paso 1", scope: "s", checks: ["c"], status: "Ready" });
  const keys = async () => (await readyOf(db, await findProject(db, "filmia"), null, null)).queued.map((q: { key: string }) => q.key);
  assert.ok((await keys()).includes(step.key), "queued while the initiative is Planning");

  const v = (await call("get_task", { ...P, key: ini.key, view: "summary" })).version;
  await call("set_task", { ...P, key: ini.key, status: "On hold", version: v });
  assert.ok(!(await keys()).includes(step.key), "nobody's queue while On hold");

  const v2 = (await call("get_task", { ...P, key: ini.key, view: "summary" })).version;
  await call("set_task", { ...P, key: ini.key, status: "Planning", version: v2 });
  assert.ok((await keys()).includes(step.key), "queued again once resumed");
});
