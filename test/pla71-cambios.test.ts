// PLA-71: a delivery the owner sent back carries his words into Taller's next prompt. In PLA-64 a fresh session saw
// only «ticket ready», took the work for unfinished, re-ran the checks and delivered the same muestra again.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const { makeDb } = await import("../src/db/client.js");
const { seedOrg } = await import("../scripts/seed-org.js");
const runner = await import("../src/runner/runner.js");

let raw: pg.Client;
let db: ReturnType<typeof makeDb>["db"];
let closeDb: () => Promise<void>;
let project: string;
const actor = JSON.stringify({ agent: "test", session_id: "s" });
const ev = (type: string, payload: object) =>
  raw.query(`insert into events (project_id, task_key, type, actor, payload) values ($1, 'PX-1', $2, $3, $4)`, [project, type, actor, JSON.stringify(payload)]);

before(async () => {
  raw = await resetTestDb();
  ({ db, close: closeDb } = makeDb());
  await seedOrg(db);
  project = (await raw.query(`select id from projects where slug = 'micasa'`)).rows[0].id as string;
});
after(async () => {
  await closeDb();
  await raw.end();
});

test("PLA-71 #1: the owner's note counts only when it is newer than the last delivery", async () => {
  assert.equal(await runner.ownerChangesOf(db, project, "PX-1"), null, "never sent back");
  await ev("task.status", { from: "In progress", to: "In review" });
  await ev("note", { text: "Cambios que pide el dueño: No se ve bien: abre una clienta para que se vea Seguimiento." });
  assert.equal(await runner.ownerChangesOf(db, project, "PX-1"), "No se ve bien: abre una clienta para que se vea Seguimiento.");
  await ev("note", { text: "Una nota cualquiera" });
  assert.equal(await runner.ownerChangesOf(db, project, "PX-1"), "No se ve bien: abre una clienta para que se vea Seguimiento.", "other notes do not hide it");
  await ev("task.status", { from: "In progress", to: "In review" });
  assert.equal(await runner.ownerChangesOf(db, project, "PX-1"), null, "answered by the next delivery");
});

test("PLA-71 #2: the prompt quotes his words and says to answer them, not just re-run the checks", () => {
  const base = { agent: "Taller", role: "taller", project: { slug: "micasa", title: "MiCasa" }, goal: null, task: { key: "PX-1", title: "Algo" }, workspace: null, sessionId: "run-1", reason: "ticket ready" };
  const p = runner.userPrompt({ ...base, changes: "abre una clienta" });
  assert.match(p, /The owner sent your last delivery of this ticket back\. Their words: «abre una clienta»/);
  assert.match(p, /re-running the checks alone does not answer them/);
  assert.doesNotMatch(runner.userPrompt(base), /sent your last delivery/);
});
