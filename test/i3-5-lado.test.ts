// PLA-I3-5: a step opens in a panel beside the list. The address (lib/corriente.ts), the panel's words (lib/lado.ts)
// and the list and panel server-rendered with fake data. Focus, Esc and the measures at 1440 and 1311x706 are checked
// in a browser and recorded as Plania results.
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
const lado = await load("lib/lado.ts");
const cosasLib = await load("lib/cosas.ts");
const todo = await load("components/corriente/todo.tsx");
const panel = await load("components/corriente/lado.tsx");
const page = await load("pages/corriente.tsx");
const h = React.createElement;
const html = (el: React.ReactElement) => renderToStaticMarkup(h(QueryClientProvider, { client: new QueryClient() }, h(MemoryRouter, { initialEntries: ["/ceo"] }, el)));
const css = readFileSync(new URL("../ui/src/corriente.css", import.meta.url), "utf8");

const NOW = Date.parse("2026-11-18T12:12:00Z");
const SINCE = "2026-11-18T12:00:00Z";
const taller = { agent: "taller-filmia", role: "taller" };
const etapa = (e: string, live = false, holder: any = null, reason: string | null = null) => ({ etapa: e, qa: null, holder, live, since: SINCE, ci: null, reason });
const tk = (key: string, e: string, phase: number, live = false, holder: any = null, reason: string | null = null) => ({ key, title: `Paso ${key}`, status: "Ready", phase, parent_key: "FIL-I1", etapa: etapa(e, live, holder, reason) });
const ini = (key: string, tickets: any[]) => ({ key, title: `Iniciativa ${key}`, status: "Active", done: 0, total: tickets.length, tickets });
const project = (over: Record<string, unknown> = {}): any => ({
  slug: "filmia",
  title: "Filmia",
  paused: false,
  light: "ok",
  goal: null,
  usage: { used: 0 },
  team: [],
  thread: { id: "t", unread: 0, last: null },
  plan: null,
  this_week: { done: 0, docs: 0, prs: 0, last_at: null },
  next: null,
  work: { open: 0, in_progress: 0 },
  tablero: { initiatives: [], loose: [], loose_done: 0, done_initiatives: [] },
  pedidos: [],
  ...over,
});
const three = [tk("FIL-1", "hecho", 1), tk("FIL-2", "construyendo", 2, true, taller), tk("FIL-3", "despues", 3, false, null, "Espera a que FIL-2 se integre.")];
const p = project({ tablero: { initiatives: [ini("FIL-I1", three)], loose: [], loose_done: 0, done_initiatives: [] } });
const cosas = cosasLib.cosasOf({ p, decisions: [], ficha: { ideas: [], promoted: [] } });
const tramos = cosas.grupos.flatMap((g: any) => g.cosas)[0].hilo.tramos;

test("I3-5 #1: a link with the step in the address opens the list with that panel; Back (the address without it) closes it", () => {
  const href = lib.linkTo(lib.pasoAt("filmia", "FIL-2"));
  assert.equal(href, "/ceo?proyecto=filmia&paso=FIL-2");
  const at = lib.atOf(href.slice(href.indexOf("?")));
  assert.deepEqual(at, { view: "corriente", slug: "filmia", tab: "todo", ver: null, paso: "FIL-2" });
  assert.equal(lib.searchOf(at), "?proyecto=filmia&paso=FIL-2");
  // The list itself: no paso at all (the older addresses read the same as before).
  assert.equal(lib.linkTo(lib.pasoAt("filmia", null)), "/ceo?proyecto=filmia");
  assert.deepEqual(lib.atOf("?proyecto=filmia"), { view: "corriente", slug: "filmia", tab: "todo", ver: null });
  // Only on the list: a door or an opened view wins and the panel is not there.
  assert.equal(lib.atOf("?proyecto=filmia&t=equipo&paso=FIL-2").paso, undefined);
  assert.equal(lib.atOf("?proyecto=filmia&ver=paso:FIL-2&paso=FIL-3").paso, undefined);
  assert.equal(lib.atOf("?paso=FIL-2").paso, undefined);
  assert.equal(lib.searchOf({ slug: "filmia", tab: "equipo", paso: "FIL-2" }), "?proyecto=filmia&t=equipo");
  // Esc with the panel open closes it and keeps the list.
  assert.deepEqual(page.escFrom(at), { slug: "filmia", tab: "todo" });
});

test("I3-5: the panel's words from the row's steps", () => {
  const l = lado.ladoOf("FIL-2", tramos, three[1]!.etapa, NOW);
  assert.deepEqual(l, {
    key: "FIL-2",
    i: 1,
    n: 3,
    pos: "PASO 2 DE 3",
    prev: "FIL-1",
    next: "FIL-3",
    tono: "vivo",
    word: "Construyendo",
    who: "Taller · hace 12 min",
    title: "Paso FIL-2",
    espera: lado.ESPERA_OF.vivo,
  });
  assert.equal(lado.ladoOf("FIL-3", tramos, three[2]!.etapa, NOW).espera, "Espera a que FIL-2 se integre.");
  assert.equal(lado.ladoOf("FIL-1", tramos, three[0]!.etapa, NOW).who, null, "a done step says no time");
  assert.equal(lado.ladoOf("FIL-9", tramos, null, NOW), null);
  assert.equal(lado.prioridadWord("P1"), "P1 · alta");
  assert.equal(lado.prioridadWord(null), "Sin prioridad");
  assert.equal(lado.cosaOfPaso(cosas, "FIL-3").key, "FIL-I1");
  assert.equal(lado.cosaOfPaso(cosas, "FIL-9"), null);
  assert.equal(lado.LADO_ABRIR_CAP, "Completo: hecho cuando, evidencia, PR e historia.");
  assert.equal(lado.LADO_KEYS, "← → otro paso · Esc cerrar");
});

test("I3-5 #3: previous is inert on the first step and next on the last", () => {
  const first = lado.ladoOf("FIL-1", tramos, null, NOW);
  const last = lado.ladoOf("FIL-3", tramos, null, NOW);
  assert.equal(first.prev, null);
  assert.equal(lado.ladoMove("ArrowLeft", first), null);
  assert.equal(lado.ladoMove("ArrowRight", first), "FIL-2");
  assert.equal(last.next, null);
  assert.equal(lado.ladoMove("ArrowRight", last), null);
  assert.equal(lado.ladoMove("ArrowLeft", last), "FIL-2");
  assert.equal(lado.ladoMove("Enter", last), null);
  const draw = (k: string) =>
    html(h(panel.PasoLado, { slug: "filmia", k, tramos, etapa: null, iniciativa: { key: "FIL-I1", title: "Iniciativa FIL-I1" }, links: { full: (x: string) => `/full/${x}`, iniciativa: (x: string) => `/ini/${x}` }, onMove: () => {}, onClose: () => {}, now: NOW }));
  const a = draw("FIL-1");
  assert.match(a, /aria-label="Paso anterior" aria-disabled="true"/);
  assert.match(a, /aria-label="Paso siguiente" aria-disabled="false"/);
  const z = draw("FIL-3");
  assert.match(z, /aria-label="Paso anterior" aria-disabled="false"/);
  assert.match(z, /aria-label="Paso siguiente" aria-disabled="true"/);
  // The rest of the panel, top to bottom.
  const order = ["cor-lado-head", "PASO 1 DE 3", "cor-lado-strip", "cor-lado-st", "cor-lado-t", "Qué espera", "Iniciativa", "Prioridad", "Abrir el paso", "Completo: hecho cuando", "← → otro paso"];
  let at = -1;
  for (const s of order) {
    const i = a.indexOf(s, at + 1);
    assert.ok(i > at, `${s} comes after the one before it`);
    at = i;
  }
  assert.match(a, /href="\/full\/FIL-1"/);
  assert.match(a, /href="\/ini\/FIL-I1"/);
  assert.match(a, /data-lado-paso="FIL-1" aria-current="step"|aria-current="step"[^>]*data-lado-paso="FIL-1"/);
});

test("I3-5: the open step's button is pressed and ringed in its row; the panel sits above Pedir, never over it", () => {
  const links = { open: (c: any) => `/x/${c.key}`, hecha: (k: string) => `/h/${k}`, idea: (k: string) => `/i/${k}`, hecho: "/hecho", paso: (k: string) => `/p/${k}` };
  const out = html(
    h(todo.Todo, {
      p,
      decisions: [],
      links,
      companyPaused: false,
      lado: { open: "FIL-2", onPaso: () => {} },
      panel: () => h("aside", { "data-lado": "FIL-2" }),
      bottom: () => h("form", { "data-pedir-bar": true }),
    }),
  );
  // (The list waits for its ficha read here, so it is the panel's place that is checked; the row below.)
  const mid = out.indexOf('class="cor-todo-mid"');
  assert.ok(mid > 0 && out.indexOf("data-lado") > mid && out.indexOf("data-pedir-bar") > out.indexOf("data-lado"));
  const list = html(h(todo.TodoList, { p, cosas, links, companyPaused: false, lado: { open: "FIL-2", onPaso: () => {} } }));
  assert.match(list, /class="cor-paso open"[^>]*aria-pressed="true"[^>]*data-paso="FIL-2"/);
  assert.match(list, /aria-pressed="false"[^>]*data-paso="FIL-1"/);
  // Without the panel (a small thread, older callers) the buttons are not toggles.
  const plain = html(h(todo.TodoList, { p, cosas, links, companyPaused: false }));
  assert.doesNotMatch(plain, /class="cor-paso[^"]*"[^>]*aria-pressed/);
  assert.match(css, /\.cor-lado \{[^}]*position: absolute;[^}]*top: 0;[^}]*bottom: 0;[^}]*width: 480px;/);
  assert.match(css, /\.cor-todo-mid \{[^}]*position: relative;/);
  assert.match(css, /\.cor-paso\.open i \{ outline: 2px solid var\(--cor-violet-4\); outline-offset: 2px; \}/);
  assert.match(css, /@media \(max-width: 639px\) \{ \.cor-lado \{ display: none; \} \}/);
  assert.equal(panel.LADO_MIN_PX, 640);
});
