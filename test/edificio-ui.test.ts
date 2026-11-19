// PLA-I39-3..9: the building on /ceo rendered with fake data (Design doc of PLA-IDEA11, frames F1-F11). One test per
// state the tickets name. Server-rendered with react-dom/server; no browser, no database. Fake names and numbers.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { nextMove } from "../src/api/company-move.js";

(globalThis as { React?: unknown }).React = React;
const load = async (p: string) => (await import(new URL(`../ui/src/${p}`, import.meta.url).href)) as Record<string, any>;





const lib = await load("lib/edificio.ts");

type Json = Record<string, any>;
const h = React.createElement;
const html = (el: React.ReactElement) => renderToStaticMarkup(h(MemoryRouter, null, el));
const noop = () => {};
const NOW = new Date("2026-11-10T18:00:00Z").getTime();
const TZ = "America/Mexico_City";
const clean = (s: string) => {
  assert.equal(/\bnull\b|\bundefined\b|NaN|\[object Object\]/.test(s), false, "never a null key");
  assert.equal(/\$|USD/.test(s), false, "tokens, never money");
  // Keys live only behind Detalles (PLA-I36-11), folded.
  const shown = s.replace(/<details[^>]*data-detalles[\s\S]*?<\/details>/g, "").replace(/data-[a-z-]+="[^"]*"/g, "").replace(/id="[^"]*"/g, "");
  assert.equal(/\b[A-Z]{2,4}-(I\d+-)?\d+\b/.test(shown), false, "never a ticket key on screen");
};
const text = (s: string) => s.replace(/<[^>]+>/g, " ");

const member = (role: string, patch: Json = {}): Json => ({ agent: `${role}-workia`, role, template: role, state: "idle", now: null, last: null, produced: null, waiting: null, queue: [], ...patch });
const project = (patch: Json = {}): Json => ({
  slug: "workia",
  title: "Workia",
  paused: false,
  light: "ok",
  light_reason: null,
  goal: null,
  rumbo: { goal_id: null, goal: null, why: "", target_on: null, forecast_on: null, weeks_behind: null, missing: true },
  usage: { used: 100_000 },
  team: ["product-owner", "research", "artist", "taller"].map((r) => member(r)),
  thread: { id: "t-workia", unread: 0, last: null },
  plan: null,
  this_week: { done: 2, docs: 0, prs: 0, last_at: "2026-11-10T17:00:00Z" },
  next: null,
  ready: [],
  work: { open: 2, in_progress: 0 },
  orders: [],
  ...patch,
});
const decision = (patch: Json = {}): Json => ({
  id: "q-00000000-0000-4000-8000-000000000001",
  project: "workia",
  title: "¿Qué tienda abrimos primero?",
  kind: "question",
  options: [
    { n: 1, label: "La de ropa", recommended: true },
    { n: 2, label: "La de libros", recommended: false },
  ],
  actions: ["elegir", "responder"],
  state: null,
  at: "2026-11-10T16:00:00Z",
  ref: "WRK-7",
  detail: null,
  links: [],
  body: null,
  checks: null,
  release: null,
  asker: { agent: "research-workia", role: "research" },
  ...patch,
});
const company = (patch: Json = {}): Json => ({
  company: { paused: false },
  week: { starts_at: "2026-11-09T06:00:00Z", resets_at: "2026-11-16T06:00:00Z", timezone: TZ },
  asistente: { thread_id: "t-co", usage: { used: 0 }, last_run: { status: "ok", at: "2026-11-10T17:00:00Z", summary: "Resumen: Workia avanza." }, state: "idle", unread: 0 },
  projects: [project()],
  plumbing: { spend: 1_250_000, running: 1, paused: false },
  decisions: [],
  inbox: { decisiones: 0, pasos: 0 },
  ...patch,
});
// PLA-I46-3: each floor's move comes from the server (src/api/company-move.ts); attach it as companyRead does.
const withMoves = (c: Json): Json => ({ ...c, projects: c.projects.map((p: Json) => ("next_move" in p ? p : { ...p, next_move: nextMove(p as never, c.decisions as never, { companyPaused: c.company.paused }) })) });











test("I39-3 #5: floors that need the owner come first; the hue is fixed per slug; the sky follows the hour", () => {
  const a = project({ slug: "alfa", title: "Alfa" });
  const b = project({ slug: "beta", title: "Beta", light: "quiet" });
  const c = project({ slug: "gama", title: "Gama", paused: true, light: "paused" });
  const { floors, basement } = lib.floorOrder([a, b, c], [decision({ project: "beta" })]);
  assert.deepEqual(floors.map((p: Json) => p.slug), ["beta", "alfa"]);
  assert.deepEqual(basement.map((p: Json) => p.slug), ["gama"]);
  assert.equal(lib.floorHue("workia"), lib.floorHue("workia"));
  assert.ok(lib.HUES.includes(lib.floorHue("plania")));
  assert.equal(lib.skyAt(23).orb, "moon");
  assert.equal(lib.skyAt(12).orb, "sun");
  assert.notEqual(lib.skyAt(12).top, lib.skyAt(2).top);
});



// ---- handlers without a DOM: expand hook-free components into their element tree and call the handler.
type El = { type: unknown; props: Json };


const findAll = (node: unknown, pred: (el: El) => boolean, out: El[] = []): El[] => {
  if (Array.isArray(node)) for (const n of node) findAll(n, pred, out);
  else if (node && typeof node === "object" && "props" in node) {
    const el = node as El;
    if (pred(el)) out.push(el);
    findAll(el.props?.children, pred, out);
  }
  return out;
};



// ---- PLA-I39-4

const plan = { initiative: { key: "WRK-I2", title: "Formulario de bienvenida" }, done: 2, total: 5, start_on: null, due_on: null, weeks: null, today_pct: null, done_pct: null, pace: null, weeks_behind: null, forecast_on: null };












const acts = (patch: Json = {}) => ({ now: NOW, busy: null, errors: {}, opened: null, onAct: noop, ...patch });
const proposal = decision({
  id: "m-00000000-0000-4000-8000-0000000000a1",
  kind: "proposal",
  title: "¿Con qué arrancamos el formulario?",
  options: [
    { n: 1, label: "Con el borrador", recommended: true, effect: "Taller arranca hoy", cost: "3 tickets · 2 días" },
    { n: 2, label: "Esperar a la tienda", recommended: false, effect: "Nadie construye", cost: "7 días" },
  ],
  combinable: [[1, 2]],
  recommended_reason: "deja probar algo esta semana",
  ref: null,
  asker: { agent: "product-owner-workia", role: "product-owner" },
});
const KINDS: Json[] = [
  proposal,
  decision({ id: "m-plan", kind: "plan", options: null, actions: ["empezar", "cambiar", "cancelar"], plan: { order: "WRK-9", understood: "Una tienda", steps: [{ title: "Pantalla", done_when: "se ve" }], cost: "2 días", needs_approval: true, created: [] }, asker: { agent: "product-owner-workia", role: "product-owner" } }),
  decision({ id: "t-action", kind: "action", options: null, actions: ["hecho", "aplazar"], asker: { agent: "artist-workia", role: "artist" } }),
  decision(),
  decision({ id: "m-deliv", kind: "deliverable", options: null, actions: ["aceptar", "cambios"], evidence: { verdict: "pass", kind: "test", cite: "ok", pass: 3, fail: 0, at: "2026-11-10T15:00:00Z" }, preview_url: null, hold: null, asker: { agent: "taller-workia", role: "taller" } }),
  decision({ id: "m-pr", kind: "pr", options: null, actions: ["fusionar", "cambios"], hold: "Las pruebas siguen corriendo.", asker: { agent: "taller-workia", role: "taller" } }),
  decision({ id: "b-step", kind: "step", options: null, actions: ["hecho"], asker: { agent: "research-workia", role: "research" } }),
  decision({ id: "r-workia", kind: "release", options: null, actions: [], ref: null, asker: null, release: { from: "sandbox", into: "main", env: "prod", ahead: 2, tickets: [{ key: "WRK-1", title: "Uno" }], open_checks: 0, before: 0 } }),
];
const actionsIn = (s: string) => [...s.matchAll(/data-action="([a-z]+)"/g)].map((m) => m[1]).sort();













const companiaLib = await load("lib/compania.ts");
const taller = member("taller", {
  state: "running",
  now: { ticket: "WRK-3", title: "Pantalla del carrito", since: "2026-11-10T17:20:00Z", run_id: "00000000-0000-4000-8000-0000000000r1" },
  queue: [{ key: "WRK-5", title: "Guardar el carrito" }, { key: "WRK-6", title: "Pagar" }],
  produced: { kind: "doc", ref: "00000000-0000-4000-8000-0000000000d1", title: "Notas del carrito" },
  last: { ticket: "WRK-2", title: "Lista", status: "ok", at: "2026-11-10T15:00:00Z", run_id: "00000000-0000-4000-8000-0000000000r0" },
});











// PLA-I46-13 (replaces the I39-6 #5 list): the Sumar sheet. Role and packs are the two choices; the engine is one line.
const HIRE = [
  { slug: "product-owner", title: "Product owner", state: "taken" },
  { slug: "research", title: "Research", state: "taken" },
  { slug: "artist", title: "Artist", state: "taken" },
  { slug: "taller", title: "Builder", state: "taken" },
  { slug: "qa", title: "QA", state: "free" },
  { slug: "copy", title: "Copy", state: "free" },
  { slug: "seguridad", title: "Seguridad", state: "no_doc" },
  { slug: "marketing", title: "Marketing", state: "free" },
  { slug: "data", title: "Data", state: "free" },
];
const PACKS = [
  { slug: "pruebas-primero", name: "Pruebas primero", when: "Antes de escribir código.", doc_id: "d1" },
  { slug: "qa-visual-con-capturas", name: "QA visual con capturas", when: "Al revisar una pantalla.", doc_id: "d2" },
  { slug: "revision-de-seguridad", name: "Revisión de seguridad", when: "Antes de publicar.", doc_id: "d3" },
  { slug: "espanol-claro", name: "Español claro", when: "Al escribir textos.", doc_id: "d4" },
  { slug: "preguntas-antes-de-construir", name: "Preguntas antes de construir", when: "Si algo no está claro.", doc_id: "d5" },
];
const sumar = await load("lib/sumar.ts");






















// ---- PLA-I39-9

// WCAG relative luminance and contrast; colours are read from index.css so the test follows the stylesheet.
const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const contrast = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
};
// a over b at alpha (the floor's hue tint is 11 % over the wall).
const over = (a: string, b: string, alpha: number) =>
  "#" + [1, 3, 5].map((i) => Math.round(parseInt(a.slice(i, i + 2), 16) * alpha + parseInt(b.slice(i, i + 2), 16) * (1 - alpha)).toString(16).padStart(2, "0")).join("");









const release = (patch: Json = {}): Json =>
  decision({
    id: "r-workia",
    kind: "release",
    title: "2 cambios listos para publicar",
    options: null,
    actions: [],
    asker: null,
    release: { from: "sandbox", into: "main", env: "prod", ahead: 9, tickets: [{ key: "WRK-1", title: "Opciones y reglas" }, { key: "WRK-2", title: "Pantalla en dos secciones" }], open_checks: 0, before: 0 },
    ...patch,
  });
const waitingRelease = project({ light: "needs_owner", light_reason: { text: "2 cambios listos esperan que los publiques.", action: { label: "Publicar", href: "#publicar" } } });









const v2lib = await load("lib/v2.ts");

