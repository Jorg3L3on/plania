// PLA-I18-1: gates were removed. ask with gate is refused, ideas and promoted initiatives move
// without one, and old gate rows stay readable. Human-only questions are still a screen click.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { userInfo } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import pg from "pg";
import { resetTestDb, TEST_BEARER, useTestEnv } from "./helpers.js";

useTestEnv();
const { app } = await import("../src/app.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const { makeDb } = await import("../src/db/client.js");
const { createMcpServer } = await import("../src/mcp/register.js");
const { WEB_ACTOR, isScreenActor } = await import("../src/mcp/tx.js");

type Json = Record<string, any>;

test("the screen has no gate UI: no Compuertas panel, gate chip or gate option words", () => {
  for (const gone of ["../ui/src/components/gate-panel.tsx", "../ui/src/lib/use-gate-answer.ts", "../ui/src/components/question-marks.tsx"]) {
    assert.equal(existsSync(path.resolve(import.meta.dirname, gone)), false, gone);
  }
  const files = [
    "../ui/src/components/resume.tsx",
    "../ui/src/components/home/te-toca.tsx",
    "../ui/src/components/task-sheet.tsx",
    "../ui/src/pages/inbox.tsx",
    "../ui/src/lib/inbox.ts",
    "../ui/src/lib/ahora.ts",
    "../ui/src/lib/types.ts",
  ];
  for (const rel of files) {
    const source = readFileSync(path.resolve(import.meta.dirname, rel), "utf8");
    assert.equal(/\bgates?\b|Compuerta|Puerta [ABC]|Solo tú|Seguir|Soltar|Después/.test(source), false, rel);
  }
  // A question card is still its options plus a free answer, on the screen session.
  const resume = readFileSync(path.resolve(import.meta.dirname, "../ui/src/components/resume.tsx"), "utf8");
  assert.match(resume, /handleChoose/);
  assert.match(resume, /handleSubmitFree/);
  assert.match(resume, /useQuestionAnswer/);
});

test("src/gate does not spawn security", () => {
  const dir = path.resolve(import.meta.dirname, "../src/gate");
  if (!existsSync(dir)) return;
  const files = readdirSync(dir).filter((name) => name.endsWith(".ts") || name.endsWith(".js"));
  for (const name of files) {
    const source = readFileSync(path.join(dir, name), "utf8");
    assert.equal(/security/.test(source), false, name);
    assert.equal(/execFile/.test(source), false, name);
  }
});

const A = { agent: "test-agent", session_id: "s1", machine: "ci" };
const P = { project: "workia" };
const SCREEN = { agent: "jorge", session_id: "web", machine: "screen" };

let client: Client;
let raw: pg.Client;
let cookie: string;

const migrationsDir = path.resolve(import.meta.dirname, "../drizzle/migrations");

// Historical SQL still names the letter column. Apply it on a private database that stops
// before that file, never on the shared test database (0032 has already dropped the column).
async function withPartialDb(name: string, beforeFile: string, run: (db: pg.Client) => Promise<void>) {
  const adminUrl = `postgres://${userInfo().username}@localhost:5432/postgres`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`drop database if exists ${name} with (force)`);
  await admin.query(`create database ${name}`);
  await admin.end();
  const db = new pg.Client({ connectionString: `postgres://${userInfo().username}@localhost:5432/${name}` });
  await db.connect();
  try {
    const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql") && f < beforeFile).sort();
    for (const f of files) await db.query(readFileSync(path.join(migrationsDir, f), "utf8"));
    await run(db);
  } finally {
    await db.end();
    const drop = new pg.Client({ connectionString: adminUrl });
    await drop.connect();
    await drop.query(`drop database if exists ${name} with (force)`);
    await drop.end();
  }
}

function req(method: string, url: string, opts: { body?: unknown; cookie?: string | null; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  const c = opts.cookie === undefined ? cookie : opts.cookie;
  if (c) headers.Cookie = c;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  return app.request(url, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
}

async function call(name: string, args: Json = {}): Promise<Json> {
  const r = (await client.callTool({ name, arguments: { actor: A, ...P, ...args } })) as { isError?: boolean; content: { text: string }[] };
  const data = JSON.parse(r.content[0]!.text) as Json;
  return r.isError ? { __error: data.error, __status: data.status, ...data } : data;
}

async function setStatus(key: string, status: string) {
  const version = (await call("get_task", { key })).version;
  return call("set_task", { key, status, version });
}

async function answerScreen(questionId: string, option: string, extra: { body?: Json; cookie?: string | null; headers?: Record<string, string> } = {}) {
  const res = await req("POST", `/api/projects/workia/questions/${questionId}/answer`, {
    body: extra.body ?? { answer: option },
    cookie: extra.cookie,
    headers: extra.headers,
  });
  const text = await res.text();
  return { status: res.status, body: text ? (JSON.parse(text) as Json) : {} };
}

describe("screen gates", () => {
  before(async () => {
    raw = await resetTestDb();
    cookie = `${SESSION_COOKIE}=${createSession()}`;
    const db = makeDb().db;
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await createMcpServer(db).connect(serverSide);
    client = new Client({ name: "test", version: "0" });
    await client.connect(clientSide);
  });

  after(async () => {
    await client?.close();
    await raw?.end();
  });

  test("migration 0027 applies twice, adds gate_challenges, and flags open gates", async () => {
    await withPartialDb("plania_mig_0027", "0027", async (db) => {
      const project = await db.query("insert into projects (slug, title, key_prefix) values ('old', 'Old', 'OLD') returning id");
      const projectId = project.rows[0].id as string;
      const task = await db.query(
        "insert into tasks (project_id, kind, key, title, status, stage) values ($1, 'idea', 'OLD-1', 'Fila previa', 'Open', 'idea') returning id",
        [projectId],
      );
      const taskId = task.rows[0].id as string;
      const actor = JSON.stringify(A);
      await db.query(
        `insert into questions (project_id, task_id, question, gate, human_only, asked_by) values
          ($1, $2, 'Abierta', 'A', false, $3::jsonb),
          ($1, $2, 'Respondida', 'A', false, $3::jsonb),
          ($1, $2, 'Normal', null, false, $3::jsonb)`,
        [projectId, taskId, actor],
      );
      await db.query(
        "update questions set answer = 'pursue', answered_at = now(), answered_by = $1::jsonb where question = 'Respondida'",
        [actor],
      );
      const sql = readFileSync(path.resolve(import.meta.dirname, "../drizzle/migrations/0027_gate_challenges.sql"), "utf8");
      await db.query(sql);
      await db.query(sql);
      const { rows } = await db.query(
        "select column_name from information_schema.columns where table_name = 'gate_challenges' order by column_name",
      );
      assert.deepEqual(rows.map((r) => r.column_name), [
        "attempts", "created_at", "expires_at", "id", "nonce", "option", "question_id", "state", "totp_step", "used_at",
      ]);
      const flags = await db.query(
        "select question, human_only from questions where task_id = $1 order by question",
        [taskId],
      );
      assert.deepEqual(
        flags.rows.map((r) => [r.question, r.human_only]),
        [["Abierta", true], ["Normal", false], ["Respondida", false]],
      );
    });
  });

  test("migration 0028 applies twice and drops the challenge table", async () => {
    await raw.query(`
      create table if not exists gate_challenges (
        id uuid primary key default gen_random_uuid(),
        question_id uuid,
        option text,
        nonce text,
        totp_step bigint
      )
    `);
    await raw.query(`
      create unique index if not exists gate_challenges_totp_step_unique
      on gate_challenges (totp_step) where totp_step is not null
    `);
    await raw.query(
      `insert into machine_state (key, value) values ('gate.totp', '{"steps":[1]}'::jsonb)
       on conflict (key) do update set value = excluded.value`,
    );
    const sql = readFileSync(path.resolve(import.meta.dirname, "../drizzle/migrations/0028_gate_click.sql"), "utf8");
    await raw.query(sql);
    await raw.query(sql);
    const tables = await raw.query("select to_regclass('public.gate_challenges') as name");
    assert.equal(tables.rows[0].name, null);
    const index = await raw.query("select 1 from pg_indexes where indexname = 'gate_challenges_totp_step_unique'");
    assert.equal(index.rows.length, 0);
    const column = await raw.query(
      "select 1 from information_schema.columns where table_name = 'gate_challenges' and column_name = 'totp_step'",
    );
    assert.equal(column.rows.length, 0);
    const state = await raw.query("select key from machine_state where key = 'gate.totp'");
    assert.equal(state.rows.length, 0);
  });

  test("migration 0030 closes only open gate rows, is idempotent, and drops nothing", async () => {
    await withPartialDb("plania_mig_0030", "0030", async (db) => {
      const project = await db.query("insert into projects (slug, title, key_prefix) values ('old', 'Old', 'OLD') returning id");
      const projectId = project.rows[0].id as string;
      const task = await db.query(
        "insert into tasks (project_id, kind, key, title, status, stage) values ($1, 'idea', 'OLD-30', 'Antes de 2.17', 'Open', 'planning') returning id",
        [projectId],
      );
      const taskId = task.rows[0].id as string;
      const actor = JSON.stringify(A);
      await db.query(
        `insert into questions (project_id, task_id, question, options, gate, human_only, asked_by) values
          ($1, $2, 'Gate abierta', '{ready,rework,drop}', 'C', true, $3::jsonb),
          ($1, $2, 'Normal abierta', '{}', null, true, $3::jsonb)`,
        [projectId, taskId, actor],
      );
      await db.query(
        `insert into questions (project_id, task_id, question, options, gate, human_only, asked_by, answer, answered_by, answered_at)
         values ($1, $2, 'Gate respondida', '{pursue,drop,later}', 'A', true, $3::jsonb, 'pursue', $4::jsonb, '2026-01-02T00:00:00Z')`,
        [projectId, taskId, actor, JSON.stringify(SCREEN)],
      );
      const sql = readFileSync(path.resolve(import.meta.dirname, "../drizzle/migrations/0030_close_gates.sql"), "utf8");
      const first = await db.query(sql);
      assert.ok(first.rowCount! >= 1, String(first.rowCount));
      const second = await db.query(sql);
      assert.equal(second.rowCount, 0, "a second run updates 0 rows");

      const rows = (await db.query(
        "select question, gate, answer, answered_by, answered_at from questions where task_id = $1 order by question",
        [taskId],
      )).rows;
      const by = Object.fromEntries(rows.map((r) => [r.question, r]));
      assert.equal(by["Gate abierta"].answer, "closed: gates removed");
      assert.deepEqual(by["Gate abierta"].answered_by, { agent: "plania", session_id: "system" });
      assert.ok(by["Gate abierta"].answered_at);
      assert.equal(by["Gate abierta"].gate, "C", "the gate letter stays as history");
      assert.equal(by["Normal abierta"].answered_at, null, "an ordinary open question is untouched");
      assert.equal(by["Gate respondida"].answer, "pursue");
      assert.deepEqual(by["Gate respondida"].answered_by, SCREEN);

      const column = await db.query("select 1 from information_schema.columns where table_name = 'questions' and column_name = 'gate'");
      assert.equal(column.rows.length, 1);
      const check = await db.query("select 1 from pg_constraint where conname = 'questions_gate_check'");
      assert.equal(check.rows.length, 1);
      assert.equal((await db.query("select to_regclass('public.delegated_answers') as t")).rows[0].t, "delegated_answers");
      assert.doesNotMatch(sql, /\b(drop|delete|truncate|alter)\b/i);
    });
  });

  test("a question that is not a gate is still answered by an agent", async () => {
    const ticket = await call("create_task", { title: "Color", scope: "s", checks: ["c"] });
    assert.equal(ticket.__error, undefined);
    const asked = await call("ask", { key: ticket.key, question: "¿Color?", options: ["azul"] });
    assert.equal(asked.question.human_only, false);
    assert.equal("gate" in asked.question, false);
    const answered = await call("answer", { question_id: asked.question.id, answer: "azul" });
    assert.equal(answered.__error, undefined);
    const row = (await raw.query("select answer, answered_by from questions where id = $1", [asked.question.id])).rows[0];
    assert.equal(row.answer, "azul");
    assert.equal(row.answered_by.agent, "test-agent");
  });

  test("ask ignores the removed field, stores the question, and returns a hint", async () => {
    const idea = await call("create_task", { kind: "idea", title: "Puerta" });
    const ticket = await call("create_task", { title: "Con puerta", scope: "s", checks: ["c"] });
    for (const [key, mark] of [[idea.key, "A"], [idea.key, "C"], [ticket.key, "B"], [idea.key, "Z"]] as const) {
      const stored = await call("ask", { key, gate: mark, question: `¿La seguimos? ${mark}` });
      assert.equal(stored.__error, undefined, `${key} ${mark} ${JSON.stringify(stored)}`);
      assert.match(String(stored.hint), /obsolete field/);
      assert.equal("gate" in stored.question, false);
      const row = (await raw.query("select id, question from questions where id = $1", [stored.question.id])).rows[0];
      assert.equal(row.question, `¿La seguimos? ${mark}`);
    }
    assert.equal((await call("get_task", { key: ticket.key })).status, "Needs Jorge");
    const plain = await call("ask", { key: idea.key, question: "¿Sin el campo?" });
    assert.equal(plain.hint, undefined);
  });

  test("MCP answer on a human_only question is HUMAN_ONLY, including a spoofed screen actor", async () => {
    const ticket = await call("create_task", { title: "Solo pantalla", scope: "s", checks: ["c"] });
    const asked = await call("ask", { key: ticket.key, question: "¿Seguimos?", options: ["sí", "no"], human_only: true });
    assert.equal(asked.__error, undefined);
    assert.equal(asked.question.human_only, true);
    assert.equal("gate" in asked.question, false);
    const refused = await call("answer", { question_id: asked.question.id, answer: "sí" });
    assert.equal(refused.__error, "HUMAN_ONLY");
    assert.equal(refused.__status, 403);
    const spoofed = await call("answer", {
      question_id: asked.question.id,
      answer: "sí",
      actor: { agent: "test-agent", session_id: "web", machine: "screen" },
    });
    assert.equal(spoofed.__error, "HUMAN_ONLY");
    const reserved = await call("answer", { question_id: asked.question.id, answer: "sí", actor: SCREEN });
    assert.equal(reserved.__error, "RESERVED_ACTOR");
    const still = (await raw.query("select answer from questions where id = $1", [asked.question.id])).rows[0];
    assert.equal(still.answer, null);
  });

  test("the screen answer route refuses a bearer, a spoofed actor, and accepts the session", async () => {
    const ticket = await call("create_task", { title: "Clic", scope: "s", checks: ["c"] });
    const asked = await call("ask", { key: ticket.key, question: "¿Un clic?", options: ["sí", "no"], human_only: true });
    const id = asked.question.id as string;

    const bearerOnly = await answerScreen(id, "sí", {
      cookie: null,
      headers: { Authorization: `Bearer ${TEST_BEARER}` },
    });
    assert.ok(bearerOnly.status === 401 || bearerOnly.status === 403, String(bearerOnly.status));
    assert.equal(bearerOnly.body.answer, undefined);

    const bearerAndCookie = await answerScreen(id, "sí", { headers: { Authorization: `Bearer ${TEST_BEARER}` } });
    assert.equal(bearerAndCookie.status, 403);
    assert.equal(bearerAndCookie.body.error, "HUMAN_ONLY");

    const bodyActor = await answerScreen(id, "sí", { body: { answer: "sí", actor: SCREEN } });
    assert.equal(bodyActor.status, 403);
    assert.equal(bodyActor.body.error, "HUMAN_ONLY");

    const headerActor = await answerScreen(id, "sí", { headers: { "X-Actor": JSON.stringify(SCREEN) } });
    assert.equal(headerActor.status, 403);
    assert.equal(headerActor.body.error, "HUMAN_ONLY");

    const noCookie = await answerScreen(id, "sí", { cookie: null });
    assert.equal(noCookie.status, 401);

    const open = (await raw.query("select answer from questions where id = $1", [id])).rows[0];
    assert.equal(open.answer, null);

    const accepted = await answerScreen(id, "sí");
    assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
    assert.equal(accepted.body.question.answer, "sí");
    assert.deepEqual(accepted.body.question.answered_by, WEB_ACTOR);
    assert.equal(isScreenActor(accepted.body.question.answered_by), true);

    const gone = await req("POST", "/api/gate/enroll", { body: { password: "unused" } });
    assert.equal(gone.status, 404);
    const challenge = await req("POST", `/api/projects/workia/questions/${id}/challenge`, { body: { option: "drop" } });
    assert.equal(challenge.status, 404);
  });

  test("a human_only question with no options is free text on the screen", async () => {
    const ticket = await call("create_task", { title: "Solo", scope: "s", checks: ["c"] });
    const asked = await call("ask", { key: ticket.key, question: "¿Sigues tú?", human_only: true });
    assert.equal("gate" in asked.question, false);
    assert.equal(asked.question.human_only, true);
    assert.equal((await call("answer", { question_id: asked.question.id, answer: "sí" })).__error, "HUMAN_ONLY");
    const out = await answerScreen(asked.question.id, "sí");
    assert.equal(out.status, 200, JSON.stringify(out.body));
    assert.equal(out.body.question.answer, "sí");
    assert.deepEqual(out.body.question.answered_by, WEB_ACTOR);
  });

  test("a promoted initiative goes Active with no gate C, and old gate rows stay as history", async () => {
    const initiative = await call("create_task", { kind: "initiative", title: "Linea", scope: "PRD" });
    const legacyInit = await call("create_task", { kind: "initiative", title: "Vieja", scope: "PRD" });
    const idea = await call("create_task", { kind: "idea", title: "Promovida" });
    const legacyIdea = await call("create_task", { kind: "idea", title: "Fila vieja" });
    await raw.query("update tasks set stage = 'ready', promoted_to = $1 where key = $2", [initiative.key, idea.key]);
    await raw.query("update tasks set stage = 'planning', promoted_to = $1 where key = $2", [legacyInit.key, legacyIdea.key]);

    const active = await setStatus(initiative.key, "Active");
    assert.equal(active.__error, undefined, JSON.stringify(active));
    assert.equal(active.status, "Active");
    const parked = await setStatus(initiative.key, "On hold");
    assert.equal(parked.__error, undefined);
    assert.equal((await setStatus(initiative.key, "Active")).status, "Active", "On hold → Active needs nothing either");

    // Rows written before 2.17: an agent answer and an open gate C, both on the idea.
    const ids = (await raw.query(
      "select t.id as task_id, t.project_id from tasks t join projects p on p.id = t.project_id where p.slug = 'workia' and t.key = $1",
      [legacyIdea.key],
    )).rows[0];
    await raw.query(
      `insert into questions (project_id, task_id, question, options, human_only, asked_by, answer, answered_by, answered_at)
       values ($1, $2, 'Respuesta de agente', $3, false, $4::jsonb, 'rework', $4::jsonb, now())`,
      [ids.project_id, ids.task_id, ["ready", "rework", "drop"], JSON.stringify(A)],
    );
    const inserted = await raw.query(
      `insert into questions (project_id, task_id, question, options, human_only, asked_by)
       values ($1, $2, 'Fila anterior', $3, true, $4::jsonb) returning id`,
      [ids.project_id, ids.task_id, ["ready", "rework", "drop"], JSON.stringify(A)],
    );
    const legacyActive = await setStatus(legacyInit.key, "Active");
    assert.equal(legacyActive.__error, undefined, JSON.stringify(legacyActive));
    assert.equal(legacyActive.status, "Active");

    const history = (await call("get_task", { key: legacyIdea.key })).questions as Json[];
    assert.deepEqual(history.map((q) => q.question), ["Respuesta de agente", "Fila anterior"]);
    assert.equal(history.every((q) => !("gate" in q)), true);

    // The open human_only row is still the owner's to close on the screen; it moves nothing and logs no old event.
    const legacyId = inserted.rows[0].id as string;
    assert.equal((await call("answer", { question_id: legacyId, answer: "ready" })).__error, "HUMAN_ONLY");
    const onScreen = await answerScreen(legacyId, "cerrada");
    assert.equal(onScreen.status, 200, JSON.stringify(onScreen.body));
    const gateEvents = (await raw.query("select 1 from events where task_key = $1 and type = 'gate.answered'", [legacyIdea.key])).rows;
    assert.equal(gateEvents.length, 0);
    assert.equal((await call("get_task", { key: legacyIdea.key })).stage, "planning");
  });
});
