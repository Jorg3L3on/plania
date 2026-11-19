// PLA-I3-3: the row of the project's list. Words and the filter from ui/src/lib/fila.ts; the list server-rendered with
// fake data (the widths and the two-line wrap are checked in a browser).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

(globalThis as { React?: unknown }).React = React;
const load = async (p: string) => (await import(new URL(`../ui/src/${p}`, import.meta.url).href)) as Record<string, any>;
const fila = await load("lib/fila.ts");
const cosasLib = await load("lib/cosas.ts");
const todo = await load("components/corriente/todo.tsx");
const h = React.createElement;
const html = (el: React.ReactElement) => renderToStaticMarkup(h(QueryClientProvider, { client: new QueryClient() }, h(MemoryRouter, { initialEntries: ["/ceo"] }, el)));
const css = readFileSync(new URL("../ui/src/corriente.css", import.meta.url), "utf8");

const etapa = (e: string, live = false) => ({ etapa: e, qa: null, holder: null, live, since: "2026-11-17T10:00:00Z", ci: null, reason: null });
const tk = (key: string, e: string, live = false) => ({ key, title: `Paso ${key}`, status: e === "despues" ? "Backlog" : "Ready", phase: 1, parent_key: null, etapa: etapa(e, live) });
const tokens = (used: number) => ({ used, cache_read: 1_200_000, cache_write: 30_000, runs: 3 });
const ini = (key: string, tickets: any[], t: any = tokens(2_410_000)) => ({ key, title: `Iniciativa ${key}`, status: "Active", done: 0, total: tickets.length, tickets, tokens: t });
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
const links = { open: (c: any) => `/x/${c.key}`, hecha: (k: string) => `/h/${k}`, idea: (k: string) => `/i/${k}`, hecho: "/hecho" };

test("I3-3 #2: one token figure per initiative", () => {
  assert.equal(fila.tokensLabel(0), "0 tokens");
  assert.equal(fila.tokensLabel(950), "950 tokens");
  assert.equal(fila.tokensLabel(96_000), "96 k tokens");
  assert.equal(fila.tokensLabel(2_410_000), "2.4 M tokens");
  assert.equal(fila.tokensLabel(1_500), "1.5 k tokens");
  assert.equal(fila.tokensLabel(999_700), "1 M tokens", "never «1000 k»");
  assert.equal(fila.tokensLabel(14_200_000), "14 M tokens");
  assert.equal(fila.tokensTitle({ used: 2_410_000, cache_read: 1_200_000, cache_write: 30_000, runs: 3 }), "Entrada y salida: 2,410,000 · caché leída: 1,200,000 · caché escrita: 30,000 (3 corridas)");
});

test("I3-3: an initiative carries its tokens through Cosa; violet with a dot while a step is live", () => {
  const p = project({ tablero: { initiatives: [ini("FIL-I1", [tk("FIL-1", "construyendo", true)]), ini("FIL-I2", [tk("FIL-2", "lista")], tokens(96_000))], loose: [tk("FIL-9", "lista")], loose_done: 0, done_initiatives: [] } });
  const cosas = cosasLib.cosasOf({ p, decisions: [], ficha: { ideas: [], promoted: [] } });
  const all = cosas.grupos.flatMap((g: any) => g.cosas);
  assert.equal(all.find((c: any) => c.key === "FIL-I1").tokens.used, 2_410_000);
  assert.equal(all.find((c: any) => c.key === "FIL-9").tokens, null, "a loose step shows no figure");
  const out = html(h(todo.TodoList, { p, cosas, links, companyPaused: false }));
  assert.match(out, /class="cor-tokens live"[^>]*><i aria-hidden="true"><\/i>2\.4 M tokens/);
  assert.match(out, /class="cor-tokens"[^>]*>96 k tokens/);
  assert.match(out, /title="Entrada y salida: 96,000/);
});

test("I3-3 #3: pressing a count shows only that group; Todo shows all", () => {
  const p = project({
    tablero: {
      initiatives: [ini("FIL-I1", [tk("FIL-1", "construyendo", true)]), ini("FIL-I2", [tk("FIL-2", "lista")]), ini("FIL-I3", [tk("FIL-3", "lista")]), ini("FIL-I4", [tk("FIL-4", "despues")])],
      loose: [],
      loose_done: 2,
      done_initiatives: [{ key: "FIL-I0", title: "Lo primero", done_at: "2026-11-15T10:00:00Z" }],
    },
  });
  const cosas = cosasLib.cosasOf({ p, decisions: [], ficha: { ideas: [], promoted: [] } });
  assert.equal(fila.filtrar(cosas, "todo"), cosas);
  const only = fila.filtrar(cosas, "fila");
  assert.deepEqual(only.grupos.map((g: any) => g.grupo), ["fila"]);
  assert.deepEqual(only.grupos[0].cosas.map((c: any) => c.key).sort(), ["FIL-I2", "FIL-I3"]);
  assert.equal(only.hecho.iniciativas.length + only.hecho.sueltos, 0, "Hecho is a door, not a filter");
  assert.equal(only.abiertas, 2);
  const none = fila.filtrar(cosas, "toca");
  assert.deepEqual(none.grupos.map((g: any) => [g.grupo, g.cosas.length]), [["toca", 0]], "an empty group stays, to say it is empty");
  const { cuentas, hecho } = fila.cuentasOf(cosas);
  assert.deepEqual(cuentas.map((k: any) => [k.label, k.n]), [["Todo", 4], ["Te toca", 0], ["Se mueve", 1], ["En fila", 2], ["Quieto", 1]]);
  assert.equal(hecho, 3);
  assert.equal(fila.cuentaAria(cuentas[3]), "En fila: 2");
});

test("I3-3: the counts row replaces the summary line; only non-empty groups get a header", () => {
  const p = project({ tablero: { initiatives: [ini("FIL-I2", [tk("FIL-2", "lista")])], loose: [], loose_done: 0, done_initiatives: [] } });
  const cosas = cosasLib.cosasOf({ p, decisions: [], ficha: { ideas: [], promoted: [] } });
  const out = html(h(todo.TodoList, { p, cosas, links, companyPaused: false }));
  assert.match(out, /role="group" aria-label="Filtrar la lista"/);
  assert.match(out, /aria-pressed="true" aria-label="Todo: 1"/);
  for (const g of ["toca", "mueve", "fila", "quieto"]) assert.match(out, new RegExp(`data-control="filtro-${g}"`));
  assert.match(out, /data-control="filtro-hecho"[^>]*>|href="\/hecho"[^>]*data-control="filtro-hecho"/);
  assert.deepEqual([...out.matchAll(/<section[^>]*data-grupo="(\w+)"/g)].map((m) => m[1]), ["fila"], "no header for empty groups, none for an empty Hecho");
  assert.doesNotMatch(out, /Te toca · 0/);
  assert.doesNotMatch(out, /cor-ellipsis/, "titles wrap, nothing is cut");
  assert.match(out, /class="cor-cosa-espera" title="[^"]+"/, "«qué toca» keeps its full text in a title");
});

test("I3-3: columns, thread stops and the fold", () => {
  assert.match(css, /\.cor-cosa-head, \.cor-cosa \{ display: grid; grid-template-columns: minmax\(180px, 296px\) minmax\(240px, 1fr\) minmax\(280px, 400px\)/);
  assert.match(css, /--hs: min\(46px,/);
  assert.match(css, /grid-template-columns: repeat\(6, var\(--hs\)\) 26px minmax\(0, 1fr\) var\(--hs\)/);
  assert.match(css, /@media \(max-width: 639px\) \{\n  \.cor-todo-scroll[^}]*\}\n  \.cor-cosa-head \{ display: none; \}\n  \.cor-cosa, \.cor-cosa\.you, \.cor-cosa\.liv \{ grid-template-columns: 1fr;/, "#5: one column on a phone");
  // The fold counts the counts' row and only the groups that show; a group's count opens it whole.
  const many = Array.from({ length: 8 }, (_, i) => ini(`FIL-I${i + 10}`, [tk(`FIL-${i + 10}`, "lista")]));
  const p = project({ tablero: { initiatives: many, loose: [], loose_done: 0, done_initiatives: [] } });
  const cosas = cosasLib.cosasOf({ p, decisions: [], ficha: { ideas: [], promoted: [] } });
  const fit = (hgt: number) => todo.foldOf(cosas, new Set(), hgt).fila;
  const fixed = todo.LINE_PX.head + todo.LINE_PX.cuentas + todo.LINE_PX.group;
  assert.equal(fit(fixed + 2 * todo.ROW_PX.fila), 2);
  assert.equal(fit(fixed + 2 * todo.ROW_PX.fila - 1), 1);
  assert.equal(todo.foldOf(fila.filtrar(cosas, "fila"), new Set(["fila"]), 100).fila, 8);
});
