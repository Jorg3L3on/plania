// PLA-I21-2: check_in, alive/idle/stuck thresholds, one wake per agent per hour, limpieza for a past lease.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const { makeDb } = await import("../src/db/client.js");
const { createMcpServer } = await import("../src/mcp/register.js");
const { inbox } = await import("../src/mcp/inbox.js");
const { findProject } = await import("../src/mcp/queries.js");
const { seedOrg } = await import("../scripts/seed-org.js");
const { sweepStuck } = await import("../src/jobs/stuck.js");

let raw: pg.Client;
let db: Awaited<ReturnType<typeof makeDb>>["db"];
let closeDb: () => Promise<void>;
let client: Client;

const A = { agent: "test-agent", session_id: "s1" };

async function call(name: string, args: Record<string, unknown> = {}) {
  const r = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: { text: string }[] };
  const data = JSON.parse(r.content[0]!.text);
  if (r.isError) return { __error: data.error as string, __status: data.status as number };
  return data.task ? { ...data, ...data.task } : data;
}

async function version(slug: string): Promise<number> {
  const { rows } = await raw.query(`select version from projects where slug = $1`, [slug]);
  return rows[0].version;
}

before(async () => {
  raw = await resetTestDb();
  ({ db, close: closeDb } = makeDb());
  await seedOrg(db);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createMcpServer(db).connect(serverSide);
  client = new Client({ name: "stuck-test", version: "0" });
  await client.connect(clientSide);
});

after(async () => {
  await client?.close();
  await closeDb?.();
  await raw?.end();
});

test("idle threshold: a claim past it is stuck, a wider project setting stays alive, no claim is idle", async () => {
  const created = await call("create_task", {
    actor: A,
    project: "micasa",
    title: "Held by Cursor",
    scope: "Scope",
    checks: ["Done"],
    owner_agent: "cursor",
    verbose: true,
  });
  await raw.query(
    `update tasks set owner = $1::jsonb, claimed_at = now() - interval '3 hours', lease_until = now() + interval '1 hour', status = 'In progress' where key = $2`,
    [JSON.stringify({ agent: "Cursor", session_id: "s-cursor" }), created.key],
  );
  await raw.query(`update agents set last_check_in_at = now() - interval '3 hours' where slug = 'cursor'`);

  const stuck = await sweepStuck(db, new Date());
  assert.ok(stuck.stuck >= 1);
  const resumeStuck = await call("get_resume", { project: "micasa" });
  const claim = resumeStuck.claims.find((c: { key: string }) => c.key === created.key);
  assert.equal(claim.owner_agent.slug, "cursor");
  assert.equal(claim.owner_agent.status, "stuck");

  const widened = await call("set_project", {
    actor: A,
    project: "micasa",
    version: await version("micasa"),
    settings: { team: { idle_minutes: 1000 } },
  });
  assert.equal(widened.__error, undefined);
  await sweepStuck(db, new Date());
  const alive = (await call("get_resume", { project: "micasa" })).claims.find((c: { key: string }) => c.key === created.key);
  assert.equal(alive.owner_agent.status, "alive");

  await raw.query(`update tasks set owner = null, claimed_at = null, lease_until = null, status = 'Ready' where key = $1`, [created.key]);
  await sweepStuck(db, new Date());
  const listed = await call("list_agents");
  assert.equal(listed.agents.find((a: { slug: string }) => a.slug === "cursor").status, "idle");

  await raw.query(
    `update tasks set owner = $1::jsonb, claimed_at = now(), lease_until = now() + interval '1 hour', status = 'In progress' where key = $2`,
    [JSON.stringify({ agent: "Cursor", session_id: "s-cursor" }), created.key],
  );
  const beat = await call("check_in", { actor: A, agent: "cursor", working_on: created.key, note: "en ello" });
  assert.equal(beat.status, "alive");
  assert.equal(beat.working_on, created.key);
  assert.equal(beat.note, "en ello");
  const { rows } = await raw.query(`select owner->>'session_id' as session, owner_agent is not null as owned from tasks where key = $1`, [created.key]);
  assert.equal(rows[0].session, "s-cursor", "check-in does not take the lease");
  assert.equal(rows[0].owned, true);
  const task = await call("get_task", { project: "micasa", key: created.key });
  assert.equal(task.owner_agent.slug, "cursor");
  assert.equal(task.owner_agent.status, "alive");

  const bad = await call("set_project", {
    actor: A,
    project: "micasa",
    version: await version("micasa"),
    settings: { team: { idle_minutes: 0 } },
  });
  assert.equal(bad.__error, "INVALID_FILTER");
  const missing = await call("check_in", { actor: A, agent: "no-such-agent" });
  assert.equal(missing.__error, "AGENT_NOT_FOUND");
});

test("a stuck agent is woken at most once per hour", async () => {
  const created = await call("create_task", {
    actor: A,
    project: "workia",
    title: "Held by Claude Code",
    scope: "Scope",
    checks: ["Done"],
    verbose: true,
  });
  await raw.query(
    `update tasks set owner = $1::jsonb, claimed_at = now() - interval '3 hours', lease_until = now() + interval '3 hours', status = 'In progress' where key = $2`,
    [JSON.stringify({ agent: "Claude Code", session_id: "s-claude" }), created.key],
  );
  await raw.query(`update agents set last_check_in_at = now() - interval '3 hours', wake_url = 'http://127.0.0.1/wake/claude' where slug = 'claude-code'`);
  await raw.query(`update agents set last_check_in_at = now() - interval '5 hours', wake_url = 'http://127.0.0.1/wake/coach' where slug = 'coach'`);

  const calls: string[] = [];
  const wake: typeof fetch = async (url) => {
    calls.push(String(url));
    return new Response(null, { status: 204 });
  };
  const now = new Date();
  await sweepStuck(db, now, wake);
  assert.deepEqual(calls, ["http://127.0.0.1/wake/claude"]);
  await sweepStuck(db, new Date(now.getTime() + 5 * 60_000), wake);
  assert.deepEqual(calls, ["http://127.0.0.1/wake/claude"]);
  await sweepStuck(db, new Date(now.getTime() + 61 * 60_000), wake);
  assert.deepEqual(calls, ["http://127.0.0.1/wake/claude", "http://127.0.0.1/wake/claude"]);
});

test("a claim past its lease becomes one limpieza item", async () => {
  const created = await call("create_task", {
    actor: A,
    project: "filmia",
    title: "Lease ran out",
    scope: "Scope",
    checks: ["Done"],
    verbose: true,
  });
  await raw.query(
    `update tasks set owner = $1::jsonb, claimed_at = now() - interval '2 hours', lease_until = now() - interval '1 minute', status = 'In progress' where key = $2`,
    [JSON.stringify({ agent: "Cursor", session_id: "s-old" }), created.key],
  );
  await sweepStuck(db, new Date());
  await sweepStuck(db, new Date());
  const { rows } = await raw.query(`select count(*)::int as n from events where type = 'claim.limpieza' and task_key = $1`, [created.key]);
  assert.equal(rows[0].n, 1);
  const box = await inbox(db, await findProject(db, "filmia"));
  const item = box.items.find((i) => i.kind === "lease" && i.key === created.key);
  assert.ok(item);
  assert.equal(item!.group, "limpieza");
  assert.match(item!.why, /turno venció/);
  assert.equal(box.chores >= 1, true);
});
