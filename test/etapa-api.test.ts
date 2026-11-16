// PLA-I53-2: the stage served by both reads. GET /api/projects/:slug puts etapa on every ticket, GET /api/company
// returns every open initiative with its tickets' etapa (tablero), and both carry the same ahora. Throwaway DB,
// fake values only.
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
const get = async (path: string): Promise<Json> => {
  const res = await app.request(path, { headers: jorge() });
  assert.equal(res.status, 200);
  return (await res.json()) as Json;
};
const ctx = { actor: { agent: "po-micasa", session_id: "s-po" } };
const make = (input: Json) => writes.createTask(db, { project: "micasa", scope: "s", checks: ["c"], status: "Ready", ...input } as never, ctx as never) as Promise<{ key: string }>;
const idOf = async (key: string) => (await raw.query(`select id from tasks where key = $1`, [key])).rows[0].id as string;
const K: Record<string, string> = {};

before(async () => {
  raw = await resetTestDb();
  ({ db, close: closeDb } = makeDb());
  await seedOrg(db);
  await raw.query(`update projects set runs_paused = false`);
  const project = (await raw.query(`select id from projects where slug = 'micasa'`)).rows[0].id as string;
  const taller = (await raw.query(`select id from agents where slug = 'taller-micasa'`)).rows[0].id as string;

  const leg = await writes.createTask(db, { project: "micasa", kind: "initiative", title: "Tramo en curso", scope: "PRD" } as never, ctx as never);
  const later = await writes.createTask(db, { project: "micasa", kind: "initiative", title: "Tramo siguiente", scope: "PRD" } as never, ctx as never);
  await raw.query(`update tasks set status = 'Active' where key = $1`, [leg.key]);
  K.leg = leg.key;
  K.later = later.key;
  for (const [name, title] of [
    ["lease", "Pantalla con reserva viva"],
    ["run", "Servidor con un paso corriendo"],
    ["expired", "Reserva vencida"],
    ["qafail", "QA la devolvió"],
    ["qarun", "QA la prueba ahora"],
    ["ready", "Lista para empezar"],
    ["backlog", "Puesto para después"],
    ["done", "Ya hecho"],
  ] as const) K[name] = (await make({ title, parent_key: leg.key })).key;
  K.next = (await make({ title: "Del tramo siguiente", parent_key: later.key })).key;
  K.loose = (await make({ title: "Suelto" })).key;

  const lease = JSON.stringify({ agent: "taller-micasa", session_id: "s-lease" });
  await raw.query(`update tasks set status = 'In progress', owner = $2, claimed_at = now() - interval '4 minutes', lease_until = now() + interval '20 minutes' where key = $1`, [K.lease, lease]);
  await raw.query(`update tasks set status = 'In progress' where key = $1`, [K.run]);
  await raw.query(`insert into agent_runs (agent_id, project_id, role, status, task_key, started_at) values ($1, $2, 'taller', 'running', $3, now() - interval '3 minutes')`, [taller, project, K.run]);
  await raw.query(`update tasks set status = 'In progress', owner = $2, claimed_at = now() - interval '2 hours', lease_until = now() - interval '1 hour' where key = $1`, [K.expired, lease]);
  await raw.query(`update tasks set status = 'In review' where key in ($1, $2)`, [K.qafail, K.qarun]);
  await raw.query(`insert into qa_lanes (project_id, task_id, task_key, status, attempt, commit, ended_at) values ($1, $2, $3, 'fail', 1, 'abc1234', now() - interval '1 minute')`, [project, await idOf(K.qafail!), K.qafail]);
  await raw.query(`insert into qa_lanes (project_id, task_id, task_key, status, attempt, commit, started_at) values ($1, $2, $3, 'checking', 1, 'abc1234', now() - interval '2 minutes')`, [project, await idOf(K.qarun!), K.qarun]);
  await raw.query(`update tasks set status = 'Backlog' where key = $1`, [K.backlog]);
  await raw.query(`update tasks set status = 'Done' where key = $1`, [K.done]);
});

after(async () => {
  await closeDb?.();
  await raw?.end();
});

const EXPECTED: Record<string, string> = {
  lease: "construyendo",
  run: "construyendo",
  expired: "sin_dueno",
  qafail: "devuelto",
  qarun: "en_qa",
  ready: "lista",
  backlog: "pospuesto",
  done: "hecho",
  next: "lista",
  loose: "lista",
};

test("I53-2 #2: GET /api/projects/:slug carries etapa on every ticket, null on initiatives", async () => {
  const page = await get("/api/projects/micasa");
  const by = new Map((page.tasks as Json[]).map((t) => [t.key, t]));
  for (const [name, etapa] of Object.entries(EXPECTED)) assert.equal(by.get(K[name]!)?.etapa?.etapa, etapa, name);
  for (const t of page.tasks as Json[]) {
    if (t.kind === "ticket") assert.ok(t.etapa && typeof t.etapa.etapa === "string", t.key);
    else assert.equal(t.etapa, null, t.key);
  }
  const lease = by.get(K.lease!)!.etapa;
  assert.deepEqual(lease.holder, { agent: "taller-micasa", role: "taller" });
  assert.equal(lease.live, true);
  assert.equal(by.get(K.qarun!)!.etapa.qa, "running");
  assert.equal(by.get(K.expired!)!.etapa.holder, null);
  // The old fields stay.
  assert.ok("claimed_by" in by.get(K.lease!)!);
});

test("I53-2 #2: GET /api/company returns every open initiative with its tickets' etapa; route is untouched", async () => {
  const card = ((await get("/api/company")).projects as Json[]).find((p) => p.slug === "micasa")!;
  assert.ok(card.route, "route stays until F3 lands");
  const rows = card.tablero.initiatives as Json[];
  assert.deepEqual(rows.map((i) => i.key), [K.leg, K.later]);
  const leg = rows[0]!;
  assert.equal(leg.status, "Active");
  assert.deepEqual([leg.done, leg.total], [1, 8]);
  const by = new Map([...rows.flatMap((i) => i.tickets as Json[]), ...(card.tablero.loose as Json[])].map((t) => [t.key, t]));
  for (const [name, etapa] of Object.entries(EXPECTED)) assert.equal(by.get(K[name]!)?.etapa.etapa, etapa, name);
  assert.equal(rows[1]!.tickets[0].key, K.next);
  assert.deepEqual((card.tablero.loose as Json[]).map((t) => t.key), [K.loose]);
  assert.equal(by.get(K.next!)!.parent_key, K.later);
});

test("I53-2 #3: ahora lists exactly construyendo, en_qa running and devuelto, the same on both reads", async () => {
  const card = ((await get("/api/company")).projects as Json[]).find((p) => p.slug === "micasa")!;
  const page = await get("/api/projects/micasa");
  const keys = (a: Json[]) => a.map((x) => x.key).sort();
  assert.deepEqual(keys(card.ahora), [K.lease, K.run, K.qafail, K.qarun].sort());
  assert.deepEqual(card.ahora, page.ahora);
  const run = (card.ahora as Json[]).find((x) => x.key === K.run)!;
  assert.equal(run.etapa, "construyendo");
  assert.deepEqual(run.holder, { agent: "taller-micasa", role: "taller" });
  assert.equal(run.live, true);
  assert.ok(Date.parse(run.since) < Date.now());
  const lease = (card.ahora as Json[]).find((x) => x.key === K.lease)!;
  assert.equal(lease.live, true);
  assert.equal(lease.initiative, K.leg);
  assert.equal((card.ahora as Json[]).find((x) => x.key === K.qafail)!.etapa, "devuelto");
  assert.equal((card.ahora as Json[]).some((x) => x.key === K.expired), false);
});
