// PLA-I26-1: 0038 adds adapter columns and heartbeat_runs. A second run adds nothing.
// This uses a private database, never a real one.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { userInfo } from "node:os";
import path from "node:path";
import { test } from "node:test";
import pg from "pg";

test("0038_heartbeats_adapters.sql applies twice on a throwaway database", async () => {
  const name = "plania_mig_0038";
  const adminUrl = `postgres://${userInfo().username}@localhost:5432/postgres`;
  const dir = path.resolve(import.meta.dirname, "../drizzle/migrations");
  const sql0038 = readFileSync(path.join(dir, "0038_heartbeats_adapters.sql"), "utf8");
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`drop database if exists ${name} with (force)`);
  await admin.query(`create database ${name}`);
  await admin.end();

  const mig = new pg.Client({ connectionString: `postgres://${userInfo().username}@localhost:5432/${name}` });
  await mig.connect();
  try {
    const files = readdirSync(dir).filter((f) => f.endsWith(".sql") && f < "0038").sort();
    for (const f of files) await mig.query(readFileSync(path.join(dir, f), "utf8"));
    await mig.query(
      `insert into agents (slug, name, role, kind) values ('coder', 'Coder', 'engineer', 'coder')`,
    );

    await mig.query(sql0038);
    const cols = await mig.query(
      "select column_name from information_schema.columns where table_name = 'agents'",
    );
    const names = cols.rows.map((row) => row.column_name as string);
    for (const column of ["adapter", "adapter_config", "heartbeat_minutes", "last_heartbeat_at"]) {
      assert.equal(names.includes(column), true, column);
    }
    const agent = await mig.query(`select id, adapter, adapter_config from agents where slug = 'coder'`);
    assert.equal(agent.rows[0].adapter, "none");
    assert.deepEqual(agent.rows[0].adapter_config, {});
    const agentId = agent.rows[0].id as string;

    await mig.query(
      `insert into heartbeat_runs (agent_id, started_at, status, adapter, summary, task_key)
       values ($1, now(), 'ok', 'none', 'looked', 'MIG-1')`,
      [agentId],
    );

    await mig.query(sql0038);
    assert.equal((await mig.query("select count(*)::int as n from heartbeat_runs")).rows[0].n, 1);
    assert.equal((await mig.query("select adapter from agents where slug = 'coder'")).rows[0].adapter, "none");

    await assert.rejects(
      mig.query(`update agents set adapter = 'carrier' where slug = 'coder'`),
    );
    await assert.rejects(
      mig.query(`update agents set heartbeat_minutes = 0 where slug = 'coder'`),
    );
    await assert.rejects(
      mig.query(
        `insert into heartbeat_runs (agent_id, started_at, status, adapter) values ($1, now(), 'nope', 'none')`,
        [agentId],
      ),
    );
    await assert.rejects(
      mig.query(
        `insert into heartbeat_runs (agent_id, started_at, status, adapter) values ($1, now(), 'ok', 'none')`,
        ["00000000-0000-4000-8000-000000000000"],
      ),
    );

    await mig.query(sql0038);
    assert.equal((await mig.query("select count(*)::int as n from heartbeat_runs")).rows[0].n, 1);
    assert.equal((await mig.query("select summary from heartbeat_runs")).rows[0].summary, "looked");
  } finally {
    await mig.end();
    const drop = new pg.Client({ connectionString: adminUrl });
    await drop.connect();
    await drop.query(`drop database if exists ${name} with (force)`);
    await drop.end();
  }
});
