// PLA-I53-6: what the reads serve for the zone tag and the board's two data gaps. Every ticket carries zonas (from its
// areas) wherever etapa is served; the tablero gains the completed initiatives (done_initiatives, newest first, no
// tickets) and the newest landed loose ticket's title (loose_done_title). Throwaway DB, fake values only.
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
const K: Record<string, string> = {};

before(async () => {
  raw = await resetTestDb();
  ({ db, close: closeDb } = makeDb());
  await seedOrg(db);
  const leg = await writes.createTask(db, { project: "micasa", kind: "initiative", title: "Tramo abierto", scope: "PRD" } as never, ctx as never);
  const old = await writes.createTask(db, { project: "micasa", kind: "initiative", title: "Tramo viejo", scope: "PRD" } as never, ctx as never);
  const newer = await writes.createTask(db, { project: "micasa", kind: "initiative", title: "Tramo reciente", scope: "PRD" } as never, ctx as never);
  K.leg = leg.key;
  K.old = old.key;
  K.newer = newer.key;
  await raw.query(`update tasks set status = 'Active' where key = $1`, [leg.key]);
  await raw.query(`update tasks set status = 'Done', resolved_at = now() - interval '9 days' where key = $1`, [old.key]);
  await raw.query(`update tasks set status = 'Done', resolved_at = now() - interval '2 days' where key = $1`, [newer.key]);
  K.ui = (await make({ title: "Solo pantalla", parent_key: leg.key })).key;
  K.api = (await make({ title: "Solo servidor", parent_key: leg.key })).key;
  K.db = (await make({ title: "Solo datos", parent_key: leg.key })).key;
  K.mixed = (await make({ title: "Pantalla y servidor", parent_key: leg.key })).key;
  K.none = (await make({ title: "Sin áreas", parent_key: leg.key })).key;
  K.loose = (await make({ title: "Suelto abierto" })).key;
  K.looseOld = (await make({ title: "Suelto hecho antes" })).key;
  K.looseNew = (await make({ title: "Suelto hecho al final" })).key;
  const areas: [string, string[]][] = [
    [K.ui, ["ui/**"]],
    [K.api, ["src/api/**"]],
    [K.db, ["drizzle/**", "src/db/schema.ts"]],
    [K.mixed, ["src/api/routes.ts", "ui/src/pages/project.tsx"]],
    [K.none, []],
    [K.loose, ["docs/**"]],
  ];
  for (const [key, a] of areas) await raw.query(`update tasks set areas = $2 where key = $1`, [key, a]);
  await raw.query(`update tasks set status = 'Done', resolved_at = now() - interval '5 days' where key = $1`, [K.looseOld]);
  await raw.query(`update tasks set status = 'Merged', resolved_at = now() - interval '1 hour' where key = $1`, [K.looseNew]);
});

after(async () => {
  await closeDb?.();
  await raw?.end();
});

const ZONAS: Record<string, string[]> = { ui: ["pantalla"], api: ["servidor"], db: ["datos"], mixed: ["pantalla", "servidor"], none: [], loose: ["docs"] };

test("I53-6: GET /api/company carries zonas on every board ticket, [] without areas", async () => {
  const card = ((await get("/api/company")).projects as Json[]).find((p) => p.slug === "micasa")!;
  const by = new Map([...(card.tablero.initiatives as Json[]).flatMap((i) => i.tickets as Json[]), ...(card.tablero.loose as Json[])].map((t) => [t.key, t]));
  for (const [name, zonas] of Object.entries(ZONAS)) assert.deepEqual(by.get(K[name]!)?.zonas, zonas, name);
  for (const t of by.values()) assert.ok(Array.isArray(t.zonas), t.key);
});

test("I53-6: GET /api/projects/:slug carries zonas on ticket rows and the board; [] on initiatives", async () => {
  const page = await get("/api/projects/micasa");
  const rows = new Map((page.tasks as Json[]).map((t) => [t.key, t]));
  for (const [name, zonas] of Object.entries(ZONAS)) assert.deepEqual(rows.get(K[name]!)?.zonas, zonas, name);
  assert.deepEqual(rows.get(K.leg!)!.zonas, []);
  const board = new Map((page.tablero.initiatives as Json[]).flatMap((i) => i.tickets as Json[]).map((t) => [t.key, t]));
  assert.deepEqual(board.get(K.mixed!)!.zonas, ["pantalla", "servidor"]);
  const list = ((await get("/api/projects")) as unknown as Json[]).find((p) => p.slug === "micasa")!;
  assert.deepEqual(list.tasks.find((t: Json) => t.key === K.mixed).zonas, ["pantalla", "servidor"]);
});

test("I53-6: the tablero carries the completed initiatives, newest first, and the newest landed loose title", async () => {
  const card = ((await get("/api/company")).projects as Json[]).find((p) => p.slug === "micasa")!;
  const page = await get("/api/projects/micasa");
  const t = card.tablero;
  assert.deepEqual(Object.keys(t).sort(), ["done_initiatives", "initiatives", "loose", "loose_done", "loose_done_title"]);
  assert.deepEqual((t.initiatives as Json[]).map((i) => i.key), [K.leg]);
  assert.deepEqual((t.done_initiatives as Json[]).map((i) => i.key), [K.newer, K.old]);
  const d = t.done_initiatives[0];
  assert.deepEqual(Object.keys(d).sort(), ["done_at", "key", "title"]);
  assert.equal(d.title, "Tramo reciente");
  assert.ok(Date.parse(d.done_at) < Date.now());
  assert.equal(t.loose_done, 2);
  assert.equal(t.loose_done_title, "Suelto hecho al final");
  assert.deepEqual(page.tablero, t);
});
