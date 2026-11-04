// Approvals, check gates and the inbox (2.1: R-05, R-13, R-28).
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
const { decideApproval, loadApproval, requestApproval, useApproval } = await import("../src/mcp/approvals.js");
const { waiveCheck } = await import("../src/mcp/checks.js");
const { findProject, requireTask } = await import("../src/mcp/queries.js");
const { webCtx, writeTx } = await import("../src/mcp/tx.js");

type Json = Record<string, any>;
const A = { agent: "test-agent", session_id: "s1", machine: "ci" };
const P = { project: "filmia" };
const T = { scope: "s", checks: ["tests green", "screenshot at 375px"] };

let client: Client;
let raw: pg.Client;
let closeDb: () => Promise<void>;
let cookie: string;

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

function req(method: string, path: string, body?: unknown) {
  return app.request(path, {
    method,
    headers: { Cookie: cookie, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function eventsOf(type: string): Promise<number> {
  const { rows } = await raw.query("select count(*)::int as n from events where type = $1", [type]);
  return rows[0].n;
}

before(async () => {
  raw = await resetTestDb();
  cookie = `${SESSION_COOKIE}=${createSession()}`;
  const { db, close } = makeDb();
  closeDb = close;
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createMcpServer(db).connect(serverSide);
  client = new Client({ name: "test", version: "0" });
  await client.connect(clientSide);
  await call("create_task", { ...P, kind: "initiative", title: "Catalog", scope: "PRD" }); // FIL-I1
  await call("create_task", { ...P, title: "Schema", ...T, parent_key: "FIL-I1", phase: 1 }); // FIL-I1-1
  await call("claim", { ...P, key: "FIL-I1-1" });
  await call("add_result", { ...P, key: "FIL-I1-1", kind: "unit", verdict: "pass", cite: "12 pass", check_ns: [1] });
});

after(async () => {
  await client?.close();
  await closeDb?.();
  await raw?.end();
});

describe("check gates", () => {
  test("In review is refused while a check is open, and lists the numbers", async () => {
    const r = await call("set_task", { ...P, key: "FIL-I1-1", status: "In review", version: 2 });
    assert.equal(r.__error, "CHECKS_OPEN");
    assert.equal(r.__status, 409);
    assert.deepEqual(r.open, [2]);
  });

  test("a waiver before In review needs no approval and shows in get_task; then In review goes through", async () => {
    const w = await call("waive_check", { ...P, key: "FIL-I1-1", n: 2, reason: "no UI in this phase" });
    assert.deepEqual(w.check, { n: 2, done: false, waived: true });
    const t = await call("get_task", { ...P, key: "FIL-I1-1" });
    assert.equal(t.checks[1].waived.reason, "no UI in this phase");
    assert.equal(t.checks[1].waived.approval_id, null);
    const v = (await call("get_task", { ...P, key: "FIL-I1-1", view: "summary" })).version;
    const r = await call("set_task", { ...P, key: "FIL-I1-1", status: "In review", version: v, branch: "jl/schema", pr_url: "https://github.com/x/y/pull/1" });
    assert.equal(r.status, "In review");
  });

  test("once In review, a waiver is the reason alone and the inbox has no approval group", async () => {
    const lifted = await call("set_check", { ...P, key: "FIL-I1-1", n: 2, waived: false });
    assert.equal(lifted.__error, undefined, lifted.__text);
    assert.equal((await call("get_task", { ...P, key: "FIL-I1-1" })).checks[1].waived, null);
    const names = (await client.listTools()).tools.map((t) => t.name);
    assert.equal(names.includes("request_approval"), false);
    const waived = await call("waive_check", { ...P, key: "FIL-I1-1", n: 2, reason: "still no UI", approval_id: "old-id" });
    assert.equal(waived.check.waived, true);
    assert.match(waived.hint, /ignored approval_id/);
    assert.equal((await call("get_task", { ...P, key: "FIL-I1-1" })).checks[1].waived.approval_id, null);
    const inbox = await call("get_inbox", { project: "filmia" });
    assert.equal(inbox.items.some((i: Json) => i.kind === "approval"), false);
    assert.equal(await eventsOf("check.waived") > 0, true);
  });
});

describe("Won't do", () => {
  test("an agent needs evidence; the id of an old approval does not unlock the move", async () => {
    const v = async () => (await call("get_task", { ...P, key: "FIL-I1-1", view: "summary" })).version;
    assert.equal((await call("set_task", { ...P, key: "FIL-I1-1", status: "Won't do", version: await v() })).__error, "HUMAN_ONLY");
    const bare = await call("set_task", { ...P, key: "FIL-I1-1", status: "Won't do", version: await v(), approval_id: "00000000-0000-0000-0000-000000000000", reason: "no" });
    assert.equal(bare.__error, "HUMAN_ONLY");
    await call("create_task", { ...P, title: "Other", ...T, parent_key: "FIL-I1", phase: 2 }); // FIL-I1-2
    const closed = await call("set_task", {
      ...P,
      key: "FIL-I1-1",
      status: "Won't do",
      version: await v(),
      reason: "superseded by FIL-I1-2",
      delegated_by_jorge: { message_id: "msg-owner-9101", quote: "ciérralo, ya no hace falta" },
    });
    assert.equal(closed.status, "Won't do");
    assert.equal(await eventsOf("task.delegated_move"), 1);
    const reopen = await call("set_task", { ...P, key: "FIL-I1-1", status: "Ready", version: await v() });
    assert.equal(reopen.__error, "HUMAN_ONLY");
  });

  test("an initiative closes only once its tickets are closed", async () => {
    const v = (await call("get_task", { ...P, key: "FIL-I1", view: "summary" })).version;
    const r = await call("set_task", { ...P, key: "FIL-I1", status: "Done", version: v });
    assert.equal(r.__error, "INITIATIVE_CHILDREN_OPEN");
    assert.deepEqual(r.open, ["FIL-I1-2"]);
  });
});

describe("the inbox on screen", () => {
  test("lists the question and the delegated move, and no approval group", async () => {
    await call("ask", { ...P, key: "FIL-I1-2", question: "Keep the old column?", options: ["Yes", "No"] });
    const all = (await (await req("GET", "/api/inbox")).json()) as Json;
    assert.equal(all.items.some((i: Json) => i.kind === "approval"), false);
    assert.equal(all.items.filter((i: Json) => i.kind === "question").length, 1);
    assert.equal(all.delegated.some((d: Json) => d.kind === "move" && d.message_id === "msg-owner-9101"), true);
    assert.equal((await req("POST", "/api/approvals/decide", { ids: [], decision: "grant" })).status, 400);
  });

  test("an old row can still be decided, and the old error codes still fire", async () => {
    const ctx = { actor: A };
    const { db, close } = makeDb();
    const codeOf = async (run: () => Promise<unknown>) => {
      try {
        await run();
        return "";
      } catch (e) {
        return (e as { code?: string }).code ?? "";
      }
    };
    try {
      assert.equal(await codeOf(() => requestApproval(db, { project: "filmia", key: "FIL-I1-2", action: "done", reason: "x" }, ctx)), "INVALID_APPROVAL");
      assert.equal(await codeOf(() => waiveCheck(db, { project: "filmia", key: "FIL-I1-2", n: 1, reason: "   " }, ctx)), "INVALID_APPROVAL");
      const asked = await requestApproval(db, { project: "filmia", key: "FIL-I1-2", action: "lease_resource", reason: "fila vieja", target: { name: "neon" } }, ctx);
      assert.equal(await codeOf(() => decideApproval(db, { approval_id: "00000000-0000-0000-0000-000000000000", decision: "grant" }, webCtx)), "APPROVAL_NOT_FOUND");
      const p = await findProject(db, "filmia");
      const task = await requireTask(db, p.id, "FIL-I1-2");
      const pending = await loadApproval(db, p.id, asked.approval.id);
      assert.equal(await codeOf(() => writeTx(db, p, webCtx, (tx, emit) => useApproval(tx, emit, pending, task, "wont_do", {}, webCtx))), "APPROVAL_MISMATCH");
      assert.equal(await codeOf(() => writeTx(db, p, webCtx, (tx, emit) => useApproval(tx, emit, pending, task, "lease_resource", { name: "neon" }, webCtx))), "APPROVAL_NOT_GRANTED");
      await decideApproval(db, { approval_id: asked.approval.id, decision: "grant" }, webCtx);
      assert.equal(await codeOf(() => decideApproval(db, { approval_id: asked.approval.id, decision: "reject" }, webCtx)), "APPROVAL_NOT_GRANTED");
      const granted = await loadApproval(db, p.id, asked.approval.id);
      await writeTx(db, p, webCtx, (tx, emit) => useApproval(tx, emit, granted, task, "lease_resource", { name: "neon" }, webCtx));
      const spent = await loadApproval(db, p.id, asked.approval.id);
      assert.equal(await codeOf(() => writeTx(db, p, webCtx, (tx, emit) => useApproval(tx, emit, spent, task, "lease_resource", { name: "neon" }, webCtx))), "APPROVAL_USED");
    } finally {
      await close();
    }
  });
});
