// PLA-I29: 0039 adds the runner tables and the project switch. A second run adds nothing, existing
// projects start paused, and the journal names the file. A private database, never a real one.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { userInfo } from "node:os";
import path from "node:path";
import { test } from "node:test";
import pg from "pg";

const dir = path.resolve(import.meta.dirname, "../drizzle/migrations");

test("the journal's last entry is 0039_company_runner and the file exists", () => {
  const journal = JSON.parse(readFileSync(path.join(dir, "meta/_journal.json"), "utf8")) as { entries: { idx: number; tag: string }[] };
  const last = journal.entries.at(-1)!;
  assert.equal(last.tag, "0039_company_runner");
  assert.equal(last.idx, journal.entries.length - 1);
  assert.equal(readdirSync(dir).filter((f) => f.startsWith("0039")).join(","), "0039_company_runner.sql");
});

test("0039_company_runner.sql applies twice on a throwaway database", async () => {
  const name = "plania_mig_0039";
  const adminUrl = `postgres://${userInfo().username}@localhost:5432/postgres`;
  const sql0039 = readFileSync(path.join(dir, "0039_company_runner.sql"), "utf8");
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`drop database if exists ${name} with (force)`);
  await admin.query(`create database ${name}`);
  await admin.end();

  const mig = new pg.Client({ connectionString: `postgres://${userInfo().username}@localhost:5432/${name}` });
  await mig.connect();
  try {
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql") && f < "0039").sort()) await mig.query(readFileSync(path.join(dir, f), "utf8"));
    await mig.query(`insert into projects (slug, title, key_prefix) values ('old', 'Old', 'OLD')`);
    await mig.query(`insert into agents (slug, name, role, kind) values ('po-old', 'PO', 'product-owner', 'bot')`);

    await mig.query(sql0039);
    assert.equal((await mig.query(`select runs_paused from projects where slug = 'old'`)).rows[0].runs_paused, true);
    const settings = (await mig.query(`select * from runner_settings`)).rows;
    assert.equal(settings.length, 1);
    assert.deepEqual(
      [settings[0].company_paused, settings[0].max_concurrent, settings[0].plan_guard_pct, settings[0].cooldown_minutes],
      [false, 1, 70, 30],
    );
    const p = (await mig.query(`select id from projects where slug = 'old'`)).rows[0].id;
    const a = (await mig.query(`select id from agents where slug = 'po-old'`)).rows[0].id;
    await mig.query(`insert into token_budgets (scope, project_id, weekly_limit) values ('project', $1, 500000)`, [p]);
    await mig.query(`insert into agent_runs (agent_id, project_id, role, status) values ($1, $2, 'product-owner', 'queued')`, [a, p]);
    await mig.query(`insert into plan_readings (source, status, five_hour_pct) values ('stream', 'allowed', 83)`);

    await mig.query(sql0039);
    assert.equal((await mig.query(`select count(*)::int as n from runner_settings`)).rows[0].n, 1);
    assert.equal((await mig.query(`select count(*)::int as n from token_budgets`)).rows[0].n, 1);
    assert.equal((await mig.query(`select count(*)::int as n from agent_runs`)).rows[0].n, 1);

    await assert.rejects(mig.query(`insert into runner_settings (id) values (2)`));
    await assert.rejects(mig.query(`insert into token_budgets (scope, project_id, weekly_limit) values ('project', $1, 1)`, [p]));
    await assert.rejects(mig.query(`insert into token_budgets (scope, role, weekly_limit) values ('project', 'taller', 1)`));
    await assert.rejects(mig.query(`insert into agent_runs (agent_id, project_id, role, status) values ($1, $2, 'x', 'exploded')`, [a, p]));
    await assert.rejects(mig.query(`update runner_settings set plan_guard_pct = 101`));
    await mig.query(`insert into projects (slug, title, key_prefix) values ('fresh', 'Fresh', 'FRE')`);
    assert.equal((await mig.query(`select runs_paused from projects where slug = 'fresh'`)).rows[0].runs_paused, true);
    const cols = (await mig.query(`select column_name from information_schema.columns where table_name = 'token_usage'`)).rows.map((r) => r.column_name);
    assert.equal(cols.includes("cache_read") && cols.includes("cache_create"), true);
  } finally {
    await mig.end();
    const drop = new pg.Client({ connectionString: adminUrl });
    await drop.connect();
    await drop.query(`drop database if exists ${name} with (force)`);
    await drop.end();
  }
});
