// PLA-I56-2: shipped work is shown apart from closed work, and a ready initiative gets Cerrar.
//   the index      a bead per step: Done solid, Merged/Released «shipped» at half strength; the line says what is left
//   the ventanal   Cerrar iniciativa only when every step is Done (can_close); otherwise a line saying what holds it
//   the page       the project page bar and the ticket controls offer Done on Merged and Released
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";

(globalThis as { React?: unknown }).React = React;
const load = async (p: string) => (await import(new URL(`../ui/src/${p}`, import.meta.url).href)) as Record<string, any>;
const floorUi = await load("components/compania/edificio/floor.tsx");
const indiceUi = await load("components/compania/edificio/indice.tsx");
const fichaUi = await load("components/compania/edificio/ficha.tsx");
const etapas = await load("lib/etapas.ts");

type Json = Record<string, any>;
const h = React.createElement;
const NOW = new Date("2026-11-16T20:00:00Z").getTime();
const TZ = "America/Mexico_City";
const noop = () => {};
const text = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

const etapa = (id: string, patch: Json = {}): Json => ({ etapa: id, holder: null, live: false, since: null, qa: null, ci: null, reason: null, ...patch });
const tk = (key: string, title: string, e: Json, status = "x"): Json => ({ key, title, status, phase: null, parent_key: "DEM-I2", etapa: e });
const TICKETS = [
  tk("DEM-I2-1", "Uno", etapa("integrado")),
  tk("DEM-I2-2", "Dos", etapa("integrado")),
  tk("DEM-I2-3", "Tres", etapa("te_toca")),
  tk("DEM-I2-4", "Cuatro", etapa("construyendo", { live: true })),
  tk("DEM-I2-5", "Cinco", etapa("lista")),
  tk("DEM-I2-6", "Seis", etapa("despues")),
];
const pedido = (key: string, stop: string, state: string, patch: Json = {}): Json => ({ key, title: key, stop, state, who: "product-owner", images: 0, understood: null, question: null, guardada: false, ...patch });
const project = (patch: Json = {}): Json => ({
  slug: "demo",
  title: "Demo",
  paused: false,
  light: "ok",
  goal: "Tienda lista",
  team: [
    { agent: "product-owner-demo", role: "product-owner", state: "idle", now: null, queue: [] },
    { agent: "research-demo", role: "research", state: "idle", now: null, queue: [] },
    { agent: "taller-demo", role: "taller", state: "idle", now: null, queue: [] },
  ],
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
  tablero: {
    initiatives: [
      { key: "DEM-I2", title: "Agenda", status: "Active", done: 2, total: 6, tickets: TICKETS },
      { key: "DEM-I3", title: "Cobros", status: "Planning", done: 0, total: 0, tickets: [] },
    ],
    loose: [],
    loose_done: 0,
    done_initiatives: [{ key: "DEM-I1", title: "Alta", done_at: "2026-11-10T00:00:00Z" }],
  },
  ahora: [],
  pedidos: [pedido("DEM-IDEA5", "entendido", "espera"), pedido("DEM-IDEA6", "diseno", "trabajando", { who: "artist" }), pedido("DEM-IDEA3", "plan", "quieta", { guardada: true })],
  ...patch,
});
const floorFor = (tablero: Json) =>
  renderToStaticMarkup(h(MemoryRouter, null, h(floorUi.Floor, { project: project({ tablero }), now: NOW, timeZone: TZ, decisions: [], board: { onTrack: noop, onTicket: noop }, onOpen: noop, onFoco: noop, ask: h("button", null, "Pedir") })));
const idxOf = (html: string) => html.slice(html.indexOf('class="edi-idx"'), html.indexOf('class="edi-askbar"'));
const hecho = (key: string, status: string) => tk(key, key, etapa(status === "Done" ? "hecho" : status === "Released" ? "publicado" : "integrado"), status);
const contacto = (statuses: string[], extra: Json = {}): Json => {
  const tickets = statuses.map((s, i) => hecho(`DEM-I4-${i + 1}`, s));
  const closed = statuses.filter((s) => s === "Done").length;
  return { key: "DEM-I4", title: "Contacto", status: "Active", done: statuses.length, total: statuses.length, closed, can_close: closed === statuses.length, version: 7, tickets, ...extra };
};
const tablero = (...initiatives: Json[]): Json => ({ initiatives, loose: [], loose_done: 0, done_initiatives: [] });

test("I56-2: beads split Done from shipped; a row of solid beads means every step is Done", () => {
  const tr = etapas.boardOf(tablero(contacto(["Done", "Merged", "Merged", "Released"]))).tracks[0];
  assert.deepEqual([tr.closed, tr.shipped, tr.canClose], [1, { merged: 2, released: 1 }, false]);
  assert.deepEqual(indiceUi.beadsOf(tr), ["done", "shipped", "shipped", "shipped"]);
  assert.equal(etapas.trackLine(tr), "4 de 4 · 2 por lanzar · 1 por cerrar");
  const ready = etapas.boardOf(tablero(contacto(["Done", "Done"]))).tracks[0];
  assert.deepEqual(indiceUi.beadsOf(ready), ["done", "done"]);
  assert.equal(etapas.trackLine(ready), "2 de 2 · lista para cerrar");
  // An older read (no closed): landed counts as closed, as before, and nothing is promised.
  const old = etapas.boardOf(tablero({ key: "DEM-I4", title: "Contacto", status: "Active", done: 2, total: 2, tickets: [hecho("DEM-I4-1", "Merged"), hecho("DEM-I4-2", "Merged")] })).tracks[0];
  assert.deepEqual([indiceUi.beadsOf(old), etapas.trackLine(old), old.canClose], [["done", "done"], "2 de 2", false]);
});

test("I56-2: the index line says lista para cerrar or what is left, and shipped beads are drawn at half strength", () => {
  const idx = idxOf(floorFor(tablero(contacto(["Done", "Merged", "Merged", "Merged"]), { ...contacto(["Done", "Done"]), key: "DEM-I5", title: "Avisos" })));
  const i4 = /data-track="DEM-I4"[\s\S]*?<\/button>/.exec(idx)![0];
  assert.match(text(i4), /I4 Contacto 4 de 4 · 3 por lanzar/);
  assert.deepEqual([...i4.matchAll(/<i data-tone="([a-z]+)"/g)].map((m) => m[1]), ["done", "shipped", "shipped", "shipped"]);
  assert.equal(i4.includes("data-cerrar"), false);
  const i5 = /data-track="DEM-I5"[\s\S]*?<\/button>/.exec(idx)![0];
  assert.match(text(i5), /I5 Avisos 2 de 2 · lista para cerrar/);
  assert.match(i5, /data-cerrar="true"/);
  const css = readFileSync(new URL("../ui/src/index.css", import.meta.url), "utf8");
  assert.match(css, /\.edi-ix-beads i\[data-tone="shipped"\] \{ background: color-mix\(in oklab, var\(--bc\) 45%, transparent\); \}/);
});

test("I56-2: the ventanal shows Cerrar iniciativa only when every step is Done, and says what holds it otherwise", () => {
  const calls: unknown[][] = [];
  const cerrar = { onCerrar: (...a: unknown[]) => calls.push(a), busy: null };
  const props = (t: Json, extra: Json = {}) => ({ project: project({ tablero: t }), fref: { kind: "leg", key: "DEM-I4" }, rows: { status: "idle" }, task: { status: "idle" }, doc: { status: "idle" }, slots: {}, now: NOW, timeZone: TZ, onRef: noop, onClose: noop, cerrar, ...extra });
  const ready = renderToStaticMarkup(h(MemoryRouter, null, h(fichaUi.Ficha, props(tablero(contacto(["Done", "Done", "Done"]))))));
  assert.match(text(ready), /3 de 3 hechos · lista para cerrar/);
  assert.match(ready, /<button type="button" class="edi-btn edi-btn-primary"[^>]*data-control="ficha-cerrar-iniciativa">Cerrar iniciativa<\/button>/);
  assert.equal(ready.includes("data-cerrar-falta"), false);

  const held = renderToStaticMarkup(h(MemoryRouter, null, h(fichaUi.Ficha, props(tablero(contacto(["Done", "Merged", "Released"], { done: 3, total: 4, can_close: false }))))));
  assert.equal(held.includes("ficha-cerrar-iniciativa"), false, "no button the server would refuse");
  assert.match(text(held), /3 de 4 hechos · 1 por lanzar · 1 por cerrar/);
  assert.match(text(held), /Podrás cerrarla cuando todos sus pasos estén hechos\. Falta: 1 paso sin terminar; 1 por lanzar \(en la copia de prueba, aún no publicados\); 1 por cerrar/);
  assert.equal(/DEM-I4-\d/.test(/<p class="edi-fi-empty" data-cerrar-falta="">[^<]*<\/p>/.exec(held)![0]), false, "the line names no ticket key");

  const busy = renderToStaticMarkup(h(MemoryRouter, null, h(fichaUi.Ficha, props(tablero(contacto(["Done"])), { cerrar: { ...cerrar, busy: "DEM-I4" } }))));
  assert.match(busy, /disabled=""[^>]*aria-busy="true"[^>]*>Cerrando…<\/button>/);
  // Without the acts (an older page) there is no button.
  const none = renderToStaticMarkup(h(MemoryRouter, null, h(fichaUi.Ficha, props(tablero(contacto(["Done"])), { cerrar: undefined }))));
  assert.equal(none.includes("ficha-cerrar-iniciativa"), false);
});

test("I56-2: the page wires Cerrar to a Done write with the version read; the project bar and ticket controls split and offer", () => {
  const page = readFileSync(new URL("../ui/src/pages/ceo.tsx", import.meta.url), "utf8");
  assert.ok(page.includes('api.patchTask(v.slug, v.key, { status: "Done", version: v.version })'));
  assert.ok(page.includes("cerrar={{ onCerrar: (slug, key, version) => cerrar.mutate({ slug, key, version })"));
  assert.ok(page.includes('e.code === "INITIATIVE_CHILDREN_OPEN"'), "a refusal names what is open");
  const parts = readFileSync(new URL("../ui/src/components/plan/project-parts.tsx", import.meta.url), "utf8");
  assert.ok(parts.includes('className="h-full bg-status-done/45" data-shipped=""') && parts.includes("lista para cerrar"));
  const controls = readFileSync(new URL("../ui/src/components/task-controls.tsx", import.meta.url), "utf8");
  assert.ok(controls.includes('["In review", "Merged", "Released"].includes(task.status)'));
});
