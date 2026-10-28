// PLA-I15-2: plania-bot may record one answer the owner gave in his own chat.
// The screen click stays. The server cannot prove the caller or the message.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type pg from "pg";
import { resetTestDb, TEST_BEARER, TEST_CI_TOKEN, useTestEnv } from "./helpers.js";

useTestEnv();
const { app } = await import("../src/app.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const { makeDb } = await import("../src/db/client.js");
const { createMcpServer } = await import("../src/mcp/register.js");
const { auditProject } = await import("../src/mcp/audit.js");
const { findProject } = await import("../src/mcp/queries.js");
const { WEB_ACTOR, isScreenActor } = await import("../src/mcp/tx.js");

type Json = Record<string, any>;

const QUOTE = "sigue la compuerta con pursue";
const MESSAGE = "msg-owner-0142";
const BOT = { agent: "plania-bot", session_id: "bot-1", machine: "ci" };
const A = { agent: "test-agent", session_id: "s1", machine: "ci" };
const P = { project: "workia" };

let client: Client;
let raw: pg.Client;
let cookie: string;
let db: ReturnType<typeof makeDb>["db"];

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

const evidence = (message = MESSAGE, quote = QUOTE) => ({ delegated_by_jorge: { message_id: message, quote } });

async function gate(title: string) {
  const idea = await call("create_task", { kind: "idea", title });
  const asked = await call("ask", { key: idea.key, gate: "A", question: `¿${title}?` });
  assert.equal(asked.__error, undefined, JSON.stringify(asked));
  return { key: idea.key as string, id: asked.question.id as string };
}

test("the Bandeja renders the Delegada badge with the quote and the time", () => {
  const badge = readFileSync(path.resolve(import.meta.dirname, "../ui/src/components/delegada-badge.tsx"), "utf8");
  const inbox = readFileSync(path.resolve(import.meta.dirname, "../ui/src/pages/inbox.tsx"), "utf8");
  const sheet = readFileSync(path.resolve(import.meta.dirname, "../ui/src/components/task-sheet.tsx"), "utf8");
  const sw = readFileSync(path.resolve(import.meta.dirname, "../ui/src/components/delegation-switch.tsx"), "utf8");
  assert.match(badge, /«Delegada»/);
  assert.match(badge, /quote/);
  assert.match(badge, /localTime\(at\)/);
  assert.match(inbox, /DelegadaBadge/);
  assert.match(inbox, /Respuestas delegadas/);
  assert.match(inbox, /DelegationSwitch/);
  assert.match(sheet, /DelegadaBadge/);
  assert.match(sw, /El bot puede responder por ti/);
  assert.match(sw, /api\.setDelegation/);
});

describe("answer_delegated", () => {
  before(async () => {
    raw = await resetTestDb();
    cookie = `${SESSION_COOKIE}=${createSession()}`;
    const made = makeDb();
    db = made.db;
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await createMcpServer(db).connect(serverSide);
    client = new Client({ name: "test", version: "0" });
    await client.connect(clientSide);
  });

  after(async () => {
    await client?.close();
    await raw?.end();
  });

  test("migration 0029 applies twice", async () => {
    const sql = readFileSync(path.resolve(import.meta.dirname, "../drizzle/migrations/0029_delegated_answers.sql"), "utf8");
    await raw.query(sql);
    await raw.query(sql);
    const tables = await raw.query("select to_regclass('public.delegated_answers') as t");
    assert.equal(tables.rows[0].t, "delegated_answers");
    const idx = await raw.query("select indexname from pg_indexes where tablename = 'delegated_answers' order by 1");
    assert.deepEqual(idx.rows.map((r) => r.indexname), [
      "delegated_answers_approval_unique",
      "delegated_answers_created_idx",
      "delegated_answers_pkey",
      "delegated_answers_question_unique",
    ]);
  });

  test("missing or short evidence is refused and stores nothing", async () => {
    const g = await gate("Evidencia");
    const before = await raw.query("select count(*)::int as n from delegated_answers");
    for (const args of [
      { question_id: g.id, option: "pursue" },
      { question_id: g.id, option: "pursue", delegated_by_jorge: { quote: QUOTE } },
      { question_id: g.id, option: "pursue", delegated_by_jorge: { message_id: "", quote: QUOTE } },
      { question_id: g.id, option: "pursue", delegated_by_jorge: { message_id: "short", quote: QUOTE } },
      { question_id: g.id, option: "pursue", delegated_by_jorge: { message_id: MESSAGE, quote: "" } },
      { question_id: g.id, option: "pursue", delegated_by_jorge: { message_id: MESSAGE, quote: "corto" } },
      { question_id: g.id, option: "pursue", delegated_by_jorge: { message_id: MESSAGE, quote: "x".repeat(281) } },
    ]) {
      const refused = await call("answer_delegated", { ...args, actor: BOT });
      assert.equal(refused.__error, "DELEGATION_EVIDENCE", JSON.stringify(args));
      assert.equal(refused.__status, 400);
    }
    const after = await raw.query("select count(*)::int as n from delegated_answers");
    assert.equal(after.rows[0].n, before.rows[0].n);
    const open = await raw.query("select answer from questions where id = $1", [g.id]);
    assert.equal(open.rows[0].answer, null);
  });

  test("another agent, a spoofed screen session, and the answer tool are refused", async () => {
    const g = await gate("Ajeno");
    const cursor = await call("answer_delegated", {
      question_id: g.id,
      option: "pursue",
      actor: { agent: "Cursor", session_id: "web", machine: "screen" },
      ...evidence(),
    });
    assert.equal(cursor.__error, "HUMAN_ONLY");
    assert.equal(cursor.__status, 403);
    const other = await call("answer_delegated", { question_id: g.id, option: "pursue", actor: { agent: "other-bot", session_id: "s", machine: "ci" }, ...evidence() });
    assert.equal(other.__error, "HUMAN_ONLY");
    const wrongCase = await call("answer_delegated", { question_id: g.id, option: "pursue", actor: { agent: "Plania-bot", session_id: "s", machine: "ci" }, ...evidence() });
    assert.equal(wrongCase.__error, "HUMAN_ONLY");
    const reserved = await call("answer_delegated", {
      question_id: g.id,
      option: "pursue",
      actor: { agent: "jorge", session_id: "web", machine: "screen" },
      ...evidence(),
    });
    assert.equal(reserved.__error, "RESERVED_ACTOR");
    const viaAnswer = await call("answer", { question_id: g.id, answer: "pursue", actor: BOT });
    assert.equal(viaAnswer.__error, "HUMAN_ONLY");
    const still = await raw.query("select answer from questions where id = $1", [g.id]);
    assert.equal(still.rows[0].answer, null);

    const [a, b] = InMemoryTransport.createLinkedPair();
    const named = createMcpServer(db, { identity: { tokenId: "00000000-0000-4000-8000-000000000001", agent: "Cursor", machine: "screen", scopes: ["read", "write", "ops"] } });
    await named.connect(b);
    const otherClient = new Client({ name: "named", version: "0" });
    await otherClient.connect(a);
    const spoof = (await otherClient.callTool({
      name: "answer_delegated",
      arguments: { ...P, question_id: g.id, option: "pursue", actor: { agent: "plania-bot", session_id: "bot-1", machine: "screen" }, ...evidence() },
    })) as { isError?: boolean; content: { text: string }[] };
    const body = JSON.parse(spoof.content[0]!.text) as Json;
    assert.equal(body.error, "ACTOR_MISMATCH");
    await otherClient.close();
  });

  test("plania-bot with evidence closes the gate as the owner and the audit lists it", async () => {
    const g = await gate("Sigue");
    const done = await call("answer_delegated", { question_id: g.id, option: "pursue", actor: BOT, ...evidence() });
    assert.equal(done.__error, undefined, JSON.stringify(done));
    assert.equal(done.question.answer, "pursue");
    assert.deepEqual(done.question.answered_by, WEB_ACTOR);
    assert.equal(isScreenActor(done.question.answered_by), true);
    assert.equal(done.question.delegated.quote, QUOTE);
    assert.equal(done.question.delegated.message_id, MESSAGE);
    assert.equal(done.question.delegated.by.agent, "plania-bot");
    assert.equal(done.question.delegated.by.model, undefined);
    const row = (await raw.query("select answer, answered_by from questions where id = $1", [g.id])).rows[0];
    assert.equal(row.answer, "pursue");
    assert.deepEqual(row.answered_by, WEB_ACTOR);
    const evidenceRow = (await raw.query("select message_id, quote, actor from delegated_answers where question_id = $1", [g.id])).rows[0];
    assert.equal(evidenceRow.message_id, MESSAGE);
    assert.equal(evidenceRow.quote, QUOTE);
    assert.equal(evidenceRow.actor.agent, "plania-bot");
    assert.equal("token" in evidenceRow.actor, false);

    const events = (await raw.query("select type, actor, payload, token_id from events where task_key = $1 and type in ('question.answered', 'gate.answered') order by id", [g.key])).rows;
    assert.equal(events.length, 2);
    for (const e of events) {
      assert.deepEqual(e.actor, WEB_ACTOR);
      assert.equal(e.token_id, null);
      assert.equal(e.payload.delegated.quote, QUOTE);
      assert.equal(e.payload.delegated.message_id, MESSAGE);
      assert.deepEqual(Object.keys(e.payload.delegated.by).sort(), ["agent", "machine", "session_id"]);
      const blob = JSON.stringify(e);
      assert.equal(blob.includes(TEST_BEARER), false);
      assert.equal(blob.includes("test-session-secret"), false);
      assert.equal(/password|authorization|bearer/i.test(blob), false);
    }

    const p = await findProject(db, "workia");
    const findings = await auditProject(db, p);
    const delegated = findings.filter((f) => f.code === "GATE_ANSWERED_DELEGATED" && f.id === g.id);
    assert.equal(delegated.length, 1);
    assert.equal(delegated[0]!.level, "warn");
    assert.match(delegated[0]!.detail, /gate A delegated/);
    assert.match(delegated[0]!.detail, /sigue la compuerta/);
    assert.equal(findings.some((f) => f.code === "GATE_ANSWERED_BY_AGENT" && f.id === g.id), false);

    const again = await call("answer_delegated", { question_id: g.id, option: "drop", actor: BOT, ...evidence("msg-owner-0143", "otra instruccion distinta") });
    assert.equal(again.__error, "ALREADY_ANSWERED");

    const inbox = await call("get_inbox", { project: "workia" });
    const shown = inbox.delegated.find((d: Json) => d.quote === QUOTE);
    assert.ok(shown, JSON.stringify(inbox.delegated));
    assert.equal(shown.gate, "A");
    assert.equal(shown.key, g.key);

    const task = await call("get_task", { key: g.key });
    const q = task.questions.find((x: Json) => x.id === g.id);
    assert.equal(q.delegated.quote, QUOTE);
  });

  test("a direct agent answer is still GATE_ANSWERED_BY_AGENT and a screen click is not delegated", async () => {
    const project = await findProject(db, "workia");
    const idea = await call("create_task", { kind: "idea", title: "Directo" });
    const taskId = (await raw.query("select id from tasks where key = $1", [idea.key])).rows[0].id;
    const agent = JSON.stringify(A);
    const inserted = await raw.query(
      `insert into questions (project_id, task_id, question, options, gate, human_only, asked_by, answer, answered_by, answered_at)
       values ($1, $2, 'Directa', '{pursue,drop,later}', 'A', true, $3::jsonb, 'pursue', $3::jsonb, now()) returning id`,
      [project.id, taskId, agent],
    );
    const findings = await auditProject(db, project);
    assert.equal(findings.some((f) => f.code === "GATE_ANSWERED_BY_AGENT" && f.id === inserted.rows[0].id), true);
    assert.equal(findings.some((f) => f.code === "GATE_ANSWERED_DELEGATED" && f.id === inserted.rows[0].id), false);

    const g = await gate("Clic");
    const res = await req("POST", `/api/projects/workia/questions/${g.id}/answer`, { body: { answer: "drop" } });
    assert.equal(res.status, 200);
    const n = await raw.query("select count(*)::int as n from delegated_answers where question_id = $1", [g.id]);
    assert.equal(n.rows[0].n, 0);
    const after = await auditProject(db, project);
    assert.equal(after.some((f) => f.code === "GATE_ANSWERED_DELEGATED" && f.id === g.id), false);
    assert.equal(after.some((f) => f.code === "GATE_ANSWERED_BY_AGENT" && f.id === g.id), false);
  });

  test("a question that is not human_only is unchanged, and one without options is not delegable", async () => {
    const ticket = await call("create_task", { title: "Libre", scope: "s", checks: ["c"] });
    const asked = await call("ask", { key: ticket.key, question: "¿Color?", options: ["azul", "verde"] });
    const refused = await call("answer_delegated", { question_id: asked.question.id, option: "azul", actor: BOT, ...evidence("msg-owner-0200", "usa el azul por favor") });
    assert.equal(refused.__error, "NOT_DELEGABLE");
    const recorded = await call("answer", { question_id: asked.question.id, answer: "azul" });
    assert.equal(recorded.__error, undefined, JSON.stringify(recorded));
    assert.equal(recorded.question.answer, "azul");
    assert.equal(recorded.question.delegated, undefined);
    assert.deepEqual(recorded.question.answered_by, A);

    const human = await call("ask", { key: ticket.key, question: "¿Sigues tú?", human_only: true });
    const free = await call("answer_delegated", { question_id: human.question.id, option: "sí", actor: BOT, ...evidence("msg-owner-0201", "responde que si ahora") });
    assert.equal(free.__error, "NOT_DELEGABLE");
    const open = await raw.query("select answer from questions where id = $1", [human.question.id]);
    assert.equal(open.rows[0].answer, null);

    const named = await call("ask", { key: ticket.key, question: "¿Tamaño?", options: ["chico", "grande"], human_only: true });
    const ok = await call("answer_delegated", { question_id: named.question.id, option: "grande", actor: BOT, ...evidence("msg-owner-0202", "el grande, por favor") });
    assert.equal(ok.__error, undefined, JSON.stringify(ok));
    assert.equal(ok.question.answer, "grande");
    assert.deepEqual(ok.question.answered_by, WEB_ACTOR);
  });

  test("wont_do and reopen can be delegated; another approval action cannot", async () => {
    const ticket = await call("create_task", { title: "Cerrar", scope: "s", checks: ["c"] });
    const version = async () => (await call("get_task", { key: ticket.key })).version;
    const wont = await call("request_approval", { key: ticket.key, action: "wont_do", reason: "ya no hace falta" });
    const waive = await call("request_approval", { key: ticket.key, action: "waive_check", target: { n: 1 }, reason: "no aplica" });
    const blocked = await call("answer_delegated", { approval_id: waive.approval.id, decision: "grant", actor: BOT, ...evidence("msg-owner-0300", "no eximas ese punto") });
    assert.equal(blocked.__error, "NOT_DELEGABLE");
    const still = await raw.query("select state from approvals where id = $1", [waive.approval.id]);
    assert.equal(still.rows[0].state, "pending");

    const granted = await call("answer_delegated", { approval_id: wont.approval.id, decision: "grant", actor: BOT, ...evidence("msg-owner-0301", "marcalo wont do ya") });
    assert.equal(granted.__error, undefined, JSON.stringify(granted));
    assert.equal(granted.approval.state, "granted");
    assert.deepEqual(granted.approval.decided_by, WEB_ACTOR);
    assert.equal(granted.delegated.quote, "marcalo wont do ya");
    const closed = await call("set_task", { key: ticket.key, status: "Won't do", version: await version(), approval_id: wont.approval.id });
    assert.equal(closed.status, "Won't do", JSON.stringify(closed));

    const reopen = await call("request_approval", { key: ticket.key, action: "reopen", reason: "volvemos" });
    const opened = await call("answer_delegated", { approval_id: reopen.approval.id, decision: "grant", actor: BOT, ...evidence("msg-owner-0302", "reabre ese ticket ahora") });
    assert.equal(opened.__error, undefined, JSON.stringify(opened));
    const back = await call("set_task", { key: ticket.key, status: "Ready", version: await version(), approval_id: reopen.approval.id });
    assert.equal(back.status, "Ready", JSON.stringify(back));
    const ev = await raw.query("select actor, payload from events where type = 'approval.granted' and payload->>'approval_id' = $1", [reopen.approval.id]);
    assert.deepEqual(ev.rows[0].actor, WEB_ACTOR);
    assert.equal(ev.rows[0].payload.delegated.message_id, "msg-owner-0302");
    assert.equal(JSON.stringify(ev.rows[0]).includes(TEST_BEARER), false);
  });

  test("the kill switch is the screen cookie, and MCP cannot flip it", async () => {
    const names = (await client.listTools()).tools.map((t) => t.name);
    assert.equal(names.includes("answer_delegated"), true);
    assert.equal(names.some((n) => n !== "answer_delegated" && /delegat/i.test(n)), false);
    const missing = (await client.callTool({ name: "set_delegation", arguments: { enabled: false, actor: BOT, ...P } }).catch((e: Error) => e)) as { isError?: boolean; message?: string; content?: { text: string }[] };
    assert.ok(missing instanceof Error || missing.isError);

    const noCookie = await req("POST", "/api/delegation", { cookie: null, body: { enabled: false } });
    assert.equal(noCookie.status, 401);
    const bearerOnly = await req("POST", "/api/delegation", { cookie: null, body: { enabled: false }, headers: { Authorization: `Bearer ${TEST_BEARER}` } });
    assert.equal(bearerOnly.status, 403);
    const bearerAndCookie = await req("POST", "/api/delegation", { body: { enabled: false }, headers: { Authorization: `Bearer ${TEST_BEARER}` } });
    assert.equal(bearerAndCookie.status, 403);
    const bot = await req("POST", "/bot/v1/delegation", { cookie: null, body: { enabled: false }, headers: { Authorization: `Bearer ${TEST_BEARER}` } });
    assert.equal(bot.status, 404);
    const hook = await req("POST", "/hooks/delegation", { cookie: null, body: { enabled: false }, headers: { Authorization: `Bearer ${TEST_CI_TOKEN}` } });
    assert.equal(hook.status, 404);

    const g = await gate("Apagado");
    const off = await req("POST", "/api/delegation", { body: { enabled: false } });
    assert.equal(off.status, 200);
    assert.deepEqual(await off.json(), { enabled: false });
    const read = await req("GET", "/api/delegation");
    assert.deepEqual(await read.json(), { enabled: false });
    const refused = await call("answer_delegated", { question_id: g.id, option: "pursue", actor: BOT, ...evidence("msg-owner-0400", "esto no debe entrar") });
    assert.equal(refused.__error, "DELEGATION_OFF");
    assert.equal(refused.__status, 403);
    const untouched = await raw.query("select answer from questions where id = $1", [g.id]);
    assert.equal(untouched.rows[0].answer, null);
    // The tool cannot turn itself back on, whatever extra field it sends.
    const sneak = await call("answer_delegated", { question_id: g.id, option: "pursue", actor: BOT, enabled: true, ...evidence("msg-owner-0401", "enciende el interruptor") });
    assert.equal(sneak.__error, "DELEGATION_OFF");
    const flag = await raw.query("select value from machine_state where key = 'delegation'");
    assert.equal(flag.rows[0].value.enabled, false);

    const on = await req("POST", "/api/delegation", { body: { enabled: true } });
    assert.deepEqual(await on.json(), { enabled: true });
    const back = await call("answer_delegated", { question_id: g.id, option: "later", actor: BOT, ...evidence("msg-owner-0402", "dejala para despues") });
    assert.equal(back.__error, undefined, JSON.stringify(back));
    assert.equal(back.question.answer, "later");
  });

  test("ten an hour, and one row per question", async () => {
    await raw.query("update delegated_answers set created_at = now() - interval '2 hours'");
    const project = (await raw.query("select id from projects where slug = 'workia'")).rows[0].id;
    const holder = await call("create_task", { kind: "idea", title: "Cupo" });
    const taskId = (await raw.query("select id from tasks where key = $1", [holder.key])).rows[0].id;
    for (let i = 0; i < 10; i++) {
      const q = await raw.query(
        "insert into questions (project_id, task_id, question, options, human_only, asked_by) values ($1, $2, $3, '{a,b}', true, $4::jsonb) returning id",
        [project, taskId, `cupo ${i}`, JSON.stringify(A)],
      );
      await raw.query(
        "insert into delegated_answers (project_id, question_id, message_id, quote, actor) values ($1, $2, $3, $4, $5::jsonb)",
        [project, q.rows[0].id, `msg-hour-${i}00`, "cita de relleno ok", JSON.stringify(BOT)],
      );
    }
    const g = await gate("Cupo lleno");
    const full = await call("answer_delegated", { question_id: g.id, option: "pursue", actor: BOT, ...evidence("msg-owner-0500", "esta ya no cabe hoy") });
    assert.equal(full.__error, "DELEGATION_LIMIT");
    assert.equal(full.reason, "hour");
    assert.equal((await raw.query("select answer from questions where id = $1", [g.id])).rows[0].answer, null);

    await raw.query("update delegated_answers set created_at = now() - interval '2 hours' where message_id like 'msg-hour-%'");
    const room = await call("answer_delegated", { question_id: g.id, option: "pursue", actor: BOT, ...evidence("msg-owner-0501", "ahora si cabe esta") });
    assert.equal(room.__error, undefined, JSON.stringify(room));

    await raw.query("update questions set answer = null, answered_by = null, answered_at = null where id = $1", [g.id]);
    const twice = await call("answer_delegated", { question_id: g.id, option: "drop", actor: BOT, ...evidence("msg-owner-0502", "segunda vez no vale") });
    assert.equal(twice.__error, "DELEGATION_LIMIT");
    assert.equal(twice.reason, "question");
    assert.equal((await raw.query("select answer from questions where id = $1", [g.id])).rows[0].answer, null);
  });

  test("the screen answer route does not accept a delegated body", async () => {
    const g = await gate("Ruta");
    const res = await req("POST", `/api/projects/workia/questions/${g.id}/answer`, {
      body: { answer: "pursue", delegated_by_jorge: { message_id: MESSAGE, quote: QUOTE } },
    });
    assert.equal(res.status, 400);
    assert.equal(((await res.json()) as Json).error, "INVALID_BODY");
    assert.equal((await raw.query("select answer from questions where id = $1", [g.id])).rows[0].answer, null);
    assert.equal((await raw.query("select count(*)::int as n from delegated_answers where question_id = $1", [g.id])).rows[0].n, 0);
  });
});
