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
import { forwardBlock, ideaWaitText, STAGE_DOCS } from "../src/mcp/ideas.js";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const { makeDb } = await import("../src/db/client.js");
const { createMcpServer } = await import("../src/mcp/register.js");
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

const migrationsDir = path.resolve(import.meta.dirname, "../drizzle/migrations");

const ideaDoc = { title: "Idea", markdown: "## Problem\n\n## Who it is for\n\n## Why now\n" };
const research = { title: "Research", markdown: "## What we learned\n\n## Options\n\n## Recommendation\n" };
const plan = { title: "Plan", markdown: "## Steps\n\n## Done when\n\n## Risks\n" };

// PLA-I18: the doc and its headings are all a forward move needs. No answer, of any kind, is read.
test("a forward move needs only the stage doc and its headings", () => {
  assert.equal(forwardBlock("idea", ideaDoc), null);
  assert.equal(forwardBlock("research", research), null);
  assert.equal(forwardBlock("design", { title: "Design", markdown: "## Approach\n## Scope\n## Out of scope\n" }), null);
  assert.equal(forwardBlock("planning", plan), null);
  assert.deepEqual(forwardBlock("idea", undefined), { code: "STAGE_REQUIREMENTS_MISSING", doc: "Idea", missing: ["doc"] });
  assert.deepEqual(forwardBlock("planning", { title: "Plan", markdown: "## Steps\n" })?.missing, ["Done when", "Risks"]);
  assert.equal(forwardBlock("ready", undefined), null);
});

test("idea wait text names the doc and the headings in Spanish", () => {
  assert.equal(ideaWaitText("research", [], []), "Doc Investigación");
  assert.equal(ideaWaitText("design", [], []), "Doc Diseño");
  assert.equal(ideaWaitText("planning", [], []), "Doc Plan");
  assert.equal(ideaWaitText("idea", [{ title: "Idea", markdown: "## Problem\n" }], []), "Para quién es, Por qué ahora");
  assert.equal(ideaWaitText("idea", [ideaDoc], []), "Puede avanzar", "no gate answer is needed");
  assert.equal(ideaWaitText("idea", [ideaDoc], [{ question: "¿Para quién?", answered: false }]), "¿Para quién?");
  assert.equal(ideaWaitText("idea", [ideaDoc], [{ question: "¿Para quién?", answered: true }]), "Puede avanzar");
  assert.doesNotMatch(ideaWaitText("idea", [ideaDoc], [{ question: "¿La seguimos?", answered: false }]), /Puerta/);
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
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createMcpServer(db).connect(serverSide);
  client = new Client({ name: "test", version: "0" });
  await client.connect(clientSide);
});

after(async () => {
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

  test("the stage machine requires the doc and its headings, and nothing else", async () => {
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
    const forward = await move("research");
    assert.equal(forward.__error, undefined, "no gate answer is asked for");
    assert.equal(forward.status, "Open");
    assert.equal((await call("get_task", { key: "WRK-IDEA1" })).stage, "research");

    const kept = await call("ask", { key: "WRK-IDEA1", gate: "A", question: "¿La seguimos?" });
    assert.equal(kept.__error, undefined, JSON.stringify(kept));
    assert.match(String(kept.hint), /obsolete field/);
    assert.equal((await call("get_task", { key: "WRK-IDEA1" })).questions.length, 1, "the removed field is ignored and the question is stored");

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
    assert.equal((await move("research")).__error, undefined, "a step back asks nothing again");

    assert.equal((await move("design")).__error, "STAGE_REQUIREMENTS_MISSING");
    await put("research");
    assert.equal((await move("design")).__error, undefined);

    assert.equal((await move("planning")).__error, "STAGE_REQUIREMENTS_MISSING");
    await put("design");
    assert.equal((await move("planning")).__error, undefined);

    assert.equal((await move("ready")).__error, "STAGE_REQUIREMENTS_MISSING");
    await put("planning");
    const ready = await move("ready");
    assert.equal(ready.__error, undefined);
    assert.equal((await call("get_task", { key: "WRK-IDEA1" })).stage, "ready");
    assert.equal((await call("get_task", { key: "WRK-IDEA1" })).questions.length, 1, "idea → ready does not need a question, and the ignored field did not block it");

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
