// PLA-I18-1: gates were removed. ask with gate is refused, ideas and promoted initiatives move
// without one, and old gate rows stay readable. Human-only questions are still a screen click.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { resetTestStore, TEST_BEARER, useTestEnv, type TestStore } from "./helpers.js";

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
let store: TestStore;
let cookie: string;

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
    store = await resetTestStore();
    cookie = `${SESSION_COOKIE}=${createSession()}`;
    const db = makeDb().db;
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await createMcpServer(db).connect(serverSide);
    client = new Client({ name: "test", version: "0" });
    await client.connect(clientSide);
  });

  after(async () => {
    await client?.close();
    await store?.end();
  });

  test("a question that is not a gate is still answered by an agent", async () => {
    const ticket = await call("create_task", { title: "Color", scope: "s", checks: ["c"] });
    assert.equal(ticket.__error, undefined);
    const asked = await call("ask", { key: ticket.key, question: "¿Color?", options: ["azul"] });
    assert.equal(asked.question.human_only, false);
    assert.equal("gate" in asked.question, false);
    const answered = await call("answer", { question_id: asked.question.id, answer: "azul" });
    assert.equal(answered.__error, undefined);
    const row = (await store.get("questions", { id: asked.question.id }))!;
    assert.equal(row.answer, "azul");
    assert.equal(row.answeredBy!.agent, "test-agent");
  });

  test("ask ignores the removed field, stores the question, and returns a hint", async () => {
    const idea = await call("create_task", { kind: "idea", title: "Puerta" });
    const ticket = await call("create_task", { title: "Con puerta", scope: "s", checks: ["c"] });
    for (const [key, mark] of [[idea.key, "A"], [idea.key, "C"], [ticket.key, "B"], [idea.key, "Z"]] as const) {
      const stored = await call("ask", { key, gate: mark, question: `¿La seguimos? ${mark}` });
      assert.equal(stored.__error, undefined, `${key} ${mark} ${JSON.stringify(stored)}`);
      assert.match(String(stored.hint), /obsolete field/);
      assert.equal("gate" in stored.question, false);
      const row = (await store.get("questions", { id: stored.question.id }))!;
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
    const still = (await store.get("questions", { id: asked.question.id }))!;
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

    const open = (await store.get("questions", { id }))!;
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
    await store.fix((uow) => uow.update("tasks", { key: idea.key }, { stage: "ready", promotedTo: initiative.key }));
    await store.fix((uow) => uow.update("tasks", { key: legacyIdea.key }, { stage: "planning", promotedTo: legacyInit.key }));

    const active = await setStatus(initiative.key, "Active");
    assert.equal(active.__error, undefined, JSON.stringify(active));
    assert.equal(active.status, "Active");
    const parked = await setStatus(initiative.key, "On hold");
    assert.equal(parked.__error, undefined);
    assert.equal((await setStatus(initiative.key, "Active")).status, "Active", "On hold → Active needs nothing either");

    // Rows written before 2.17: an agent answer and an open gate C, both on the idea.
    const legacy = (await store.get("tasks", { projectId: await store.projectId("workia"), key: legacyIdea.key }))!;
    const ids = { project_id: legacy.projectId, task_id: legacy.id };
    const inserted = await store.fix(async (uow) => {
      // Two rows written one after the other: the first is a moment older, as two statements would leave them.
      const earlier = new Date(uow.now.getTime() - 1);
      await uow.insert("questions", {
        projectId: ids.project_id,
        taskId: ids.task_id,
        question: "Respuesta de agente",
        options: ["ready", "rework", "drop"],
        humanOnly: false,
        askedBy: A,
        askedAt: earlier,
        answer: "rework",
        answeredBy: A,
        answeredAt: earlier,
      });
      return uow.insert("questions", {
        projectId: ids.project_id,
        taskId: ids.task_id,
        question: "Fila anterior",
        options: ["ready", "rework", "drop"],
        humanOnly: true,
        askedBy: A,
      });
    });
    const legacyActive = await setStatus(legacyInit.key, "Active");
    assert.equal(legacyActive.__error, undefined, JSON.stringify(legacyActive));
    assert.equal(legacyActive.status, "Active");

    const history = (await call("get_task", { key: legacyIdea.key })).questions as Json[];
    assert.deepEqual(history.map((q) => q.question), ["Respuesta de agente", "Fila anterior"]);
    assert.equal(history.every((q) => !("gate" in q)), true);

    // The open human_only row is still the owner's to close on the screen; it moves nothing and logs no old event.
    const legacyId = inserted.id;
    assert.equal((await call("answer", { question_id: legacyId, answer: "ready" })).__error, "HUMAN_ONLY");
    const onScreen = await answerScreen(legacyId, "cerrada");
    assert.equal(onScreen.status, 200, JSON.stringify(onScreen.body));
    const gateEvents = await store.find("events", { taskKey: legacyIdea.key, type: "gate.answered" });
    assert.equal(gateEvents.length, 0);
    assert.equal((await call("get_task", { key: legacyIdea.key })).stage, "planning");
  });
});
