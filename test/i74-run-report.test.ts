// PLA-I74-1: the run report per initiative, derived from a seeded event log; the owner.click event every screen
// write leaves; and the report's words on the ficha. Throwaway DB, made-up projects, fake values only.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type pg from "pg";
import { resetTestDb, useOwnerCode, useTestEnv } from "./helpers.js";

useTestEnv();
await useOwnerCode();
process.env.PLANIA_HOME_PROJECT = "casa";
const { makeDb } = await import("../src/db/client.js");
const { app } = await import("../src/app.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const { seedOrg } = await import("../scripts/seed-org.js");
const writes = await import("../src/mcp/writes.js");
const { runReport, longestUncovered } = await import("../src/api/run-report.js");
const { clickOf, OWNER_CLICK } = await import("../src/api/clicks.js");
const ui = await import("../ui/src/lib/informe.js");

type Json = Record<string, any>;
const T0 = Date.parse("2026-11-20T10:00:00Z");
const at = (min: number) => new Date(T0 + min * 60_000);
const MIN = 60_000;
const screen = (type: string, min: number, key: string, payload: Json = {}) => ({ type, at: at(min), taskKey: key, payload, screen: true });
const agent = (type: string, min: number, key: string, payload: Json = {}) => ({ type, at: at(min), taskKey: key, payload, screen: false });
const click = (min: number, key: string, control: string, decision: string | null) => screen(OWNER_CLICK, min, key, { control, decision });

// One initiative's life, minute by minute: asked at 0, understood 10, research 40, design 70, plan 100, «Constrúyelo»
// at 130, two steps built, In review, accepted, published at 400.
function seeded() {
  return {
    keys: ["T-IDEA", "T-I1", "T-I1-1", "T-I1-2"],
    steps: ["T-I1-1", "T-I1-2"],
    start: at(0),
    end: at(400),
    now: at(500),
    marks: { buzon: at(0), entendido: at(10), investigacion: at(40), diseno: at(70), plan: at(100), lista: at(130), construccion: at(380), publicado: at(400) },
    events: [
      click(0, "T-IDEA", "ask", "pedir"),
      click(12, "T-IDEA", "ideas.respuesta", "asi_es"),
      click(72, "T-IDEA", "ideas.respuesta", "me_gusta"),
      click(80, "T-IDEA", "ideas.despertar", null),
      click(81, "T-IDEA", "ideas.despertar", null),
      click(130, "T-IDEA", "pedidos.construir", "construyelo"),
      click(250, "T-I1-1", "tasks.note", null),
      click(300, "T-I1-1", "decisions.aceptar", "aceptar"),
      click(390, "T-I1-2", "decisions.aceptar", "aceptar"),
      click(399, "T-I1", "release.ship", "publicar"),
      click(600, "T-I1", "tasks.note", null), // after the end: not counted
      click(50, "OTRA-1", "tasks.note", null), // another ticket: not counted
      agent("turn.healed", 200, "T-I1-1", { reason: "nobody's turn" }),
      agent("turn.healed", 210, "T-I1-2"),
      agent("turn.healed", 220, "OTRA-1"),
      agent("task.status", 140, "T-I1-1", { from: "Ready", to: "In progress" }),
      agent("task.status", 240, "T-I1-1", { from: "In progress", to: "In review" }),
      agent("task.status", 300, "T-I1-1", { from: "In review", to: "Merged" }),
      agent("task.status", 330, "T-I1-2", { from: "In progress", to: "In review" }),
      agent("task.status", 390, "T-I1-2", { from: "In review", to: "Merged" }),
      agent("probador.started", 240, "T-I1-1"),
      agent("probador.pass", 245, "T-I1-1"),
    ],
    runs: [
      { taskKey: "T-IDEA", role: "product-owner", startedAt: at(1), endedAt: at(10), tokens: 40_000 },
      { taskKey: "T-IDEA", role: "research", startedAt: at(11), endedAt: at(40), tokens: 250_000 },
      { taskKey: "T-IDEA", role: "artist", startedAt: at(41), endedAt: at(70), tokens: 300_000 },
      { taskKey: "T-IDEA", role: "product-owner", startedAt: at(71), endedAt: at(100), tokens: 60_000 },
      { taskKey: "T-I1-1", role: "taller", startedAt: at(140), endedAt: at(240), tokens: 1_200_000 },
      // nobody between 300 and 320: the gap of 20 minutes is shorter than the one below
      { taskKey: "T-I1-2", role: "taller", startedAt: at(320), endedAt: at(330), tokens: 500_000 },
      { taskKey: "OTRA-1", role: "taller", startedAt: at(250), endedAt: at(300), tokens: 9 },
    ],
    fixes: [
      { key: "CASA-1", title: "Arreglo uno", status: "Merged", createdAt: at(150), marked: false },
      { key: "CASA-2", title: "Arreglo dos", status: "Ready", createdAt: at(-500), marked: true },
      { key: "CASA-3", title: "De antes", status: "Done", createdAt: at(-900), marked: false },
      { key: "CASA-4", title: "De después", status: "Ready", createdAt: at(450), marked: false },
      { key: "T-I1-1", title: "Su propio paso", status: "Merged", createdAt: at(131), marked: true },
    ],
    // A question to the owner on the second step, 250 → 260 (the run on the first step had ended at 240).
    questions: [{ taskKey: "T-I1-2", askedAt: at(250), answeredAt: at(260) }],
  };
}

test("I74-1 #2/#4: the report counts fixes, decisions and extra clicks, heals, time per stop, the longest gap and tokens per agent", () => {
  const r = runReport(seeded());
  assert.deepEqual(r.fixes.items.map((f) => f.key), ["CASA-1", "CASA-2"], "made while it ran, or marked; never its own steps, never before or after");
  assert.equal(r.fixes.count, 2);
  assert.equal(r.clicks.estimated, false);
  assert.equal(r.clicks.decisions, 7);
  assert.deepEqual(r.clicks.by_decision, { pedir: 1, asi_es: 1, me_gusta: 1, construyelo: 1, aceptar: 2, publicar: 1 });
  assert.equal(r.clicks.extra, 3);
  assert.deepEqual(r.clicks.extra_by_control, [
    { control: "ideas.despertar", n: 2 },
    { control: "tasks.note", n: 1 },
  ]);
  assert.equal(r.heals, 2, "turn.healed on its own tickets only");
  assert.deepEqual(
    r.stops.map((s) => [s.stop, s.ms === null ? null : s.ms / MIN]),
    [
      ["entendido", 10],
      ["investigacion", 30],
      ["diseno", 30],
      ["plan", 30],
      ["lista", 30],
      ["construccion", 250],
      ["publicado", 20],
    ],
  );
  // Busy: runs 1-10, 11-40, 41-70, 71-100, ready 100-130, run 140-240, review 240-300, question 250-260, run 320-330,
  // review 330-390. Free: 0-1, 10-11, 40-41, 70-71, 130-140 (10 min), 300-320 (20 min), 390-400 (10 min).
  assert.equal(r.gap?.ms, 20 * MIN);
  assert.equal(r.gap?.from, at(300).toISOString());
  assert.equal(r.gap?.to, at(320).toISOString());
  assert.deepEqual(r.tokens, [
    { agent: "taller", tokens: 1_700_000, runs: 2 },
    { agent: "artist", tokens: 300_000, runs: 1 },
    { agent: "research", tokens: 250_000, runs: 1 },
    { agent: "product-owner", tokens: 100_000, runs: 2 },
  ]);
  assert.equal(r.open, false);
});

test("I74-1 #2/#4: while it runs, the stop it sits on runs to now, later stops have no time, and heals start at zero", () => {
  const s = seeded();
  const r = runReport({ ...s, end: null, now: at(200), marks: { ...s.marks, construccion: null, publicado: null }, events: s.events.filter((e) => e.type !== "turn.healed" && e.at <= at(200)) });
  assert.equal(r.open, true);
  assert.equal(r.heals, 0);
  const byStop = Object.fromEntries(r.stops.map((x) => [x.stop, x]));
  assert.equal(byStop.construccion!.ms, 70 * MIN);
  assert.equal(byStop.construccion!.open, true);
  assert.equal(byStop.publicado!.ms, null);
});

test("I74-1 #4: an initiative older than owner.click counts the screen's own writes, marked as estimated", () => {
  const s = seeded();
  const r = runReport({
    ...s,
    events: [
      screen("task.created", 0, "T-IDEA"),
      screen("idea.respuesta", 12, "T-IDEA", { stop: "entendido", verdict: "ok" }),
      screen("idea.respuesta", 13, "T-IDEA", { stop: "entendido", verdict: "deshacer" }),
      screen("idea.visto", 14, "T-IDEA"),
      screen("pedido.construir", 130, "T-IDEA"),
      screen("note", 200, "T-I1-1"),
      agent("note", 201, "T-I1-1"),
    ],
  });
  assert.equal(r.clicks.estimated, true);
  assert.deepEqual(r.clicks.by_decision, { pedir: 1, asi_es: 1, construyelo: 1 });
  assert.deepEqual(r.clicks.extra_by_control, [
    { control: "ideas.respuesta", n: 1 },
    { control: "note", n: 1 },
  ]);
});

test("I74-1 #2: the longest uncovered stretch merges overlapping spans and counts the edges", () => {
  assert.deepEqual(longestUncovered([], 0, 10), { from: 0, to: 10 });
  assert.deepEqual(longestUncovered([{ from: 0, to: 4 }, { from: 3, to: 6 }, { from: 8, to: 9 }], 0, 10), { from: 6, to: 8 });
  assert.equal(longestUncovered([{ from: -5, to: 20 }], 0, 10), null);
});

test("I74-1 #1: every screen write names its control; the owner's decisions are told apart; visto and sign-in are not clicks", () => {
  const c = (m: string, p: string, body: Json | null = null, reply: Json | null = null) => {
    const x = clickOf(m, p, body, reply);
    return x ? [x.control, x.decision, x.slug, x.key] : null;
  };
  assert.deepEqual(c("POST", "/api/company/projects/tienda/ask", { text: "una idea larga", mode: "forma" }, { key: "TND-IDEA9" }), ["ask", "pedir", "tienda", "TND-IDEA9"]);
  assert.deepEqual(c("POST", "/api/company/projects/tienda/ideas/TND-IDEA9/respuesta", { stop: "entendido", verdict: "ok" }), ["ideas.respuesta", "asi_es", "tienda", "TND-IDEA9"]);
  assert.deepEqual(c("POST", "/api/company/projects/tienda/ideas/TND-IDEA9/respuesta", { stop: "diseno", verdict: "ok" }), ["ideas.respuesta", "me_gusta", "tienda", "TND-IDEA9"]);
  assert.deepEqual(c("POST", "/api/company/projects/tienda/ideas/TND-IDEA9/respuesta", { stop: "investigacion", verdict: "opcion", option: 2 }), ["ideas.respuesta", "respuesta", "tienda", "TND-IDEA9"]);
  assert.deepEqual(c("POST", "/api/company/projects/tienda/ideas/TND-IDEA9/respuesta", { stop: "entendido", verdict: "deshacer" }), ["ideas.respuesta", null, "tienda", "TND-IDEA9"]);
  assert.deepEqual(c("POST", "/api/company/projects/tienda/pedidos/TND-IDEA9/construir"), ["pedidos.construir", "construyelo", "tienda", "TND-IDEA9"]);
  assert.deepEqual(c("POST", "/api/projects/tienda/questions/0b5c0000-0000-4000-8000-000000000001/answer"), ["questions.answer", "respuesta", "tienda", null]);
  assert.deepEqual(c("POST", "/api/company/decisions/m-42", { action: "aceptar" }, { decision: { project: "tienda", ref: "TND-I3-2" } }), ["decisions.aceptar", "aceptar", "tienda", "TND-I3-2"]);
  assert.deepEqual(c("POST", "/api/company/decisions/m-42", { action: "cambios" }, { decision: { project: "tienda", ref: "https://example.com/pr/1" } }), ["decisions.cambios", "ajuste", "tienda", null]);
  assert.deepEqual(c("POST", "/api/projects/tienda/release/ship", {}), ["release.ship", "publicar", "tienda", null]);
  assert.deepEqual(c("POST", "/api/company/projects/tienda/ideas/TND-IDEA9/despertar"), ["ideas.despertar", null, "tienda", "TND-IDEA9"]);
  assert.deepEqual(c("PATCH", "/api/projects/tienda/tasks/TND-I3-2", { status: "Ready" }), ["tasks", null, "tienda", "TND-I3-2"]);
  assert.deepEqual(c("POST", "/api/projects/tienda/tasks/TND-I3-2/checks/2/waive"), ["tasks.checks.waive", null, "tienda", "TND-I3-2"]);
  assert.deepEqual(c("POST", "/api/company/runs/8f00/stop"), ["runs.stop", null, null, null]);
  assert.deepEqual(c("PUT", "/api/company/projects/tienda/settings/release", {}), ["settings.release", null, "tienda", null]);
  assert.deepEqual(c("DELETE", "/api/company/projects/tienda"), ["project", null, "tienda", null]);
  assert.equal(c("POST", "/api/company/projects/tienda/ideas/TND-IDEA9/visto", { stop: "diseno" }), null, "the screen sends it when a stop opens");
  assert.equal(c("POST", "/api/login", { password: "x" }), null);
  assert.equal(c("GET", "/api/company"), null);
  // His words never go into the event; short enums do.
  assert.deepEqual(clickOf("POST", "/api/company/projects/tienda/ask", { text: "palabras del dueño", mode: "ya" }, null)?.detail, { mode: "ya" });
});

test("I74-1 #3: the report reads in plain Spanish", () => {
  const v = ui.informeView(runReport(seeded()) as never)!;
  assert.equal(v.title, "Informe de la corrida");
  assert.equal(v.fixes, "2 arreglos a Plania mientras corría");
  assert.deepEqual(v.fixItems, ["Arreglo uno", "Arreglo dos"]);
  assert.equal(v.clicks, "7 decisiones tuyas · 3 clics de más");
  assert.deepEqual(v.extra, [
    { label: "Despertar", n: 2 },
    { label: "Nota al equipo", n: 1 },
  ]);
  assert.equal(v.estimated, null);
  assert.equal(v.heals, "Plania destrabó 2 turnos sola");
  assert.equal(v.gap, "El rato más largo sin turno de nadie: 20 min");
  assert.deepEqual(v.stops[4], { label: "Esperando «Constrúyelo»", text: "30 min" });
  assert.deepEqual(v.stops[5], { label: "Construcción", text: "4 h 10" });
  assert.deepEqual(v.tokens[0], { agent: "taller", text: "1,7 M · 2 corridas" });
  assert.deepEqual(v.tokens[3], { agent: "product-owner", text: "100 k · 2 corridas" });
  assert.equal(ui.controlName("maquinas.llaves"), "Máquinas");
  assert.equal(ui.controlName("algo.nuevo"), "Otros botones");
  const none = ui.informeView({ ...runReport({ ...seeded(), fixes: [], events: [], runs: [], questions: [] }), open: true } as never)!;
  assert.equal(none.title, "Informe de la corrida, hasta ahora");
  assert.equal(none.fixes, "Plania no necesitó arreglos");
  assert.equal(none.clicks, "0 decisiones tuyas · ningún clic de más");
  assert.equal(none.heals, "Plania no tuvo que destrabar ningún turno");
  assert.equal(none.tokens.length, 0);
  assert.equal(ui.informeView(undefined), null);
});

// ---- through the server: the screen's writes leave owner.click, and the ficha carries the report

let raw: pg.Client;
let db: ReturnType<typeof makeDb>["db"];
let closeDb: () => Promise<void>;
const owner = () => ({ Cookie: `${SESSION_COOKIE}=${createSession()}`, "Content-Type": "application/json" });
const post = (url: string, body: Json = {}, headers: Record<string, string> = owner()) => app.request(url, { method: "POST", headers, body: JSON.stringify(body) });
const PO = { actor: { agent: "po-micasa", session_id: "run-0000c0de" } };

before(async () => {
  raw = await resetTestDb();
  ({ db, close: closeDb } = makeDb());
  await seedOrg(db);
  await raw.query(`insert into projects (slug, title, key_prefix) values ('casa', 'Casa', 'CASA')`);
  await raw.query(`update runner_settings set company_paused = false`);
  await raw.query(`update projects set runs_paused = (slug <> 'micasa')`);
});
after(async () => {
  await closeDb?.();
  await raw?.end();
});

test("I74-1 #1/#2/#3: screen writes leave owner.click with their control, and the initiative's ficha carries the report", async () => {
  const asked = await post("/api/company/projects/micasa/ask", { text: "Un carrito que recuerde lo que dejé", mode: "forma" });
  assert.equal(asked.status, 201, await asked.clone().text());
  const idea = ((await asked.json()) as Json).key as string;
  assert.equal((await post(`/api/company/projects/micasa/ideas/${idea}/despertar`)).status < 500, true);
  await post(`/api/company/projects/micasa/ideas/${idea}/visto`, { stop: "buzon" });
  // Not the screen: a Bearer, and no cookie at all, leave nothing.
  await post(`/api/company/projects/micasa/ideas/${idea}/despertar`, {}, { Authorization: "Bearer nope", "Content-Type": "application/json" });
  await post(`/api/company/projects/micasa/ideas/${idea}/despertar`, {}, { "Content-Type": "application/json" });

  const clicks = (await raw.query(`select task_key, payload, actor from events where type = $1 order by id`, [OWNER_CLICK])).rows;
  const controls = clicks.map((r) => r.payload.control);
  assert.equal(controls[0], "ask");
  assert.equal(clicks[0].payload.decision, "pedir");
  assert.equal(clicks[0].task_key, idea, "Pedir names the idea it made");
  assert.equal(clicks[0].actor.agent, "owner");
  assert.equal(controls.includes("ideas.visto"), false, "opening a stop is not a click");
  const wakes = clicks.filter((r) => r.payload.control === "ideas.despertar");
  assert.ok(wakes.length <= 1, "only the screen's own Despertar is recorded");
  assert.equal(JSON.stringify(clicks).includes("carrito"), false, "his words stay out of the event");

  // An initiative born from it, two steps, a seeded log.
  const ini = (await writes.createTask(db, { project: "micasa", kind: "initiative", title: "Carrito", scope: "s" } as never, PO)) as Json;
  const s1 = (await writes.createTask(db, { project: "micasa", parent_key: ini.key, phase: 1, title: "Guardar el carrito", scope: "s", checks: ["c"], status: "Ready" } as never, PO)) as Json;
  await raw.query(`update tasks set promoted_to = $1, stage = 'ready' where key = $2`, [ini.key, idea]);
  const proj = (await raw.query(`select id from projects where slug = 'micasa'`)).rows[0].id as string;
  await raw.query(`insert into events (project_id, task_key, type, actor, payload) values ($1, $2, 'turn.healed', '{"agent":"plania","session_id":"system"}', '{}')`, [proj, s1.key]);
  await raw.query(`insert into events (project_id, task_key, type, actor, payload) values ($1, $2, $3, '{"agent":"owner","session_id":"web","machine":"screen"}', '{"control":"tasks.note","decision":null}')`, [proj, s1.key, OWNER_CLICK]);
  await raw.query(`delete from agent_runs`);
  const agentId = (await raw.query(`select id from agents limit 1`)).rows[0].id as string;
  await raw.query(
    `insert into agent_runs (agent_id, project_id, task_key, role, status, started_at, ended_at, tokens_total) values ($1, $2, $3, 'taller', 'ok', now() - interval '20 minutes', now() - interval '5 minutes', 123456)`,
    [agentId, proj, s1.key],
  );
  await writes.createTask(db, { project: "casa", title: "Arreglo de Plania", scope: `Visto en ${ini.key}.`, checks: ["c"] } as never, PO);

  const res = await app.request(`/api/company/projects/micasa/ideas/${ini.key}`, { headers: owner() });
  assert.equal(res.status, 200);
  const d = (await res.json()) as Json;
  const r = d.built.informe as Json;
  assert.ok(r, "the ficha carries the report");
  assert.equal(r.open, true);
  assert.equal(r.heals, 1);
  assert.equal(r.fixes.count, 1);
  assert.equal(r.fixes.items[0].title, "Arreglo de Plania");
  assert.equal(r.clicks.by_decision.pedir, 1);
  assert.ok(r.clicks.extra >= 1);
  assert.deepEqual(r.tokens, [{ agent: "taller", tokens: 123456, runs: 1 }]);
  assert.ok(r.gap === null || r.gap.ms >= 0);
  assert.equal(r.stops.length, 7);
});
