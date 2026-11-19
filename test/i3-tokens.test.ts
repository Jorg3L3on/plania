// PLA-I3-1: the tokens of each step and each initiative, from the runner's measured agent_runs.
//   1. per-ticket and per-initiative sums over two initiatives, input + output as the figure, the cache apart
//   2. a run keyed general or consulta:<id> is in no ticket's sum, even one that names a ticket
//   3. an initiative promoted from an idea includes the idea's runs (and its own key's runs)
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const { makeDb } = await import("../src/db/client.js");
const { createTask } = await import("../src/mcp/writes.js");
const { findProject } = await import("../src/mcp/queries.js");
const { projectEtapas, projectTokens, tableroOf } = await import("../src/api/etapa.js");

let raw: pg.Client;
let db: ReturnType<typeof makeDb>["db"];
let closeDb: () => Promise<void>;
let projectId: string;
let agentId: string;
const ctx = { actor: { agent: "t", session_id: "s1", machine: "ci" } };

// One finished run: input, output, cache read, cache write. workKey defaults to the runner's task:<KEY>.
async function run(taskKey: string | null, [i, o, cr, cw]: [number, number, number, number], workKey = taskKey ? `task:${taskKey}` : "general", status = "ok") {
  await raw.query(
    `insert into agent_runs (agent_id, project_id, task_key, role, status, input_tokens, output_tokens, cache_read_tokens, cache_create_tokens, tokens_total, work_key, lane, started_at, ended_at)
     values ($1, $2, $3, 'taller', $4, $5, $6, $7, $8, $5::bigint + $6::bigint + $7::bigint + $8::bigint, $9, $10, now(), now())`,
    [agentId, projectId, taskKey, status, i, o, cr, cw, workKey, workKey.startsWith("consulta:") ? "consulta" : "work"],
  );
}

before(async () => {
  raw = await resetTestDb();
  ({ db, close: closeDb } = makeDb());
  const p = await findProject(db, "micasa");
  projectId = p.id;
  agentId = (await raw.query(`insert into agents (slug, name, role, kind) values ('taller-t', 'Taller', 'taller', 'bot') returning id`)).rows[0].id;
  await createTask(db, { project: "micasa", kind: "initiative", title: "Contacto", scope: "s" }, ctx); // MIC-I1
  await createTask(db, { project: "micasa", kind: "initiative", title: "Pagos", scope: "s" }, ctx); // MIC-I2
  for (const title of ["Enlaces", "Excel"]) await createTask(db, { project: "micasa", title, scope: "s", checks: ["c"], parent_key: "MIC-I1", status: "Ready" }, ctx);
  for (const title of ["Tarjeta", "Recibo"]) await createTask(db, { project: "micasa", title, scope: "s", checks: ["c"], parent_key: "MIC-I2", status: "Ready" }, ctx);
  await createTask(db, { project: "micasa", kind: "idea", title: "Cobrar en la app", scope: "s" }, ctx);
  await raw.query(`update tasks set promoted_to = 'MIC-I2' where project_id = $1 and kind = 'idea'`, [projectId]);
  await raw.query(`update tasks set status = 'Active' where project_id = $1 and kind = 'initiative'`, [projectId]);

  await run("MIC-I1-1", [100, 50, 1000, 200]);
  await run("MIC-I1-1", [10, 5, 300, 0], undefined, "fail"); // a failed run still spent its tokens
  await run("MIC-I1-2", [7, 3, 0, 40]);
  await run("MIC-I2-1", [1, 2, 3, 4]);
  // MIC-I2-2 has no run.
});

after(async () => {
  await closeDb?.();
  await raw?.end();
});

const ideaKey = async () => (await raw.query(`select key from tasks where project_id = $1 and kind = 'idea'`, [projectId])).rows[0].key as string;
const board = async () => {
  const p = await findProject(db, "micasa");
  const e = await projectEtapas(db, p);
  return { e, init: (k: string) => tableroOf(e).initiatives.find((i) => i.key === k)! };
};

test("PLA-I3-1 #1: per-ticket and per-initiative sums, input + output as the figure, cache apart", async () => {
  const { e, init } = await board();
  assert.deepEqual(e.byTicket.get("MIC-I1-1")!.tokens, { used: 165, cache_read: 1300, cache_write: 200, runs: 2 });
  assert.deepEqual(e.byTicket.get("MIC-I1-2")!.tokens, { used: 10, cache_read: 0, cache_write: 40, runs: 1 });
  assert.deepEqual(e.byTicket.get("MIC-I2-1")!.tokens, { used: 3, cache_read: 3, cache_write: 4, runs: 1 });
  assert.deepEqual(e.byTicket.get("MIC-I2-2")!.tokens, { used: 0, cache_read: 0, cache_write: 0, runs: 0 });
  assert.deepEqual(init("MIC-I1").tokens, { used: 175, cache_read: 1300, cache_write: 240, runs: 3 });
  assert.deepEqual(init("MIC-I2").tokens, { used: 3, cache_read: 3, cache_write: 4, runs: 1 });
  // The same objects ride in the board the /api/company read serves (tableroOf).
  assert.deepEqual(init("MIC-I1").tickets.map((t) => t.tokens.used), [165, 10]);
});

test("PLA-I3-1 #2: a run keyed general or consulta:<id> is in no ticket's sum", async () => {
  const before = await projectTokens(db, projectId);
  await run(null, [1000, 1000, 1000, 1000]); // general, no task_key
  await run("MIC-I1-1", [2000, 2000, 2000, 2000], "general"); // general with a stray task_key
  await run("MIC-I1-1", [3000, 3000, 3000, 3000], "consulta:00000000-0000-0000-0000-000000000001"); // a question about the ticket
  await run("MIC-I1", [4000, 4000, 4000, 4000], "consulta:00000000-0000-0000-0000-000000000002");
  const afterRuns = await projectTokens(db, projectId);
  assert.deepEqual([...afterRuns.entries()].sort(), [...before.entries()].sort());
  const { e, init } = await board();
  assert.equal(e.byTicket.get("MIC-I1-1")!.tokens.used, 165);
  assert.equal(init("MIC-I1").tokens.used, 175);
});

test("PLA-I3-1 #3: an initiative promoted from an idea includes the idea's runs and its own key's", async () => {
  const idea = await ideaKey();
  await run(idea, [20, 30, 500, 60]); // the PO's research and design on the idea
  await run("MIC-I2", [4, 6, 0, 0]); // a run on the initiative's own key
  const { init } = await board();
  assert.deepEqual(init("MIC-I2").tokens, { used: 63, cache_read: 503, cache_write: 64, runs: 3 });
  // The other initiative is untouched.
  assert.deepEqual(init("MIC-I1").tokens, { used: 175, cache_read: 1300, cache_write: 240, runs: 3 });
});

test("PLA-I3-1: a run keyed by a former key (alias) counts toward the ticket", async () => {
  const t = (await raw.query(`select id from tasks where project_id = $1 and key = 'MIC-I2-2'`, [projectId])).rows[0].id;
  await raw.query(`insert into task_aliases (project_id, alias, task_id) values ($1, 'MIC-OLD-9', $2)`, [projectId, t]);
  await run("MIC-OLD-9", [5, 5, 1, 1]);
  const { e } = await board();
  assert.deepEqual(e.byTicket.get("MIC-I2-2")!.tokens, { used: 10, cache_read: 1, cache_write: 1, runs: 1 });
});
