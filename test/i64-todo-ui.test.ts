// PLA-I64-2: the list screen, server-rendered (the clicks, measures and axe run in the browser pass on the demo DB).
import assert from "node:assert/strict";
import { test } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

(globalThis as { React?: unknown }).React = React;
const load = async (p: string) => (await import(new URL(`../ui/src/${p}`, import.meta.url).href)) as Record<string, any>;
const lib = await load("lib/corriente.ts");
const cosasLib = await load("lib/cosas.ts");
const todo = await load("components/corriente/todo.tsx");
const h = React.createElement;
const html = (el: React.ReactElement) => renderToStaticMarkup(h(QueryClientProvider, { client: new QueryClient() }, h(MemoryRouter, { initialEntries: ["/ceo"] }, el)));

const etapa = (e: string, reason: string | null = null) => ({ etapa: e, qa: null, holder: null, live: false, since: "2026-11-17T10:00:00Z", ci: null, reason });
const tk = (key: string, e: string, reason: string | null = null) => ({ key, title: `Paso ${key}`, status: e === "despues" ? "Backlog" : "Ready", phase: 1, parent_key: null, etapa: etapa(e, reason) });
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
const links = { open: (c: any) => `/x/${c.key}`, hecha: (k: string) => `/h/${k}`, hecho: "/hecho" };

test("I64-2: the preview address is a tab of its own; the old tabs are untouched", () => {
  assert.deepEqual(lib.atOf("?proyecto=filmia&t=todo"), { view: "corriente", slug: "filmia", tab: "todo", ver: null });
  assert.equal(lib.searchOf({ slug: "filmia", tab: "todo", ver: { kind: "idea", key: "FIL-IDEA1" } }), "?proyecto=filmia&t=todo&ver=idea%3AFIL-IDEA1");
  assert.ok(!lib.WORK_TABS.includes("todo"), "not in the bar until PLA-I64-7");
  assert.equal(lib.atOf("?proyecto=filmia").tab, "ahora");
});

test("I64-2: groups in order, an empty group is one line, a long group folds and says how many more", () => {
  const many = Array.from({ length: 12 }, (_, i) => ini(`FIL-I${i + 10}`, [tk(`FIL-${i + 10}`, "lista")]));
  const p = project({ tablero: { initiatives: [ini("FIL-I1", [tk("FIL-1", "te_toca", "Entregada: espera que la aceptes.")]), ...many, ini("FIL-I2", [tk("FIL-2", "despues", "Está en Backlog: nadie la pasó a Lista.")])], loose: [], loose_done: 3, done_initiatives: [{ key: "FIL-I0", title: "Lo primero", done_at: "2026-11-15T10:00:00Z" }] } });
  const cosas = cosasLib.cosasOf({ p, decisions: [], ficha: { ideas: [], promoted: [{ idea: "FIL-IDEA0", initiative: "FIL-I0" }] } });
  const out = html(h(todo.TodoList, { p, cosas, links, companyPaused: false, timeZone: "America/Mexico_City" }));
  const order = [...out.matchAll(/data-grupo="(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(order)], ["toca", "fila", "quieto", "hecho"]);
  assert.match(out, /data-grupo-vacio="mueve"/, "Se mueve · 0 shares the next line");
  assert.match(out, /Se mueve · 0/);
  assert.match(out, /Ver las otras \d+/);
  assert.match(out, /Pedido tuyo|Iniciativa/);
  assert.match(out, /Verla</, "a group folded whole with one row");
  assert.match(out, /Ver todo lo hecho/);
  assert.match(out, /href="\/x\/FIL-I1"/);
  // The fold spends the room it has: more room, more rows; never fewer than one Te toca row.
  const small = todo.foldOf(cosas, new Set(), 100);
  const big = todo.foldOf(cosas, new Set(), 2000);
  assert.equal(small.toca, 1);
  assert.ok(big.fila > small.fila);
  assert.equal(big.fila, 3, "three per group until opened");
  assert.equal(todo.foldOf(cosas, new Set(["fila"]), 100).fila, 12);
});

test("I64-2: the small thread draws the nine stops, the valve and one segment per step", () => {
  const head = html(h(todo.TodoList, { p: project(), cosas: cosasLib.cosasOf({ p: project(), decisions: [], ficha: { ideas: [], promoted: [] } }), links, companyPaused: false }));
  for (const name of ["Buzón", "Entendido", "Investigación", "Diseño", "Plan", "Lista", "Construcción", "Publicado"]) assert.ok(head.includes(name), name);
  assert.match(head, /Nada te espera\. Nadie trabaja ahora\. Nada espera turno\. Nada está quieto\./);
});
