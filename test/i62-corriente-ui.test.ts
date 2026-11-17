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

// ---- PLA-I62-3: the project view
const strip = await load("components/corriente/strip.tsx");
const ahora = await load("components/corriente/ahora.tsx");
const page = await load("pages/corriente.tsx");
const fakeActs = () => {
  const calls: unknown[][] = [];
  const rec = (name: string) => (...a: unknown[]) => void calls.push([name, ...a]);
  return {
    calls,
    acts: { refresh: () => {}, decisions: { decide: rec("decide"), withActed: (d: unknown[]) => d, busy: null, errors: {}, prefill: {}, setPrefill: () => {} }, busy: null, stopRun: rec("stopRun"), resumeRun: rec("resumeRun"), start: rec("start"), plan: rec("plan"), autoAccept: rec("auto"), autoInvisible: rec("autoInv"), resend: rec("resend"), closeRequest: rec("close"), cancelOrder: rec("cancel"), pickNext: rec("next"), note: rec("note"), resume: rec("resume"), pause: rec("pause") },
  };
};
const ahoraLinks = { entrega: (d: { id: string }) => `/e/${d.id}`, tetoca: () => "/tt", paso: (k: string) => `/paso/${k}`, tablero: "/tablero", equipo: "/equipo", miembro: (a: string) => `/m/${a}`, publicar: "/pub", pagina: "/p/filmia", hash: () => "/hash" };

test("I62-3: Esc steps out one level at a time; the strip marks the open project and keeps the tab", () => {
  assert.deepEqual(page.escFrom(lib.atOf("?proyecto=filmia&t=tablero&ver=paso:FIL-1")), { slug: "filmia", tab: "tablero" });
  assert.deepEqual(page.escFrom(lib.atOf("?proyecto=filmia&t=tablero")), { slug: "filmia" });
  assert.deepEqual(page.escFrom(lib.atOf("?proyecto=filmia")), { view: "corriente" });
  assert.deepEqual(page.escFrom(lib.atOf("?v=tetoca")), { view: "corriente" });
  const lanes = [stream.laneOf(project("filmia", { team: [member("t", "taller", "running", { ticket: null })] }), undefined, [decision("d", "filmia", "deliverable")]), stream.laneOf(project("micasa"), undefined, [])];
  const out = html(h(strip.Strip, { lanes, open: "filmia", href: (s: string) => `/c?proyecto=${s}&t=tablero`, back: "/c", pedirTo: "/pedir" }));
  assert.match(out, /aria-current="page"[^>]*href="\/c\?proyecto=filmia&amp;t=tablero"|href="\/c\?proyecto=filmia&amp;t=tablero"[^>]*aria-current="page"/);
  assert.match(out, /class="t yo"/);
  assert.match(out, /class="t ag"/);
  assert.match(out, /class="cor-btn secondary"[^>]*>Pedir</);
  const bar = html(h(strip.ProjectBar, { slug: "filmia", title: "Filmia", tab: "ahora", href: (t: string) => `/t/${t}`, counts: { ahora: { n: 1, amber: true } } }));
  for (const t of ["Ahora", "Pedidos", "Tablero", "Ideas", "Diseño", "PRs", "Docs", "Equipo", "Motores", "Máquinas"]) assert.ok(bar.includes(`>${t}<`) || bar.includes(`>${t}<span`), t);
  assert.match(bar, /aria-current="page"[^>]*>Ahora<span class="cor-count amber">1</);
});

test("I62-3: Ahora with a delivery: the move's one white button (Aceptar), Ver antes y después, Pedir ajuste; Detener; Meta; Equipo", () => {
  const d = { ...decision("d1", "filmia", "deliverable", "FIL-35"), title: "Reproductor", asker: { agent: "taller-filmia", role: "taller" } };
  const p = project("filmia", {
    next_move: { verbo: "aceptar", texto: "Acepta el reproductor.", accion: { kind: "decision", id: "d1", action: "aceptar", label: "Aprobar y cerrar" }, origen: { kind: "decision", id: "d1", decision: "deliverable" } },
    team: [member("taller-filmia", "taller", "running", { ticket: "FIL-42", title: "Pruebas" }), member("po-filmia", "product-owner")],
    rumbo: { goal_id: "g", goal: "Publicar en un día", why: "", target_on: "2026-12-17", forecast_on: "2026-12-17", weeks_behind: 0, missing: false },
    tablero: { initiatives: [{ key: "FIL-I1", title: "x", status: "Active", done: 0, total: 3, tickets: [tk("FIL-30", "integrado"), tk("FIL-31", "en_revision"), tk("FIL-32", "en_revision"), tk("FIL-33", "en_revision")] }], loose: [], loose_done: 0 },
  });
  (p.team[0] as { now: { run_id?: string } }).now.run_id = "run-1";
  const { acts } = fakeActs();
  const out = html(h(ahora.Ahora, { p, decisions: [d], now: Date.parse("2026-11-17T20:12:00Z"), companyPaused: false, totals: { open: 45, done: 321 }, acts, links: ahoraLinks, onFijar: () => {} }));
  assert.match(out, /Te toca · Taller te entrega/);
  assert.match(out, /FIL-35 · Reproductor/);
  assert.equal((out.match(/cor-btn primary/g) ?? []).length, 1, "one white button");
  assert.match(out, /class="cor-btn primary"[^>]*>Aceptar</);
  assert.match(out, /href="\/e\/d1"[^>]*>Ver antes y después/);
  assert.match(out, />Pedir ajuste</);
  assert.match(out, /data-running="taller-filmia"[\s\S]*?12 MIN[\s\S]*?Detener/);
  assert.match(out, /En revisión · 4 · no necesitan nada de ti/);
  assert.match(out, /Espera publicación/);
  assert.match(out, /Ver la otra en el tablero/);
  assert.match(out, /Cambiar meta/);
  assert.match(out, /Publicar en un día/);
  assert.match(out, /45 ABIERTOS · 321 HECHOS/);
  assert.match(out, /href="\/p\/filmia"/);
  assert.match(out, />Taller<\/span><span class="cor-state live">Trabajando</);
  assert.match(out, />PO<\/span><span class="cor-state">Libre</);
  assert.ok(!/Plania/.test(out));
});

test("I62-3: Ahora with nothing waiting: the state, the reason and the nudge (start past the guard, Arma el plan); Sin meta offers Fijar", () => {
  const p = project("workia", {
    light: "quiet",
    light_reason: { text: "Nadie tiene trabajo listo.", action: null },
    team: [{ ...member("taller-workia", "taller"), next_start: { key: "W-1", title: "Alta", hold: "usage", starts_at: null, text: "El uso está al 92 %." } }],
    rumbo: { goal_id: null, goal: null, why: "", target_on: null, forecast_on: null, weeks_behind: null, missing: true },
  });
  const { acts } = fakeActs();
  const out = html(h(ahora.Ahora, { p, decisions: [], now: Date.now(), companyPaused: false, totals: null, acts, links: ahoraLinks, onFijar: () => {} }));
  assert.match(out, /data-state-card="stuck"/);
  assert.match(out, /Seguir de todos modos/);
  assert.match(out, /Nadie tiene trabajo listo\./);
  assert.match(out, />Arma el plan</);
  assert.match(out, />Fijar meta</);
  assert.match(out, /Sin meta todavía\./);
  assert.ok(!/cor-btn primary/.test(out), "nothing waits on him: no white button");
});

// ---- PLA-I62-4: Te toca, every pending kind, Entrega
const pend = await load("components/corriente/pendiente.tsx");
const toca = await load("components/corriente/tetoca.tsx");
const pendLinks = { entrega: (d: { id: string }) => `/e/${d.id}`, publicar: () => "/pub", project: (s: string) => `/p/${s}` };
const card = (d: Record<string, unknown>, p: unknown = project("filmia")) => {
  const { acts, calls } = fakeActs();
  return { out: html(h(pend.Pendiente, { d, p, acts, links: pendLinks, big: true })), calls };
};

test("I62-4: Te toca's headline, the absent kinds, and each card's word", () => {
  assert.equal(toca.tocaHeadline([]), "Nada te espera.");
  assert.equal(toca.tocaHeadline([decision("a", "f", "deliverable"), decision("b", "f", "pr")]), "Dos entregas esperan tu decisión.");
  assert.equal(toca.tocaHeadline([decision("a", "f", "question")]), "Una cosa espera tu decisión.");
  assert.equal(toca.absentLine([decision("a", "f", "deliverable")]), "Sin preguntas, planes por aprobar ni pasos tuyos pendientes.");
  assert.equal(toca.absentLine([decision("a", "f", "question"), decision("b", "f", "plan")]), "Sin pasos tuyos pendientes.");
  assert.equal(toca.absentLine([]), null);
  assert.equal(pend.kindWord({ ...decision("a", "f", "deliverable"), asker: { role: "taller" } }), "Entrega · Taller");
  assert.equal(pend.kindWord({ ...decision("a", "f", "step"), actions: ["aplicar"], file_step: { path: "x" } }), "Paso tuyo · archivo");
  assert.equal(pend.kindWord({ ...decision("a", "f", "deliverable"), actions: ["verificar"], hold: "fallan" }), "Algo falló");
});

test("I62-4: every kind draws /ceo's actions with one white button", () => {
  const one = (out: string) => assert.equal((out.match(/cor-btn primary/g) ?? []).length, 1, out.slice(0, 200));
  const del = card({ ...decision("d", "filmia", "deliverable", "FIL-35"), auto: 1 });
  one(del.out);
  assert.match(del.out, /data-action="aceptar"[^>]*>Aceptar</);
  assert.match(del.out, /href="\/e\/d"[^>]*>Ver antes y después/);
  assert.match(del.out, /Pedir ajuste/);
  assert.match(del.out, /Aprobar sola si las pruebas pasan · apagado/);
  assert.match(del.out, /Solo lo que no se ve · apagado/);
  const held = card({ ...decision("d", "filmia", "deliverable"), hold: "Falta 1 check." });
  assert.match(held.out, /data-action="aceptar"[^>]*disabled=""|disabled=""[^>]*data-action="aceptar"/);
  assert.match(held.out, /data-hold="true">Falta 1 check\./);
  const auto = card(decision("d", "filmia", "deliverable"), project("filmia", { auto_accept: { on: true, hold: "QA no pasó", invisible: false } }));
  assert.match(auto.out, /No se aprobó sola: QA no pasó/);
  const plan = card({ ...decision("p", "mianovia", "plan"), actions: ["empezar", "cambiar", "despues"], plan: { understood: "x", steps: [{ title: "Tablas", done_when: "y" }], cost: null, leg: { key: "MIA-I2", title: "R" }, questions: [{ text: "¿Teléfono?", options: ["Sí", "No"], suggested: 0 }], checklist: ["Abre rápido"] } });
  one(plan.out);
  assert.match(plan.out, />Empezar</);
  assert.match(plan.out, />Cambiar algo</);
  assert.match(plan.out, />Después</);
  assert.match(plan.out, /aria-checked="true"[^>]*>Sí<small>sugerida/);
  assert.match(plan.out, /value="Abre rápido"/);
  const q = card({ ...decision("q", "micasa", "question"), actions: ["elegir", "responder"], options: [{ n: 1, label: "Un día antes", recommended: true }, { n: 2, label: "El mismo día", recommended: false }] });
  one(q.out);
  assert.match(q.out, /aria-checked="true"[^>]*>Un día antes/);
  assert.match(q.out, />Responder</);
  assert.match(q.out, />Cambiar algo</);
  const step = card({ ...decision("s", "workia", "step"), actions: ["hecho", "aplazar"] });
  one(step.out);
  assert.match(step.out, />Hecho</);
  assert.match(step.out, />Aplazar</);
  const file = card({ ...decision("f", "plania", "step"), actions: ["aplicar", "hecho"], file_step: { path: ".env.example", lines: "A=1", pr_url: "https://github.com/x/y/pull/12", source: "agent" } });
  one(file.out);
  assert.match(file.out, />Agregar al PR #12 y marcar hecho</);
  assert.match(file.out, />Ya lo hice yo</);
  const fail = card({ ...decision("x", "plania", "deliverable"), actions: ["cambios", "verificar"], hold: "Las pruebas fallan.", asker: { agent: "t", role: "taller" } });
  one(fail.out);
  assert.match(fail.out, /No pasó la prueba\./);
  assert.match(fail.out, /class="cor-btn primary"[^>]*>Que Taller vuelva a probar</);
  const rel = card({ ...decision("r", "plania", "release"), release: { from: "sandbox", into: "main", env: "prod", ahead: 3, tickets: [], open_checks: 0, before: 0 } });
  one(rel.out);
  assert.match(rel.out, /href="\/pub"[^>]*>Publicar</);
  const doneCard = card({ ...decision("d", "filmia", "deliverable"), state: { action: "aceptar", at: "x", result: {} } });
  assert.match(doneCard.out, /class="cor-state ok"/);
  assert.ok(!/cor-btn primary/.test(doneCard.out), "an answered card has no button");
});

// ---- PLA-I62-5: Pedir, Pedidos, Asistente
const pedidos = await load("components/corriente/pedidos.tsx");
const images = await load("components/corriente/images.tsx");

test("I62-5: a request's line, who it waits on, and the tab's headline", () => {
  const x = (stop: string, state: string, over: Record<string, unknown> = {}) => ({ key: "K", title: "t", stop, state, who: "product-owner", guardada: false, at: new Date(Date.now() - 26 * 3_600_000).toISOString(), ...over });
  assert.deepEqual(pedidos.pedidoState(x("lista", "quieta"), Date.now()), { text: "Te espera · lista para construir", tone: "amber" });
  assert.deepEqual(pedidos.pedidoState(x("entendido", "espera"), Date.now()), { text: "Te espera · confirma lo entendido", tone: "amber" });
  assert.deepEqual(pedidos.pedidoState(x("investigacion", "trabajando", { who: "research" }), Date.now()), { text: "Research la trabaja", tone: "live" });
  assert.equal(pedidos.pedidoState(x("buzon", "cola"), Date.now()).text, "En el buzón · 26 h sin tomar");
  assert.equal(pedidos.waitsOnYou(x("lista", "quieta", { guardada: true })), false);
  assert.deepEqual(pedidos.pedidosHeadline([x("lista", "quieta"), x("entendido", "espera"), x("buzon", "cola"), x("plan", "quieta", { guardada: true })]), { now: "Tres pedidos tomando forma.", you: "Dos te esperan." });
  assert.deepEqual(pedidos.pedidosHeadline([]), { now: "Ningún pedido tomando forma.", you: null });
});

test("I62-5: pictures: type, size and the limit of six, said once", () => {
  const f = (type: string, size = 10) => ({ type, size, name: "x" }) as unknown as File;
  const png = f("image/png");
  assert.deepEqual(images.pickImages([png, f("image/gif")], [], 6), { files: [png], error: "Solo se aceptan imágenes PNG, JPEG o WebP." });
  assert.equal(images.pickImages([f("image/png", 6 * 1024 * 1024)], [], 6).error, "Esa imagen pesa más de 5 MB.");
  const six = Array.from({ length: 6 }, () => f("image/png"));
  assert.match(images.pickImages([f("image/webp")], six, 6).error, /hasta 6 imágenes/);
  assert.equal(stream.projectOfKey("MIA-IDEA9", [summary("mianovia", [ticket("MIA-1", "Done")]), summary("filmia", [ticket("FIL-1", "Done")])]), "mianovia");
  assert.equal(stream.projectOfKey("ZZZ-1", []), null);
});

// ---- PLA-I62-6: Tablero, Paso, Equipo
const tablero = await load("components/corriente/tablero.tsx");
const equipo = await load("components/corriente/equipo.tsx");

test("I62-6: the board: stations, inline Detener and Hacer primero, the chosen card's bar, Cerrar iniciativa", () => {
  const { acts } = fakeActs();
  const tkL = (k: string, e: string, live = false) => ({ ...tk(k, e), etapa: { ...etapa(e), live } });
  const p = project("filmia", {
    team: [{ ...member("taller-filmia", "taller", "running", { ticket: "FIL-2", title: "x" }), now: { ticket: "FIL-2", since: "2026-11-17T20:00:00Z", run_id: "r1" } }],
    tablero: { initiatives: [{ key: "FIL-I1", title: "Primera", status: "Active", done: 1, total: 4, tickets: [tkL("FIL-1", "lista"), tkL("FIL-2", "construyendo", true), tkL("FIL-3", "te_toca")] }, { key: "FIL-I9", title: "Lista", status: "Active", done: 2, total: 2, closed: 2, can_close: true, version: 3, tickets: [] }], loose: [], loose_done: 0 },
    next_first: null,
  });
  const d = { ...decision("d3", "filmia", "deliverable", "FIL-3") };
  const links = { paso: (k: string) => `/paso/${k}`, iniciativa: (k: string) => `/ini/${k}`, entrega: (x: { id: string }) => `/e/${x.id}`, sueltos: "/s", doc: (id: string) => `/doc/${id}` };
  const out = html(h(tablero.Board, { p, decisions: [d], acts, links, now: Date.parse("2026-11-17T20:12:00Z"), chosenKey: null, onChoose: () => {} }));
  for (const s of ["Por hacer", "Taller", "QA", "Revisión", "Te toca", "Hecho"]) assert.ok(out.includes(`>${s}<`), s);
  assert.match(out, /data-card="FIL-2"[\s\S]*?>Detener</);
  assert.match(out, /data-card="FIL-1"[\s\S]*?>Hacer primero</);
  assert.match(out, /data-bar="FIL-3"/, "the te toca card is chosen by default");
  assert.equal((out.match(/cor-btn primary/g) ?? []).length, 1);
  assert.match(out, /data-control="tablero-aceptar"[^>]*>Aceptar</);
  assert.match(out, /href="\/e\/d3"[^>]*>Ver la entrega/);
  assert.match(out, /data-close="FIL-I9"[\s\S]*?Cerrar iniciativa/);
  const empty = html(h(tablero.Board, { p: project("w", { tablero: { initiatives: [], loose: [], loose_done: 0 } }), decisions: [], acts, links, now: 0, chosenKey: null, onChoose: () => {} }));
  assert.match(empty, /data-board="empty"[\s\S]*?Arma el plan/);
});

test("I62-6: the team's headline and the seats' lines", () => {
  assert.deepEqual(equipo.teamHeadline([member("a", "taller", "running"), member("b", "product-owner"), member("c", "research"), member("d", "artist")], false), { now: "Uno trabajando.", rest: "Tres libres." });
  assert.deepEqual(equipo.teamHeadline([member("b", "product-owner")], false), { now: "Nadie trabajando.", rest: "Uno libre." });
  assert.equal(equipo.teamHeadline([], true).now, "El equipo está en pausa.");
  assert.equal(equipo.ROLE_LINE.taller, "Construye lo que está en el plan");
});

// ---- PLA-I62-7: Ideas, Idea abierta, Diseño, PRs, Docs
const ideaMod = await load("components/corriente/idea.tsx");
const listas = await load("components/corriente/listas.tsx");

test("I62-7: an idea opens on the newest delivery not seen; each stop says where it stands", () => {
  const st = (stop: string, state: string, over: Record<string, unknown> = {}) => ({ stop, state, by: "artist", at: "2026-11-17T20:00:00Z", delivered: true, doc: null, seen: true, answer: null, ...over });
  const d = { stop: "plan", stops: [st("buzon", "done"), st("entendido", "done"), st("investigacion", "done"), st("diseno", "done", { seen: false }), st("plan", "here", { delivered: false }), st("lista", "todo", { delivered: false })] };
  assert.equal(ideaMod.firstStop(d), "diseno");
  assert.equal(ideaMod.firstStop({ ...d, stops: d.stops.map((x: Record<string, unknown>) => ({ ...x, seen: true })) }), "plan");
  const base = { quiet_since: null, state: "quieta", queued: null };
  assert.deepEqual(ideaMod.stopLine(st("diseno", "done", { seen: false }), base), { text: "Artist · sin ver", tone: "new" });
  assert.deepEqual(ideaMod.stopLine(st("investigacion", "done", { by: "research", answer: { verdict: "ok" } }), base), { text: "Research · te gustó", tone: "ok" });
  assert.deepEqual(ideaMod.stopLine(st("lista", "here", { delivered: false }), base), { text: "Espera «Constrúyelo»", tone: "you" });
  assert.deepEqual(ideaMod.stopLine(st("plan", "here", { delivered: false, by: "product-owner" }), { ...base, state: "trabajando" }), { text: "PO la trabaja", tone: "live" });
});

test("I62-7: ideas group by what they need from the owner", () => {
  const fi = (key: string, stage: string, over: Record<string, unknown> = {}) => ({ key, title: key, stage, waits: null, updated_at: "x", docs: {}, unseen: 0, ...over });
  const rows = listas.ideaRows([fi("A", "design", { unseen: 2 }), fi("B", "research", { waits: "Doc Research" }), fi("C", "ready")], [{ key: "C", title: "C", stop: "lista", state: "quieta", who: "product-owner", images: 0, understood: null, question: null, guardada: false, at: "x" }, { key: "D", title: "D", stop: "diseno", state: "quieta", who: "artist", images: 0, understood: null, question: null, guardada: true, at: "x" }]);
  assert.deepEqual(rows.map((r: { key: string; group: string }) => `${r.key}:${r.group}`), ["A:nuevo", "B:avanza", "C:lista", "D:guardada"]);
  assert.equal(rows[1].who, "Falta el doc Research");
  assert.equal(rows[0].stop, "diseno");
});
