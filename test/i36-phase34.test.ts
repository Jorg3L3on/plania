// PLA-I36 phases 3-4: the wheel on the card and anyone at the Mac can drive. Levers (PLA-I36-6), proposals as data
// (PLA-I36-7), one box with plan approval (PLA-I36-8), see it working (PLA-I36-9; stopping a live process is in
// test/runner.test.ts), evidence before accepting (PLA-I36-10), plain words and the owner's code (PLA-I36-11).
// Throwaway store for the payload and the routes, server-rendered UI with fake data. Fake names and numbers only.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import type { Actor } from "../src/db/schema.js";
import { TEST_BEARER, ownerCode, resetTestStore, useOwnerCode, useTestEnv, type TestStore } from "./helpers.js";

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
let store: TestStore;
let db: ReturnType<typeof makeDb>["db"];
let closeDb: () => Promise<void>;
let po = "";
const jorge = () => ({ Cookie: `${SESSION_COOKIE}=${createSession()}`, "Content-Type": "application/json" });
const company = async (): Promise<Json> => (await (await app.request("/api/company", { headers: jorge() })).json()) as Json;
const card = async (slug = "workia") => (await company()).projects.find((p: Json) => p.slug === slug) as Json;
const post = (url: string, body: unknown = {}, method = "POST") => app.request(url, { method, headers: jorge(), body: JSON.stringify(body) });
const act = (id: string, body: unknown) => post(`/api/company/decisions/${encodeURIComponent(id)}`, body);
const PO = () => ({ actor: { agent: po, session_id: "s-po-workia" } });
const steps = async () =>
  (await store.find("tasks", {}, { orderBy: [{ column: "key" }] })).filter((t) => t.scope.startsWith("Paso del pedido")).map((t) => ({ key: t.key, status: t.status }));
// The ticket with that key, for a fix that touches it or a row that points at it.
const taskOf = async (key: string) => {
  const task = await store.get("tasks", { key });
  if (!task) throw new Error(`no task ${key}`);
  return task;
};
// The workia project's thread.
const workiaThread = async () => (await store.get("threads", { kind: "project", projectId: await store.projectId("workia") }))!.id;

before(async () => {
  store = await resetTestStore();
  ({ db, close: closeDb } = makeDb());
  await seedOrg(db);
  await store.fix(async (uow) => {
    await uow.update("projects", { slug: ["workia", "filmia"] }, { runsPaused: false });
    // The one runner_settings row: the migration seeds it on Postgres; on devva this makes it.
    if (!(await uow.get("runnerSettings", { id: 1 }))) await uow.insert("runnerSettings", { id: 1 });
    await uow.update("runnerSettings", { id: 1 }, { maxConcurrent: 0 }); // a wake queues; nothing is spawned
  });
  const row = (await store.get("projects", { slug: "workia" }))!;
  const p = { id: row.id, slug: row.slug, title: row.title };
  await ensureMember(db, p, "product-owner", { reportsTo: "ceo", note: "test" });
  po = (await store.get("agents", { projectId: p.id, roleTemplate: "product-owner" }))!.slug;
});

after(async () => {
  await closeDb?.();
  await store?.end();
});

// ---- PLA-I36-6

test("I36-6 #1: a message from the card creates the PO's ticket and shows its wake state", async () => {
  const res = await post("/api/company/projects/workia/ask", { text: "Agrega un botón de WhatsApp", kind: "cambio", now: false });
  assert.equal(res.status, 201, await res.clone().text());
  const out = (await res.json()) as Json;
  assert.equal(out.wake, "queued");
  assert.equal(out.woke, null);
  assert.equal(lib.askText(out), "Enviado · el PO lo toma en su turno");
  const scope = await taskOf(out.key);
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
  const thread = await workiaThread();
  await store.fix((uow) =>
    uow.insert("threadMessages", { threadId: thread, authorAgent: po, authorRole: "product-owner", body: "Sigo con lo demás mientras decides.", at: new Date(Date.now() + 60_000) }),
  );
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
  assert.equal(PROTOCOL_VERSION, "2.22");
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
  const order = ((await (await post("/api/company/projects/workia/ask", { text: "Pon un botón de WhatsApp", kind: "cambio", now: false })).json()) as Json).key as string;
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
  for (const t of ["Lo entendí:", "Hecho cuando: el botón abre WhatsApp en el teléfono", "Aprobar el plan", "Se crean sus pasos y Taller empieza.", "Cambiar algo", "Cancelar"]) assert.ok(html.includes(t), t);

  const go = await act(row.id, { action: "empezar" });
  assert.equal(go.status, 200, await go.clone().text());
  const made = (await steps()).slice(before);
  assert.equal(made.length, 2);
  assert.ok(made.every((s) => s.status === "Ready"));
  const after1 = (await card()).orders.find((x: Json) => x.key === order);
  assert.deepEqual([after1.stage, after1.plan.approved, after1.plan.steps], ["trabajando", true, 2]);
  assert.equal((await act(row.id, { action: "empezar" })).status, 409, "twice is refused");
  await store.fix((uow) => uow.update("tasks", { key: made.map((s) => s.key) }, { status: "In review" }));
  assert.equal((await card()).orders.find((x: Json) => x.key === order).stage, "pruebalo");
  await store.fix((uow) => uow.update("tasks", { key: made.map((s) => s.key) }, { status: "Done" }));
  assert.equal((await card()).orders.find((x: Json) => x.key === order).stage, "listo");
});

test("I36-8: Cambiar algo closes the order and hands its words back to the box", async () => {
  const order = ((await (await post("/api/company/projects/workia/ask", { text: "Agrega un mapa de la tienda", now: false })).json()) as Json).key as string;
  const out = (await propose(db, plan(order, { title: "Mapa" }), PO() as never)) as Json;
  const res = await act(`m-${out.message.id}`, { action: "cambiar" });
  assert.equal(res.status, 200);
  assert.equal(((await res.json()) as Json).state.result.text, "Agrega un mapa de la tienda");
  assert.equal((await taskOf(order)).status, "Won't do");
});

test("I36-8 #3: with the switch off, the plan's tickets start at once and the plan is information", async () => {
  await post("/api/company/projects/workia/options", { plan_approval: false }, "PUT");
  const order = ((await (await post("/api/company/projects/workia/ask", { text: "Agrega horarios", now: false })).json()) as Json).key as string;
  const before = (await steps()).length;
  const out = (await propose(db, plan(order, { title: "Horarios" }), PO() as never)) as Json;
  assert.equal(out.proposal.needs_approval, false);
  assert.equal((await steps()).length, before + 2);
  assert.equal((await company()).decisions.some((d: Json) => d.id === `m-${out.message.id}`), false, "no decision to make");
  const o = (await card()).orders.find((x: Json) => x.key === order);
  assert.deepEqual([o.plan.approved, o.stage], [true, "trabajando"]);
});

test("I36-8 #4: Cancelar closes the order and its tickets", async () => {
  const order = ((await (await post("/api/company/projects/workia/ask", { text: "Agrega reseñas", now: false })).json()) as Json).key as string;
  const out = (await propose(db, plan(order, { title: "Reseñas" }), PO() as never)) as Json;
  const made = out.proposal.created as string[];
  assert.equal(made.length, 2);
  const res = await post(`/api/company/projects/workia/orders/${order}/cancel`);
  assert.equal(res.status, 200, await res.clone().text());
  const statuses = (await store.find("tasks", { key: [order, ...made] })).map((r) => r.status);
  assert.deepEqual(statuses, ["Won't do", "Won't do", "Won't do"]);
  assert.equal((await card()).orders.find((x: Json) => x.key === order).stage, "cancelada");
});

// ---- PLA-I36-9

test("I36-9 #1, #4: a live run shows bot, step, since and last action; a note reaches the ticket", async () => {
  const [step] = (await store.find("tasks", { status: "Ready" }, { orderBy: [{ column: "key" }] })).filter((t) => t.scope.startsWith("Paso del pedido")).slice(0, 1);
  const order = (await card()).orders.find((o: Json) => o.plan?.approved && o.stage === "trabajando");
  const agentId = (await store.get("agents", { slug: "taller" }))?.id ?? (await store.get("agents", { roleTemplate: "taller" }))?.id;
  const workia = await store.projectId("workia");
  const twelveMinutesAgo = new Date(Date.now() - 12 * 60_000);
  const ins = await store.fix((uow) =>
    uow.insert("agentRuns", { agentId: agentId!, projectId: workia, role: "taller", status: "running", taskKey: step!.key, startedAt: twelveMinutesAgo, queuedAt: twelveMinutesAgo }),
  );
  const runId = ins.id;
  await store.fix((uow) => uow.insert("events", { projectId: workia, taskKey: step!.key, type: "result.added", actor: { agent: "taller", session_id: `run-${runId.slice(0, 8)}` }, payload: {} }));
  const o = (await card()).orders.find((x: Json) => x.key === order.key);
  assert.ok(o.run, "the request shows its run");
  assert.deepEqual([o.run.role, o.run.status, o.run.ticket, o.run.last], ["taller", "running", step!.key, "registró pruebas"]);
  assert.ok(o.run.step.length > 0 && o.run.since);
  // PLA-I39: the run shows as its teammate's lit window and Detener lives in that teammate's side page.
  const note = await post(`/api/company/projects/workia/tasks/${step!.key}/note`, { text: "usa el verde de la marca" });
  assert.equal(note.status, 200);
  const [noteEvent] = await store.find("events", { taskKey: step!.key, type: "note" }, { orderBy: [{ column: "id", desc: true }], limit: 1 });
  const ev = { text: noteEvent!.payload.text };
  assert.equal(ev.text, "De Compañía: usa el verde de la marca");
  // Not live in this process: Detener says so, the project keeps running.
  const stop = await post(`/api/company/runs/${runId}/stop`);
  assert.equal(stop.status, 409);
  await store.fix((uow) => uow.update("agentRuns", { id: runId }, { status: "stopped", endedAt: uow.now }));
  const stopped = (await card()).orders.find((x: Json) => x.key === order.key);
  assert.equal(stopped.run.status, "stopped");
});

// ---- PLA-I36-10

test("I36-10 #1-#4: a delivery shows pass and fail counts, files and the preview; Aceptar holds while red; Pedir cambios sends it back", async () => {
  const t = (await writes.createTask(db, { project: "workia", title: "Galería de fotos", scope: "s", checks: ["c1"], owner_agent: po } as never, PO())) as Json;
  const url = "https://github.com/x/workia/pull/31";
  await store.fix(async (uow) => {
    for (const task of await uow.update("tasks", { key: t.key }, { status: "In review", prUrl: url })) {
      await uow.insert("results", { taskId: task.id, kind: "test", verdict: "fail", cite: "pnpm test", counts: { pass: 40, fail: 2 }, actor: { agent: "taller" } as Actor });
      await uow.insert("pullRequests", { projectId: task.projectId, repo: "x/workia", number: 31, url, title: "pr", taskId: task.id, state: "open", ciState: "success", changedFiles: 8 });
    }
  });
  const thread = await workiaThread();
  await store.fix((uow) =>
    uow.insert("threadMessages", {
      threadId: thread,
      authorAgent: "taller",
      authorRole: "taller",
      body: "Listo para revisar.",
      links: [
        { kind: "ticket", ref: t.key, title: "Galería de fotos" },
        { kind: "pr", ref: url, title: "PR" },
      ],
      at: new Date(Date.now() + 5 * 60_000),
    }),
  );
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
  const galeria = await taskOf(t.key);
  await store.fix(async (uow) => {
    await uow.update("checks", { taskId: galeria.id }, { done: true });
    await uow.insert("results", { taskId: galeria.id, kind: "test", verdict: "pass", cite: "pnpm test", counts: { pass: 42, fail: 0 }, actor: { agent: "taller" } as Actor });
  });
  await post("/api/company/projects/workia/options", { preview_url: "https://workia-preview.test" }, "PUT");
  d = await find();
  assert.equal(d.hold, null);
  html = renderTeToca([d]);
  assert.equal(fusionar(html).includes(' disabled=""'), false, "Aceptar enabled when all pass");
  assert.ok(html.includes('href="https://workia-preview.test"') && html.includes("Ver la vista previa"));
  assert.equal((await post("/api/company/projects/workia/options", { preview_url: "javascript:alert(1)" }, "PUT")).status, 400);
  const back = await act(d.id, { action: "cambios", text: "la galería se corta en el teléfono" });
  assert.equal(back.status, 200, await back.clone().text());
  const row = await taskOf(t.key);
  assert.equal(row.status, "Ready");
  const [noteEvent] = await store.find("events", { taskKey: t.key, type: "note" }, { orderBy: [{ column: "id", desc: true }], limit: 1 });
  const note = { text: noteEvent!.payload.text as string };
  assert.match(note.text, /la galería se corta en el teléfono/);
});

// ---- PLA-14

test("PLA-14 #2, #3: a repo with no CI says so and Aceptar opens with a pass on the head; real CI pending or red still holds", async () => {
  const t = (await writes.createTask(db, { project: "workia", title: "Sin CI", scope: "s", checks: ["c1"], owner_agent: po } as never, PO())) as Json;
  const url = "https://github.com/x/workia/pull/32";
  const OLD = "1111111aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const HEAD = "2222222bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const sinCi = await taskOf(t.key);
  await store.fix(async (uow) => {
    await uow.update("tasks", { key: t.key }, { status: "In review", prUrl: url });
    await uow.update("checks", { taskId: sinCi.id }, { done: true });
    await uow.insert("pullRequests", {
      projectId: sinCi.projectId,
      repo: "x/workia",
      number: 32,
      url,
      title: "pr",
      taskId: sinCi.id,
      state: "open",
      ciState: "none",
      headSha: HEAD,
      headBranch: "jl/sin-ci",
      changedFiles: 3,
    });
  });
  const pass = (commit: string) =>
    store.fix((uow) =>
      uow.insert("results", { taskId: sinCi.id, kind: "test", verdict: "pass", cite: "pnpm test", counts: { pass: 56, fail: 0 }, commit, branch: "jl/sin-ci", actor: { agent: "taller" } as Actor }),
    );
  await pass(OLD);
  const thread = await workiaThread();
  await store.fix((uow) =>
    uow.insert("threadMessages", {
      threadId: thread,
      authorAgent: "taller",
      authorRole: "taller",
      body: "Listo para revisar.",
      links: [
        { kind: "ticket", ref: t.key, title: "Sin CI" },
        { kind: "pr", ref: url, title: "PR" },
      ],
      at: new Date(Date.now() + 10 * 60_000),
    }),
  );
  const find = async () => (await company()).decisions.find((d: Json) => d.ref === t.key && (d.kind === "pr" || d.kind === "deliverable"));
  const button = (h: string) => /<button[^>]*data-action="(?:fusionar|aceptar)"[^>]*>/.exec(h)![0];
  // A pass on an older commit is stale for the head: still held, and the reason names the missing CI.
  let d = await find();
  assert.deepEqual(d.checks, { open: 0, ci: "none" });
  assert.match(d.hold, /no tiene CI/);
  let html = renderTeToca([d]);
  assert.ok(html.includes("repo sin CI") && !html.includes("pruebas corriendo") && !html.includes("siguen corriendo"));
  assert.ok(button(html).includes(' disabled=""'));
  // Held only by the stale pass: the card offers asking the ticket's owner to run the checks again.
  assert.ok(d.actions.includes("verificar"));
  assert.match(html, /data-action="verificar"[^>]*>Que (el )?PO vuelva a probar/);
  // PLA-I60: its owner (the PO here) busy with another run no longer refuses: the check is a work item of its own.
  await store.fix(async (uow) => {
    const [newest] = await uow.find("agentRuns", {}, { orderBy: [{ column: "queuedAt", desc: true }], limit: 1 });
    await uow.update("agentRuns", { id: newest!.id }, { status: "running" });
  });
  const asked = await act(d.id, { action: "verificar" });
  assert.equal(asked.status, 200, await asked.clone().text());
  await store.fix(async (uow) => {
    const owner = (await uow.get("agents", { slug: po }))!;
    await uow.update("agentRuns", { status: "running", agentId: owner.id }, { status: "ok", endedAt: uow.now });
  });
  const [run] = await store.find("agentRuns", { taskKey: t.key }, { orderBy: [{ column: "queuedAt", desc: true }], limit: 1 });
  assert.deepEqual({ status: run?.status, task_key: run?.taskKey }, { status: "queued", task_key: t.key }, "the owner wakes on that ticket");
  const [note] = await store.find("events", { taskKey: t.key, type: "note" }, { orderBy: [{ column: "id", desc: true }], limit: 1 });
  assert.match(String((note!.payload as Json).text), /volver a correr las pruebas en el último commit \(2222222\)/);
  assert.equal((await taskOf(t.key)).status, "In review", "the delivery stays as it is");
  // While that run is queued the card says so (no button, Aceptar still held); asking twice queues nothing more.
  d = await find();
  assert.equal(d.verify.state, "queued");
  assert.match(d.hold, /va a correr las pruebas en el último commit/);
  assert.equal(d.actions.includes("verificar"), false);
  html = renderTeToca([d]);
  assert.ok(html.includes('role="status"') && button(html).includes(' disabled=""'));
  await store.fix((uow) => uow.update("agentRuns", { taskKey: t.key }, { status: "running", startedAt: uow.now }));
  assert.match((await find()).hold, /está corriendo las pruebas/);
  await store.fix((uow) => uow.update("agentRuns", { taskKey: t.key }, { status: "skipped", endedAt: uow.now }));
  // A pass on the current head opens Aceptar.
  await pass(HEAD);
  d = await find();
  assert.equal(d.hold, null);
  html = renderTeToca([d]);
  assert.equal(button(html).includes(' disabled=""'), false, "Aceptar enabled with a fresh pass and no CI");
  // Real CI keeps today's behaviour, even with that fresh pass.
  await store.fix((uow) => uow.update("pullRequests", { url }, { ciState: "pending" }));
  d = await find();
  assert.equal(d.hold, "Las pruebas siguen corriendo.");
  assert.ok(button(renderTeToca([d])).includes(' disabled=""'));
  await store.fix((uow) => uow.update("pullRequests", { url }, { ciState: "failure" }));
  d = await find();
  assert.equal(d.hold, "Las pruebas fallan.");
  assert.ok(button(renderTeToca([d])).includes(' disabled=""'));
});

test("one card per delivery: a ticket said ready three times shows once, the newest; once acted the older ones stay out", async () => {
  const t = (await writes.createTask(db, { project: "workia", title: "Tres veces lista", scope: "s", checks: ["c1"], owner_agent: po } as never, PO())) as Json;
  const url = "https://github.com/x/workia/pull/41";
  await store.fix((uow) => uow.update("tasks", { key: t.key }, { status: "In review", prUrl: url }));
  const thread = await workiaThread();
  const links = [
    { kind: "ticket" as const, ref: t.key, title: "Tres veces lista" },
    { kind: "pr" as const, ref: url, title: "PR" },
  ];
  const ids: string[] = [];
  for (const [i, body] of ["Lista.", "Evidencia registrada.", "Lista para revisar."].entries()) {
    const m = await store.fix((uow) =>
      uow.insert("threadMessages", { threadId: thread, authorAgent: "taller", authorRole: "taller", body, links, at: new Date(uow.now.getTime() + (20 + i) * 60_000) }),
    );
    ids.push(m.id);
  }
  const cards = async () => (await company()).decisions.filter((d: Json) => d.ref === t.key);
  let mine = await cards();
  assert.equal(mine.length, 1);
  assert.equal(mine[0].id, `m-${ids[2]}`, "the newest message is the card");
  // Accepted on the newest: the older two do not come back with Aceptar.
  await store.fix((uow) => uow.update("threadMessages", { id: ids[2]! }, { actionState: { action: "aceptar", at: new Date().toISOString(), result: { merged: true } } as never }));
  mine = await cards();
  assert.deepEqual(mine.map((d: Json) => [d.id, d.actions]), [[`m-${ids[2]}`, []]]);
});

// ---- PLA-I36-11

test("PLA-24: publishing asks no owner's code, even with none enrolled; a Bearer is still refused", async () => {
  await useOwnerCode(false);
  for (const body of [{}, { code: "000000" }]) {
    const res = await app.request("/api/projects/zigzag/release/ship", { method: "POST", headers: jorge(), body: JSON.stringify(body) });
    const err = String(((await res.json()) as Json).error ?? "");
    assert.equal(err.startsWith("OWNER_CODE"), false, err);
  }
  const bearer = await app.request("/api/projects/zigzag/release/ship", { method: "POST", headers: { ...jorge(), Authorization: `Bearer ${TEST_BEARER}` }, body: "{}" });
  assert.equal(bearer.status, 403);
  assert.equal(((await bearer.json()) as Json).error, "HUMAN_ONLY");
  await useOwnerCode(true);
});

test("I36-11 #3: deleting a project without a valid code is refused, and a code is spent once; PLA-21: no limit to raise", async () => {
  assert.equal((await post("/api/company/budgets", { scope: "project", project: "workia", weekly_limit: 9_000_000 }, "PUT")).status, 404);
  const del = await post("/api/company/projects/filmia", {}, "DELETE");
  assert.equal(del.status, 403);
  assert.equal(await store.count("projects", { slug: "filmia" }), 1);
  const code = await ownerCode();
  const ok = await post("/api/company/projects/filmia", { code }, "DELETE");
  assert.equal(ok.status, 200);
  assert.equal(await store.count("projects", { slug: "filmia" }), 0);
  await store.fix((uow) => uow.insert("projects", { slug: "filmiados", title: "Filmia dos", keyPrefix: "FMD" }));
  assert.equal((await post("/api/company/projects/filmiados", { code }, "DELETE")).status, 403, "a code is spent once");
});

test("I36-11 #4: asking, approving a plan, stopping a run and accepting into the test copy need no code", async () => {
  const { readFileSync } = await import("node:fs");
  const company = readFileSync(new URL("../src/api/company.ts", import.meta.url), "utf8");
  const gated = [...company.matchAll(/checkOwnerCode\(/g)].length;
  assert.equal(gated, 1, "only delete project (PLA-21 removed the limits)");
  // Exercised above without a code: ask (I36-6), Sí, empiecen (I36-8), stop (I36-9), Pedir cambios (I36-10).
  const r = await post("/api/company/projects/workia/ask", { text: "Otra cosa pequeña", now: false });
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

// PLA-I53-3: the stage board's cards carry their key by the accepted Design doc of PLA-I53 (key, title, stage word);
// everything else on the floor still keeps keys inside Detalles.
const outsideDetalles = (html: string) => html.replace(/<section class="dark sb"[\s\S]*?<\/section>/g, "").replace(/<details[\s\S]*?<\/details>/g, "");

test("I36-11 #1: the page renders no ticket key, branch name or the word sandbox outside Detalles", async () => {
  const p = await card();
  const decisions = (await company()).decisions as Json[];
  const html = outsideDetalles(renderCard(p, steerStub()) + renderTeToca(decisions));
  // Free text written by bots (a message body opened with Ver mensaje) is theirs; the rendered rows are folded.
  assert.equal(/\b[A-Z]{2,5}-(I\d+-)?\d+\b/.test(html), false, html.match(/\b[A-Z]{2,5}-(I\d+-)?\d+\b/)?.[0] ?? "");
  assert.equal(/sandbox|jl\/|main\b/i.test(html.replace(/<[^>]+>/g, " ")), false);
  assert.ok(renderCard(p, steerStub()).includes("data-detalles"), "the keys live in Detalles");
  assert.equal(lib.stateText({ action: "fusionar", at: "x", result: {} }), "Aprobado · en la copia de prueba");
});

test("I36-8 #5: phone at 390: the floor's box and its button fit in one column", () => {
  const html = renderToStaticMarkup(
    React.createElement(MemoryRouter, null, React.createElement(ask.AskView, { project: { slug: "workia", title: "Workia" }, text: "", setText() {}, onSubmit() {} })),
  );
  // PLA-I54-1: a textarea, the two modes and the button, stacked in one column.
  assert.ok(html.includes("Pide algo para Workia") && html.includes("Darle forma"));
  assert.ok(html.includes('class="edi-ask-text"') && html.includes('class="edi-modes"'));
});

// ---- PLA-I36-12

test("I36-12 #1-#3: a plan whose tickets the PO moved under an initiative still shows their progress, its run and its stages; Cancelar closes them", async () => {
  await post("/api/company/projects/workia/options", { plan_approval: false }, "PUT");
  await writes.createTask(db, { project: "workia", kind: "initiative", key: "WRK-I9", title: "Tienda", scope: "s" } as never, PO());
  const moveAll = async (keys: string[]) => {
    const now: string[] = [];
    for (const k of keys) {
      const t = await taskOf(k);
      const out = (await writes.setTask(db, { project: "workia", key: k, version: t.version, parent_key: "WRK-I9" } as never, PO())) as Json;
      now.push(out.key as string);
    }
    return now;
  };
  const order = ((await (await post("/api/company/projects/workia/ask", { text: "Agrega un carrito", now: false })).json()) as Json).key as string;
  const out = (await propose(db, plan(order, { title: "Carrito" }), PO() as never)) as Json;
  const moved = await moveAll(out.proposal.created as string[]);
  assert.ok(moved.every((k) => k.startsWith("WRK-I9-")), moved.join(","));
  await store.fix((uow) => uow.update("tasks", { key: moved[0]! }, { status: "Done" }));
  let o = (await card()).orders.find((x: Json) => x.key === order);
  assert.deepEqual([o.plan.steps, o.plan.done, o.stage], [2, 1, "trabajando"]);
  // A run on a moved step shows on the request.
  const agentId = (await store.get("agents", { slug: po }))!.id;
  const workia = await store.projectId("workia");
  const run = await store.fix((uow) => uow.insert("agentRuns", { agentId, projectId: workia, role: "taller", status: "running", taskKey: moved[1]!, startedAt: uow.now, queuedAt: uow.now }));
  o = (await card()).orders.find((x: Json) => x.key === order);
  assert.equal(o.run?.ticket, moved[1]);
  await store.fix((uow) => uow.delete("agentRuns", { id: run.id }));
  await store.fix((uow) => uow.update("tasks", { key: moved[1]! }, { status: "In review" }));
  assert.equal((await card()).orders.find((x: Json) => x.key === order).stage, "pruebalo");
  await store.fix((uow) => uow.update("tasks", { key: moved[1]! }, { status: "Done" }));
  assert.equal((await card()).orders.find((x: Json) => x.key === order).stage, "listo");

  const other = ((await (await post("/api/company/projects/workia/ask", { text: "Agrega cupones", now: false })).json()) as Json).key as string;
  const second = (await propose(db, plan(other, { title: "Cupones" }), PO() as never)) as Json;
  const moved2 = await moveAll(second.proposal.created as string[]);
  assert.equal((await post(`/api/company/projects/workia/orders/${other}/cancel`)).status, 200);
  const statuses = (await store.find("tasks", { key: moved2 })).map((r) => r.status);
  assert.deepEqual(statuses, ["Won't do", "Won't do"]);
});

// ---- PLA-27 (last, so its orders do not push earlier ones out of the five shown)

test("PLA-27: a plan that needed no approval is accepted like any delivery once its order is In review", async () => {
  await post("/api/company/projects/workia/options", { plan_approval: false }, "PUT");
  const order = ((await (await post("/api/company/projects/workia/ask", { text: "Agrega contacto por WhatsApp", now: false })).json()) as Json).key as string;
  const out = (await propose(db, plan(order, { title: "Contacto" }), PO() as never)) as Json;
  assert.equal(out.proposal.needs_approval, false);
  const ordered = await taskOf(order);
  await store.fix(async (uow) => {
    await uow.update("tasks", { id: ordered.id }, { status: "In review" });
    await uow.update("checks", { taskId: ordered.id }, { done: true, doneAt: uow.now });
  });
  const id = `m-${out.message.id}`;
  const d = (await company()).decisions.find((x: Json) => x.id === id);
  assert.ok(d, "the plan's message shows as the order's delivery");
  assert.deepEqual([d.kind, d.actions], ["deliverable", ["aceptar", "cambios"]]);
  const res = await act(id, { action: "aceptar" });
  assert.equal(res.status, 200, await res.clone().text());
  assert.equal((await taskOf(order)).status, "Done");
  const again = await act(id, { action: "aceptar" });
  assert.deepEqual([again.status, ((await again.json()) as Json).error], [409, "ALREADY_ACTED"]);
});

test("PLA-27: a plan that waits for approval still refuses aceptar and takes Sí, empiecen", async () => {
  await post("/api/company/projects/workia/options", { plan_approval: true }, "PUT");
  const order = ((await (await post("/api/company/projects/workia/ask", { text: "Agrega exportar a Excel", now: false })).json()) as Json).key as string;
  const out = (await propose(db, plan(order, { title: "Excel" }), PO() as never)) as Json;
  assert.equal(out.proposal.needs_approval, true);
  const id = `m-${out.message.id}`;
  const refused = await act(id, { action: "aceptar" });
  assert.deepEqual([refused.status, ((await refused.json()) as Json).error], [400, "INVALID_ACTION"]);
  assert.equal((await act(id, { action: "empezar" })).status, 200);
  await post("/api/company/projects/workia/options", { plan_approval: false }, "PUT");
  const page = (await import("node:fs")).readFileSync(new URL("../ui/src/pages/ceo.tsx", import.meta.url), "utf8");
  assert.ok(page.includes('INVALID_ACTION: "Eso no se puede hacer aquí.'), "the screen says it in words");
});
