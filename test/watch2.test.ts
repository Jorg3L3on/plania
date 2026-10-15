// 2.8 Watch API, phases 2 and 3: PR + done_at in task reads, ask blocks/urgency and the free-text
// wait audit, the session-wide heartbeat, digest collapse rules, the SSE stream, due dates with
// OVERDUE, and machine ↔ claim reconciliation (claim.stale).
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type pg from "pg";
import { TEST_READ_TOKEN, resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const { makeDb } = await import("../src/db/client.js");
const { createMcpServer } = await import("../src/mcp/register.js");
const { app } = await import("../src/app.js");
const { createTask, claim, setTask } = await import("../src/mcp/writes.js");
const { ask } = await import("../src/mcp/questions.js");
const { addResult } = await import("../src/mcp/evidence.js");
const { findProject, findTask } = await import("../src/mcp/queries.js");
const { auditProject } = await import("../src/mcp/audit.js");
const { collapseChanges } = await import("../src/mcp/watch.js");
const { markStaleClaims } = await import("../src/jobs/machine/index.js");

type Json = Record<string, any>;
let raw: pg.Client;
let client: Client; // full scopes: these tests write through the tools too
let closeDb: () => Promise<void>;
const A = { agent: "claude-code", session_id: "s1", machine: "mac" };
const ctx = { actor: A };

async function call(name: string, args: Json = {}): Promise<Json> {
  let r: { isError?: boolean; content: { text: string }[] };
  try {
    r = (await client.callTool({ name, arguments: args })) as typeof r;
  } catch (e) {
    return { __error: "INVALID_PARAMS", __message: String(e) }; // the schema (zod) refused it before the tool ran
  }
  let data: Json;
  try {
    data = JSON.parse(r.content[0]!.text);
  } catch {
    return { __error: "INVALID_PARAMS", __message: r.content[0]!.text }; // the schema (zod) refused it before the tool ran
  }
  return r.isError ? { __error: data.error, __status: data.status, ...data } : data;
}

async function version(key: string): Promise<number> {
  const { rows } = await raw.query("select version from tasks where key = $1", [key]);
  return rows[0].version;
}

const yesterday = () => new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

before(async () => {
  raw = await resetTestDb();
  const { db, close } = makeDb();
  closeDb = close;
  await createTask(db, { project: "filmia", kind: "initiative", title: "IMDb ratings", scope: "PRD", next_action: "Falta que el diseño lo apruebe Jorge" }, ctx); // FIL-I1
  await createTask(db, { project: "filmia", title: "Ratings in search", scope: "s", checks: ["c"], parent_key: "FIL-I1", status: "Ready", due_on: yesterday() }, ctx); // FIL-I1-1
  await createTask(db, { project: "filmia", title: "Ratings on detail", scope: "s", checks: ["c"], parent_key: "FIL-I1", status: "Ready" }, ctx); // FIL-I1-2
  await createTask(db, { project: "filmia", title: "Ratings cache", scope: "s", checks: ["c"], parent_key: "FIL-I1", status: "Ready" }, ctx); // FIL-I1-3
  await createTask(db, { project: "zigzag", title: "Receipt OCR", scope: "s", checks: ["c"], status: "Ready" }, ctx); // ZIG-01
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

describe("P2.1 structured PR and done_at", () => {
  test("list_tasks and get_task carry pr, status_changed_at, done_at and due_on", async () => {
    const { db, close } = makeDb();
    try {
      const p = await findProject(db, "filmia");
      const t1 = (await findTask(db, p.id, "FIL-I1-1"))!;
      await raw.query(
        `insert into pull_requests (project_id, repo, number, url, title, task_id, state, ci_state, merged_at)
         values ($1, 'Jorg3L3on/filmia', 150, 'https://github.com/Jorg3L3on/filmia/pull/150', 'Ratings', $2, 'merged', 'success', '2026-10-12T10:00:00Z')`,
        [p.id, t1.id],
      );
      await setTask(db, { project: "filmia", key: "FIL-I1-2", pr_url: "https://github.com/Jorg3L3on/filmia/pull/151", version: await version("FIL-I1-2") }, ctx);
    } finally {
      await close();
    }
    const list = (await call("list_tasks", { project: "filmia" })).tasks as Json[];
    const by = Object.fromEntries(list.map((t) => [t.key, t]));
    assert.deepEqual(by["FIL-I1-1"].pr, { number: 150, url: "https://github.com/Jorg3L3on/filmia/pull/150", state: "merged", ci_state: "success", merged_at: "2026-10-12T10:00:00.000Z" });
    assert.deepEqual(by["FIL-I1-2"].pr, { number: 151, url: "https://github.com/Jorg3L3on/filmia/pull/151", state: null, ci_state: null, merged_at: null }, "parsed from pr_url when the poller has not seen it");
    assert.equal(by["FIL-I1-3"].pr, null);
    assert.equal(by["FIL-I1-1"].due_on, yesterday());
    assert.equal(by["FIL-I1-1"].done_at, null);
    assert.equal(by["FIL-I1-1"].status_changed_at, null, "created in Ready, never moved");
    const full = await call("get_task", { project: "filmia", key: "FIL-I1-1" });
    assert.equal(full.pr.number, 150);
    assert.equal(full.due_on, yesterday());
    assert.equal(full.done_at, null);
    const summary = await call("get_task", { project: "filmia", key: "FIL-I1-2", view: "summary" });
    assert.equal(summary.pr.number, 151);
    // Done fills done_at (= resolved_at).
    const z = makeDb();
    try {
      await claim(z.db, { project: "zigzag", key: "ZIG-01" }, ctx);
      await raw.query("update checks set done = true where task_id = (select id from tasks where key = 'ZIG-01')");
      await addResult(z.db, { project: "zigzag", key: "ZIG-01", kind: "live", verdict: "pass", cite: "ok" }, ctx);
      await setTask(z.db, { project: "zigzag", key: "ZIG-01", work_type: "ops", version: await version("ZIG-01") }, ctx);
      await setTask(z.db, { project: "zigzag", key: "ZIG-01", status: "In review", version: await version("ZIG-01") }, ctx);
      await setTask(z.db, { project: "zigzag", key: "ZIG-01", status: "Done", version: await version("ZIG-01") }, ctx);
    } finally {
      await z.close();
    }
    const done = await call("get_task", { project: "zigzag", key: "ZIG-01", view: "summary" });
    assert.ok(typeof done.done_at === "string");
    assert.ok(Math.abs(Date.parse(done.done_at) - Date.parse(done.status_changed_at)) < 2000, "done_at is the moment it closed");
  });

  test("due_on must be a calendar date; null clears it", async () => {
    const bad = await call("set_task", { project: "filmia", key: "FIL-I1-3", due_on: "soon", version: await version("FIL-I1-3"), actor: A });
    assert.equal(bad.__error, "INVALID_FILTER");
    const ok = await call("set_task", { project: "filmia", key: "FIL-I1-3", due_on: "2026-12-01", version: await version("FIL-I1-3"), actor: A, verbose: true });
    assert.equal(ok.task.due_on, "2026-12-01");
    const cleared = await call("set_task", { project: "filmia", key: "FIL-I1-3", due_on: null, version: await version("FIL-I1-3"), actor: A, verbose: true });
    assert.equal(cleared.task.due_on, null);
  });
});

describe("P2.2 ask blocks/urgency and the free-text wait audit", () => {
  test("ask stores blocks (canonical keys) and urgency; the inbox and the digest show them", async () => {
    const r = await call("ask", { project: "filmia", key: "FIL-I1-2", question: "¿Mostramos ratings sin login?", options: ["sí", "no"], blocks: ["FIL-I1-3", "FIL-I1-3"], urgency: "soon", actor: A });
    assert.deepEqual(r.question.blocks, ["FIL-I1-3"]);
    assert.equal(r.question.urgency, "soon");
    const bad = await call("ask", { project: "filmia", key: "FIL-I1-3", question: "x", urgency: "yesterday", actor: A });
    assert.ok(bad.__error, "an unknown urgency is refused");
    const missing = await call("ask", { project: "filmia", key: "FIL-I1-3", question: "x", blocks: ["FIL-99"], actor: A });
    assert.equal(missing.__error, "TASK_NOT_FOUND");
    const inbox = await call("get_inbox", { project: "filmia" });
    const q = inbox.items.find((i: Json) => i.kind === "question");
    assert.deepEqual([q.blocks, q.urgency], [["FIL-I1-3"], "soon"]);
    const d = await call("get_digest", { since: 0, project: "filmia" });
    const n = d.needs_jorge.find((i: Json) => i.kind === "question");
    assert.deepEqual([n.key, n.blocks, n.urgency], ["FIL-I1-2", ["FIL-I1-3"], "soon"]);
    const asked = (await call("list_events", { project: "filmia", types: ["question.asked"] })).events.at(-1);
    assert.deepEqual([asked.payload.blocks, asked.payload.urgency], [["FIL-I1-3"], "soon"]);
  });

  test("audit: WAITING_ON_JORGE_FREE_TEXT only when nothing reaches the inbox; OVERDUE for a past due_on", async () => {
    const { db, close } = makeDb();
    try {
      // A blocked ticket that says it waits on Jorge in free text the 2.10 parser does not catch.
      await setTask(db, { project: "filmia", key: "FIL-I1-3", status: "Blocked", note: "the cache size is Jorge's pick", version: await version("FIL-I1-3") }, ctx);
      const p = await findProject(db, "filmia");
      const pairs = (await auditProject(db, p)).filter((f) => ["WAITING_ON_JORGE_FREE_TEXT", "OVERDUE"].includes(f.code)).map((f) => `${f.code}:${f.key}`);
      assert.deepEqual(pairs.sort(), ["OVERDUE:FIL-I1-1", "WAITING_ON_JORGE_FREE_TEXT:FIL-I1", "WAITING_ON_JORGE_FREE_TEXT:FIL-I1-3"]);
      // Once the initiative asks properly, its finding goes; the ticket's stays until it does too.
      await ask(db, { project: "filmia", key: "FIL-I1", question: "¿Apruebas el diseño?", urgency: "now" }, ctx);
      const keys = (await auditProject(db, p)).filter((f) => f.code === "WAITING_ON_JORGE_FREE_TEXT").map((f) => f.key);
      assert.deepEqual(keys, ["FIL-I1-3"]);
      const overdue = (await auditProject(db, p)).find((f) => f.code === "OVERDUE")!;
      assert.match(overdue.detail, /still Ready/);
    } finally {
      await close();
    }
  });
});

describe("P2.3 session heartbeat and digest collapse", () => {
  test('claim {action: heartbeat, key: "*"} extends every lease of the session and logs nothing', async () => {
    const { db, close } = makeDb();
    try {
      await claim(db, { project: "filmia", key: "FIL-I1-1", ttl_minutes: 5 }, ctx);
      await setTask(db, { project: "filmia", key: "FIL-I1-3", status: "Ready", version: await version("FIL-I1-3") }, ctx);
      await claim(db, { project: "filmia", key: "FIL-I1-3", ttl_minutes: 5 }, ctx);
      await claim(db, { project: "filmia", key: "FIL-I1-2", ttl_minutes: 5 }, { actor: { ...A, session_id: "s2" } }).catch(() => undefined); // Needs Jorge: not claimable; fine
    } finally {
      await close();
    }
    const before = await raw.query("select key, lease_until from tasks where key in ('FIL-I1-1','FIL-I1-3') order by key");
    const events = (await raw.query("select count(*)::int as n from events")).rows[0].n;
    const r = await call("claim", { project: "filmia", key: "*", action: "heartbeat", ttl_minutes: 60, actor: A });
    assert.deepEqual(r.extended, ["FIL-I1-1", "FIL-I1-3"]);
    const after_ = await raw.query("select key, lease_until from tasks where key in ('FIL-I1-1','FIL-I1-3') order by key");
    for (let i = 0; i < 2; i++) assert.ok(new Date(after_.rows[i].lease_until) > new Date(before.rows[i].lease_until), "lease moved");
    assert.equal((await raw.query("select count(*)::int as n from events")).rows[0].n, events, "no event");
    const other = await call("claim", { project: "filmia", key: "*", action: "heartbeat", actor: { ...A, session_id: "nobody" } });
    assert.deepEqual(other.extended, []);
    const wrong = await call("claim", { project: "filmia", key: "*", actor: A });
    assert.equal(wrong.__error, "NOT_CLAIMABLE");
  });

  test("collapse: consecutive status moves of one key fold into the last; a run of notes by one session folds with a count", () => {
    const ev = (id: number, type: string, key: string, summary: string, agent = "a") => ({ id, at: "t", type, task_key: key, summary, actor: { agent, session_id: "s" } });
    const lines = collapseChanges([
      ev(1, "task.status", "X-1", "X-1 → In progress"),
      ev(2, "task.status", "X-1", "X-1 → In review"),
      ev(3, "task.status", "X-2", "X-2 → Ready"),
      ev(4, "note", "X-2", "X-2 nota (a): uno"),
      ev(5, "note", "X-2", "X-2 nota (a): dos"),
      ev(6, "note", "X-2", "X-2 nota (b): tres", "b"),
      ev(7, "task.status", "X-1", "X-1 → Merged"),
    ]);
    assert.deepEqual(
      lines.map((l) => [l.id, l.summary, l.collapsed ?? 1]),
      [
        [2, "X-1 → In review", 2],
        [3, "X-2 → Ready", 1],
        [5, "X-2 2 notas (a); última: dos", 2],
        [6, "X-2 nota (b): tres", 1],
        [7, "X-1 → Merged", 1],
      ],
    );
  });

  test("the digest lists overdue tasks and list_projects counts them", async () => {
    const d = await call("get_digest", { since: 0 });
    assert.deepEqual(d.overdue.map((o: Json) => [o.project, o.key, o.days_late]), [["filmia", "FIL-I1-1", 1]]);
    const fil = (await call("list_projects")).projects.find((p: Json) => p.slug === "filmia");
    assert.equal(fil.counts.overdue, 1);
    assert.ok(d.projects[0].changes_lines <= d.projects[0].changes_total);
  });
});

describe("P3.1 GET /bot/v1/stream", () => {
  async function nextEvent(reader: ReadableStreamDefaultReader<Uint8Array>, pick: (name: string) => boolean): Promise<{ event: string; id: string | undefined; data: Json }> {
    const decoder = new TextDecoder();
    let buffer = "";
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const event = /^event: (.+)$/m.exec(frame)?.[1] ?? "";
        const id = /^id: (.+)$/m.exec(frame)?.[1];
        const data = /^data: (.*)$/m.exec(frame)?.[1];
        if (pick(event)) return { event, id, data: JSON.parse(data ?? "{}") };
      }
    }
    throw new Error("no matching event");
  }

  test("replays from Last-Event-ID across projects, then streams new writes", async () => {
    const last = (await raw.query("select max(id)::int as id from events")).rows[0].id as number;
    const res = await app.request("/bot/v1/stream?types=task.status,claim", { headers: { Authorization: `Bearer ${TEST_READ_TOKEN}`, "Last-Event-ID": String(last - 1) } });
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /text\/event-stream/);
    const reader = res.body!.getReader();
    const replayed = await nextEvent(reader, (n) => n !== "ready" && n !== "ping");
    assert.equal(Number(replayed.id), last, "the one event after the cursor is replayed");
    assert.ok(typeof replayed.data.project === "string" && typeof replayed.data.summary === "string");
    const ready = await nextEvent(reader, (n) => n === "ready");
    assert.equal(ready.data.cursor, last);
    const m = makeDb();
    try {
      await createTask(m.db, { project: "micasa", title: "Budget", scope: "s", checks: ["c"], status: "Ready" }, ctx); // MIC-01
      await claim(m.db, { project: "micasa", key: "MIC-01" }, ctx);
    } finally {
      await m.close();
    }
    const live = await nextEvent(reader, (n) => n.startsWith("claim.") || n === "task.status");
    assert.equal(live.data.project, "micasa");
    assert.ok(Number(live.id) > last);
    await reader.cancel();
    assert.equal((await app.request("/bot/v1/stream")).status, 401);
    assert.equal((await app.request("/bot/v1/stream?project=nope", { headers: { Authorization: `Bearer ${TEST_READ_TOKEN}` } })).status, 404);
  });
});

describe("P3.3 machine ↔ claim reconciliation", () => {
  test("a live claim whose worktree is gone from the Mac gets one claim.stale; get_running says stale", async () => {
    const { db, close } = makeDb();
    try {
      const mic = await findProject(db, "micasa");
      const t = (await findTask(db, mic.id, "MIC-01"))!;
      // MIC-01 was claimed without a workspace above; give it one on this machine.
      await claim(db, { project: "micasa", key: "MIC-01", workspace: { worktree_path: "/repos/micasa-wt/mic-01", branch: "mic-01" } }, ctx);
      const fresh = (await findTask(db, mic.id, "MIC-01"))!;
      const dir = {
        projects: [{ id: mic.id, slug: "micasa", keyPrefix: "MIC" }],
        repos: [{ name: "micasa", path: "/repos/micasa", projectId: mic.id, projectSlug: "micasa" }],
        worktrees: new Map(), // git lists no linked worktrees any more
        tasksById: new Map(),
        tasksByKey: new Map(),
        branchOwner: new Map(),
        claimed: [{ id: t.id, key: t.key, projectId: mic.id, status: fresh.status, owner: fresh.owner, leaseUntil: fresh.leaseUntil, workspace: fresh.workspace }],
      };
      // The worktree collector did not run for this repo: nothing is said.
      assert.equal(await markStaleClaims(db, "mac", dir as never, new Set()), 0);
      // A path outside every known repo (the worktree dir is not under /repos/micasa): still resolvable via nothing → skipped.
      assert.equal(await markStaleClaims(db, "mac", dir as never, new Set(["worktrees:micasa"])), 0, "a path under no known repo is not judged");
      // Now the worktree lives under the repo and git no longer lists it.
      await claim(db, { project: "micasa", key: "MIC-01", workspace: { worktree_path: "/repos/micasa/.worktrees/mic-01", branch: "mic-01" } }, ctx);
      const again = (await findTask(db, mic.id, "MIC-01"))!;
      dir.claimed = [{ ...dir.claimed[0]!, workspace: again.workspace, leaseUntil: again.leaseUntil }];
      assert.equal(await markStaleClaims(db, "mac", dir as never, new Set(["worktrees:micasa"])), 1);
      assert.equal(await markStaleClaims(db, "mac", dir as never, new Set(["worktrees:micasa"])), 0, "once per lease");
      // Another machine's tick says nothing about this machine's worktrees.
      assert.equal(await markStaleClaims(db, "other-mac", dir as never, new Set(["worktrees:micasa"])), 0);
    } finally {
      await close();
    }
    const stale = (await call("list_events", { project: "micasa", types: ["claim.stale"] })).events;
    assert.equal(stale.length, 1);
    assert.equal(stale[0].summary, "MIC-01: el worktree de claude-code ya no está en la Mac (/repos/micasa/.worktrees/mic-01)");
    const running = (await call("get_running")).running.find((r: Json) => r.key === "MIC-01");
    assert.deepEqual([running.liveness, running.gone_on_machine], ["stale", true]);
    // A new lease on the same ticket starts clean.
    const m2 = makeDb();
    try {
      await claim(m2.db, { project: "micasa", key: "MIC-01", action: "release" }, ctx);
      await claim(m2.db, { project: "micasa", key: "MIC-01", workspace: { worktree_path: "/repos/micasa/.worktrees/mic-01", branch: "mic-01" } }, { actor: { ...A, session_id: "s3" } });
    } finally {
      await m2.close();
    }
    const fresh = (await call("get_running")).running.find((r: Json) => r.key === "MIC-01");
    assert.equal(fresh.liveness, "live");
  });
});
