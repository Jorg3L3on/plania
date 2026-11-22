// PLA-I74-5: the board reads each step's turn, so «Taller trabaja» never shows without a live run; the watchdog heals a
// step nobody's for over two minutes once (turn.healed), and raises an owner card when the heal did not take.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import type pg from "pg";
import * as React from "react";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
(globalThis as Record<string, unknown>).React = React;
const { makeDb } = await import("../src/db/client.js");
const { seedOrg } = await import("../scripts/seed-org.js");
const writes = await import("../src/mcp/writes.js");
const { findProject } = await import("../src/mcp/queries.js");
const { projectEtapas } = await import("../src/api/etapa.js");
const { sweepTurns, resetTurnWatchForTests } = await import("../src/jobs/turns.js");
const { runSession } = await import("../src/runner/run-session.js");
const { isWorking, tonoOf } = (await import(new URL("../ui/src/lib/cosas.ts", import.meta.url).href)) as Record<string, any>;

const A = { actor: { agent: "test-agent", session_id: "s-turns" } };
const ON = { PLANIA_JOBS: "1" } as NodeJS.ProcessEnv;
const MIN = 60_000;
let raw: pg.Client;
let db: ReturnType<typeof makeDb>["db"];
let closeDb: () => Promise<void>;
let pid = "";
let taller = "";

const ticket = async (title: string) => ((await writes.createTask(db, { project: "micasa", title, scope: "s", checks: ["c"], status: "Ready" } as never, A)) as { key: string }).key;
const turnOfKey = async (key: string, now = new Date()) => (await projectEtapas(db, await findProject(db, "micasa"), now)).byTicket.get(key)!;
// A Taller run that claimed the step and ended (ok) without freeing it: the PLA-167 hold.
async function heldByEndedRun(key: string, runStatus = "ok"): Promise<string> {
  const id = randomUUID();
  await raw.query(
    `insert into agent_runs (id, agent_id, project_id, role, status, summary, task_key, work_key, trigger, started_at, ended_at)
     values ($1, $2, $3, 'taller', $4, 'listo', $5, 'task:' || $5, 'event', now() - interval '5 minutes', ${runStatus === "running" ? "null" : "now() - interval '1 minute'"})`,
    [id, taller, pid, runStatus, key],
  );
  await raw.query(
    `update tasks set status = 'In progress', owner = $2::jsonb, claimed_at = now() - interval '5 minutes', lease_until = now() + interval '25 minutes' where key = $1`,
    [key, JSON.stringify({ agent: "taller-micasa", session_id: runSession(id) })],
  );
  return id;
}

before(async () => {
  raw = await resetTestDb();
  ({ db, close: closeDb } = makeDb());
  await seedOrg(db);
  await raw.query(`update projects set runs_paused = true`);
  pid = (await raw.query(`update projects set runs_paused = false where slug = 'micasa' returning id`)).rows[0].id;
  taller = (await raw.query(`select id from agents where slug = 'taller-micasa'`)).rows[0].id;
});

beforeEach(async () => {
  resetTurnWatchForTests();
  await raw.query(`delete from agent_runs`);
  await raw.query(`delete from questions`);
  await raw.query(`update tasks set status = 'Won''t do', owner = null, claimed_at = null, lease_until = null where project_id = $1 and kind = 'ticket'`, [pid]);
});

after(async () => {
  await closeDb?.();
  await raw?.end();
});

test("a step an ended run still holds is not worked: no live stage, nobody's turn, and the board does not say it is worked", async () => {
  const key = await ticket("Paso que nadie suelta");
  await heldByEndedRun(key);
  const row = await turnOfKey(key);
  assert.equal(row.etapa.etapa, "sin_dueno");
  assert.equal(row.etapa.live, false);
  assert.equal(row.turn?.turn, "nobody");
  assert.equal(row.turn?.turn === "nobody" && row.turn.why, "held_by_ended_run");
  assert.equal(isWorking(row), false);
  assert.notEqual(tonoOf(row, false), "vivo");
  // Before the turn, a stale etapa.live alone read as worked; with the turn it does not.
  assert.equal(isWorking({ ...row, etapa: { ...row.etapa, live: true } }), false);
});

test("with a live run the same step is the agent's: working, and the board says so", async () => {
  const key = await ticket("Paso en obra");
  await heldByEndedRun(key, "running");
  const row = await turnOfKey(key);
  assert.equal(row.turn?.turn, "agent_working");
  assert.equal(row.etapa.live, true);
  assert.equal(tonoOf(row, false), "vivo");
});

test("the watchdog waits two minutes, heals once (release + wake, turn.healed), then raises one owner card", async () => {
  const key = await ticket("Paso atorado");
  await heldByEndedRun(key);
  const t0 = new Date();

  let s = await sweepTurns(db, t0, ON);
  assert.equal(s.nobody, 1);
  assert.equal(s.healed, 0, "not before two minutes");

  s = await sweepTurns(db, new Date(t0.getTime() + 3 * MIN), ON);
  assert.equal(s.healed, 1);
  const healed = (await raw.query(`select payload from events where type = 'turn.healed' and task_key = $1`, [key])).rows;
  assert.equal(healed.length, 1);
  assert.equal(healed[0].payload.reason, "held_by_ended_run");
  assert.equal(healed[0].payload.heal, "release+wake");
  assert.equal(healed[0].payload.released, true);
  assert.equal(healed[0].payload.woke, true);
  const t = (await raw.query(`select status, owner from tasks where key = $1`, [key])).rows[0];
  assert.deepEqual([t.status, t.owner], ["Ready", null]);
  const queued = (await raw.query(`select status, task_key from agent_runs where status = 'queued'`)).rows;
  assert.deepEqual(queued, [{ status: "queued", task_key: key }]);
  assert.equal((await turnOfKey(key)).turn?.turn, "agent_queued", "healed: a run is queued for it");

  // The woken run never comes (dropped): the step is nobody's again. No second heal inside the window.
  await raw.query(`delete from agent_runs where status = 'queued'`);
  s = await sweepTurns(db, new Date(t0.getTime() + 4 * MIN), ON);
  s = await sweepTurns(db, new Date(t0.getTime() + 7 * MIN), ON);
  assert.equal(s.healed, 0);
  assert.equal(s.cards, 1);
  assert.equal((await raw.query(`select count(*)::int as n from events where type = 'turn.healed' and task_key = $1`, [key])).rows[0].n, 1);
  const q = (await raw.query(`select q.question, q.human_only from questions q join tasks t on t.id = q.task_id where t.key = $1`, [key])).rows;
  assert.equal(q.length, 1);
  assert.equal(q[0].human_only, true);
  assert.match(q[0].question, /^Nadie mueve «Paso atorado»: estaba listo y nadie lo tomó\. Plania despertó a .+ y el paso sigue quieto\./);
  assert.doesNotMatch(q[0].question, /MIC-|[A-Z]{2,}-\d/, "no ticket key in the owner's words");
  assert.equal((await raw.query(`select status from tasks where key = $1`, [key])).rows[0].status, "Needs owner");
  assert.equal((await turnOfKey(key)).turn?.turn, "owner");

  s = await sweepTurns(db, new Date(t0.getTime() + 12 * MIN), ON);
  assert.deepEqual([s.healed, s.cards], [0, 0], "the owner's turn now: nothing more");
});

test("a step with a live run, a queued run or an owner's question is never healed", async () => {
  const working = await ticket("En obra");
  await heldByEndedRun(working, "running");
  const asked = await ticket("Con pregunta");
  await raw.query(`insert into questions (project_id, task_id, question, asked_by) select project_id, id, '¿Cuál?', '{"agent":"po","session_id":"s"}'::jsonb from tasks where key = $1`, [asked]);
  const t0 = new Date();
  await sweepTurns(db, t0, ON);
  const s = await sweepTurns(db, new Date(t0.getTime() + 5 * MIN), ON);
  assert.equal(s.healed, 0);
  assert.equal((await raw.query(`select count(*)::int as n from events where type = 'turn.healed' and task_key in ($1, $2)`, [working, asked])).rows[0].n, 0);
});

test("with wakes off the watchdog does nothing", async () => {
  const key = await ticket("Sin despertar");
  const t0 = new Date();
  await sweepTurns(db, t0, {});
  const s = await sweepTurns(db, new Date(t0.getTime() + 5 * MIN), {});
  assert.deepEqual(s, { projects: 0, items: 0, nobody: 0, healed: 0, cards: 0 });
  assert.equal((await raw.query(`select count(*)::int as n from events where type = 'turn.healed' and task_key = $1`, [key])).rows[0].n, 0);
});
