// Integration tests for the MCP tools (v2 contract) against a throwaway local database.
// Run: pnpm test  (needs a local Postgres; rebuilds this checkout's plania_test_<hash> database from the migrations each run)
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type pg from "pg";
import { TEST_BEARER, resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const { makeDb } = await import("../src/db/client.js");
const { createMcpServer } = await import("../src/mcp/register.js");
const { app } = await import("../src/app.js");
const { bus } = await import("../src/events.js");
const { webCtx } = await import("../src/mcp/tx.js");
const { setTask } = await import("../src/mcp/writes.js");

let client: Client;
let raw: pg.Client;
let closeDb: () => Promise<void>;

type Json = Record<string, any>;

// Default actor for writes; a test that needs another session passes its own.
const A = { agent: "test-agent", session_id: "s1", machine: "ci" };
const READ_TOOLS = new Set(["get_resume", "get_project", "list_tasks", "get_task", "get_memory", "get_next", "get_doc", "list_events"]);

// set_task needs the version the caller read. Tests that are not about versions get the current one
// filled in; version: "none" sends the call without one.
async function currentVersion(project: string, key: string): Promise<number | undefined> {
  const { rows } = await raw.query(
    `select t.version from tasks t join projects p on p.id = t.project_id
     where p.slug = $1 and (t.key = $2 or t.id = (select a.task_id from task_aliases a where a.project_id = p.id and a.alias = $2))`,
    [project, key],
  );
  return rows[0]?.version;
}

// Tickets must follow the template (scope, and checks for code/ops). Tests that are not about it get a
// minimal one filled in; template: false sends the call as written.
function withTemplate(args: Json): Json {
  if (args.template === false) {
    const { template: _, ...rest } = args;
    return rest;
  }
  if (args.kind === "initiative") return args;
  return { ...args, scope: args.scope ?? "Test scope", checks: args.checks ?? ["Done"] };
}

// Writes answer {key, status, version, changed, ...} by default (2.1). Tests that are not about the
// reply shape ask for verbose and get the full task merged in; verbose: "default" sends the call as is.
// get_task leaves the log out by default; tests read it with include_log unless they say "default".
async function call(name: string, args: Json): Promise<Json> {
  if (!READ_TOOLS.has(name) && !("actor" in args)) args = { ...args, actor: A };
  if (name === "create_task") args = withTemplate(args);
  if (name === "set_task" && args.version === undefined) args = { ...args, version: await currentVersion(args.project, args.key) };
  if (args.version === "none") {
    const { version: _, ...rest } = args;
    args = rest;
  }
  if (!READ_TOOLS.has(name) && args.verbose === undefined) args = { ...args, verbose: true };
  if (args.verbose === "default") {
    const { verbose: _, ...rest } = args;
    args = rest;
  }
  if (name === "get_task" && args.include_log === undefined) args = { ...args, include_log: true };
  // In review and Done need every check closed (2.1). Tests that are not about that get them ticked;
  // open_checks: true leaves them as they are.
  if (name === "set_task" && (args.status === "In review" || args.status === "Done") && args.open_checks !== true) {
    await raw.query(
      `update checks set done = true where done = false and waived_at is null and task_id = (
         select t.id from tasks t join projects p on p.id = t.project_id where p.slug = $1 and t.key = $2)`,
      [args.project, args.key],
    );
  }
  if (args.open_checks !== undefined) {
    const { open_checks: _, ...rest } = args;
    args = rest;
  }
  if (args.include_log === "default") {
    const { include_log: _, ...rest } = args;
    args = rest;
  }
  const r = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: { text: string }[] };
  const data = JSON.parse(r.content[0]!.text);
  if (r.isError) return { __error: data.error, __status: data.status };
  return data.task ? { ...data, ...data.task } : data;
}

// The last log line of a task, read back (writes no longer embed the log).
async function logOf(project: string, key: string): Promise<Json[]> {
  return (await call("get_task", { project, key })).log;
}

async function expectError(name: string, args: Json, code: string, status: number) {
  const r = await call(name, args);
  assert.equal(r.__error, code, `${name} should fail with ${code}, got ${JSON.stringify(r)}`);
  assert.equal(r.__status, status);
}

async function eventCount(): Promise<number> {
  const { rows } = await raw.query("select count(*)::int as n from events");
  return rows[0].n;
}

const lastLog = async (project: string, key: string): Promise<Json> => (await logOf(project, key)).at(-1)!;

const MOVE = { reason: "él lo pidió", delegated_by_jorge: { message_id: "msg-owner-9001", quote: "haz ese cambio de estado" } };

// A move from the screen, as Jorge: any status. Checks still apply to Done, so they get ticked.
// Won't do and reopening need a reason; the screen session is the evidence.
async function asJorge(project: string, key: string, status: string): Promise<void> {
  await raw.query(
    `update checks set done = true where done = false and waived_at is null and task_id = (
       select t.id from tasks t join projects p on p.id = t.project_id where p.slug = $1 and t.key = $2)`,
    [project, key],
  );
  const { db, close } = makeDb();
  try {
    const reason = status === "Won't do" || status === "Done" ? "en pantalla" : undefined;
    await setTask(db, { project, key, status, version: await currentVersion(project, key), ...(reason ? { reason } : {}) }, webCtx);
  } finally {
    await close();
  }
}

async function resolvedAt(key: string): Promise<Date | null> {
  const { rows } = await raw.query("select resolved_at from tasks where key = $1", [key]);
  return rows[0].resolved_at;
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

// The full tool surface. Update with the contract.
const TOOLS = [
  "add_decision", "add_result", "answer", "answer_delegated", "ask", "assign", "attach_doc", "audit", "batch", "check_in", "claim", "comment", "consume", "create_company_project", "create_task", "finish",
  "get_context", "get_digest", "get_doc", "get_inbox", "get_memory", "get_next", "get_project", "get_resume", "get_running", "get_task", "handoff", "lease_resource",
  "list_agents", "list_events", "list_goals", "list_heartbeat_runs", "list_projects", "list_routine_runs", "list_tasks", "propose", "record_routine_run", "register_footprint", "release_footprint", "release_resource", "report_tokens", "reserve_sequence", "retire_decision", "set_agent", "set_check", "set_env",
  "set_goal", "set_metric", "set_project", "set_scan_allowlist", "set_task", "start", "thread_post", "thread_read", "usage_summary", "waive_check", "wake_agent",
];

test("exposes exactly the contract tools", async () => {
  const names = (await client.listTools()).tools.map((t) => t.name).sort();
  assert.deepEqual(names, TOOLS);
});

describe("HTTP /mcp", () => {
  const rpc = { jsonrpc: "2.0", id: 1, method: "tools/list" };
  const headers = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };

  test("rejects a missing or wrong Bearer with 401", async () => {
    for (const auth of [undefined, "Bearer nope", TEST_BEARER, "Bearer test-ci-token"]) {
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
      headers: { ...headers, Authorization: `Bearer ${TEST_BEARER}` },
      body: JSON.stringify(rpc),
    });
    assert.equal(res.status, 200);
    assert.equal(((await res.json()) as Json).result.tools.length, TOOLS.length);
  });
});

describe("create_task kind initiative", () => {
  test("defaults to Planning, main, no parent", async () => {
    const t = await call("create_task", { project: "micasa", kind: "initiative", key: "MIC-01", title: "Init", scope: "PRD" });
    assert.equal(t.kind, "initiative");
    assert.equal(t.status, "Planning");
    assert.equal(t.base_branch, "main");
    assert.equal(t.parent_key, null);
    assert.equal(t.priority, null);
    assert.equal(t.origin, null);
    assert.equal(t.summary, "");
  });

  test("honours base_branch and rejects a duplicate key", async () => {
    const t = await call("create_task", {
      project: "micasa", kind: "initiative", key: "MIC-02", title: "Other", base_branch: "sandbox", summary: "one line",
      next_action: "Write F1",
    });
    assert.equal(t.base_branch, "sandbox");
    assert.equal(t.summary, "one line");
    assert.equal(t.next_action, "Write F1");
    const init = { project: "micasa", kind: "initiative", title: "x" };
    await expectError("create_task", { ...init, key: "MIC-01" }, "KEY_EXISTS", 409);
    await expectError("create_task", { ...init, project: "nope", key: "X" }, "PROJECT_NOT_FOUND", 404);
    await expectError("create_task", { ...init, key: "MIC-09", priority: "P1" }, "FIELD_NOT_ALLOWED", 400);
    await expectError("create_task", { ...init, key: "MIC-09", parent_key: "MIC-01" }, "FIELD_NOT_ALLOWED", 400);
    await expectError("create_task", { ...init, key: "MIC-09", status: "Active" }, "INVALID_STATUS", 400);
    await expectError("create_task", { project: "micasa", key: "MIC-09", title: "x", next_action: "n" }, "FIELD_NOT_ALLOWED", 400);
  });
});

describe("create_task", () => {
  test("defaults: ticket, Backlog, P2, chartered under a Planning parent", async () => {
    const t = await call("create_task", { project: "micasa", key: "MIC-01-F1", title: "F1", scope: "Phase 1", parent_key: "MIC-01" });
    assert.equal(t.kind, "ticket");
    assert.equal(t.status, "Backlog");
    assert.equal(t.priority, "P2");
    assert.equal(t.origin, "chartered");
    assert.equal(t.parent_key, "MIC-01");
    const parent = await call("get_task", { project: "micasa", key: "MIC-01" });
    assert.deepEqual(parent.child_keys, ["MIC-01-F1"]);
  });

  test("standalone spec has no parent and is chartered", async () => {
    const t = await call("create_task", { project: "micasa", key: "MIC-B-01", title: "Spec" });
    assert.equal(t.parent_key, null);
    assert.equal(t.origin, "chartered");
  });

  test("discovered when the parent is Active or Shipping, unless overridden", async () => {
    await call("set_task", { project: "micasa", key: "MIC-02", status: "Active" });
    const found = await call("create_task", { project: "micasa", key: "MIC-02-F1", title: "x", parent_key: "MIC-02" });
    assert.equal(found.origin, "discovered");
    const forced = await call("create_task", {
      project: "micasa", key: "MIC-02-F2", title: "x", parent_key: "MIC-02", origin: "chartered",
    });
    assert.equal(forced.origin, "chartered");
    await call("set_task", { project: "micasa", key: "MIC-02", status: "Shipping" });
    const shipping = await call("create_task", { project: "micasa", key: "MIC-02-F3", title: "x", parent_key: "MIC-02" });
    assert.equal(shipping.origin, "discovered");
  });

  test("validation errors", async () => {
    const base = { project: "micasa", title: "x" };
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
    await call("create_task", { project: "workia", key: "WRK-B-01", title: "x" });
    await expectError(
      "create_task", { project: "micasa", key: "N9", title: "x", blocked_by: ["WRK-B-01"] }, "BLOCKER_NOT_FOUND", 400,
    );
  });
});

describe("handoff cycle: create → get_next → In progress → In review", () => {
  test("runs end to end", async () => {
    await call("create_task", { project: "filmia", kind: "initiative", key: "FIL-01", title: "Init", scope: "PRD" });
    await call("create_task", { project: "filmia", key: "FIL-01-F1", title: "F1", scope: "Phase 1", parent_key: "FIL-01" });
    const f2 = await call("create_task", {
      project: "filmia", key: "FIL-01-F2", title: "F2", scope: "Phase 2", parent_key: "FIL-01", blocked_by: ["FIL-01-F1"],
    });
    assert.deepEqual(f2.blocked_by, [{ type: "task", task: "FIL-01-F1", status: "Backlog", satisfied: false }]);

    assert.equal((await call("get_next", { project: "filmia" })).task.key, "FIL-01-F1");

    await expectError("set_task", { project: "filmia", key: "FIL-01-F1", status: "In progress" }, "INVALID_TRANSITION", 409);
    const claimed = await call("claim", { project: "filmia", key: "FIL-01-F1" });
    assert.equal(claimed.status, "In progress");
    assert.deepEqual(claimed.claim.owner, A);
    assert.equal((await lastLog("filmia", "FIL-01-F1")).type, "claim.acquired");
    const noted = await call("set_task", { project: "filmia", key: "FIL-01-F1", note: "started", version: "none" });
    assert.equal(noted.scope, "Phase 1", "notes never touch scope");
    assert.equal((await lastLog("filmia", "FIL-01-F1")).payload.text, "started");

    assert.deepEqual(await call("get_next", { project: "filmia" }), { task: null }, "F2 stays blocked while F1 is In progress");

    await call("add_result", { project: "filmia", key: "FIL-01-F1", kind: "unit", verdict: "pass", cite: "12 tests pass" });
    const reviewed = await call("set_task", {
      project: "filmia", key: "FIL-01-F1", status: "In review", branch: "feat/f1",
      pr_url: "https://github.com/Jorg3L3on/filmia/pull/1", note: "Result: ✓ unit — 12 tests pass",
    });
    assert.equal(reviewed.status, "In review");
    assert.equal(reviewed.claim, null, "In review releases the lease");
    assert.equal(reviewed.branch, "feat/f1");
    assert.equal(reviewed.pr_url, "https://github.com/Jorg3L3on/filmia/pull/1");
    assert.equal((await lastLog("filmia", "FIL-01-F1")).payload.text, "Result: ✓ unit — 12 tests pass");
    assert.equal(await resolvedAt("FIL-01-F1"), null, "In review is not Done");

    const next = await call("get_next", { project: "filmia" });
    assert.equal(next.task.key, "FIL-01-F2", "In review unblocks");
    assert.deepEqual(next.task.blocked_by, [{ type: "task", task: "FIL-01-F1", status: "In review", satisfied: true }]);

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
    assert.equal(blocked.scope, "Test scope", "a Blocked note is not appended to scope");
    const ready = await call("set_task", { project: "micasa", key: "MIC-B-01", status: "Ready" });
    assert.equal(ready.blocked_note, null);
  });

  test("Done sets resolved_at; leaving Done clears it", async () => {
    await asJorge("micasa", "MIC-B-01", "Done");
    const first = await resolvedAt("MIC-B-01");
    assert.ok(first instanceof Date);
    await call("set_task", { project: "micasa", key: "MIC-B-01", status: "Done", summary: "again" });
    assert.deepEqual(await resolvedAt("MIC-B-01"), first, "re-marking Done keeps the first timestamp");
    await call("set_task", { project: "micasa", key: "MIC-B-01", status: "Ready", ...MOVE, delegated_by_jorge: { message_id: "msg-owner-9002", quote: "vuelve a dejarlo en ready" } });
    assert.equal(await resolvedAt("MIC-B-01"), null);
  });

  test("blocked_by replaces the list; [] clears it", async () => {
    let t = await call("set_task", { project: "micasa", key: "MIC-01-F1", blocked_by: ["MIC-B-01", "MIC-02-F1"] });
    const keys = (t: Json) => t.blocked_by.map((b: Json) => b.task);
    assert.deepEqual(keys(t), ["MIC-02-F1", "MIC-B-01"]);
    t = await call("set_task", { project: "micasa", key: "MIC-01-F1", blocked_by: ["MIC-B-01"] });
    assert.deepEqual(keys(t), ["MIC-B-01"]);
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

  test("scope replace, then the note goes to the log", async () => {
    const t = await call("set_task", { project: "micasa", key: "MIC-02-F2", scope: "New scope\n", note: "re-scoped" });
    assert.equal(t.scope, "New scope\n");
    assert.deepEqual(t.changed, ["scope", "note"]);
    const log = await logOf("micasa", "MIC-02-F2");
    assert.deepEqual(log.slice(-2).map((e: Json) => e.type), ["task.updated", "note"]);
    assert.deepEqual(log.at(-1)!.actor, A);
  });

  test("initiatives take their own fields but not ticket-only fields", async () => {
    const t = await call("set_task", {
      project: "micasa", key: "MIC-01", summary: "s", scope: "PRD v2", next_action: "Ship F1", in_progress_note: "F1 underway",
    });
    assert.equal(t.summary, "s");
    assert.equal(t.scope, "PRD v2");
    assert.equal(t.next_action, "Ship F1");
    assert.equal(t.in_progress_note, "F1 underway");
    await expectError("set_task", { project: "micasa", key: "MIC-01", priority: "P1" }, "FIELD_NOT_ALLOWED", 400);
    await expectError("set_task", { project: "micasa", key: "MIC-01", status: "In review" }, "INVALID_STATUS", 400);
    await expectError("set_task", { project: "micasa", key: "MIC-01", parent_key: "MIC-02" }, "FIELD_NOT_ALLOWED", 400);
    await expectError("set_task", { project: "micasa", key: "MIC-01-F1", next_action: "x" }, "FIELD_NOT_ALLOWED", 400);
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

describe("initiative status through set_task", () => {
  test("sets initiative statuses and stamps Done; an initiative with open tickets cannot close", async () => {
    const r = await call("set_task", { project: "micasa", key: "MIC-01", status: "Done" });
    assert.equal(r.__error, "INITIATIVE_CHILDREN_OPEN");
    await call("create_task", { project: "micasa", kind: "initiative", key: "MIC-I-DONE", title: "Closed out", scope: "PRD" });
    const t = await call("set_task", { project: "micasa", key: "MIC-I-DONE", status: "Done" });
    assert.equal(t.status, "Done");
    assert.ok((await resolvedAt("MIC-I-DONE")) instanceof Date);
    await call("set_task", { project: "micasa", key: "MIC-I-DONE", status: "On hold", ...MOVE, delegated_by_jorge: { message_id: "msg-owner-9003", quote: "pon la iniciativa en pausa" } });
    assert.equal(await resolvedAt("MIC-I-DONE"), null);
  });

  test("errors", async () => {
    await expectError("set_task", { project: "micasa", key: "MIC-01", status: "Ready" }, "INVALID_STATUS", 400);
    await expectError("set_task", { project: "micasa", key: "NOPE", status: "Done" }, "TASK_NOT_FOUND", 404);
  });
});

describe("add_decision", () => {
  test("logs a decision with the actor and a server timestamp", async () => {
    const r = await call("add_decision", { project: "zigzag", text: "Keep slug zigzag in v1" });
    assert.equal(r.decision.text, "Keep slug zigzag in v1");
    assert.equal(r.decision.adr_url, null);
    assert.equal(r.decision.pinned, false);
    assert.equal(r.decision.task_key, null);
    assert.deepEqual(r.decision.actor, A);
    assert.ok(r.decision.id && r.decision.created_at);
  });

  test("task_key ties it to a task; pin makes it must_keep; get_memory lists newest first", async () => {
    await call("create_task", { project: "zigzag", kind: "initiative", key: "ZIG-01", title: "Receipts" });
    const r = await call("add_decision", {
      project: "zigzag", text: "Receipts stay offline-first", adr_url: "https://example.test/adr/0001", pin: true, task_key: "ZIG-01",
    });
    assert.equal(r.decision.task_key, "ZIG-01");
    assert.equal(r.decision.pinned, true);
    const memory = await call("get_memory", { project: "zigzag" });
    assert.deepEqual(memory.decisions.map((d: Json) => d.text), ["Receipts stay offline-first", "Keep slug zigzag in v1"]);
    assert.equal(memory.decisions[0].adr_url, "https://example.test/adr/0001");
  });

  test("errors", async () => {
    await expectError("add_decision", { project: "nope", text: "x" }, "PROJECT_NOT_FOUND", 404);
    await expectError("add_decision", { project: "zigzag", text: "x", task_key: "NOPE" }, "TASK_NOT_FOUND", 404);
  });
});

describe("v2 A1: actor, events, UTC time", () => {
  test("writes require an actor", async () => {
    const r = (await client.callTool({
      name: "add_decision", arguments: { project: "zigzag", text: "no actor" },
    })) as { isError?: boolean; content: { text: string }[] };
    assert.equal(r.isError, true);
    assert.match(r.content[0]!.text, /actor/);
  });

  test("an agent cannot write as jorge", async () => {
    await expectError("add_decision", { project: "zigzag", text: "x", actor: { agent: "Jorge", session_id: "x" } }, "RESERVED_ACTOR", 400);
  });

  test("every write records an event with its actor; a failed write records none", async () => {
    const before = await eventCount();
    await call("create_task", { project: "zigzag", key: "ZIG-B-01", title: "x" });
    assert.equal(await eventCount(), before + 1);
    assert.deepEqual((await logOf("zigzag", "ZIG-B-01")).map((e: Json) => [e.type, e.actor.session_id]), [["task.created", "s1"]]);
    await expectError("create_task", { project: "zigzag", key: "ZIG-B-02", title: "x", blocked_by: ["NOPE"] }, "BLOCKER_NOT_FOUND", 400);
    await expectError("set_task", { project: "zigzag", key: "ZIG-B-01", status: "Nope" }, "INVALID_STATUS", 400);
    assert.equal(await eventCount(), before + 1);
  });

  test("timestamps are ISO-8601 UTC", async () => {
    const t = await call("get_task", { project: "zigzag", key: "ZIG-B-01" });
    for (const at of [t.created_at, t.updated_at, t.log[0].at]) assert.match(at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    const { decision } = await call("add_decision", { project: "zigzag", text: "UTC everywhere" });
    assert.match(decision.created_at, /Z$/);
  });

  test("a decision that starts with a date is rejected", async () => {
    await expectError("add_decision", { project: "zigzag", text: "2026-10-07 · typed date" }, "TEXT_HAS_DATE", 400);
  });
});

describe("v2 A2: versions", () => {
  test("a field change needs the version; a note alone does not and keeps it", async () => {
    const t = await call("get_task", { project: "zigzag", key: "ZIG-B-01" });
    await expectError("set_task", { project: "zigzag", key: "ZIG-B-01", summary: "x", version: "none" }, "VERSION_REQUIRED", 400);
    const noted = await call("set_task", { project: "zigzag", key: "ZIG-B-01", note: "just a note", version: "none" });
    assert.equal(noted.version, t.version, "an append does not bump the version");
    const changed = await call("set_task", { project: "zigzag", key: "ZIG-B-01", summary: "one", version: t.version });
    assert.equal(changed.version, t.version + 1);
  });

  test("two writers with the same version: the second gets STALE_VERSION with the current one", async () => {
    const { version } = await call("get_task", { project: "zigzag", key: "ZIG-B-01" });
    await call("set_task", { project: "zigzag", key: "ZIG-B-01", summary: "first", version });
    const r = await call("set_task", { project: "zigzag", key: "ZIG-B-01", summary: "second", version });
    assert.equal(r.__error, "STALE_VERSION");
    assert.equal(r.__status, 409);
    const { rows } = await raw.query("select summary, version from tasks where key = 'ZIG-B-01'");
    assert.equal(rows[0].summary, "first");
    const text = ((await client.callTool({
      name: "set_task", arguments: { project: "zigzag", key: "ZIG-B-01", summary: "second", version, actor: A },
    })) as { content: { text: string }[] }).content[0]!.text;
    assert.equal(JSON.parse(text).current_version, rows[0].version);
  });
});

describe("v2 A3: leases", () => {
  const B = { agent: "other-agent", session_id: "s2", machine: "mac-2" };
  const P = { project: "workia" };

  async function second(): Promise<{ client: Client; close: () => Promise<void> }> {
    const { db, close } = makeDb();
    const [c, srv] = InMemoryTransport.createLinkedPair();
    await createMcpServer(db).connect(srv);
    const other = new Client({ name: "test-2", version: "0" });
    await other.connect(c);
    return { client: other, close: async () => { await other.close(); await close(); } };
  }

  before(async () => {
    await call("create_task", { ...P, key: "WRK-L-01", title: "lease me", priority: "P0" });
    await call("create_task", { ...P, key: "WRK-L-02", title: "race me" });
    await call("create_task", { ...P, key: "WRK-L-03", title: "blocked", blocked_by: ["WRK-L-01"] });
  });

  test("claim takes the ticket with owner, lease and workspace; another session gets CLAIM_HELD", async () => {
    const t = await call("claim", { ...P, key: "WRK-L-01", workspace: { worktree_path: "/w/one", branch: "jl/one" } });
    assert.equal(t.status, "In progress");
    assert.deepEqual(t.claim.owner, A);
    assert.equal(t.claim.live, true);
    assert.deepEqual(t.workspace, { machine: "ci", worktree_path: "/w/one", branch: "jl/one" });
    const minutes = (Date.parse(t.claim.lease_until) - Date.now()) / 60000;
    assert.ok(minutes > 29 && minutes <= 30, `default lease is 30 minutes, got ${minutes}`);

    const r = await call("claim", { ...P, key: "WRK-L-01", actor: B });
    assert.equal(r.__error, "CLAIM_HELD");
    const text = ((await client.callTool({ name: "claim", arguments: { ...P, key: "WRK-L-01", actor: B } })) as Json).content[0].text;
    const detail = JSON.parse(text);
    assert.deepEqual(detail.owner, A);
    assert.equal(detail.workspace.worktree_path, "/w/one");
  });

  test("while A holds it, B cannot change fields but can add a note", async () => {
    await expectError("set_task", { ...P, key: "WRK-L-01", summary: "x", actor: B }, "NOT_OWNER", 409);
    await call("set_task", { ...P, key: "WRK-L-01", note: "QA saw it", actor: B, version: "none" });
    assert.equal((await lastLog("workia", "WRK-L-01")).actor.session_id, "s2");
  });

  test("heartbeat extends without bumping the version; only the owner may", async () => {
    const before = await call("get_task", { ...P, key: "WRK-L-01" });
    const t = await call("claim", { ...P, key: "WRK-L-01", action: "heartbeat", ttl_minutes: 60 });
    assert.equal(t.version, before.version);
    assert.ok(Date.parse(t.claim.lease_until) > Date.parse(before.claim.lease_until));
    await expectError("claim", { ...P, key: "WRK-L-01", action: "heartbeat", actor: B }, "CLAIM_HELD", 409);
    await expectError("claim", { ...P, key: "WRK-L-01", ttl_minutes: 1 }, "INVALID_TTL", 400);
  });

  test("an unsatisfied blocker makes a ticket NOT_CLAIMABLE", async () => {
    await expectError("claim", { ...P, key: "WRK-L-03" }, "NOT_CLAIMABLE", 409);
  });

  test("an expired lease is free: get_next offers it and the next write logs claim.expired", async () => {
    await raw.query("update tasks set lease_until = now() - interval '1 minute' where key = 'WRK-L-01'");
    const stale = await call("get_task", { ...P, key: "WRK-L-01" });
    assert.equal(stale.claim.live, false);
    const next = await call("get_next", P);
    assert.equal(next.task.key, "WRK-L-01");
    assert.equal(next.task.stale_claim, true);

    const t = await call("claim", { ...P, key: "WRK-L-01", actor: B });
    assert.deepEqual(t.claim.owner, B);
    const log = await logOf("workia", "WRK-L-01");
    const types = log.slice(-2).map((e: Json) => [e.type, e.actor.session_id]);
    assert.deepEqual(types, [["claim.expired", "system"], ["claim.acquired", "s2"]]);
    assert.equal(log.at(-2)!.payload.owner.session_id, "s1");
    assert.equal(t.workspace.worktree_path, "/w/one", "the workspace outlives the lease");
  });

  test("heartbeat after expiry is LEASE_EXPIRED", async () => {
    await raw.query("update tasks set lease_until = now() - interval '1 minute' where key = 'WRK-L-01'");
    await expectError("claim", { ...P, key: "WRK-L-01", action: "heartbeat", actor: B }, "LEASE_EXPIRED", 409);
  });

  test("release gives it back; releasing again is a no-op; only the owner releases", async () => {
    await call("claim", { ...P, key: "WRK-L-01", actor: B });
    await expectError("claim", { ...P, key: "WRK-L-01", action: "release" }, "NOT_OWNER", 409);
    const t = await call("claim", { ...P, key: "WRK-L-01", action: "release", release_to: "Backlog", actor: B });
    assert.equal(t.status, "Backlog");
    assert.equal(t.claim, null);
    assert.equal((await lastLog("workia", "WRK-L-01")).type, "claim.released");
    const again = await call("claim", { ...P, key: "WRK-L-01", action: "release", actor: B });
    assert.equal(again.version, t.version);
  });

  test("two sessions racing on separate connections: exactly one wins", async () => {
    const other = await second();
    try {
      const args = { ...P, key: "WRK-L-02" };
      const results = await Promise.all([
        client.callTool({ name: "claim", arguments: { ...args, actor: A } }),
        other.client.callTool({ name: "claim", arguments: { ...args, actor: B } }),
      ]) as Json[];
      const outcomes = results.map((r) => (r.isError ? JSON.parse(r.content[0].text).error : "ok")).sort();
      assert.deepEqual(outcomes, ["CLAIM_HELD", "ok"]);
      const { rows } = await raw.query(
        "select count(*)::int as n from events where task_key = 'WRK-L-02' and type = 'claim.acquired'",
      );
      assert.equal(rows[0].n, 1);
    } finally {
      await other.close();
    }
  });
});

describe("v2 A4: generated resume", () => {
  const P = { project: "filmia" };

  test("per initiative: claims, next claimable, notes and pinned decisions", async () => {
    await call("create_task", { ...P, kind: "initiative", key: "FIL-09", title: "Catalog split", next_action: "F2 after F1" });
    await call("create_task", { ...P, key: "FIL-09-F1", title: "Additive migration", parent_key: "FIL-09" });
    await call("create_task", { ...P, key: "FIL-09-F2", title: "Cutover", parent_key: "FIL-09", blocked_by: ["FIL-09-F1"] });
    await call("create_task", { ...P, key: "FIL-09-F4", title: "Frontend", parent_key: "FIL-09" });
    await call("claim", { ...P, key: "FIL-09-F4", workspace: { branch: "jl/catalog-frontend" } });
    await call("set_task", { ...P, key: "FIL-09", in_progress_note: "F4 first" });
    await call("add_decision", { ...P, text: "Users never edit catalog data", task_key: "FIL-09-F2", pin: true });
    await call("add_decision", { ...P, text: "Plania is the source of the plan", pin: true });
    await call("add_decision", { ...P, text: "Not pinned", task_key: "FIL-09" });

    const r = await call("get_resume", P);
    assert.match(r.generated_at, /Z$/);
    const i = r.initiatives.find((x: Json) => x.key === "FIL-09");
    assert.equal(i.in_progress.note, "F4 first");
    assert.deepEqual(i.in_progress.claims.map((c: Json) => [c.key, c.owner.session_id, c.workspace.branch]), [["FIL-09-F4", "s1", "jl/catalog-frontend"]]);
    assert.equal(i.next_action.note, "F2 after F1");
    assert.equal(i.next_action.next_claimable.key, "FIL-09-F1");
    assert.deepEqual(i.must_keep.map((d: Json) => d.text), ["Users never edit catalog data"]);
    assert.deepEqual(i.counts, { Backlog: 2, "In progress": 1 });
    assert.deepEqual(r.must_keep.map((d: Json) => d.text), ["Plania is the source of the plan"]);
    assert.ok(r.claims.some((c: Json) => c.key === "FIL-09-F4"));
    assert.ok(r.recent.length > 0 && r.recent[0].at.endsWith("Z"));
  });

  test("two sessions on two initiatives do not overwrite each other", async () => {
    const B = { agent: "qa", session_id: "s2" };
    await call("create_task", { ...P, kind: "initiative", key: "FIL-10", title: "QA" });
    await call("create_task", { ...P, key: "FIL-10-F1", title: "QA pass", parent_key: "FIL-10", actor: B });
    await call("claim", { ...P, key: "FIL-10-F1", actor: B });
    await call("set_task", { ...P, key: "FIL-10", next_action: "QA at 375px", actor: B });
    const r = await call("get_resume", P);
    const byKey = Object.fromEntries(r.initiatives.map((x: Json) => [x.key, x]));
    assert.equal(byKey["FIL-09"].in_progress.note, "F4 first");
    assert.equal(byKey["FIL-10"].next_action.note, "QA at 375px");
    assert.deepEqual(r.claims.map((c: Json) => c.owner.session_id).sort(), ["s1", "s2"]);
  });
});

describe("v2 A5: sequences", () => {
  const P = { project: "workia" };

  before(async () => {
    for (const key of ["WRK-S-01", "WRK-S-02", "WRK-S-03", "WRK-S-04"]) await call("create_task", { ...P, key, title: key });
  });

  test("hands out padded numbers in order; a retry for the same ticket returns its number", async () => {
    const a = await call("reserve_sequence", { ...P, name: "migration", task_key: "WRK-S-01", at_least: 9 });
    assert.equal(a.value, "0009");
    assert.equal(a.existing, false);
    const again = await call("reserve_sequence", { ...P, name: "migration", task_key: "WRK-S-01" });
    assert.equal(again.value, "0009");
    assert.equal(again.existing, true);
    const more = await call("reserve_sequence", { ...P, name: "migration", task_key: "WRK-S-01", additional: true });
    assert.equal(more.value, "0010");
  });

  test("a specific value held by a live ticket is SEQUENCE_TAKEN; a Won't do holder gives it up", async () => {
    const r = await call("reserve_sequence", { ...P, name: "migration", task_key: "WRK-S-02", value: 9 });
    assert.equal(r.__error, "SEQUENCE_TAKEN");
    await raw.query("update tasks set status = 'Won''t do' where key = 'WRK-S-01'");
    const taken = await call("reserve_sequence", { ...P, name: "migration", task_key: "WRK-S-02", value: 9 });
    assert.equal(taken.value, "0009");
    await raw.query("update tasks set status = 'Backlog' where key = 'WRK-S-01'");
    await expectError("reserve_sequence", { ...P, name: "Bad Name", task_key: "WRK-S-02" }, "INVALID_SEQUENCE", 400);
    await expectError("reserve_sequence", { ...P, name: "migration", task_key: "NOPE" }, "TASK_NOT_FOUND", 404);
  });

  test("get_project lists reservations with the ticket and the next free number", async () => {
    const p = await call("get_project", P);
    assert.deepEqual(
      p.reservations.map((r: Json) => [r.name, r.value, r.task_key, r.task_status]),
      [["migration", "0009", "WRK-S-02", "Backlog"], ["migration", "0010", "WRK-S-01", "Backlog"]],
    );
    assert.deepEqual(p.sequences, { migration: { next: "0011" } });
  });

  test("two sessions racing on separate connections get different numbers", async () => {
    const { db, close } = makeDb();
    const [c, srv] = InMemoryTransport.createLinkedPair();
    await createMcpServer(db).connect(srv);
    const other = new Client({ name: "test-2", version: "0" });
    await other.connect(c);
    try {
      const results = (await Promise.all([
        client.callTool({ name: "reserve_sequence", arguments: { ...P, name: "migration", task_key: "WRK-S-03", actor: A } }),
        other.callTool({ name: "reserve_sequence", arguments: { ...P, name: "migration", task_key: "WRK-S-04", actor: { agent: "b", session_id: "s2" } } }),
      ])) as Json[];
      const values = results.map((r) => JSON.parse(r.content[0].text).value).sort();
      assert.deepEqual(values, ["0011", "0012"]);
    } finally {
      await other.close();
      await close();
    }
  });
});

describe("v2 A6: idempotency and limits", () => {
  const P = { project: "zigzag" };

  test("a retried create with the same request_id returns the first response; without one it is KEY_EXISTS", async () => {
    const args = { ...P, key: "ZIG-I-01", title: "once", request_id: "req-create-1" };
    const first = await call("create_task", args);
    const before = await eventCount();
    const retry = await call("create_task", args);
    assert.deepEqual(retry, first);
    assert.equal(await eventCount(), before, "a replay writes nothing");
    await expectError("create_task", { ...P, key: "ZIG-I-01", title: "once" }, "KEY_EXISTS", 409);
  });

  test("a request_id reused by another tool is REQUEST_ID_REUSED", async () => {
    const r = await call("add_decision", { ...P, text: "x", request_id: "req-create-1" });
    assert.equal(r.__error, "REQUEST_ID_REUSED");
  });

  test("text over its limit is TOO_LARGE with the field and max", async () => {
    const r = await call("create_task", { ...P, key: "ZIG-I-02", title: "x".repeat(201) });
    assert.equal(r.__error, "TOO_LARGE");
    const text = ((await client.callTool({
      name: "create_task", arguments: { ...P, key: "ZIG-I-02", title: "t", blocked_by: Array(51).fill("K"), actor: A },
    })) as Json).content[0].text;
    assert.deepEqual(JSON.parse(text), { error: "TOO_LARGE", status: 400, field: "blocked_by", max: 50 });
  });

  test("get_next with an unknown initiative is INITIATIVE_NOT_FOUND", async () => {
    await expectError("get_next", { ...P, initiative_key: "NOPE" }, "INITIATIVE_NOT_FOUND", 404);
  });
});

describe("v2 B1: state machine and work types", () => {
  const P = { project: "zigzag" };

  test("allowed and forbidden ticket moves", async () => {
    await call("create_task", { ...P, key: "ZIG-M-01", title: "m" });
    await expectError("set_task", { ...P, key: "ZIG-M-01", status: "In review" }, "INVALID_TRANSITION", 409);
    await expectError("set_task", { ...P, key: "ZIG-M-01", status: "In progress" }, "INVALID_TRANSITION", 409);
    const ready = await call("set_task", { ...P, key: "ZIG-M-01", status: "Ready" });
    assert.equal(ready.status, "Ready");
    await call("claim", { ...P, key: "ZIG-M-01" });
    await call("add_result", { ...P, key: "ZIG-M-01", kind: "test", verdict: "pass", cite: "ok" });
    const review = await call("set_task", { ...P, key: "ZIG-M-01", status: "In review" });
    assert.equal(review.status, "In review");
    const rework = await call("claim", { ...P, key: "ZIG-M-01" });
    assert.equal(rework.status, "In progress", "In review goes back to work through claim");
    await expectError("create_task", { ...P, key: "ZIG-M-02", title: "m", status: "Done" }, "INVALID_STATUS", 400);
    await expectError("create_task", { ...P, key: "ZIG-M-02", title: "m", status: "In review" }, "INVALID_STATUS", 400);
  });

  test("initiative moves", async () => {
    await call("create_task", { ...P, kind: "initiative", key: "ZIG-M-I", title: "i" });
    await expectError("set_task", { ...P, key: "ZIG-M-I", status: "Shipping" }, "INVALID_TRANSITION", 409);
    for (const status of ["Active", "Shipping", "On hold", "Planning"]) {
      assert.equal((await call("set_task", { ...P, key: "ZIG-M-I", status })).status, status);
    }
  });

  test("Done is the agent's once the work merged; Won't do needs Jorge's evidence", async () => {
    await expectError("set_task", { ...P, key: "ZIG-M-01", status: "Done" }, "INVALID_TRANSITION", 409);
    await expectError("set_task", { ...P, key: "ZIG-M-01", status: "Won't do" }, "HUMAN_ONLY", 403);
    await expectError("set_task", { ...P, key: "ZIG-M-01", status: "Won't do", reason: "ya no" }, "HUMAN_ONLY", 403);
    const hinted = await call("set_task", { ...P, key: "ZIG-M-01", status: "Won't do", approval_id: "old-id", reason: "ya no" });
    assert.equal(hinted.__error, "HUMAN_ONLY", "an approval id does not authorize the move");
    const t = await call("set_task", {
      ...P,
      key: "ZIG-M-01",
      status: "Won't do",
      reason: "ya no hace falta",
      delegated_by_jorge: { message_id: "msg-owner-9004", quote: "marcalo wont do ya mismo" },
    });
    assert.equal(t.status, "Won't do");
    const moved = (await logOf("zigzag", "ZIG-M-01")).find((e: Json) => e.type === "task.delegated_move");
    assert.equal(moved!.payload.from, "In progress");
    assert.equal(moved!.payload.to, "Won't do");
    assert.equal(moved!.payload.message_id, "msg-owner-9004");
    await expectError("set_task", { ...P, key: "ZIG-M-01", status: "Ready" }, "HUMAN_ONLY", 403);
  });

  test("work_type defaults to code, can be set on tickets, and is checked", async () => {
    const t = await call("create_task", { ...P, key: "ZIG-M-03", title: "apply 0008", work_type: "ops" });
    assert.equal(t.work_type, "ops");
    const changed = await call("set_task", { ...P, key: "ZIG-M-03", work_type: "research" });
    assert.equal(changed.work_type, "research");
    assert.equal((await call("get_task", { ...P, key: "ZIG-M-01" })).work_type, "code");
    await expectError("set_task", { ...P, key: "ZIG-M-I", work_type: "ops" }, "FIELD_NOT_ALLOWED", 400);
    await expectError("create_task", { ...P, key: "ZIG-M-04", title: "x", work_type: "nope" }, "INVALID_WORK_TYPE", 400);
  });
});

describe("v2 B2: scope, checks, log", () => {
  const P = { project: "zigzag" };
  const B = { agent: "qa", session_id: "s2" };

  test("create with scope, phase and checks; body is gone", async () => {
    await call("create_task", { ...P, kind: "initiative", key: "ZIG-02", title: "Receipts", scope: "PRD" });
    const t = await call("create_task", {
      ...P, key: "ZIG-02-F1", title: "Scan", parent_key: "ZIG-02", phase: 1, scope: "Scan receipts", checks: ["tests pass", "PR to sandbox"],
    });
    assert.equal(t.phase, 1);
    assert.equal(t.scope, "Scan receipts");
    assert.deepEqual(t.checks.map((c: Json) => [c.n, c.text, c.done]), [[1, "tests pass", false], [2, "PR to sandbox", false]]);
    await expectError("create_task", { ...P, key: "ZIG-02-F2", title: "x", body: "old" }, "BODY_REMOVED", 400);
    await expectError("set_task", { ...P, key: "ZIG-02-F1", body: "old" }, "BODY_REMOVED", 400);
    await expectError("create_task", { ...P, key: "ZIG-02-F2", title: "x", phase: -1 }, "INVALID_PHASE", 400);
    await expectError("set_task", { ...P, key: "ZIG-02", phase: 2 }, "FIELD_NOT_ALLOWED", 400);
  });

  test("set_check ticks one item without a version; a concurrent note survives", async () => {
    const before = await call("get_task", { ...P, key: "ZIG-02-F1" });
    await call("set_task", { ...P, key: "ZIG-02-F1", note: "QA: looks fine at 375px", actor: B, version: "none" });
    const t = await call("set_check", { ...P, key: "ZIG-02-F1", n: 2, done: true });
    assert.equal(t.version, before.version, "ticking does not bump the version");
    assert.deepEqual(t.checks.map((c: Json) => c.done), [false, true]);
    assert.equal(t.checks[1].done_by.session_id, "s1");
    assert.match(t.checks[1].done_at, /Z$/);
    assert.deepEqual((await logOf("zigzag", "ZIG-02-F1")).slice(-2).map((e: Json) => e.type), ["note", "check.set"]);
    await expectError("set_check", { ...P, key: "ZIG-02-F1", n: 9, done: true }, "CHECK_NOT_FOUND", 404);
  });

  test("checks replace keeps done state by n; new items get new numbers; scope history is in the log", async () => {
    const t = await call("set_task", {
      ...P, key: "ZIG-02-F1", scope: "Scan and OCR receipts",
      checks: [{ n: 2, text: "PR to sandbox (green)" }, { text: "OCR at 95%" }],
    });
    assert.deepEqual(t.checks.map((c: Json) => [c.n, c.text, c.done]), [[2, "PR to sandbox (green)", true], [3, "OCR at 95%", false]]);
    const changes = (await lastLog("zigzag", "ZIG-02-F1")).payload.changes;
    assert.deepEqual(changes.scope, ["Scan receipts", "Scan and OCR receipts"]);
    assert.deepEqual(changes.checks[1], ["PR to sandbox (green)", "OCR at 95%"]);
    await expectError("set_task", { ...P, key: "ZIG-02-F1", checks: [{ n: 99, text: "x" }] }, "CHECK_NOT_FOUND", 404);
  });

  test("only the lease owner ticks checks", async () => {
    await call("claim", { ...P, key: "ZIG-02-F1" });
    await expectError("set_check", { ...P, key: "ZIG-02-F1", n: 3, done: true, actor: B }, "NOT_OWNER", 409);
  });
});

describe("v2 B3: evidence", () => {
  const P = { project: "workia" };
  const B = { agent: "ci", session_id: "run-1" };

  async function ticket(key: string, work_type: string) {
    await call("create_task", { ...P, key, title: key, work_type, checks: ["tests green", "screenshot at 375px"] });
    await call("claim", { ...P, key });
  }

  test("code needs a passing unit|integration|test|live|ci result from this claim", async () => {
    await ticket("WRK-E-01", "code");
    await expectError("set_task", { ...P, key: "WRK-E-01", status: "In review", open_checks: true }, "EVIDENCE_REQUIRED", 409);
    await call("add_result", { ...P, key: "WRK-E-01", kind: "grep", verdict: "pass", cite: "no TODO left" });
    await call("add_result", { ...P, key: "WRK-E-01", kind: "test", verdict: "fail", cite: "2 failing" });
    await expectError("set_task", { ...P, key: "WRK-E-01", status: "In review", open_checks: true }, "EVIDENCE_REQUIRED", 409);
    const { result, task } = await call("add_result", {
      ...P, key: "WRK-E-01", kind: "ci", verdict: "pass", cite: "CI green", url: "https://ci.example/run/1", check_ns: [1], actor: B,
    });
    assert.equal(result.kind, "ci");
    assert.equal(result.actor.session_id, "run-1", "anyone may add evidence");
    assert.deepEqual(task.checks.map((c: Json) => [c.done, c.evidence_id]), [[true, result.id], [false, null]]);
    assert.equal(task.results.length, 3);
    assert.equal((await call("set_task", { ...P, key: "WRK-E-01", status: "In review" })).status, "In review");
  });

  test("evidence from an earlier claim does not count after rework", async () => {
    await call("claim", { ...P, key: "WRK-E-01" });
    await raw.query("update results set created_at = now() - interval '1 hour' where task_id = (select id from tasks where key = 'WRK-E-01')");
    await raw.query("update tasks set claimed_at = now() - interval '1 minute' where key = 'WRK-E-01'");
    await expectError("set_task", { ...P, key: "WRK-E-01", status: "In review", open_checks: true }, "EVIDENCE_REQUIRED", 409);
  });

  test("ops accepts live|verify|ci; research accepts any result; decision-needed never", async () => {
    await ticket("WRK-E-02", "ops");
    await call("add_result", { ...P, key: "WRK-E-02", kind: "unit", verdict: "pass", cite: "n/a" });
    await expectError("set_task", { ...P, key: "WRK-E-02", status: "In review", open_checks: true }, "EVIDENCE_REQUIRED", 409);
    await call("add_result", { ...P, key: "WRK-E-02", kind: "verify", verdict: "pass", cite: "0008 applied on Neon" });
    assert.equal((await call("set_task", { ...P, key: "WRK-E-02", status: "In review" })).status, "In review");

    await ticket("WRK-E-03", "research");
    await call("add_result", { ...P, key: "WRK-E-03", kind: "subagent", verdict: "warn", cite: "two options, both viable" });
    assert.equal((await call("set_task", { ...P, key: "WRK-E-03", status: "In review" })).status, "In review");

    await ticket("WRK-E-04", "decision-needed");
    await call("add_result", { ...P, key: "WRK-E-04", kind: "test", verdict: "pass", cite: "x" });
    await expectError("set_task", { ...P, key: "WRK-E-04", status: "In review", open_checks: true }, "EVIDENCE_REQUIRED", 409);
  });

  test("set_check with evidence_id needs a result of the project (any task, with its source); bad results are INVALID_RESULT", async () => {
    await expectError("set_check", { ...P, key: "WRK-E-02", n: 1, done: true, evidence_id: "00000000-0000-0000-0000-000000000000" }, "RESULT_NOT_FOUND", 404);
    const other = (await call("get_task", { ...P, key: "WRK-E-01" })).results[0].id;
    const cross = await call("set_check", { ...P, key: "WRK-E-02", n: 1, done: true, evidence_id: other });
    assert.equal(cross.check.source, "WRK-E-01", "evidence from another task names its source");
    const mine = (await call("get_task", { ...P, key: "WRK-E-02" })).results[0].id;
    const t = await call("set_check", { ...P, key: "WRK-E-02", n: 1, done: true, evidence_id: mine });
    assert.equal(t.checks[0].evidence_id, mine);
    await expectError("add_result", { ...P, key: "WRK-E-02", kind: "vibes", verdict: "pass", cite: "x" }, "INVALID_RESULT", 400);
    await expectError("add_result", { ...P, key: "WRK-E-02", kind: "ci", verdict: "fail", cite: "x", check_ns: [1] }, "INVALID_RESULT", 400);
  });
});

describe("v2 B4: docs", () => {
  const P = { project: "micasa" };

  test("a task doc: create, DOC_EXISTS, replace with version, STALE_VERSION, get_doc", async () => {
    const { doc } = await call("attach_doc", { ...P, key: "MIC-01", title: "Plan", markdown: "# Plan\n1. F1" });
    assert.equal(doc.version, 1);
    assert.equal(doc.task_key, "MIC-01");
    const dup = await call("attach_doc", { ...P, key: "MIC-01", title: "Plan", markdown: "again" });
    assert.equal(dup.__error, "DOC_EXISTS");
    const v2 = await call("attach_doc", { ...P, key: "MIC-01", title: "Plan", markdown: "# Plan\n1. F1\n2. F2", version: 1 });
    assert.equal(v2.doc.version, 2);
    await expectError("attach_doc", { ...P, key: "MIC-01", title: "Plan", markdown: "stale", version: 1 }, "STALE_VERSION", 409);
    await expectError("attach_doc", { ...P, key: "MIC-01", title: "Nope", markdown: "x", version: 1 }, "DOC_NOT_FOUND", 404);
    const got = await call("get_doc", { ...P, doc_id: doc.id });
    assert.equal(got.doc.markdown, "# Plan\n1. F1\n2. F2");
    const t = await call("get_task", { ...P, key: "MIC-01" });
    assert.deepEqual(t.docs.map((d: Json) => [d.title, d.version]), [["Plan", 2]]);
    await expectError("get_doc", { ...P, doc_id: "00000000-0000-0000-0000-000000000000" }, "DOC_NOT_FOUND", 404);
  });

  test("a project doc shows in get_memory design_docs; the same title may exist on a task", async () => {
    await call("attach_doc", { ...P, title: "Plan", markdown: "project-wide design" });
    const m = await call("get_memory", P);
    assert.deepEqual(m.design_docs.map((d: Json) => [d.title, d.markdown]), [["Plan", "project-wide design"]]);
  });

  test("a research ticket can enter In review with a doc and no result", async () => {
    await call("create_task", { ...P, key: "MIC-R-01", title: "Compare OCR libs", work_type: "research" });
    await call("claim", { ...P, key: "MIC-R-01" });
    await expectError("set_task", { ...P, key: "MIC-R-01", status: "In review", open_checks: true }, "EVIDENCE_REQUIRED", 409);
    await call("attach_doc", { ...P, key: "MIC-R-01", title: "Findings", markdown: "Tesseract wins" });
    assert.equal((await call("set_task", { ...P, key: "MIC-R-01", status: "In review" })).status, "In review");
  });
});

describe("v2 B5: decisions", () => {
  const P = { project: "filmia" };

  test("tags, task, supersedes; the reversed one is marked and drops out of must_keep", async () => {
    const old = (await call("add_decision", { ...P, text: "Quitar de Filmia with strong confirm", task_key: "FIL-09-F4", tags: ["UX", "delete"], pin: true })).decision;
    assert.deepEqual(old.tags, ["ux", "delete"]);
    const neu = (await call("add_decision", { ...P, text: "No delete at all; orphans are kept", supersedes: old.id })).decision;
    assert.deepEqual(neu.supersedes, [old.id]);
    assert.equal(neu.task_key, "FIL-09-F4", "a reversal inherits the task");
    assert.equal(neu.pinned, true, "and the pin");
    const r = await call("add_decision", { ...P, text: "again", supersedes: old.id });
    assert.equal(r.__error, "ALREADY_SUPERSEDED");
    await expectError("add_decision", { ...P, text: "x", supersedes: "00000000-0000-0000-0000-000000000000" }, "DECISION_NOT_FOUND", 404);

    const m = await call("get_memory", { ...P, task_key: "FIL-09-F4", include_superseded: true });
    assert.deepEqual(m.decisions.map((d: Json) => [d.text, d.superseded_by]), [
      ["No delete at all; orphans are kept", null],
      ["Quitar de Filmia with strong confirm", neu.id],
    ]);
    const resume = await call("get_resume", P);
    const mustKeep = resume.initiatives.find((i: Json) => i.key === "FIL-09").must_keep.map((d: Json) => d.text);
    assert.ok(mustKeep.includes("No delete at all; orphans are kept"));
    assert.ok(!mustKeep.includes("Quitar de Filmia with strong confirm"));
  });

  test("filters: initiative (with its tickets), tag, include_superseded", async () => {
    const byInitiative = await call("get_memory", { ...P, initiative_key: "FIL-09" });
    assert.ok(byInitiative.decisions.length >= 3);
    assert.ok(byInitiative.decisions.every((d: Json) => d.task_key?.startsWith("FIL-09")));
    assert.deepEqual((await call("get_memory", { ...P, tag: "UX" })).decisions, [], "reversed decisions are hidden by default");
    const tagged = await call("get_memory", { ...P, tag: "UX", include_superseded: true });
    assert.deepEqual(tagged.decisions.map((d: Json) => d.text), ["Quitar de Filmia with strong confirm"]);
    const current = await call("get_memory", { ...P, task_key: "FIL-09-F4" });
    assert.equal(current.decisions.length, 1);
    await expectError("get_memory", { ...P, initiative_key: "FIL-09-F4" }, "INITIATIVE_NOT_FOUND", 404);
  });

  test("adr_body is stored as a project doc", async () => {
    const { decision } = await call("add_decision", { ...P, text: "Catalog split in three steps", adr_body: "# ADR\nContext..." });
    const { doc } = await call("get_doc", { ...P, doc_id: decision.adr_doc_id });
    assert.equal(doc.markdown, "# ADR\nContext...");
    assert.match(doc.title, /^ADR [0-9a-f]{8}: Catalog split in three steps$/);
  });
});

describe("v2 B6: environments", () => {
  const P = { project: "workia" };

  test("a ticket blocked on prod's migrations unblocks when set_env reports them", async () => {
    await call("create_task", {
      ...P, key: "WRK-V-01", title: "Destructive 0010", priority: "P0",
      blocked_by: [{ env: "prod", condition: "migration_gte", value: "0009" }],
    });
    let t = await call("get_task", { ...P, key: "WRK-V-01" });
    assert.deepEqual(t.blocked_by, [{ type: "env", env: "prod", condition: "migration_gte", value: "9", current: null, satisfied: false }]);
    await expectError("claim", { ...P, key: "WRK-V-01" }, "NOT_CLAIMABLE", 409);
    const { rows } = await raw.query("select status from tasks where key = 'WRK-V-01'");
    assert.equal(rows[0].status, "Backlog");

    const { env } = await call("set_env", { ...P, env: "prod", commit: "abc1234", branch: "main", migrations_applied: 9, deployed: { provider: "manual", deployment_id: "d-0" } });
    assert.equal(env.migrations_applied, 9);
    assert.match(env.deployed_at, /Z$/);
    assert.equal(env.by.session_id, "s1");
    t = await call("get_task", { ...P, key: "WRK-V-01" });
    assert.equal(t.blocked_by[0].satisfied, true);
    assert.equal(t.blocked_by[0].current, 9);
    assert.equal((await call("claim", { ...P, key: "WRK-V-01" })).status, "In progress");
    const project = await call("get_project", P);
    assert.equal(project.env.prod.commit, "abc1234");
  });

  test("contains_commit and deployed_after", async () => {
    await call("create_task", {
      ...P, key: "WRK-V-02", title: "After F2 ships",
      blocked_by: ["WRK-V-01", { env: "prod", condition: "contains_commit", value: "DEADBEEF1" }, { env: "prod", condition: "deployed_after" }],
    });
    let t = await call("get_task", { ...P, key: "WRK-V-02" });
    assert.deepEqual(t.blocked_by.map((b: Json) => b.satisfied), [false, false, false]);
    await call("set_env", { ...P, env: "prod", commits: ["deadbeef1234567"], deployed: { provider: "manual", deployment_id: "d-1" } });
    t = await call("get_task", { ...P, key: "WRK-V-02" });
    assert.deepEqual(t.blocked_by.map((b: Json) => [b.task ?? b.condition, b.satisfied]), [
      ["WRK-V-01", false], ["contains_commit", true], ["deployed_after", true],
    ]);
  });

  test("get_next applies env conditions in SQL", async () => {
    await call("create_task", { ...P, kind: "initiative", key: "WRK-V", title: "env gate" });
    await call("create_task", {
      ...P, key: "WRK-V-F1", title: "after staging has 3", parent_key: "WRK-V",
      blocked_by: [{ env: "staging", condition: "migration_gte", value: 3 }],
    });
    assert.deepEqual(await call("get_next", { ...P, initiative_key: "WRK-V" }), { task: null });
    await call("set_env", { ...P, env: "staging", migrations_applied: 2 });
    assert.deepEqual(await call("get_next", { ...P, initiative_key: "WRK-V" }), { task: null });
    await call("set_env", { ...P, env: "staging", migrations_applied: 3 });
    assert.equal((await call("get_next", { ...P, initiative_key: "WRK-V" })).task.key, "WRK-V-F1");
  });

  test("bad env input", async () => {
    await expectError("set_env", { ...P, env: "Prod" }, "INVALID_ENV", 400);
    await expectError("set_env", { ...P, env: "prod", commit: "not-a-sha" }, "INVALID_ENV", 400);
    await expectError("create_task", { ...P, key: "WRK-V-03", title: "x", blocked_by: [{ env: "prod", condition: "is_green" }] }, "INVALID_ENV_CONDITION", 400);
    await expectError("create_task", { ...P, key: "WRK-V-03", title: "x", blocked_by: [{ env: "prod", condition: "migration_gte", value: "soon" }] }, "INVALID_ENV_CONDITION", 400);
  });
});

describe("v2 C1: questions", () => {
  const P = { project: "micasa" };
  const B = { agent: "qa", session_id: "s2" };

  test("ask moves a ticket to Needs Jorge and keeps the lease; the answer is a decision and restores In progress", async () => {
    await call("create_task", { ...P, key: "MIC-Q-01", title: "Import CSV" });
    await call("claim", { ...P, key: "MIC-Q-01" });
    const { question, task } = await call("ask", { ...P, key: "MIC-Q-01", question: "Support BBVA's CSV too?", options: ["Yes", "No"] });
    assert.equal(task.status, "Needs Jorge");
    assert.equal(task.claim.live, true);
    await expectError("set_task", { ...P, key: "MIC-Q-01", status: "Ready" }, "INVALID_TRANSITION", 409);
    const second = (await call("ask", { ...P, key: "MIC-Q-01", question: "Max file size?", actor: B })).question;
    assert.equal((await call("get_resume", P)).open_questions.length, 2);

    const a = await call("answer", { ...P, question_id: question.id, answer: "Yes, BBVA too", decision_text: "Importar también el CSV de BBVA" });
    assert.equal(a.decision.text, "Importar también el CSV de BBVA");
    assert.deepEqual(a.decision.tags, ["answer"]);
    assert.equal(a.decision.task_key, "MIC-Q-01");
    assert.equal(a.question.decision_id, a.decision.id);
    assert.equal(a.task.status, "Needs Jorge", "one question is still open");
    const b = await call("answer", { ...P, question_id: second.id, answer: "10 MB" });
    assert.equal(b.decision, null, "an answer without decision_text writes no decision");
    assert.equal(b.question.decision_id, null);
    assert.equal(b.task.status, "In progress");
    assert.equal(b.task.claim.live, true);
    await expectError("answer", { ...P, question_id: second.id, answer: "again" }, "ALREADY_ANSWERED", 409);
    await expectError("answer", { ...P, question_id: "00000000-0000-0000-0000-000000000000", answer: "x" }, "QUESTION_NOT_FOUND", 404);
    await expectError("ask", { ...P, key: "MIC-Q-01", question: "  " }, "INVALID_QUESTION", 400);
    const m = await call("get_memory", { ...P, task_key: "MIC-Q-01" });
    assert.equal(m.decisions.length, 1);
  });

  test("In progress whose lease ran out comes back as Ready", async () => {
    const { question } = await call("ask", { ...P, key: "MIC-Q-01", question: "Name the importer?" });
    await raw.query("update tasks set lease_until = now() - interval '1 minute' where key = 'MIC-Q-01'");
    const r = await call("answer", { ...P, question_id: question.id, answer: "Importador" });
    assert.equal(r.task.status, "Ready");
    assert.equal(r.task.claim, null);
  });

  test("a question on an initiative leaves its status alone", async () => {
    const { task } = await call("ask", { ...P, key: "MIC-02", question: "Ship before Christmas?" });
    assert.equal(task.status, "Shipping");
  });
});

describe("v2 C2: list_events", () => {
  const P = { project: "zigzag" };

  test("a cursor returns only what is new, filtered by key or type prefix", async () => {
    const start = (await call("list_events", { ...P, limit: 1000 })).next_cursor;
    await call("create_task", { ...P, key: "ZIG-E-01", title: "feed" });
    await call("claim", { ...P, key: "ZIG-E-01" });
    await call("set_task", { ...P, key: "ZIG-E-01", note: "hello", version: "none" });
    const r = await call("list_events", { ...P, since: start });
    assert.deepEqual(r.events.map((e: Json) => e.type), ["task.created", "claim.acquired", "note"]);
    assert.ok(r.events.every((e: Json) => e.task_key === "ZIG-E-01" && e.at.endsWith("Z")));
    assert.equal(r.more, false);
    const claims = await call("list_events", { ...P, since: start, types: ["claim"] });
    assert.deepEqual(claims.events.map((e: Json) => e.type), ["claim.acquired"]);
    const paged = await call("list_events", { ...P, since: start, limit: 2 });
    assert.equal(paged.more, true);
    const rest = await call("list_events", { ...P, since: paged.next_cursor });
    assert.deepEqual(rest.events.map((e: Json) => e.type), ["note"]);
    const none = await call("list_events", { ...P, since: rest.next_cursor });
    assert.deepEqual(none, { events: [], next_cursor: rest.next_cursor, more: false });
  });

  test("concurrent writers in one project cannot commit an event behind the cursor", async () => {
    const { db, close } = makeDb();
    const [c, srv] = InMemoryTransport.createLinkedPair();
    await createMcpServer(db).connect(srv);
    const other = new Client({ name: "test-2", version: "0" });
    await other.connect(c);
    try {
      const start = (await call("list_events", { ...P, limit: 1000 })).next_cursor;
      const writes = Array.from({ length: 6 }, (_, i) =>
        (i % 2 ? client : other).callTool({
          name: "set_task", arguments: { ...P, key: "ZIG-E-01", note: `n${i}`, actor: { agent: "x", session_id: `s${i % 2}` } },
        }),
      );
      await Promise.all(writes);
      const r = await call("list_events", { ...P, since: start });
      assert.equal(r.events.length, 6);
      const ids = r.events.map((e: Json) => e.id);
      assert.deepEqual(ids, [...ids].sort((a, b) => a - b));
    } finally {
      await other.close();
      await close();
    }
  });
});

describe("v2 C4: protocol and project text", () => {
  test("the protocol comes with initialize, versioned", async () => {
    const text = client.getInstructions() ?? "";
    assert.match(text, /^Plania protocol 2\.20\./);
    assert.match(text, /A human_only question is answered on the owner's screen/);
    assert.equal(/\bgates?\b/i.test(text.replaceAll("merge-gate", "")), false, "2.17: the protocol names no gate");
    assert.match(text, /answer_delegated/);
    assert.match(text, /Never forward an answer/);
    assert.match(text, /set_task Done once it is Merged or Released/);
    assert.match(text, /Won't do and reopening a closed task need a reason/);
    assert.match(text, /Unknown or missing data is caution, never ready/);
    assert.equal(client.getServerVersion()?.version, "2.20.0");
    const p = await call("get_project", { project: "zigzag" });
    assert.equal(p.protocol_version, "2.20");
  });

  test("set_project edits body and rules with the version; rules_version follows the rules", async () => {
    const p = await call("get_project", { project: "zigzag" });
    await expectError("set_project", { project: "zigzag", rules: "x" }, "VERSION_REQUIRED", 400);
    const u = await call("set_project", { project: "zigzag", version: p.version, rules: "Migrations: Jorge runs them.", body: "Receipts app" });
    assert.equal(u.version, p.version + 1);
    assert.equal(u.rules_version, p.rules_version + 1);
    await expectError("set_project", { project: "zigzag", version: p.version, body: "stale" }, "STALE_VERSION", 409);
    const same = await call("set_project", { project: "zigzag", version: u.version, body: "Receipts app" });
    assert.equal(same.version, u.version, "no change, no bump");
    assert.equal((await call("get_memory", { project: "zigzag" })).rules, "Migrations: Jorge runs them.");
    const ev = await call("list_events", { project: "zigzag", types: ["project"] });
    assert.deepEqual(ev.events.at(-1).payload.changes.rules, ["", "Migrations: Jorge runs them."]);
  });
});

describe("v2 D1: reading in fewer calls", () => {
  const P = { project: "filmia" };

  test("get_task include_children returns the phases in one call", async () => {
    const t = await call("get_task", { ...P, key: "FIL-09", include_children: true });
    assert.deepEqual(t.children.map((c: Json) => c.key), ["FIL-09-F1", "FIL-09-F2", "FIL-09-F4"]);
    assert.ok(t.children.every((c: Json) => Array.isArray(c.checks) && "scope" in c));
    assert.equal((await call("get_task", { ...P, key: "FIL-09" })).children, undefined);
  });

  test("list_tasks filters: owner, unblocked, work_type, updated_since, search", async () => {
    const keys = async (f: Json) => (await call("list_tasks", { ...P, ...f })).tasks.map((t: Json) => t.key).sort();
    assert.deepEqual(await keys({ owner: "s1", parent_key: "FIL-09" }), ["FIL-09-F4"]);
    assert.deepEqual(await keys({ owner: "test-agent", parent_key: "FIL-09" }), ["FIL-09-F4"]);
    assert.deepEqual(await keys({ owner: "none", parent_key: "FIL-09" }), ["FIL-09-F1", "FIL-09-F2"]);
    assert.deepEqual(await keys({ unblocked: false, parent_key: "FIL-09" }), ["FIL-09-F2"]);
    assert.ok((await keys({ unblocked: true, parent_key: "FIL-09" })).includes("FIL-09-F1"));
    assert.deepEqual(await keys({ search: "cutover" }), ["FIL-09-F2"]);
    assert.deepEqual(await keys({ search: "100%_" }), []);
    const now = new Date().toISOString();
    assert.deepEqual(await keys({ updated_since: now }), []);
    await call("set_task", { ...P, key: "FIL-09-F1", note: "touched", version: "none" });
    assert.deepEqual(await keys({ updated_since: now }), ["FIL-09-F1"]);
    assert.deepEqual(await keys({ work_type: "ops", parent_key: "FIL-09" }), []);
    await expectError("list_tasks", { ...P, updated_since: "yesterday" }, "INVALID_FILTER", 400);
    const one = (await call("list_tasks", { ...P, limit: 1 })).tasks;
    assert.equal(one.length, 1);
    assert.match(one[0].updated_at, /Z$/);
  });
});

describe("v2 D2: ticket template", () => {
  const P = { project: "workia", template: false };

  test("a ticket needs a scope; code and ops need checks; research does not", async () => {
    const r = await call("create_task", { ...P, key: "WRK-T-01", title: "x" });
    assert.equal(r.__error, "TEMPLATE_INVALID");
    const text = ((await client.callTool({
      name: "create_task", arguments: { project: "workia", key: "WRK-T-01", title: "x", scope: "s", work_type: "ops", actor: A },
    })) as Json).content[0].text;
    assert.deepEqual(JSON.parse(text).missing, ["checks"]);
    const research = await call("create_task", { ...P, key: "WRK-T-02", title: "x", scope: "Compare", work_type: "research" });
    assert.equal(research.key, "WRK-T-02");
    assert.deepEqual(research.warnings, ["key does not follow the scheme WRK-<n>: omit key to get the next one"]);
    const assigned = await call("create_task", { ...P, title: "x", scope: "Compare", work_type: "research" });
    assert.equal(assigned.warnings, undefined);
  });

  test("conventions only warn", async () => {
    await call("create_task", { ...P, kind: "initiative", key: "WRK-T", title: "Phased", scope: "PRD" });
    const ok = await call("create_task", { ...P, key: "WRK-T-F1", title: "F1", parent_key: "WRK-T", phase: 1, scope: "s", checks: ["c"] });
    assert.equal(ok.warnings, undefined);
    const odd = await call("create_task", { ...P, key: "WRK-T-X", title: "F2", parent_key: "WRK-T", phase: 2, scope: "s", checks: ["c"] });
    assert.deepEqual(odd.warnings, ["key does not follow the scheme WRK-T-<n>: omit key to get the next one"]);
    const bucket = await call("create_task", { ...P, key: "WRK-T-Y", title: "loose end", parent_key: "WRK-T", scope: "s", checks: ["c"] });
    assert.match(bucket.warnings[0], /^no phase/);
    const empty = await call("create_task", { ...P, kind: "initiative", key: "WRK-T2", title: "No PRD" });
    assert.match(empty.warnings[0], /^no scope/);
  });
});

describe("live events", () => {
  test("every committed write publishes one change per task it touched; failures and reads publish none", async () => {
    const seen: Json[] = [];
    const unsubscribe = bus.subscribe((e) => seen.push(e));
    try {
      const P = { project: "workia" };
      await call("create_task", { ...P, kind: "initiative", key: "WRK-LV", title: "x" });
      await call("create_task", { ...P, key: "WRK-LV-F1", title: "x", parent_key: "WRK-LV" });
      await call("set_task", { ...P, key: "WRK-LV-F1", status: "Ready", note: "go" });
      await call("add_decision", { ...P, text: "x" });
      await call("set_env", { ...P, env: "prod", migrations_applied: 1 });
      await call("set_task", { ...P, key: "NOPE", status: "Ready" }); // fails: no change
      await call("get_project", P); // read: no change
    } finally {
      unsubscribe();
    }
    assert.deepEqual(seen, [
      { type: "task", project: "workia", key: "WRK-LV" },
      { type: "task", project: "workia", key: "WRK-LV-F1" },
      { type: "task", project: "workia", key: "WRK-LV-F1" },
      { type: "decision", project: "workia" },
      { type: "project", project: "workia" },
    ]);
  });
});
