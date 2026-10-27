// PLA-I8-1: the idea kind, its key, the stage machine and the reads that must ignore it.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { userInfo } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import pg from "pg";
import type { Db } from "../src/db/client.js";
import { forwardBlock, GATE_OPTIONS, ideaWaitText, STAGE_DOCS } from "../src/mcp/ideas.js";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const { makeDb } = await import("../src/db/client.js");
const { createMcpServer } = await import("../src/mcp/register.js");
const { answer: answerQuestion } = await import("../src/mcp/questions.js");
const { createGateChallenge } = await import("../src/gate/challenge.js");
const { MemoryGateSecretStore, useGateStore } = await import("../src/gate/store.js");
const { gateClock, totp } = await import("../src/gate/totp.js");
const { webCtx } = await import("../src/mcp/tx.js");

// The stage machine answers gates. New gates are human_only, so those answers go through the screen
// path with a fixed RFC secret and a clock that steps forward, one TOTP window per answer.
const gateSecret = Buffer.from("12345678901234567890", "ascii");
const gateMem = new MemoryGateSecretStore();
useGateStore(gateMem);
let gateTick = 1_700_000_000_000;
let db: Db;

type Json = Record<string, any>;
const A = { agent: "test-agent", session_id: "s1", machine: "ci" };
const P = { project: "workia" };

let client: Client;
let raw: pg.Client;
let closeDb: () => Promise<void>;

async function call(name: string, args: Json = {}): Promise<Json> {
  const r = (await client.callTool({ name, arguments: { actor: A, ...P, ...args } })) as { isError?: boolean; content: { text: string }[] };
  const data = JSON.parse(r.content[0]!.text) as Json;
  return r.isError ? { __error: data.error, __status: data.status, ...data } : data;
}

async function answerGate(questionId: string, option: string) {
  gateTick += 31_000;
  const ch = await createGateChallenge(db, "workia", questionId, option, webCtx);
  const code = totp(gateSecret, gateTick);
  await answerQuestion(db, { project: "workia", question_id: questionId, answer: option, nonce: ch.nonce, code }, webCtx);
}

const migrationsDir = path.resolve(import.meta.dirname, "../drizzle/migrations");

const ideaDoc = { title: "Idea", markdown: "## Problem\n\n## Who it is for\n\n## Why now\n" };
const answered = (gate: string, answer: string, answeredAt: string) => ({ gate, question: "q", answered: true, answer, answeredAt });

test("only an advancing gate answer passes, and a step back makes it stale", () => {
  assert.equal(forwardBlock("idea", ideaDoc, [answered("A", "drop", "2026-01-02T00:00:00Z")])?.code, "GATE_NOT_PASSED");
  assert.equal(forwardBlock("idea", ideaDoc, [answered("A", "later", "2026-01-02T00:00:00Z")])?.code, "GATE_NOT_PASSED");
  assert.equal(forwardBlock("idea", ideaDoc, [answered("A", "pursue", "2026-01-02T00:00:00Z"), answered("A", "drop", "2026-01-03T00:00:00Z")])?.code, "GATE_NOT_PASSED");
  assert.equal(forwardBlock("idea", ideaDoc, [answered("A", "drop", "2026-01-02T00:00:00Z"), answered("A", "pursue", "2026-01-03T00:00:00Z")]), null);
  const since = new Date("2026-01-04T00:00:00Z");
  assert.equal(forwardBlock("idea", ideaDoc, [answered("A", "pursue", "2026-01-03T00:00:00Z")], since)?.code, "GATE_NOT_PASSED");
  assert.equal(forwardBlock("idea", ideaDoc, [answered("A", "pursue", "2026-01-03T00:00:00Z"), answered("A", "pursue", "2026-01-05T00:00:00Z")], since), null);

  const research = { title: "Research", markdown: "## What we learned\n\n## Options\n\n## Recommendation\n" };
  assert.equal(forwardBlock("research", research, [answered("B", "rework", "2026-01-02T00:00:00Z")])?.code, "GATE_NOT_PASSED");
  assert.equal(forwardBlock("research", research, [answered("B", "drop", "2026-01-02T00:00:00Z")])?.code, "GATE_NOT_PASSED");
  assert.equal(forwardBlock("research", research, [answered("B", "proceed", "2026-01-02T00:00:00Z")]), null);

  const plan = { title: "Plan", markdown: "## Steps\n\n## Done when\n\n## Risks\n" };
  assert.equal(forwardBlock("planning", plan, [answered("C", "rework", "2026-01-02T00:00:00Z")])?.code, "GATE_NOT_PASSED");
  assert.equal(forwardBlock("planning", plan, [answered("C", "drop", "2026-01-02T00:00:00Z")])?.code, "GATE_NOT_PASSED");
  assert.equal(forwardBlock("planning", plan, [answered("C", "ready", "2026-01-02T00:00:00Z")]), null);
});

test("idea wait text names the doc and the headings in Spanish", () => {
  assert.equal(ideaWaitText("research", [], []), "Doc Investigación");
  assert.equal(ideaWaitText("design", [], []), "Doc Diseño");
  assert.equal(ideaWaitText("planning", [], []), "Doc Plan");
  assert.equal(ideaWaitText("idea", [{ title: "Idea", markdown: "## Problem\n" }], []), "Para quién es, Por qué ahora");
  assert.equal(ideaWaitText("idea", [ideaDoc], [answered("A", "drop", "2026-01-02T00:00:00Z")]), "Puerta A");
  assert.equal(ideaWaitText("idea", [ideaDoc], [answered("A", "pursue", "2026-01-02T00:00:00Z")], new Date("2026-01-03T00:00:00Z")), "Puerta A");
  assert.equal(ideaWaitText("idea", [ideaDoc], [answered("A", "pursue", "2026-01-02T00:00:00Z")]), "Puede avanzar");
  assert.equal(ideaWaitText("ready", [], []), "Lista para promover");
});

test("migration 0026 leaves existing rows unchanged and is not 0025", async () => {
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  assert.equal(files.includes("0025_push_subscriptions.sql"), true);
  assert.equal(files.includes("0026_ideas.sql"), true);
  assert.equal(files.some((f) => f.startsWith("0025_") && f !== "0025_push_subscriptions.sql"), false);

  const name = "plania_mig_idea";
  const admin = new pg.Client({ connectionString: `postgres://${userInfo().username}@localhost:5432/postgres` });
  await admin.connect();
  await admin.query(`drop database if exists ${name} with (force)`);
  await admin.query(`create database ${name}`);
  await admin.end();

  const db = new pg.Client({ connectionString: `postgres://${userInfo().username}@localhost:5432/${name}` });
  await db.connect();
  try {
    for (const f of files.filter((f) => f < "0026")) {
      await db.query(readFileSync(path.join(migrationsDir, f), "utf8"));
    }
    const project = await db.query("insert into projects (slug, title, key_prefix) values ('old', 'Old', 'OLD') returning id");
    const projectId = project.rows[0].id as string;
    const task = await db.query(
      "insert into tasks (project_id, kind, key, title, status, summary) values ($1, 'ticket', 'OLD-01', 'Keep me', 'Backlog', 'unchanged') returning *",
      [projectId],
    );
    const beforeTask = task.rows[0];
    const question = await db.query(
      "insert into questions (project_id, task_id, question, asked_by) values ($1, $2, 'Still here?', $3::jsonb) returning *",
      [projectId, beforeTask.id, JSON.stringify(A)],
    );
    const beforeQuestion = question.rows[0];

    await db.query(readFileSync(path.join(migrationsDir, "0026_ideas.sql"), "utf8"));

    const afterTask = (await db.query("select * from tasks where id = $1", [beforeTask.id])).rows[0];
    const afterQuestion = (await db.query("select * from questions where id = $1", [beforeQuestion.id])).rows[0];
    assert.equal(afterTask.stage, null);
    assert.equal(afterTask.promoted_to, null);
    assert.equal(afterTask.kind, "ticket");
    assert.equal(afterTask.status, "Backlog");
    assert.equal(afterTask.title, "Keep me");
    assert.equal(afterTask.summary, "unchanged");
    assert.equal(afterTask.key, "OLD-01");
    assert.equal(afterQuestion.gate, null);
    assert.equal(afterQuestion.human_only, false);
    assert.equal(afterQuestion.question, "Still here?");
    assert.equal(afterQuestion.answer, null);

    const idea = await db.query(
      "insert into tasks (project_id, kind, key, title, status, stage) values ($1, 'idea', 'OLD-IDEA1', 'New', 'Open', 'idea') returning stage, promoted_to",
      [projectId],
    );
    assert.equal(idea.rows[0].stage, "idea");
    assert.equal(idea.rows[0].promoted_to, null);
    const still = (await db.query("select stage, promoted_to, status from tasks where key = 'OLD-01'")).rows[0];
    assert.deepEqual(still, { stage: null, promoted_to: null, status: "Backlog" });
  } finally {
    await db.end();
    const drop = new pg.Client({ connectionString: `postgres://${userInfo().username}@localhost:5432/postgres` });
    await drop.connect();
    await drop.query(`drop database if exists ${name} with (force)`);
    await drop.end();
  }
});

before(async () => {
  raw = await resetTestDb();
  const opened = makeDb();
  db = opened.db;
  closeDb = opened.close;
  await gateMem.set(gateSecret);
  gateClock.now = () => gateTick;
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createMcpServer(db).connect(serverSide);
  client = new Client({ name: "test", version: "0" });
  await client.connect(clientSide);
});

after(async () => {
  gateClock.now = () => Date.now();
  await client?.close();
  await closeDb?.();
  await raw?.end();
});

describe("ideas", () => {
  test("create_task kind idea assigns PREFIX-IDEA<n> and the reads that list work ignore it", async () => {
    const idea = await call("create_task", { kind: "idea", title: "Cobrar en la app", summary: "Una linea" });
    assert.equal(idea.__error, undefined);
    assert.equal(idea.key, "WRK-IDEA1");
    assert.equal(idea.kind, "idea");
    const full = await call("get_task", { key: "WRK-IDEA1" });
    assert.equal(full.stage, "idea");
    assert.equal(full.status, "Open");
    assert.equal(full.promoted_to, null);
    assert.equal((await call("create_task", { kind: "idea", title: "Otra" })).key, "WRK-IDEA2");

    const ticket = await call("create_task", { title: "Un ticket", scope: "s", checks: ["c"], status: "Ready" });
    assert.equal(ticket.key, "WRK-01");
    await call("create_task", { kind: "initiative", title: "Linea", scope: "PRD" });
    await call("create_task", { title: "Fase", scope: "s", checks: ["c"], parent_key: "WRK-I1", phase: 1, status: "Ready" });

    assert.equal((await call("get_next")).task.key, "WRK-01");
    const claimed = await call("claim", { key: "WRK-IDEA1" });
    assert.equal(claimed.__error, "NOT_CLAIMABLE");
    assert.equal(claimed.reason, "ideas are not claimed");
    const finished = await call("finish", { key: "WRK-IDEA1", result: { kind: "test", verdict: "pass", cite: "no" } });
    assert.equal(finished.__error, "INVALID_TRANSITION");

    const project = await call("get_project");
    assert.equal(project.counts.chartered, 2);
    assert.equal(project.counts.found, 0);
    assert.equal(project.next_keys.idea, "WRK-IDEA3");
    const listed = (await call("list_projects")).projects.find((p: Json) => p.slug === "workia");
    assert.equal(listed.counts.open, 2);
    assert.equal(listed.claims, 0);

    const resume = await call("get_resume");
    assert.equal(resume.next_claimable.key, "WRK-01");
    assert.equal(resume.claims.length, 0);
    assert.deepEqual(resume.initiatives.map((i: Json) => i.key), ["WRK-I1"]);
    assert.equal(resume.standalone.open, 1);
    assert.equal(resume.status.initiatives.some((i: Json) => String(i.key).includes("IDEA")), false);

    const ideas = (await call("list_tasks", { kind: "idea" })).tasks.map((t: Json) => t.key);
    assert.deepEqual(ideas, ["WRK-IDEA2", "WRK-IDEA1"]);
    const tickets = (await call("list_tasks", { kind: "ticket" })).tasks.map((t: Json) => t.key);
    assert.equal(tickets.some((k: string) => k.includes("IDEA")), false);

    await call("set_project", { version: project.version, settings: { release: { from: "sandbox", into: "main", env: "prod" } } });
    await raw.query("update tasks set status = 'Merged', pr_url = 'https://github.com/example/workia/pull/1' where key = 'WRK-01'");
    const release = (await call("get_project")).release;
    assert.deepEqual(release.tickets.map((t: Json) => t.key), ["WRK-01"]);
    await raw.query("update tasks set status = 'Ready', pr_url = null where key = 'WRK-01'");

    await raw.query("update tasks set branch = 'jl/only-idea' where key = 'WRK-IDEA1'");
    const context = await call("get_context", { workspace: { branch: "jl/only-idea" } });
    assert.equal(context.__error, undefined);
    assert.deepEqual(context.tickets.map((t: Json) => t.key), []);
    assert.equal(context.initiative, null);

    const audit = await call("audit");
    assert.equal(audit.findings.some((f: Json) => f.key === "WRK-IDEA1" && f.code === "TASK_MISSING_PR_URL"), false);

    assert.equal((await call("create_task", { kind: "idea", title: "No", priority: "P0" })).__error, "FIELD_NOT_ALLOWED");
    assert.equal((await call("create_task", { kind: "idea", title: "No", status: "Backlog" })).__error, "INVALID_STATUS");
    assert.equal((await call("set_task", { key: "WRK-01", stage: "research", version: ticket.version })).__error, "FIELD_NOT_ALLOWED");
  });

  test("the stage machine requires the doc, the headings and an answered gate", async () => {
    let version = (await call("get_task", { key: "WRK-IDEA1" })).version as number;
    const move = async (stage: string, extra: Json = {}) => {
      const r = await call("set_task", { key: "WRK-IDEA1", stage, version, ...extra });
      if (!r.__error) version = r.version;
      return r;
    };
    const put = async (from: keyof typeof STAGE_DOCS, headings = [...STAGE_DOCS[from].headings]) => {
      const doc = STAGE_DOCS[from];
      return call("attach_doc", { key: "WRK-IDEA1", title: doc.doc, markdown: headings.map((h) => `## ${h}\n\ntexto`).join("\n\n") });
    };

    const missing = await move("research");
    assert.equal(missing.__error, "STAGE_REQUIREMENTS_MISSING");
    assert.equal(missing.doc, "Idea");
    assert.deepEqual(missing.missing, ["doc"]);

    await put("idea", ["Problem", "Who it is for"]);
    const headings = await move("research");
    assert.equal(headings.__error, "STAGE_REQUIREMENTS_MISSING");
    assert.deepEqual(headings.missing, ["Why now"]);

    await call("attach_doc", {
      key: "WRK-IDEA1",
      title: "Idea",
      version: 1,
      markdown: ["Problem", "Who it is for", "Why now"].map((h) => `## ${h}\n\ntexto`).join("\n\n"),
    });
    const gate = await move("research");
    assert.equal(gate.__error, "GATE_NOT_PASSED");
    assert.equal(gate.gate, "A");

    const asked = await call("ask", { key: "WRK-IDEA1", gate: "A", question: "¿La seguimos?", options: ["nope"], human_only: true, verbose: true });
    assert.equal(asked.__error, undefined);
    assert.deepEqual(asked.question.options, [...GATE_OPTIONS.A]);
    assert.equal(asked.question.gate, "A");
    assert.equal(asked.question.human_only, true);
    assert.equal(asked.task.status, "Open", "an idea does not move to Needs Jorge");
    const second = await call("ask", { key: "WRK-IDEA1", gate: "B", question: "¿Otra puerta?" });
    assert.equal(second.__error, "GATE_OPEN");
    assert.equal(second.gate, "A");

    const inbox = await call("get_inbox");
    assert.equal(inbox.items.some((i: Json) => i.key === "WRK-IDEA1" && i.kind === "question"), true);
    const refused = await call("answer", { question_id: asked.question.id, answer: "drop" });
    assert.equal(refused.__error, "HUMAN_ONLY");
    assert.equal(refused.__status, 403);
    await answerGate(asked.question.id, "drop");
    assert.equal((await move("research")).__error, "GATE_NOT_PASSED", "drop does not pass gate A");
    const later = await call("ask", { key: "WRK-IDEA1", gate: "A", question: "¿Más tarde?" });
    assert.equal(later.question.human_only, true, "a gate is human_only even when the caller does not pass the flag");
    await answerGate(later.question.id, "later");
    assert.equal((await move("research")).__error, "GATE_NOT_PASSED", "later does not pass gate A");
    const pursue = await call("ask", { key: "WRK-IDEA1", gate: "A", question: "¿La seguimos ahora?" });
    await answerGate(pursue.question.id, "pursue");

    const forward = await move("research");
    assert.equal(forward.__error, undefined);
    assert.equal(forward.status, "Open");
    assert.equal((await call("get_task", { key: "WRK-IDEA1" })).stage, "research");

    const skip = await move("planning");
    assert.equal(skip.__error, "INVALID_STAGE_MOVE");
    assert.equal(skip.from, "research");
    assert.equal(skip.to, "planning");
    const backBare = await move("idea");
    assert.equal(backBare.__error, "INVALID_STAGE_MOVE");
    assert.match(String(backBare.hint), /note/);
    const back = await move("idea", { note: "falta un dato" });
    assert.equal(back.__error, undefined);
    assert.equal((await call("get_task", { key: "WRK-IDEA1" })).stage, "idea");
    assert.equal((await move("research")).__error, "GATE_NOT_PASSED", "a step back makes the previous pursue stale");
    const again = await call("ask", { key: "WRK-IDEA1", gate: "A", question: "¿Otra vez?" });
    await answerGate(again.question.id, "pursue");
    assert.equal((await move("research")).__error, undefined);

    assert.equal((await move("design")).__error, "STAGE_REQUIREMENTS_MISSING");
    await put("research");
    assert.equal((await move("design")).__error, "GATE_NOT_PASSED");
    const reworkB = await call("ask", { key: "WRK-IDEA1", gate: "B", question: "¿Rehacer?" });
    await answerGate(reworkB.question.id, "rework");
    assert.equal((await move("design")).__error, "GATE_NOT_PASSED", "rework does not pass gate B");
    const dropB = await call("ask", { key: "WRK-IDEA1", gate: "B", question: "¿Soltar?" });
    await answerGate(dropB.question.id, "drop");
    assert.equal((await move("design")).__error, "GATE_NOT_PASSED", "drop does not pass gate B");
    const gateB = await call("ask", { key: "WRK-IDEA1", gate: "B", question: "¿Este camino?" });
    await answerGate(gateB.question.id, "proceed");
    assert.equal((await move("design")).__error, undefined);

    assert.equal((await move("planning")).__error, "STAGE_REQUIREMENTS_MISSING");
    await put("design");
    assert.equal((await move("planning")).__error, undefined, "design has a doc and no gate");

    assert.equal((await move("ready")).__error, "STAGE_REQUIREMENTS_MISSING");
    await put("planning");
    assert.equal((await move("ready")).__error, "GATE_NOT_PASSED");
    const reworkC = await call("ask", { key: "WRK-IDEA1", gate: "C", question: "¿Rehacer el plan?" });
    await answerGate(reworkC.question.id, "rework");
    assert.equal((await move("ready")).__error, "GATE_NOT_PASSED", "rework does not pass gate C");
    const dropC = await call("ask", { key: "WRK-IDEA1", gate: "C", question: "¿Soltar el plan?" });
    await answerGate(dropC.question.id, "drop");
    assert.equal((await move("ready")).__error, "GATE_NOT_PASSED", "drop does not pass gate C");
    const gateC = await call("ask", { key: "WRK-IDEA1", gate: "C", question: "¿Lista?" });
    await answerGate(gateC.question.id, "ready");
    const ready = await move("ready");
    assert.equal(ready.__error, undefined);
    assert.equal((await call("get_task", { key: "WRK-IDEA1" })).stage, "ready");

    const self = await call("set_task", { key: "WRK-IDEA1", promoted_to: "WRK-IDEA1", version });
    assert.equal(self.__error, "PROMOTED_TO_INVALID");
    const phase = await call("set_task", { key: "WRK-IDEA1", promoted_to: "WRK-I1-1", version });
    assert.equal(phase.__error, "PROMOTED_TO_INVALID");
    const toInitiative = await call("set_task", { key: "WRK-IDEA1", promoted_to: "WRK-I1", version });
    assert.equal(toInitiative.__error, undefined);
    version = toInitiative.version;
    const toTicket = await call("set_task", { key: "WRK-IDEA1", promoted_to: "WRK-01", version });
    assert.equal(toTicket.__error, undefined);
    version = toTicket.version;
    const done = await call("set_task", { key: "WRK-IDEA1", status: "Done", version });
    assert.equal(done.__error, undefined);
    const closed = await call("get_task", { key: "WRK-IDEA1" });
    assert.equal(closed.status, "Done");
    assert.equal(closed.promoted_to, "WRK-01");
    assert.equal(closed.stage, "ready");

    const stageClosed = await call("set_task", { key: "WRK-IDEA1", stage: "planning", note: "atrás", version: done.version });
    assert.equal(stageClosed.__error, "IDEA_CLOSED");
    assert.equal(stageClosed.status, "Done");
    const promoClosed = await call("set_task", { key: "WRK-IDEA1", promoted_to: "WRK-I1", version: done.version });
    assert.equal(promoClosed.__error, "IDEA_CLOSED");
    assert.equal((await call("get_task", { key: "WRK-IDEA1" })).version, done.version, "a refused move does not bump the version");

    const open = await call("get_task", { key: "WRK-IDEA2" });
    const closeWith = await call("set_task", { key: "WRK-IDEA2", status: "Done", promoted_to: "WRK-01", version: open.version });
    assert.equal(closeWith.__error, undefined, "closing and recording promoted_to in one call still works while the idea is Open");
    assert.equal(closeWith.status, "Done");

    const fresh = await call("create_task", { kind: "idea", title: "No va" });
    await raw.query("update tasks set status = 'Won''t do' where key = $1", [fresh.key]);
    const wont = await call("get_task", { key: fresh.key });
    const wontStage = await call("set_task", { key: fresh.key, stage: "research", version: wont.version });
    assert.equal(wontStage.__error, "IDEA_CLOSED");
    assert.equal(wontStage.status, "Won't do");
    const wontPromo = await call("set_task", { key: fresh.key, promoted_to: "WRK-I1", version: wont.version });
    assert.equal(wontPromo.__error, "IDEA_CLOSED");
  });
});
