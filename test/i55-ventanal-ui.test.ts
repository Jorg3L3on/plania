// PLA-I55-1 (El ventanal): the floor is the ventanal and the index. Server-rendered; no browser, no database.
// Fake names only.
//   the index     every teammate, one line per initiative with a bead per step, the ideas line; what is open is pressed
//   the ventanal  La ficha with a home tab (Te toca / Ahora) that holds the floor's Ahora band; ✕ only away from home
//   the address   Resumen is named (?f=tab:resumen); no ?f= is the home tab
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
const tk = (key: string, title: string, e: Json): Json => ({ key, title, status: "x", phase: null, parent_key: "DEM-I2", etapa: e });
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
const floor = (extra: Json = {}, p: Json = project()) =>
  renderToStaticMarkup(h(MemoryRouter, null, h(floorUi.Floor, { project: p, now: NOW, timeZone: TZ, decisions: [], board: { onTrack: noop, onTicket: noop }, onOpen: noop, onFoco: noop, ask: h("button", null, "Pedir"), ...extra })));

test("I55-1: a bead per step, the done ones first, then from Te toca back to Por hacer", () => {
  const tr = etapas.boardOf(project().tablero).tracks[0];
  assert.deepEqual(indiceUi.beadsOf(tr), ["done", "done", "jorge", "now", "ready", "pending"]);
});

test("I55-1: the index lists every teammate, each initiative on one line with its beads, the completed ones and the ideas", () => {
  const html = floor();
  const idx = html.slice(html.indexOf('class="edi-idx"'), html.indexOf('class="edi-askbar"'));
  // PLA-I58-1: the team left the index for El timbre in the head.
  assert.equal(idx.includes("edi-sala-mate") || idx.includes('data-ix="equipo"'), false, "no team in the index");
  assert.deepEqual([...html.matchAll(/class="edi-sala-mate"[^>]*data-agent="([^"]+)"/g)].map((m) => m[1]), ["product-owner-demo", "research-demo", "taller-demo"]);
  assert.match(text(html), /Equipo nadie trabaja/);
  assert.match(text(idx), /Iniciativas 2 abiertas · 1 completa/);
  // One line per initiative: the short code, the name, the count with what waits on the owner, and the beads.
  const agenda = /<button type="button" class="edi-ix-ini"[^>]*data-track="DEM-I2"[\s\S]*?<\/button>/.exec(idx)![0];
  assert.match(text(agenda), /I2 Agenda 2 de 6 · te toca 1/);
  assert.deepEqual([...agenda.matchAll(/<i data-tone="([a-z]+)"/g)].map((m) => m[1]), ["done", "done", "jorge", "now", "ready", "pending"]);
  assert.match(agenda, /title="DEM-I2 · Agenda"/, "the full key is in the title");
  // An initiative with no steps yet draws a dashed line, not beads.
  assert.match(/data-track="DEM-I3"[\s\S]*?<\/button>/.exec(idx)![0], /data-beads="none"/);
  assert.match(idx, /class="edi-ix-done" data-folded="1"[\s\S]*?<b>✓ DEM-I1<\/b>Alta/);
  // Ideas: the live ones as dots at their stops; the shelved one is not a dot.
  assert.match(text(idx), /Ideas tomando forma · 2 1 te espera/);
  assert.deepEqual([...idx.matchAll(/<i data-state="([a-z]+)"/g)].map((m) => m[1]), ["espera", "trabajando"]);
  assert.equal(idx.includes("tablero-estacion") || idx.includes('class="dark sb'), false, "no stage board in the index");
});

test("I55-1: what the ventanal shows is pressed in the index", () => {
  const pressed = (html: string) =>
    [...html.matchAll(/<button type="button" class="edi-ix-(?:mate|ini|ideas)"[^>]*>/g)]
      .map((m) => m[0])
      .filter((tag) => tag.includes('aria-pressed="true"'))
      .map((tag) => /data-(?:agent|track)="([^"]+)"/.exec(tag)?.[1] ?? /data-control="([^"]+)"/.exec(tag)![1]);
  assert.deepEqual(pressed(floor()), []);
  // PLA-I58-1: a teammate opens from La sala, so nothing in the index is pressed for it.
  assert.deepEqual(pressed(floor({ foco: { kind: "member", agent: "taller-demo" } })), []);
  assert.deepEqual(pressed(floor({ foco: { kind: "leg", key: "DEM-I2" } })), ["DEM-I2"]);
  assert.deepEqual(pressed(floor({ foco: { kind: "tab", tab: "pedido" } })), ["indice-ideas"]);
  assert.deepEqual(pressed(floor({ foco: { kind: "pedido", key: "DEM-IDEA5" } })), ["indice-ideas"]);
});

test("I55-1: the floor hands the page the home tab, the open initiative's own board and the tube", () => {
  let got: Json | null = null;
  floor({ foco: { kind: "leg", key: "DEM-I2" }, ventanal: (parts: Json) => ((got = parts), null) });
  assert.deepEqual({ word: got!.home.word, tone: got!.home.tone, count: got!.home.count }, { word: "Ahora", tone: "now", count: 0 });
  const board = renderToStaticMarkup(h(MemoryRouter, null, got!.board));
  assert.match(board, /class="dark sb-one sb"/);
  assert.deepEqual([...board.matchAll(/data-card="([^"]+)"/g)].map((m) => m[1]).sort(), ["DEM-I2-3", "DEM-I2-4", "DEM-I2-5", "DEM-I2-6"]);
  assert.equal(board.includes("DEM-I3"), false, "only that initiative's track");
  assert.match(renderToStaticMarkup(h(MemoryRouter, null, got!.tubo)), /class="tubo"/);
  // Home (no ?f=): no board is built.
  floor({ ventanal: (parts: Json) => ((got = parts), null) });
  assert.equal(got!.board, undefined);
  // On the Máquinas level La ficha is a side column, only while the address names something; Trabajo keeps its home.
  const down = floor({ nivel: "maquinas", maquinas: () => h("div", { className: "edi-maq" }), foco: { kind: "maq", what: "servidor" }, ventanal: () => h("section", { className: "edi-ficha" }) });
  assert.equal((down.match(/class="edi-ficha"/g) ?? []).length, 1);
  assert.match(down, /class="edi-maq-side"><section class="edi-ficha"/);
  const downHome = floor({ nivel: "maquinas", maquinas: () => h("div", { className: "edi-maq" }), ventanal: () => h("section", { className: "edi-ficha" }) });
  assert.equal(downHome.includes("edi-ficha"), false);
});

test("I55-1: La ficha's first tab is the floor's home; ✕ shows only away from it and names where it goes", () => {
  const props = (extra: Json) => ({ project: project(), fref: { kind: "tab", tab: "resumen" }, rows: { status: "idle" }, task: { status: "idle" }, doc: { status: "idle" }, slots: {}, now: NOW, timeZone: TZ, onRef: noop, onClose: noop, ...extra });
  const home = { word: "Te toca", tone: "you", count: 2, body: h("div", { className: "edi-home" }, "la banda") };
  const at = renderToStaticMarkup(h(MemoryRouter, null, h(fichaUi.Ficha, props({ home, homeOn: true, onHome: noop }))));
  assert.match(at, /<section class="dark edi-ficha"[^>]*data-ficha="inicio" data-tone="you"/);
  assert.match(at, /class="edi-fi-tab edi-fi-home" data-tone="you" aria-selected="true"[^>]*>.*?Te toca<small>2<\/small>/);
  assert.equal((at.match(/aria-selected="true"/g) ?? []).length, 1, "no other tab is selected at home");
  assert.ok(at.includes("la banda") && !at.includes('data-fi-sec="rumbo"') && !at.includes("ficha-cerrar"));
  const away = renderToStaticMarkup(h(MemoryRouter, null, h(fichaUi.Ficha, props({ home, homeOn: false, onHome: noop }))));
  assert.match(away, /class="edi-fi-tab edi-fi-home" data-tone="you" aria-selected="false"/);
  assert.match(away, /aria-label="Cerrar y volver a Te toca"[^>]*data-control="ficha-cerrar"/);
  assert.ok(away.includes('data-fi-sec="rumbo"') && !away.includes("la banda"));
  assert.match(away, /<h3 class="sr-only">Resumen<\/h3>/, "the tab's sections have a heading above them");
  // An initiative shows its own board over its done steps (the open ones are the board's cards).
  const leg = renderToStaticMarkup(h(MemoryRouter, null, h(fichaUi.Ficha, props({ fref: { kind: "leg", key: "DEM-I2" }, slots: { board: h("div", { "data-el": "tablero" }) } }))));
  assert.ok(leg.indexOf('data-el="tablero"') > leg.indexOf("edi-fi-title") && leg.indexOf('data-el="tablero"') < leg.indexOf('data-fi-sec="hechos"'));
  assert.equal(leg.includes('data-fi-sec="abiertos"'), false);
  // The Pedido tab shows the tube.
  const ped = renderToStaticMarkup(h(MemoryRouter, null, h(fichaUi.Ficha, props({ fref: { kind: "tab", tab: "pedido" }, slots: { tubo: h("div", { "data-el": "tubo" }) } }))));
  assert.ok(ped.includes('data-el="tubo"') && ped.includes('data-control="ficha-guardadas"') && !ped.includes('data-fi-list="pedido"'));
});

test("I55-1: the page opens La ficha only while the address names something; the styles drop the cap and the third column", () => {
  const page = readFileSync(new URL("../ui/src/pages/ceo.tsx", import.meta.url), "utf8");
  assert.ok(page.includes("const fichaOpen = !!fichaAt;") && page.includes("homeOn={!fichaAt}") && page.includes("onHome={closeFicha}"));
  assert.equal(/edi-ficha"\) === "closed"|wideFicha|fichaHidden/.test(page), false, "no remembered open/closed state any more");
  const css = readFileSync(new URL("../ui/src/index.css", import.meta.url), "utf8");
  assert.doesNotMatch(css, /\.edi-ahora-slot \{[^}]*max-height/);
  assert.doesNotMatch(css, /\.edi-bld\[data-ficha/);
  assert.match(css, /\.sb-one \.sb-corner, \.sb-one \.sb-track \{ display: none; \}/);
});
