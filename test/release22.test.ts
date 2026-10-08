// 2.2: sourced environments and flags (R-20), typed blockers (R-15), the branch registry (R-09),
// resources and quotas (R-10), structured and stale evidence (R-17), Merged/Released by hand (R-12),
// areas (R-11), bugs and debt (R-19), the status block (R-02b), and the inbox's new kinds.
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
const { promoteDue } = await import("../src/jobs/blockers.js");

type Json = Record<string, any>;
const A = { agent: "test-agent", session_id: "s1", machine: "MacBook-Air" };
const B = { agent: "codex", session_id: "s2", machine: "Mac-mini" };
const P = { project: "filmia" };
const T = { scope: "s", checks: ["c"] };

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
    return { __error: "INVALID_INPUT", __text: text };
  }
  return r.isError ? { __error: data.error, __status: data.status, ...data } : data;
}
const version = async (key: string) => (await call("get_task", { ...P, key, view: "summary" })).version;
const req = (method: string, path: string, body?: unknown) =>
  app.request(path, { method, headers: { Cookie: cookie, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });

before(async () => {
  raw = await resetTestDb();
  cookie = `${SESSION_COOKIE}=${createSession()}`;
  const { db, close } = makeDb();
  closeDb = close;
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createMcpServer(db).connect(serverSide);
  client = new Client({ name: "test", version: "0" });
  await client.connect(clientSide);
  const p = await call("get_project", P);
  await call("set_project", { ...P, version: p.version, settings: { branch_pattern: "^jl/[a-z0-9][a-z0-9-]*$", release_target: "prod", claim_from: "ready", quotas: { "quota:omdb": { daily: 5 } }, resources: { "neon-prod:*": { needs_approval: true } } } });
});

after(async () => {
  await client?.close();
  await closeDb?.();
  await raw?.end();
});

describe("environments", () => {
  test("deployed needs a source; flags refuse secrets; migration tags derive migrations_applied", async () => {
    assert.equal((await call("set_env", { ...P, env: "prod", deployed: true })).__error, "DEPLOY_SOURCE_REQUIRED");
    const r = await call("set_env", {
      ...P, env: "prod", commit: "963e7a6", branch: "main", migrations: ["0000_init", "0009_awards", "0010_titles"],
      flags: { google_oauth: false, omdb_key: "valid" }, deployed: { provider: "vercel", deployment_id: "dpl_1", url: "https://filmia.vercel.app" },
    });
    assert.equal(r.env.migrations_applied, 10);
    assert.deepEqual(r.env.flags, { google_oauth: false, omdb_key: "valid" });
    assert.equal(r.env.source.provider, "vercel");
    assert.match(r.env.deployed_at, /Z$/);
    const secret = await call("set_env", { ...P, env: "prod", flags: { omdb_api_key: "sk-abcdefghijklmnopqrstuvwxyz" } });
    assert.equal(secret.__error, "SECRET_LIKE_VALUE");
    assert.equal((await call("set_env", { ...P, env: "prod", flags: { session: "AKIAIOSFODNN7EXAMPLE" } })).__error, "SECRET_LIKE_VALUE");
    const merged = await call("set_env", { ...P, env: "prod", flags: { omdb_key: null, pickevent: true } });
    assert.deepEqual(merged.env.flags, { google_oauth: false, pickevent: true }, "flags merge; null removes");
    assert.deepEqual(Object.keys((await call("get_project", P)).env).sort(), ["prod"]);
    await call("set_env", { ...P, env: "sandbox", commit: "1a2b3c4" });
    assert.deepEqual(Object.keys((await call("get_project", P)).env).sort(), ["prod", "sandbox"], "any number of environments");
  });
});

describe("typed blockers", () => {
  test("human_action, env_flag, time_after and metric_gte: get_next skips them; the server promotes Blocked to Ready", async () => {
    await call("create_task", { ...P, kind: "initiative", title: "Google SSO", scope: "PRD" }); // FIL-I1
    const oauth = await call("create_task", {
      ...P, title: "Verify Google SSO", ...T, parent_key: "FIL-I1", status: "Ready",
      blocked_by: [{ human_action: { text: "Create the Google OAuth credentials" } }, { env_flag: { env: "prod", flag: "google_oauth", equals: true } }],
    });
    assert.equal(oauth.key, "FIL-I1-1");
    const t = await call("get_task", { ...P, key: "FIL-I1-1" });
    assert.deepEqual(t.blocked_by.map((b: Json) => [b.type, b.satisfied]), [["env_flag", false], ["human_action", false]]);
    assert.equal((await call("get_next", { ...P, initiative_key: "FIL-I1" })).task, null, "blocked tickets are never offered");
    assert.equal((await call("claim", { ...P, key: "FIL-I1-1" })).__error, "NOT_CLAIMABLE");
    assert.equal((await call("create_task", { ...P, title: "x", ...T, blocked_by: [{ env_flag: { env: "prod", flag: "Bad Flag", equals: 1 } }] })).__error, "INVALID_BLOCKER");

    // Blocked with a note: once every blocker holds, the server moves it to Ready.
    await call("set_task", { ...P, key: "FIL-I1-1", status: "Blocked", note: "waiting on Jorge and the flag", version: await version("FIL-I1-1") });
    const inbox = (await (await req("GET", "/api/inbox?project=filmia")).json()) as Json;
    const action = inbox.items.find((i: Json) => i.kind === "human_action");
    assert.equal(action.why, "Create the Google OAuth credentials");
    const resolved = await req("POST", `/api/projects/filmia/blockers/${action.id}/resolve`);
    assert.equal(resolved.status, 200);
    assert.equal((await call("get_task", { ...P, key: "FIL-I1-1", view: "summary" })).status, "Blocked", "the flag still misses");
    await call("set_env", { ...P, env: "prod", flags: { google_oauth: true } });
    const ready = await call("get_task", { ...P, key: "FIL-I1-1" });
    assert.equal(ready.status, "Ready");
    assert.equal(ready.blocked_note, null);
    const ev = (await call("list_events", { ...P, key: "FIL-I1-1", types: ["blocker.satisfied"] })).events;
    assert.equal(ev.length, 1);
    assert.equal(ev[0].actor.agent, "plania");
    assert.equal((await call("get_next", { ...P, initiative_key: "FIL-I1" })).task.key, "FIL-I1-1");
  });

  test("time_after waits for the clock (the job promotes); metric_gte waits for a reported value", async () => {
    const soon = new Date(Date.now() + 60_000).toISOString();
    await call("create_task", { ...P, title: "Nightly report", ...T, parent_key: "FIL-I1", status: "Ready", blocked_by: [{ time_after: soon }, { metric_gte: { name: "pickevent_nights", value: 30 } }] }); // FIL-I1-2
    await call("set_task", { ...P, key: "FIL-I1-2", status: "Blocked", note: "not before 30 nights", version: 1 });
    await call("set_metric", { ...P, name: "pickevent_nights", value: 12 });
    const { db, close } = makeDb();
    try {
      assert.equal(await promoteDue(db, new Date(Date.now() + 120_000)), 0, "the metric still misses");
      await call("add_result", { ...P, key: "FIL-I1-2", kind: "verify", verdict: "pass", cite: "31 nights in the table", metrics: { pickevent_nights: 31 } });
      assert.equal((await call("get_task", { ...P, key: "FIL-I1-2", view: "summary" })).status, "Blocked", "time_after still holds it");
      // The clock moves on (the job runs every 30 s).
      await raw.query(`update blockers set spec = jsonb_set(spec, '{at}', '"2020-01-01T00:00:00.000Z"') where type = 'time_after'`);
      assert.equal(await promoteDue(db, new Date()), 1);
    } finally {
      await close();
    }
    assert.equal((await call("get_task", { ...P, key: "FIL-I1-2", view: "summary" })).status, "Ready");
    assert.equal((await call("get_project", P)).metrics.pickevent_nights.value, 31);
    assert.equal((await call("set_metric", { ...P, name: "Bad", value: 1 })).__error, "INVALID_METRIC");
  });

  test("claim_from ready: Backlog tickets are not offered", async () => {
    await call("create_task", { ...P, title: "Someday", ...T, parent_key: "FIL-I1" }); // Backlog
    const next = (await call("get_next", { ...P, initiative_key: "FIL-I1" })).task;
    assert.notEqual(next.status, "Backlog");
  });
});

describe("branches", () => {
  test("an initiative registers its integration branch; another live initiative needs share_branch; names follow the pattern; phases inherit the branch", async () => {
    const v = await version("FIL-I1");
    assert.equal((await call("set_task", { ...P, key: "FIL-I1", integration_branch: "feature/sso", version: v })).__error, "BRANCH_NAME_INVALID");
    const ok = await call("set_task", { ...P, key: "FIL-I1", integration_branch: "jl/google-sso", version: v });
    assert.deepEqual(ok.changed, ["branch"], JSON.stringify(ok));
    assert.equal((await call("get_task", { ...P, key: "FIL-I1", view: "summary" })).branch, "jl/google-sso");
    await call("create_task", { ...P, kind: "initiative", title: "Awards", scope: "PRD" }); // FIL-I2
    const clash = await call("set_task", { ...P, key: "FIL-I2", integration_branch: "jl/google-sso", version: await version("FIL-I2") });
    assert.equal(clash.__error, "BRANCH_IN_USE");
    assert.equal(clash.owner_key, "FIL-I1");
    const shared = await call("set_task", { ...P, key: "FIL-I2", integration_branch: "jl/google-sso", share_branch: true, share_reason: "one rollout", version: await version("FIL-I2") });
    assert.equal(shared.__error, undefined, JSON.stringify(shared));
    assert.equal((await call("get_task", { ...P, key: "FIL-I2", view: "summary" })).branch, "jl/google-sso");
    const branches = (await call("get_project", P)).branches;
    assert.deepEqual(branches.map((b: Json) => [b.name, b.owner_key, b.shared]), [["jl/google-sso", "FIL-I1", true]]);

    const claimed = await call("claim", { ...P, key: "FIL-I1-1", workspace: { worktree_path: "/w/sso" } });
    assert.equal(claimed.__error, undefined, JSON.stringify(claimed));
    assert.equal(claimed.workspace.branch, "jl/google-sso", "a phase works on its initiative's branch");
    await call("create_task", { ...P, kind: "initiative", title: "Other", scope: "PRD", integration_branch: "jl/other" }); // FIL-I3
    await call("create_task", { ...P, title: "Stray", ...T, parent_key: "FIL-I3", status: "Ready" }); // FIL-I3-1
    const wrong = await call("claim", { ...P, key: "FIL-I3-1", workspace: { branch: "jl/google-sso" }, actor: B });
    assert.equal(wrong.__error, "BRANCH_IN_USE", "a shared branch is still owned by others");
    assert.equal((await call("claim", { ...P, key: "FIL-I3-1", workspace: { branch: "claude/x" }, actor: B })).__error, "BRANCH_NAME_INVALID");
  });
});

describe("areas", () => {
  test("claiming with overlapping areas warns and names the other claim", async () => {
    await call("set_task", { ...P, key: "FIL-I1-1", areas: ["drizzle/**", "src/db/schema.ts"], version: await version("FIL-I1-1") });
    await call("set_task", { ...P, key: "FIL-I3-1", areas: ["drizzle/0011*"], version: await version("FIL-I3-1") });
    const r = await call("claim", { ...P, key: "FIL-I3-1", actor: B, workspace: { branch: "jl/other" } });
    assert.equal(r.__error, undefined, JSON.stringify(r));
    assert.deepEqual(r.warnings, ["FIL-I1-1 (test-agent) also works on drizzle/**"]);
  });
});

describe("resources and quotas", () => {
  test("a port is per machine; a held resource is RESOURCE_HELD; quotas count per UTC day; policies may need approval", async () => {
    const mine = await call("lease_resource", { ...P, name: "port:3001", purpose: "filmia dev" });
    assert.equal(mine.resource.name, "port:3001@MacBook-Air");
    const other = await call("lease_resource", { ...P, name: "port:3001", actor: B });
    assert.equal(other.resource.name, "port:3001@Mac-mini", "another machine, no clash");
    const clash = await call("lease_resource", { ...P, name: "port:3001@MacBook-Air", actor: B });
    assert.equal(clash.__error, "RESOURCE_HELD");
    assert.equal(clash.holder.session_id, "s1");
    assert.equal((await call("lease_resource", { ...P, name: "port:3001", ttl_minutes: 60 })).extended, true);
    assert.equal((await call("release_resource", { ...P, name: "port:3001@MacBook-Air", actor: B })).__error, "RESOURCE_HELD");
    assert.equal((await call("release_resource", { ...P, name: "port:3001" })).released, true);
    assert.equal((await call("lease_resource", { ...P, name: "port:3001@MacBook-Air", actor: B })).resource.holder.session_id, "s2");

    assert.equal((await call("consume", { ...P, name: "quota:omdb", n: 3 })).remaining, 2);
    const over = await call("consume", { ...P, name: "quota:omdb", n: 3 });
    assert.equal(over.__error, "QUOTA_EXCEEDED");
    assert.equal(over.remaining, 2);
    assert.equal((await call("consume", { ...P, name: "quota:nope" })).__error, "INVALID_RESOURCE");
    const res = (await call("get_project", P)).resources;
    assert.equal(res.quotas["quota:omdb"].used, 3);
    assert.equal(res.leases.length, 2);

    const gated = await call("lease_resource", { ...P, name: "neon-prod:migrate", purpose: "apply 0011" });
    assert.equal(gated.__error, "APPROVAL_REQUIRED");
  });
});

describe("evidence and the review gate", () => {
  test("structured results; a result goes stale once the branch head moves; In review needs a fresh pass", async () => {
    const r = await call("add_result", {
      ...P, key: "FIL-I1-1", kind: "e2e", verdict: "pass", cite: "Playwright 12 pass", commit: "aaaaaaa", branch: "jl/google-sso",
      command: "pnpm e2e", exit_code: 0, counts: { pass: 12, fail: 0 }, duration_s: 41, viewport: "375x812", attachments: ["https://ci.example/run/1/trace.zip"],
    });
    assert.equal(r.result.counts.pass, 12);
    assert.equal(r.result.stale_for_head, false, "the only commit seen on the branch is the head");
    assert.equal((await call("add_result", { ...P, key: "FIL-I1-1", kind: "ci", verdict: "pass", cite: "x", commit: "nope" })).__error, "INVALID_RESULT");
    assert.equal((await call("add_result", { ...P, key: "FIL-I1-1", kind: "ci", verdict: "pass", cite: "x", attachments: ["file:///x"] })).__error, "INVALID_RESULT");
    // The poller learns a newer head.
    await raw.query("update branches set head_sha = 'bbbbbbb1234' where name = 'jl/google-sso'");
    const t = await call("get_task", { ...P, key: "FIL-I1-1" });
    assert.equal(t.results.find((x: Json) => x.kind === "e2e").stale_for_head, true);
    await call("set_check", { ...P, key: "FIL-I1-1", n: 1, done: true });
    const stale = await call("set_task", { ...P, key: "FIL-I1-1", status: "In review", version: await version("FIL-I1-1") });
    assert.equal(stale.__error, "EVIDENCE_STALE", JSON.stringify(stale));
    assert.equal(stale.head, "bbbbbbb1234");
    await call("add_result", { ...P, key: "FIL-I1-1", kind: "ci", verdict: "pass", cite: "green at head", commit: "bbbbbbb", branch: "jl/google-sso" });
    const reviewed = await call("set_task", { ...P, key: "FIL-I1-1", status: "In review", pr_url: "https://github.com/Jorg3L3on/filmia/pull/130", version: await version("FIL-I1-1") });
    assert.equal(reviewed.status, "In review");
  });

  test("Merged by hand needs a ci pass naming the merge commit; Released needs the release target to contain it", async () => {
    const v = () => version("FIL-I1-1");
    const noProof = await call("set_task", { ...P, key: "FIL-I1-1", status: "Released", version: await v() });
    assert.equal(noProof.__error, "INVALID_TRANSITION");
    await raw.query("update results set commit = null where kind = 'ci'");
    assert.equal((await call("set_task", { ...P, key: "FIL-I1-1", status: "Merged", version: await v() })).__error, "EVIDENCE_REQUIRED");
    await call("add_result", { ...P, key: "FIL-I1-1", kind: "ci", verdict: "pass", cite: "merge commit green", commit: "cccccccc1" });
    const merged = await call("set_task", { ...P, key: "FIL-I1-1", status: "Merged", version: await v() });
    assert.equal(merged.status, "Merged");
    const early = await call("set_task", { ...P, key: "FIL-I1-1", status: "Released", version: await v() });
    assert.equal(early.__error, "EVIDENCE_REQUIRED");
    await call("set_env", { ...P, env: "prod", commit: "cccccccc1", deployed: { provider: "vercel", deployment_id: "dpl_2" } });
    const released = await call("set_task", { ...P, key: "FIL-I1-1", status: "Released", version: await v() });
    assert.equal(released.status, "Released");
    const status = (await call("get_resume", P)).status;
    assert.deepEqual(status.released_waiting_done, ["FIL-I1-1"]);
    const inbox = (await (await req("GET", "/api/inbox?project=filmia")).json()) as Json;
    assert.equal(inbox.items.find((i: Json) => i.key === "FIL-I1-1"), undefined, "a Released ticket does not wait on Jorge");
    const done = await call("set_task", { ...P, key: "FIL-I1-1", status: "Done", version: await v() });
    assert.equal(done.status, "Done", "the agent closes it, no approval");
    assert.deepEqual((await call("get_resume", P)).status.released_waiting_done, []);
  });
});

describe("bugs and debt", () => {
  test("a bug needs a severity; list_tasks filters by it; the status block lists S1 and S2", async () => {
    assert.equal((await call("create_task", { ...P, title: "Blank ratings", ...T, work_type: "bug" })).__error, "INVALID_SEVERITY");
    assert.equal((await call("create_task", { ...P, title: "x", ...T, severity: "S1" })).__error, "INVALID_SEVERITY", "severity is for bugs");
    const bug = await call("create_task", { ...P, title: "Blank ratings", ...T, work_type: "bug", severity: "S1", found_in: "prod", introduced_by: "FIL-I1-1", regression: true });
    const full = await call("get_task", { ...P, key: bug.key });
    assert.deepEqual([full.severity, full.found_in, full.introduced_by, full.regression], ["S1", "prod", "FIL-I1-1", true]);
    const debt = await call("create_task", { ...P, title: "Verify script can't fail", ...T, work_type: "debt", cost_note: "false confidence on every deploy" });
    assert.equal((await call("get_task", { ...P, key: debt.key })).cost_note, "false confidence on every deploy");
    const listed = await call("list_tasks", { ...P, work_type: "bug", severity: ["S1", "S2"] });
    assert.equal(listed.__error, undefined, JSON.stringify(listed));
    const s1 = listed.tasks;
    assert.deepEqual(s1.map((t: Json) => [t.key, t.severity]), [[bug.key, "S1"]]);
    const status = (await call("get_resume", P)).status;
    assert.deepEqual(status.s1_s2_bugs.map((b: Json) => b.key), [bug.key]);
  });
});

describe("status block", () => {
  test("envs with drift, initiatives with counts, next claimable, who waits on Jorge, in-review PR state", async () => {
    const s = (await call("get_resume", P)).status;
    const prod = s.envs.find((e: Json) => e.env === "prod");
    assert.equal(prod.commit, "cccccccc1");
    assert.deepEqual(prod.drift.behind.map((b: Json) => b.key).sort(), ["FIL-I1", "FIL-I2"], "jl/google-sso's head is not what prod runs");
    const i1 = s.initiatives.find((i: Json) => i.key === "FIL-I1");
    assert.equal(i1.integration_branch, "jl/google-sso");
    assert.equal(i1.head_sha, "bbbbbbb1234");
    assert.equal(i1.counts.Done, 1);
    assert.equal(typeof s.open_questions, "number");
    assert.equal(s.audit_findings, null);
    assert.ok(JSON.stringify(s).length < 4096, "small");
  });
});
