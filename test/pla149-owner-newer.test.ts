// PLA-149: an owner decision or note made while a later idea stage runs is not lost. A runner run that delivers its
// stage after the owner wrote on the idea (since the run started) gets his words back, the idea stays on its stage
// (set_task's forward move is IDEA_OWNER_NEWER) and the stage's agent is woken again with them. A delivery that
// starts after his words, and a caller that is not a runner run, go on as before. Throwaway DB, fake values only.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const { makeDb } = await import("../src/db/client.js");
const { seedOrg } = await import("../scripts/seed-org.js");
const writes = await import("../src/mcp/writes.js");
const { deliverStage } = await import("../src/mcp/stage-docs.js");
const { attachDoc } = await import("../src/mcp/docs.js");

type Json = Record<string, any>;
let raw: pg.Client;
let db: ReturnType<typeof makeDb>["db"];
let closeDb: () => Promise<void>;
const PROJECT = "micasa";
const ME = { actor: { agent: "test", session_id: "pla149" } };
const DESIGN = {
  approach: "Un recordatorio automático la víspera, configurado desde la ficha de la cita.",
  scope: ["Mensaje la víspera a las 18:00", "Interruptor por cita"],
  out_of_scope: ["Confirmar la cita desde el mensaje", "Avisos por correo"],
};
const DOCS: Record<string, [string, string]> = {
  idea: ["Idea", "# Idea\n## Problem\nx\n## Who it is for\ny\n## Why now\nz"],
  research: ["Research", "# R\n## What we learned\nx\n## Options\ny\n## Recommendation\nz"],
};

before(async () => {
  raw = await resetTestDb();
  const made = makeDb();
  db = made.db;
  closeDb = made.close;
  await seedOrg(made.db);
  await raw.query(`update projects set runs_paused = false where slug = $1`, [PROJECT]);
});
after(async () => {
  await closeDb?.();
  await raw?.end();
});

// A live Artist run on the idea that started `ago` seconds ago, and the actor its connection writes as.
async function artistRun(key: string, ago: number): Promise<{ id: string; actor: { agent: string; session_id: string } }> {
  const a = (await raw.query(`select a.id, p.id as pid from agents a, projects p where p.slug = $1 and a.role_template = 'artist' and (a.project_id = p.id or a.project_id is null) order by a.project_id nulls last limit 1`, [PROJECT])).rows[0];
  const id = (
    await raw.query(`insert into agent_runs (agent_id, project_id, role, status, summary, task_key, work_key, queued_at, started_at) values ($1, $2, 'artist', 'running', 'running', $4, $5, now() - make_interval(secs => $3), now() - make_interval(secs => $3)) returning id`, [a.id, a.pid, ago, key, `task:${key}`])
  ).rows[0].id as string;
  return { id, actor: { agent: "plania-runner", session_id: `run-${id.replace(/-/g, "").slice(0, 16)}` } };
}
async function designIdea(title: string): Promise<{ key: string; id: string; pid: string }> {
  const { key } = (await writes.createTask(db, { project: PROJECT, kind: "idea", title } as never, ME)) as { key: string };
  for (const [docTitle, markdown] of Object.values(DOCS)) await attachDoc(db, { project: PROJECT, key, title: docTitle, markdown }, ME);
  const row = (await raw.query(`update tasks set stage = 'design' where key = $1 returning id, project_id`, [key])).rows[0];
  return { key, id: row.id, pid: row.project_id };
}
// The owner's note on the idea, from the screen, `ago` seconds ago.
const ownerNote = (t: { id: string; pid: string; key: string }, text: string, ago: number) =>
  raw.query(`insert into events (project_id, task_id, task_key, type, actor, payload, created_at) values ($1, $2, $3, 'note', $4, $5, now() - make_interval(secs => $6))`, [t.pid, t.id, t.key, JSON.stringify({ agent: "owner", session_id: "web", machine: "screen" }), JSON.stringify({ text, kind: "answer" }), ago]);
const stageOf = async (key: string) => (await raw.query(`select stage from tasks where key = $1`, [key])).rows[0].stage as string;
const version = async (key: string) => (await raw.query(`select version from tasks where key = $1`, [key])).rows[0].version as number;

test("a run older than the owner's note delivers, but the idea stays and the agent is woken again with his words", async () => {
  const t = await designIdea("Recordatorio con decisión tardía");
  const run = await artistRun(t.key, 300);
  await ownerNote(t, "Mejor por WhatsApp, no por SMS", 60);
  const r = (await deliverStage(db, { project: PROJECT, key: t.key, stage: "design", data: DESIGN }, run as never)) as Json;
  assert.equal(r.next, undefined, "no hint to move it on");
  assert.ok(r.owner_newer, JSON.stringify(r));
  assert.deepEqual(r.owner_newer.words, ["Mejor por WhatsApp, no por SMS"]);
  assert.match(r.warning, /IDEA_OWNER_NEWER/);
  // The run is still live, so the wake joins it and is re-queued when it ends (runner.ts "events while you worked").
  const absorbed = (await raw.query(`select absorbed from agent_runs where id = $1`, [run.id])).rows[0].absorbed as string;
  assert.match(absorbed, /llegó después de que empezaste: revisa y vuelve a entregar/);
  assert.match(absorbed, /«Mejor por WhatsApp, no por SMS»/);
  await assert.rejects(
    writes.setTask(db, { project: PROJECT, key: t.key, stage: "planning", version: await version(t.key) } as never, run as never),
    (e: Json) => e.code === "IDEA_OWNER_NEWER" && e.detail.words[0] === "Mejor por WhatsApp, no por SMS",
  );
  assert.equal(await stageOf(t.key), "design", "the idea stays on design");

  // Once the run is over, a wake for the stage is a queued run of its own, carrying his words.
  await raw.query(`update agent_runs set status = 'ok', ended_at = now() where id = $1`, [run.id]);
  const again = (await deliverStage(db, { project: PROJECT, key: t.key, stage: "design", data: DESIGN }, run as never)) as Json;
  assert.equal(again.owner_newer.wake, "queued");
  const queued = (await raw.query(`select reason from agent_runs where task_key = $1 and status = 'queued'`, [t.key])).rows;
  assert.equal(queued.length, 1);
  assert.match(queued[0].reason, /«Mejor por WhatsApp, no por SMS»/);
});

test("a run that started after the owner's note delivers and moves on as today", async () => {
  const t = await designIdea("Recordatorio con decisión previa");
  await ownerNote(t, "Mejor por WhatsApp", 300);
  const run = await artistRun(t.key, 60);
  const r = (await deliverStage(db, { project: PROJECT, key: t.key, stage: "design", data: DESIGN }, run as never)) as Json;
  assert.equal(r.owner_newer, undefined);
  assert.match(r.next, /stage: "planning"/);
  await writes.setTask(db, { project: PROJECT, key: t.key, stage: "planning", version: await version(t.key) } as never, run as never);
  assert.equal(await stageOf(t.key), "planning");
});

test("a caller that is not a runner run is not held; an agent's own note does not count as the owner's", async () => {
  const t = await designIdea("Recordatorio desde una sesión");
  await ownerNote(t, "Mejor por WhatsApp", 1);
  const r = (await deliverStage(db, { project: PROJECT, key: t.key, stage: "design", data: DESIGN }, ME as never)) as Json;
  assert.equal(r.owner_newer, undefined);
  assert.match(r.next, /stage: "planning"/);

  const u = await designIdea("Recordatorio con nota de un agente");
  const run = await artistRun(u.key, 300);
  await raw.query(`insert into events (project_id, task_id, task_key, type, actor, payload) values ($1, $2, $3, 'note', $4, $5)`, [u.pid, u.id, u.key, JSON.stringify({ agent: "po", session_id: "s" }), JSON.stringify({ text: "nota del PO" })]);
  const s = (await deliverStage(db, { project: PROJECT, key: u.key, stage: "design", data: DESIGN }, run as never)) as Json;
  assert.equal(s.owner_newer, undefined);
});
