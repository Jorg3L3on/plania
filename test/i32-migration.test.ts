// PLA-I32-1: 0041 gives agents a project and a role template, adds threads and thread messages, and an
// Asistente budget. Proved on a private throwaway database, never a real one: every migration before
// 0041 runs, a fake roster and two projects go in, then 0041 runs twice.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { userInfo } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { getTableConfig } from "drizzle-orm/pg-core";
import pg from "pg";
import { agents, runnerSettings, threadMessages, threads } from "../src/db/schema.js";

const dir = path.resolve(import.meta.dirname, "../drizzle/migrations");

test("the journal has 0041_company_org at idx 38 and the file exists", () => {
  const journal = JSON.parse(readFileSync(path.join(dir, "meta/_journal.json"), "utf8")) as { entries: { idx: number; tag: string }[] };
  const entry = journal.entries.find((e) => e.tag === "0041_company_org")!;
  assert.equal(entry.idx, 38);
  assert.equal(journal.entries.at(-1)!.idx, journal.entries.length - 1);
  assert.equal(readdirSync(dir).filter((f) => f.startsWith("0041")).join(","), "0041_company_org.sql");
});

test("schema.ts exposes project_id, role_template, threads and thread_messages with their checks", () => {
  const a = getTableConfig(agents);
  assert.ok(a.columns.some((c) => c.name === "project_id"));
  assert.ok(a.columns.some((c) => c.name === "role_template"));
  assert.ok(a.checks.some((c) => c.name === "agents_role_template_check"));
  const t = getTableConfig(threads);
  assert.deepEqual(t.columns.map((c) => c.name).sort(), ["created_at", "id", "kind", "project_id", "read_at"]);
  assert.ok(t.checks.some((c) => c.name === "threads_kind_check"));
  const m = getTableConfig(threadMessages);
  assert.deepEqual(m.columns.map((c) => c.name).sort(), ["action_state", "at", "author_agent", "author_role", "body", "id", "links", "proposal", "question_id", "thread_id"]);
  assert.deepEqual(m.checks.map((c) => c.name).sort(), [
    "thread_messages_action_state_check",
    "thread_messages_author_check",
    "thread_messages_body_check",
    "thread_messages_links_check",
    "thread_messages_proposal_check",
  ]);
  // PLA-21 (0043) dropped Asistente's weekly limit again.
  assert.equal(getTableConfig(runnerSettings).columns.some((c) => c.name === "asistente_weekly_limit"), false);
});

test("0041 applies twice on a throwaway copy; threads exist for the company and every project", async () => {
  const name = "plania_mig_0041";
  const adminUrl = `postgres://${userInfo().username}@localhost:5432/postgres`;
  const url = `postgres://${userInfo().username}@localhost:5432/${name}`;
  const sql0041 = readFileSync(path.join(dir, "0041_company_org.sql"), "utf8");
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`drop database if exists ${name} with (force)`);
  await admin.query(`create database ${name}`);
  await admin.end();

  const mig = new pg.Client({ connectionString: url });
  await mig.connect();
  try {
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql") && f < "0041").sort()) await mig.query(readFileSync(path.join(dir, f), "utf8"));
    await mig.query(`insert into projects (slug, title, key_prefix) values ('demo', 'Demo', 'DEM'), ('otro', 'Otro', 'OTR')`);
    await mig.query(`insert into agents (slug, name, role, kind, adapter) values ('ceo', 'CEO', 'human', 'human', 'none'), ('po-demo', 'PO Demo', 'product-owner', 'bot', 'claude_code')`);
    const demo = (await mig.query(`select id from projects where slug = 'demo'`)).rows[0].id as string;
    await mig.query(`insert into agent_runs (agent_id, project_id, role, status) select id, $1, 'product-owner', 'ok' from agents where slug = 'po-demo'`, [demo]);

    await mig.query(sql0041);
    await mig.query(sql0041);

    const counts = (await mig.query(`select kind, count(*)::int as n from threads group by kind order by kind`)).rows;
    assert.deepEqual(counts, [{ kind: "company", n: 1 }, { kind: "project", n: 2 }]);
    assert.equal((await mig.query(`select count(*)::int as n from agents where project_id is null and role_template is null`)).rows[0].n, 2, "existing rows untouched");
    assert.equal((await mig.query(`select count(*)::int as n from agent_runs`)).rows[0].n, 1);
    assert.equal(Number((await mig.query(`select asistente_weekly_limit from runner_settings where id = 1`)).rows[0].asistente_weekly_limit), 500000);

    await mig.query(`update agents set project_id = $1, role_template = 'product-owner', status = 'retired' where slug = 'po-demo'`, [demo]);
    await assert.rejects(mig.query(`update agents set role_template = 'Not A Slug' where slug = 'po-demo'`), /agents_role_template_check/);
    await assert.rejects(mig.query(`update agents set status = 'gone' where slug = 'po-demo'`), /agents_status_check/);
    await assert.rejects(mig.query(`insert into threads (kind) values ('company')`), /threads_company_unique/);
    await assert.rejects(mig.query(`insert into threads (kind, project_id) values ('project', $1)`, [demo]), /threads_project_unique/);
    await assert.rejects(mig.query(`insert into threads (kind) values ('project')`), /threads_kind_check/);

    const thread = (await mig.query(`select id from threads where kind = 'company'`)).rows[0].id as string;
    const insert = (body: string, links = "[]") =>
      mig.query(`insert into thread_messages (thread_id, author_agent, author_role, body, links) values ($1, 'jorge', 'ceo', $2, $3::jsonb)`, [thread, body, links]);
    await insert("Mianovia: quiero el plan de la semana", `[{"kind":"ticket","ref":"DEM-1","title":"Plan"}]`);
    await assert.rejects(insert(""), /thread_messages_body_check/);
    await assert.rejects(insert("x".repeat(4001)), /thread_messages_body_check/);
    await assert.rejects(insert("hola", `{"kind":"ticket"}`), /thread_messages_links_check/);
    await assert.rejects(
      mig.query(`update thread_messages set action_state = '"aceptar"'::jsonb`),
      /thread_messages_action_state_check/,
    );
    await assert.rejects(mig.query(`update runner_settings set asistente_weekly_limit = 0`), /runner_settings_asistente_limit_check/);
    await mig.query(`update runner_settings set asistente_weekly_limit = null`);
  } finally {
    await mig.end();
    const drop = new pg.Client({ connectionString: adminUrl });
    await drop.connect();
    await drop.query(`drop database if exists ${name} with (force)`);
    await drop.end();
  }
});
