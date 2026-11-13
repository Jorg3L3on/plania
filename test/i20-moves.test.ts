// PLA-I20-2: Won't do and reopening are a logged move. The screen sends a reason. An agent also
// sends delegated_by_jorge. A raw status with neither is WONT_DO_WITHOUT_EVIDENCE. A granted
// historical row still covers the old decision. The inbox has no approval group.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { randomUUID } from "node:crypto";
import { resetTestStore, useTestEnv, type TestStore } from "./helpers.js";

useTestEnv();
const { makeDb } = await import("../src/db/client.js");
const { createMcpServer } = await import("../src/mcp/register.js");
const { setTask } = await import("../src/mcp/writes.js");
const { webCtx } = await import("../src/mcp/tx.js");
const { ToolError } = await import("../src/mcp/errors.js");
const { WONT_DO_WITHOUT_EVIDENCE } = await import("../src/mcp/audit.js");

type Json = Record<string, any>;
const A = { agent: "test-agent", session_id: "s1", machine: "ci" };
const P = { project: "zigzag" };
const T = { scope: "s", checks: ["c"] };
const QUOTE = "ciérralo, ya no hace falta";

let client: Client;
let store: TestStore;
let closeDb: () => Promise<void>;

async function call(name: string, args: Json): Promise<Json> {
  const sent = name === "get_inbox" || name === "audit" || name === "get_task" ? args : { actor: A, verbose: true, ...args };
  const r = (await client.callTool({ name, arguments: sent })) as { isError?: boolean; content: { text: string }[] };
  const data = JSON.parse(r.content[0]!.text) as Json;
  if (r.isError) return { __error: data.error, __status: data.status };
  return data.task ? { ...data, ...data.task } : data;
}

before(async () => {
  store = await resetTestStore();
  const { db, close } = makeDb();
  closeDb = close;
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createMcpServer(db).connect(serverSide);
  client = new Client({ name: "i20-moves", version: "0" });
  await client.connect(clientSide);
});

after(async () => {
  await client?.close();
  await closeDb?.();
  await store?.end();
});

test("tools/list has no request_approval", async () => {
  const names = (await client.listTools()).tools.map((t) => t.name);
  assert.equal(names.includes("request_approval"), false);
});

test("the screen logs a reason and does not land in the delegated list", async () => {
  const created = await call("create_task", { ...P, title: "En pantalla", ...T });
  const { db, close } = makeDb();
  try {
    await assert.rejects(
      () => setTask(db, { ...P, key: created.key, status: "Won't do", version: created.version }, webCtx),
      (e: unknown) => e instanceof ToolError && e.code === "HUMAN_ONLY",
    );
    const moved = await setTask(db, { ...P, key: created.key, status: "Won't do", version: created.version, reason: "en pantalla" }, webCtx);
    assert.equal(moved.status, "Won't do");
  } finally {
    await close();
  }
  const rows = await store.find("events", { type: "task.delegated_move", taskKey: created.key });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.payload.message_id, undefined);
  assert.equal(rows[0]!.payload.reason, "en pantalla");
  const inbox = await call("get_inbox", { project: "zigzag" });
  assert.equal(inbox.items.some((i: Json) => i.kind === "approval"), false);
  assert.equal(inbox.delegated.some((d: Json) => d.key === created.key), false);
  const audit = await call("audit", P);
  assert.equal(audit.findings.some((f: Json) => f.code === WONT_DO_WITHOUT_EVIDENCE && f.key === created.key), false);
});

test("an agent without evidence is HUMAN_ONLY, and with evidence the move is listed", async () => {
  const created = await call("create_task", { ...P, title: "Por encargo", ...T });
  const bare = await call("set_task", { ...P, key: created.key, status: "Won't do", version: created.version, reason: "sin cita" });
  assert.equal(bare.__error, "HUMAN_ONLY");
  const closed = await call("set_task", {
    ...P,
    key: created.key,
    status: "Won't do",
    version: created.version,
    reason: "él lo pidió",
    approval_id: "old-id",
    delegated_by_jorge: { message_id: "msg-owner-9201", quote: QUOTE },
  });
  assert.equal(closed.status, "Won't do");
  assert.match(closed.hint, /ignored approval_id/);
  const inbox = await call("get_inbox", { project: "zigzag" });
  assert.equal(inbox.delegated.some((d: Json) => d.kind === "move" && d.message_id === "msg-owner-9201" && d.quote === QUOTE), true);
  const audit = await call("audit", P);
  assert.equal(audit.findings.some((f: Json) => f.code === WONT_DO_WITHOUT_EVIDENCE && f.key === created.key), false);
});

test("a raw Won't do is flagged, and a granted historical row is not", async () => {
  const bare = await call("create_task", { ...P, title: "Sin registro", ...T });
  const old = await call("create_task", { ...P, title: "Decisión vieja", ...T });
  await store.fix((uow) => uow.update("tasks", { key: [bare.key, old.key] }, { status: "Won't do" }));
  const row = (await store.get("tasks", { projectId: await store.projectId("zigzag"), key: old.key }))!;
  await store.fix((uow) =>
    uow.insert("events", {
      projectId: row.projectId,
      taskId: row.id,
      taskKey: old.key,
      type: "approval.archived",
      actor: { agent: "jorge", session_id: "web", machine: "screen" },
      payload: { approval_id: randomUUID(), action: "wont_do", state: "granted", reason: "ya se decidió" },
    }),
  );
  const audit = await call("audit", P);
  const flagged = audit.findings.filter((f: Json) => f.code === WONT_DO_WITHOUT_EVIDENCE).map((f: Json) => f.key);
  assert.equal(flagged.includes(bare.key), true);
  assert.equal(flagged.includes(old.key), false);
});
