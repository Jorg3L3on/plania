// PLA-I23-1: comments, assign with a hop cap, and ping-pong on the same owner pair.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { resetTestStore, useTestEnv, type TestStore } from "./helpers.js";

useTestEnv();
const { makeDb } = await import("../src/db/client.js");
const { createMcpServer } = await import("../src/mcp/register.js");
const { seedLegacyOrg: seedOrg } = await import("./fixtures/legacy-org.js");
const { listComments } = await import("../src/mcp/delegation.js");
const { notNull } = await import("../src/store/types.js");

let store: TestStore;
let db: Awaited<ReturnType<typeof makeDb>>["db"];
let closeDb: () => Promise<void>;
let client: Client;

const A = { agent: "test-agent", session_id: "s-i23" };

async function call(name: string, args: Record<string, unknown> = {}) {
  const r = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: { text: string }[] };
  const data = JSON.parse(r.content[0]!.text);
  if (r.isError) return { __error: data.error as string, __status: data.status as number, ...data };
  return data;
}

async function ticket(title: string) {
  const created = await call("create_task", {
    actor: A,
    project: "micasa",
    title,
    scope: "Scope",
    checks: ["Done"],
  });
  assert.equal(created.__error, undefined);
  return created.key as string;
}

before(async () => {
  store = await resetTestStore();
  ({ db, close: closeDb } = makeDb());
  await seedOrg(db);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createMcpServer(db).connect(serverSide);
  client = new Client({ name: "delegation-test", version: "0" });
  await client.connect(clientSide);
});

after(async () => {
  await client?.close();
  await closeDb?.();
  await store?.end();
});

test("comment stores the author and refuses an empty or oversized body", async () => {
  const key = await ticket("Comentarios");
  const saved = await call("comment", { actor: A, project: "micasa", key, body: "  primera nota  " });
  assert.equal(saved.__error, undefined);
  assert.equal(saved.author_agent, "test-agent");
  assert.equal(saved.body, "primera nota");
  const second = await call("comment", { actor: A, project: "micasa", key, body: "segunda" });
  assert.equal(second.__error, undefined);
  const listed = await listComments(db, "micasa", key);
  assert.deepEqual(listed.map((c) => c.body), ["primera nota", "segunda"]);

  const empty = await call("comment", { actor: A, project: "micasa", key, body: "   " });
  assert.equal(empty.__error, "INVALID_FILTER");
  const huge = await call("comment", { actor: A, project: "micasa", key, body: "x".repeat(2001) });
  assert.equal(huge.__error, "TOO_LARGE");
  assert.equal(huge.max, 2000);
  assert.equal((await listComments(db, "micasa", key)).length, 2);
});

test("assign counts hops, refuses the fourth with HOP_CAP, and posts one limpieza item", async () => {
  const key = await ticket("Cadena");
  const chain = ["taller", "workia", "artist", "research"];
  const owners: string[] = [];
  for (const to of chain.slice(0, 3)) {
    const moved = await call("assign", { actor: A, project: "micasa", key, to_agent: to, note: `pasa a ${to}` });
    assert.equal(moved.__error, undefined, to);
    owners.push(moved.owner_agent);
    assert.equal(moved.assign_hops, owners.length);
    assert.equal(moved.comment.body, `pasa a ${to}`);
  }
  assert.deepEqual(owners, ["taller", "workia", "artist"]);

  const refused = await call("assign", { actor: A, project: "micasa", key, to_agent: "research", request_id: "hop-once" });
  assert.equal(refused.__error, "HOP_CAP");
  assert.equal(refused.__status, 409);
  assert.equal(refused.hops, 3);
  assert.equal(refused.cap, 3);
  const again = await call("assign", { actor: A, project: "micasa", key, to_agent: "housi", request_id: "hop-once" });
  assert.equal(again.__error, "HOP_CAP");

  const row = (await store.get("tasks", { key, ownerAgent: notNull() }))!;
  assert.equal(row.assignHops, 3);
  const owner = await store.get("agents", { id: row.ownerAgent! });
  assert.equal(owner!.slug, "artist");
  const events = await store.count("events", { type: "assign.limpieza", taskKey: key });
  assert.equal(events, 1);

  const box = await call("get_inbox", { project: "micasa" });
  const item = box.items.find((i: { key: string; kind: string }) => i.key === key && i.kind === "assign");
  assert.equal(item.group, "limpieza");
  assert.match(item.why, /más de 3/);
  assert.equal(box.chores >= 1, true);
});

test("assigning a pair back the way it went is PING_PONG and does not count a hop", async () => {
  const key = await ticket("Rebote");
  const first = await call("assign", { actor: A, project: "micasa", key, to_agent: "taller" });
  assert.equal(first.assign_hops, 1);
  const second = await call("assign", { actor: A, project: "micasa", key, to_agent: "workia" });
  assert.equal(second.assign_hops, 2);
  const back = await call("assign", { actor: A, project: "micasa", key, to_agent: "taller" });
  assert.equal(back.__error, "PING_PONG");
  assert.equal(back.__status, 409);
  assert.equal(back.from, "workia");
  assert.equal(back.to, "taller");

  const sideways = await call("assign", { actor: A, project: "micasa", key, to_agent: "artist" });
  assert.equal(sideways.__error, undefined);
  assert.equal(sideways.owner_agent, "artist");
  assert.equal(sideways.assign_hops, 3);
  const hops = await store.get("tasks", { key });
  assert.equal(hops!.assignHops, 3);
  const limpieza = await store.count("events", { type: "assign.limpieza", taskKey: key });
  assert.equal(limpieza, 0);
});
