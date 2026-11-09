// PLA-I23-2: routine run history, newest first, filtered by agent and UTC date.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const { makeDb } = await import("../src/db/client.js");
const { createMcpServer } = await import("../src/mcp/register.js");
const { seedLegacyOrg: seedOrg } = await import("./fixtures/legacy-org.js");

let raw: pg.Client;
let closeDb: () => Promise<void>;
let client: Client;

const A = { agent: "test-agent", session_id: "s-i23-2" };

async function call(name: string, args: Record<string, unknown> = {}) {
  const r = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: { text: string }[] };
  const data = JSON.parse(r.content[0]!.text);
  if (r.isError) return { __error: data.error as string, __status: data.status as number, ...data };
  return data;
}

before(async () => {
  raw = await resetTestDb();
  const opened = makeDb();
  closeDb = opened.close;
  await seedOrg(opened.db);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createMcpServer(opened.db).connect(serverSide);
  client = new Client({ name: "routines-test", version: "0" });
  await client.connect(clientSide);
});

after(async () => {
  await client?.close();
  await closeDb?.();
  await raw?.end();
});

test("list_routine_runs returns newest first and filters by agent and date", async () => {
  const runs = [
    { routine: "morning-brief", started_at: "2026-11-01T08:00:00.000Z", status: "ok", summary: "uno" },
    { routine: "hourly-triage", started_at: "2026-11-03T08:00:00.000Z", status: "fail", summary: "tres" },
    { routine: "morning-brief", started_at: "2026-11-02T08:00:00.000Z", status: "skipped", summary: "dos" },
  ];
  for (const run of runs) {
    const saved = await call("record_routine_run", { actor: A, agent: "ceo", ...run, ended_at: run.started_at });
    assert.equal(saved.__error, undefined, run.summary);
    assert.equal(saved.agent, "ceo");
    assert.equal(saved.status, run.status);
  }
  const other = await call("record_routine_run", {
    actor: A,
    agent: "taller",
    routine: "pick-ready",
    started_at: "2026-11-04T08:00:00.000Z",
    status: "ok",
    task_key: "MIC-1",
  });
  assert.equal(other.__error, undefined);
  assert.equal(other.task_key, "MIC-1");

  const listed = await call("list_routine_runs", { agent: "ceo" });
  assert.deepEqual(
    listed.runs.map((run: { summary: string }) => run.summary),
    ["tres", "dos", "uno"],
  );
  const day = await call("list_routine_runs", { agent: "ceo", date: "2026-11-02" });
  assert.deepEqual(
    day.runs.map((run: { routine: string; status: string }) => [run.routine, run.status]),
    [["morning-brief", "skipped"]],
  );
  const all = await call("list_routine_runs");
  assert.equal(all.runs[0].agent, "taller");
  assert.equal(all.runs[0].started_at > all.runs[1].started_at, true);

  const missing = await call("list_routine_runs", { agent: "nobody" });
  assert.equal(missing.__error, "AGENT_NOT_FOUND");
  const bad = await call("record_routine_run", {
    actor: A,
    agent: "ceo",
    routine: "morning-brief",
    started_at: "2026-11-05T08:00:00.000Z",
    ended_at: "2026-11-04T08:00:00.000Z",
    status: "ok",
  });
  assert.equal(bad.__error, "INVALID_FILTER");
  assert.equal(bad.field, "ended_at");
});
