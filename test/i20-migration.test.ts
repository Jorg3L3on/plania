// PLA-I20-3: 0032 copies old approval rows and lettered questions into events, then drops them.
// A second run copies nothing. This uses a private database, never a real one.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { userInfo } from "node:os";
import path from "node:path";
import { test } from "node:test";
import pg from "pg";

const migrationsDir = path.resolve(import.meta.dirname, "../drizzle/migrations");
const sql0032 = readFileSync(path.join(migrationsDir, "0032_drop_gates_approvals.sql"), "utf8");
const ACTOR = JSON.stringify({ agent: "jorge", session_id: "web", machine: "screen" });

test("migration 0032 archives old rows, drops them, and is safe to run twice", async () => {
  const name = "plania_mig_0032";
  const adminUrl = `postgres://${userInfo().username}@localhost:5432/postgres`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`drop database if exists ${name} with (force)`);
  await admin.query(`create database ${name}`);
  await admin.end();

  const db = new pg.Client({ connectionString: `postgres://${userInfo().username}@localhost:5432/${name}` });
  await db.connect();
  try {
    const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql") && f < "0032").sort();
    for (const f of files) await db.query(readFileSync(path.join(migrationsDir, f), "utf8"));

    const project = await db.query("insert into projects (slug, title, key_prefix) values ('old', 'Old', 'OLD') returning id");
    const projectId = project.rows[0].id as string;
    const task = await db.query(
      "insert into tasks (project_id, kind, key, title, status) values ($1, 'ticket', 'OLD-1', 'Antes', 'Backlog') returning id",
      [projectId],
    );
    const taskId = task.rows[0].id as string;
    const approval = await db.query(
      `insert into approvals (project_id, task_id, task_key, action, target, reason, requested_by, state, decided_at, decided_by)
       values ($1, $2, 'OLD-1', 'wont_do', '{}', 'ya se decidió', $3::jsonb, 'granted', now(), $3::jsonb) returning id`,
      [projectId, taskId, ACTOR],
    );
    const approvalId = approval.rows[0].id as string;
    await db.query(
      `insert into delegated_answers (project_id, approval_id, message_id, quote, actor)
       values ($1, $2, 'msg-old-1', 'cita vieja de jorge', $3::jsonb)`,
      [projectId, approvalId, ACTOR],
    );
    const lettered = await db.query(
      `insert into questions (project_id, task_id, question, options, gate, human_only, asked_by)
       values ($1, $2, 'Letra', '{ready,rework,drop}', 'C', true, $3::jsonb) returning id`,
      [projectId, taskId, ACTOR],
    );
    const plain = await db.query(
      `insert into questions (project_id, task_id, question, asked_by) values ($1, $2, 'Normal', $3::jsonb) returning id`,
      [projectId, taskId, ACTOR],
    );

    await db.query(sql0032);

    const approvals = await db.query("select to_regclass('public.approvals') as name");
    assert.equal(approvals.rows[0].name, null);
    const column = await db.query(
      "select 1 from information_schema.columns where table_schema = 'public' and table_name = 'questions' and column_name = 'gate'",
    );
    assert.equal(column.rows.length, 0);
    const check = await db.query("select 1 from pg_constraint where conname = 'questions_gate_check'");
    assert.equal(check.rows.length, 0);
    const fk = await db.query("select 1 from pg_constraint where conname = 'delegated_answers_approval_id_approvals_id_fk'");
    assert.equal(fk.rows.length, 0);

    const archivedApproval = (await db.query(
      "select task_key, payload from events where type = 'approval.archived'",
    )).rows;
    assert.equal(archivedApproval.length, 1);
    assert.equal(archivedApproval[0].task_key, "OLD-1");
    assert.equal(archivedApproval[0].payload.approval_id, approvalId);
    assert.equal(archivedApproval[0].payload.action, "wont_do");
    assert.equal(archivedApproval[0].payload.state, "granted");
    assert.equal(archivedApproval[0].payload.reason, "ya se decidió");

    const archivedQuestion = (await db.query(
      "select task_key, payload from events where type = 'question.archived'",
    )).rows;
    assert.equal(archivedQuestion.length, 1);
    assert.equal(archivedQuestion[0].payload.question_id, lettered.rows[0].id);
    assert.equal(archivedQuestion[0].payload.letter, "C");
    assert.equal(archivedQuestion[0].payload.question, "Letra");
    assert.equal(
      archivedQuestion.some((r) => r.payload.question_id === plain.rows[0].id),
      false,
    );

    const kept = (await db.query("select approval_id, quote from delegated_answers")).rows;
    assert.equal(kept.length, 1);
    assert.equal(kept[0].approval_id, approvalId);
    assert.equal(kept[0].quote, "cita vieja de jorge");

    await db.query(sql0032);
    assert.equal((await db.query("select count(*)::int as n from events where type = 'approval.archived'")).rows[0].n, 1);
    assert.equal((await db.query("select count(*)::int as n from events where type = 'question.archived'")).rows[0].n, 1);
    assert.equal((await db.query("select to_regclass('public.approvals') as name")).rows[0].name, null);
    assert.equal(
      (await db.query("select 1 from information_schema.columns where table_name = 'questions' and column_name = 'gate'")).rows.length,
      0,
    );
  } finally {
    await db.end();
    const drop = new pg.Client({ connectionString: adminUrl });
    await drop.connect();
    await drop.query(`drop database if exists ${name} with (force)`);
    await drop.end();
  }
});
