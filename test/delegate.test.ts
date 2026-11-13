// PLA-I15-2: plania-bot may record one answer the owner gave in his own chat.
// The screen click stays. The server cannot prove the caller or the message.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import pg from "pg";
import { onDevva, pgOnly, pgUrl, resetTestStore, TEST_BEARER, TEST_CI_TOKEN, TEST_DATABASE_URL, useTestEnv, type TestStore } from "./helpers.js";

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
let store: TestStore;
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

// A human_only question with named options: what answer_delegated may close (gates were removed in 2.17).
async function gate(title: string) {
  const idea = await call("create_task", { kind: "idea", title });
  const asked = await call("ask", { key: idea.key, question: `¿${title}?`, options: ["pursue", "drop", "later"], human_only: true });
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
    store = await resetTestStore();
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
    await store?.end();
  });

  test("migration 0029 applies twice", pgOnly("replays migration 0029 on a private database and reads the catalog"), async () => {
    // 0029's foreign key names the approval table. 0032 drops that table, so this runs on a
    // private copy that stops before 0029.
    const name = "plania_mig_0029";
    const adminUrl = pgUrl("postgres");
    const admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`drop database if exists ${name} with (force)`);
    await admin.query(`create database ${name}`);
    await admin.end();
    const db = new pg.Client({ connectionString: pgUrl(name) });
    await db.connect();
    try {
      const dir = path.resolve(import.meta.dirname, "../drizzle/migrations");
      for (const f of readdirSync(dir).filter((file) => file.endsWith(".sql") && file < "0029").sort()) {
        await db.query(readFileSync(path.join(dir, f), "utf8"));
      }
      const sql = readFileSync(path.join(dir, "0029_delegated_answers.sql"), "utf8");
      await db.query(sql);
      await db.query(sql);
      const tables = await db.query("select to_regclass('public.delegated_answers') as t");
      assert.equal(tables.rows[0].t, "delegated_answers");
      const idx = await db.query("select indexname from pg_indexes where tablename = 'delegated_answers' order by 1");
      assert.deepEqual(idx.rows.map((r) => r.indexname), [
        "delegated_answers_approval_unique",
        "delegated_answers_created_idx",
        "delegated_answers_pkey",
        "delegated_answers_question_unique",
      ]);
      const fk = await db.query("select 1 from pg_constraint where conname = 'delegated_answers_approval_id_approvals_id_fk'");
      assert.equal(fk.rows.length, 1);
    } finally {
      await db.end();
      const drop = new pg.Client({ connectionString: adminUrl });
      await drop.connect();
      await drop.query(`drop database if exists ${name} with (force)`);
      await drop.end();
    }
  });

  test("missing or short evidence is refused and stores nothing", async () => {
    const g = await gate("Evidencia");
    const before = await store.count("delegatedAnswers");
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
    const after = await store.count("delegatedAnswers");
    assert.equal(after, before);
    const open = await store.get("questions", { id: g.id });
    assert.equal(open!.answer, null);
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
    const still = await store.get("questions", { id: g.id });
    assert.equal(still!.answer, null);

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

  test("plania-bot with evidence closes the question as the owner and the audit lists it", async () => {
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
    const row = (await store.get("questions", { id: g.id }))!;
    assert.equal(row.answer, "pursue");
    assert.deepEqual(row.answeredBy, WEB_ACTOR);
    const evidenceRow = (await store.get("delegatedAnswers", { questionId: g.id }))!;
    assert.equal(evidenceRow.messageId, MESSAGE);
    assert.equal(evidenceRow.quote, QUOTE);
    assert.equal(evidenceRow.actor.agent, "plania-bot");
    assert.equal("token" in evidenceRow.actor, false);

    const events = (await store.find("events", { taskKey: g.key, type: ["question.answered", "gate.answered"] }, { orderBy: [{ column: "id" }] })).map((e) => ({
      type: e.type,
      actor: e.actor,
      payload: e.payload as Json,
      token_id: e.tokenId,
    }));
    assert.deepEqual(events.map((e) => e.type), ["question.answered"], "2.17 logs no gate event");
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
    const delegated = findings.filter((f) => f.code === "DELEGATED_ANSWER" && f.id === g.id);
    assert.equal(delegated.length, 1);
    assert.equal(delegated[0]!.level, "warn");
    assert.match(delegated[0]!.detail, /question delegated/);
    assert.match(delegated[0]!.detail, /sigue la compuerta/);
    assert.equal(findings.some((f) => f.code.startsWith("GATE_")), false, "2.17 emits no GATE_* finding");

    const again = await call("answer_delegated", { question_id: g.id, option: "drop", actor: BOT, ...evidence("msg-owner-0143", "otra instruccion distinta") });
    assert.equal(again.__error, "ALREADY_ANSWERED");

    const inbox = await call("get_inbox", { project: "workia" });
    const shown = inbox.delegated.find((d: Json) => d.quote === QUOTE);
    assert.ok(shown, JSON.stringify(inbox.delegated));
    assert.equal("gate" in shown, false);
    assert.equal(shown.key, g.key);

    const task = await call("get_task", { key: g.key });
    const q = task.questions.find((x: Json) => x.id === g.id);
    assert.equal(q.delegated.quote, QUOTE);
  });

  test("an open human_only question with options is in the inbox, and a screen click is not delegated", async () => {
    const project = await findProject(db, "workia");
    const findings = await auditProject(db, project);
    assert.equal(findings.some((f) => f.code.startsWith("GATE_")), false);

    const g = await gate("Clic");
    const inbox = await call("get_inbox", { project: "workia" });
    assert.equal(inbox.items.some((i: Json) => i.id === g.id), true);
    assert.equal(inbox.items.some((i: Json) => "gate" in i), false);
    const res = await req("POST", `/api/projects/workia/questions/${g.id}/answer`, { body: { answer: "drop" } });
    assert.equal(res.status, 200);
    const n = await store.count("delegatedAnswers", { questionId: g.id });
    assert.equal(n, 0);
    const after = await auditProject(db, project);
    assert.equal(after.some((f) => f.code === "DELEGATED_ANSWER" && f.id === g.id), false);
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
    const open = await store.get("questions", { id: human.question.id });
    assert.equal(open!.answer, null);

    const named = await call("ask", { key: ticket.key, question: "¿Tamaño?", options: ["chico", "grande"], human_only: true });
    const ok = await call("answer_delegated", { question_id: named.question.id, option: "grande", actor: BOT, ...evidence("msg-owner-0202", "el grande, por favor") });
    assert.equal(ok.__error, undefined, JSON.stringify(ok));
    assert.equal(ok.question.answer, "grande");
    assert.deepEqual(ok.question.answered_by, WEB_ACTOR);
  });

  test("an approval_id on answer_delegated is ignored, and Won't do is a direct logged move", async () => {
    const ignored = await call("answer_delegated", { approval_id: "00000000-0000-0000-0000-000000000000", decision: "grant", actor: BOT, ...evidence("msg-owner-0300", "esto ya no abre nada") });
    assert.equal(ignored.ignored, true);
    assert.match(ignored.hint, /ignored approval_id/);
    const ticket = await call("create_task", { title: "Cerrar", scope: "s", checks: ["c"] });
    const version = async () => (await call("get_task", { key: ticket.key })).version;
    const refused = await call("set_task", { key: ticket.key, status: "Won't do", version: await version(), reason: "ya no hace falta" });
    assert.equal(refused.__error, "HUMAN_ONLY");
    const closed = await call("set_task", {
      key: ticket.key,
      status: "Won't do",
      version: await version(),
      reason: "ya no hace falta",
      approval_id: "old-id",
      ...evidence("msg-owner-0301", "marcalo wont do ya"),
    });
    assert.equal(closed.status, "Won't do", JSON.stringify(closed));
    assert.match(closed.hint, /ignored approval_id/);
    const back = await call("set_task", {
      key: ticket.key,
      status: "Ready",
      version: await version(),
      reason: "volvemos",
      ...evidence("msg-owner-0302", "reabre ese ticket ahora"),
    });
    assert.equal(back.status, "Ready", JSON.stringify(back));
    const ev = (await store.find("events", { type: "task.delegated_move" }))
      .filter((e) => e.payload.message_id === "msg-owner-0302")
      .map((e) => ({ actor: e.actor, payload: e.payload as Json }));
    assert.equal(ev[0]!.payload.quote, "reabre ese ticket ahora");
    assert.equal(JSON.stringify(ev[0]).includes(TEST_BEARER), false);
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
    const untouched = await store.get("questions", { id: g.id });
    assert.equal(untouched!.answer, null);
    // The tool cannot turn itself back on, whatever extra field it sends.
    const sneak = await call("answer_delegated", { question_id: g.id, option: "pursue", actor: BOT, enabled: true, ...evidence("msg-owner-0401", "enciende el interruptor") });
    assert.equal(sneak.__error, "DELEGATION_OFF");
    const flag = await store.get("machineState", { key: "delegation" });
    assert.equal(flag!.value.enabled, false);

    const on = await req("POST", "/api/delegation", { body: { enabled: true } });
    assert.deepEqual(await on.json(), { enabled: true });
    const back = await call("answer_delegated", { question_id: g.id, option: "later", actor: BOT, ...evidence("msg-owner-0402", "dejala para despues") });
    assert.equal(back.__error, undefined, JSON.stringify(back));
    assert.equal(back.question.answer, "later");
  });

  test("ten an hour, and one row per question", async () => {
    await store.fix((uow) => uow.update("delegatedAnswers", {}, { createdAt: new Date(Date.now() - 2 * 3_600_000) }));
    const project = await store.projectId("workia");
    const holder = await call("create_task", { kind: "idea", title: "Cupo" });
    const taskId = (await store.get("tasks", { key: holder.key }))!.id;
    await store.fix(async (uow) => {
      for (let i = 0; i < 10; i++) {
        const q = await uow.insert("questions", { projectId: project, taskId, question: `cupo ${i}`, options: ["a", "b"], humanOnly: true, askedBy: A });
        await uow.insert("delegatedAnswers", { projectId: project, questionId: q.id, messageId: `msg-hour-${i}00`, quote: "cita de relleno ok", actor: BOT });
      }
    });
    const g = await gate("Cupo lleno");
    const full = await call("answer_delegated", { question_id: g.id, option: "pursue", actor: BOT, ...evidence("msg-owner-0500", "esta ya no cabe hoy") });
    assert.equal(full.__error, "DELEGATION_LIMIT");
    assert.equal(full.reason, "hour");
    assert.equal((await store.get("questions", { id: g.id }))!.answer, null);

    await store.fix(async (uow) => {
      const hour = (await uow.find("delegatedAnswers")).filter((d) => d.messageId.startsWith("msg-hour-"));
      for (const d of hour) await uow.update("delegatedAnswers", { id: d.id }, { createdAt: new Date(Date.now() - 2 * 3_600_000) });
    });
    const room = await call("answer_delegated", { question_id: g.id, option: "pursue", actor: BOT, ...evidence("msg-owner-0501", "ahora si cabe esta") });
    assert.equal(room.__error, undefined, JSON.stringify(room));

    await store.fix((uow) => uow.update("questions", { id: g.id }, { answer: null, answeredBy: null, answeredAt: null }));
    const twice = await call("answer_delegated", { question_id: g.id, option: "drop", actor: BOT, ...evidence("msg-owner-0502", "segunda vez no vale") });
    assert.equal(twice.__error, "DELEGATION_LIMIT");
    assert.equal(twice.reason, "question");
    assert.equal((await store.get("questions", { id: g.id }))!.answer, null);
  });

  test("the screen answer route does not accept a delegated body", async () => {
    const g = await gate("Ruta");
    const res = await req("POST", `/api/projects/workia/questions/${g.id}/answer`, {
      body: { answer: "pursue", delegated_by_jorge: { message_id: MESSAGE, quote: QUOTE } },
    });
    assert.equal(res.status, 400);
    assert.equal(((await res.json()) as Json).error, "INVALID_BODY");
    assert.equal((await store.get("questions", { id: g.id }))!.answer, null);
    assert.equal(await store.count("delegatedAnswers", { questionId: g.id }), 0);
  });

  test("PLA-06: migration 0031 applies twice; Visto is the screen cookie only; a seen answer leaves the Bandeja and the audit, the row stays", async () => {
    // Replaying the migration is Postgres's part; the rest of the test runs on both stores.
    if (!onDevva) {
      const sql = readFileSync(path.resolve(import.meta.dirname, "../drizzle/migrations/0031_delegated_reviewed.sql"), "utf8");
      const raw = new pg.Client({ connectionString: TEST_DATABASE_URL });
      await raw.connect();
      try {
        await raw.query(sql);
        await raw.query(sql);
      } finally {
        await raw.end();
      }
    }

    const g = await gate("Visto");
    const done = await call("answer_delegated", { question_id: g.id, option: "pursue", actor: BOT, ...evidence("msg-owner-0600", "sigue con esa idea ya") });
    assert.equal(done.__error, undefined, JSON.stringify(done));
    const id = (await store.get("delegatedAnswers", { questionId: g.id }))!.id;
    const listed = async () => ((await call("get_inbox", { project: "workia" })).delegated as Json[]).some((d) => d.id === id);
    const audited = async () => (await auditProject(db, await findProject(db, "workia"))).some((f) => f.code === "DELEGATED_ANSWER" && f.id === g.id);
    assert.equal(await listed(), true);
    assert.equal(await audited(), true);

    const noCookie = await req("POST", "/api/delegated/reviewed", { cookie: null, body: { ids: [id] } });
    assert.equal(noCookie.status, 401);
    const bearer = await req("POST", "/api/delegated/reviewed", { body: { ids: [id] }, headers: { Authorization: `Bearer ${TEST_BEARER}` } });
    assert.equal(bearer.status, 403);
    const bad = await req("POST", "/api/delegated/reviewed", { body: { all: true } });
    assert.equal(bad.status, 400);
    const names = (await client.listTools()).tools.map((t) => t.name);
    assert.equal(names.some((n) => /review|seen|visto/i.test(n)), false, "no MCP tool marks an answer seen");
    assert.equal(await listed(), true);

    const ok = await req("POST", "/api/delegated/reviewed", { body: { ids: [id] } });
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { reviewed: 1 });
    const again = await req("POST", "/api/delegated/reviewed", { body: { ids: [id] } });
    assert.deepEqual(await again.json(), { reviewed: 0 });
    assert.equal(await listed(), false);
    assert.equal(await audited(), false);
    const row = (await store.get("delegatedAnswers", { id }))!;
    assert.equal(row.quote, "sigue con esa idea ya");
    assert.ok(row.reviewedAt);
  });
});
