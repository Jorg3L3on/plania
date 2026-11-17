// PLA-I54-4: «Constrúyelo». The order is recorded on the idea and wakes the PO with the promote instruction; the capsule
// says «Pasando la válvula»; an idea with promoted_to leaves the tube and its initiative is on the board; an owner's
// idea is never promoted without the order. Throwaway DB, fake values only.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, beforeEach, test } from "node:test";
import type pg from "pg";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { resetTestDb, useOwnerCode, useTestEnv } from "./helpers.js";

useTestEnv();
await useOwnerCode();
process.env.PLANIA_EVENT_WAKES = "1";
process.env.PLANIA_HOME_PROJECT = "zigzag";
process.env.PLANIA_PROMPTS_PROJECT = "micasa";
(globalThis as { React?: unknown }).React = React;
const { makeDb } = await import("../src/db/client.js");
const { app } = await import("../src/app.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const { seedOrg } = await import("../scripts/seed-org.js");
const writes = await import("../src/mcp/writes.js");
const docsMod = await import("../src/mcp/docs.js");
const events = await import("../src/runner/events.js");
const pedido = await import("../src/api/company-pedido.js");


type Json = Record<string, any>;
let raw: pg.Client;
let db: ReturnType<typeof makeDb>["db"];
let closeDb: () => Promise<void>;
const jorge = () => ({ Cookie: `${SESSION_COOKIE}=${createSession()}`, "Content-Type": "application/json" });
const post = (url: string, body: Json = {}) => app.request(url, { method: "POST", headers: jorge(), body: JSON.stringify(body) });
const card = async (): Promise<Json> => {
  const res = await app.request("/api/company", { headers: jorge() });
  return (((await res.json()) as Json).projects as Json[]).find((p) => p.slug === "micasa")!;
};
const id = async (table: string, slug: string) => (await raw.query(`select id from ${table} where slug = $1`, [slug])).rows[0].id as string;
const versionOf = async (key: string) => (await raw.query(`select version from tasks where key = $1`, [key])).rows[0].version as number;
const PO = { actor: { agent: "po-micasa", session_id: "run-0000c0de" } };
const queuedFor = async (key: string) =>
  (await raw.query(`select r.summary from agent_runs r join agents a on a.id = r.agent_id where a.slug = 'po-micasa' and r.task_key = $1 and r.status = 'queued'`, [key])).rows as { summary: string }[];
const forma = async (text: string) => {
  const res = await post("/api/company/projects/micasa/ask", { text, mode: "forma" });
  assert.equal(res.status, 201);
  return ((await res.json()) as Json).key as string;
};
// The PO walks the idea to Lista with each stage's doc.
async function toLista(key: string) {
  const docs: [string, string, string][] = [
    ["Idea", "## Problem\nx\n## Who it is for\ny\n## Why now\nz", "research"],
    ["Research", "## What we learned\nx\n## Options\ny\n## Recommendation\nz", "design"],
    ["Design", "## Approach\nx\n## Scope\ny\n## Out of scope\nz", "planning"],
    ["Plan", "## Steps\nx\n## Done when\ny\n## Risks\nz", "ready"],
  ];
  for (const [title, markdown, to] of docs) {
    await docsMod.attachDoc(db, { project: "micasa", key, title, markdown }, PO);
    await writes.setTask(db, { project: "micasa", key, stage: to, version: await versionOf(key) } as never, PO);
  }
}
const promote = async (key: string, title: string) => {
  const ini = (await writes.createTask(db, { project: "micasa", kind: "initiative", title, scope: "s" } as never, PO)) as Json;
  await writes.createTask(db, { project: "micasa", parent_key: ini.key, phase: 1, title: "Primer paso", scope: "s", checks: ["c"], status: "Ready" } as never, PO);
  await writes.setTask(db, { project: "micasa", key, promoted_to: ini.key, version: await versionOf(key) } as never, PO);
  return ini.key as string;
};

before(async () => {
  raw = await resetTestDb();
  ({ db, close: closeDb } = makeDb());
  await seedOrg(db);
  await raw.query(`insert into goals (project_id, title) values ($1, 'Lanzar la beta')`, [await id("projects", "micasa")]);
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

test("I54-4 #1: Constrúyelo records the order and wakes the PO with the promote instruction; the capsule passes the valve", async () => {
  const key = await forma("Compartir la ficha por enlace");
  await toLista(key);
  await raw.query(`delete from agent_runs`);
  const res = await post(`/api/company/projects/micasa/pedidos/${key}/construir`);
  assert.equal(res.status, 200, await res.clone().text());
  assert.deepEqual((await res.json()) as Json, { key, state: "valvula", wake: "queued" });
  const order = (await raw.query(`select type, actor->>'agent' as who, payload from events where task_key = $1 and type in ('pedido.construir', 'note') order by id`, [key])).rows;
  assert.deepEqual(order.map((r) => [r.type, r.who]), [["pedido.construir", "jorge"], ["note", "jorge"]]);
  assert.equal(order[0].payload.stage, "ready");
  assert.equal(order[1].payload.text, pedido.BUILD_NOTE_TEXT);
  const woke = await queuedFor(key);
  assert.equal(woke.length, 1);
  assert.match(woke[0]!.summary, /Constrúyelo/);
  assert.match(woke[0]!.summary, /crea la iniciativa y sus tickets directamente, sin preguntar, y pon promoted_to/);
  // On the floor: «Pasando la válvula»; the trail says it once.
  assert.equal(((await card()).pedidos as Json[]).find((x) => x.key === key)!.state, "valvula");
  const d = (await (await app.request(`/api/company/projects/micasa/pedidos/${key}`, { headers: jorge() })).json()) as Json;
  assert.deepEqual([d.trail.at(-1).kind, d.trail.at(-1).text], ["construir", "Dijiste «Constrúyelo»."]);
  // Once is enough; a saved one comes off the shelf first.
  assert.equal((await post(`/api/company/projects/micasa/pedidos/${key}/construir`)).status, 409);
  const shelved = await forma("Una que guardé");
  await post(`/api/company/projects/micasa/pedidos/${shelved}/guardar`);
  assert.equal((await post(`/api/company/projects/micasa/pedidos/${shelved}/construir`)).status, 409);
});

test("I54-4 #1: from any stop, and a coalesced order is taken when the PO's run ends", async () => {
  const early = await forma("Exportar a PDF");
  assert.equal((await post(`/api/company/projects/micasa/pedidos/${early}/construir`)).status, 200, "from the buzón too");
  await raw.query(`delete from agent_runs`);
  await raw.query(`update tasks set status = 'Won''t do' where kind = 'idea' and key <> $1`, [early]);
  const po = (await raw.query(`select * from agents where slug = 'po-micasa'`)).rows[0];
  const agent = { ...po, projectId: po.project_id, roleTemplate: po.role_template, capabilities: po.capabilities } as never;
  const out = await events.wakePoIfWaiting(db as never, agent, { id: await id("projects", "micasa"), slug: "micasa" }, "MIC-0");
  assert.equal(out?.kind, "queued");
  assert.equal((out as Json).taskKey, early);
  assert.match((out as Json).reason, /Constrúyelo/);
});



test("I54-4 #3: an owner's idea at Lista is never promoted without the order; the PO's own ideas are not held", async () => {
  const key = await forma("Usar el panel sin conexión");
  await toLista(key);
  // The prompt the PO reads says it stays.
  const scope = (await raw.query(`select scope from tasks where key = $1`, [key])).rows[0].scope as string;
  assert.match(scope, /no pongas promoted_to: en Lista se queda quieta\. Solo Jorge la manda construir con «Constrúyelo»/);
  // The server holds it too.
  const ini = (await writes.createTask(db, { project: "micasa", kind: "initiative", title: "Sin conexión", scope: "s" } as never, PO)) as Json;
  await assert.rejects(writes.setTask(db, { project: "micasa", key, promoted_to: ini.key, version: await versionOf(key) } as never, PO), (e: Json) => e.code === "PEDIDO_SIN_ORDEN");
  const c = await card();
  assert.deepEqual([(c.pedidos as Json[]).find((x) => x.key === key)!.stop, (c.pedidos as Json[]).find((x) => x.key === key)!.state], ["lista", "quieta"]);
  assert.equal((await raw.query(`select promoted_to from tasks where key = $1`, [key])).rows[0].promoted_to, null);
  // After the order it passes.
  await post(`/api/company/projects/micasa/pedidos/${key}/construir`);
  await writes.setTask(db, { project: "micasa", key, promoted_to: ini.key, version: await versionOf(key) } as never, PO);
  assert.equal((await raw.query(`select promoted_to from tasks where key = $1`, [key])).rows[0].promoted_to, ini.key);
  // An idea that is not the owner's request keeps the old rule.
  const own = (await writes.createTask(db, { project: "micasa", kind: "idea", title: "Idea del PO" } as never, PO)) as Json;
  const ini2 = (await writes.createTask(db, { project: "micasa", kind: "initiative", title: "Otra", scope: "s" } as never, PO)) as Json;
  await writes.setTask(db, { project: "micasa", key: own.key, promoted_to: ini2.key, version: await versionOf(own.key) } as never, PO);
  // The catalog names the new error, and the coalesced wake's words are the route's.
  assert.match(readFileSync(new URL("../README.md", import.meta.url), "utf8"), /`PEDIDO_SIN_ORDEN` \| 409/);
  assert.ok(readFileSync(new URL("../src/runner/events.ts", import.meta.url), "utf8").includes(pedido.BUILD_REASON));
});
