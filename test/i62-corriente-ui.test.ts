// PLA-I62: La corriente (/corriente, later /ceo). Server-rendered with react-dom/server and the pure address model
// called directly. The clicks, measures (1440x800 with the app bar, no scroll), axe and reduced motion run in the
// real-browser pass on the demo server and are recorded as Plania results.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

(globalThis as { React?: unknown }).React = React;
const load = async (p: string) => (await import(new URL(`../ui/src/${p}`, import.meta.url).href)) as Record<string, any>;
const lib = await load("lib/corriente.ts");
const parts = await load("components/corriente/parts.tsx");
const header = await load("components/corriente/header.tsx");
const piezas = await load("components/corriente/piezas.tsx");
const h = React.createElement;
const html = (el: React.ReactElement, at = "/corriente") => renderToStaticMarkup(h(QueryClientProvider, { client: new QueryClient() }, h(MemoryRouter, { initialEntries: [at] }, el)));
const css = readFileSync(new URL("../ui/src/corriente.css", import.meta.url), "utf8");

test("I62-1: the address round-trips views, projects, tabs and what a tab has open", () => {
  assert.deepEqual(lib.atOf(""), { view: "corriente", slug: null, tab: "ahora", ver: null });
  assert.equal(lib.atOf("?v=tetoca").view, "tetoca");
  assert.equal(lib.atOf("?v=nada").view, "corriente");
  const at = lib.atOf("?proyecto=filmia&t=tablero&ver=paso:FIL-42");
  assert.deepEqual(at, { view: "corriente", slug: "filmia", tab: "tablero", ver: { kind: "paso", key: "FIL-42" } });
  assert.equal(lib.searchOf(at), "?proyecto=filmia&t=tablero&ver=paso%3AFIL-42");
  // A ver without a tab opens its own tab.
  assert.equal(lib.atOf("?proyecto=filmia&ver=pr:12").tab, "prs");
  assert.equal(lib.atOf("?proyecto=filmia&ver=miembro:taller-filmia").tab, "equipo");
  for (const v of [{ kind: "sueltos" }, { kind: "pr", n: 7 }, { kind: "doc", id: "x" }, { kind: "maq", what: "base" }, { kind: "tabla", name: "users" }, { kind: "entrega", id: "d1" }])
    assert.deepEqual(lib.verOf(lib.verParam(v)), v);
  assert.equal(lib.verOf("pr:abc"), null);
  assert.equal(lib.verOf("nada:1"), null);
  assert.equal(lib.searchOf({ view: "corriente" }), "");
  assert.equal(lib.hrefOf({ slug: "micasa" }), "/corriente?proyecto=micasa");
});

test("I62-1: a part not drawn yet links to its place in the building with the right parameters", () => {
  assert.equal(lib.legacyHref({}), "/ceo");
  assert.equal(lib.legacyHref({ view: "asistente" }), "/ceo?asistente");
  assert.equal(lib.legacyHref({ slug: "filmia", tab: "ahora" }), "/ceo?piso=filmia");
  assert.equal(lib.legacyHref({ slug: "filmia", tab: "ideas" }), "/ceo?piso=filmia&f=tab%3Aideas");
  assert.equal(lib.legacyHref({ slug: "filmia", tab: "pedidos" }), "/ceo?piso=filmia&f=tab%3Apedido");
  assert.equal(lib.legacyHref({ slug: "filmia", ver: { kind: "paso", key: "FIL-42" } }), "/ceo?piso=filmia&f=step%3AFIL-42");
  assert.equal(lib.legacyHref({ slug: "filmia", ver: { kind: "entrega", id: "d1" } }), "/ceo?piso=filmia&decision=d1");
  assert.equal(lib.legacyHref({ slug: "filmia", tab: "maquinas" }), "/ceo?piso=filmia&nivel=maquinas");
  assert.equal(lib.legacyHref({ slug: "filmia", ver: { kind: "maq", what: "base" } }), "/ceo?piso=filmia&nivel=maquinas&f=maq%3Abase");
});

test("I62-1: words, counts and the clock", () => {
  assert.equal(lib.seatName("product-owner"), "PO");
  assert.equal(lib.seatName("taller"), "Taller");
  assert.equal(lib.countWords(3, "agente trabajando", "agentes trabajando"), "Tres agentes trabajando");
  assert.equal(lib.countWords(1, "entrega te espera", "entregas te esperan", true), "Una entrega te espera");
  assert.equal(lib.countWords(14, "x", "pasos"), "14 pasos");
  assert.equal(lib.thousands(1140), "1,140");
  assert.match(lib.clockLine(Date.parse("2026-11-17T21:06:00Z"), "America/Mexico_City"), /^MAR 17 NOV · 15:06$/);
  assert.equal(lib.hueOf("filmia"), lib.hueOf("filmia"));
});

test("I62-1: the pieces: 44px buttons, one primary, Pedir secondary, the three lights, the logo", () => {
  const out = html(h(piezas.Piezas));
  assert.match(out, /class="cor-btn primary"[^>]*>Aceptar</);
  assert.match(out, /class="cor-btn secondary"[^>]*>Ver antes y después</);
  assert.match(out, /class="cor-btn quiet"[^>]*>Pedir ajuste</);
  assert.match(out, /aria-pressed="true" class="cor-opt"/);
  for (const c of ["cor-dot", "cor-agent", "cor-you", "cor-flowline", "cor-logo"]) assert.ok(out.includes(`class="${c}`), c);
  assert.equal((out.match(/cor-btn primary/g) ?? []).length, 1);
  const head = html(h(header.Head, { view: "corriente", waiting: 2, asistenteUnread: 1, now: Date.parse("2026-11-17T21:06:00Z"), timeZone: "America/Mexico_City", pedirTo: "/ceo", tocaTo: "/corriente?v=tetoca" }));
  assert.match(head, /aria-current="page"[^>]*>Corriente</);
  assert.match(head, /2 te esperan/);
  assert.match(head, /class="cor-btn secondary" data-pedir="true" href="\/ceo"[^>]*>Pedir</);
  assert.match(head, /href="\/machine"[^>]*>Plomería</);
  assert.ok(!/Plania/.test(head), "the interface never says Plania");
  const none = html(h(header.Head, { view: "tetoca", waiting: 0, now: 0, pedirTo: "/x", tocaTo: "/y" }));
  assert.ok(!none.includes("te esperan"));
  assert.match(html(h(parts.NotYet, { what: "Te toca", to: "/ceo?edificio" })), /href="\/ceo\?edificio"/);
});

test("I62-1: the tokens are scoped under .cor, buttons are 44px with radius 10, and reduced motion stops every animation", () => {
  assert.match(css, /\.cor \{[^}]*--cor-bg: #050507/);
  assert.match(css, /\.cor-btn \{[^}]*min-height: 44px;[^}]*border-radius: 10px/);
  assert.match(css, /\.cor-opt \{[^}]*min-height: 44px;[^}]*border-radius: 10px/);
  assert.ok(!/border-radius: 999px/.test(css), "no pills");
  assert.ok(!/Bricolage|Instrument Serif/.test(css));
  const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
  for (const c of ["cor-track::after", "cor-agent", "cor-you", "cor-live", "cor-aura"]) assert.ok(reduced.includes(c), c);
  // Nothing global is redefined.
  assert.ok(!/^:root|^\.dark \{|^body/m.test(css));
});
