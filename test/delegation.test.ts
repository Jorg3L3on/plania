// PLA-I23-1: comments, assign with a hop cap, and ping-pong on the same owner pair.
// Migration 0036 is applied twice on a private database, never a real one.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { userInfo } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import pg from "pg";
import type pgTypes from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const { makeDb } = await import("../src/db/client.js");
const { createMcpServer } = await import("../src/mcp/register.js");
const { seedOrg } = await import("../scripts/seed-org.js");
const { listComments } = await import("../src/mcp/delegation.js");

let raw: pgTypes.Client;
let db: Awaited<ReturnType<typeof makeDb>>["db"];
let closeDb: () => Promise<void>;
let client: Client;

const A = { agent: "test-agent", session_id: "s-i23" };

async function call(name: string, args: Record<string, unknown> = {}) {
  const r = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: { text: string }[] };
  const data = JSON.parse(r.content[0]!.text);
  if (r.isError) return { __error: data.error as string, __status: data.status as number, ...data };
  return data;
}

async function ticket(title: string) {
  const created = await call("create_task", {
    actor: A,
    project: "micasa",
    title,
    scope: "Scope",
    checks: ["Done"],
  });
  assert.equal(created.__error, undefined);
  return created.key as string;
}

before(async () => {
  raw = await resetTestDb();
  ({ db, close: closeDb } = makeDb());
  await seedOrg(db);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createMcpServer(db).connect(serverSide);
  client = new Client({ name: "delegation-test", version: "0" });
  await client.connect(clientSide);
});

after(async () => {
  await client?.close();
  await closeDb?.();
  await raw?.end();
});

test("0036_delegation.sql applies twice on a throwaway database", async () => {
  const name = "plania_mig_0036";
  const adminUrl = `postgres://${userInfo().username}@localhost:5432/postgres`;
  const dir = path.resolve(import.meta.dirname, "../drizzle/migrations");
  const sql0036 = readFileSync(path.join(dir, "0036_delegation.sql"), "utf8");
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`drop database if exists ${name} with (force)`);
  await admin.query(`create database ${name}`);
  await admin.end();

  const mig = new pg.Client({ connectionString: `postgres://${userInfo().username}@localhost:5432/${name}` });
  await mig.connect();
  try {
    const files = readdirSync(dir).filter((f) => f.endsWith(".sql") && f < "0036").sort();
    for (const f of files) await mig.query(readFileSync(path.join(dir, f), "utf8"));
    const project = await mig.query("insert into projects (slug, title, key_prefix) values ('mig', 'Mig', 'MIG') returning id");
    const task = await mig.query(
      "insert into tasks (project_id, kind, key, title, status) values ($1, 'ticket', 'MIG-1', 'Uno', 'Backlog') returning id",
      [project.rows[0].id],
    );

    await mig.query(sql0036);
    const hops = await mig.query(
      "select column_default from information_schema.columns where table_name = 'tasks' and column_name = 'assign_hops'",
    );
    assert.equal(hops.rows.length, 1);
    assert.match(String(hops.rows[0].column_default), /0/);
    await mig.query(
      "insert into task_comments (task_id, author_agent, body) values ($1, 'taller', 'hola')",
      [task.rows[0].id],
    );
    await mig.query(
      "insert into routine_runs (agent, routine, started_at, status, summary) values ('ceo', 'morning', now(), 'ok', 'listo')",
    );

    await mig.query(sql0036);
    assert.equal((await mig.query("select count(*)::int as n from task_comments")).rows[0].n, 1);
    assert.equal((await mig.query("select count(*)::int as n from routine_runs")).rows[0].n, 1);
    assert.equal((await mig.query("select assign_hops from tasks where key = 'MIG-1'")).rows[0].assign_hops, 0);
    await assert.rejects(
      mig.query("insert into routine_runs (agent, routine, started_at, status) values ('ceo', 'morning', now(), 'nope')"),
    );
    await mig.query(sql0036);
    assert.equal((await mig.query("select count(*)::int as n from task_comments")).rows[0].n, 1);
  } finally {
    await mig.end();
    const drop = new pg.Client({ connectionString: adminUrl });
    await drop.connect();
    await drop.query(`drop database if exists ${name} with (force)`);
    await drop.end();
  }
});

test("comment stores the author and refuses an empty or oversized body", async () => {
  const key = await ticket("Comentarios");
  const saved = await call("comment", { actor: A, project: "micasa", key, body: "  primera nota  " });
  assert.equal(saved.__error, undefined);
  assert.equal(saved.author_agent, "test-agent");
  assert.equal(saved.body, "primera nota");
  const second = await call("comment", { actor: A, project: "micasa", key, body: "segunda" });
  assert.equal(second.__error, undefined);
  const listed = await listComments(db, "micasa", key);
  assert.deepEqual(listed.map((c) => c.body), ["primera nota", "segunda"]);

  const empty = await call("comment", { actor: A, project: "micasa", key, body: "   " });
  assert.equal(empty.__error, "INVALID_FILTER");
  const huge = await call("comment", { actor: A, project: "micasa", key, body: "x".repeat(2001) });
  assert.equal(huge.__error, "TOO_LARGE");
  assert.equal(huge.max, 2000);
  assert.equal((await listComments(db, "micasa", key)).length, 2);
});

test("assign counts hops, refuses the fourth with HOP_CAP, and posts one limpieza item", async () => {
  const key = await ticket("Cadena");
  const chain = ["taller", "workia", "artist", "research"];
  const owners: string[] = [];
  for (const to of chain.slice(0, 3)) {
    const moved = await call("assign", { actor: A, project: "micasa", key, to_agent: to, note: `pasa a ${to}` });
    assert.equal(moved.__error, undefined, to);
    owners.push(moved.owner_agent);
    assert.equal(moved.assign_hops, owners.length);
    assert.equal(moved.comment.body, `pasa a ${to}`);
  }
  assert.deepEqual(owners, ["taller", "workia", "artist"]);

  const refused = await call("assign", { actor: A, project: "micasa", key, to_agent: "research", request_id: "hop-once" });
  assert.equal(refused.__error, "HOP_CAP");
  assert.equal(refused.__status, 409);
  assert.equal(refused.hops, 3);
  assert.equal(refused.cap, 3);
  const again = await call("assign", { actor: A, project: "micasa", key, to_agent: "housi", request_id: "hop-once" });
  assert.equal(again.__error, "HOP_CAP");

  const { rows } = await raw.query(`select owner_agent, assign_hops from tasks t join agents a on a.id = t.owner_agent where t.key = $1`, [key]);
  assert.equal(rows[0].assign_hops, 3);
  const owner = await raw.query(`select slug from agents where id = $1`, [rows[0].owner_agent]);
  assert.equal(owner.rows[0].slug, "artist");
  const events = await raw.query(`select count(*)::int as n from events where type = 'assign.limpieza' and task_key = $1`, [key]);
  assert.equal(events.rows[0].n, 1);

  const box = await call("get_inbox", { project: "micasa" });
  const item = box.items.find((i: { key: string; kind: string }) => i.key === key && i.kind === "assign");
  assert.equal(item.group, "limpieza");
  assert.match(item.why, /más de 3/);
  assert.equal(box.chores >= 1, true);
});

test("assigning a pair back the way it went is PING_PONG and does not count a hop", async () => {
  const key = await ticket("Rebote");
  const first = await call("assign", { actor: A, project: "micasa", key, to_agent: "taller" });
  assert.equal(first.assign_hops, 1);
  const second = await call("assign", { actor: A, project: "micasa", key, to_agent: "workia" });
  assert.equal(second.assign_hops, 2);
  const back = await call("assign", { actor: A, project: "micasa", key, to_agent: "taller" });
  assert.equal(back.__error, "PING_PONG");
  assert.equal(back.__status, 409);
  assert.equal(back.from, "workia");
  assert.equal(back.to, "taller");

  const sideways = await call("assign", { actor: A, project: "micasa", key, to_agent: "artist" });
  assert.equal(sideways.__error, undefined);
  assert.equal(sideways.owner_agent, "artist");
  assert.equal(sideways.assign_hops, 3);
  const hops = await raw.query(`select assign_hops from tasks where key = $1`, [key]);
  assert.equal(hops.rows[0].assign_hops, 3);
  const limpieza = await raw.query(`select count(*)::int as n from events where type = 'assign.limpieza' and task_key = $1`, [key]);
  assert.equal(limpieza.rows[0].n, 0);
});
