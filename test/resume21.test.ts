// 2.1 resume pieces: the headline and its staleness (R-02a), the v1 leftovers being gone (2.9),
// retired decisions (R-24), and the two background jobs.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const { makeDb } = await import("../src/db/client.js");
const { createMcpServer } = await import("../src/mcp/register.js");
const { warnExpiringLeases } = await import("../src/jobs/leases.js");
const { startJobs } = await import("../src/jobs/index.js");

type Json = Record<string, any>;
const A = { agent: "test-agent", session_id: "s1", machine: "ci" };
const P = { project: "zigzag" };
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
    return { __error: "INVALID_INPUT", __text: text }; // the SDK refused the input before Plania ran
  }
  return r.isError ? { __error: data.error, __status: data.status, ...data } : data;
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

describe("headline", () => {
  test("set_project writes it with a version; an env change, an initiative move or a Done makes it stale", async () => {
    let p = await call("get_project", P);
    assert.deepEqual(p.headline, { text: "", version: 0, at: null, stale: false });
    const long = "x".repeat(281);
    const tooLong = await call("set_project", { ...P, version: p.version, headline: long });
    assert.equal(tooLong.__error, "TOO_LARGE", tooLong.__text);
    p = await call("set_project", { ...P, version: p.version, headline: "Prod at #125; next: awards backfill" });
    assert.equal(p.headline.version, 1);
    assert.equal(p.headline.stale, false);
    assert.match(p.headline.at, /Z$/);
    assert.equal((await call("get_resume", P)).headline.text, "Prod at #125; next: awards backfill");

    await call("set_env", { ...P, env: "prod", commit: "abcdef1" });
    assert.equal((await call("get_resume", P)).headline.stale, true, "an env change dates the headline");
    p = await call("get_project", P);
    p = await call("set_project", { ...P, version: p.version, headline: "Prod at abcdef1" });
    assert.equal(p.headline.version, 2);
    assert.equal(p.headline.stale, false);

    await call("create_task", { ...P, kind: "initiative", title: "Rename", scope: "PRD" }); // ZIG-I1
    assert.equal((await call("get_resume", P)).headline.stale, false, "creating does not");
    await call("set_task", { ...P, key: "ZIG-I1", status: "Active", version: 1 });
    assert.equal((await call("get_resume", P)).headline.stale, true, "an initiative moving does");
    const { rows } = await raw.query("select headline_stale from projects where slug = 'zigzag'");
    assert.equal(rows[0].headline_stale, true);
  });
});

describe("v1 leftovers (gone in 2.9, migration 0022)", () => {
  test("no legacy card in get_resume, no archive_legacy_card tool, no v1 columns or tables", async () => {
    await call("add_decision", { ...P, text: "Keep the slug", pin: true });
    const r = await call("get_resume", P);
    assert.equal("legacy_card" in r, false);
    assert.equal("legacy_card_present" in r, false);
    assert.ok(!(await client.listTools()).tools.some((t) => t.name === "archive_legacy_card"));
    const { rows } = await raw.query(`select table_name, column_name from information_schema.columns
      where (table_name = 'tasks' and column_name = 'body') or (table_name = 'projects' and column_name like 'resume_%')
         or (table_name = 'decisions' and column_name = 'supersedes_id') or table_name in ('design_pages', 'env_blockers')`);
    assert.deepEqual(rows, []);
  });
});

describe("retired decisions", () => {
  test("retire hides a decision from get_memory and must_keep; it cannot be superseded or retired twice", async () => {
    const { decision } = await call("add_decision", { ...P, text: "Vercel paused", pin: true });
    assert.ok((await call("get_resume", P)).must_keep.some((d: Json) => d.id === decision.id));
    const r = await call("retire_decision", { ...P, decision_id: decision.id, reason: "deploys resumed" });
    assert.equal(r.decision.retired.reason, "deploys resumed");
    assert.ok(!(await call("get_resume", P)).must_keep.some((d: Json) => d.id === decision.id));
    assert.ok(!(await call("get_memory", P)).decisions.some((d: Json) => d.id === decision.id));
    const shown = (await call("get_memory", { ...P, include_retired: true })).decisions.find((d: Json) => d.id === decision.id);
    assert.equal(shown.retired.by.agent, "test-agent");
    assert.equal((await call("retire_decision", { ...P, decision_id: decision.id, reason: "again" })).__error, "DECISION_RETIRED");
    assert.equal((await call("add_decision", { ...P, text: "replacement", supersedes: [decision.id] })).__error, "DECISION_RETIRED");
    assert.equal((await call("retire_decision", { ...P, decision_id: "00000000-0000-0000-0000-000000000000", reason: "x" })).__error, "DECISION_NOT_FOUND");
  });

  test("one decision supersedes several; each old one is marked once", async () => {
    const a = (await call("add_decision", { ...P, text: "apply 0009 by psql" })).decision;
    const b = (await call("add_decision", { ...P, text: "apply 0009 by db:migrate" })).decision;
    const c = (await call("add_decision", { ...P, text: "one runbook for 0009", supersedes: [a.id, b.id] })).decision;
    assert.deepEqual(c.supersedes.sort(), [a.id, b.id].sort());
    const all = (await call("get_memory", { ...P, include_superseded: true })).decisions;
    assert.equal(all.find((d: Json) => d.id === a.id).superseded_by, c.id);
    assert.equal(all.find((d: Json) => d.id === b.id).superseded_by, c.id);
    const r = await call("add_decision", { ...P, text: "x", supersedes: [b.id] });
    assert.equal(r.__error, "ALREADY_SUPERSEDED");
    assert.equal(r.superseded_by, c.id);
  });
});

describe("lease warnings", () => {
  test("claim.expiring is logged once, five minutes before a lease ends, and a heartbeat resets it", async () => {
    await call("create_task", { ...P, title: "Soon", ...T }); // ZIG-01
    await call("claim", { ...P, key: "ZIG-01", ttl_minutes: 5 });
    const { db, close } = makeDb();
    try {
      const now = new Date();
      assert.equal(await warnExpiringLeases(db, new Date(now.getTime() - 60_000)), 0, "more than five minutes left");
      assert.equal(await warnExpiringLeases(db, now), 1);
      assert.equal(await warnExpiringLeases(db, now), 0, "once per lease");
      const ev = (await call("list_events", { ...P, key: "ZIG-01", types: ["claim.expiring"] })).events;
      assert.equal(ev.length, 1);
      assert.equal(ev[0].actor.agent, "plania");
      assert.equal(ev[0].payload.owner.session_id, "s1");
      await call("claim", { ...P, key: "ZIG-01", action: "heartbeat", ttl_minutes: 5 });
      assert.equal(await warnExpiringLeases(db, new Date()), 1, "a new lease end warns again");
    } finally {
      await close();
    }
  });

  test("startJobs schedules and stops cleanly", async () => {
    const lines: string[] = [];
    const stop = startJobs({ every: { leases: 3_600_000, legacy: 3_600_000 }, log: (l) => lines.push(l) });
    stop();
    assert.deepEqual(lines, []);
  });
});
