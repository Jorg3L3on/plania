// 2.13 (PLA-I6-1): start and finish, the write-time PR guard, ask's reply. Protocol text is 2.13.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const { makeDb } = await import("../src/db/client.js");
const { createMcpServer } = await import("../src/mcp/register.js");
const { instructions, PROTOCOL_VERSION } = await import("../src/mcp/protocol.js");

type Json = Record<string, any>;
const A = { agent: "test-agent", session_id: "s1", machine: "MacBook-Air" };
const B = { agent: "codex", session_id: "s2", machine: "cloud-1" };
const P = { project: "filmia" };
const BRANCH = "jl/fil-surface";
const PR = "https://github.com/jorge/filmia/pull/41";

let client: Client;
let raw: pg.Client;
let closeDb: () => Promise<void>;

async function call(name: string, args: Json): Promise<Json> {
  const r = (await client.callTool({ name, arguments: { actor: A, ...args } })) as { isError?: boolean; content: { text: string }[] };
  const data = JSON.parse(r.content[0]!.text);
  return r.isError ? { __error: data.error, __status: data.status, ...data } : data;
}
const task = (key: string) => call("get_task", { ...P, key });
const pass = (commit?: string) => ({ kind: "unit", verdict: "pass", cite: "pnpm test: 12 pass", ...(commit ? { commit } : {}) });

before(async () => {
  raw = await resetTestDb();
  const { db, close } = makeDb();
  closeDb = close;
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createMcpServer(db).connect(serverSide);
  client = new Client({ name: "test", version: "0" });
  await client.connect(clientSide);
  await call("create_task", { ...P, kind: "initiative", title: "Surface", scope: "s", integration_branch: BRANCH }); // FIL-I1
  for (const title of ["One", "Two", "Three", "Four"]) {
    await call("create_task", { ...P, title, scope: "s", checks: [`${title} works`, `${title} is documented`], parent_key: "FIL-I1", phase: 1, status: "Ready" });
  }
});

after(async () => {
  await client.close();
  await closeDb();
  await raw.end();
});

describe("start", () => {
  test("claims the ticket and returns the context of its branch in one call", async () => {
    const r = await call("start", { ...P, key: "FIL-I1-1", workspace: { worktree_path: "/tmp/fil" } });
    assert.equal(r.status, "In progress");
    assert.equal(r.claim.owner.session_id, "s1");
    assert.equal(r.workspace.branch, BRANCH, "a phase defaults to its initiative's branch");
    assert.equal(r.initiative.key, "FIL-I1");
    assert.deepEqual(r.my_claims.map((c: Json) => c.key), ["FIL-I1-1"]);
    assert.ok(Array.isArray(r.requests) && Array.isArray(r.pinned_decisions));
  });

  test("errors are claim's; a handed-off ticket comes with the note", async () => {
    const held = await client.callTool({ name: "start", arguments: { ...P, actor: B, key: "FIL-I1-1" } });
    assert.equal(JSON.parse((held.content as { text: string }[])[0]!.text).error, "CLAIM_HELD");
    await call("start", { ...P, key: "FIL-I1-2" });
    await call("handoff", { ...P, key: "FIL-I1-2", to: "s2", note: "tests written, docs left", head_sha: "abc1234" });
    const r = JSON.parse(((await client.callTool({ name: "start", arguments: { ...P, actor: B, key: "FIL-I1-2" } })).content as { text: string }[])[0]!.text);
    assert.equal(r.status, "In progress");
    assert.equal(r.handoff.note, "tests written, docs left");
    assert.equal(r.handoff.head_sha, "abc1234");
  });
});

describe("finish", () => {
  test("open checks roll the result back too, and name each check's text", async () => {
    const r = await call("finish", { ...P, key: "FIL-I1-1", result: pass(), pr_url: PR, branch: BRANCH });
    assert.equal(r.__error, "CHECKS_OPEN");
    assert.deepEqual(r.open, [1, 2]);
    assert.deepEqual(r.checks, [{ n: 1, text: "One works" }, { n: 2, text: "One is documented" }]);
    const t = await task("FIL-I1-1");
    assert.equal(t.results.length, 0, "one transaction: nothing written");
    assert.equal(t.status, "In progress");
  });

  test("a code ticket needs a PR, or a reason it has none", async () => {
    const r = await call("finish", { ...P, key: "FIL-I1-1", result: { ...pass(), check_ns: [1, 2] } });
    assert.equal(r.__error, "TASK_MISSING_PR_URL");
    assert.equal(r.__status, 400);
  });

  test("a pass at an old commit is EVIDENCE_STALE, saying where the head is", async () => {
    await raw.query("update branches set head_sha = 'bbbbbbb2222' where name = $1", [BRANCH]);
    const r = await call("finish", { ...P, key: "FIL-I1-1", result: { ...pass("aaaaaaa1111"), check_ns: [1, 2] }, pr_url: PR, branch: BRANCH });
    assert.equal(r.__error, "EVIDENCE_STALE");
    assert.equal(r.head, "bbbbbbb2222");
    assert.match(r.hint, /jl\/fil-surface is at bbbbbbb .* your passes name aaaaaaa/);
  });

  test("result, In review, branch, PR and the initiative's next_action land together", async () => {
    const before = await task("FIL-I1-1");
    const r = await call("finish", {
      ...P,
      key: "FIL-I1-1",
      result: { ...pass("bbbbbbb2222"), check_ns: [1, 2] },
      pr_url: PR,
      branch: BRANCH,
      version: before.version,
      note: "Phase 1 in review; FIL-I1-3 next",
    });
    assert.equal(r.status, "In review");
    assert.ok(r.changed.includes("results") && r.changed.includes("status"));
    assert.equal(r.result.commit, "bbbbbbb2222");
    assert.equal(r.initiative.next_action, "Phase 1 in review; FIL-I1-3 next");
    const t = await task("FIL-I1-1");
    assert.equal(t.pr_url, PR);
    assert.equal(t.claim, null, "In review releases the lease");
    assert.ok(t.checks.every((c: Json) => c.done));
    assert.equal((await task("FIL-I1")).next_action, "Phase 1 in review; FIL-I1-3 next");
  });

  test("no_pr_reason lets a code ticket through and keeps it out of the audit", async () => {
    await call("start", { ...P, key: "FIL-I1-3" });
    const r = await call("finish", { ...P, key: "FIL-I1-3", result: { ...pass(), check_ns: [1, 2] }, no_pr_reason: "config-only change applied on the Mac" });
    assert.equal(r.status, "In review");
    assert.ok(r.changed.includes("no_pr"));
    const audit = await call("audit", P);
    assert.ok(!audit.findings.some((f: Json) => f.code === "TASK_MISSING_PR_URL" && f.key === "FIL-I1-3"));
  });
});

describe("write-time guards", () => {
  test("Done on a code ticket without pr_url is TASK_MISSING_PR_URL unless no_pr_reason", async () => {
    await call("start", { ...P, key: "FIL-I1-4" });
    await call("add_result", { ...P, key: "FIL-I1-4", kind: "unit", verdict: "pass", cite: "ok", check_ns: [1, 2] });
    await call("set_task", { ...P, key: "FIL-I1-4", status: "In review", version: (await task("FIL-I1-4")).version });
    await call("add_result", { ...P, key: "FIL-I1-4", kind: "ci", verdict: "pass", cite: "merge green", commit: "ccccccc3" });
    const v = (await task("FIL-I1-4")).version;
    const refused = await call("set_task", { ...P, key: "FIL-I1-4", status: "Merged", version: v });
    assert.equal(refused.__error, "TASK_MISSING_PR_URL");
    assert.equal(refused.to, "Merged");
    await call("add_result", { ...P, key: "FIL-I1-4", kind: "scan", verdict: "pass", cite: "pnpm merge-gate example/filmia 41", commit: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" });
    await raw.query(
      `insert into pull_requests (project_id, repo, number, url, title, task_id, state, head_sha, merge_sha, merged_at, head_branch, base_branch)
       select p.id, 'example/filmia', 41, $1, 'phase', t.id, 'merged', 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', 'ccccccc3', now(), 'jl/fil-surface', 'main'
       from projects p join tasks t on t.project_id = p.id where p.slug = 'filmia' and t.key = 'FIL-I1-4'`,
      [PR],
    );
    const merged = await call("set_task", { ...P, key: "FIL-I1-4", status: "Merged", pr_url: PR, version: v });
    assert.equal(merged.status, "Merged");
    // A ticket closed without a PR, said why: allowed, logged.
    await raw.query("update tasks set pr_url = null where key = 'FIL-I1-4'");
    const v2 = (await task("FIL-I1-4")).version;
    assert.equal((await call("set_task", { ...P, key: "FIL-I1-4", status: "Done", version: v2 })).__error, "TASK_MISSING_PR_URL");
    const done = await call("set_task", { ...P, key: "FIL-I1-4", status: "Done", no_pr_reason: "merged by hand from a patch", version: v2 });
    assert.equal(done.status, "Done");
    const log = await call("list_events", { ...P, key: "FIL-I1-4", types: ["task.no_pr"] });
    assert.equal(log.events[0].payload.reason, "merged by hand from a patch");
  });

  test("ask answers with the question id and where the ticket waits", async () => {
    await call("create_task", { ...P, title: "Ask me", scope: "s", checks: ["c"], status: "Ready" }); // FIL-01
    await call("start", { ...P, key: "FIL-01" });
    const r = await call("ask", { ...P, key: "FIL-01", question: "Which poster size?" });
    assert.equal(r.status, "Needs Jorge");
    assert.equal(r.question_id, r.question.id);
    assert.equal(r.waits, "the ticket waits in Needs Jorge until he answers");
  });
});

describe("protocol 2.13", () => {
  test("three sections under 900 words, naming the six tools first", () => {
    const text = instructions(false);
    assert.equal(PROTOCOL_VERSION, "2.20");
    assert.ok(text.split(/\s+/).length < 900, `${text.split(/\s+/).length} words`);
    assert.match(text, /Never forward an answer/);
    for (const section of ["\nStart\n", "\nWork\n", "\nFinish\n"]) assert.ok(text.includes(section), section);
    assert.match(text.split("\n")[0]!, /start, finish, get_next, ask, register_footprint/);
  });
});
