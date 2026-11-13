// PLA-21: 0043 drops the weekly token budgets (token_budgets and runner_settings.asistente_weekly_limit).
// Proved on a private throwaway database, never a real one: every migration before 0043 runs, a project with a
// budget and Asistente's limit go in, then 0043 runs twice and the rest of runner_settings is kept.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { userInfo } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { getTableConfig } from "drizzle-orm/pg-core";
import pg from "pg";
import * as schema from "../src/db/schema.js";

const dir = path.resolve(import.meta.dirname, "../drizzle/migrations");

test("the journal holds 0043_remove_token_budgets and the schema has no budget left", () => {
  const journal = JSON.parse(readFileSync(path.join(dir, "meta/_journal.json"), "utf8")) as { entries: { idx: number; tag: string }[] };
  // PLA-25 added 0044 after it; the journal must stay in order with no gaps.
  assert.ok(journal.entries.some((e) => e.tag === "0043_remove_token_budgets"));
  assert.equal(journal.entries.at(-1)!.idx, journal.entries.length - 1);
  assert.equal("tokenBudgets" in schema, false);
  assert.equal(getTableConfig(schema.runnerSettings).columns.some((c) => c.name === "asistente_weekly_limit"), false);
});

test("0043 applies twice on a throwaway copy: the budgets are gone, the runner settings stay", async () => {
  const name = "plania_mig_0043";
  const adminUrl = `postgres://${userInfo().username}@localhost:5432/postgres`;
  const url = `postgres://${userInfo().username}@localhost:5432/${name}`;
  const sql0043 = readFileSync(path.join(dir, "0043_remove_token_budgets.sql"), "utf8");
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`drop database if exists ${name} with (force)`);
  await admin.query(`create database ${name}`);
  await admin.end();

  const mig = new pg.Client({ connectionString: url });
  await mig.connect();
  try {
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql") && f < "0043").sort()) await mig.query(readFileSync(path.join(dir, f), "utf8"));
    await mig.query(`insert into projects (slug, title, key_prefix) values ('demo', 'Demo', 'DEM')`);
    const demo = (await mig.query(`select id from projects where slug = 'demo'`)).rows[0].id as string;
    await mig.query(`insert into token_budgets (scope, project_id, weekly_limit) values ('project', $1, 1000000)`, [demo]);
    await mig.query(`insert into runner_settings (id) values (1) on conflict do nothing`);
    await mig.query(`update runner_settings set asistente_weekly_limit = 400000, plan_guard_pct = 65, max_concurrent = 2`);

    await mig.query(sql0043);
    await mig.query(sql0043);

    assert.equal((await mig.query(`select to_regclass('token_budgets') as t`)).rows[0].t, null);
    const cols = (await mig.query(`select column_name from information_schema.columns where table_name = 'runner_settings'`)).rows.map((r) => r.column_name);
    assert.equal(cols.includes("asistente_weekly_limit"), false);
    const s = (await mig.query(`select plan_guard_pct, max_concurrent from runner_settings where id = 1`)).rows[0];
    assert.deepEqual([s.plan_guard_pct, s.max_concurrent], [65, 2]);
    assert.equal((await mig.query(`select count(*)::int as n from projects where slug = 'demo'`)).rows[0].n, 1, "the project stays");
  } finally {
    await mig.end();
    const drop = new pg.Client({ connectionString: adminUrl });
    await drop.connect();
    await drop.query(`drop database if exists ${name} with (force)`);
    await drop.end();
  }
});
