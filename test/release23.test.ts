// 2.3: the audit (R-31), get_context (R-03), handoff (R-06), derived checks and cross-task evidence
// (R-14), state_note (R-16) and release records (R-22).
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const { makeDb } = await import("../src/db/client.js");
const { createMcpServer } = await import("../src/mcp/register.js");
const { auditAll } = await import("../src/jobs/audit.js");
const { recordRelease } = await import("../src/mcp/releases.js");
const { findProject } = await import("../src/mcp/queries.js");
const { writeTx } = await import("../src/mcp/tx.js");

type Json = Record<string, any>;
const A = { agent: "test-agent", session_id: "s1", machine: "MacBook-Air" };
const B = { agent: "codex", session_id: "s2", machine: "cloud-1" };
const P = { project: "filmia" };
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
    return { __error: "INVALID_INPUT", __text: text };
  }
  return r.isError ? { __error: data.error, __status: data.status, ...data } : data;
}
const version = async (key: string) => (await call("get_task", { ...P, key, view: "summary" })).version;

before(async () => {
  raw = await resetTestDb();
  const { db, close } = makeDb();
  closeDb = close;
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createMcpServer(db).connect(serverSide);
  client = new Client({ name: "test", version: "0" });
  await client.connect(clientSide);
  await call("create_task", { ...P, kind: "initiative", title: "Post-QA", scope: "PRD\n\n## Estado\nhalf done", integration_branch: "jl/post-qa" }); // FIL-I1
  await call("create_task", { ...P, title: "Fix ratings", ...T, parent_key: "FIL-I1", status: "Ready" }); // FIL-I1-1
  await call("create_task", { ...P, title: "Fix search", ...T, parent_key: "FIL-I1", status: "Ready" }); // FIL-I1-2
});

after(async () => {
  await client?.close();
  await closeDb?.();
  await raw?.end();
});

describe("state_note and derived checks", () => {
  test("a status section in scope only warns; state_note is its own field and goes stale when a ticket moves", async () => {
    const i = await call("get_task", { ...P, key: "FIL-I1" });
    assert.deepEqual(i.state_note, { text: "", at: null, stale: false });
    const r = await call("set_task", { ...P, key: "FIL-I1", state_note: "ratings fixed in sandbox", scope: "PRD\n\n## Status\nx", version: i.version });
    assert.match(r.warnings[0], /status section/);
    assert.equal((await call("get_task", { ...P, key: "FIL-I1" })).state_note.stale, false);
    await call("claim", { ...P, key: "FIL-I1-1" });
    assert.equal((await call("get_task", { ...P, key: "FIL-I1" })).state_note.stale, true, "a ticket moved after the note");
  });

  test("an initiative check derived from a ticket ticks itself when the ticket is Done; evidence may come from any task", async () => {
    await call("set_task", { ...P, key: "FIL-I1", checks: [{ text: "ratings fixed", derived_from: "FIL-I1-1" }, { text: "search fixed", derived_from: "FIL-I1-2" }], version: await version("FIL-I1") });
    const r = await call("add_result", { ...P, key: "FIL-I1-1", kind: "unit", verdict: "pass", cite: "344 ratings kept", check_ns: [1] });
    const cross = await call("set_check", { ...P, key: "FIL-I1", n: 2, done: true, evidence_id: r.result.id });
    assert.equal(cross.check.source, "FIL-I1-1", "evidence from a child");
    await call("set_check", { ...P, key: "FIL-I1", n: 2, done: false });
    await call("set_task", { ...P, key: "FIL-I1-1", status: "In review", pr_url: "https://github.com/jorge/filmia/pull/7", version: await version("FIL-I1-1") });
    assert.deepEqual((await call("get_task", { ...P, key: "FIL-I1" })).checks.map((c: Json) => [c.n, c.done, c.derived_from]), [[1, false, "FIL-I1-1"], [2, false, "FIL-I1-2"]]);
    await call("add_result", { ...P, key: "FIL-I1-1", kind: "ci", verdict: "pass", cite: "merge commit green", commit: "dddddddd1" });
    await call("add_result", { ...P, key: "FIL-I1-1", kind: "scan", verdict: "pass", cite: "pnpm merge-gate example/filmia 7", commit: "dddddddd1" });
    await raw.query(
      `insert into pull_requests (project_id, repo, number, url, title, task_id, state, head_sha, merge_sha, merged_at, head_branch, base_branch)
       select p.id, 'example/filmia', 7, t.pr_url, 'phase', t.id, 'merged', 'dddddddd1', 'dddddddd1', now(), 'jl/post-qa', 'main'
       from projects p join tasks t on t.project_id = p.id where p.slug = 'filmia' and t.key = 'FIL-I1-1'`,
    );
    await call("set_task", { ...P, key: "FIL-I1-1", status: "Merged", version: await version("FIL-I1-1") });
    assert.equal((await call("set_task", { ...P, key: "FIL-I1-1", status: "Done", version: await version("FIL-I1-1") })).status, "Done", "the agent closes it");
    const checks = (await call("get_task", { ...P, key: "FIL-I1" })).checks;
    assert.deepEqual(checks.map((c: Json) => [c.n, c.done]), [[1, true], [2, false]]);
    assert.equal(checks[0].done_by.agent, "test-agent");
  });
});

describe("handoff and context", () => {
  test("handoff ends the lease, holds the ticket for the receiver, and the receiver's claim carries the note; get_task keeps the workspace history", async () => {
    await call("claim", { ...P, key: "FIL-I1-2", workspace: { worktree_path: "/w/search", branch: "jl/post-qa" } });
    const h = await call("handoff", { ...P, key: "FIL-I1-2", to: "s2", note: "query layer done; the index migration is next", head_sha: "abcdef1" });
    assert.equal(h.status, "Ready");
    assert.equal(h.handoff.to, "s2");
    const blocked = await call("claim", { ...P, key: "FIL-I1-2", actor: { agent: "other", session_id: "s3" } });
    assert.equal(blocked.__error, "HANDOFF_HELD");
    assert.equal(blocked.to, "s2");
    const taken = await call("claim", { ...P, key: "FIL-I1-2", actor: B, workspace: { worktree_path: "/cloud/search" } });
    assert.equal(taken.status, "In progress");
    assert.equal(taken.handoff.note, "query layer done; the index migration is next");
    assert.match(taken.warnings[0], /^handoff from test-agent/);
    const t = await call("get_task", { ...P, key: "FIL-I1-2" });
    assert.equal(t.handoff, null, "spent");
    assert.deepEqual(t.workspace_history.map((w: Json) => w.workspace?.worktree_path ?? w.handoff), ["/w/search", "query layer done; the index migration is next", "/cloud/search"]);
    assert.equal(t.workspace.branch, "jl/post-qa", "a phase keeps its initiative's branch");
    const open = await call("handoff", { ...P, key: "FIL-I1-2", to: "open", note: "anyone", actor: B });
    assert.equal(open.handoff.to, "open");
    assert.equal((await call("claim", { ...P, key: "FIL-I1-2", actor: { agent: "other", session_id: "s3" } })).status, "In progress");
  });

  test("get_context from a branch returns the initiative, its tickets, the caller's claims, pinned decisions and events since a cursor", async () => {
    await call("add_decision", { ...P, text: "Keep the old column until 0012", task_key: "FIL-I1", pin: true });
    const cursor = (await call("list_events", { ...P, limit: 1000 })).next_cursor;
    await call("ask", { ...P, key: "FIL-I1-2", question: "Drop the index?", actor: { agent: "other", session_id: "s3" } });
    const c = await call("get_context", { ...P, workspace: { branch: "jl/post-qa", worktree_path: "/w/x", machine: "MacBook-Air" }, session_id: "s3", since_cursor: cursor });
    assert.equal(c.initiative.key, "FIL-I1");
    assert.ok(c.tickets.some((t: Json) => t.key === "FIL-I1-2"));
    assert.deepEqual(c.my_claims.map((x: Json) => x.key), ["FIL-I1-2"]);
    assert.deepEqual(c.pinned_decisions.map((d: Json) => d.text), ["Keep the old column until 0012"]);
    assert.deepEqual(c.open_questions.map((q: Json) => q.question), ["Drop the index?"]);
    assert.ok(c.events.items.every((e: Json) => ["FIL-I1", "FIL-I1-2"].includes(e.task_key)));
    assert.ok(c.events.items.some((e: Json) => e.type === "question.asked"));
    const unknown = await call("get_context", { ...P, workspace: { branch: "jl/nothing" } });
    assert.equal(unknown.__error, "UNKNOWN_BRANCH");
    assert.deepEqual(unknown.known, ["jl/post-qa"]);
  });
});

describe("audit and releases", () => {
  test("the audit reports what the data says is wrong, and the job stores the count for the status block", async () => {
    await call("set_env", { ...P, env: "prod", commit: "1234567" }); // no deployed_at
    await raw.query("update branches set merged_at = now(), head_sha = 'fedcba9' where name = 'jl/post-qa'");
    // A Done code ticket without a PR from before 2.13's write-time guard.
    await raw.query("update tasks set pr_url = null where key = 'FIL-I1-1'");
    const r = await call("audit", P);
    const codes = r.findings.map((f: Json) => f.code).sort();
    for (const code of ["ENV_DEPLOYED_AT_MISSING", "BRANCH_MERGED_NOT_DELETED", "INITIATIVE_SCOPE_HAS_STATUS", "TASK_MISSING_PR_URL"]) {
      assert.ok(codes.includes(code), `${code} in ${codes}`);
    }
    // FIL-I1-1 is Done and has no blockers; a Done ticket blocked by a Done ticket is not "blocked but satisfied" either.
    await call("create_task", { ...P, title: "After ratings", ...T, parent_key: "FIL-I1", blocked_by: ["FIL-I1-1"] });
    const again = await call("audit", P);
    assert.ok(!again.findings.some((f: Json) => f.code === "BLOCKED_BUT_SATISFIED"), "only Blocked tickets count");
    const hint = r.findings.find((f: Json) => f.code === "BRANCH_MERGED_NOT_DELETED");
    assert.equal(hint.fix_hint, "git push origin --delete jl/post-qa");
    assert.equal(hint.key, "FIL-I1");
    const { db, close } = makeDb();
    try {
      assert.ok((await auditAll(db)) >= r.count);
    } finally {
      await close();
    }
    const status = (await call("get_resume", P)).status;
    assert.equal(status.audit_findings, r.count);
    assert.ok(status.audit.at.endsWith("Z"));
  });

  test("a release record collects the tickets a deploy shipped, with the migrations new since the previous one", async () => {
    const { db, close } = makeDb();
    try {
      const p = await findProject(db, "filmia");
      await call("set_env", { ...P, env: "prod", commit: "1234567", migrations: ["0009_a", "0010_b"], deployed: { provider: "vercel", deployment_id: "dpl_1" } });
      await writeTx(db, p, { actor: A }, (tx) => recordRelease(tx, p, "prod", "FIL-I1-1"));
      await writeTx(db, p, { actor: A }, (tx) => recordRelease(tx, p, "prod", "FIL-I1-2"));
      await call("set_env", { ...P, env: "prod", commit: "7654321", migrations: ["0009_a", "0010_b", "0011_c"], deployed: { provider: "vercel", deployment_id: "dpl_2" } });
      await writeTx(db, p, { actor: A }, (tx) => recordRelease(tx, p, "prod", "FIL-I1-2"));
      const rel = (await call("get_project", P)).releases;
      assert.deepEqual(rel.map((x: Json) => [x.commit, x.tasks, x.migrations]), [
        ["7654321", ["FIL-I1-2"], ["0011_c"]],
        ["1234567", ["FIL-I1-1", "FIL-I1-2"], ["0009_a", "0010_b"]],
      ]);
      assert.equal(rel[0].source.deployment_id, "dpl_2");
    } finally {
      await close();
    }
  });
});
