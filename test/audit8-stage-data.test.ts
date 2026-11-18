// AUDIT-8: an idea stage delivered as data (deliver_stage), its content checks, the doc it renders, the event that
// keeps the data, the owner's pick on a decision (with and without a change) and the idea read in both paths.
// Throwaway DB; fake values only.
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type pg from "pg";
import { resetTestDb, useOwnerCode, useTestEnv } from "./helpers.js";

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
const docsMod = await import("../src/mcp/docs.js");
const { createMcpServer } = await import("../src/mcp/register.js");
const { ensureMember } = await import("../src/runner/team.js");
const { forwardBlock } = await import("../src/mcp/ideas.js");
const stageDocs = await import("../src/mcp/stage-docs.js");
const { ideaDecisionRoutes, numbered } = await import("../src/api/company-idea.js");
const { sectionAll } = await import("../src/api/company-pedido.js");
const { STAGE_REASON } = await import("../src/runner/stages.js");
const { instructions, PROTOCOL_VERSION } = await import("../src/mcp/protocol.js");
const { checkStageData, renderStageDoc, isObservable, decisionStates, rewriteDecisionLine, deliverStage } = stageDocs;

type Json = Record<string, any>;
let raw: pg.Client;
let db: ReturnType<typeof makeDb>["db"];
let closeDb: () => Promise<void>;
let client: Client;
const jorge = () => ({ Cookie: `${SESSION_COOKIE}=${createSession()}`, "Content-Type": "application/json" });
const post = (url: string, body: Json = {}) => app.request(url, { method: "POST", headers: jorge(), body: JSON.stringify(body) });
const get = async (url: string) => {
  const res = await app.request(url, { headers: jorge() });
  return { status: res.status, body: (await res.json()) as Json };
};
// The owner's pick. The route lives in company-idea.ts and is mounted under /api/company by one line in company.ts.
const decide = async (key: string, body: Json, headers: Record<string, string> = jorge()) => {
  const res = await ideaDecisionRoutes.request(`/projects/micasa/ideas/${key}/decision`, { method: "POST", headers, body: JSON.stringify(body) });
  return { status: res.status, body: (await res.json()) as Json };
};
const versionOf = async (key: string) => (await raw.query(`select version from tasks where key = $1`, [key])).rows[0].version as number;
const stageOf = async (key: string) => (await raw.query(`select stage from tasks where key = $1`, [key])).rows[0].stage as string;
const docOf = async (key: string, title: string) => (await raw.query(`select d.markdown, d.version, d.actor, d.updated_at from docs d join tasks t on t.id = d.task_id where t.key = $1 and d.title = $2`, [key, title])).rows[0] as Json | undefined;
const eventsOf = async (key: string, type: string) => (await raw.query(`select payload, actor from events where task_key = $1 and type = $2 order by id`, [key, type])).rows as Json[];
const queued = async (key: string) => (await raw.query(`select a.slug from agent_runs r join agents a on a.id = r.agent_id where r.task_key = $1 and r.status = 'queued'`, [key])).rows.map((r) => r.slug as string);
const RUN = (seat: string) => ({ actor: { agent: "plania-runner", session_id: `${seat}-micasa-idea-20261117` } });
const idea = async (text: string) => {
  const res = await post("/api/company/projects/micasa/ask", { text, mode: "forma" });
  assert.equal(res.status, 201, await res.clone().text());
  return ((await res.json()) as Json).key as string;
};
const detail = async (key: string) => {
  const r = await get(`/api/company/projects/micasa/ideas/${key}`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body;
};
const move = async (key: string, stage: string, seat: string) => writes.setTask(db, { project: "micasa", key, stage, version: await versionOf(key) } as never, RUN(seat));
async function call(name: string, args: Json): Promise<Json> {
  const r = (await client.callTool({ name, arguments: { project: "micasa", ...RUN("po"), ...args } })) as { isError?: boolean; content: { text: string }[] };
  const data = JSON.parse(r.content[0]!.text) as Json;
  return r.isError ? { __error: data.error, ...data } : data;
}
const refused = (fn: () => unknown): Json => {
  try {
    fn();
  } catch (e) {
    return { code: (e as Json).code, ...(e as Json).detail };
  }
  assert.fail("it was not refused");
};

const IDEA = {
  problem: "Las clientas olvidan su prueba de vestido y la tienda pierde la cita.",
  who: "Recepción de MiCasa",
  why_now: "En noviembre se duplican las pruebas y hoy se avisa a mano.",
  decisions: [
    { question: "¿El aviso sale por WhatsApp o por correo?", options: ["WhatsApp", "Correo", "Los dos"], recommended: 0, why: "Casi todas las clientas contestan por WhatsApp el mismo día." },
    { question: "¿Se avisa también a la acompañante?", options: ["No", "Sí"], recommended: 0, why: "Hoy no se guarda su teléfono en la cita." },
  ],
};
const RESEARCH = {
  learned: ["La API de WhatsApp pide plantillas aprobadas.", "El 80% de las citas tiene celular guardado."],
  options: [
    { title: "Twilio", text: "Pago por mensaje y alta rápida; cuesta unos centavos por aviso." },
    { title: "Meta directo", text: "Sin intermediario, pero la alta tarda semanas." },
    { title: "Aviso manual asistido", text: "Un botón que abre WhatsApp con el texto listo." },
  ],
  recommendation: { option: 1, why: "A la larga cuesta menos y no depende de un tercero." },
  unknowns: ["Cuánto tarda Meta en aprobar la plantilla."],
};
const DESIGN = {
  approach: "Un recordatorio automático la víspera, configurado desde la ficha de la cita.",
  scope: ["Mensaje la víspera a las 18:00", "Interruptor por cita"],
  out_of_scope: ["Confirmar la cita desde el mensaje", "Avisos por correo"],
};
const PLAN = {
  steps: [
    { title: "Plantilla del mensaje", done_when: "La plantilla aparece aprobada en el panel de mensajes.", try_it: "Abre Ajustes, entra a Mensajes y lee la plantilla del recordatorio.", work_type: "ops" },
    { title: "Envío la víspera", done_when: "Una cita de mañana recibe el WhatsApp a las 18:00 de hoy.", try_it: "Crea una cita para mañana con tu número y espera el mensaje a las 18:00." },
  ],
  risks: ["Meta puede tardar en aprobar la plantilla."],
  size: "Mediano: una semana.",
};

before(async () => {
  raw = await resetTestDb();
  ({ db, close: closeDb } = makeDb());
  await seedOrg(db);
  const [p] = (await raw.query(`select id, slug, title from projects where slug = 'micasa'`)).rows;
  for (const t of ["research", "artist"] as const) await ensureMember(db, p, t, { reportsTo: "ceo", note: "test" });
  await raw.query(`insert into goals (project_id, title) values ($1, 'Lanzar la beta')`, [p.id]);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createMcpServer(db).connect(serverSide);
  client = new Client({ name: "test", version: "0" });
  await client.connect(clientSide);
});
beforeEach(async () => {
  await raw.query(`delete from agent_runs`);
  await raw.query(`update runner_settings set company_paused = false`);
  await raw.query(`update projects set runs_paused = (slug <> 'micasa')`);
});
after(async () => {
  await client?.close();
  await closeDb?.();
  await raw?.end();
});

// An idea of the owner's taken to Plan with deliver_stage, as the seats do it.
async function toPlan(text: string): Promise<string> {
  const key = await idea(text);
  await deliverStage(db, { project: "micasa", key, stage: "idea", data: IDEA }, RUN("po"));
  await writes.setTask(db, { project: "micasa", key, note: "Entendí: recordar la prueba por WhatsApp." } as never, RUN("po"));
  await move(key, "research", "po");
  await deliverStage(db, { project: "micasa", key, stage: "research", data: RESEARCH }, RUN("research"));
  await move(key, "design", "research");
  await deliverStage(db, { project: "micasa", key, stage: "design", data: DESIGN }, RUN("artist"));
  await move(key, "planning", "artist");
  await deliverStage(db, { project: "micasa", key, stage: "planning", data: PLAN }, RUN("po"));
  return key;
}

test("idea: accepted data comes back trimmed; a refusal names every field to fix", () => {
  const ok = checkStageData("idea", { ...IDEA, who: "  Recepción   de MiCasa \n" });
  assert.equal(ok.who, "Recepción   de MiCasa");
  assert.equal(ok.decisions.length, 2);
  assert.deepEqual(checkStageData("idea", { problem: IDEA.problem, who: IDEA.who, why_now: IDEA.why_now }).decisions, [], "no decision is fine");
  const no = refused(() => checkStageData("idea", { problem: "TBD", who: " ", why_now: IDEA.why_now, decisions: [{ question: "¿Aviso por WhatsApp o por correo?", options: ["WhatsApp"], why: "n/a" }] }));
  assert.equal(no.code, "STAGE_REQUIREMENTS_MISSING");
  assert.deepEqual(no.missing, ["problem", "who", "decisions[0].options", "decisions[0].recommended", "decisions[0].why"]);
  assert.equal(no.doc, "Idea");
  assert.match(no.fix["decisions[0].recommended"], /0-based index/);
  assert.match(no.hint, /call deliver_stage again/);
  // Malformed, not missing: too many, an index outside its options, a field the stage does not have, a wrong type.
  const many = refused(() => checkStageData("idea", { ...IDEA, decisions: Array.from({ length: 7 }, (_, i) => ({ ...IDEA.decisions[0], question: `¿Pregunta número ${i}?` })) }));
  assert.deepEqual([many.code, many.field], ["INVALID_FILTER", "decisions"]);
  const index = refused(() => checkStageData("idea", { ...IDEA, decisions: [{ ...IDEA.decisions[1], recommended: 2 }] }));
  assert.deepEqual([index.code, index.field], ["INVALID_FILTER", "decisions[0].recommended"]);
  const extra = refused(() => checkStageData("idea", { ...IDEA, solution: "x" }));
  assert.deepEqual([extra.code, extra.field], ["INVALID_FILTER", "solution"]);
  assert.match(extra.shape, /problem, who, why_now, decisions/);
  const type = refused(() => checkStageData("idea", { ...IDEA, problem: 7 }));
  assert.deepEqual([type.code, type.field], ["INVALID_FILTER", "problem"]);
  const twice = refused(() => checkStageData("idea", { ...IDEA, decisions: [IDEA.decisions[0], IDEA.decisions[0]] }));
  assert.deepEqual([twice.code, twice.field], ["INVALID_FILTER", "decisions[1].question"]);
});

test("research: 2 to 4 options, a recommendation that points at one, unknowns may be empty", () => {
  assert.deepEqual(checkStageData("research", { ...RESEARCH, unknowns: [] }).unknowns, []);
  assert.equal(checkStageData("research", RESEARCH).recommendation.option, 1);
  const no = refused(() => checkStageData("research", { learned: [], options: [RESEARCH.options[0]], recommendation: { why: "Es la más barata hoy." }, unknowns: ["TBD"] }));
  assert.equal(no.code, "STAGE_REQUIREMENTS_MISSING");
  assert.deepEqual(no.missing, ["learned", "options", "recommendation.option", "unknowns[0]"]);
  const far = refused(() => checkStageData("research", { ...RESEARCH, recommendation: { option: 3, why: RESEARCH.recommendation.why } }));
  assert.deepEqual([far.code, far.field], ["INVALID_FILTER", "recommendation.option"]);
  const five = refused(() => checkStageData("research", { ...RESEARCH, options: [...RESEARCH.options, ...RESEARCH.options] }));
  assert.deepEqual([five.code, five.field], ["INVALID_FILTER", "options"]);
});

test("design: out_of_scope must name something", () => {
  assert.deepEqual(checkStageData("design", DESIGN).out_of_scope, DESIGN.out_of_scope);
  assert.deepEqual(refused(() => checkStageData("design", { ...DESIGN, out_of_scope: [] })).missing, ["out_of_scope"]);
  const nada = refused(() => checkStageData("design", { ...DESIGN, out_of_scope: ["Nada"] }));
  assert.deepEqual(nada.missing, ["out_of_scope[0]"]);
  assert.match(nada.fix["out_of_scope[0]"], /will not do/);
  assert.deepEqual(refused(() => checkStageData("design", { scope: DESIGN.scope })).missing, ["approach", "out_of_scope"]);
});

test("planning: every step has an observable done_when and a try_it; 1 to 6 steps", () => {
  const ok = checkStageData("planning", PLAN);
  assert.deepEqual(ok.steps.map((s) => s.work_type), ["ops", "code"]);
  assert.equal(ok.size, "Mediano: una semana.");
  const no = refused(() =>
    checkStageData("planning", { steps: [{ ...PLAN.steps[0], done_when: "Funciona." }, { title: PLAN.steps[1]!.title, done_when: PLAN.steps[1]!.done_when }], risks: PLAN.risks }),
  );
  assert.equal(no.code, "STAGE_REQUIREMENTS_MISSING");
  assert.deepEqual(no.missing, ["steps[0].done_when", "steps[1].try_it"]);
  assert.match(no.fix["steps[0].done_when"], /see or check/);
  assert.deepEqual(refused(() => checkStageData("planning", { steps: [], risks: [] })).missing, ["steps", "risks"]);
  const seven = refused(() => checkStageData("planning", { ...PLAN, steps: Array.from({ length: 7 }, () => PLAN.steps[0]) }));
  assert.deepEqual([seven.code, seven.field], ["INVALID_FILTER", "steps"]);
  const kind = refused(() => checkStageData("planning", { ...PLAN, steps: [{ ...PLAN.steps[0], work_type: "magic" }] }));
  assert.deepEqual([kind.code, kind.field], ["INVALID_FILTER", "steps[0].work_type"]);
  for (const vague of ["Funciona", "it works", "Está listo.", "Done", "todo funciona bien", "TBD", "Plantilla del mensaje"]) assert.equal(isObservable(vague, "Plantilla del mensaje"), false, vague);
  for (const seen of ["La lista muestra los tres filtros", "POST /citas returns 200 with the row", "El test de recordatorios pasa en CI"]) assert.equal(isObservable(seen, "Otro título"), true, seen);
});

test("the rendered doc passes forwardBlock and the Markdown readers find what the data says", () => {
  const docs = { idea: renderStageDoc("idea", checkStageData("idea", IDEA)), research: renderStageDoc("research", checkStageData("research", RESEARCH)), design: renderStageDoc("design", checkStageData("design", DESIGN)), planning: renderStageDoc("planning", checkStageData("planning", PLAN)) };
  assert.equal(forwardBlock("idea", { title: "Idea", markdown: docs.idea }), null);
  assert.equal(forwardBlock("research", { title: "Research", markdown: docs.research }), null);
  assert.equal(forwardBlock("design", { title: "Design", markdown: docs.design }), null);
  assert.equal(forwardBlock("planning", { title: "Plan", markdown: docs.planning }), null);
  assert.match(docs.idea, /^## Assumptions$/m);
  assert.match(docs.idea, /^1\. \*\*¿El aviso sale por WhatsApp o por correo\?\*\* Se asume «WhatsApp» hasta que Jorge decida: .* Otras opciones: «Correo», «Los dos»\.$/m);
  assert.doesNotMatch(renderStageDoc("idea", checkStageData("idea", { ...IDEA, decisions: [] })), /Assumptions/);
  assert.deepEqual(numbered(sectionAll(docs.research, "Options")).map((o: Json) => [o.n, o.title]), [[1, "Twilio"], [2, "Meta directo"], [3, "Aviso manual asistido"]]);
  assert.match(sectionAll(docs.research, "Recommendation")!, /^\*\*Opción 2: Meta directo\.\*\* A la larga/);
  assert.equal(sectionAll(docs.research, "Unknown"), "- Cuánto tarda Meta en aprobar la plantilla.");
  assert.equal(sectionAll(docs.planning, "Steps"), "1. Plantilla del mensaje\n2. Envío la víspera");
  assert.match(sectionAll(docs.planning, "Try it")!, /^1\. Abre Ajustes/);
  assert.equal(sectionAll(docs.planning, "Tamaño"), "Mediano: una semana.");
  assert.equal(sectionAll(docs.design, "Out of scope"), "- Confirmar la cita desde el mensaje\n- Avisos por correo");
  // Prose that would read as a heading does not break the doc's sections.
  const sly = renderStageDoc("design", checkStageData("design", { ...DESIGN, approach: "Primero el aviso.\n## Out of scope\nNada más por ahora." }));
  assert.equal(sectionAll(sly, "Out of scope"), "- Confirmar la cita desde el mensaje\n- Avisos por correo");
});

test("a decision is assumed until a pick matches its question and one of its options; the doc line is rewritten in place", () => {
  const d = checkStageData("idea", IDEA).decisions;
  assert.deepEqual(decisionStates(d, []).map((s) => [s.state, s.chosen]), [["assumed", 0], ["assumed", 0]]);
  const picks = [{ question: "¿se avisa también a la acompañante?", label: "sí", at: null }, { question: "¿Otra cosa?", label: "No", at: null }, { question: IDEA.decisions[0]!.question, label: "Fax", at: null }];
  assert.deepEqual(decisionStates(d, picks).map((s) => [s.state, s.chosen]), [["assumed", 0], ["decided", 1]]);
  const md = renderStageDoc("idea", checkStageData("idea", IDEA));
  const out = rewriteDecisionLine(md, 2, d[1]!, 1);
  assert.match(out, /^2\. \*\*¿Se avisa también a la acompañante\?\*\* Decidido por Jorge: «Sí»\. El PO recomendaba «No»\.$/m);
  assert.match(out, /^1\. .* Se asume «WhatsApp»/m, "the other line stays");
  assert.match(rewriteDecisionLine(md, 1, d[0]!, 0), /^1\. .* Decidido por Jorge: «WhatsApp»\.$/m);
  // A doc someone rewrote by hand: the line is added, under Assumptions when the section is there.
  const hand = rewriteDecisionLine("## Problem\nx\n## Assumptions\n\nNotas sueltas.\n\n## Why now\ny\n", 2, d[1]!, 1);
  assert.match(hand, /Notas sueltas\.\n2\. \*\*¿Se avisa[^\n]*«Sí»[^\n]*\n\n## Why now/);
  assert.match(rewriteDecisionLine("## Problem\nx\n", 2, d[1]!, 1), /## Assumptions\n\n2\. \*\*¿Se avisa/);
});

test("deliver_stage writes the doc, records stage.delivered and lets the idea move; a refusal stores nothing", async () => {
  const key = await idea("Recordatorios por WhatsApp");
  const no = await call("deliver_stage", { key, stage: "idea", data: { ...IDEA, why_now: "pendiente" } });
  assert.equal(no.__error, "STAGE_REQUIREMENTS_MISSING", JSON.stringify(no));
  assert.deepEqual(no.missing, ["why_now"]);
  assert.equal(await docOf(key, "Idea"), undefined);
  assert.equal((await eventsOf(key, "stage.delivered")).length, 0);
  const moved = await call("set_task", { key, stage: "research", version: await versionOf(key) });
  assert.equal(moved.__error, "STAGE_REQUIREMENTS_MISSING", "the stage still needs its doc");

  const out = await call("deliver_stage", { key, stage: "idea", data: IDEA });
  assert.equal(out.__error, undefined, JSON.stringify(out));
  assert.deepEqual([out.delivered, out.doc.title, out.doc.version], ["idea", "Idea", 1]);
  assert.match(out.next, /stage: "research"/);
  const doc = (await docOf(key, "Idea"))!;
  assert.equal(forwardBlock("idea", { title: "Idea", markdown: doc.markdown }), null);
  const [ev] = await eventsOf(key, "stage.delivered");
  assert.equal(ev!.payload.stage, "idea");
  assert.equal(ev!.payload.doc_version, 1);
  assert.deepEqual(ev!.payload.data, checkStageData("idea", IDEA));
  assert.equal((await call("set_task", { key, stage: "research", version: await versionOf(key) })).__error, undefined);
  assert.equal(await stageOf(key), "research");

  // A new delivery replaces the doc without the version; a retry with the same request_id writes once.
  const again = await call("deliver_stage", { key, stage: "idea", data: { ...IDEA, who: "Recepción y gerencia" }, request_id: "audit8-redeliver" });
  assert.equal(again.doc.version, 2);
  assert.equal((await call("deliver_stage", { key, stage: "idea", data: { ...IDEA, who: "Recepción y gerencia" }, request_id: "audit8-redeliver" })).doc.version, 2);
  assert.match((await docOf(key, "Idea"))!.markdown, /Recepción y gerencia/);
  assert.equal((await eventsOf(key, "stage.delivered")).length, 2);
  assert.equal(again.next, undefined, "it is not the stage the idea is on");

  // Only an open idea, and only the four stages that deliver.
  const ticket = (await writes.createTask(db, { project: "micasa", title: "Un ticket", status: "Ready", work_type: "code", priority: "P2", scope: "Un paso cualquiera.", checks: ["Se ve en la lista"] } as never, RUN("po"))) as Json;
  assert.equal((await call("deliver_stage", { key: ticket.key, stage: "idea", data: IDEA })).__error, "FIELD_NOT_ALLOWED");
  assert.equal((await call("deliver_stage", { key: "MIC-IDEA404", stage: "idea", data: IDEA })).__error, "TASK_NOT_FOUND");
  await assert.rejects(deliverStage(db, { project: "micasa", key, stage: "ready", data: {} }, RUN("po")), (e: Json) => e.code === "INVALID_FILTER" && e.detail.field === "stage");
});

test("attach_doc with the headings still moves an idea, and its read is the Markdown one", async () => {
  const key = await idea("Exportar a Excel");
  await docsMod.attachDoc(db, { project: "micasa", key, title: "Idea", markdown: "## Problem\nx\n## Who it is for\ny\n## Why now\nz\n## Tamaño\nChico." }, RUN("po"));
  await move(key, "research", "po");
  await docsMod.attachDoc(db, { project: "micasa", key, title: "Research", markdown: "## What we learned\nAlgo.\n## Options\n1. **Uno.** Texto uno.\n2. **Dos.** Texto dos.\n## Recommendation\nOpción 1.\n## Unknown\n- Si alcanza" }, RUN("research"));
  await move(key, "design", "research");
  await docsMod.attachDoc(db, { project: "micasa", key, title: "Design", markdown: "## Approach\nx\n## Scope\ny\n## Out of scope\nz" }, RUN("artist"));
  await move(key, "planning", "artist");
  await docsMod.attachDoc(db, { project: "micasa", key, title: "Plan", markdown: "## Steps\n1. Uno\n2. Dos\n## Done when\nx\n## Risks\ny" }, RUN("po"));
  const d = await detail(key);
  assert.deepEqual(d.decisions, []);
  assert.equal(d.plan, null);
  assert.deepEqual(d.plan_steps, ["Uno", "Dos"]);
  assert.deepEqual(d.research, { recommendation: "Opción 1.", options: [{ n: 1, title: "Uno", text: "Texto uno." }, { n: 2, title: "Dos", text: "Texto dos." }], unknown: ["Si alcanza"], recommended: null, learned: [] });
  assert.deepEqual(d.stops.map((s: Json) => s.data), [null, null, null, null, null, null]);
  assert.equal(d.ficha.tamano, "Chico.");
  assert.equal((await decide(key, { decision: 1, option: 1 })).status, 409, "nothing to decide on an idea without data");
});

test("the idea read carries the data of each stop, the decisions as assumed and the plan's try_it", async () => {
  const key = await toPlan("Recordatorios de la prueba");
  const d = await detail(key);
  assert.deepEqual(d.stops.map((s: Json) => s.state), ["done", "done", "done", "done", "here", "todo"]);
  assert.deepEqual(d.stops.map((s: Json) => s.by), ["jorge", "product-owner", "research", "artist", "product-owner", null]);
  assert.deepEqual(d.stops.map((s: Json) => !!s.data), [false, true, true, true, true, false]);
  assert.equal(d.stops[1].data.problem, IDEA.problem);
  assert.deepEqual(d.stops[3].data.out_of_scope, DESIGN.out_of_scope);
  assert.deepEqual(
    d.decisions.map((x: Json) => [x.n, x.question, x.options, x.recommended, x.state, x.chosen, x.at]),
    [
      [1, IDEA.decisions[0]!.question, ["WhatsApp", "Correo", "Los dos"], 1, "assumed", 1, null],
      [2, IDEA.decisions[1]!.question, ["No", "Sí"], 1, "assumed", 1, null],
    ],
  );
  assert.equal(d.decisions[0].why, IDEA.decisions[0]!.why);
  assert.equal(d.research.recommended, 2);
  assert.equal(d.research.recommendation, "**Opción 2: Meta directo.** A la larga cuesta menos y no depende de un tercero.");
  assert.deepEqual(d.research.options[2], { n: 3, title: "Aviso manual asistido", text: RESEARCH.options[2]!.text });
  assert.deepEqual(d.research.unknown, RESEARCH.unknowns);
  assert.deepEqual(d.research.learned, RESEARCH.learned);
  assert.deepEqual(d.plan_steps, ["Plantilla del mensaje", "Envío la víspera"]);
  assert.deepEqual(d.plan.steps[1], { title: "Envío la víspera", done_when: PLAN.steps[1]!.done_when, try_it: PLAN.steps[1]!.try_it, work_type: "code" });
  assert.deepEqual([d.plan.risks, d.plan.size], [PLAN.risks, "Mediano: una semana."]);
  assert.equal(d.ficha.tamano, "Mediano: una semana.");
  assert.equal(d.ficha.fuera, "- Confirmar la cita desde el mensaje\n- Avisos por correo");
  // «Otra opción» of the research still works on the data's options.
  assert.equal((await post(`/api/company/projects/micasa/ideas/${key}/respuesta`, { stop: "investigacion", verdict: "opcion", option: 9 })).status, 400);

  // A doc rewritten by hand after the delivery: that stop reads from the Markdown again.
  const plan = (await docOf(key, "Plan"))!;
  await docsMod.attachDoc(db, { project: "micasa", key, title: "Plan", markdown: "## Steps\n1. Solo uno\n## Done when\nx\n## Risks\ny", version: plan.version }, RUN("po"));
  const hand = await detail(key);
  assert.equal(hand.plan, null);
  assert.deepEqual(hand.plan_steps, ["Solo uno"]);
  assert.equal(hand.stops[4].data, null);
  assert.equal(hand.decisions.length, 2, "the other stops keep their data");
});

test("the owner picks the recommended option: decided, a note, and nothing moves", async () => {
  const key = await toPlan("Recordatorios con confirmación");
  await post(`/api/company/projects/micasa/ideas/${key}/visto`, { stop: "entendido" });
  const before = (await docOf(key, "Idea"))!;
  await raw.query(`delete from agent_runs`);
  assert.equal((await decide(key, { decision: 1, option: 1 }, { "Content-Type": "application/json" })).status, 401, "the owner's session only");
  assert.equal((await decide(key, { decision: 1, option: 1 }, { ...jorge(), Authorization: "Bearer test-token" })).status, 403);
  assert.equal((await decide(key, { decision: 9, option: 1 })).status, 400);
  assert.equal((await decide(key, { decision: 1, option: 4 })).status, 400);
  assert.equal((await decide(key, { decision: 1, option: 1, question: "¿Otra pregunta distinta?" })).status, 409);
  const r = await decide(key, { decision: 1, option: 1, question: IDEA.decisions[0]!.question });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.changed, r.body.stage, r.body.wake], [false, "planning", "none"]);
  assert.equal(await stageOf(key), "planning");
  assert.deepEqual(await queued(key), []);
  const [ev] = await eventsOf(key, "idea.decision");
  assert.deepEqual([ev!.payload.n, ev!.payload.option, ev!.payload.label, ev!.payload.changed, ev!.actor.agent], [1, 1, "WhatsApp", false, "jorge"]);
  const doc = (await docOf(key, "Idea"))!;
  assert.match(doc.markdown, /^1\. \*\*¿El aviso sale por WhatsApp o por correo\?\*\* Decidido por Jorge: «WhatsApp»\.$/m);
  assert.match(doc.markdown, /^2\. .* Se asume «No»/m);
  assert.equal(doc.version, before.version + 1);
  assert.deepEqual([doc.actor, doc.updated_at], [before.actor, before.updated_at], "the delivery is still the PO's, at its time");
  const note = (await eventsOf(key, "note")).at(-1)!.payload.text as string;
  assert.match(note, /Jorge confirmó \(desde Compañía\)/);
  const d = await detail(key);
  assert.deepEqual([d.decisions[0].state, d.decisions[0].chosen, typeof d.decisions[0].at], ["decided", 1, "string"]);
  assert.equal(d.decisions[1].state, "assumed");
  const entendido = d.stops.find((s: Json) => s.stop === "entendido");
  assert.deepEqual([entendido.by, entendido.seen], ["product-owner", true]);
  assert.ok(d.stops[1].data, "his pick does not make the delivery's data stale");
  assert.ok(d.trail.some((x: Json) => x.kind === "veredicto" && x.text === "Confirmaste «WhatsApp» en «¿El aviso sale por WhatsApp o por correo?»."), JSON.stringify(d.trail.map((x: Json) => x.text)));
  assert.ok(!d.trail.some((x: Json) => /Jorge confirmó/.test(x.text)), "the note for the team stays out of his trail");
  assert.equal((await decide(key, { decision: 1, option: 1 })).status, 409, "already decided that");
});

test("the owner picks another option: the idea goes back to the PO with his note, and his pick outlives the new delivery", async () => {
  const key = await toPlan("Recordatorios para acompañantes");
  await raw.query(`delete from agent_runs`);
  const r = await decide(key, { decision: 2, option: 2, text: "Casi siempre viene la mamá y es quien confirma" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.changed, r.body.stage], [true, "idea"]);
  assert.equal(await stageOf(key), "idea");
  assert.deepEqual(await queued(key), ["po-micasa"]);
  const [ev] = await eventsOf(key, "idea.decision");
  assert.deepEqual([ev!.payload.label, ev!.payload.was, ev!.payload.changed, ev!.payload.text], ["Sí", "No", true, "Casi siempre viene la mamá y es quien confirma"]);
  const note = (await eventsOf(key, "note")).at(-1)!.payload.text as string;
  assert.match(note, /Jorge decidió \(desde Compañía\) «Sí» en «¿Se avisa también a la acompañante\?», en lugar de «No»/);
  assert.match(note, /Sus palabras: «Casi siempre viene la mamá y es quien confirma»/);
  assert.match(note, /deliver_stage/);
  assert.match((await docOf(key, "Idea"))!.markdown, /^2\. .* Decidido por Jorge: «Sí»\. El PO recomendaba «No»\.$/m);
  let d = await detail(key);
  assert.deepEqual(d.stops.map((s: Json) => s.state), ["done", "here", "todo", "todo", "todo", "todo"]);
  assert.deepEqual([d.decisions[1].state, d.decisions[1].chosen, d.decisions[1].recommended], ["decided", 2, 1]);
  assert.ok(d.trail.some((x: Json) => x.text === "Decidiste «Sí» en «¿Se avisa también a la acompañante?» (se asumía «No»)."), JSON.stringify(d.trail.map((x: Json) => x.text)));

  // The PO redoes the stage: the decided line is written as decided, and the read still says so.
  await deliverStage(db, { project: "micasa", key, stage: "idea", data: { ...IDEA, who: "Recepción y la acompañante" } }, RUN("po"));
  assert.match((await docOf(key, "Idea"))!.markdown, /^2\. .* Decidido por Jorge: «Sí»\. El PO recomendaba «No»\.$/m);
  d = await detail(key);
  assert.deepEqual([d.decisions[1].state, d.decisions[1].chosen], ["decided", 2]);
  assert.equal(d.decisions[0].state, "assumed");

  // Changing his mind again is a change too, even back to what the PO recommended.
  await raw.query(`delete from agent_runs`);
  await move(key, "research", "po");
  const back = await decide(key, { decision: 2, option: 1 });
  assert.deepEqual([back.status, back.body.changed, back.body.stage], [200, true, "idea"]);
  assert.match((await docOf(key, "Idea"))!.markdown, /^2\. .* Decidido por Jorge: «No»\.$/m);

  // An idea that is still on its first stage does not move, and the PO is woken all the same.
  const fresh = await idea("Avisos de pago");
  await deliverStage(db, { project: "micasa", key: fresh, stage: "idea", data: IDEA }, RUN("po"));
  await raw.query(`delete from agent_runs`);
  const still = await decide(fresh, { decision: 1, option: 3 });
  assert.deepEqual([still.status, still.body.changed, still.body.stage], [200, true, "idea"]);
  assert.deepEqual(await queued(fresh), ["po-micasa"]);

  // A closed idea takes no pick.
  await writes.setTask(db, { project: "micasa", key: fresh, status: "Won't do", reason: "ya no", version: await versionOf(fresh) } as never, { actor: { agent: "jorge", session_id: "web", machine: "screen" }, human: true });
  assert.equal((await decide(fresh, { decision: 1, option: 1 })).status, 409);
});

test("each stage owner is told to deliver with deliver_stage, and the protocol names it", () => {
  for (const stage of ["idea", "research", "design", "planning"] as const) assert.match(STAGE_REASON[stage], /deliver_stage/, stage);
  assert.match(STAGE_REASON.idea, /^pedido de Jorge para darle forma/);
  assert.match(STAGE_REASON.research, /^idea stage research/);
  assert.equal(STAGE_REASON.ready, "");
  assert.equal(PROTOCOL_VERSION, "2.23");
  assert.match(instructions(false), /deliver_stage/);
  assert.ok(instructions(false).split(/\s+/).length < 900);
});
