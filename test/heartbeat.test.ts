// PLA-I26-3: a due agent is woken once per cadence. The second wake inside it writes nothing.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const { makeDb } = await import("../src/db/client.js");
const { createMcpServer } = await import("../src/mcp/register.js");
const { jobsToStart } = await import("../src/jobs/index.js");
const { runHeartbeat, wakeAgent } = await import("../src/jobs/heartbeat.js");
const { seedOrg } = await import("../scripts/seed-org.js");

let raw: pg.Client;
let db: Awaited<ReturnType<typeof makeDb>>["db"];
let closeDb: () => Promise<void>;
let client: Client;

const A = { agent: "test-agent", session_id: "s-i26" };
const WAKE = "http://127.0.0.1/wake";

async function call(name: string, args: Record<string, unknown> = {}) {
  const r = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: { text: string }[] };
  const data = JSON.parse(r.content[0]!.text);
  if (r.isError) return { __error: data.error as string, __status: data.status as number, ...data };
  return data;
}

async function runsFor(slug: string): Promise<number> {
  const { rows } = await raw.query(
    `select count(*)::int as n from heartbeat_runs hr join agents a on a.id = hr.agent_id where a.slug = $1`,
    [slug],
  );
  return rows[0].n as number;
}

before(async () => {
  raw = await resetTestDb();
  ({ db, close: closeDb } = makeDb());
  await seedOrg(db);
  await raw.query(`update agents set heartbeat_minutes = null, last_heartbeat_at = null, adapter = 'none', adapter_config = '{}'::jsonb`);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createMcpServer(db).connect(serverSide);
  client = new Client({ name: "heartbeat-test", version: "0" });
  await client.connect(clientSide);
});

after(async () => {
  process.env.PLANIA_JOBS = "0";
  await client?.close();
  await closeDb?.();
  await raw?.end();
});

test("manual wake writes one run and a second wake inside the cadence is a no-op", async () => {
  await raw.query(`update agents set heartbeat_minutes = 30, adapter = 'none' where slug = 'taller'`);
  const created = await call("create_task", {
    actor: A,
    project: "micasa",
    title: "Ready for taller",
    scope: "Scope",
    checks: ["Done"],
    status: "Ready",
    owner_agent: "taller",
  });
  assert.equal(created.__error, undefined);

  const first = await call("wake_agent", { actor: A, agent: "taller" });
  assert.equal(first.woke, true);
  assert.equal(first.run.agent, "taller");
  assert.equal(first.run.task_key, created.key);
  assert.equal(first.run.status, "skipped");
  assert.equal(first.run.adapter, "none");
  assert.equal(await runsFor("taller"), 1);

  const second = await call("wake_agent", { actor: A, agent: "taller" });
  assert.equal(second.woke, false);
  assert.equal(second.reason, "cadence");
  assert.equal(second.run, null);
  assert.equal(await runsFor("taller"), 1);

  const listed = await call("list_heartbeat_runs", { agent: "taller" });
  assert.equal(listed.runs.length, 1);
  assert.equal(listed.runs[0].task_key, created.key);
  assert.equal(JSON.stringify(listed).includes("adapter_config"), false);

  const dry = await call("wake_agent", { actor: A, agent: "taller", dry_run: true });
  assert.equal(dry.reason, "dry-run");
  assert.equal(dry.run, null);
  assert.equal(await runsFor("taller"), 1);

  const missing = await call("wake_agent", { actor: A, agent: "no-such-agent" });
  assert.equal(missing.__error, "AGENT_NOT_FOUND");
});

test("the tick does not double-fire and runs when PLANIA_JOBS=1", async () => {
  const before = await runsFor("taller");
  const held = await runHeartbeat(db, new Date());
  assert.equal((held.held ?? 0) >= 1, true);
  assert.equal(await runsFor("taller"), before);

  const later = await runHeartbeat(db, new Date(Date.now() + 31 * 60_000));
  assert.equal(later.skipped, 1);
  assert.equal(await runsFor("taller"), before + 1);

  process.env.PLANIA_JOBS = "1";
  try {
    const names = jobsToStart().map((job) => job.name);
    assert.equal(names.includes("heartbeat"), true);
    const job = jobsToStart().find((item) => item.name === "heartbeat");
    const summary = await job!.runOnce(db, new Date());
    assert.equal(typeof summary.held, "number");
    assert.equal(await runsFor("taller"), before + 1);
  } finally {
    process.env.PLANIA_JOBS = "0";
  }
  assert.equal(jobsToStart().some((job) => job.name === "heartbeat"), false);
});

test("http wake records the run without the url, and Ready work follows owner then priority", async () => {
  let posts = 0;
  await raw.query(
    `update agents set adapter = 'http', wake_url = $1, heartbeat_minutes = 15, last_heartbeat_at = null where slug = 'research'`,
    [WAKE],
  );
  const owned = await call("create_task", {
    actor: A,
    project: "workia",
    key: "WRK-OWN",
    title: "Owned ready",
    scope: "Scope",
    checks: ["Done"],
    status: "Ready",
    priority: "P3",
    owner_agent: "workia",
  });
  assert.equal(owned.__error, undefined);
  const low = await call("create_task", {
    actor: A,
    project: "workia",
    key: "WRK-LOW",
    title: "Lower ready",
    scope: "Scope",
    checks: ["Done"],
    status: "Ready",
    priority: "P1",
  });
  const high = await call("create_task", {
    actor: A,
    project: "workia",
    key: "WRK-HIGH",
    title: "Higher ready",
    scope: "Scope",
    checks: ["Done"],
    status: "Ready",
    priority: "P0",
  });
  assert.equal(low.__error, undefined);
  assert.equal(high.__error, undefined);

  const picked = await wakeAgent(db, { agent: "workia", now: new Date() });
  assert.equal(picked.run?.task_key, "WRK-OWN");

  await raw.query(`update tasks set owner_agent = null where key = 'WRK-OWN'`);
  await raw.query(`update agents set last_heartbeat_at = null where slug = 'workia'`);
  const ranked = await wakeAgent(db, { agent: "workia", now: new Date(Date.now() + 60_000) });
  assert.equal(ranked.run?.task_key, "WRK-HIGH");

  const http = await wakeAgent(
    db,
    { agent: "research", now: new Date() },
    {
      fetch: async (url) => {
        posts += 1;
        assert.equal(url, WAKE);
        return { ok: true };
      },
    },
  );
  assert.equal(posts, 1);
  assert.equal(http.run?.status, "ok");
  assert.equal(JSON.stringify(http).includes(WAKE), false);
  const again = await wakeAgent(db, { agent: "research", now: new Date() }, { fetch: async () => { posts += 1; return { ok: true }; } });
  assert.equal(again.reason, "cadence");
  assert.equal(posts, 1);
});
