// PLA-I36 phases 3-4: the wheel on the card and anyone at the Mac can drive. Levers (PLA-I36-6), proposals as data
// (PLA-I36-7), one box with plan approval (PLA-I36-8), see it working (PLA-I36-9; stopping a live process is in
// test/runner.test.ts), evidence before accepting (PLA-I36-10), plain words and the owner's code (PLA-I36-11).
// Throwaway DB for the payload and the routes, server-rendered UI with fake data. Fake names and numbers only.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import type pg from "pg";
import { ownerCode, resetTestDb, useOwnerCode, useTestEnv } from "./helpers.js";

useTestEnv();
await useOwnerCode();
process.env.PLANIA_EVENT_WAKES = "1";
process.env.PLANIA_HOME_PROJECT = "zigzag";
process.env.PLANIA_PROMPTS_PROJECT = "micasa";
const { makeDb } = await import("../src/db/client.js");
const { app } = await import("../src/app.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const { seedOrg } = await import("../scripts/seed-org.js");
const writes = await import("../src/mcp/writes.js");
const { ensureMember } = await import("../src/runner/team.js");
const { propose } = await import("../src/mcp/proposals.js");
const { loadReady, pickReady } = await import("../src/jobs/heartbeat.js");
const { PROTOCOL_VERSION } = await import("../src/mcp/protocol.js");

(globalThis as { React?: unknown }).React = React;
const load = async (p: string) => (await import(new URL(`../ui/src/${p}`, import.meta.url).href)) as Record<string, any>;
const v2 = await load("components/compania/v2.tsx");
const floor = await load("components/compania/edificio/floor.tsx");
const side = await load("components/compania/edificio/side.tsx");
const ask = await load("components/compania/edificio/ask.tsx");
const lib = await load("lib/v2.ts");

type Json = Record<string, any>;
let raw: pg.Client;
let db: ReturnType<typeof makeDb>["db"];
let closeDb: () => Promise<void>;
let po = "";
const jorge = () => ({ Cookie: `${SESSION_COOKIE}=${createSession()}`, "Content-Type": "application/json" });
const company = async (): Promise<Json> => (await (await app.request("/api/company", { headers: jorge() })).json()) as Json;
const card = async (slug = "workia") => (await company()).projects.find((p: Json) => p.slug === slug) as Json;
const post = (url: string, body: unknown = {}, method = "POST") => app.request(url, { method, headers: jorge(), body: JSON.stringify(body) });
const act = (id: string, body: unknown) => post(`/api/company/decisions/${encodeURIComponent(id)}`, body);
const PO = () => ({ actor: { agent: po, session_id: "s-po-workia" } });
const steps = async () => (await raw.query(`select key, status from tasks where scope like 'Paso del pedido%' order by key`)).rows as { key: string; status: string }[];

before(async () => {
  raw = await resetTestDb();
  ({ db, close: closeDb } = makeDb());
  await seedOrg(db);
  await raw.query(`update projects set runs_paused = false where slug in ('workia', 'filmia')`);
  await raw.query(`update runner_settings set max_concurrent = 0`); // a wake queues; nothing is spawned
  const p = (await raw.query(`select id, slug, title from projects where slug = 'workia'`)).rows[0] as { id: string; slug: string; title: string };
  await ensureMember(db, p, "product-owner", { reportsTo: "ceo", note: "test" });
  po = (await raw.query(`select slug from agents where project_id = $1 and role_template = 'product-owner'`, [p.id])).rows[0].slug;
});

after(async () => {
  await closeDb?.();
  await raw?.end();
});

// ---- PLA-I36-6

test("I36-6 #1: a message from the card creates the PO's ticket and shows its wake state", async () => {
  const res = await post("/api/company/projects/workia/ask", { text: "Agrega un botón de WhatsApp", kind: "cambio", now: false });
  assert.equal(res.status, 201, await res.clone().text());
  const out = (await res.json()) as Json;
  assert.equal(out.wake, "queued");
  assert.equal(out.woke, null);
  assert.equal(lib.askText(out), "Enviado · el PO lo toma en su turno");
  const scope = (await raw.query(`select scope, origin, status from tasks where key = $1`, [out.key])).rows[0];
  assert.deepEqual([scope.origin, scope.status], ["jorge", "Ready"]);
  assert.match(scope.scope, /\(un cambio\): "Agrega un botón de WhatsApp"/);
  const o = (await card()).orders.find((x: Json) => x.key === out.key);
  assert.deepEqual([o.stage, o.text], ["enviada", "Agrega un botón de WhatsApp"]);
});

test("I36-6 #2: Enviar ahora wakes the PO when it has Ready work; with none, /wake says why", async () => {
  const res = await post("/api/company/projects/workia/ask", { text: "Cambia el color del encabezado", kind: "cambio", now: true });
  const out = (await res.json()) as Json;
  assert.ok(out.woke, "a wake was tried");
  assert.notEqual(out.woke.reason, "idle", "the new ticket is Ready work");
  assert.equal(out.woke.ticket !== null, true);
  const idle = (await (await post("/api/company/projects/filmia/wake")).json()) as Json;
  assert.deepEqual([idle.woke, idle.reason], [false, "idle"]);
  assert.match(lib.askText({ wake: "off", woke: { woke: false, reason: "idle", ticket: null, summary: "" } }), /no tenía trabajo listo/);
});

test("I36-6 #3: picking another ticket as next changes Siguiente on the next read, and the runner picks it first", async () => {
  for (const t of ["Alfa", "Beta", "Gamma"]) await writes.createTask(db, { project: "workia", title: t, status: "Ready", work_type: "code", scope: "s", checks: ["c"] } as never, PO());
  const before = await card();
  assert.ok(before.ready.length >= 3);
  const target = before.ready.find((r: Json) => r.title === "Gamma");
  assert.notEqual(before.next.key, target.key);
  const res = await post("/api/company/projects/workia/next", { key: target.key });
  assert.equal(res.status, 200);
  const afterRead = await card();
  assert.equal(afterRead.next.key, target.key);
  const rows = (await loadReady(db)).filter((r) => r.project === "workia");
  const taller = { id: "x", slug: "taller-workia", role: "taller", capabilities: ["workia"], projectSlug: "workia" };
  assert.equal(pickReady(taller, rows)!.key, target.key);
  assert.equal((await post("/api/company/projects/workia/next", { key: "WRK-999" })).status, 404);
});

test("I36-6 #4: Pausar from the card pauses the project; it moves to En pausa", async () => {
  const html = renderCard({ ...(await card("filmia")) }, steerStub());
  assert.ok(html.includes('data-control="pausar"'));
  const page = await import("node:fs").then((fs) => fs.readFileSync(new URL("../ui/src/pages/ceo.tsx", import.meta.url), "utf8"));
  assert.ok(page.includes("onPause: (p) => setPausing(p)") && page.includes("<StopBody") && page.includes("api.setProjectPaused(slug, true)"));
  assert.equal((await post("/api/company/projects/filmia/switch", { paused: true })).status, 200);
  const f = await card("filmia");
  assert.deepEqual([f.paused, f.light], [true, "paused"]);
});

// ---- PLA-I36-7

const choice = (patch: Json = {}) => ({
  project: "workia",
  kind: "choice" as const,
  title: "Tres caminos para la tienda",
  options: [
    { label: "Catálogo primero", effect: "se ve la tienda sin pagos", cost: { tickets: 3, days: 4, tokens: 900_000 }, recommended: true },
    { label: "Pagos primero", effect: "se cobra desde el día uno", cost: { tickets: 5, days: 7, delays: "el catálogo" } },
    { label: "Esperar al cliente", effect: "nada se mueve", cost: {} },
  ],
  recommended_reason: "deja probar algo esta semana",
  ...patch,
});

test("I36-7 #1, #2: a structured proposal shows each option's effect and cost, and stays after a later PO message", async () => {
  const out = (await propose(db, choice(), PO() as never)) as Json;
  assert.ok(out.message.id);
  const row = (await company()).decisions.find((d: Json) => d.id === `m-${out.message.id}`);
  assert.equal(row.kind, "proposal");
  assert.deepEqual(row.options[0], { n: 1, label: "Catálogo primero", recommended: true, effect: "se ve la tienda sin pagos", cost: "3 tickets · 4 días · ~900k tokens" });
  assert.equal(row.options[1].cost, "5 tickets · 7 días · retrasa el catálogo");
  assert.equal(row.recommended_reason, "deja probar algo esta semana");
  const thread = (await raw.query(`select id from threads where kind = 'project' and project_id = (select id from projects where slug = 'workia')`)).rows[0].id;
  await raw.query(`insert into thread_messages (thread_id, author_agent, author_role, body, at) values ($1, $2, 'product-owner', 'Sigo con lo demás mientras decides.', now() + interval '1 minute')`, [thread, po]);
  assert.ok((await company()).decisions.some((d: Json) => d.id === `m-${out.message.id}` && d.state === null), "still waits in Te toca");
  const html = renderTeToca([row]);
  assert.ok(html.includes("se ve la tienda sin pagos · 3 tickets · 4 días · ~900k tokens"));
  assert.ok(html.includes("Recomienda: deja probar algo esta semana"));
});

test("I36-7 #3: 1 + 2 shows and is accepted only when the proposal marks them combinable", async () => {
  const plain = (await propose(db, choice({ title: "Sin combinar" }), PO() as never)) as Json;
  const rowPlain = (await company()).decisions.find((d: Json) => d.id === `m-${plain.message.id}`);
  assert.deepEqual(rowPlain.combinable, []);
  assert.equal(renderTeToca([rowPlain]).includes('data-action="combo"'), false);
  const refused = await act(rowPlain.id, { action: "elegir", option: [1, 2] });
  assert.equal(refused.status, 400);
  assert.equal(((await refused.json()) as Json).error, "NOT_COMBINABLE");
  const combo = (await propose(db, choice({ title: "Combinables", combinable: [[1, 2]] }), PO() as never)) as Json;
  const rowCombo = (await company()).decisions.find((d: Json) => d.id === `m-${combo.message.id}`);
  assert.ok(renderTeToca([rowCombo]).includes("1 + 2"));
  const ok = await act(rowCombo.id, { action: "elegir", option: [1, 2] });
  assert.equal(ok.status, 200, await ok.clone().text());
});

test("I36-7 #5: the protocol is 2.21 and docs/bot-protocol.md describes propose", async () => {
  assert.equal(PROTOCOL_VERSION, "2.21");
  const { readFileSync } = await import("node:fs");
  const doc = readFileSync(new URL("../docs/bot-protocol.md", import.meta.url), "utf8");
  assert.ok(doc.includes("## Proposals (protocol 2.19)") && doc.includes('kind: "plan"') && doc.includes("combinable"));
  await assert.rejects(propose(db, { ...choice(), options: [{ label: "Una" }] } as never, PO() as never), /INVALID_FILTER/);
  await assert.rejects(propose(db, choice(), { actor: { agent: "asistente-x", session_id: "s" } } as never), /THREAD_FORBIDDEN/);
});

// ---- PLA-I36-8

const plan = (order: string, patch: Json = {}) => ({
  project: "workia",
  kind: "plan" as const,
  title: "Botón de WhatsApp",
  order,
  understood: "un botón fijo abajo que abre WhatsApp con el número de la tienda",
  steps: [
    { title: "Botón en la portada", done_when: "el botón abre WhatsApp en el teléfono" },
    { title: "Número en ajustes", done_when: "la tienda cambia el número sin código", work_type: "code" },
  ],
  cost: { tickets: 2, days: 2, tokens: 600_000 },
  ...patch,
});

test("I36-8 #1, #2: with plan approval on, the PO's plan shows in Te toca and nothing is Ready for Taller until Sí, empiecen", async () => {
  assert.equal((await post("/api/company/projects/workia/options", { plan_approval: true }, "PUT")).status, 200);
  const order = ((await (await post("/api/company/projects/workia/ask", { text: "Pon un botón de WhatsApp", kind: "cambio" })).json()) as Json).key as string;
  const before = (await steps()).length;
  const out = (await propose(db, plan(order), PO() as never)) as Json;
  assert.equal(out.proposal.needs_approval, true);
  assert.equal((await steps()).length, before, "no ticket made yet");
  const row = (await company()).decisions.find((d: Json) => d.id === `m-${out.message.id}`);
  assert.equal(row.kind, "plan");
  assert.deepEqual(row.actions, ["empezar", "cambiar", "cancelar"]);
  assert.equal(row.plan.understood, "un botón fijo abajo que abre WhatsApp con el número de la tienda");
  assert.deepEqual(row.plan.steps.map((s: Json) => s.done_when), ["el botón abre WhatsApp en el teléfono", "la tienda cambia el número sin código"]);
  assert.equal(row.plan.cost, "2 tickets · 2 días · ~600k tokens");
  const o = (await card()).orders.find((x: Json) => x.key === order);
  assert.deepEqual([o.stage, o.plan.needs_approval, o.plan.approved], ["entendido", true, false]);
  const html = renderTeToca([row]);
  for (const t of ["Lo entendí:", "Hecho cuando: el botón abre WhatsApp en el teléfono", "Sí, empiecen", "Cambiar algo", "Cancelar"]) assert.ok(html.includes(t), t);

  const go = await act(row.id, { action: "empezar" });
  assert.equal(go.status, 200, await go.clone().text());
  const made = (await steps()).slice(before);
  assert.equal(made.length, 2);
  assert.ok(made.every((s) => s.status === "Ready"));
  const after1 = (await card()).orders.find((x: Json) => x.key === order);
  assert.deepEqual([after1.stage, after1.plan.approved, after1.plan.steps], ["trabajando", true, 2]);
  assert.equal((await act(row.id, { action: "empezar" })).status, 409, "twice is refused");
  await raw.query(`update tasks set status = 'In review' where key = any($1)`, [made.map((s) => s.key)]);
  assert.equal((await card()).orders.find((x: Json) => x.key === order).stage, "pruebalo");
  await raw.query(`update tasks set status = 'Done' where key = any($1)`, [made.map((s) => s.key)]);
  assert.equal((await card()).orders.find((x: Json) => x.key === order).stage, "listo");
});

test("I36-8: Cambiar algo closes the order and hands its words back to the box", async () => {
  const order = ((await (await post("/api/company/projects/workia/ask", { text: "Agrega un mapa de la tienda" })).json()) as Json).key as string;
  const out = (await propose(db, plan(order, { title: "Mapa" }), PO() as never)) as Json;
  const res = await act(`m-${out.message.id}`, { action: "cambiar" });
  assert.equal(res.status, 200);
  assert.equal(((await res.json()) as Json).state.result.text, "Agrega un mapa de la tienda");
  assert.equal((await raw.query(`select status from tasks where key = $1`, [order])).rows[0].status, "Won't do");
});

test("I36-8 #3: with the switch off, the plan's tickets start at once and the plan is information", async () => {
  await post("/api/company/projects/workia/options", { plan_approval: false }, "PUT");
  const order = ((await (await post("/api/company/projects/workia/ask", { text: "Agrega horarios" })).json()) as Json).key as string;
  const before = (await steps()).length;
  const out = (await propose(db, plan(order, { title: "Horarios" }), PO() as never)) as Json;
  assert.equal(out.proposal.needs_approval, false);
  assert.equal((await steps()).length, before + 2);
  assert.equal((await company()).decisions.some((d: Json) => d.id === `m-${out.message.id}`), false, "no decision to make");
  const o = (await card()).orders.find((x: Json) => x.key === order);
  assert.deepEqual([o.plan.approved, o.stage], [true, "trabajando"]);
});

test("I36-8 #4: Cancelar closes the order and its tickets", async () => {
  const order = ((await (await post("/api/company/projects/workia/ask", { text: "Agrega reseñas" })).json()) as Json).key as string;
  const out = (await propose(db, plan(order, { title: "Reseñas" }), PO() as never)) as Json;
  const made = out.proposal.created as string[];
  assert.equal(made.length, 2);
  const res = await post(`/api/company/projects/workia/orders/${order}/cancel`);
  assert.equal(res.status, 200, await res.clone().text());
  const statuses = (await raw.query(`select key, status from tasks where key = any($1)`, [[order, ...made]])).rows.map((r) => r.status);
  assert.deepEqual(statuses, ["Won't do", "Won't do", "Won't do"]);
  assert.equal((await card()).orders.find((x: Json) => x.key === order).stage, "cancelada");
});

// ---- PLA-I36-9

test("I36-9 #1, #4: a live run shows bot, step, since and last action; a note reaches the ticket", async () => {
  const [step] = (await raw.query(`select key from tasks where scope like 'Paso del pedido%' and status = 'Ready' order by key limit 1`)).rows as { key: string }[];
  const order = (await card()).orders.find((o: Json) => o.plan?.approved && o.stage === "trabajando");
  const agentId = (await raw.query(`select id from agents where slug = 'taller'`)).rows[0]?.id ?? (await raw.query(`select id from agents where role_template = 'taller' limit 1`)).rows[0]?.id;
  const ins = await raw.query(
    `insert into agent_runs (agent_id, project_id, role, status, task_key, started_at, queued_at) select $1, id, 'taller', 'running', $2, now() - interval '12 minutes', now() - interval '12 minutes' from projects where slug = 'workia' returning id`,
    [agentId, step!.key],
  );
  const runId = ins.rows[0].id as string;
  await raw.query(`insert into events (project_id, task_key, type, actor, payload) select id, $2, 'result.added', jsonb_build_object('agent', 'taller', 'session_id', $1::text), '{}'::jsonb from projects where slug = 'workia'`, [`run-${runId.slice(0, 8)}`, step!.key]);
  const o = (await card()).orders.find((x: Json) => x.key === order.key);
  assert.ok(o.run, "the request shows its run");
  assert.deepEqual([o.run.role, o.run.status, o.run.ticket, o.run.last], ["taller", "running", step!.key, "registró pruebas"]);
  assert.ok(o.run.step.length > 0 && o.run.since);
  // PLA-I39: the run shows as its teammate's lit window and Detener lives in that teammate's side page.
  const note = await post(`/api/company/projects/workia/tasks/${step!.key}/note`, { text: "usa el verde de la marca" });
  assert.equal(note.status, 200);
  const ev = (await raw.query(`select payload->>'text' as text from events where task_key = $1 and type = 'note' order by id desc limit 1`, [step!.key])).rows[0];
  assert.equal(ev.text, "De Compañía: usa el verde de la marca");
  // Not live in this process: Detener says so, the project keeps running.
  const stop = await post(`/api/company/runs/${runId}/stop`);
  assert.equal(stop.status, 409);
  await raw.query(`update agent_runs set status = 'stopped', ended_at = now() where id = $1`, [runId]);
  const stopped = (await card()).orders.find((x: Json) => x.key === order.key);
  assert.equal(stopped.run.status, "stopped");
});

// ---- PLA-I36-10

test("I36-10 #1-#4: a delivery shows pass and fail counts, files and the preview; Aceptar holds while red; Pedir cambios sends it back", async () => {
  const t = (await writes.createTask(db, { project: "workia", title: "Galería de fotos", scope: "s", checks: ["c1"], owner_agent: po } as never, PO())) as Json;
  const url = "https://github.com/x/workia/pull/31";
  await raw.query(`update tasks set status = 'In review', pr_url = $2 where key = $1`, [t.key, url]);
  await raw.query(`insert into results (task_id, kind, verdict, cite, counts, actor) select id, 'test', 'fail', 'pnpm test', '{"pass": 40, "fail": 2}'::jsonb, '{"agent":"taller"}'::jsonb from tasks where key = $1`, [t.key]);
  await raw.query(`insert into pull_requests (project_id, repo, number, url, title, task_id, state, ci_state, changed_files) select project_id, 'x/workia', 31, $2, 'pr', id, 'open', 'success', 8 from tasks where key = $1`, [t.key, url]);
  const thread = (await raw.query(`select id from threads where kind = 'project' and project_id = (select id from projects where slug = 'workia')`)).rows[0].id;
  await raw.query(`insert into thread_messages (thread_id, author_agent, author_role, body, links, at) values ($1, 'taller', 'taller', 'Listo para revisar.', $2::jsonb, now() + interval '5 minutes')`, [
    thread,
    JSON.stringify([
      { kind: "ticket", ref: t.key, title: "Galería de fotos" },
      { kind: "pr", ref: url, title: "PR" },
    ]),
  ]);
  const find = async () => (await company()).decisions.find((d: Json) => d.ref === t.key && (d.kind === "pr" || d.kind === "deliverable"));
  let d = await find();
  assert.deepEqual([d.evidence.pass, d.evidence.fail, d.files], [40, 2, 8]);
  assert.equal(d.hold, "Falta 1 check.");
  assert.equal(d.preview_url, null);
  let html = renderTeToca([d]);
  assert.ok(html.includes("Pruebas: 40 pasan · 2 fallan · 8 archivos cambiados"));
  const fusionar = (h: string) => /<button[^>]*data-action="fusionar"[^>]*>/.exec(h)![0];
  assert.ok(fusionar(html).includes(' disabled=""'), "Aceptar disabled");
  assert.ok(html.includes("Sin vista previa"));
  await raw.query(`update checks set done = true where task_id = (select id from tasks where key = $1)`, [t.key]);
  await raw.query(`insert into results (task_id, kind, verdict, cite, counts, actor) select id, 'test', 'pass', 'pnpm test', '{"pass": 42, "fail": 0}'::jsonb, '{"agent":"taller"}'::jsonb from tasks where key = $1`, [t.key]);
  await post("/api/company/projects/workia/options", { preview_url: "https://workia-preview.test" }, "PUT");
  d = await find();
  assert.equal(d.hold, null);
  html = renderTeToca([d]);
  assert.equal(fusionar(html).includes(' disabled=""'), false, "Aceptar enabled when all pass");
  assert.ok(html.includes('href="https://workia-preview.test"') && html.includes("Ver la vista previa"));
  assert.equal((await post("/api/company/projects/workia/options", { preview_url: "javascript:alert(1)" }, "PUT")).status, 400);
  const back = await act(d.id, { action: "cambios", text: "la galería se corta en el teléfono" });
  assert.equal(back.status, 200, await back.clone().text());
  const row = (await raw.query(`select status from tasks where key = $1`, [t.key])).rows[0];
  assert.equal(row.status, "Ready");
  const note = (await raw.query(`select payload->>'text' as text from events where task_key = $1 and type = 'note' order by id desc limit 1`, [t.key])).rows[0];
  assert.match(note.text, /la galería se corta en el teléfono/);
});

// ---- PLA-14

test("PLA-14 #2, #3: a repo with no CI says so and Aceptar opens with a pass on the head; real CI pending or red still holds", async () => {
  const t = (await writes.createTask(db, { project: "workia", title: "Sin CI", scope: "s", checks: ["c1"], owner_agent: po } as never, PO())) as Json;
  const url = "https://github.com/x/workia/pull/32";
  const OLD = "1111111aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const HEAD = "2222222bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  await raw.query(`update tasks set status = 'In review', pr_url = $2 where key = $1`, [t.key, url]);
  await raw.query(`update checks set done = true where task_id = (select id from tasks where key = $1)`, [t.key]);
  await raw.query(
    `insert into pull_requests (project_id, repo, number, url, title, task_id, state, ci_state, head_sha, head_branch, changed_files) select project_id, 'x/workia', 32, $2, 'pr', id, 'open', 'none', $3, 'jl/sin-ci', 3 from tasks where key = $1`,
    [t.key, url, HEAD],
  );
  const pass = (commit: string) =>
    raw.query(`insert into results (task_id, kind, verdict, cite, counts, commit, branch, actor) select id, 'test', 'pass', 'pnpm test', '{"pass": 56, "fail": 0}'::jsonb, $2, 'jl/sin-ci', '{"agent":"taller"}'::jsonb from tasks where key = $1`, [t.key, commit]);
  await pass(OLD);
  const thread = (await raw.query(`select id from threads where kind = 'project' and project_id = (select id from projects where slug = 'workia')`)).rows[0].id;
  await raw.query(`insert into thread_messages (thread_id, author_agent, author_role, body, links, at) values ($1, 'taller', 'taller', 'Listo para revisar.', $2::jsonb, now() + interval '10 minutes')`, [
    thread,
    JSON.stringify([
      { kind: "ticket", ref: t.key, title: "Sin CI" },
      { kind: "pr", ref: url, title: "PR" },
    ]),
  ]);
  const find = async () => (await company()).decisions.find((d: Json) => d.ref === t.key && (d.kind === "pr" || d.kind === "deliverable"));
  const button = (h: string) => /<button[^>]*data-action="(?:fusionar|aceptar)"[^>]*>/.exec(h)![0];
  // A pass on an older commit is stale for the head: still held, and the reason names the missing CI.
  let d = await find();
  assert.deepEqual(d.checks, { open: 0, ci: "none" });
  assert.match(d.hold, /no tiene CI/);
  let html = renderTeToca([d]);
  assert.ok(html.includes("repo sin CI") && !html.includes("pruebas corriendo") && !html.includes("siguen corriendo"));
  assert.ok(button(html).includes(' disabled=""'));
  // A pass on the current head opens Aceptar.
  await pass(HEAD);
  d = await find();
  assert.equal(d.hold, null);
  html = renderTeToca([d]);
  assert.equal(button(html).includes(' disabled=""'), false, "Aceptar enabled with a fresh pass and no CI");
  // Real CI keeps today's behaviour, even with that fresh pass.
  await raw.query(`update pull_requests set ci_state = 'pending' where url = $1`, [url]);
  d = await find();
  assert.equal(d.hold, "Las pruebas siguen corriendo.");
  assert.ok(button(renderTeToca([d])).includes(' disabled=""'));
  await raw.query(`update pull_requests set ci_state = 'failure' where url = $1`, [url]);
  d = await find();
  assert.equal(d.hold, "Las pruebas fallan.");
  assert.ok(button(renderTeToca([d])).includes(' disabled=""'));
});

// ---- PLA-I36-11

test("I36-11 #2: publishing to main without a valid code is refused by the server", async () => {
  const none = await app.request("/api/projects/zigzag/release/ship", { method: "POST", headers: jorge(), body: JSON.stringify({}) });
  assert.equal(none.status, 403);
  assert.equal(((await none.json()) as Json).error, "OWNER_CODE_REQUIRED");
  const bad = await app.request("/api/projects/zigzag/release/ship", { method: "POST", headers: jorge(), body: JSON.stringify({ code: "000000" }) });
  assert.equal(((await bad.json()) as Json).error, "OWNER_CODE_INVALID");
  await useOwnerCode(false);
  const unset = await app.request("/api/projects/zigzag/release/ship", { method: "POST", headers: jorge(), body: JSON.stringify({ code: "123456" }) });
  assert.equal(((await unset.json()) as Json).error, "OWNER_CODE_UNSET");
  await useOwnerCode(true);
});

test("I36-11 #3: deleting a project without a valid code is refused, and a code is spent once; PLA-21: no limit to raise", async () => {
  assert.equal((await post("/api/company/budgets", { scope: "project", project: "workia", weekly_limit: 9_000_000 }, "PUT")).status, 404);
  const del = await post("/api/company/projects/filmia", {}, "DELETE");
  assert.equal(del.status, 403);
  assert.equal((await raw.query(`select count(*)::int as n from projects where slug = 'filmia'`)).rows[0].n, 1);
  const code = await ownerCode();
  const ok = await post("/api/company/projects/filmia", { code }, "DELETE");
  assert.equal(ok.status, 200);
  assert.equal((await raw.query(`select count(*)::int as n from projects where slug = 'filmia'`)).rows[0].n, 0);
  await raw.query(`insert into projects (slug, title, key_prefix) values ('filmiados', 'Filmia dos', 'FMD')`);
  assert.equal((await post("/api/company/projects/filmiados", { code }, "DELETE")).status, 403, "a code is spent once");
});

test("I36-11 #4: asking, approving a plan, stopping a run and accepting into the test copy need no code", async () => {
  const { readFileSync } = await import("node:fs");
  const company = readFileSync(new URL("../src/api/company.ts", import.meta.url), "utf8");
  const gated = [...company.matchAll(/checkOwnerCode\(/g)].length;
  assert.equal(gated, 1, "only delete project (PLA-21 removed the limits)");
  // Exercised above without a code: ask (I36-6), Sí, empiecen (I36-8), stop (I36-9), Pedir cambios (I36-10).
  const r = await post("/api/company/projects/workia/ask", { text: "Otra cosa pequeña" });
  assert.equal(r.status, 201);
});

// ---- the screen (UI, fake data)

function steerStub() {
  return { onAsk: async () => ({ key: "x", title: "x", po: "po", wake: "queued", woke: null }), onPickNext() {}, onPause() {}, onRun() {}, onNote() {}, onCancelOrder() {}, onOptions() {}, prefill: {}, busy: null };
}
// PLA-I39: the floor (plate and windows) and the plan's side page take what the card held; a decision renders with
// Te toca's body under its asker's window.
function renderCard(p: Json, steer: unknown = steerStub()) {
  return renderToStaticMarkup(
    React.createElement(
      MemoryRouter,
      null,
      React.createElement(floor.Floor, { project: p, now: Date.now() }),
      React.createElement(side.PlanPage, { project: p, now: Date.now(), steer }),
    ),
  );
}
function renderTeToca(decisions: Json[]) {
  return renderToStaticMarkup(
    React.createElement(MemoryRouter, null, ...decisions.map((d) => React.createElement(v2.DecisionBody, { key: d.id, d, now: Date.now(), busy: null, onAct: () => {} }))),
  );
}

const outsideDetalles = (html: string) => html.replace(/<details[\s\S]*?<\/details>/g, "");

test("I36-11 #1: the page renders no ticket key, branch name or the word sandbox outside Detalles", async () => {
  const p = await card();
  const decisions = (await company()).decisions as Json[];
  const html = outsideDetalles(renderCard(p, steerStub()) + renderTeToca(decisions));
  // Free text written by bots (a message body opened with Ver mensaje) is theirs; the rendered rows are folded.
  assert.equal(/\b[A-Z]{2,5}-(I\d+-)?\d+\b/.test(html), false, html.match(/\b[A-Z]{2,5}-(I\d+-)?\d+\b/)?.[0] ?? "");
  assert.equal(/sandbox|jl\/|main\b/i.test(html.replace(/<[^>]+>/g, " ")), false);
  assert.ok(renderCard(p, steerStub()).includes("data-detalles"), "the keys live in Detalles");
  assert.equal(lib.stateText({ action: "fusionar", at: "x", result: {} }), "Aceptado en la copia de prueba");
});

test("I36-8 #5: phone at 390: the floor's box and its button fit in one column", () => {
  const html = renderToStaticMarkup(
    React.createElement(MemoryRouter, null, React.createElement(ask.AskView, { project: { slug: "workia", title: "Workia" }, text: "", setText() {}, now: false, setNow() {}, onSubmit() {} })),
  );
  assert.ok(html.includes("Pide algo para Workia") && html.includes("Que empiece ya"));
  assert.ok(html.includes('class="edi-ask-row"'), "input and button share one row that shrinks");
});

// ---- PLA-I36-12

test("I36-12 #1-#3: a plan whose tickets the PO moved under an initiative still shows their progress, its run and its stages; Cancelar closes them", async () => {
  await post("/api/company/projects/workia/options", { plan_approval: false }, "PUT");
  await writes.createTask(db, { project: "workia", kind: "initiative", key: "WRK-I9", title: "Tienda", scope: "s" } as never, PO());
  const moveAll = async (keys: string[]) => {
    const now: string[] = [];
    for (const k of keys) {
      const [t] = (await raw.query(`select version from tasks where key = $1`, [k])).rows;
      const out = (await writes.setTask(db, { project: "workia", key: k, version: t.version, parent_key: "WRK-I9" } as never, PO())) as Json;
      now.push(out.key as string);
    }
    return now;
  };
  const order = ((await (await post("/api/company/projects/workia/ask", { text: "Agrega un carrito" })).json()) as Json).key as string;
  const out = (await propose(db, plan(order, { title: "Carrito" }), PO() as never)) as Json;
  const moved = await moveAll(out.proposal.created as string[]);
  assert.ok(moved.every((k) => k.startsWith("WRK-I9-")), moved.join(","));
  await raw.query(`update tasks set status = 'Done' where key = $1`, [moved[0]]);
  let o = (await card()).orders.find((x: Json) => x.key === order);
  assert.deepEqual([o.plan.steps, o.plan.done, o.stage], [2, 1, "trabajando"]);
  // A run on a moved step shows on the request.
  const agentId = (await raw.query(`select id from agents where slug = $1`, [po])).rows[0].id;
  const run = await raw.query(`insert into agent_runs (agent_id, project_id, role, status, task_key, started_at, queued_at) select $1, id, 'taller', 'running', $2, now(), now() from projects where slug = 'workia' returning id`, [agentId, moved[1]]);
  o = (await card()).orders.find((x: Json) => x.key === order);
  assert.equal(o.run?.ticket, moved[1]);
  await raw.query(`delete from agent_runs where id = $1`, [run.rows[0].id]);
  await raw.query(`update tasks set status = 'In review' where key = $1`, [moved[1]]);
  assert.equal((await card()).orders.find((x: Json) => x.key === order).stage, "pruebalo");
  await raw.query(`update tasks set status = 'Done' where key = $1`, [moved[1]]);
  assert.equal((await card()).orders.find((x: Json) => x.key === order).stage, "listo");

  const other = ((await (await post("/api/company/projects/workia/ask", { text: "Agrega cupones" })).json()) as Json).key as string;
  const second = (await propose(db, plan(other, { title: "Cupones" }), PO() as never)) as Json;
  const moved2 = await moveAll(second.proposal.created as string[]);
  assert.equal((await post(`/api/company/projects/workia/orders/${other}/cancel`)).status, 200);
  const statuses = (await raw.query(`select status from tasks where key = any($1)`, [moved2])).rows.map((r) => r.status);
  assert.deepEqual(statuses, ["Won't do", "Won't do"]);
});
