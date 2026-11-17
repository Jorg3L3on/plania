// PLA-I53-4: la línea de Ahora (ui/src/lib/ahora-piso.ts, components/plan/ahora-line.tsx). Pure and server-rendered;
// no browser, no database. Fake names only.
//   #1  a running run: the line, the seat (window and caption) and the ticket's card name the same agent and stage
//   #2  a returned ticket being fixed: the line says who fixes it, never «Nadie trabaja»
//   #3  nobody working: each of the five reasons in its case, in the order the ticket gives
//   #4  the project page builds the same line from the same card (same text)
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";

(globalThis as { React?: unknown }).React = React;
const load = async (p: string) => (await import(new URL(`../ui/src/${p}`, import.meta.url).href)) as Record<string, any>;
const lib = await load("lib/ahora-piso.ts");
const edificio = await load("lib/edificio.ts");
const lineUi = await load("components/plan/ahora-line.tsx");


type Json = Record<string, any>;
const h = React.createElement;
const NOW = new Date("2026-11-15T20:00:00Z").getTime();
const TZ = "America/Mexico_City";
const noop = () => {};
const text = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

const etapa = (id: string, patch: Json = {}): Json => ({ etapa: id, qa: null, holder: null, live: false, since: "2026-11-15T19:00:00Z", ci: null, reason: null, ...patch });
const tk = (key: string, title: string, e: Json, parent: string | null = "DEM-I2"): Json => ({ key, title, status: "x", phase: null, parent_key: parent, etapa: e });
const item = (t: Json): Json => ({ key: t.key, title: t.title, initiative: t.parent_key, etapa: t.etapa.etapa, qa: t.etapa.qa, holder: t.etapa.holder, live: t.etapa.live, since: t.etapa.since, reason: t.etapa.reason });
const TALLER = { agent: "taller-demo", role: "taller" };
const member = (role: string, patch: Json = {}): Json => ({ agent: `${role}-demo`, role, template: role, state: "idle", now: null, last: null, produced: null, waiting: null, queue: [], next_start: null, ...patch });
const card = (tickets: Json[], patch: Json = {}): Json => ({
  slug: "demo",
  title: "Demo",
  paused: false,
  light: "ok",
  team: [member("product-owner"), member("taller"), member("qa")],
  thread: { id: "t", unread: 0, last: null },
  plan: null,
  this_week: { done: 0, docs: 0, prs: 0, last_at: null },
  next: null,
  work: { open: 0, in_progress: 0 },
  usage: { tokens: 0 },
  route: null,
  orders: [],
  latest: [],
  stale_requests: [],
  next_move: null,
  tablero: { initiatives: [{ key: "DEM-I2", title: "Agenda", status: "Active", done: 0, total: tickets.length, tickets }], loose: [], loose_done: 0 },
  ahora: tickets.filter((t) => ["construyendo", "devuelto"].includes(t.etapa.etapa) || (t.etapa.etapa === "en_qa" && t.etapa.qa === "running")).map(item),
  ...patch,
});

const lineHtml = (p: Json, opts: Json = {}) => renderToStaticMarkup(h(lineUi.AhoraLine, { view: lib.ahoraView(p, NOW, { timeZone: TZ, ...opts }) }));
const slot = (html: string) => html.slice(html.indexOf('data-slot="ahora"'), html.indexOf('class="dark sb-one sb"'));
const stationOf = (html: string, id: string) => html.match(new RegExp(`<(?:button|div)[^>]*data-station="${id}"[^>]*>[\\s\\S]*?</(?:button|div)>`))?.[0] ?? "";







test("I53-4: several at once stack, newest first", () => {
  const p = card([
    tk("DEM-I2-3", "Agenda", etapa("construyendo", { holder: TALLER, live: true, since: "2026-11-15T19:00:00Z" })),
    tk("DEM-I2-5", "Pagos", etapa("en_qa", { qa: "running", holder: { agent: "qa-demo", role: "qa" }, live: true, since: "2026-11-15T19:50:00Z" })),
  ]);
  const v = lib.ahoraView(p, NOW);
  assert.deepEqual(v.lines.map((l: Json) => l.text), ["QA prueba «Pagos» · hace 10 min", "Taller construye «Agenda» · hace 1 h"]);
  assert.equal(v.tone, "now");
  assert.match(v.why, /Sin trabajo ahora: PO\./);
});

// #3: the reason chooser, one case each, and its order.
const facts = (patch: Json = {}): Json => ({ owner: [], move: null, blocked: [], ready: [], later: 0, paused: null, queued: null, ...patch });
test("I53-4 #3: waits on the owner names the item", () => {
  assert.deepEqual(lib.quietReason(facts({ owner: ["Agenda semanal", "Pagos"], blocked: [{ title: "X", reason: null }], paused: "project" })), { kind: "owner", text: "Te toca: «Agenda semanal» y 1 más." });
  assert.deepEqual(lib.quietReason(facts({ move: "Acepta el plan de Agenda." })), { kind: "owner", text: "Te toca: acepta el plan de Agenda." });
});
test("I53-4 #3: everything blocked names what", () => {
  assert.deepEqual(lib.quietReason(facts({ blocked: [{ title: "Pagos", reason: "Falta la llave de Stripe." }, { title: "Recibos", reason: null }], paused: "project" })), { kind: "blocked", text: "Todo está bloqueado: «Pagos» (Falta la llave de Stripe) y 1 más." });
});
test("I53-4 #3: nothing Ready", () => {
  assert.deepEqual(lib.quietReason(facts({ later: 3, paused: "project" })), { kind: "nothing_ready", text: "Nada está listo para empezar. Quedan 3 para después." });
  assert.equal(lib.quietReason(facts()).kind, "nothing_ready");
});
test("PLA-47: nothing Ready names what waits for later and why", () => {
  const laterOnes = [
    { title: "Hosting, dominio y despliegue", reason: "Está en Backlog: nadie la pasó a Lista." },
    { title: "Puesta en marcha", reason: "Espera a «Hosting, dominio y despliegue»" },
    { title: "Otra", reason: null },
  ];
  assert.deepEqual(lib.quietReason(facts({ later: 2, laterOnes: laterOnes.slice(0, 2) })), {
    kind: "nothing_ready",
    text: "Nada está listo para empezar. Quedan 2 para después: «Hosting, dominio y despliegue» (está en Backlog: nadie la pasó a Lista); «Puesta en marcha» (espera a «Hosting, dominio y despliegue»).",
  });
  assert.equal(lib.quietReason(facts({ later: 3, laterOnes })).text.endsWith("y 1 más."), true);
  assert.equal(lib.quietReason(facts({ later: 1, laterOnes: [{ title: "Otra", reason: null }] })).text, "Nada está listo para empezar. Queda 1 para después: «Otra».");
});
test("I53-4 #3: the project is paused", () => {
  assert.deepEqual(lib.quietReason(facts({ ready: ["Alta"], paused: "project", queued: { who: "Taller", at: null } })), { kind: "paused", text: "El proyecto está en pausa: nada arranca hasta que lo reanudes." });
  assert.equal(lib.quietReason(facts({ ready: ["Alta"], paused: "company" })).text, "La compañía está en pausa: nada arranca hasta que la reanudes.");
});
test("I53-4 #3: work queued for the next round", () => {
  assert.deepEqual(lib.quietReason(facts({ ready: ["Alta", "Baja"], queued: { who: "Taller", at: "2:10 pm" } })), { kind: "queued", text: "«Alta» está listo: Taller lo toma en la próxima ronda, a las 2:10 pm. Hay 1 más en fila." });
});



