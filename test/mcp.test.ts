// Integration tests for the 12 MCP tools against a throwaway local database.
// Run: pnpm test  (needs a local Postgres; rebuilds plania_test from the migrations each run)
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { userInfo } from "node:os";
import { after, before, describe, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import pg from "pg";

const ADMIN_URL = `postgres://${userInfo().username}@localhost:5432/postgres`;
const TEST_DB = "plania_test";
process.env.DATABASE_URL = `postgres://${userInfo().username}@localhost:5432/${TEST_DB}`;
process.env.MCP_BEARER_TOKEN = "test-token";

const { makeDb } = await import("../src/db/client.js");
const { createMcpServer } = await import("../src/mcp/register.js");
const { app } = await import("../src/app.js");

let client: Client;
let raw: pg.Client;
let closeDb: () => Promise<void>;

type Json = Record<string, any>;

async function call(name: string, args: Json): Promise<Json> {
  const r = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: { text: string }[] };
  const data = JSON.parse(r.content[0]!.text);
  return r.isError ? { __error: data.error, __status: data.status } : data;
}

async function expectError(name: string, args: Json, code: string, status: number) {
  const r = await call(name, args);
  assert.equal(r.__error, code, `${name} should fail with ${code}, got ${JSON.stringify(r)}`);
  assert.equal(r.__status, status);
}

async function resolvedAt(key: string): Promise<Date | null> {
  const { rows } = await raw.query("select resolved_at from tasks where key = $1", [key]);
  return rows[0].resolved_at;
}

before(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${TEST_DB} with (force)`);
  await admin.query(`create database ${TEST_DB}`);
  await admin.end();

  raw = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await raw.connect();
  const dir = new URL("../drizzle/migrations/", import.meta.url);
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    await raw.query(readFileSync(new URL(f, dir), "utf8"));
  }
  await raw.query(
    "insert into projects (slug, title) values ('micasa','MiCasa'), ('workia','Workia'), ('filmia','Filmia'), ('zigzag','Zigzag')",
  );

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

test("exposes exactly the 12 contract tools", async () => {
  const names = (await client.listTools()).tools.map((t) => t.name).sort();
  assert.deepEqual(names, [
    "add_decision", "create_initiative", "create_task", "get_memory", "get_next", "get_project",
    "get_resume", "get_task", "list_tasks", "set_initiative", "set_task", "update_resume",
  ]);
});

describe("HTTP /mcp", () => {
  const rpc = { jsonrpc: "2.0", id: 1, method: "tools/list" };
  const headers = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };

  test("rejects a missing or wrong Bearer with 401", async () => {
    for (const auth of [undefined, "Bearer nope", "test-token"]) {
      const res = await app.request("/mcp", {
        method: "POST",
        headers: auth ? { ...headers, Authorization: auth } : headers,
        body: JSON.stringify(rpc),
      });
      assert.equal(res.status, 401);
      assert.deepEqual(await res.json(), { error: "UNAUTHORIZED" });
    }
  });

  test("serves tools/list with the right Bearer", async () => {
    const res = await app.request("/mcp", {
      method: "POST",
      headers: { ...headers, Authorization: "Bearer test-token" },
      body: JSON.stringify(rpc),
    });
    assert.equal(res.status, 200);
    assert.equal(((await res.json()) as Json).result.tools.length, 12);
  });
});

describe("update_resume", () => {
  test("replaces all four fields and returns the get_resume shape", async () => {
    const card = { in_progress: "A", next_action: "B", branch_or_prod: "main", must_keep_decision: "D" };
    assert.deepEqual(await call("update_resume", { project: "workia", ...card }), { project: "workia", ...card });
    const blank = { in_progress: "", next_action: "", branch_or_prod: "", must_keep_decision: "" };
    await call("update_resume", { project: "workia", ...blank });
    assert.deepEqual(await call("get_resume", { project: "workia" }), { project: "workia", ...blank });
  });

  test("unknown project is PROJECT_NOT_FOUND", async () => {
    const card = { in_progress: "", next_action: "", branch_or_prod: "", must_keep_decision: "" };
    await expectError("update_resume", { project: "nope", ...card }, "PROJECT_NOT_FOUND", 404);
  });
});

describe("create_initiative", () => {
  test("defaults to Planning, main, no parent", async () => {
    const t = await call("create_initiative", { project: "micasa", key: "MIC-01", title: "Init", body: "PRD" });
    assert.equal(t.kind, "initiative");
    assert.equal(t.status, "Planning");
    assert.equal(t.base_branch, "main");
    assert.equal(t.parent_key, null);
    assert.equal(t.priority, null);
    assert.equal(t.origin, null);
    assert.equal(t.summary, "");
  });

  test("honours base_branch and rejects a duplicate key", async () => {
    const t = await call("create_initiative", {
      project: "micasa", key: "MIC-02", title: "Other", body: "", base_branch: "sandbox", summary: "one line",
    });
    assert.equal(t.base_branch, "sandbox");
    assert.equal(t.summary, "one line");
    await expectError("create_initiative", { project: "micasa", key: "MIC-01", title: "x", body: "" }, "KEY_EXISTS", 409);
    await expectError("create_initiative", { project: "nope", key: "X", title: "x", body: "" }, "PROJECT_NOT_FOUND", 404);
  });
});

describe("create_task", () => {
  test("defaults: ticket, Backlog, P2, chartered under a Planning parent", async () => {
    const t = await call("create_task", { project: "micasa", key: "MIC-01-F1", title: "F1", body: "Phase 1", parent_key: "MIC-01" });
    assert.equal(t.kind, "ticket");
    assert.equal(t.status, "Backlog");
    assert.equal(t.priority, "P2");
    assert.equal(t.origin, "chartered");
    assert.equal(t.parent_key, "MIC-01");
    const parent = await call("get_task", { project: "micasa", key: "MIC-01" });
    assert.deepEqual(parent.child_keys, ["MIC-01-F1"]);
  });

  test("standalone spec has no parent and is chartered", async () => {
    const t = await call("create_task", { project: "micasa", key: "MIC-B-01", title: "Spec", body: "" });
    assert.equal(t.parent_key, null);
    assert.equal(t.origin, "chartered");
  });

  test("discovered when the parent is Active or Shipping, unless overridden", async () => {
    await call("set_initiative", { project: "micasa", key: "MIC-02", status: "Active" });
    const found = await call("create_task", { project: "micasa", key: "MIC-02-F1", title: "x", body: "", parent_key: "MIC-02" });
    assert.equal(found.origin, "discovered");
    const forced = await call("create_task", {
      project: "micasa", key: "MIC-02-F2", title: "x", body: "", parent_key: "MIC-02", origin: "chartered",
    });
    assert.equal(forced.origin, "chartered");
    await call("set_initiative", { project: "micasa", key: "MIC-02", status: "Shipping" });
    const shipping = await call("create_task", { project: "micasa", key: "MIC-02-F3", title: "x", body: "", parent_key: "MIC-02" });
    assert.equal(shipping.origin, "discovered");
  });

  test("validation errors", async () => {
    const base = { project: "micasa", title: "x", body: "" };
    await expectError("create_task", { ...base, key: "MIC-01-F1" }, "KEY_EXISTS", 409);
    await expectError("create_task", { ...base, key: "N1", parent_key: "MIC-01-F1" }, "PARENT_MUST_BE_INITIATIVE", 400);
    await expectError("create_task", { ...base, key: "N2", parent_key: "MISSING" }, "TASK_NOT_FOUND", 404);
    await expectError("create_task", { ...base, key: "N3", blocked_by: ["MISSING"] }, "BLOCKER_NOT_FOUND", 400);
    await expectError("create_task", { ...base, key: "N4", blocked_by: ["N4"] }, "BLOCKER_NOT_FOUND", 400);
    await expectError("create_task", { ...base, key: "N5", priority: "P9" }, "INVALID_PRIORITY", 400);
    await expectError("create_task", { ...base, key: "N6", status: "Planning" }, "INVALID_STATUS", 400);
    await expectError("create_task", { ...base, key: "N7", status: "Blocked" }, "BLOCKED_REQUIRES_NOTE", 400);
    await expectError("create_task", { ...base, project: "nope", key: "N8" }, "PROJECT_NOT_FOUND", 404);
    const list = await call("list_tasks", { project: "micasa" });
    assert.ok(!list.tasks.some((t: Json) => t.key.startsWith("N")), "failed creates must not leave rows");
  });

  test("blockers in another project are not found", async () => {
    await call("create_task", { project: "workia", key: "WRK-B-01", title: "x", body: "" });
    await expectError(
      "create_task", { project: "micasa", key: "N9", title: "x", body: "", blocked_by: ["WRK-B-01"] }, "BLOCKER_NOT_FOUND", 400,
    );
  });
});

describe("handoff cycle: create → get_next → In progress → In review", () => {
  test("runs end to end", async () => {
    await call("create_initiative", { project: "filmia", key: "FIL-01", title: "Init", body: "PRD" });
    await call("create_task", { project: "filmia", key: "FIL-01-F1", title: "F1", body: "Phase 1", parent_key: "FIL-01" });
    const f2 = await call("create_task", {
      project: "filmia", key: "FIL-01-F2", title: "F2", body: "Phase 2", parent_key: "FIL-01", blocked_by: ["FIL-01-F1"],
    });
    assert.deepEqual(f2.blocked_by, ["FIL-01-F1"]);

    assert.equal((await call("get_next", { project: "filmia" })).task.key, "FIL-01-F1");

    const claimed = await call("set_task", {
      project: "filmia", key: "FIL-01-F1", status: "In progress", note: "claimed by test-agent",
    });
    assert.equal(claimed.status, "In progress");
    assert.match(claimed.body, /^Phase 1\n- \d{4}-\d{2}-\d{2} · claimed by test-agent$/);

    assert.deepEqual(await call("get_next", { project: "filmia" }), { task: null }, "F2 stays blocked while F1 is In progress");

    const reviewed = await call("set_task", {
      project: "filmia", key: "FIL-01-F1", status: "In review", branch: "feat/f1",
      pr_url: "https://github.com/Jorg3L3on/filmia/pull/1", note: "Result: ✓ unit — 12 tests pass",
    });
    assert.equal(reviewed.status, "In review");
    assert.equal(reviewed.branch, "feat/f1");
    assert.equal(reviewed.pr_url, "https://github.com/Jorg3L3on/filmia/pull/1");
    assert.match(reviewed.body.split("\n").at(-1), /^- \d{4}-\d{2}-\d{2} · Result: ✓ unit — 12 tests pass$/);
    assert.equal(await resolvedAt("FIL-01-F1"), null, "In review is not Done");

    const next = await call("get_next", { project: "filmia" });
    assert.equal(next.task.key, "FIL-01-F2", "In review unblocks");
    assert.deepEqual(next.task.blocked_by, ["FIL-01-F1"]);

    const counts = (await call("get_project", { project: "filmia" })).counts;
    assert.deepEqual(counts, { chartered: 2, charteredSettled: 1, found: 0, foundOpen: 0 });
  });
});

describe("set_task", () => {
  test("Blocked requires a note and stores it; leaving Blocked clears it", async () => {
    await expectError("set_task", { project: "micasa", key: "MIC-B-01", status: "Blocked" }, "BLOCKED_REQUIRES_NOTE", 400);
    await expectError("set_task", { project: "micasa", key: "MIC-B-01", status: "Blocked", note: "  " }, "BLOCKED_REQUIRES_NOTE", 400);
    const blocked = await call("set_task", { project: "micasa", key: "MIC-B-01", status: "Blocked", note: "waiting on bank API" });
    assert.equal(blocked.blocked_note, "waiting on bank API");
    assert.equal(blocked.body, "", "a Blocked note is not appended to body");
    const ready = await call("set_task", { project: "micasa", key: "MIC-B-01", status: "Ready" });
    assert.equal(ready.blocked_note, null);
  });

  test("Done sets resolved_at; leaving Done clears it", async () => {
    await call("set_task", { project: "micasa", key: "MIC-B-01", status: "Done" });
    const first = await resolvedAt("MIC-B-01");
    assert.ok(first instanceof Date);
    await call("set_task", { project: "micasa", key: "MIC-B-01", status: "Done", summary: "again" });
    assert.deepEqual(await resolvedAt("MIC-B-01"), first, "re-marking Done keeps the first timestamp");
    await call("set_task", { project: "micasa", key: "MIC-B-01", status: "In review" });
    assert.equal(await resolvedAt("MIC-B-01"), null);
  });

  test("blocked_by replaces the list; [] clears it", async () => {
    let t = await call("set_task", { project: "micasa", key: "MIC-01-F1", blocked_by: ["MIC-B-01", "MIC-02-F1"] });
    assert.deepEqual(t.blocked_by, ["MIC-02-F1", "MIC-B-01"]);
    t = await call("set_task", { project: "micasa", key: "MIC-01-F1", blocked_by: ["MIC-B-01"] });
    assert.deepEqual(t.blocked_by, ["MIC-B-01"]);
    t = await call("set_task", { project: "micasa", key: "MIC-01-F1", blocked_by: [] });
    assert.deepEqual(t.blocked_by, []);
    await expectError("set_task", { project: "micasa", key: "MIC-01-F1", blocked_by: ["MIC-01-F1"] }, "BLOCKER_NOT_FOUND", 400);
  });

  test("moves between parents and detaches with null", async () => {
    let t = await call("set_task", { project: "micasa", key: "MIC-01-F1", parent_key: "MIC-02" });
    assert.equal(t.parent_key, "MIC-02");
    assert.equal(t.origin, "chartered", "moving does not change origin");
    t = await call("set_task", { project: "micasa", key: "MIC-01-F1", parent_key: null });
    assert.equal(t.parent_key, null);
    t = await call("set_task", { project: "micasa", key: "MIC-01-F1", parent_key: "MIC-01" });
    assert.equal(t.parent_key, "MIC-01");
    await expectError("set_task", { project: "micasa", key: "MIC-01-F1", parent_key: "MIC-B-01" }, "PARENT_MUST_BE_INITIATIVE", 400);
  });

  test("body replace, then note appends to the new body", async () => {
    const t = await call("set_task", { project: "micasa", key: "MIC-02-F2", body: "New scope\n", note: "re-scoped" });
    assert.match(t.body, /^New scope\n- \d{4}-\d{2}-\d{2} · re-scoped$/);
  });

  test("initiatives take text fields but not ticket-only fields", async () => {
    const t = await call("set_task", { project: "micasa", key: "MIC-01", summary: "s", body: "PRD v2" });
    assert.equal(t.summary, "s");
    assert.equal(t.body, "PRD v2");
    await expectError("set_task", { project: "micasa", key: "MIC-01", priority: "P1" }, "INVALID_PRIORITY", 400);
    await expectError("set_task", { project: "micasa", key: "MIC-01", status: "In review" }, "INVALID_STATUS", 400);
    await expectError("set_task", { project: "micasa", key: "MIC-01", parent_key: "MIC-02" }, "PARENT_MUST_BE_INITIATIVE", 400);
  });

  test("validation errors", async () => {
    await expectError("set_task", { project: "micasa", key: "MIC-01-F1", status: "Active" }, "INVALID_STATUS", 400);
    await expectError("set_task", { project: "micasa", key: "MIC-01-F1", priority: "high" }, "INVALID_PRIORITY", 400);
    await expectError("set_task", { project: "micasa", key: "NOPE" }, "TASK_NOT_FOUND", 404);
    await expectError("set_task", { project: "nope", key: "MIC-01-F1" }, "PROJECT_NOT_FOUND", 404);
  });

  test("priority ordering in list_tasks follows updates", async () => {
    await call("set_task", { project: "micasa", key: "MIC-02-F3", priority: "P0" });
    const keys = (await call("list_tasks", { project: "micasa", kind: "ticket" })).tasks.map((t: Json) => t.key);
    assert.equal(keys[0], "MIC-02-F3");
  });
});

describe("set_initiative", () => {
  test("sets initiative statuses and stamps Done", async () => {
    const t = await call("set_initiative", { project: "micasa", key: "MIC-01", status: "Done" });
    assert.equal(t.status, "Done");
    assert.ok((await resolvedAt("MIC-01")) instanceof Date);
    await call("set_initiative", { project: "micasa", key: "MIC-01", status: "On hold" });
    assert.equal(await resolvedAt("MIC-01"), null);
  });

  test("errors", async () => {
    await expectError("set_initiative", { project: "micasa", key: "MIC-01-F1", status: "Done" }, "NOT_INITIATIVE", 400);
    await expectError("set_initiative", { project: "micasa", key: "MIC-01", status: "Ready" }, "INVALID_STATUS", 400);
    await expectError("set_initiative", { project: "micasa", key: "NOPE", status: "Done" }, "TASK_NOT_FOUND", 404);
  });
});

describe("add_decision", () => {
  test("logs a line without touching the resume card", async () => {
    const r = await call("add_decision", { project: "zigzag", line: "Keep slug zigzag in v1" });
    assert.equal(r.decision.line, "Keep slug zigzag in v1");
    assert.equal(r.decision.adr_url, null);
    assert.ok(r.decision.id && r.decision.created_at);
    assert.equal("resume" in r, false);
    assert.equal((await call("get_resume", { project: "zigzag" })).must_keep_decision, "");
  });

  test("pin_to_resume writes must_keep_decision and keeps the other fields", async () => {
    await call("update_resume", {
      project: "zigzag", in_progress: "ip", next_action: "na", branch_or_prod: "main", must_keep_decision: "old",
    });
    const r = await call("add_decision", {
      project: "zigzag", line: "Receipts stay offline-first", adr_url: "https://example.test/adr/0001", pin_to_resume: true,
    });
    assert.deepEqual(r.resume, {
      project: "zigzag", in_progress: "ip", next_action: "na", branch_or_prod: "main", must_keep_decision: "Receipts stay offline-first",
    });
    const memory = await call("get_memory", { project: "zigzag" });
    assert.deepEqual(memory.decisions.map((d: Json) => d.line), ["Receipts stay offline-first", "Keep slug zigzag in v1"]);
    assert.equal(memory.decisions[0].adr_url, "https://example.test/adr/0001");
  });

  test("unknown project is PROJECT_NOT_FOUND", async () => {
    await expectError("add_decision", { project: "nope", line: "x" }, "PROJECT_NOT_FOUND", 404);
  });
});
