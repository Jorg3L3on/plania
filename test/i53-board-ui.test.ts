// PLA-I53-3: el tablero de etapas on the floor. The stage comes from the server (etapa, PLA-I53-2); lib/etapas.ts
// places it and components/plan/stage-board.tsx draws it. Server-rendered and handler-level; no browser, no
// database. Fake names only.
//   #1  every open initiative is a track and each ticket stands at its stage's station; Hecho folds per track;
//       completed initiatives fold into one line; Sueltos holds the loose tickets and the count of done ones
//   #3  Detener, Hacer primero, Aceptar and Quitar sit on the cards they belong to and call the routes La fila used;
//       a card, a track and a Hecho stack open La ficha
//   #4  the Entrega strip and La fila are gone from the floor and from the code
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";

(globalThis as { React?: unknown }).React = React;
const load = async (p: string) => (await import(new URL(`../ui/src/${p}`, import.meta.url).href)) as Record<string, any>;
const lib = await load("lib/etapas.ts");
const board = await load("components/plan/stage-board.tsx");
const floorUi = await load("components/compania/edificio/floor.tsx");
const fichaUi = await load("components/compania/edificio/ficha.tsx");
const fichaLib = await load("lib/ficha.ts");

type Json = Record<string, any>;
const h = React.createElement;
const NOW = new Date("2026-11-15T20:00:00Z").getTime();
const TZ = "America/Mexico_City";
const noop = () => {};
const text = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

const etapa = (id: string, patch: Json = {}): Json => ({ etapa: id, qa: null, holder: null, live: false, since: "2026-11-15T19:00:00Z", ci: null, reason: null, ...patch });
const tk = (key: string, title: string, e: Json, parent: string | null = null): Json => ({ key, title, status: "x", phase: null, parent_key: parent, etapa: e });
const ALL: Json[] = [
  tk("DEM-I2-1", "Uno", etapa("despues"), "DEM-I2"),
  tk("DEM-I2-2", "Dos", etapa("lista"), "DEM-I2"),
  tk("DEM-I2-3", "Tres", etapa("en_espera", { reason: "Espera a «Dos»" }), "DEM-I2"),
  tk("DEM-I2-4", "Cuatro", etapa("pospuesto"), "DEM-I2"),
  tk("DEM-I2-5", "Cinco", etapa("bloqueado", { reason: "Falta una llave" }), "DEM-I2"),
  tk("DEM-I2-6", "Seis", etapa("construyendo", { holder: { agent: "taller-demo", role: "taller" }, live: true, since: "2026-11-15T19:48:00Z" }), "DEM-I2"),
  tk("DEM-I2-7", "Siete", etapa("devuelto", { holder: { agent: "taller-demo", role: "taller" }, live: false }), "DEM-I2"),
  tk("DEM-I2-8", "Ocho", etapa("sin_dueno"), "DEM-I2"),
  tk("DEM-I2-9", "Nueve", etapa("en_qa", { qa: "running", holder: { agent: "qa-demo", role: "qa" }, live: true }), "DEM-I2"),
  tk("DEM-I2-10", "Diez", etapa("en_qa", { qa: "queued", holder: { agent: "qa", role: "qa" } }), "DEM-I2"),
  tk("DEM-I2-11", "Once", etapa("en_revision", { ci: "failure" }), "DEM-I2"),
  tk("DEM-I2-12", "Doce", etapa("te_toca", { holder: { agent: "jorge", role: "ceo" }, ci: "success" }), "DEM-I2"),
  tk("DEM-I2-13", "Trece", etapa("integrado", { since: "2026-11-14T10:00:00Z" }), "DEM-I2"),
  tk("DEM-I2-14", "Catorce", etapa("publicado", { since: "2026-11-15T10:00:00Z" }), "DEM-I2"),
  tk("DEM-I2-15", "Quince", etapa("hecho", { since: "2026-11-13T10:00:00Z" }), "DEM-I2"),
];
const tablero = (patch: Json = {}): Json => ({
  initiatives: [
    { key: "DEM-I2", title: "Agenda", status: "Active", done: 3, total: 15, tickets: ALL },
    { key: "DEM-I3", title: "Cobros", status: "On hold", done: 0, total: 1, tickets: [tk("DEM-I3-1", "Recibo", etapa("pospuesto"), "DEM-I3")] },
  ],
  loose: [tk("DEM-81", "Suelto listo", etapa("lista")), tk("DEM-82", "Suelto en revisión", etapa("en_revision", { ci: "pending" }))],
  loose_done: 80,
  ...patch,
});

// Which station each card stands under, read from the markup: a track's cells come in station order.
function placed(html: string): Record<string, string> {
  const at: Record<string, string> = {};
  for (const row of html.split('class="sb-row"').slice(1)) {
    const cells = row.split(/class="sb-cell sb-r"/).slice(1);
    cells.forEach((c, i) => {
      for (const m of c.matchAll(/data-card="([^"]+)"/g)) at[m[1]!] = lib.STATIONS[i].id;
    });
  }
  return at;
}

test("I53-3 #1: each stage stands at its station, with the card's word from the Design doc", () => {
  const want: Record<string, [string, string]> = {
    despues: ["por", "Después"],
    lista: ["por", "Lista para empezar"],
    en_espera: ["por", "En espera"],
    pospuesto: ["por", "Pospuesto a propósito"],
    bloqueado: ["por", "Bloqueado"],
    construyendo: ["taller", "Construyendo"],
    sin_dueno: ["taller", "Sin dueño"],
    en_revision: ["rev", "En revisión"],
    te_toca: ["toca", "Te toca"],
    integrado: ["hecho", "Integrado"],
    publicado: ["hecho", "Publicado"],
    hecho: ["hecho", "Hecho"],
  };
  for (const [id, [col, word]] of Object.entries(want)) {
    assert.equal(lib.columnOf(etapa(id)), col, id);
    assert.equal(lib.wordOf(etapa(id)), word, id);
  }
  assert.equal(lib.columnOf(etapa("devuelto")), "taller");
  assert.equal(lib.wordOf(etapa("devuelto", { live: true })), "Devuelto · arreglando");
  assert.equal(lib.wordOf(etapa("devuelto", { live: false })), "Devuelto · espera arreglo", "says arreglando only while someone is on it");
  assert.equal(lib.wordOf(etapa("en_qa", { qa: "running" })), "En QA · probando");
  assert.equal(lib.wordOf(etapa("en_qa", { qa: "queued" })), "En QA · en cola");
  assert.equal(lib.toneOf(etapa("en_qa", { qa: "queued" })), "pending");
  assert.equal(lib.ciWord("failure"), "pruebas en rojo");
  assert.equal(lib.whoLine(etapa("construyendo", { holder: { agent: "t", role: "taller" }, since: "2026-11-15T19:48:00Z" }), NOW), "Taller · hace 12 min");
});

test("I53-3 #1: every open initiative is a track plus Sueltos; the board puts each ticket under its stage", () => {
  const html = renderToStaticMarkup(h(board.StageBoard, { tablero: tablero(), now: NOW, folded: [{ key: "DEM-I1", title: "Alta" }] }));
  assert.deepEqual([...html.matchAll(/data-row="([^"]+)"/g)].map((m) => m[1]), ["DEM-I2", "DEM-I3", "sueltos"]);
  const at = placed(html);
  for (const t of [...tablero().initiatives.flatMap((i: Json) => i.tickets), ...tablero().loose]) {
    const col = lib.columnOf(t.etapa);
    if (col === "hecho") assert.equal(at[t.key], undefined, `${t.key} folds into Hecho`);
    else assert.equal(at[t.key], col, t.key);
  }
  // Hecho folds per track, newest title first; Sueltos counts the loose done ones.
  const t = text(html);
  assert.ok(t.includes("✓ 3 hechos Catorce"), "the newest landed title");
  assert.ok(t.includes("✓ 80 hechos"));
  assert.ok(t.includes("3 de 15") && t.includes("0 de 1 · en pausa") && t.includes("80 de 82 · sin iniciativa"));
  // Completed initiatives: one line under the board.
  assert.match(html, /data-folded="1"[\s\S]*1 iniciativa completa[\s\S]*✓ DEM-I1/);
  // Long titles clamp to two lines on the card and keep the whole text in title, with the why.
  assert.match(html, /title="Tres · Espera a «Dos»"/);
});

test("I53-3 #1: a station is lit while someone works there, in the stage colour; Te toca lights while something waits", () => {
  const lit = lib.litOf(ALL);
  assert.deepEqual(lit, { taller: "now", qa: "now", toca: "jorge" });
  const quiet = lib.litOf([tk("A-1", "x", etapa("lista")), tk("A-2", "y", etapa("devuelto", { live: false }))]);
  assert.deepEqual(quiet, {}, "nothing lit while nobody works");
  assert.deepEqual(lib.litOf([tk("A-2", "y", etapa("devuelto", { live: true }))]), { taller: "review" }, "a fix in course lights Taller violet");
  const html = renderToStaticMarkup(h(board.StageBoard, { tablero: tablero(), now: NOW }));
  assert.match(html, /data-station="taller" data-lit="now"/);
  assert.match(html, /data-station="toca" data-lit="jorge"/);
  assert.match(html, /data-station="rev">/, "Revisión is not lit: CI is not someone working");
});

const decision = (key: string): Json => ({ id: `m-${key}`, project: "demo", kind: "pr", state: null, actions: ["fusionar", "cambios"], ref: key, links: [] });
test("I53-3 #3: the cards carry Detener, Aceptar, Hacer primero and Quitar where they apply", () => {
  const team: Json[] = [{ agent: "taller-demo", role: "taller", state: "running", now: { ticket: "DEM-I2-6", since: "2026-11-15T19:48:00Z", run_id: "run-6" } }];
  const ctx = { team, decisions: [decision("DEM-I2-12")], orders: [{ key: "DEM-81", state: "enviada", stage: null }], nextFirst: null };
  const acts = (key: string) => lib.cardActs([...ALL, ...tablero().loose].find((t: Json) => t.key === key), ctx).map((a: Json) => a.kind);
  assert.deepEqual(acts("DEM-I2-6"), ["detener"]);
  assert.deepEqual(acts("DEM-I2-12"), ["aceptar"]);
  assert.deepEqual(acts("DEM-I2-2"), ["primero"]);
  assert.deepEqual(acts("DEM-81"), ["primero", "quitar"]);
  assert.deepEqual(acts("DEM-I2-1"), []);
  assert.deepEqual(lib.cardActs(ALL[1], { ...ctx, nextFirst: "DEM-I2-2" }).map((a: Json) => a.kind), [], "already first");

  // Each act calls the route La fila called.
  const calls: string[] = [];
  const bacts = {
    onPickNext: (slug: string, key: string) => calls.push(`next ${slug} ${key}`),
    onStop: (id: string) => calls.push(`stop ${id}`),
    onAccept: (d: Json, action: string) => calls.push(`accept ${d.id} ${action}`),
    onCancel: (slug: string, key: string) => calls.push(`cancel ${slug} ${key}`),
  };
  for (const key of ["DEM-I2-6", "DEM-I2-12", "DEM-I2-2", "DEM-81"]) for (const a of lib.cardActs([...ALL, ...tablero().loose].find((t: Json) => t.key === key), ctx)) floorUi.boardRun("demo", a, bacts)!();
  assert.deepEqual(calls, ["stop run-6", "accept m-DEM-I2-12 fusionar", "next demo DEM-I2-2", "next demo DEM-81", "cancel demo DEM-81"]);
  assert.equal(floorUi.boardRun("demo", { kind: "detener", runId: "x" }, {}), null, "no handler, no button");
});

const project = (patch: Json = {}): Json => ({
  slug: "demo",
  title: "Demo",
  paused: false,
  light: "ok",
  goal: "Tienda lista",
  team: [
    { agent: "product-owner-demo", role: "product-owner", state: "idle", now: null, queue: [] },
    { agent: "research-demo", role: "research", state: "idle", now: null, queue: [] },
    { agent: "taller-demo", role: "taller", state: "running", now: { ticket: "DEM-I2-6", title: "Seis", since: "2026-11-15T19:48:00Z", run_id: "run-6" }, queue: [] },
    { agent: "qa-demo", role: "qa", state: "idle", now: null, queue: [] },
  ],
  thread: { id: "t", unread: 0, last: null },
  plan: null,
  this_week: { done: 0, docs: 0, prs: 0, last_at: null },
  next: null,
  work: { open: 0, in_progress: 0 },
  usage: { tokens: 0 },
  route: { legs: [{ key: "DEM-I1", title: "Alta", done: 2, total: 2, state: "done", note: null }, { key: "DEM-I2", title: "Agenda", done: 3, total: 15, state: "here", note: null }], more_legs: 0 },
  orders: [{ id: "o1", kind: "order", key: null, title: "Cambiar el color del botón", at: "2026-11-15T19:00:00Z", state: "enviada", stage: null, understood: null, who: null, link: null, age_h: 1 }],
  latest: [],
  stale_requests: [],
  tablero: tablero(),
  ahora: [],
  ...patch,
});
const floorHtml = (p: Json, extra: Json = {}) =>
  renderToStaticMarkup(h(MemoryRouter, null, h(floorUi.Floor, { project: p, now: NOW, timeZone: TZ, decisions: [decision("DEM-I2-12")], board: { onPickNext: noop, onStop: noop, onAccept: noop, onCancel: noop, onTicket: noop, onTrack: noop }, ficha: true, onOpen: noop, ...extra })));

test("I53-3 #1 #3 #4: the floor draws the board in place of Entrega and La fila, with the seats at their stations", () => {
  const html = floorHtml(project());
  assert.equal(/edi-route|edi-leg\b|data-fila|edi-frow|data-steps-of/.test(html), false, "no Entrega, no La fila");
  assert.match(html, /data-slot="ahora"/, "the place for the Ahora line, above the board");
  assert.ok(html.indexOf('data-slot="ahora"') < html.indexOf('class="dark sb"'));
  // Seats: PO, Taller and QA over their stations, Research in the corner; each opens the teammate.
  assert.match(html, /data-station="por"[^>]*data-agent="product-owner-demo"/);
  assert.match(html, /data-station="taller"[^>]*data-agent="taller-demo"/);
  assert.match(html, /data-station="qa"[^>]*data-agent="qa-demo"/);
  assert.match(html, /class="edi-seat"[^>]*data-agent="research-demo"/);
  // The actions on their cards.
  assert.match(html, /data-card="DEM-I2-6"[\s\S]*?data-control="tablero-detener"/);
  assert.match(html, /data-card="DEM-I2-12"[\s\S]*?data-control="tablero-aceptar"/);
  assert.match(html, /data-card="DEM-I2-2"[\s\S]*?data-control="tablero-primero"/);
  // The owner's order that is not a ticket yet stands in Sueltos, Por hacer.
  assert.match(html, /data-card="o-o1"[^>]*data-etapa="pedido"[\s\S]*?Tu pedido · enviado[\s\S]*?Cambiar el color del botón/);
  // The company read carries no closed initiative, so nothing folds under the floor's board (the board can: #1 above).
  assert.equal(html.includes("data-folded"), false);
  for (const c of ["tablero-tarjeta", "tablero-iniciativa", "tablero-hecho"]) assert.ok(html.includes(`data-control="${c}"`), c);
  // The files are gone.
  for (const f of ["components/compania/edificio/route.tsx", "components/compania/edificio/fila.tsx", "lib/fila.ts"]) assert.equal(existsSync(new URL(`../ui/src/${f}`, import.meta.url)), false, f);
});

test("I53-3: an empty floor offers Que PO lo planee; a floor with a plan but nothing open says so", () => {
  const calls: string[] = [];
  const empty = floorHtml(project({ route: { legs: [], more_legs: 0 }, tablero: { initiatives: [], loose: [], loose_done: 0 }, orders: [] }), { nowActs: { onPlan: (slug: string, t: string) => calls.push(`${slug}: ${t}`) } });
  assert.ok(text(empty).includes("Aún no hay plan") && empty.includes('data-control="planear"'));
  const done = floorHtml(project({ tablero: { initiatives: [], loose: [], loose_done: 0 }, orders: [] }), { nowActs: { onPlan: noop } });
  assert.ok(text(done).includes("No hay iniciativas abiertas") && !done.includes('data-control="planear"'));
  assert.equal(floorUi.PLAN_ASK, "Arma el plan del proyecto: los entregables y los pasos de cada uno.");
});

test("I53-3 #3: La ficha opens an initiative with its tickets by stage, Sueltos, and a card's stage line", () => {
  const p = project();
  const props = (fref: Json, extra: Json = {}) => ({ project: p, fref, rows: { status: "idle" }, task: { status: "idle" }, doc: { status: "idle" }, slots: {}, now: NOW, timeZone: TZ, onRef: noop, onClose: noop, ...extra });
  const r = (fref: Json, extra: Json = {}) => renderToStaticMarkup(h(MemoryRouter, null, h(fichaUi.Ficha, props(fref, extra))));
  const leg = text(r({ kind: "leg", key: "DEM-I2" }));
  assert.ok(leg.includes("Agenda") && leg.includes("3 de 15 hechos") && leg.includes("Abiertos") && leg.includes("Hechos · 3"));
  assert.ok(leg.indexOf("Catorce") < leg.indexOf("Trece") && leg.indexOf("Trece") < leg.indexOf("Quince"), "done newest first");
  assert.ok(leg.includes("Construyendo · Taller · hace 12 min"));
  const done = text(r({ kind: "leg", key: "DEM-I1" }));
  assert.ok(done.includes("Completa · 2 de 2 hechos"));
  const sueltos = text(r({ kind: "sueltos" }));
  assert.ok(sueltos.includes("Sueltos") && sueltos.includes("Suelto listo") && sueltos.includes("80 sueltos hechos"));
  const step = r({ kind: "step", key: "DEM-I2-11" }, { task: { status: "ok", data: { key: "DEM-I2-11", title: "Once", status: "In review", checks: [], results: [], docs: [], log: [], pr: null, pr_url: null } } });
  assert.ok(text(step).includes("En revisión · Revisión · pruebas en rojo"));
  assert.deepEqual(fichaLib.fichaOf("?piso=demo&f=sueltos")?.ref, { kind: "sueltos" });
  assert.equal(fichaLib.fichaSearch("demo", { kind: "sueltos" }), "?piso=demo&f=sueltos");
});

test("I53-3 #4: the floor's CSS has no Entrega or La fila rules left; the board scrolls inside and never squeezes", () => {
  const css = readFileSync(new URL("../ui/src/index.css", import.meta.url), "utf8");
  assert.equal(/\.edi-route|\.edi-legs|\.edi-fila|\.edi-frow|\.edi-steps/.test(css), false);
  assert.match(css, /\.sb-grid \{ display: grid; grid-template-columns: 150px repeat\(6, minmax\(0, 1fr\)\);[^}]*min-width: 780px;/);
  assert.match(css, /\.sb-tt \{[^}]*-webkit-line-clamp: 2;/);
  const page = readFileSync(new URL("../ui/src/pages/ceo.tsx", import.meta.url), "utf8");
  assert.ok(page.includes('showFicha({ kind: "step", key: t.key }, el, slug)') && page.includes('showFicha(key ? { kind: "leg", key } : { kind: "sueltos" }, el, slug)'));
});
