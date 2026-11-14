// PLA-I40-3: the route in GET /api/company. A project's open initiatives are its legs; the one the plan stands on
// carries its tickets as named steps. Throwaway DB, fake values only.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type pg from "pg";
import { resetTestDb, useOwnerCode, useTestEnv } from "./helpers.js";

useTestEnv();
await useOwnerCode();
process.env.PLANIA_HOME_PROJECT = "zigzag";
process.env.PLANIA_PROMPTS_PROJECT = "micasa";
const { makeDb } = await import("../src/db/client.js");
const { app } = await import("../src/app.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const { seedOrg } = await import("../scripts/seed-org.js");
const writes = await import("../src/mcp/writes.js");

type Json = Record<string, any>;
let raw: pg.Client;
let db: ReturnType<typeof makeDb>["db"];
let closeDb: () => Promise<void>;
const jorge = () => ({ Cookie: `${SESSION_COOKIE}=${createSession()}`, "Content-Type": "application/json" });
const card = async (slug: string): Promise<Json> => {
  const res = await app.request("/api/company", { headers: jorge() });
  assert.equal(res.status, 200);
  return ((await res.json()) as Json).projects.find((p: Json) => p.slug === slug) as Json;
};
const PO = { actor: { agent: "po-micasa", session_id: "s-po" } };
const make = (input: Json) => writes.createTask(db, { project: "micasa", scope: "s", ...input } as never, PO);
const set = (key: string, status: string) => raw.query(`update tasks set status = $2, status_changed_at = now() where key = $1`, [key, status]);
const states = (leg: Json) => leg.steps.map((s: Json) => s.state);

before(async () => {
  raw = await resetTestDb();
  ({ db, close: closeDb } = makeDb());
  await seedOrg(db);
  await raw.query(`update projects set runs_paused = false`);
  const legs: [string, string, string[]][] = [
    ["MIC-I1", "Arranque", ["Repo", "Base de datos", "Kickoff", "Receta", "Hosting y dominio"]],
    ["MIC-I2", "Formulario", ["Opciones", "Pantalla", "Guardar", "Protección", "Revisión"]],
    ["MIC-I3", "Panel administrativo", ["Acceso privado", "Listado de novias", "Ficha de la novia", "Revisión del panel"]],
    ["MIC-I4", "Contacto y avisos", []],
    ["MIC-I5", "Ajustes y entrega", []],
  ];
  for (const [key, title, steps] of legs) {
    await make({ kind: "initiative", key, title });
    for (const [i, step] of steps.entries()) {
      await make({ key: `${key}-${i + 1}`, parent_key: key, phase: i + 1, title: step, checks: ["c"], status: "Ready", blocked_by: i > 0 ? [`${key}-${i}`] : [] });
    }
  }
  await raw.query(`update tasks set status = 'Active' where key in ('MIC-I1', 'MIC-I2', 'MIC-I3')`);
  for (const n of [1, 2, 3, 4]) await set(`MIC-I1-${n}`, "Done");
  await set("MIC-I1-5", "Backlog");
  for (const n of [1, 2, 3, 4]) await set(`MIC-I2-${n}`, "Merged");
  await set("MIC-I2-5", "Done");
  await set("MIC-I3-1", "Merged");
  await set("MIC-I3-2", "Merged");
  await raw.query(
    `insert into events (project_id, type, actor, payload) select id, 'release.shipped', '{"agent":"plania","session_id":"system"}', '{"tickets":["MIC-I3-1","MIC-I3-2"]}' from projects where slug = 'micasa'`,
  );
});

after(async () => {
  await closeDb?.();
  await raw?.end();
});

test("I40-3 #1: five initiatives read as five legs with their counts, states and the step that was put off", async () => {
  const { route } = await card("micasa");
  assert.deepEqual(
    route.legs.map((l: Json) => [l.title, l.done, l.total, l.state, l.note]),
    [
      ["Arranque", 4, 5, "planned", "Pospuesto: Hosting y dominio"],
      ["Formulario", 5, 5, "done", null],
      ["Panel administrativo", 2, 4, "here", null],
      ["Contacto y avisos", 0, 0, "unplanned", null],
      ["Ajustes y entrega", 0, 0, "unplanned", null],
    ],
  );
  assert.equal(route.more_legs, 0);
  // PLA-I46-14: the leg whose only open steps were put off says so as a flag, so the floor draws it striped.
  assert.deepEqual(route.legs.map((l: Json) => l.postponed), [true, false, false, false, false]);
  assert.deepEqual(route.legs.filter((l: Json) => l.steps).map((l: Json) => l.key), ["MIC-I3"], "only the leg we stand on carries steps");
});

test("I40-3 #3: the leg we stand on counts what the plan counts", async () => {
  const c = await card("micasa");
  const here = c.route.legs.find((l: Json) => l.state === "here");
  assert.deepEqual([here.key, here.done, here.total], [c.plan.initiative.key, c.plan.done, c.plan.total]);
});

test("I40-3 #2: steps are published, delivered, working, next and later as the tickets move", async () => {
  const here = async () => (await card("micasa")).route.legs.find((l: Json) => l.state === "here") as Json;
  let leg = await here();
  assert.deepEqual(leg.steps.map((s: Json) => s.title), ["Acceso privado", "Listado de novias", "Ficha de la novia", "Revisión del panel"]);
  assert.deepEqual(states(leg), ["published", "published", "next", "later"]);
  assert.deepEqual(leg.steps.map((s: Json) => s.who), ["taller", "taller", "taller", "taller"]);
  assert.ok(leg.steps[0].at, "when it changed");

  await set("MIC-I3-3", "In progress");
  assert.deepEqual(states(await here()), ["published", "published", "working", "later"]);

  await set("MIC-I3-3", "In review");
  assert.deepEqual(states(await here()), ["published", "published", "delivered", "later"], "the step after a delivery is not next until it lands");

  await set("MIC-I3-3", "Merged");
  leg = await here();
  assert.deepEqual(states(leg), ["published", "published", "done", "next"], "accepted, not in a release yet");
  assert.deepEqual([leg.done, leg.total], [3, 4]);

  await set("MIC-I3-3", "Released");
  assert.deepEqual(states(await here())[2], "published");
});

test("I40-3: a project with no open initiative has no route; more than eight legs keep the current one in view", async () => {
  assert.equal((await card("workia")).route, null);
  for (let i = 6; i <= 11; i++) await make({ kind: "initiative", key: `MIC-I${i}`, title: `Después ${i}` });
  const { route } = await card("micasa");
  assert.equal(route.legs.length, 8);
  assert.equal(route.more_legs, 3);
  assert.ok(route.legs.some((l: Json) => l.state === "here"));
});
