// PLA-I21-1: agents table, org seed, list_agents / set_agent, owner_agent on tasks.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const { makeDb } = await import("../src/db/client.js");
const { createMcpServer } = await import("../src/mcp/register.js");
const { ORG, seedOrg } = await import("../scripts/seed-org.js");

let raw: pg.Client;
let db: Awaited<ReturnType<typeof makeDb>>["db"];
let closeDb: () => Promise<void>;
let client: Client;

const A = { agent: "test-agent", session_id: "s1" };

async function call(name: string, args: Record<string, unknown> = {}) {
  const r = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: { text: string }[] };
  const data = JSON.parse(r.content[0]!.text);
  if (r.isError) return { __error: data.error as string, __status: data.status as number, ...data };
  return data.task ? { ...data, ...data.task } : data;
}

before(async () => {
  raw = await resetTestDb();
  ({ db, close: closeDb } = makeDb());
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createMcpServer(db).connect(serverSide);
  client = new Client({ name: "team-test", version: "0" });
  await client.connect(clientSide);
});

after(async () => {
  await client?.close();
  await closeDb?.();
  await raw?.end();
});

test("0034_agents.sql applies twice", async () => {
  const sql = readFileSync(new URL("../drizzle/migrations/0034_agents.sql", import.meta.url), "utf8");
  await raw.query(sql);
  await raw.query(sql);
  const { rows } = await raw.query<{ column_name: string }>(
    `select column_name from information_schema.columns where table_name = 'agents' order by column_name`,
  );
  const cols = rows.map((r) => r.column_name);
  for (const name of ["slug", "name", "role", "title", "reports_to", "capabilities", "kind", "wake_url", "last_check_in_at", "last_wake_at", "status", "note"]) {
    assert.ok(cols.includes(name), name);
  }
  const { rows: owner } = await raw.query(`select column_name from information_schema.columns where table_name = 'tasks' and column_name = 'owner_agent'`);
  assert.equal(owner.length, 1);
});

test("seed creates the org once, with a reports_to chain, and leaves edits in place", async () => {
  const first = await seedOrg(db);
  assert.deepEqual(first.inserted.sort(), ORG.map((r) => r.slug).sort());
  const second = await seedOrg(db);
  assert.deepEqual(second.inserted, []);

  const { rows } = await raw.query<{ slug: string; name: string; reports_to: string | null; kind: string }>(
    `select a.slug, a.name, p.slug as reports_to, a.kind from agents a left join agents p on p.id = a.reports_to order by a.slug`,
  );
  const bySlug = Object.fromEntries(rows.map((r) => [r.slug, r]));
  assert.equal(bySlug.ceo!.name, "CEO");
  assert.equal(bySlug.ceo!.kind, "human");
  assert.equal(bySlug.ceo!.reports_to, null);
  assert.equal(bySlug.asistente!.reports_to, "ceo");
  assert.equal(bySlug.artist!.reports_to, "asistente");
  assert.equal(bySlug.research!.reports_to, "asistente");
  for (const po of ["housi", "workia", "filmia", "zigzag", "owner-plania", "po-mianovia"]) assert.equal(bySlug[po]!.reports_to, "ceo", po);
  assert.equal(bySlug["owner-plania"]!.name, "Plania");
  assert.equal(bySlug.taller!.reports_to, "ceo");
  // PLA-I30-1: no Cursor, no Coach, no COO, no CTO layer, no separate claude-code row.
  for (const gone of ["cursor", "coach", "plania", "claude-code"]) assert.equal(bySlug[gone], undefined, gone);
  assert.equal(rows.filter((r) => r.name === "Plania").length, 1);
  assert.equal(rows.length, 11);
  assert.ok(!JSON.stringify(rows).includes("@"), "no emails");

  await raw.query(`update agents set title = 'Pair' where slug = 'taller'`);
  await seedOrg(db);
  const { rows: edited } = await raw.query(`select title from agents where slug = 'taller'`);
  assert.equal(edited[0].title, "Pair");
});

test("list_agents links tokens by name and set_agent updates one row", async () => {
  await raw.query(
    `insert into agent_tokens (name, agent, scopes, token_hash, prefix) values ('taller-ci', 'Taller', '{read}', 'hash-not-a-secret', 'pla_test')`,
  );
  const listed = await call("list_agents");
  const taller = listed.agents.find((a: { slug: string }) => a.slug === "taller");
  assert.equal(taller.reports_to, "ceo");
  assert.deepEqual(taller.tokens, [{ name: "taller-ci", prefix: "pla_test", machine: null }]);
  assert.equal(JSON.stringify(listed).includes("hash-not-a-secret"), false);

  const updated = await call("set_agent", { actor: A, slug: "research", title: "Servicio" });
  assert.equal(updated.title, "Servicio");
  assert.equal(updated.reports_to, "asistente");
  const missing = await call("set_agent", { actor: A, slug: "research", reports_to: "nobody" });
  assert.equal(missing.__error, "AGENT_NOT_FOUND");
  assert.equal(missing.__status, 404);
});

test("owner_agent round-trips in get_task and clears", async () => {
  const created = await call("create_task", {
    actor: A,
    project: "micasa",
    title: "Owned ticket",
    scope: "Scope",
    checks: ["Done"],
    owner_agent: "taller",
    verbose: true,
  });
  assert.equal(created.__error, undefined);
  assert.equal(created.owner_agent.slug, "taller");
  assert.equal(created.owner_agent.status, "idle");
  const got = await call("get_task", { project: "micasa", key: created.key });
  assert.equal(got.owner_agent.slug, "taller");
  assert.equal(got.owner_agent.name, "Taller");

  const moved = await call("set_task", { actor: A, project: "micasa", key: created.key, owner_agent: "research", version: got.version, verbose: true });
  assert.equal(moved.owner_agent.slug, "research");
  const cleared = await call("set_task", { actor: A, project: "micasa", key: created.key, owner_agent: null, version: moved.version, verbose: true });
  assert.equal(cleared.owner_agent, null);

  const unknown = await call("create_task", {
    actor: A,
    project: "micasa",
    title: "Missing owner",
    scope: "Scope",
    checks: ["Done"],
    owner_agent: "no-such-agent",
  });
  assert.equal(unknown.__error, "AGENT_NOT_FOUND");
});
