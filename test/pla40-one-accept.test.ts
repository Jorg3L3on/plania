// PLA-40: one Aceptar per delivery on a floor. A delivery that hangs as a card under its maker is accepted there;
// Ahora points to that card («Ver la entrega ↓») and the board's ticket card does not repeat the button. The card's
// Aceptar names what it does. Server-rendered with fake data; no browser, no database.
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

type Json = Record<string, any>;
const h = React.createElement;
const noop = () => {};
const NOW = new Date("2026-11-15T20:44:00Z").getTime();
const member = (role: string): Json => ({ agent: `${role}-workia`, role, template: role, state: "idle", now: null, last: null, produced: null, waiting: null, queue: [] });
const project = (patch: Json = {}): Json => ({
  slug: "workia", title: "Workia", paused: false, light: "ok", light_reason: null, goal: null,
  rumbo: { goal_id: null, goal: null, why: "", target_on: null, forecast_on: null, weeks_behind: null, missing: true },
  usage: { used: 0 }, team: ["product-owner", "taller", "qa"].map(member), thread: { id: "t", unread: 0, last: null }, plan: null,
  this_week: { done: 0, docs: 0, prs: 0, last_at: null }, next: null, ready: [], work: { open: 1, in_progress: 0 }, orders: [],
  tablero: { initiatives: [], loose: [{ key: "WRK-32", title: "Aviso de nueva clienta", etapa: { etapa: "te_toca", reason: null } }], loose_done: 0 },
  ...patch,
});
const delivery = (patch: Json = {}): Json => ({
  id: "dv-1", project: "workia", title: "Aviso de nueva clienta", kind: "deliverable", options: null, actions: ["aceptar", "cambios"], state: null,
  at: "2026-11-15T20:40:00Z", ref: "WRK-32", detail: null, links: [{ kind: "ticket", ref: "WRK-32", title: "Aviso" }], preview_url: null,
  asker: { agent: "product-owner-workia", role: "product-owner" }, ...patch,
});
const floor = (ds: Json[]) => {
  const p = { ...project(), next_move: nextMove(project() as never, ds as never, {}) };
  return renderToStaticMarkup(h(MemoryRouter, null, h(floorc.Floor, { project: p, now: NOW, decisions: ds, acts: { now: NOW, busy: null, onAct: noop }, nowActs: { onStart: noop, onPlan: noop }, board: { onAccept: noop } })));
};
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

test("PLA-40 #1 #2: a hanging delivery has one Aceptar, on its card; Ahora points to it", () => {
  const s = floor([delivery()]);
  assert.equal(count(s, /data-action="(aceptar|fusionar)"/g) + count(s, /data-act="aceptar"/g) + count(s, /data-now-action="decision"/g), 1, "one accept on the floor");
  assert.match(s, /data-bubble="dv-1"[\s\S]*data-action="aceptar"/);
  assert.match(s, /data-now-action="ver-entrega"[^>]*>Ver la entrega ↓</);
});

test("PLA-40 #3: the card's Aceptar names its effect, and says when it was not seen", () => {
  const doc = ev.acceptWords(delivery());
  assert.equal(doc.label, "Aprobar y cerrar");
  assert.match(doc.hint, /pasa a Hecho/);
  assert.match(doc.hint, /sin haberla visto/);
  const pr = ev.acceptWords(delivery({ links: [{ kind: "pr", ref: "https://github.com/x/y/pull/1", title: "PR" }], preview_url: "https://x.test" }));
  assert.equal(pr.label, "Aprobar y pasar a prueba");
  assert.equal(pr.hint, "Se integra a la copia de prueba; lo publicado no cambia. Luego arranca el siguiente paso.");
  assert.doesNotMatch(`${pr.label} ${pr.hint}`, /sandbox/);
  assert.doesNotMatch(pr.hint, /sin haberla visto/);
  const s = floor([delivery()]);
  assert.match(s, /data-action="aceptar"[^>]*>Aprobar y cerrar</);
  assert.match(s, /data-accept-hint="true">La entrega pasa a Hecho/);
  assert.doesNotMatch(/data-accept-hint="true">([^<]*)</.exec(s)![1]!, /WRK-32/, "no ticket key in the hint");
});

test("PLA-40 #4: a PR delivery accepted from Ahora's evidence card says what Aceptar does too", () => {
  const s = floor([delivery({ kind: "pr", actions: ["fusionar", "cambios"], links: [{ kind: "pr", ref: "https://github.com/x/y/pull/1", title: "PR" }] })]);
  assert.equal(count(s, /data-accept-hint="true"/g), 1, "one hint");
  assert.match(s, /data-accept-hint="true">Se integra a la copia de prueba/);
  // Mianovia, 2026-11-16: a delivery with a hold (no «antes» still) still shows the card's Aceptar, so it says it too.
  const held = floor([delivery({ kind: "pr", actions: ["fusionar", "cambios"], hold: "Faltan fotos", links: [{ kind: "pr", ref: "https://github.com/x/y/pull/1", title: "PR" }] })]);
  if (/data-ev-act="aceptar"/.test(held)) assert.match(held, /data-accept-hint="true">Se integra a la copia de prueba/);
});
