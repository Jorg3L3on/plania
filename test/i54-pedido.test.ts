// PLA-I54-3: the «Pedido» tab's routes. The detail (trail and the idea's ficha), answering the PO's question in place,
// a note on the idea, Guardar / Restaurar and Descartar, all cookie-only. Throwaway store, fake values only.
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { ne, resetTestStore, useOwnerCode, useTestEnv, type TestStore } from "./helpers.js";

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
const questionsMod = await import("../src/mcp/questions.js");
const docsMod = await import("../src/mcp/docs.js");
const pedido = await import("../src/api/company-pedido.js");

type Json = Record<string, any>;
let store: TestStore;
let db: ReturnType<typeof makeDb>["db"];
let closeDb: () => Promise<void>;
const jorge = () => ({ Cookie: `${SESSION_COOKIE}=${createSession()}`, "Content-Type": "application/json" });
const post = (url: string, body: Json = {}) => app.request(url, { method: "POST", headers: jorge(), body: JSON.stringify(body) });
const get = async (url: string) => {
  const res = await app.request(url, { headers: jorge() });
  return { status: res.status, body: (await res.json()) as Json };
};
const card = async (): Promise<Json> => ((await get("/api/company")).body.projects as Json[]).find((p) => p.slug === "micasa")!;
const versionOf = async (key: string) => (await store.get("tasks", { key }))!.version;
const deleteRuns = () => store.fix((uow) => uow.delete("agentRuns", {}));
const PO = { actor: { agent: "po-micasa", session_id: "run-0000abcd" } };
const forma = async (text: string) => {
  const res = await post("/api/company/projects/micasa/ask", { text, mode: "forma" });
  assert.equal(res.status, 201, await res.clone().text());
  return ((await res.json()) as Json).key as string;
};
const detail = async (key: string) => {
  const r = await get(`/api/company/projects/micasa/pedidos/${key}`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body;
};

before(async () => {
  store = await resetTestStore();
  ({ db, close: closeDb } = makeDb());
  await seedOrg(db);
  const micasa = await store.projectId("micasa");
  await store.fix((uow) => uow.insert("goals", { projectId: micasa, title: "Lanzar la beta" }));
});
beforeEach(async () => {
  await store.fix(async (uow) => {
    await uow.delete("agentRuns", {});
    await uow.update("runnerSettings", {}, { companyPaused: false });
    await uow.update("projects", { slug: ne("micasa") }, { runsPaused: true });
    await uow.update("projects", { slug: "micasa" }, { runsPaused: false });
  });
});
after(async () => {
  await closeDb?.();
  await store?.end();
});

test("I54-3 #1: the detail carries the owner's words, the trail (events, docs, questions) and the idea's ficha", async () => {
  const key = await forma("Compartir la ficha por enlace\nSin crear cuenta.");
  await writes.setTask(db, { project: "micasa", key, note: "Entendí: un enlace de solo lectura." } as never, PO);
  await docsMod.attachDoc(db, { project: "micasa", key, title: "Idea", markdown: "## Problem\nLa novia no ve su ficha.\n## Who it is for\nNovias\n## Why now\nLlaman mucho\n## Tamaño\nMediano: tres tickets.\n## Riesgos\nQue el enlace se reenvíe." }, PO);
  await writes.setTask(db, { project: "micasa", key, stage: "research", version: await versionOf(key) } as never, PO);
  await docsMod.attachDoc(db, { project: "micasa", key, title: "Research", markdown: "## What we learned\nx\n## Options\ny\n## Recommendation\nEnlace que vence a los 7 días." }, PO);
  const d = await detail(key);
  assert.deepEqual([d.key, d.mode, d.stop, d.status, d.text], [key, "forma", "investigacion", "Open", "Compartir la ficha por enlace\nSin crear cuenta."]);
  assert.deepEqual(
    d.trail.map((e: Json) => [e.who, e.kind]),
    [["jorge", "pedido"], ["product-owner", "entendi"], ["product-owner", "doc"], ["product-owner", "etapa"], ["product-owner", "doc"]],
  );
  assert.equal(d.trail[3].text, "La pasó a Investigación.");
  assert.equal(d.trail[2].doc.title, "Idea");
  assert.deepEqual(d.ficha, { problema: "La novia no ve su ficha.", tamano: "Mediano: tres tickets.", solucion: "Enlace que vence a los 7 días.", riesgos: "Que el enlace se reenvíe.", fuera: null });
  assert.deepEqual(d.pictures, [], "F5 fills the pictures");
  // Not an owner's idea, another project, no cookie: refused.
  const po = (await writes.createTask(db, { project: "micasa", kind: "idea", title: "Del PO" } as never, PO)) as Json;
  assert.equal((await get(`/api/company/projects/micasa/pedidos/${po.key}`)).status, 404);
  assert.equal((await get(`/api/company/projects/zigzag/pedidos/${key}`)).status, 404);
  assert.equal((await app.request(`/api/company/projects/micasa/pedidos/${key}`)).status, 401);
  assert.equal((await app.request(`/api/company/projects/micasa/pedidos/${key}`, { headers: { Authorization: "Bearer test-token" } })).status, 403);
  // The ficha's headings: the Spanish one first, the stage docs' own after it.
  assert.deepEqual(pedido.fichaOf([{ markdown: "## Solución\nA\n## Approach\nB" }]).solucion, "A");
  assert.equal(pedido.section("# T\n## Fuera\n\n## Riesgos\nr", "Fuera"), null, "an empty heading is Pendiente");
});

test("I54-3 #2: answering the PO's question in place clears «Te espera» and wakes the PO that asked", async () => {
  const key = await forma("Que el registro pida menos datos");
  await deleteRuns();
  await questionsMod.ask(db, { project: "micasa", key, question: "¿Quitamos el segundo teléfono?", options: ["Quitarlo", "Opcional"] }, PO);
  let d = await detail(key);
  assert.equal(d.state, "espera");
  assert.deepEqual([d.question.text, d.question_options], ["¿Quitamos el segundo teléfono?", ["Quitarlo", "Opcional"]]);
  assert.equal((await card()).pedidos.find((x: Json) => x.key === key).state, "espera");
  const res = await post(`/api/projects/micasa/questions/${d.question.id}/answer`, { answer: "Opcional" });
  assert.equal(res.status, 200, await res.clone().text());
  d = await detail(key);
  assert.notEqual(d.state, "espera");
  assert.equal(d.question, null);
  assert.deepEqual(d.trail.slice(-2).map((e: Json) => [e.who, e.kind, e.text]), [["product-owner", "pregunta", "Preguntó: ¿Quitamos el segundo teléfono?"], ["jorge", "respuesta", "Opcional"]]);
  assert.notEqual((await card()).pedidos.find((x: Json) => x.key === key).state, "espera");
  const po = (await store.get("agents", { slug: "po-micasa" }))!;
  const woke = await store.find("agentRuns", { agentId: po.id, taskKey: key, status: "queued" });
  assert.equal(woke.length, 1);
  assert.match(woke[0]!.summary, /question answered/);
});

test("I54-3 #3: a note is stored on the idea and shows in the trail", async () => {
  const key = await forma("Recordatorio por WhatsApp");
  const res = await post(`/api/company/projects/micasa/tasks/${key}/note`, { text: "A las 6 de la tarde, no antes." });
  assert.equal(res.status, 200);
  const notes = await store.find("events", { taskKey: key, type: "note" });
  assert.equal(notes.length, 1);
  const d = await detail(key);
  const lastItem = d.trail.at(-1)!;
  assert.deepEqual([lastItem.who, lastItem.kind, lastItem.text], ["jorge", "nota", "A las 6 de la tarde, no antes."]);
});

test("I54-3 #4: Guardar takes it off the tube to Guardadas and Restaurar brings it back; Descartar closes it with its reason", async () => {
  const key = await forma("Usar el panel sin conexión");
  const other = await forma("Exportar a PDF");
  const g = await post(`/api/company/projects/micasa/pedidos/${key}/guardar`);
  assert.deepEqual([g.status, ((await g.json()) as Json).guardada], [200, true]);
  let mine = ((await card()).pedidos as Json[]).filter((x) => x.key === key || x.key === other);
  assert.deepEqual(mine.map((x) => [x.key, x.guardada]), [[key, true], [other, false]]);
  assert.equal((await post(`/api/company/projects/micasa/pedidos/${key}/guardar`)).status, 409, "already saved");
  assert.equal((await detail(key)).trail.at(-1).kind, "guardada");
  const r = await post(`/api/company/projects/micasa/pedidos/${key}/restaurar`);
  assert.deepEqual([r.status, ((await r.json()) as Json).guardada], [200, false]);
  mine = ((await card()).pedidos as Json[]).filter((x) => x.key === key);
  assert.equal(mine[0]!.guardada, false);
  assert.equal((await post(`/api/company/projects/micasa/pedidos/${key}/restaurar`)).status, 409, "not on the shelf");
  // Descartar: Won't do with the reason as its note; it leaves the payload; nothing more can be done to it.
  const x = await post(`/api/company/projects/micasa/pedidos/${other}/descartar`, { reason: "Ya no hace falta" });
  assert.equal(x.status, 200, await x.clone().text());
  const t = (await store.get("tasks", { key: other }))!;
  assert.equal(t.status, "Won't do");
  const [lastNote] = await store.find("events", { taskKey: other, type: "note" }, { orderBy: [{ column: "id", desc: true }], limit: 1 });
  const note = (lastNote!.payload as Json).text;
  assert.equal(note, "Descartada por Jorge desde Compañía: Ya no hace falta");
  assert.equal(((await card()).pedidos as Json[]).some((p) => p.key === other), false);
  assert.equal((await post(`/api/company/projects/micasa/pedidos/${other}/guardar`)).status, 409);
  assert.equal((await post(`/api/company/projects/micasa/pedidos/${other}/descartar`)).status, 409);
  assert.deepEqual([(await detail(other)).trail.at(-1).kind, (await detail(other)).trail.at(-1).text], ["descartada", "La descartaste: Ya no hace falta"]);
  assert.equal((await post(`/api/company/projects/micasa/pedidos/MIC-IDEA999/guardar`)).status, 404);
});
