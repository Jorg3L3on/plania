// PLA-42: every approve on the floor says what it approves and what happens. «Aprobar y pasar a prueba» (a PR,
// merged into the test copy), «Aprobar y cerrar» (no PR, Hecho), «Aprobar el plan»; a line under each; the button's
// title and aria-label name the delivery; no «sandbox» on screen. Server-rendered with fake data; no browser, no DB.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { nextMove } from "../src/api/company-move.js";

(globalThis as { React?: unknown }).React = React;

const load = async (p: string) => (await import(new URL(`../ui/src/${p}`, import.meta.url).href)) as Record<string, any>;
const floorc = await load("components/compania/edificio/floor.tsx");
const ev = await load("lib/evidencia.ts");
const v2 = await load("lib/v2.ts");
const pb = await load("lib/probador.ts");
const ed = await load("lib/edificio.ts");

type Json = Record<string, any>;
const h = React.createElement;
const noop = () => {};
const NOW = new Date("2026-11-16T09:00:00Z").getTime();
const TITLE = "El aviso de clienta nueva llega a su sucursal y a la dueña";
const PR = { kind: "pr", ref: "https://github.com/x/y/pull/7", title: "PR" };
const member = (role: string): Json => ({ agent: `${role}-workia`, role, template: role, state: "idle", now: null, last: null, produced: null, waiting: null, queue: [] });
const project = (): Json => ({
  slug: "workia", title: "Workia", paused: false, light: "ok", light_reason: null, goal: null,
  rumbo: { goal_id: null, goal: null, why: "", target_on: null, forecast_on: null, weeks_behind: null, missing: true },
  usage: { used: 0 }, team: ["product-owner", "taller", "qa"].map(member), thread: { id: "t", unread: 0, last: null }, plan: null,
  this_week: { done: 0, docs: 0, prs: 0, last_at: null }, next: null, ready: [], work: { open: 1, in_progress: 0 }, orders: [],
  tablero: { initiatives: [], loose: [], loose_done: 0 },
});
const delivery = (patch: Json = {}): Json => ({
  id: "dv-1", project: "workia", title: TITLE, kind: "pr", options: null, actions: ["fusionar", "cambios"], state: null,
  at: "2026-11-16T08:40:00Z", ref: "WRK-40", detail: null, links: [PR], preview_url: null,
  asker: { agent: "taller-workia", role: "taller" }, ...patch,
});
const floor = (ds: Json[]) => {
  const p = { ...project(), next_move: nextMove(project() as never, ds as never, {}) };
  return renderToStaticMarkup(h(MemoryRouter, null, h(floorc.Floor, { project: p, now: NOW, decisions: ds, acts: { now: NOW, busy: null, onAct: noop }, nowActs: { onStart: noop, onPlan: noop }, board: { onAccept: noop } })));
};
const strip = (s: string) => s.replace(/<[^>]+>/g, " ");

test("PLA-42 #1 #2: a PR delivery reads «Aprobar y pasar a prueba», its line under it, and names the delivery", () => {
  const m = nextMove(project() as never, [delivery()] as never)!;
  assert.equal(m.texto, `Aprobar «${TITLE}»`);
  assert.equal(m.accion.label, "Aprobar y pasar a prueba");
  const s = floor([delivery()]);
  assert.match(s, /data-now-action="decision"[^>]*>Aprobar y pasar a prueba</);
  assert.ok(s.includes(`aria-label="Aprobar «${TITLE}» y pasar a prueba"`));
  assert.ok(s.includes(`title="Aprobar «${TITLE}» y pasar a prueba"`));
  assert.match(s, /data-accept-hint="true">Se integra a la copia de prueba; lo publicado no cambia\. Luego arranca el siguiente paso\.</);
});

test("PLA-42 #1: the screenshot case, a held PR delivery: the card's own button says it too", () => {
  const s = floor([delivery({ hold: "Faltan fotos: Sin antes: la copia de prueba no arrancó" })]);
  assert.match(s, /data-ev-act="aceptar"[^>]*>Aprobar y pasar a prueba</);
  assert.match(s, new RegExp(`data-ev-act="aceptar"[^>]*aria-label="Aprobar «${TITLE}» y pasar a prueba"`));
  assert.match(s, /data-accept-hint="true">Se integra a la copia de prueba/);
  assert.doesNotMatch(strip(s), />\s*Aceptar\s*</);
});

test("PLA-42 #1: without a PR it is «Aprobar y cerrar»; a plan is «Aprobar el plan»; done states and the switch", () => {
  const w = ev.acceptWords({ kind: "deliverable", links: [], preview_url: "x", title: "Doc de precios" });
  assert.deepEqual([w.label, w.hint, w.aria], ["Aprobar y cerrar", "La entrega pasa a Hecho y arranca el siguiente paso.", "Aprobar «Doc de precios» y cerrar"]);
  assert.deepEqual(ev.APPROVE.plan, { label: "Aprobar el plan", hint: "Se crean sus pasos y Taller empieza." });
  assert.equal(v2.stateText({ action: "fusionar", at: "x", result: {} }), "Aprobado · en la copia de prueba");
  assert.equal(v2.stateText({ action: "aceptar", at: "x", result: { status: "Done" } }), "Aprobado · cerrado");
  assert.equal(ev.EV_WORDS.auto, "Aprobar sola si las pruebas pasan (solo a la copia de prueba)");
  assert.equal(ed.AUTO_LABEL, "Aprobar sola si las pruebas pasan (solo a la copia de prueba)");
});

test("PLA-42 #3: no «sandbox» on the floor, the Probador or Máquinas words", () => {
  const s = floor([delivery({ hold: "Faltan fotos" })]);
  assert.doesNotMatch(strip(s), /sandbox/i);
  assert.doesNotMatch([pb.PROBADOR_WORDS.nueva, ...pb.siAceptas("sandbox", "X"), pb.frameOf({ label: "L", desktop: { antes: { still: null, missing: false, error: null }, despues: { still: null } } }, "desktop", "antes").why].join(" "), /sandbox/i);
});
