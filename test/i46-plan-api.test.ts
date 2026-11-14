// PLA-I46-11: a plan for a leg that the owner accepts on the floor. Throwaway database, fake names only.
//   #1  the PO's plan (≤4 steps, ≤3 closed questions with a suggestion, a 3-line check list) is the floor's move
//   #2  Aceptar plan with a changed answer and an edited list makes the steps under the leg; the leg is the route's
//       «here» with its steps; Taller can pick the first one
//   #3  Después leaves the plan waiting: no ticket, no move, and the floor does not ask the PO to plan again
//   #4  the edited check list is stored on every step (tasks.po_checklist, get_task po_checklist) and QA can tick it
//   and: Cambiar algo sends a new order to the PO; planning never starts postponed work (On hold leg, Backlog step)
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
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
const { ensureMember } = await import("../src/runner/team.js");
const { propose, checkProposal } = await import("../src/mcp/proposals.js");
const { poChecklistOf, tickPoCheck } = await import("../src/mcp/po-checklist.js");
const { loadReady, pickReady } = await import("../src/jobs/heartbeat.js");
const { createMcpServer } = await import("../src/mcp/register.js");

type Json = Record<string, any>;
let raw: pg.Client;
let db: ReturnType<typeof makeDb>["db"];
let closeDb: () => Promise<void>;
let client: Client;
let po = "";
const jorge = () => ({ Cookie: `${SESSION_COOKIE}=${createSession()}`, "Content-Type": "application/json" });
const company = async (): Promise<Json> => (await (await app.request("/api/company", { headers: jorge() })).json()) as Json;
const card = async () => (await company()).projects.find((p: Json) => p.slug === "micasa") as Json;
const post = (url: string, body: unknown = {}, method = "POST") => app.request(url, { method, headers: jorge(), body: JSON.stringify(body) });
const act = (id: string, body: unknown) => post(`/api/company/decisions/${encodeURIComponent(id)}`, body);
const PO = () => ({ actor: { agent: po, session_id: "s-po-micasa" } });
const SYS = { actor: { agent: "test", session_id: "s-test" } };
const make = (input: Json) => writes.createTask(db, { project: "micasa", scope: "s", ...input } as never, SYS as never);
const under = async (key: string) => (await raw.query(`select t.key, t.status, t.phase, t.po_checklist, t.scope from tasks t join tasks p on p.id = t.parent_id where p.key = $1 order by t.phase, t.key`, [key])).rows as Json[];
const status = async (key: string) => (await raw.query(`select status from tasks where key = $1`, [key])).rows[0]?.status as string;

const LIST = ["Sale el nombre de la novia", "El botón abre WhatsApp", "Se lee bien a 390"];
const legPlan = (order: string, patch: Json = {}) => ({
  project: "micasa",
  kind: "plan" as const,
  title: "Ajustes finales y entrega",
  order,
  understood: "cerrar el registro con la pantalla de gracias y la exportación",
  steps: [
    { title: "Pantalla de gracias con WhatsApp", done_when: "la novia ve su nombre y el botón abre WhatsApp" },
    { title: "Exportar desde el panel", done_when: "el panel baja un archivo con los registros" },
    { title: "Repaso final con la boutique", done_when: "la boutique revisó todo en la copia de prueba", work_type: "ops" },
  ],
  questions: [
    { text: "¿Quién recibe el aviso?", options: ["Solo la boutique", "La boutique y yo"], suggested: 0 },
    { text: "¿Exportar en Excel o CSV?", options: ["Excel", "CSV"], suggested: 0 },
    { text: "¿El hosting sigue pospuesto?", options: ["Sí", "No"], suggested: 0 },
  ],
  checklist: LIST,
  ...patch,
});
// The order Que PO lo planee sends (company-move.ts PLAN_LEG), as the PO receives it.
const orderFor = async (title: string) => ((await (await post("/api/company/projects/micasa/ask", { text: `Planea «${title}»: sus pasos y qué significa hecho en cada uno.` })).json()) as Json).key as string;

before(async () => {
  raw = await resetTestDb();
  ({ db, close: closeDb } = makeDb());
  await seedOrg(db);
  await raw.query(`update projects set runs_paused = false where slug = 'micasa'`);
  await raw.query(`update runner_settings set max_concurrent = 0`); // a wake queues; nothing is spawned
  const p = (await raw.query(`select id, slug, title from projects where slug = 'micasa'`)).rows[0] as { id: string; slug: string; title: string };
  await ensureMember(db, p, "product-owner", { reportsTo: "ceo", note: "test" });
  await ensureMember(db, p, "taller", { reportsTo: "ceo", note: "test" });
  await raw.query(`insert into goals (project_id, title) values ($1, 'Registro listo para la boutique')`, [p.id]);
  po = (await raw.query(`select slug from agents where project_id = $1 and role_template = 'product-owner'`, [p.id])).rows[0].slug;

  // I1 is postponed on purpose (one Backlog step left), I2 is done and Active, I3 has no steps, I4 is On hold.
  await make({ kind: "initiative", key: "MIC-I1", title: "Arranque" });
  await make({ key: "MIC-I1-1", parent_key: "MIC-I1", title: "Hosting propio", checks: ["c"], status: "Backlog" });
  await make({ kind: "initiative", key: "MIC-I2", title: "Contacto" });
  await make({ key: "MIC-I2-1", parent_key: "MIC-I2", phase: 1, title: "Avisos al equipo", checks: ["c"], status: "Ready" });
  await make({ kind: "initiative", key: "MIC-I3", title: "Ajustes finales y entrega" });
  await make({ kind: "initiative", key: "MIC-I4", title: "Dominio propio" });
  await raw.query(`update tasks set status = 'Active' where key in ('MIC-I1', 'MIC-I2')`);
  await raw.query(`update tasks set status = 'Done', status_changed_at = now() where key = 'MIC-I2-1'`);
  await raw.query(`update tasks set status = 'On hold' where key = 'MIC-I4'`);

  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createMcpServer(db).connect(serverSide);
  client = new Client({ name: "i46-plan", version: "0" });
  await client.connect(clientSide);
});

after(async () => {
  await client.close();
  await closeDb();
  await raw.end();
});

test("the plan's shape: at most 4 steps, 3 closed questions with a suggestion inside its answers, exactly 3 checks", () => {
  const base = legPlan("MIC-9", { leg: "MIC-I3" });
  const ok = checkProposal(base, false, []);
  assert.deepEqual([ok.needs_approval, ok.leg, ok.questions!.length, ok.checklist], [true, "MIC-I3", 3, LIST], "a leg plan always waits for the owner");
  const bad = (patch: Json) => assert.throws(() => checkProposal({ ...base, ...patch }, false, []), /INVALID_FILTER/);
  bad({ steps: Array.from({ length: 5 }, (_, i) => ({ title: `p${i}`, done_when: "x" })) });
  bad({ questions: [...base.questions, base.questions[0]] });
  bad({ questions: [{ text: "¿Sí?", options: ["Sí"], suggested: 0 }] });
  bad({ questions: [{ text: "¿Sí?", options: ["Sí", "No"], suggested: 2 }] });
  bad({ checklist: LIST.slice(0, 2) });
  // An order's plan (PLA-I36-8) stays as it was: no questions or check list without a leg.
  assert.throws(() => checkProposal({ ...base, leg: undefined }, false, []), /INVALID_FILTER/);
});

let planId = "";
test("I46-11 #1: the PO's plan for the next leg is the floor's move, with its steps, questions and check list", async () => {
  assert.equal((await card()).next_move?.verbo, "planear", "I2 is done and I3 has no steps");
  const order = await orderFor("Ajustes finales y entrega");
  const out = (await propose(db, legPlan(order), PO() as never)) as Json;
  assert.equal(out.proposal.leg, "MIC-I3", "found from the order's «title»");
  assert.equal((await under("MIC-I3")).length, 0, "nothing is made before Aceptar plan");
  planId = `m-${out.message.id}`;
  const row = (await company()).decisions.find((d: Json) => d.id === planId);
  assert.deepEqual(row.actions, ["empezar", "cambiar", "despues"]);
  assert.deepEqual(row.plan.leg, { key: "MIC-I3", title: "Ajustes finales y entrega" });
  assert.deepEqual(row.plan.questions.map((q: Json) => q.suggested), [0, 0, 0]);
  assert.deepEqual(row.plan.checklist, LIST);
  assert.equal(row.plan.later_at, null);
  const move = (await card()).next_move;
  assert.deepEqual([move.verbo, move.texto, move.accion], ["aceptar", "Aceptar el plan de «Ajustes finales y entrega»", { kind: "decision", id: planId, action: "empezar", label: "Aceptar plan" }]);
});

test("I46-11 #3: Después leaves the plan waiting; nothing starts and the floor does not ask the PO again", async () => {
  const res = await act(planId, { action: "despues" });
  assert.equal(res.status, 200, await res.clone().text());
  const row = (await company()).decisions.find((d: Json) => d.id === planId);
  assert.ok(row.plan.later_at, "it waits");
  assert.equal(row.state, null, "still open: it can be accepted later");
  assert.equal((await under("MIC-I3")).length, 0, "no ticket");
  assert.equal((await card()).next_move, null, "not the owner's move, and no second Que PO lo planee");
  assert.equal(await status("MIC-I3"), "Planning");
});

test("I46-11 #2, #4: Aceptar plan with a changed answer and an edited list makes the steps under the leg, with the list on each", async () => {
  const edited = ["Sale el nombre de la novia", "El botón abre WhatsApp con el número de la boutique", "Se lee bien a 390"];
  assert.equal((await act(planId, { action: "empezar", answers: [1], checklist: ["a", "b"] })).status, 400, "the list keeps 3 lines");
  assert.equal((await act(planId, { action: "empezar", answers: [5] })).status, 400, "an answer outside the options");
  const res = await act(planId, { action: "empezar", answers: [1], checklist: edited });
  assert.equal(res.status, 200, await res.clone().text());
  const out = (await res.json()) as Json;
  assert.deepEqual(out.state.result.answers, [1, 0, 0], "the suggestion stays where he did not change it");

  const steps = await under("MIC-I3");
  assert.deepEqual(steps.map((s) => [s.status, s.phase]), [["Ready", 1], ["Ready", 2], ["Ready", 3]]);
  for (const s of steps) {
    assert.deepEqual(s.po_checklist.map((c: Json) => [c.n, c.text, c.done]), edited.map((t, i) => [i + 1, t, false]));
    assert.ok(s.scope.includes("¿Quién recibe el aviso?: La boutique y yo"), "the answer he picked");
    assert.ok(s.scope.includes("Check list del PO"));
  }
  assert.equal(await status("MIC-I3"), "Active");
  // The route stands on the new leg and names its steps.
  const route = (await card()).route;
  const leg = route.legs.find((l: Json) => l.key === "MIC-I3");
  assert.deepEqual([leg.state, leg.total, leg.steps[0].state], ["here", 3, "next"]);
  // Taller can pick the first step.
  const rows = (await loadReady(db)).filter((r) => r.project === "micasa");
  const taller = { id: "x", slug: "taller-micasa", role: "taller", capabilities: ["micasa"], projectSlug: "micasa" };
  assert.equal(pickReady(taller, rows)!.key, steps[0]!.key);
  assert.equal((await act(planId, { action: "empezar" })).status, 409, "twice is refused");

  // Postponed work stays postponed.
  assert.equal(await status("MIC-I1-1"), "Backlog");
  assert.equal(await status("MIC-I4"), "On hold");

  // #4: get_task shows the list; QA ticks a line.
  const got = JSON.parse(((await client.callTool({ name: "get_task", arguments: { project: "micasa", key: steps[0]!.key } })) as Json).content[0].text) as Json;
  assert.deepEqual(got.po_checklist.map((c: Json) => c.text), edited);
  const ticked = await tickPoCheck(db, { project: "micasa", key: steps[0]!.key, n: 2, done: true, by: "qa-micasa" });
  assert.deepEqual(ticked!.map((c) => c.done), [false, true, false]);
  assert.equal((await poChecklistOf(db, "micasa", steps[0]!.key))![1]!.done_by, "qa-micasa");
  assert.equal(await tickPoCheck(db, { project: "micasa", key: steps[0]!.key, n: 9, done: true, by: "qa" }), null);
  const plain = JSON.parse(((await client.callTool({ name: "get_task", arguments: { project: "micasa", key: "MIC-I2-1" } })) as Json).content[0].text) as Json;
  assert.equal("po_checklist" in plain, false, "a ticket without a list shows none");
});

test("Cambiar algo closes the order and sends the PO a new one with the leg and the change", async () => {
  await make({ kind: "initiative", key: "MIC-I5", title: "Fotos de vestidos" });
  const order = await orderFor("Fotos de vestidos");
  const out = (await propose(db, legPlan(order, { title: "Fotos de vestidos" }), PO() as never)) as Json;
  assert.equal(out.proposal.leg, "MIC-I5");
  const id = `m-${out.message.id}`;
  assert.equal((await act(id, { action: "cambiar" })).status, 409, "says what to change");
  const res = await act(id, { action: "cambiar", text: "Solo dos pasos" });
  assert.equal(res.status, 200, await res.clone().text());
  const next = ((await res.json()) as Json).state.result.order as string;
  assert.equal(await status(order), "Won't do");
  const scope = (await raw.query(`select scope from tasks where key = $1`, [next])).rows[0].scope as string;
  assert.ok(scope.includes("Planea «Fotos de vestidos» otra vez. Cambia esto: Solo dos pasos"), scope);
  assert.equal((await under("MIC-I5")).length, 0, "nothing made");
});

test("planning never starts postponed work: a plan for an On hold leg is refused", async () => {
  const order = await orderFor("Dominio propio");
  await assert.rejects(propose(db, legPlan(order, { title: "Dominio propio" }), PO() as never), /LEG_POSTPONED/);
  await assert.rejects(propose(db, legPlan(order, { leg: "MIC-I4" }), PO() as never), /LEG_POSTPONED/);
  assert.equal((await under("MIC-I4")).length, 0);
});
