// 2.7 Watch API: the cross-project feed, list_projects, get_running, get_digest (with the server
// remembering each reader's cursor), the proactive lease reaper and the /bot/v1 GET mirror.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type pg from "pg";
import { TEST_BEARER, TEST_CI_TOKEN, TEST_READ_TOKEN, resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const { makeDb } = await import("../src/db/client.js");
const { createMcpServer } = await import("../src/mcp/register.js");
const { app } = await import("../src/app.js");
const { createTask, claim, setTask } = await import("../src/mcp/writes.js");
const { addResult } = await import("../src/mcp/evidence.js");
const { ask } = await import("../src/mcp/questions.js");
const { findProject } = await import("../src/mcp/queries.js");
const { reapExpired } = await import("../src/jobs/leases.js");
const { registerProject } = await import("../scripts/register-project.js");

type Json = Record<string, any>;
let raw: pg.Client;
let client: Client; // read-only, as the assistant's token would be
let closeDb: () => Promise<void>;
const ctx = { actor: { agent: "claude-code", session_id: "s1", machine: "mac" } };
const other = { actor: { agent: "codex", session_id: "s2", machine: "mac" } };

async function call(name: string, args: Json = {}): Promise<Json> {
  const r = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: { text: string }[] };
  const data = JSON.parse(r.content[0]!.text);
  return r.isError ? { __error: data.error, __status: data.status } : data;
}

async function version(key: string): Promise<number> {
  const { rows } = await raw.query("select version from tasks where key = $1", [key]);
  return rows[0].version;
}

function get(path: string, token: string | null = TEST_READ_TOKEN) {
  return app.request(path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
}

before(async () => {
  raw = await resetTestDb();
  const { db, close } = makeDb();
  closeDb = close;
  // Two projects with work, two quiet ones.
  await createTask(db, { project: "filmia", kind: "initiative", title: "IMDb ratings", scope: "PRD" }, ctx); // FIL-I1
  await createTask(db, { project: "filmia", title: "Ratings in search", scope: "s", checks: ["c"], parent_key: "FIL-I1", status: "Ready" }, ctx); // FIL-I1-1
  await createTask(db, { project: "filmia", title: "Ratings on detail", scope: "s", checks: ["c"], parent_key: "FIL-I1", status: "Ready" }, ctx); // FIL-I1-2
  await createTask(db, { project: "zigzag", title: "Receipt OCR", scope: "s", checks: ["c"], status: "Ready" }, other); // ZIG-01
  await claim(db, { project: "filmia", key: "FIL-I1-1" }, ctx);
  await claim(db, { project: "zigzag", key: "ZIG-01" }, other);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createMcpServer(db, { scopes: ["read"] }).connect(serverSide);
  client = new Client({ name: "assistant", version: "0" });
  await client.connect(clientSide);
});

after(async () => {
  await client?.close();
  await closeDb?.();
  await raw?.end();
});

describe("list_events project all", () => {
  test("one feed over every project, in id order, each event with its project and a Spanish summary", async () => {
    const r = await call("list_events", { project: "all", types: ["claim"] });
    const projects = new Set(r.events.map((e: Json) => e.project));
    assert.deepEqual([...projects].sort(), ["filmia", "zigzag"]);
    const ids = r.events.map((e: Json) => e.id);
    assert.deepEqual(ids, [...ids].sort((a, b) => a - b));
    const z = r.events.find((e: Json) => e.project === "zigzag");
    assert.equal(z.summary, "ZIG-01 tomado por codex");
    assert.equal(r.more, false);
  });

  test("since = the last next_cursor returns nothing when nothing was written; a slug still works", async () => {
    const all = await call("list_events", { project: "all" });
    const again = await call("list_events", { project: "all", since: all.next_cursor });
    assert.deepEqual(again.events, []);
    assert.equal(again.next_cursor, all.next_cursor);
    const fil = await call("list_events", { project: "filmia" });
    assert.ok(fil.events.every((e: Json) => e.project === "filmia"));
    assert.ok(fil.events.every((e: Json) => typeof e.summary === "string"));
  });

  test("key needs a project", async () => {
    const r = await call("list_events", { project: "all", key: "FIL-I1-1" });
    assert.equal(r.__error, "INVALID_FILTER");
  });
});

describe("list_projects", () => {
  test("every project by slug with its line, counts and last event", async () => {
    const r = await call("list_projects");
    assert.deepEqual(r.projects.map((p: Json) => p.slug), ["filmia", "micasa", "workia", "zigzag"]);
    const fil = r.projects[0];
    assert.equal(fil.key_prefix, "FIL");
    assert.equal(fil.line, "En curso: FIL-I1-1 (claude-code). Siguiente: FIL-I1-2.");
    assert.deepEqual(fil.counts, { open: 2, in_progress: 1, in_review: 0, needs_jorge: 0, blocked: 0, done: 0, overdue: 0 });
    assert.equal(fil.claims, 1);
    assert.ok(fil.last_event_id > 0 && typeof fil.last_event_at === "string");
    const mic = r.projects[1];
    assert.equal(mic.last_event_id, 0);
    assert.equal(mic.line, "");
  });

  test("with nothing else to say, the line is the last event, eight days later", async () => {
    const { lastMovementLine } = await import("../src/mcp/resume.js");
    const now = new Date("2026-10-16T12:00:00.000Z");
    assert.equal(
      lastMovementLine({ at: new Date("2026-10-08T12:00:00.000Z"), summary: "MC-12 nota (agente): siguió el corte" }, now),
      "Último movimiento hace 8 días: MC-12 nota (agente): siguió el corte",
    );
    assert.equal(lastMovementLine(null, now), "");
    await raw.query(
      `insert into events (project_id, type, actor, payload, created_at)
       select id, 'note', '{"agent":"agente","session_id":"s9"}'::jsonb, '{"text":"siguió el corte"}'::jsonb, now() - interval '8 days'
       from projects where slug = 'workia'`,
    );
    try {
      const workia = (await call("list_projects")).projects.find((p: Json) => p.slug === "workia");
      assert.match(workia.line, /^Último movimiento hace 8 días: nota \(agente\): siguió el corte$/);
      const resume = await call("get_resume", { project: "workia" });
      assert.equal("lastMovement" in resume, false);
      assert.deepEqual(Object.keys(resume.recent[0]).sort(), ["agent", "at", "task_key", "type"]);
    } finally {
      // A backdated row still gets a new id. get_digest's 24 h window starts after the newest
      // event older than that, so this row would hide earlier events. Remove it after the read.
      await raw.query(
        `delete from events where type = 'note' and project_id = (select id from projects where slug = 'workia')`,
      );
    }
  });
});

describe("get_running", () => {
  test("every owned ticket with liveness live, quiet or stale", async () => {
    const live = await call("get_running");
    assert.deepEqual(live.running.map((r: Json) => [r.project, r.key, r.liveness]), [["filmia", "FIL-I1-1", "live"], ["zigzag", "ZIG-01", "live"]]);
    assert.equal(live.running[0].owner.session_id, "s1");
    assert.ok(typeof live.running[0].last_activity_at === "string");
    // No heartbeat and no event from s2 for 25 min: quiet. Lease over: stale.
    await raw.query("update tasks set last_seen_at = now() - interval '25 min', claimed_at = now() - interval '25 min' where key = 'ZIG-01'");
    await raw.query("update events set created_at = created_at - interval '25 min' where task_key = 'ZIG-01'");
    assert.equal((await call("get_running")).running[1].liveness, "quiet");
    await raw.query("update tasks set lease_until = now() - interval '1 min' where key = 'ZIG-01'");
    assert.equal((await call("get_running")).running[1].liveness, "stale");
  });
});

describe("leases job", () => {
  test("reaps an expired lease in a project nobody writes to, once", async () => {
    const { db, close } = makeDb();
    try {
      assert.equal(await reapExpired(db), 1);
      assert.equal(await reapExpired(db), 0);
    } finally {
      await close();
    }
    const { rows } = await raw.query("select status, owner from tasks where key = 'ZIG-01'");
    assert.deepEqual(rows, [{ status: "Ready", owner: null }]);
    const expired = (await call("list_events", { project: "zigzag", types: ["claim.expired"] })).events;
    assert.equal(expired.length, 1);
    assert.equal(expired[0].summary, "ZIG-01: la sesión de codex expiró → Ready");
    assert.ok(typeof expired[0].payload.lease_until === "string");
    assert.equal((await call("get_running")).running.length, 1, "a reaped ticket is not running");
  });
});

describe("get_digest", () => {
  let cursor: number;

  test("first call: the last 24 h, grouped by project, with what runs and what waits", async () => {
    const d = await call("get_digest");
    assert.equal(d.since_from, "default");
    assert.deepEqual(d.projects.map((p: Json) => p.slug), ["filmia", "zigzag"]);
    assert.deepEqual(d.unchanged_projects, ["micasa", "workia"]);
    const fil = d.projects[0];
    assert.equal(fil.line, "En curso: FIL-I1-1 (claude-code). Siguiente: FIL-I1-2.");
    assert.deepEqual(fil.highlights.claims, ["FIL-I1-1"]);
    assert.equal(fil.quiet, false);
    assert.ok(fil.changes.every((c: Json) => typeof c.summary === "string" && typeof c.id === "number"));
    assert.equal(d.projects[1].quiet, true, "zigzag's claim expired");
    assert.deepEqual(d.running.map((r: Json) => r.key), ["FIL-I1-1"]);
    assert.deepEqual(d.needs_jorge, []);
    cursor = d.cursor;
  });

  test("the same cursor again with nothing written: every project unchanged", async () => {
    const d = await call("get_digest", { since: cursor });
    assert.deepEqual(d.projects, []);
    assert.deepEqual(d.unchanged_projects, ["filmia", "micasa", "workia", "zigzag"]);
    assert.equal(d.cursor, cursor);
    assert.equal(d.truncated, false);
  });

  test("a status move and a question each appear once; the server remembers the cursor for this reader", async () => {
    const { db, close } = makeDb();
    try {
      await raw.query("update checks set done = true where task_id = (select id from tasks where key = 'FIL-I1-1')");
      await addResult(db, { project: "filmia", key: "FIL-I1-1", kind: "unit", verdict: "pass", cite: "ok" }, ctx);
      await setTask(db, { project: "filmia", key: "FIL-I1-1", status: "In review", version: await version("FIL-I1-1") }, ctx);
      await ask(db, { project: "filmia", key: "FIL-I1-2", question: "¿Mostramos ratings sin login?", options: ["sí", "no"] }, ctx);
    } finally {
      await close();
    }
    // Without since: resumes from the cursor this (static read) token was last given.
    const d = await call("get_digest");
    assert.equal(d.since_from, "memory");
    assert.equal(d.since, cursor);
    assert.deepEqual(d.projects.map((p: Json) => p.slug), ["filmia"]);
    const fil = d.projects[0];
    assert.deepEqual(fil.highlights.to_review, ["FIL-I1-1"]);
    assert.deepEqual(fil.highlights.needs_jorge, ["FIL-I1-2"]);
    assert.equal(fil.changes.filter((c: Json) => c.type === "task.status" && c.key === "FIL-I1-1").length, 1);
    assert.equal(fil.changes.filter((c: Json) => c.type === "question.asked").length, 1);
    assert.deepEqual(d.needs_jorge.map((n: Json) => [n.project, n.kind, n.key]), [["filmia", "question", "FIL-I1-2"]]);
    assert.equal(d.running.length, 0, "In review released the claim");
    const again = await call("get_digest");
    assert.equal(again.since, d.cursor);
    assert.deepEqual(again.unchanged_projects, ["filmia", "micasa", "workia", "zigzag"]);
    // A slug narrows everything to one project.
    const z = await call("get_digest", { since: 0, project: "zigzag" });
    assert.deepEqual(z.projects.map((p: Json) => p.slug), ["zigzag"]);
    assert.deepEqual(z.unchanged_projects, []);
    assert.deepEqual(z.needs_jorge, []);
  });

  test("project.created from the registration script shows up in the feed", async () => {
    const { db, close } = makeDb();
    try {
      const r = await registerProject(db, { slug: "plania", title: "Plania", prefix: "PLA", repo: "Jorg3L3on/plania", path: "/Users/jorgeleon/Developer/Projects/plania" });
      assert.deepEqual(r, { created: true, slug: "plania" });
      assert.deepEqual(await registerProject(db, { slug: "plania", title: "Plania", prefix: "PLA" }), { created: false, slug: "plania" });
      const p = await findProject(db, "plania");
      assert.deepEqual(p.settings, { github: { repo: "Jorg3L3on/plania" }, local: { repo_path: "/Users/jorgeleon/Developer/Projects/plania" } });
    } finally {
      await close();
    }
    const d = await call("get_digest");
    assert.deepEqual(d.projects.map((p: Json) => p.slug), ["plania"]);
    assert.equal(d.projects[0].changes[0].summary, "proyecto plania creado (Plania)");
    assert.equal((await call("list_projects")).projects.length, 5);
  });
});

describe("GET /bot/v1", () => {
  test("needs a read-capable Bearer", async () => {
    assert.equal((await get("/bot/v1/digest", null)).status, 401);
    assert.equal((await get("/bot/v1/digest", "nope")).status, 401);
    assert.equal((await get("/bot/v1/digest", TEST_CI_TOKEN)).status, 401, "hooks-only token");
    assert.equal((await get("/bot/v1/projects", TEST_BEARER)).status, 200);
  });

  test("answers what the MCP tools answer", async () => {
    const [projects, running, inbox, events] = await Promise.all([get("/bot/v1/projects"), get("/bot/v1/running"), get("/bot/v1/inbox"), get("/bot/v1/events?project=all&types=claim,question&since=0")]);
    for (const r of [projects, running, inbox, events]) assert.equal(r.status, 200);
    const viaTool = await call("list_projects");
    const viaHttp = (await projects.json()) as Json;
    assert.deepEqual(viaHttp.projects, viaTool.projects);
    assert.deepEqual(((await running.json()) as Json).running, (await call("get_running")).running);
    assert.equal(((await inbox.json()) as Json).count, 1);
    const ev = (await events.json()) as Json;
    assert.ok(ev.events.length >= 3 && ev.events.every((e: Json) => /^(claim|question)\./.test(e.type)));
    assert.equal((await get("/bot/v1/events?project=nope")).status, 404);
    assert.equal((await get("/bot/v1/digest?since=abc")).status, 400);
    // The static read token over HTTP shares its memory with the same token over MCP.
    const d = (await (await get("/bot/v1/digest")).json()) as Json;
    assert.equal(d.since_from, "memory");
    assert.deepEqual(d.unchanged_projects, ["filmia", "micasa", "plania", "workia", "zigzag"]);
  });
});
