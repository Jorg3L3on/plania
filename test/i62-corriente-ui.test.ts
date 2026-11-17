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

// ---- PLA-I62-2: the stream
const stream = await load("lib/corriente-stream.ts");
const streamUi = await load("components/corriente/stream.tsx");
const member = (agent: string, role: string, state = "idle", now: { ticket: string | null; title?: string } | null = null) => ({ agent, role, template: role, state, now: now ? { ...now, since: "2026-11-17T20:00:00Z" } : null, last: null, produced: null, waiting: null });
const etapa = (e: string) => ({ etapa: e, qa: null, holder: null, live: false, since: null, ci: null, reason: null });
const tk = (key: string, e: string) => ({ key, title: `Paso ${key}`, status: "x", phase: 1, parent_key: "FIL-I1", etapa: etapa(e) });
const project = (slug: string, over: Record<string, unknown> = {}) => ({
  slug,
  title: slug[0]!.toUpperCase() + slug.slice(1),
  paused: false,
  light: "ok",
  goal: null,
  usage: { used: 0 },
  team: [],
  thread: { id: "t", unread: 0, last: null },
  plan: null,
  this_week: { done: 0, docs: 0, prs: 0, last_at: null },
  next: { title: "x", key: `${slug.slice(0, 3).toUpperCase()}-42`, owner: "taller", due: null },
  work: { open: 5, in_progress: 1 },
  ...over,
});
const decision = (id: string, projectSlug: string, kind: string, ref: string | null = null) => ({ id, project: projectSlug, title: `Decisión ${id}`, kind, options: null, actions: kind === "release" ? [] : ["aceptar", "cambios"], state: null, at: "2026-11-17T20:00:00Z", ref, detail: null });
const summary = (slug: string, tasks: Record<string, unknown>[]) => ({ slug, title: slug, tasks });
const idea = (key: string, stage: string, over: Record<string, unknown> = {}) => ({ key, kind: "idea", title: key, status: "Open", stage, promoted_to: null, ...over });
const ticket = (key: string, status: string) => ({ key, kind: "ticket", title: key, status });

test("I62-2: ideas by stage, pasos by their board stage, agents on what they work on, te toca where it is about", () => {
  const p = project("filmia", {
    team: [member("taller-filmia", "taller", "running", { ticket: "FIL-42", title: "Pruebas de subida" }), member("po-filmia", "product-owner")],
    tablero: { initiatives: [{ key: "FIL-I1", title: "x", status: "Active", done: 1, total: 5, tickets: [tk("FIL-40", "lista"), tk("FIL-41", "en_espera"), tk("FIL-42", "construyendo"), tk("FIL-35", "te_toca"), tk("FIL-30", "integrado"), tk("FIL-20", "hecho"), tk("FIL-21", "despues")] }], loose: [], loose_done: 0 },
  });
  const s = summary("filmia", [idea("FIL-IDEA1", "idea"), idea("FIL-IDEA2", "research"), idea("FIL-IDEA3", "design"), idea("FIL-IDEA4", "planning"), idea("FIL-IDEA5", "idea", { promoted_to: "FIL-I1" }), idea("FIL-IDEA6", "idea", { status: "Done" })]);
  const l = stream.laneOf(p, s, [decision("d1", "filmia", "deliverable", "FIL-35"), decision("d2", "filmia", "question", "FIL-IDEA2"), decision("d3", "micasa", "deliverable", "MIC-3")]);
  assert.deepEqual(stream.COLUMNS.map((c: string) => l.cells[c].length), [1, 1, 1, 1, 2, 1, 2]);
  assert.equal(l.cells.lista.find((w: { key: string }) => w.key === "FIL-41").grey, true, "a paso waiting on a teammate is grey");
  assert.equal(l.cells.revision.find((w: { key: string }) => w.key === "FIL-30").grey, true, "waiting for publication is grey");
  assert.deepEqual(l.agents, [{ agent: "taller-filmia", seat: "Taller", key: "FIL-42", doing: "Pruebas de subida", col: "construccion" }]);
  assert.deepEqual(l.you.map((y: { col: string; verb: string }) => [y.col, y.verb]), [["revision", "Aceptar FIL-35"], ["investigacion", "Responder"]]);
  assert.equal(l.pace, "live");
  assert.equal(l.next, "FIL-42");
});

test("I62-2: with no board the status places the pasos; a paused project is off with no agents; why nobody works", () => {
  const s = summary("micasa", [ticket("MIC-1", "Ready"), ticket("MIC-2", "In progress"), ticket("MIC-3", "In review"), ticket("MIC-4", "Done"), ticket("MIC-5", "Backlog")]);
  const l = stream.laneOf(project("micasa"), s, []);
  assert.deepEqual(["lista", "construccion", "revision"].map((c) => l.cells[c].length), [1, 1, 1]);
  const off = stream.laneOf(project("zigzag", { paused: true, team: [member("t", "taller", "running", { ticket: null })] }), s, []);
  assert.equal(off.paused, true);
  assert.equal(off.pace, "off");
  assert.equal(off.agents.length, 0);
  const quiet = stream.laneOf(project("workia", { light: "quiet", light_reason: { text: "Nadie tiene un paso listo.", action: { label: "Arma el plan", href: "#plan" } } }), s, []);
  assert.equal(quiet.pace, "still");
  assert.equal(quiet.idle.text, "Nadie tiene un paso listo.");
  // The company stopped: nobody is drawn working.
  assert.equal(stream.laneOf(project("filmia", { team: [member("t", "taller", "running", { ticket: null })] }), s, [], true).agents.length, 0);
});

test("I62-2: the headline counts the agents and what waits; the three totals come from the per-project counts", () => {
  const lanes = [{ agents: [1, 2] }, { agents: [3] }] as never[];
  assert.deepEqual(stream.headlineOf(lanes, [decision("a", "f", "deliverable"), decision("b", "m", "pr")], false), { now: "Tres agentes trabajando.", you: "Dos entregas te esperan." });
  assert.deepEqual(stream.headlineOf([], [decision("a", "f", "question")], false), { now: "Nadie trabaja ahora.", you: "Una cosa te espera." });
  assert.equal(stream.headlineOf(lanes, [], true).now, "La compañía está detenida.");
  assert.equal(stream.headlineOf(lanes, [], false).you, null);
  const t = stream.totalsOf([project("a"), project("b")], [summary("a", [ticket("A-1", "In review"), ticket("A-2", "Done"), ticket("A-3", "Released"), idea("A-IDEA1", "idea")]), summary("b", [ticket("B-1", "Merged"), ticket("B-2", "In review")])]);
  assert.deepEqual(t, { revision: 2, open: 10, done: 3 });
  // Lanes stay by name; paused last.
  const order = stream.lanesOf([project("zigzag", { paused: true }), project("workia"), project("filmia")], [], []).map((l: { slug: string }) => l.slug);
  assert.deepEqual(order, ["filmia", "workia", "zigzag"]);
});

test("I62-2: the stream draws lanes, agents, rhombi, counts, the paused lane's Reanudar and the reason with its action", () => {
  const p = project("filmia", { team: [member("taller-filmia", "taller", "running", { ticket: "FIL-42", title: "Pruebas" })], tablero: { initiatives: [{ key: "FIL-I1", title: "x", status: "Active", done: 0, total: 9, tickets: [tk("FIL-42", "construyendo"), tk("FIL-35", "te_toca"), tk("L1", "lista"), tk("L2", "lista"), tk("L3", "lista"), tk("L4", "lista"), tk("L5", "lista")] }], loose: [], loose_done: 0 } });
  const lanes = [stream.laneOf(p, summary("filmia", []), [decision("d1", "filmia", "deliverable", "FIL-35")]), stream.laneOf(project("zigzag", { paused: true }), undefined, []), stream.laneOf(project("workia", { light: "quiet", light_reason: { text: "Sin paso listo.", action: { label: "Arma el plan", href: "/ceo?piso=workia" } } }), undefined, [])];
  const links = { project: (s: string) => `/p/${s}`, agent: (s: string, a: string) => `/a/${s}/${a}`, you: (s: string, d: { id: string }) => `/y/${s}/${d.id}`, reason: (_s: string, h: string) => h };
  const out = html(h(streamUi.Stream, { headline: { now: "Un agente trabajando.", you: "Una entrega te espera." }, totals: { revision: 20, open: 119, done: 1140 }, lanes, links, onResume: () => {}, resuming: null, pedir: null }));
  assert.match(out, /Un agente trabajando\.<br\/><span class="cor-amber">Una entrega te espera\.<\/span>/);
  assert.match(out, /1,140/);
  assert.match(out, /href="\/a\/filmia\/taller-filmia"[^>]*><span aria-hidden="true" class="cor-agent"><\/span><span class="cor-tag"><b>Taller<\/b><span>FIL-42 · Pruebas<\/span>/);
  assert.match(out, /href="\/y\/filmia\/d1"[^>]*><span aria-hidden="true" class="cor-you"><\/span><span class="cor-tag amber"><b>Aceptar FIL-35<\/b><span>1 en revisión<\/span>/);
  assert.match(out, /aria-label="5 en Lista"/, "many dots become a count");
  assert.match(out, /data-resume="zigzag"[\s\S]*?Reanudar/);
  assert.match(out, /data-idle="workia"[\s\S]*?Sin paso listo\.[\s\S]*?href="\/ceo\?piso=workia"[^>]*>[\s\S]*?Arma el plan/);
  for (const c of ["IDEA", "INVESTIGACIÓN", "DISEÑO", "PLAN", "LISTA", "CONSTRUCCIÓN", "REVISIÓN"]) assert.ok(out.toUpperCase().includes(c), c);
  assert.ok(!/Plania/.test(out));
});
