// 2.11 Orden (item 4): the audit on screen with one-click fixes, chores from get_next, and get_context's audit.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { resetTestStore, useTestEnv, type TestStore } from "./helpers.js";

useTestEnv();
const { app } = await import("../src/app.js");
const { notNull } = await import("../src/store/types.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const { makeDb } = await import("../src/db/client.js");
const { createMcpServer } = await import("../src/mcp/register.js");
const { runAudit } = await import("../src/mcp/audit.js");
const { findProject } = await import("../src/mcp/queries.js");

type Json = Record<string, any>;
const A = { agent: "test-agent", session_id: "s1", machine: "ci" };
const P = { project: "workia" };
const T = { scope: "s", checks: ["c"] };

let client: Client;
let store: TestStore;
let db: ReturnType<typeof makeDb>["db"];
let closeDb: () => Promise<void>;
const cookie = () => `${SESSION_COOKIE}=${createSession()}`;

async function call(name: string, args: Json): Promise<Json> {
  const r = (await client.callTool({ name, arguments: { actor: A, ...args } })) as { isError?: boolean; content: { text: string }[] };
  const data = JSON.parse(r.content[0]!.text);
  return r.isError ? { __error: data.error, ...data } : data;
}
async function api(method: string, path: string, body?: unknown) {
  const res = await app.request(path, {
    method,
    headers: { Cookie: cookie(), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Json };
}
const audit = async () => runAudit(db, await findProject(db, "workia"));
const setStatus = (key: string, status: string) => store.fix((uow) => uow.update("tasks", { key }, { status }));

before(async () => {
  store = await resetTestStore();
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
  await store?.end();
});

describe("Orden on screen", () => {
  test("the last run with can_fix and owner; three stale decisions go with three clicks; mark_deployed; copy is not a click", async () => {
    await call("create_task", { ...P, kind: "initiative", title: "Multiempresa", scope: "s", integration_branch: "jl/multi" }); // WRK-I1
    await call("create_task", { ...P, title: "Dropped", ...T, parent_key: "WRK-I1" }); // WRK-I1-1
    await setStatus("WRK-I1-1", "Won't do");
    // prod ran abc1234, then moved on: a decision citing abc1234 is stale.
    await call("set_env", { ...P, env: "prod", commit: "abc1234", deployed: { provider: "vercel", deployment_id: "d1" } });
    await call("add_decision", { ...P, text: "Hold the migration until abc1234 is verified" });
    await call("set_env", { ...P, env: "prod", commit: "def5678" });
    // A pinned decision about a merged PR, and one about a Won't do ticket.
    const p = await findProject(db, "workia");
    await store.fix((uow) =>
      uow.insert("pullRequests", { projectId: p.id, repo: "x/workia", number: 50, url: "https://github.com/x/workia/pull/50", title: "t", state: "merged", mergedAt: new Date() }),
    );
    await call("add_decision", { ...P, text: "Keep RLS off until #50 lands", pin: true });
    await call("add_decision", { ...P, text: "Dropped ticket keeps its schema", task_key: "WRK-I1-1", pin: true });
    // A merged branch nobody deleted, and an env with no deployed_at.
    await store.fix(async (uow) => {
      const now = new Date();
      await uow.insert("branches", { projectId: p.id, name: "jl/old", headSha: "aaaa111", mergedAt: now });
      await uow.insert("branches", { projectId: p.id, name: "sandbox", headSha: "bbbb222", mergedAt: now });
    });
    await call("set_env", { ...P, env: "sandbox", commit: "fed9876", branch: "sandbox" });
    await audit();

    const { status, body } = await api("GET", "/api/projects/workia/audit");
    assert.equal(status, 200);
    const byCode = (code: string) => body.findings.filter((f: Json) => f.code === code);
    assert.equal(byCode("DECISION_STALE_REF").length, 2);
    assert.equal(byCode("DECISION_CONTRADICTS_DONE").length, 1);
    for (const f of [...byCode("DECISION_STALE_REF"), ...byCode("DECISION_CONTRADICTS_DONE")]) {
      assert.equal(f.can_fix, "retire_decision");
      assert.equal(f.owner, "jorge");
      assert.match(f.id, /^[0-9a-f-]{36}$/);
    }
    const branch = byCode("BRANCH_MERGED_NOT_DELETED")[0];
    assert.deepEqual([branch.can_fix, branch.command], ["copy", "git push origin --delete jl/old"]);
    assert.equal(byCode("BRANCH_MERGED_NOT_DELETED").length, 1, "a branch an env runs is long-lived: never offered for deletion");
    const env = byCode("ENV_DEPLOYED_AT_MISSING")[0];
    assert.deepEqual([env.can_fix, env.id], ["mark_deployed", "sandbox"]);
    assert.ok(body.findings.filter((f: Json) => f.can_fix === "open").every((f: Json) => f.owner === "agents"));

    // Three clicks.
    for (const f of [...byCode("DECISION_STALE_REF"), ...byCode("DECISION_CONTRADICTS_DONE")]) {
      const r = await api("POST", "/api/projects/workia/audit/fix", { code: f.code, key: f.key, id: f.id });
      assert.equal(r.status, 200, JSON.stringify(r.body));
    }
    const after = (await api("GET", "/api/projects/workia/audit")).body;
    assert.equal(after.findings.filter((f: Json) => f.code.startsWith("DECISION_")).length, 0, "gone after three clicks");
    const retired = (await store.find("decisions", { retiredAt: notNull() })).filter((d) => d.retiredBy?.agent === "jorge").length;
    assert.equal(retired, 3);

    const again = await api("POST", "/api/projects/workia/audit/fix", { code: "DECISION_STALE_REF", id: byCode("DECISION_STALE_REF")[0].id });
    assert.deepEqual([again.status, again.body.error], [404, "FINDING_NOT_FOUND"]);
    const copy = await api("POST", "/api/projects/workia/audit/fix", { code: "BRANCH_MERGED_NOT_DELETED", id: "jl/old" });
    assert.deepEqual([copy.status, copy.body.error], [400, "FINDING_NOT_FIXABLE"]);

    const deployed = await api("POST", "/api/projects/workia/audit/fix", { code: "ENV_DEPLOYED_AT_MISSING", key: null, id: "sandbox" });
    assert.equal(deployed.status, 200);
    assert.ok(!deployed.body.findings.some((f: Json) => f.code === "ENV_DEPLOYED_AT_MISSING" && f.id === "sandbox"));
    const rows = (await store.find("envStates", { env: "sandbox" })).map((e) => ({ at: e.deployedAt !== null, provider: e.deploySource?.provider ?? null }));
    assert.deepEqual(rows, [{ at: true, provider: "jorge" }]);

    // The home tiles carry the count.
    const tiles = (await api("GET", "/api/projects")).body as Json[];
    assert.equal(tiles.find((t) => t.slug === "workia")!.audit_count, deployed.body.count);
    assert.equal(typeof tiles.find((t) => t.slug === "workia")!.next_line, "string");
  });
});

describe("chores for agents", () => {
  test("get_next on a quiet project offers a stale state_note; a claimable ticket wins over chores", async () => {
    await call("create_task", { ...P, kind: "initiative", title: "Reportes", scope: "s" }); // WRK-I2
    await call("create_task", { ...P, title: "Export", ...T, parent_key: "WRK-I2", status: "Ready" }); // WRK-I2-1
    let i = await call("get_task", { ...P, key: "WRK-I2", view: "summary" });
    await call("set_task", { ...P, key: "WRK-I2", state_note: "export first", version: i.version });
    await store.fix((uow) => uow.update("tasks", { key: "WRK-I2-1" }, { status: "Done", statusChangedAt: new Date(Date.now() + 60_000) }));
    await store.fix((uow) => uow.delete("auditRuns", {}));

    const quiet = await call("get_next", P);
    assert.equal(quiet.task, null);
    assert.equal(quiet.chore.code, "STATE_NOTE_STALE");
    assert.equal(quiet.chore.key, "WRK-I2");
    assert.match(quiet.chore.fix_hint, /set_task state_note/);

    // An agent-fixable audit finding comes first: an In review ticket with no PR.
    await call("create_task", { ...P, title: "Review me", ...T }); // WRK-01
    await setStatus("WRK-01", "In review");
    await audit();
    assert.equal((await call("get_next", P)).chore.code, "TASK_MISSING_PR_URL");

    await call("create_task", { ...P, title: "Ready one", ...T, status: "Ready" }); // WRK-02
    const busy = await call("get_next", P);
    assert.equal(busy.task.key, "WRK-02");
    assert.equal(busy.chore, undefined);

    // Done with the chore: the note is rewritten, the offer moves on.
    i = await call("get_task", { ...P, key: "WRK-I2", view: "summary" });
    await call("set_task", { ...P, key: "WRK-I2", state_note: "", version: i.version });
  });

  test("get_context carries the audit count and the findings on my tickets", async () => {
    await call("claim", { ...P, key: "WRK-02", workspace: { branch: "jl/wrk-02", worktree_path: "/tmp/wrk" } });
    await setStatus("WRK-02", "In review");
    await store.fix((uow) => uow.update("tasks", { key: "WRK-02" }, { owner: A, leaseUntil: new Date(Date.now() + 3_600_000) }));
    await audit();
    const ctx = await call("get_context", { ...P, session_id: "s1", workspace: { branch: "jl/wrk-02", worktree_path: "/tmp/wrk" } });
    assert.ok(ctx.audit.count > 0);
    assert.deepEqual(ctx.audit.on_my_tickets.map((f: Json) => [f.code, f.key]), [["TASK_MISSING_PR_URL", "WRK-02"]]);
  });
});
