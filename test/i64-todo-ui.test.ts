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

test("I64-2/7: the list is the project's entry; t=todo still opens it", () => {
  assert.deepEqual(lib.atOf("?proyecto=filmia&t=todo"), { view: "corriente", slug: "filmia", tab: "todo", ver: null });
  assert.deepEqual(lib.atOf("?proyecto=filmia"), { view: "corriente", slug: "filmia", tab: "todo", ver: null });
  assert.equal(lib.searchOf({ slug: "filmia", tab: "todo", ver: { kind: "idea", key: "FIL-IDEA1" } }), "?proyecto=filmia&ver=idea%3AFIL-IDEA1");
  // PLA-I66-2: Marca joins the doors, before Ajustes.
  // PLA-I68-2: Camino, before Ajustes. PLA-135: Archivo is gone.
  assert.deepEqual([...lib.TABS], ["todo", "hecho", "equipo", "motores", "maquinas", "marca", "camino", "ajustes"]);
  assert.deepEqual([...lib.DOORS], ["equipo", "maquinas", "marca", "camino", "ajustes"]);
});

test("I64-7 #2: every old address lands on its new place", () => {
  const to = (q: string) => {
    const a = lib.atOf(q);
    return lib.searchOf(a);
  };
  const cases: [string, string][] = [
    ["?proyecto=f&t=ahora", "?proyecto=f"],
    ["?proyecto=f&t=pedidos", "?proyecto=f"],
    ["?proyecto=f&t=tablero", "?proyecto=f"],
    ["?proyecto=f&t=ideas", "?proyecto=f"],
    // PLA-135: Archivo is gone: its address and Diseño's land on the list, the old Docs tab on Ajustes (the
    // project's docs), and a doc opens over the list.
    ["?proyecto=f&t=diseno", "?proyecto=f"],
    ["?proyecto=f&t=archivo", "?proyecto=f"],
    ["?proyecto=f&t=archivo&ver=doc:abc", "?proyecto=f&ver=doc%3Aabc"],
    ["?proyecto=f&t=ajustes&ver=doc:abc", "?proyecto=f&t=ajustes&ver=doc%3Aabc"],
    // PLA-I68-2: PRs live in Camino's Propuestas.
    ["?proyecto=f&t=prs", "?proyecto=f&t=camino"],
    ["?proyecto=f&t=docs", "?proyecto=f&t=ajustes"],
    ["?proyecto=f&t=motores", "?proyecto=f&t=motores"],
    ["?proyecto=f&t=equipo", "?proyecto=f&t=equipo"],
    ["?proyecto=f&t=maquinas", "?proyecto=f&t=maquinas"],
    ["?proyecto=f&t=ahora&ver=entrega:d1", "?proyecto=f&ver=entrega%3Ad1"],
    ["?proyecto=f&t=pedidos&ver=pedido:F-IDEA2", "?proyecto=f&ver=idea%3AF-IDEA2"],
    ["?proyecto=f&t=pedidos&ver=guardadas", "?proyecto=f"],
    ["?proyecto=f&t=tablero&ver=paso:F-3", "?proyecto=f&ver=paso%3AF-3"],
    ["?proyecto=f&t=tablero&ver=iniciativa:F-I1", "?proyecto=f&ver=iniciativa%3AF-I1"],
    ["?proyecto=f&t=tablero&ver=sueltos", "?proyecto=f"],
    ["?proyecto=f&t=ideas&ver=idea:F-IDEA1", "?proyecto=f&ver=idea%3AF-IDEA1"],
    ["?proyecto=f&t=diseno&ver=lienzo:F-IDEA1", "?proyecto=f&ver=idea%3AF-IDEA1"],
    ["?proyecto=f&t=prs&ver=pr:12", "?proyecto=f&t=camino&ver=pr%3A12"],
    ["?proyecto=f&t=docs&ver=doc:abc", "?proyecto=f&ver=doc%3Aabc"],
    ["?proyecto=f&t=tablero&ver=pr:12", "?proyecto=f&t=camino&ver=pr%3A12"],
    ["?proyecto=f&t=equipo&ver=miembro:taller-f", "?proyecto=f&t=equipo&ver=miembro%3Ataller-f"],
    ["?proyecto=f&ver=maq:base", "?proyecto=f&t=maquinas&ver=maq%3Abase"],
  ];
  for (const [from, want] of cases) assert.equal(to(from), want, from);
});

test("I64-2: groups in order, an empty group is one line, a long group folds and says how many more", () => {
  const many = Array.from({ length: 12 }, (_, i) => ini(`FIL-I${i + 10}`, [tk(`FIL-${i + 10}`, "lista")]));
  const p = project({ tablero: { initiatives: [ini("FIL-I1", [tk("FIL-1", "te_toca", "Entregada: espera que la aceptes.")]), ...many, ini("FIL-I2", [tk("FIL-2", "despues", "Está en Backlog: nadie la pasó a Lista.")])], loose: [], loose_done: 3, done_initiatives: [{ key: "FIL-I0", title: "Lo primero", done_at: "2026-11-15T10:00:00Z" }] } });
  const cosas = cosasLib.cosasOf({ p, decisions: [], ficha: { ideas: [], promoted: [{ idea: "FIL-IDEA0", initiative: "FIL-I0" }] } });
  const out = html(h(todo.TodoList, { p, cosas, links, companyPaused: false, timeZone: "America/Mexico_City" }));
  const order = [...out.matchAll(/data-grupo="(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(order)], ["toca", "fila", "quieto", "hecho"]);
  // PLA-I3-3: an empty group has no line of its own; its count says 0.
  assert.doesNotMatch(out, /Se mueve · 0/);
  assert.match(out, /aria-label="Se mueve: 0"/);
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

test("I64-2/5: the header names the stops; empty groups share a line; an empty project shows the ghost row", () => {
  const done = project({ tablero: { initiatives: [], loose: [], loose_done: 2, done_initiatives: [] } });
  const head = html(h(todo.TodoList, { p: done, cosas: cosasLib.cosasOf({ p: done, decisions: [], ficha: { ideas: [], promoted: [] } }), links, companyPaused: false }));
  for (const name of ["Buzón", "Entendido", "Investigación", "Diseño", "Plan", "Lista", "Construcción", "Publicado"]) assert.ok(head.includes(name), name);
  // PLA-I3-3: no line for empty groups; the counts say 0 and Hecho counts the done steps.
  assert.doesNotMatch(head, /Nada te espera/);
  assert.match(head, /aria-label="Hecho: 2\. Ver todo lo hecho"/);
  const empty = project();
  const plan = h("button", { "data-control": "planear" }, "Arma el plan");
  const out = html(h(todo.TodoList, { p: empty, cosas: cosasLib.cosasOf({ p: empty, decisions: [], ficha: { ideas: [], promoted: [] } }), links, companyPaused: false, plan }));
  assert.match(out, /data-fantasma/);
  assert.match(out, /aria-label="Todo: 0".*aria-label="Te toca: 0".*aria-label="Se mueve: 0".*aria-label="En fila: 0".*aria-label="Quieto: 0".*aria-label="Hecho: 0/);
  assert.match(out, /Arma el plan/);
});

test("I64-4: each lever keeps its busy state and refusal under today's call key", async () => {
  const palanca = await load("components/corriente/palanca.tsx");
  assert.equal(palanca.busyKey("mianovia", { kind: "despertar", key: "MIA-IDEA2" }), "pedido-MIA-IDEA2:despertar");
  assert.equal(palanca.busyKey("mianovia", { kind: "construir", key: "MIA-IDEA3" }), "pedido-MIA-IDEA3:construir");
  assert.equal(palanca.busyKey("mianovia", { kind: "detener", run: "r1" }), "stop-r1");
  assert.equal(palanca.busyKey("mianovia", { kind: "primero", key: "MIA-1", aplazar: { key: "MIA-1", to: "Backlog" } }), "next-MIA-1");
  assert.equal(palanca.busyKey("mianovia", { kind: "lista", key: "MIA-3" }), "lista-MIA-3");
  assert.equal(palanca.busyKey("mianovia", { kind: "reenviar", key: "MIA-9" }), "mianovia:request");
  assert.equal(palanca.busyKey("mianovia", { kind: "cerrar", key: "MIA-I2", version: 3 }), "cerrar-MIA-I2");
});

test("PLA-62 #1 #3: the ficha calls a valve with no live run stuck; the levers a ficha lacks are carried over", async () => {
  const ficha = await load("components/corriente/ficha.tsx");
  const palanca = await load("components/corriente/palanca.tsx");
  const d = { key: "MIA-IDEA2", state: "valvula", trail: [{ at: "2026-11-17T08:53:00Z", who: "owner", kind: "construir" }, { at: "2026-11-17T14:05:00Z", who: "po", kind: "doc" }] };
  assert.equal(ficha.stuckOf({ paused: false, team: [] }, d), true);
  assert.equal(ficha.stuckOf({ paused: false, team: [{ state: "running", now: { ticket: "MIA-IDEA2" } }] }, d), false, "a live run on it: still passing");
  assert.equal(ficha.stuckOf({ paused: true, team: [{ state: "running", now: { ticket: "MIA-IDEA2" } }] }, d), true, "paused: nothing moves it");
  assert.equal(ficha.stuckOf({ paused: false, team: [] }, { ...d, state: "quieta" }), false);
  assert.equal(ficha.orderedAt(d), "2026-11-17T08:53:00Z");
  assert.deepEqual([...palanca.CARRIED].sort(), ["detener", "lista", "primero", "reenviar"]);
});
