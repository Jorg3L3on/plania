// Inicio's main goal (components/goals/goals-board.tsx MetaPrincipal): its initiatives as segments and its share done,
// checked against what list_goals really returns for a goal with initiatives in every status and a sub-goal.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { resetTestDb, useTestEnv } from "./helpers.js";
import { porcentaje, segmentosMeta } from "../ui/src/lib/metas-linea.js";

useTestEnv();
const { makeDb } = await import("../src/db/client.js");
const { listGoals } = await import("../src/mcp/goals.js");
const { INITIATIVE_STATUSES } = await import("../src/db/schema.js");

let raw: import("pg").Client;
let db: ReturnType<typeof makeDb>["db"];
let closeDb: () => Promise<void>;

before(async () => {
  raw = await resetTestDb();
  const opened = makeDb();
  db = opened.db;
  closeDb = opened.close;
});
after(async () => {
  await closeDb?.();
  await raw?.end();
});

test("every initiative status the server allows has its segment, and only Won't do is left out", () => {
  const como = (status: string) => segmentosMeta({ initiatives: [{ key: "X", status }] });
  assert.deepEqual(
    Object.fromEntries(INITIATIVE_STATUSES.map((s) => [s, como(s)[0] ?? null])),
    { Planning: "porEmpezar", Active: "enCurso", Shipping: "enCurso", Done: "hecha", "On hold": "porEmpezar", "Won't do": null },
  );
});

test("the segments and the share of a real goal: one per initiative, its sub-goal's included, done first", async () => {
  const q = (text: string, values: unknown[] = []) => raw.query<{ id: string }>(text, values);
  const project = (await q("select id from projects limit 1")).rows[0]!.id;
  const meta = (await q("insert into goals (title, why, position) values ('Primera entrega', 'Que alguien pague', 0) returning id")).rows[0]!.id;
  const sub = (await q("insert into goals (title, project_id, parent_id) values ('Sub', $1, $2) returning id", [project, meta])).rows[0]!.id;
  const ini = async (key: string, status: string, goal: string) =>
    (await q("insert into tasks (project_id, kind, key, title, status, goal_id) values ($1, 'initiative', $2, $2, $3, $4) returning id", [project, key, status, goal])).rows[0]!.id;
  const ticket = (key: string, status: string, parent: string) => q("insert into tasks (project_id, kind, key, title, status, parent_id) values ($1, 'ticket', $2, $2, $3, $4)", [project, key, status, parent]);

  const hecha = await ini("SEG-I1", "Done", meta);
  const activa = await ini("SEG-I2", "Active", meta);
  await ini("SEG-I3", "Shipping", meta);
  await ini("SEG-I4", "Planning", meta);
  await ini("SEG-I5", "On hold", meta);
  const descartada = await ini("SEG-I6", "Won't do", meta);
  const deSub = await ini("SEG-I7", "Active", sub);
  await ticket("SEG-I1-1", "Done", hecha);
  await ticket("SEG-I1-2", "Done", hecha);
  await ticket("SEG-I2-1", "Done", activa);
  await ticket("SEG-I2-2", "Ready", activa);
  await ticket("SEG-I7-1", "In progress", deSub);
  // Dropped work counts nowhere: a Won't do ticket, and the tickets of the Won't do initiative (even a Done one).
  await ticket("SEG-I2-3", "Won't do", activa);
  await ticket("SEG-I6-1", "Ready", descartada);
  await ticket("SEG-I6-2", "Done", descartada);

  const { goals } = await listGoals(db);
  const g = goals.find((x) => x.id === meta)!;
  // 7 initiatives linked (6 on the goal, 1 on its sub-goal), Won't do left out: 6 segments.
  assert.deepEqual(segmentosMeta(g), ["hecha", "enCurso", "enCurso", "enCurso", "porEmpezar", "porEmpezar"]);
  // The share is the server's roll-up, sub-goal included: 3 Done of 5 tickets, the dropped ones in neither.
  assert.deepEqual(g.progress, { done: 3, total: 5 });
  assert.equal(porcentaje(g.progress.done, g.progress.total), 60);
});
