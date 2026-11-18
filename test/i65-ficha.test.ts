// PLA-I65 (Una sola ficha): one read for the thing's whole life. The idea read adds a short name, one line per stop
// (null when the stop has nothing) and the initiative it became; an initiative's key reads too, with or without an
// idea behind it. Throwaway DB, fake values only.
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
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
const docsMod = await import("../src/mcp/docs.js");
const { gistOf, shortOf } = await import("../src/api/company-idea.js");

type Json = Record<string, any>;
let raw: pg.Client;
let db: ReturnType<typeof makeDb>["db"];
let closeDb: () => Promise<void>;
const jorge = () => ({ Cookie: `${SESSION_COOKIE}=${createSession()}`, "Content-Type": "application/json" });
const post = (url: string, body: Json = {}) => app.request(url, { method: "POST", headers: jorge(), body: JSON.stringify(body) });
const get = async (url: string) => {
  const res = await app.request(url, { headers: jorge() });
  return { status: res.status, body: (await res.json()) as Json };
};
const read = async (key: string) => {
  const r = await get(`/api/company/projects/micasa/ideas/${key}`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body;
};
const versionOf = async (key: string) => (await raw.query(`select version from tasks where key = $1`, [key])).rows[0].version as number;
const PO = { actor: { agent: "po-micasa", session_id: "run-0000c0de" } };
const forma = async (text: string) => {
  const res = await post("/api/company/projects/micasa/ask", { text, mode: "forma" });
  assert.equal(res.status, 201, await res.clone().text());
  return ((await res.json()) as Json).key as string;
};
async function toLista(key: string) {
  const docs: [string, string, string][] = [
    ["Idea", "## Problem\nx\n## Who it is for\ny\n## Why now\nz\n## Tamaño\nMediano.", "research"],
    ["Research", "## What we learned\nx\n## Options\n1. **Una página.** Más espacio.\n2. **Lista con acciones.** Un menú por fila.\n## Recommendation\nLa opción 2, con el formulario arriba.", "design"],
    ["Design", "## Approach\nx\n## Scope\ny\n## Out of scope\nz", "planning"],
    ["Plan", "## Steps\n1. Ruta y permiso\n2. Lista de cuentas\n3. Crear una cuenta\n## Done when\ny\n## Risks\nz", "ready"],
  ];
  await writes.setTask(db, { project: "micasa", key, note: "Entendí: una pantalla de usuarios para la dueña." } as never, PO);
  for (const [title, markdown, to] of docs) {
    await docsMod.attachDoc(db, { project: "micasa", key, title, markdown }, PO);
    await writes.setTask(db, { project: "micasa", key, stage: to, version: await versionOf(key) } as never, PO);
  }
}
async function initiative(title: string, steps: string[]) {
  const ini = (await writes.createTask(db, { project: "micasa", kind: "initiative", title, scope: "s" } as never, PO)) as Json;
  const keys: string[] = [];
  for (const [i, s] of steps.entries()) keys.push(((await writes.createTask(db, { project: "micasa", parent_key: ini.key, phase: i + 1, title: s, scope: "s", checks: ["c"], status: i === 0 ? "Ready" : "Backlog" } as never, PO)) as Json).key);
  return { key: ini.key as string, steps: keys };
}

before(async () => {
  raw = await resetTestDb();
  ({ db, close: closeDb } = makeDb());
  await seedOrg(db);
});
beforeEach(async () => {
  await raw.query(`delete from agent_runs`);
  await raw.query(`update runner_settings set company_paused = false`);
  await raw.query(`update projects set runs_paused = (slug <> 'micasa')`);
});
after(async () => {
  await closeDb?.();
  await raw?.end();
});

test("I65-1: an idea not promoted reads its short name, a line per delivered stop and no built", async () => {
  const key = await forma("Una pantalla de usuarios en el panel para ver, crear y desactivar cuentas sin la terminal");
  let d = await read(key);
  assert.equal(d.kind, "idea");
  assert.equal(d.built, null);
  assert.ok(d.short.length > 0 && d.short.length <= 80, d.short);
  assert.deepEqual(Object.keys(d.gist), ["buzon", "entendido", "investigacion", "diseno", "plan", "lista"]);
  assert.ok(d.gist.buzon, "his words");
  for (const s of ["entendido", "investigacion", "diseno", "plan", "lista"]) assert.equal(d.gist[s], null, s);
  await toLista(key);
  d = await read(key);
  assert.equal(d.gist.entendido, "una pantalla de usuarios para la dueña.");
  assert.equal(d.understood_text, "una pantalla de usuarios para la dueña.", "the whole line");
  assert.equal(d.gist.investigacion, "Recomienda: Lista con acciones");
  assert.equal(d.gist.plan, "3 pasos · mediano");
  assert.equal(d.gist.lista, "Lista para construir");
  // Artist wrote the Design doc but uploaded no frames: the stop says nothing, never the doc's title.
  assert.equal(d.gist.diseno, null);
  assert.notEqual(d.gist.diseno, "Design");
});

test("I65-1: a promoted idea carries its initiative's steps; the initiative's key reads the same idea", async () => {
  const key = await forma("Cobro con terminal desde la cita");
  await toLista(key);
  const ini = await initiative("Cobro con terminal", ["Botón Cobrar", "Recibo por correo", "Pruebas"]);
  assert.equal((await post(`/api/company/projects/micasa/pedidos/${key}/construir`)).status, 200);
  await writes.setTask(db, { project: "micasa", key, promoted_to: ini.key, version: await versionOf(key) } as never, PO);
  await raw.query(`update tasks set status = 'Merged' where key = $1`, [ini.steps[0]]);
  const [{ id: tid, project_id }] = (await raw.query(`select id, project_id from tasks where key = $1`, [ini.steps[0]])).rows;
  await raw.query(`insert into pull_requests (project_id, repo, number, url, title, task_id, state) values ($1, 'o/r', 44, 'https://example.test/pr/44', 't', $2, 'merged')`, [project_id, tid]);
  const d = await read(key);
  assert.equal(d.kind, "idea");
  assert.equal(d.built.key, ini.key);
  assert.equal(d.built.total, 3);
  assert.equal(d.built.done, 1);
  assert.deepEqual(d.built.steps.map((s: Json) => s.title), ["Botón Cobrar", "Recibo por correo", "Pruebas"]);
  assert.deepEqual(d.built.steps[0].pr, { number: 44, state: "merged", url: "https://example.test/pr/44" });
  assert.ok(d.built.steps.every((s: Json) => typeof s.etapa === "string"), JSON.stringify(d.built.steps));
  assert.equal(d.built.published_at, null);
  assert.equal(d.gist.lista, `Es ${ini.key} en el tablero`);
  const viaInit = await read(ini.key);
  assert.equal(viaInit.kind, "initiative");
  assert.equal(viaInit.key, key, "the idea behind it answers");
  assert.equal(viaInit.built.key, ini.key);
  assert.deepEqual(viaInit.stops.map((s: Json) => s.state), d.stops.map((s: Json) => s.state));
  // Published once every step is released.
  await raw.query(`update tasks set status = 'Released', resolved_at = '2026-11-17T21:00:00Z' where key = any($1)`, [ini.steps]);
  assert.equal((await read(key)).built.published_at, "2026-11-17T21:00:00.000Z");
});

test("I65-1: an initiative with no idea reads with empty stops and its built", async () => {
  const ini = await initiative("Limpieza de datos", ["Borrar duplicados", "Revisión"]);
  const d = await read(ini.key);
  assert.equal(d.kind, "initiative");
  assert.equal(d.key, ini.key);
  assert.equal(d.short, "Limpieza de datos");
  assert.ok(d.stops.every((s: Json) => !s.delivered), "nothing delivered on the stops");
  assert.ok(Object.values(d.gist).every((g) => g === null));
  assert.equal(d.built.total, 2);
  assert.equal(d.built.steps[0].title, "Borrar duplicados");
  // A ticket is not an idea nor an initiative.
  assert.equal((await get(`/api/company/projects/micasa/ideas/${ini.steps[0]}`)).status, 404);
  // Writes stay with ideas.
  assert.equal((await post(`/api/company/projects/micasa/ideas/${ini.key}/despertar`)).status, 404);
});

test("I65-1: shortOf and gistOf", () => {
  assert.equal(shortOf("Usuarios en el panel", "x"), "Usuarios en el panel");
  assert.equal(shortOf("", "Agrega en el panel una pantalla de usuarios para ver las cuentas y crear una"), "Agrega en el panel una pantalla de…");
  const stops = ["buzon", "entendido", "investigacion", "diseno", "plan", "lista"].map((stop) => ({ stop, delivered: stop !== "plan" })) as never;
  const g = gistOf({
    text: "Algo",
    understood: "Entendí: algo bien",
    understood_text: null,
    research: { recommendation: null, options: [{ n: 1, title: "A", text: "" }], unknown: [], recommended: null, learned: [] },
    frames: [{}, {}] as never,
    plan_steps: ["uno"],
    ficha: { problema: null, tamano: null, solucion: null, riesgos: null, fuera: null },
    stage: "design",
    promoted_to: null,
    stops,
  });
  assert.equal(g.entendido, "algo bien");
  assert.equal(g.investigacion, "Recomienda: A");
  assert.equal(g.diseno, "2 marcos de Artist");
  assert.equal(g.plan, null, "the plan stop has not delivered");
  assert.equal(g.lista, null);
});
