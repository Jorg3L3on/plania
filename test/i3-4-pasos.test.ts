// PLA-I3-4: each step of a row's thread is a button that says its name. Words from ui/src/lib/tramo.ts; the list
// server-rendered with fake data (hover, the tooltip's place and the growth are checked in a browser).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

(globalThis as { React?: unknown }).React = React;
const load = async (p: string) => (await import(new URL(`../ui/src/${p}`, import.meta.url).href)) as Record<string, any>;
const tramo = await load("lib/tramo.ts");
const cosasLib = await load("lib/cosas.ts");
const todo = await load("components/corriente/todo.tsx");
const hilo = await load("components/corriente/hilo.tsx");
const h = React.createElement;
const html = (el: React.ReactElement) => renderToStaticMarkup(h(QueryClientProvider, { client: new QueryClient() }, h(MemoryRouter, { initialEntries: ["/ceo"] }, el)));
const css = readFileSync(new URL("../ui/src/corriente.css", import.meta.url), "utf8");

const NOW = Date.parse("2026-11-18T12:12:00Z");
const SINCE = "2026-11-18T12:00:00Z";
const etapa = (e: string, live = false, holder: any = null) => ({ etapa: e, qa: null, holder, live, since: SINCE, ci: null, reason: null });
const tk = (key: string, e: string, phase: number, live = false, holder: any = null) => ({ key, title: `Paso ${key}`, status: e === "despues" ? "Backlog" : "Ready", phase, parent_key: null, etapa: etapa(e, live, holder) });
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
const links = { open: (c: any) => `/x/${c.key}`, hecha: (k: string) => `/h/${k}`, idea: (k: string) => `/i/${k}`, hecho: "/hecho", paso: (k: string) => `/p/${k}` };
const taller = { agent: "taller-filmia", role: "taller" };

test("I3-4: Tramo keeps the stage word, the holder and since", () => {
  const p = project({ tablero: { initiatives: [ini("FIL-I1", [tk("FIL-1", "construyendo", 1, true, taller), tk("FIL-2", "en_qa", 2)])], loose: [], loose_done: 0, done_initiatives: [] } });
  const c = cosasLib.cosasOf({ p, decisions: [], ficha: { ideas: [], promoted: [] } }).grupos.flatMap((g: any) => g.cosas)[0];
  assert.deepEqual(
    c.hilo.tramos.map((t: any) => [t.key, t.word, t.holder?.role ?? null, t.since]),
    [
      ["FIL-1", "Construyendo", "taller", SINCE],
      ["FIL-2", "En QA · en cola", null, SINCE],
    ],
  );
});

test("I3-4 #2: the tooltip's words for each tone", () => {
  const t = (tono: string, e: string, word: string, holder: any = null) => ({ key: "PLA-I3-4", title: "Cada paso es un botón", etapa: e, tono, word, holder, since: SINCE });
  const vivo = tramo.tramoTip(t("vivo", "construyendo", "Construyendo", taller), 1, 5, NOW);
  assert.deepEqual(vivo, {
    key: "PLA-I3-4",
    pos: "PASO 2 DE 5",
    title: "Cada paso es un botón",
    state: "Construyendo · Taller · 12 min",
    hint: "CLIC PARA ABRIRLO",
    aria: "Paso 2 de 5, «Cada paso es un botón»: construyendo, Taller, 12 min.",
  });
  assert.equal(tramo.tramoTip(t("toca", "te_toca", "Te toca"), 0, 1, NOW).state, "Te toca · 12 min");
  assert.equal(tramo.tramoTip(t("fila", "lista", "Lista para empezar"), 2, 5, NOW).state, "Lista para empezar");
  assert.equal(tramo.tramoTip(t("quieto", "despues", "Después"), 3, 5, NOW).state, "Después");
  assert.equal(tramo.tramoTip(t("hecho", "hecho", "Hecho"), 0, 5, NOW).state, "Hecho");
  assert.equal(tramo.tramoTip(t("hecho", "hecho", "Hecho"), 0, 5, NOW).aria, "Paso 1 de 5, «Cada paso es un botón»: hecho.");
  // A live step nobody holds says what it can; a step built without the word (the Hecho rows) falls back to its stage.
  assert.equal(tramo.tramoTip({ ...t("vivo", "construyendo", "Construyendo"), since: null }, 0, 1, NOW).state, "Construyendo");
  assert.equal(tramo.tramoTip({ key: "X", title: "X", etapa: "despues", tono: "quieto" }, 0, 1, NOW).state, "Después");
});

test("I3-4: the roving tab stop and the arrows", () => {
  assert.equal(tramo.firstOpen([{ tono: "hecho" }, { tono: "hecho" }, { tono: "vivo" }]), 2);
  assert.equal(tramo.firstOpen([{ tono: "hecho" }]), 0);
  assert.equal(tramo.rovingNext("ArrowRight", 1, 3), 2);
  assert.equal(tramo.rovingNext("ArrowRight", 2, 3), 2, "stops at the last step");
  assert.equal(tramo.rovingNext("ArrowLeft", 0, 3), 0);
  assert.equal(tramo.rovingNext("Home", 2, 3), 0);
  assert.equal(tramo.rovingNext("End", 0, 3), 2);
  assert.equal(tramo.rovingNext("Enter", 0, 3), null);
});

test("I3-4 #1: every step is a button in a toolbar, one tab stop per row, named by position, title and state", () => {
  const p = project({
    tablero: {
      initiatives: [ini("FIL-I1", [tk("FIL-1", "hecho", 1), tk("FIL-2", "construyendo", 2, true, taller), tk("FIL-3", "despues", 3)]), ini("FIL-I2", [tk("FIL-4", "lista", 1), tk("FIL-5", "despues", 2)])],
      loose: [],
      loose_done: 0,
      done_initiatives: [{ key: "FIL-I0", title: "Hecha", idea_key: null, done_at: SINCE }],
    },
  });
  const cosas = cosasLib.cosasOf({ p, decisions: [], ficha: { ideas: [], promoted: [] } });
  const out = html(h(todo.TodoList, { p, cosas, links, companyPaused: false }));
  const bars = out.match(/<span class="cor-h-sg pasos" role="toolbar"[^>]*>/g) ?? [];
  assert.equal(bars.length, 2, "one toolbar per initiative row");
  assert.match(bars[0]!, /aria-label="Pasos de «Iniciativa FIL-I1»"/);
  const buttons = out.match(/<button[^>]*class="cor-paso[^"]*"[^>]*>/g) ?? [];
  assert.equal(buttons.length, 5);
  assert.equal(buttons.filter((b) => b.includes('tabindex="0"')).length, 2, "one tab stop per row");
  assert.match(out, /<button type="button" class="cor-paso" tabindex="0" aria-label="Paso 2 de 3, «Paso FIL-2»: construyendo, Taller, [^"]+\." data-paso="FIL-2"/, "the tab stop is the first open step");
  assert.match(out, /aria-label="Paso 1 de 2, «Paso FIL-4»: lista para empezar\."/);
  // The toolbar is not inside an aria-hidden parent; the decorative stops are hidden one by one.
  const thread = out.match(/<span class="cor-hilo born act[^"]*"[^>]*>/)?.[0] ?? "";
  assert.ok(thread && !thread.includes("aria-hidden"), thread);
  // The Hecho row's small thread stays decorative.
  assert.match(out, /<span class="cor-hilo born sm" aria-hidden="true" data-hilo="publicado">/);
  assert.equal((out.match(/data-hilo="publicado"[^]*?<\/li>/)?.[0] ?? "").includes("<button"), false);
});

test("I3-4: without a step link (and when small) the thread stays decorative", () => {
  const p = project({ tablero: { initiatives: [ini("FIL-I1", [tk("FIL-1", "lista", 1)])], loose: [], loose_done: 0, done_initiatives: [] } });
  const cosas = cosasLib.cosasOf({ p, decisions: [], ficha: { ideas: [], promoted: [] } });
  const { paso: _, ...sin } = links;
  const out = html(h(todo.TodoList, { p, cosas, links: sin, companyPaused: false }));
  assert.equal(out.includes("cor-paso"), false);
  assert.match(out, /class="cor-hilo born" aria-hidden="true"/);
  const c = cosas.grupos.flatMap((g: any) => g.cosas)[0];
  assert.equal(html(h(hilo.Hilo, { h: c.hilo, small: true, onOpen: () => {} })).includes("<button"), false);
});

test("I3-4: 44 px hit areas that touch, growth by transform, none with reduced motion", () => {
  assert.match(css, /\.cor-h-sg\.pasos \{ gap: 0;/);
  assert.match(css, /\.cor-paso \{[^}]*height: 44px;[^}]*padding: 0 1\.5px;/);
  assert.match(css, /\.cor-h-sg \.cor-paso i \{ height: 8px; transition: transform 120ms ease-out; \}/);
  assert.match(css, /\.cor-paso:hover i, \.cor-paso\.on i, \.cor-paso:focus-visible i \{ transform: scaleY\(1\.75\); \}/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.cor-h-sg \.cor-paso i \{ transition: none; \}\s*\.cor-paso:hover i, \.cor-paso\.on i, \.cor-paso:focus-visible i \{ transform: none; \}/);
  assert.match(css, /\.cor-tip \{ position: fixed;/);
});
