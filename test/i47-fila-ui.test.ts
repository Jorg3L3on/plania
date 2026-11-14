// PLA-I47-3: La fila. filaOf with fake data, and the Fila component's handlers without a DOM.
//   #1  empty project; one running step; a free step and three held ones (only the free one gets Hacer primero);
//       an order and a Ready ticket (both get it); next_first moves a row to Sigue 1; postponed; more than three done
//   #2  each action calls the existing route's handler with the right key; no Hacer primero on a held plan step
//   #3  long titles clamp to two lines, the whole text in title
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

(globalThis as { React?: unknown }).React = React;
const load = async (p: string) => (await import(new URL(`../ui/src/${p}`, import.meta.url).href)) as Record<string, any>;
const lib = await load("lib/fila.ts");
const ui = await load("components/compania/edificio/fila.tsx");

type Json = Record<string, any>;
const NOW = new Date("2026-11-10T18:00:00Z").getTime();
const TZ = "America/Mexico_City";
const step = (key: string, state: string, patch: Json = {}): Json => ({ key, title: `Paso ${key}`, state, who: "taller", at: "2026-11-09T18:00:00Z", ...patch });
const project = (patch: Json = {}): Json => ({
  slug: "lumen",
  title: "Lumen",
  paused: false,
  light: "ok",
  team: [{ agent: "taller-lumen", role: "taller", template: "taller", state: "idle", now: null, last: null, produced: null, waiting: null, queue: [] }],
  orders: [],
  ready: [],
  route: null,
  ...patch,
});
const routeOf = (steps: Json[]) => ({ legs: [{ key: "LUM-I1", title: "Arranque", done: 0, total: steps.length, state: "here", note: null, steps }], more_legs: 0 });
const fila = (p: Json, ds: Json[] = []) => lib.filaOf(p, ds, NOW, TZ);
const acts = (rows: Json[]) => rows.map((r) => `${r.key}:${r.acts.map((a: Json) => a.kind).join("+")}`);

test("I47-3 #1: an empty project has nothing in any section", () => {
  const f = fila(project());
  assert.deepEqual([f.ahora.length, f.sigue.length, f.pospuesto.length, f.hecho.length, f.hechoTotal], [0, 0, 0, 0, 0]);
  const out = renderToStaticMarkup(React.createElement(ui.Fila, { project: project(), decisions: [], now: NOW, acts: {} }));
  assert.ok(out.includes("Nadie trabaja en este piso ahora.") && out.includes("No hay nada en cola."));
});

test("I47-3 #1: a running step is Ahora with Detener; a free step gets Hacer primero, held ones say what they wait for", () => {
  const p = project({
    team: [{ agent: "taller-lumen", role: "taller", template: "taller", state: "running", now: { ticket: "LUM-1", since: "2026-11-10T17:40:00Z", run_id: "run-9" }, last: null, produced: null, waiting: null, queue: [] }],
    route: routeOf([step("LUM-1", "working"), step("LUM-2", "next"), step("LUM-3", "later", { waits: "Paso LUM-2" }), step("LUM-4", "later", { waits: "Paso LUM-3" }), step("LUM-5", "later")]),
    ready: [{ key: "LUM-2", title: "Paso LUM-2" }, { key: "LUM-3", title: "Paso LUM-3" }],
  });
  const f = fila(p);
  assert.deepEqual(acts(f.ahora), ["LUM-1:detener"]);
  assert.deepEqual(f.sigue.map((r: Json) => [r.n, r.key]), [[1, "LUM-2"], [2, "LUM-3"], [3, "LUM-4"], [4, "LUM-5"]]);
  assert.deepEqual(acts(f.sigue), ["LUM-2:primero", "LUM-3:", "LUM-4:", "LUM-5:"], "only the free step gets Hacer primero");
  assert.equal(f.sigue[1].line, "Espera a «Paso LUM-2»");
});

test("I47-3 #1: the owner's order and a Ready ticket outside the plan both get Hacer primero; next_first goes first after his orders", () => {
  const order = { id: "o1", kind: "order", key: "LUM-9", title: "Cambiar el color del botón", at: "2026-11-10T16:00:00Z", state: "entendida", understood: null, who: "PO", link: null, age_h: 2 };
  const p = project({
    orders: [order],
    route: routeOf([step("LUM-2", "next")]),
    ready: [{ key: "LUM-2", title: "Paso LUM-2" }, { key: "LUM-7", title: "Arreglar el pie de página" }],
  });
  const f = fila(p);
  assert.deepEqual(acts(f.sigue), ["LUM-9:primero+quitar", "LUM-2:primero", "LUM-7:primero"]);
  assert.equal(f.sigue[0].tu, true);
  const moved = fila({ ...p, next_first: "LUM-7" });
  assert.deepEqual(moved.sigue.map((r: Json) => r.key), ["LUM-9", "LUM-7", "LUM-2"], "his orders first, then the one he put first");
  const alone = fila({ ...p, orders: [], next_first: "LUM-7" });
  assert.equal(alone.sigue[0].key, "LUM-7");
  assert.equal(alone.sigue[0].n, 1, "next_first is Sigue 1");
});

test("I47-3 #1: postponed steps and more than three done", () => {
  const p = project({
    route: routeOf([
      step("LUM-1", "done", { at: "2026-11-01T10:00:00Z" }),
      step("LUM-2", "published", { at: "2026-11-04T10:00:00Z" }),
      step("LUM-3", "done", { at: "2026-11-03T10:00:00Z" }),
      step("LUM-4", "done", { at: "2026-11-02T10:00:00Z" }),
      step("LUM-5", "later", { postponed: true }),
    ]),
  });
  const f = fila(p);
  assert.deepEqual(f.pospuesto.map((r: Json) => [r.key, r.mark, r.line]), [["LUM-5", "off", "Pospuesto a propósito"]]);
  assert.deepEqual(f.hecho.map((r: Json) => r.key), ["LUM-2", "LUM-3", "LUM-4"], "the last three, newest first");
  assert.equal(f.hechoTotal, 4);
  assert.equal(f.sigue.length, 0, "a postponed step is not in Sigue");
  const out = renderToStaticMarkup(React.createElement(ui.Fila, { project: p, decisions: [], now: NOW, acts: { onRow: () => {} } }));
  assert.ok(out.includes("Ver los 4"));
});

test("I47-3 #2: each action calls its handler with the right key; a delivery's Aceptar is its own accept", () => {
  const d = { id: "m-1", project: "lumen", title: "Listo", kind: "delivery", options: null, actions: ["fusionar", "cambios"], state: null, at: "2026-11-10T17:00:00Z", ref: "LUM-1", detail: null, links: [], body: null, checks: null, release: null, asker: null };
  const calls: string[] = [];
  const h = {
    onPickNext: (s: string, k: string) => calls.push(`next ${s} ${k}`),
    onStop: (id: string) => calls.push(`stop ${id}`),
    onAccept: (x: Json, a: string) => calls.push(`accept ${x.id} ${a}`),
    onCancel: (s: string, k: string) => calls.push(`cancel ${s} ${k}`),
  };
  for (const a of [{ kind: "primero", key: "LUM-2" }, { kind: "detener", runId: "run-9" }, { kind: "aceptar", decision: d, action: "fusionar" }, { kind: "quitar", key: "LUM-9" }]) ui.filaRun("lumen", a, h)();
  assert.deepEqual(calls, ["next lumen LUM-2", "stop run-9", "accept m-1 fusionar", "cancel lumen LUM-9"]);
  assert.equal(ui.filaRun("lumen", { kind: "primero", key: "x" }, {}), null, "no handler, no button");
  // A delivered step carries the delivery's accept.
  const f = fila(project({ route: routeOf([step("LUM-1", "delivered"), step("LUM-2", "later", { waits: "Paso LUM-1" })]) }), [d]);
  assert.deepEqual(f.ahora[0].acts.map((a: Json) => [a.kind, a.action, a.decision.id]), [["aceptar", "fusionar", "m-1"]]);
  const out = renderToStaticMarkup(React.createElement(ui.Fila, { project: project({ route: routeOf([step("LUM-1", "delivered"), step("LUM-2", "later", { waits: "Paso LUM-1" })]) }), decisions: [d], now: NOW, acts: h }));
  const held = out.slice(out.indexOf('data-fila-row="LUM-2"'));
  assert.equal(held.slice(0, held.indexOf("</li>")).includes("fila-primero"), false, "no Hacer primero on a held plan step");
  assert.ok(out.includes('data-control="fila-aceptar"'));
});

test("I47-3 #3: a long title clamps to two lines and keeps the whole text in title", () => {
  const long = "Una pantalla de seguimiento con la lista de novias, sus pruebas de vestido, los pagos pendientes y las notas internas de la boutique";
  const out = renderToStaticMarkup(React.createElement(ui.Fila, { project: project({ route: routeOf([step("LUM-1", "next", { title: long })]), ready: [{ key: "LUM-1", title: long }] }), decisions: [], now: NOW, acts: {} }));
  assert.ok(out.includes(`title="${long}"`));
  const css = readFileSync(new URL("../ui/src/index.css", import.meta.url), "utf8");
  assert.match(css, /\.edi-ftx b \{[^}]*-webkit-line-clamp: 2;/);
});
