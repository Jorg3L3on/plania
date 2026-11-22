// PLA-161: the owner can hold queued work before Reanudar. En fila rows offer «Aplazar» beside «Hacer primero»
// (a loose step back to Backlog, an initiative On hold), and get_next never offers a step of an On hold initiative.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type pg from "pg";
import * as React from "react";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
(globalThis as Record<string, unknown>).React = React;
const { app } = await import("../src/app.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const { makeDb } = await import("../src/db/client.js");
const { createMcpServer } = await import("../src/mcp/register.js");
const { cosasOf } = (await import(new URL("../ui/src/lib/cosas.ts", import.meta.url).href)) as Record<string, any>;

type Json = Record<string, any>;
const A = { agent: "test-agent", session_id: "s1", machine: "MacBook-Air" };
const P = { project: "filmia" };

let client: Client;
let raw: pg.Client;
let closeDb: () => Promise<void>;
let cookie: string;

async function call(name: string, args: Json): Promise<Json> {
  const r = (await client.callTool({ name, arguments: { actor: A, ...args } })) as { isError?: boolean; content: { text: string }[] };
  const data = JSON.parse(r.content[0]!.text);
  return r.isError ? { __error: data.error, ...data } : data;
}
const req = (method: string, path: string, body?: unknown) =>
  app.request(path, { method, headers: { Cookie: cookie, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });

before(async () => {
  raw = await resetTestDb();
  cookie = `${SESSION_COOKIE}=${createSession()}`;
  const { db, close } = makeDb();
  closeDb = close;
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createMcpServer(db).connect(serverSide);
  client = new Client({ name: "test", version: "0" });
  await client.connect(clientSide);
  const p = await call("get_project", P);
  await call("set_project", { ...P, version: p.version, settings: { claim_from: "ready" } });
});

after(async () => {
  await client?.close();
  await closeDb?.();
  await raw?.end();
});

describe("get_next and an On hold initiative", () => {
  test("a Ready step of an On hold initiative is never offered; resuming the initiative offers it again", async () => {
    const ini = await call("create_task", { ...P, kind: "initiative", title: "Plan de pagos", scope: "s" });
    const step = await call("create_task", { ...P, parent_key: ini.key, phase: 1, title: "Paso 1", scope: "s", checks: ["c"], status: "Ready", priority: "P0" });
    assert.equal((await call("get_next", P)).task?.key, step.key, "offered while the initiative is Planning");

    // The screen's call: PATCH the initiative to On hold with the version it read.
    const t = (await (await req("GET", `/api/projects/filmia/tasks/${ini.key}`)).json()) as Json;
    const r = await req("PATCH", `/api/projects/filmia/tasks/${ini.key}`, { status: "On hold", version: t.version });
    assert.equal(r.status, 200, await r.clone().text());
    assert.notEqual((await call("get_next", P)).task?.key, step.key, "never offered while the initiative is On hold");

    const t2 = (await (await req("GET", `/api/projects/filmia/tasks/${ini.key}`)).json()) as Json;
    assert.equal((await req("PATCH", `/api/projects/filmia/tasks/${ini.key}`, { status: "Planning", version: t2.version })).status, 200);
    assert.equal((await call("get_next", P)).task?.key, step.key, "offered again once resumed");
  });

  test("Aplazar on a loose Ready step: back to Backlog, not offered under claim_from ready", async () => {
    const loose = await call("create_task", { ...P, title: "Auditoría", scope: "s", checks: ["c"], status: "Ready", priority: "P0" });
    assert.equal((await call("get_next", P)).task?.key, loose.key);
    const t = (await (await req("GET", `/api/projects/filmia/tasks/${loose.key}`)).json()) as Json;
    assert.equal((await req("PATCH", `/api/projects/filmia/tasks/${loose.key}`, { status: "Backlog", version: t.version })).status, 200);
    assert.notEqual((await call("get_next", P)).task?.key, loose.key);
  });
});

// ---- The list's lever (pure)

const etapa = (e: string) => ({ etapa: e, qa: null, holder: null, live: false, since: "2026-11-21T10:00:00Z", ci: null, reason: null });
const tk = (key: string, e: string, over: Record<string, unknown> = {}) => ({ key, title: `Paso ${key}`, status: "Ready", phase: 1, parent_key: null, etapa: etapa(e), ...over });
const project = (over: Record<string, unknown> = {}): any => ({
  slug: "zz",
  title: "zz",
  paused: true,
  light: "ok",
  goal: null,
  usage: { used: 0 },
  team: [],
  thread: { id: "t", unread: 0, last: null },
  plan: null,
  this_week: { done: 0, docs: 0, prs: 0, last_at: null },
  next: null,
  work: { open: 0, in_progress: 0 },
  tablero: { initiatives: [], loose: [], loose_done: 0, done_initiatives: [] },
  pedidos: [],
  ...over,
});

const rowOf = (p: any, key: string) => cosasOf({ p, decisions: [], ficha: { ideas: [], promoted: [] } }, "es").grupos.flatMap((g: any) => g.cosas).find((c: any) => c.key === key);

describe("En fila's levers", () => {
  test("a loose Ready step offers Hacer primero and Aplazar to Backlog", () => {
    const p = project({ tablero: { initiatives: [], loose: [tk("ZZ-39", "lista")], loose_done: 0, done_initiatives: [] } });
    const row = rowOf(p, "ZZ-39");
    assert.equal(row.grupo, "fila");
    assert.deepEqual(row.palanca, { kind: "primero", key: "ZZ-39", aplazar: { key: "ZZ-39", to: "Backlog" } });
  });

  test("an initiative's row puts the whole initiative On hold; Hacer primero names its next step", () => {
    const ini = { key: "ZZ-I34", title: "Plan de pagos", status: "Active", done: 0, total: 2, tickets: [tk("ZZ-I34-1", "lista", { parent_key: "ZZ-I34" }), tk("ZZ-I34-2", "lista", { parent_key: "ZZ-I34", phase: 2 })] };
    const p = project({ tablero: { initiatives: [ini], loose: [], loose_done: 0, done_initiatives: [] } });
    const row = rowOf(p, "ZZ-I34");
    assert.deepEqual(row.palanca, { kind: "primero", key: "ZZ-I34-1", aplazar: { key: "ZZ-I34", to: "On hold" } });
  });

  test("a step already first still offers Aplazar alone", async () => {
    const p = project({ next_first: "ZZ-39", tablero: { initiatives: [], loose: [tk("ZZ-39", "lista")], loose_done: 0, done_initiatives: [] } });
    const row = rowOf(p, "ZZ-39");
    assert.deepEqual(row.palanca, { kind: "primero", key: null, aplazar: { key: "ZZ-39", to: "Backlog" } });
    const palanca = (await import(new URL("../ui/src/components/corriente/palanca.tsx", import.meta.url).href)) as Record<string, any>;
    assert.equal(palanca.busyKey("zz", row.palanca), "aplazar-ZZ-39");
  });

  test("a step that waits on another (en_espera) offers no lever", () => {
    const p = project({ tablero: { initiatives: [], loose: [tk("ZZ-40", "en_espera")], loose_done: 0, done_initiatives: [] } });
    const row = rowOf(p, "ZZ-40");
    assert.equal(row.palanca, null);
  });
});
