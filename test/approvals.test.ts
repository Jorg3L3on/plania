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

async function decide(ids: string[], decision: "grant" | "reject", note?: string): Promise<Json> {
  return (await (await req("POST", "/api/approvals/decide", { ids, decision, note })).json()) as Json;
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

  test("once In review, lifting and re-waiving a check needs an approval; the inbox shows the request", async () => {
    const lifted = await call("set_check", { ...P, key: "FIL-I1-1", n: 2, waived: false });
    assert.equal(lifted.__error, undefined, lifted.__text);
    assert.equal((await call("get_task", { ...P, key: "FIL-I1-1" })).checks[1].waived, null);
    const r = await call("waive_check", { ...P, key: "FIL-I1-1", n: 2, reason: "still no UI" });
    assert.equal(r.__error, "APPROVAL_REQUIRED");
    assert.deepEqual(r.target, { n: 2 });

    const { approval, existing } = await call("request_approval", { ...P, key: "FIL-I1-1", action: "waive_check", target: { n: 2 }, reason: "the UI phase comes later" });
    assert.equal(approval.state, "pending");
    assert.equal(existing, false);
    const again = await call("request_approval", { ...P, key: "FIL-I1-1", action: "waive_check", target: { n: 2 }, reason: "dup" });
    assert.equal(again.existing, true);
    assert.equal(again.approval.id, approval.id);
    assert.equal((await call("request_approval", { ...P, key: "FIL-I1-1", action: "ship", reason: "x" })).__error, "INVALID_INPUT", "the schema refuses unknown actions");
    assert.equal((await call("request_approval", { ...P, key: "FIL-I1-1", action: "done", reason: "  " })).__error, "INVALID_APPROVAL");

    const inbox = await call("get_inbox", { project: "filmia" });
    assert.equal(inbox.count, 1);
    assert.equal(inbox.items[0].kind, "approval");
    assert.equal(inbox.items[0].key, "FIL-I1-1");
    assert.equal(inbox.items[0].parent_key, "FIL-I1");
    assert.equal(inbox.items[0].evidence.open_checks, 1);
    assert.equal(inbox.items[0].evidence.last_pass.kind, "unit");
    assert.equal(inbox.items[0].pr_url, "https://github.com/x/y/pull/1");

    const pending = await call("waive_check", { ...P, key: "FIL-I1-1", n: 2, reason: "x", approval_id: approval.id });
    assert.equal(pending.__error, "APPROVAL_NOT_GRANTED");
    assert.equal(pending.state, "pending");

    const decided = await decide([approval.id], "grant", "ok");
    assert.equal(decided.decided, 1);
    assert.equal(await eventsOf("approval.granted"), 1);
    const waived = await call("waive_check", { ...P, key: "FIL-I1-1", n: 2, reason: "approved", approval_id: approval.id });
    assert.equal(waived.check.waived, true);
    assert.equal((await call("get_task", { ...P, key: "FIL-I1-1" })).checks[1].waived.approval_id, approval.id);
    const used = await call("waive_check", { ...P, key: "FIL-I1-1", n: 2, reason: "twice", approval_id: approval.id });
    assert.equal(used.__error, "APPROVAL_USED");
    assert.equal((await call("get_inbox", { project: "all" })).count, 0, "nothing waits once decided");
  });
});

describe("approvals for Done", () => {
  test("request, reject, request again, grant, use once; mismatches are refused", async () => {
    const v = async () => (await call("get_task", { ...P, key: "FIL-I1-1", view: "summary" })).version;
    assert.equal((await call("set_task", { ...P, key: "FIL-I1-1", status: "Done", version: await v() })).__error, "HUMAN_ONLY");
    const { approval: first } = await call("request_approval", { ...P, key: "FIL-I1-1", action: "done", reason: "merged and deployed" });
    const rejected = await decide([first.id], "reject", "not yet");
    assert.equal(rejected.results[0].state, "rejected");
    const r1 = await call("set_task", { ...P, key: "FIL-I1-1", status: "Done", version: await v(), approval_id: first.id });
    assert.equal(r1.__error, "APPROVAL_NOT_GRANTED");
    assert.equal(r1.state, "rejected");
    assert.equal((await decide([first.id], "grant")).results[0].error, "APPROVAL_NOT_GRANTED", "a decided approval is final");
    assert.equal((await call("set_task", { ...P, key: "FIL-I1-1", status: "Done", version: await v(), approval_id: "00000000-0000-0000-0000-000000000000" })).__error, "APPROVAL_NOT_FOUND");

    const { approval: second } = await call("request_approval", { ...P, key: "FIL-I1-1", action: "done", reason: "merged and deployed" });
    assert.notEqual(second.id, first.id);
    await decide([second.id], "grant");
    const wrongAction = await call("set_task", { ...P, key: "FIL-I1-1", status: "Won't do", version: await v(), approval_id: second.id });
    assert.equal(wrongAction.__error, "APPROVAL_MISMATCH");
    await call("create_task", { ...P, title: "Other", ...T, parent_key: "FIL-I1", phase: 2 }); // FIL-I1-2
    const wrongKey = await call("set_task", { ...P, key: "FIL-I1-2", status: "Done", version: 1, approval_id: second.id });
    assert.equal(wrongKey.__error, "APPROVAL_MISMATCH");

    const done = await call("set_task", { ...P, key: "FIL-I1-1", status: "Done", version: await v(), approval_id: second.id });
    assert.equal(done.status, "Done");
    assert.equal(await eventsOf("approval.used"), 2);
    assert.equal(await eventsOf("task.approved_move"), 1);
    const reopen = await call("set_task", { ...P, key: "FIL-I1-1", status: "Ready", version: await v(), approval_id: second.id });
    assert.equal(reopen.__error, "APPROVAL_MISMATCH", "a done approval does not reopen");
  });

  test("an initiative closes only once its tickets are closed", async () => {
    const { approval } = await call("request_approval", { ...P, key: "FIL-I1", action: "done", reason: "shipped" });
    await decide([approval.id], "grant");
    const v = (await call("get_task", { ...P, key: "FIL-I1", view: "summary" })).version;
    const r = await call("set_task", { ...P, key: "FIL-I1", status: "Done", version: v, approval_id: approval.id });
    assert.equal(r.__error, "INITIATIVE_CHILDREN_OPEN");
    assert.deepEqual(r.open, ["FIL-I1-2"]);
  });
});

describe("the inbox on screen", () => {
  test("lists questions and approvals across projects, oldest first per kind, and batch-decides with one event each", async () => {
    await call("ask", { ...P, key: "FIL-I1-2", question: "Keep the old column?", options: ["Yes", "No"] });
    await call("create_task", { project: "micasa", title: "Loose", ...T });
    const a1 = (await call("request_approval", { project: "micasa", key: "MIC-01", action: "wont_do", reason: "obsolete" })).approval;
    const a2 = (await call("request_approval", { ...P, key: "FIL-I1-2", action: "wont_do", reason: "folded into F1" })).approval;
    const all = (await (await req("GET", "/api/inbox")).json()) as Json;
    assert.equal(all.count, 3);
    assert.deepEqual(all.items.map((i: Json) => [i.kind, i.project]), [["approval", "filmia"], ["question", "filmia"], ["approval", "micasa"]]);
    assert.deepEqual(all.by_project, { filmia: 2, micasa: 1 });
    assert.ok(all.items.every((i: Json) => typeof i.wait_s === "number" && i.waiting_since.endsWith("Z")));
    const one = (await (await req("GET", "/api/inbox?project=micasa")).json()) as Json;
    assert.equal(one.count, 1);
    assert.equal(one.items[0].why, "obsolete");

    const before = await eventsOf("approval.granted");
    const out = await decide([a1.id, a2.id, "00000000-0000-0000-0000-000000000000"], "grant");
    assert.equal(out.decided, 2);
    assert.equal(out.results[2].error, "APPROVAL_NOT_FOUND");
    assert.equal(await eventsOf("approval.granted"), before + 2);
    assert.equal((await (await req("GET", "/api/inbox")).json() as Json).count, 1, "only the question is left");
    assert.equal((await req("POST", "/api/approvals/decide", { ids: [], decision: "grant" })).status, 400);
  });
});
