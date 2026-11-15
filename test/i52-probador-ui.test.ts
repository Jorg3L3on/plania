// PLA-I52-4: El Probador on the floor, rendered with react-dom/server and fake data (no browser, no database; fake
// names only). The strip in Ahora's card, the viewer in the «Al frente» layer, and the pure helpers.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { nextMove } from "../src/api/company-move.js";

(globalThis as { React?: unknown }).React = React;
const load = async (p: string) => (await import(new URL(`../ui/src/${p}`, import.meta.url).href)) as Record<string, any>;
const building = await load("components/compania/edificio/building.tsx");
const nowc = await load("components/compania/edificio/now.tsx");
const store = await load("components/compania/edificio/evidence-store.ts");
const ev = await load("lib/evidencia.ts");
const edificio = await load("lib/edificio.ts");
const pb = await load("lib/probador.ts");

type Json = Record<string, any>;
const h = React.createElement;
const html = (el: React.ReactElement) => renderToStaticMarkup(h(MemoryRouter, null, el));
const noop = () => {};
const NOW = new Date("2026-11-13T20:44:00Z").getTime();
const TZ = "America/Mexico_City";
const text = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const unq = (s: string) => s.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, "&");

const member = (role: string, patch: Json = {}): Json => ({ agent: `${role}-demo`, role, template: role, state: "idle", now: null, last: null, produced: null, waiting: null, queue: [], next_start: null, ...patch });
const project = (patch: Json = {}): Json => ({
  slug: "demo",
  title: "Demo",
  paused: false,
  light: "ok",
  light_reason: null,
  goal: "Tienda lista",
  rumbo: { goal_id: "g", goal: "Tienda lista", why: "", target_on: null, forecast_on: null, weeks_behind: null, missing: true },
  usage: { used: 0, last_week: 0 },
  team: ["product-owner", "taller", "qa"].map((r) => member(r)),
  thread: { id: "t", unread: 0, last: null },
  plan: null,
  route: { legs: [{ key: "DEM-I1", title: "Catálogo", done: 2, total: 3, state: "here", note: null, steps: [] }], more_legs: 0 },
  latest: [],
  stale_requests: [],
  this_week: { done: 2, docs: 0, prs: 0, last_at: null },
  next: null,
  ready: [],
  work: { open: 1, in_progress: 0 },
  orders: [],
  auto_accept: { on: false, hold: null },
  ...patch,
});
const PR = "https://github.com/example/demo/pull/7";
const delivery = (patch: Json = {}): Json => ({
  id: "m-dev-1",
  project: "demo",
  title: "Pantalla de gracias",
  kind: "pr",
  options: null,
  actions: ["fusionar", "cambios"],
  state: null,
  at: "2026-11-13T20:00:00Z",
  ref: "DEM-3",
  detail: null,
  links: [
    { kind: "ticket", ref: "DEM-3", title: "Pantalla de gracias" },
    { kind: "pr", ref: PR, title: "PR #7" },
  ],
  body: "Listo",
  checks: { open: 0, ci: "none" },
  release: null,
  combinable: [],
  recommended_reason: null,
  plan: null,
  evidence: { verdict: "pass", kind: "verify", cite: "QA pasa", pass: 14, fail: 0, at: "2026-11-13T20:00:00Z" },
  files: null,
  preview_url: null,
  hold: null,
  asker: { agent: "taller-demo", role: "taller" },
  file_step: null,
  verify: null,
  ...patch,
});
const READ: Json = {
  project: "demo",
  key: "DEM-3",
  enabled: true,
  state: "pass",
  tests: { pass: 14, total: 14, verdict: "pass", items: [{ name: "test", command: "pnpm test", ok: true, exit_code: 0, pass: 14, fail: 0, duration_s: 9 }] },
  review: { verdict: "pass", notes: "Hace lo que pide el ticket.", model: "sonnet" },
  checklist: [
    { n: 1, text: "Sale el nombre de la novia", mark: "pass", note: null },
    { n: 2, text: "El botón abre WhatsApp", mark: "pass", note: null },
    { n: 3, text: "Se lee bien a 390", mark: "pass", note: null },
  ],
  captures: { ids: ["a", "b"], image_urls: ["/api/projects/demo/captures/a.png", "/api/projects/demo/captures/b.png"], ok: 2, failed: 0, error: null },
  notes: null,
};
const company = (p: Json, ds: Json[]): Json => ({
  company: { paused: false },
  week: { starts_at: "2026-11-09T06:00:00Z", resets_at: "2026-11-16T06:00:00Z", timezone: TZ },
  asistente: { thread_id: "t-co", usage: { used: 0 }, last_run: null, state: "idle", unread: 0 },
  projects: [{ ...p, next_move: nextMove(p as never, ds as never) }],
  plumbing: { spend: 0, running: 0, paused: false },
  decisions: ds,
  inbox: { decisiones: 0, pasos: 0 },
});
const render = (c: Json, extra: Json = {}) =>
  html(
    h(building.Building, {
      company: c,
      decisions: c.decisions,
      now: NOW,
      timeZone: TZ,
      hello: "Buenas noches",
      day: "Viernes 13 de noviembre",
      onNew: noop,
      onFijar: noop,
      onPublish: noop,
      acts: { now: NOW, busy: null, onAct: extra.onAct ?? noop },
      nowActs: { onStart: noop, onPlan: noop, ...(extra.nowActs ?? { onAuto: noop }) },
      askFor: () => h("div", null, "Pedir"),
    }),
  );
const nowCard = (s: string) => /<div(?: id="[^"]+")? class="edi-nowb"[\s\S]*?(?=<div class="edi-slot")/.exec(s)?.[0] ?? "";
const floorOf = (s: string) => s.slice(s.indexOf('data-floor="demo"'), s.indexOf("edi-street"));


const still = (id: string, w = 1280, hgt = 800) => ({ id, image_url: `/api/projects/demo/captures/${id}.png`, width: w, height: hgt, taken_at: "2026-11-15T09:00:00Z" });
const side = (s: Json | null, patch: Json = {}) => ({ still: s, error: null, missing: false, ...patch });
const PROB: Json = {
  key: "DEM-3",
  muestra: { frase: "Las asesoras pueden crear y apagar sucursales.", vistas: [], pasos: ["Abre Sucursales", "Crea «Coyoacán»", "Apaga Satélite"] },
  state: { state: "lista", attempts: 0, error: null, commit: "abc1234", at: "2026-11-15T09:00:00Z" },
  entrega: { phase: "live", port: 3001, url: "http://localhost:3001", error: null, key: "DEM-3", branch: "jl/dem-3", commit: "abc1234" },
  vistas: [
    { key: "encabezado", label: "Encabezado", path: "/panel", estado: null, kind: "cambio", desktop: { antes: side(still("e-a")), despues: side(still("e-d")), diff: { x: 0.2, y: 0.01, w: 0.1, h: 0.05, ratio: 0.01 } }, phone: { antes: side(still("e-ap", 390, 844)), despues: side(still("e-dp", 390, 844)), diff: null } },
    { key: "sucursales", label: "Sucursales", path: "/panel/sucursales", estado: null, kind: "nueva", desktop: { antes: side(null, { missing: true }), despues: side(still("s-d")), diff: null }, phone: { antes: side(null, { missing: true }), despues: side(still("s-dp", 390, 844)), diff: null } },
    { key: "apagada", label: "Formulario apagado", path: "/registro/satelite", estado: "con Satélite apagada", kind: "cambio", desktop: { antes: side(still("f-a")), despues: side(null, { error: "pidió entrar otra vez" }), diff: null }, phone: { antes: side(null), despues: side(null), diff: null } },
  ],
};

test("I52-4 helpers: what a frame shows, where the viewer opens, the state line and «Si aceptas»", () => {
  const [enc, suc, apa] = PROB.vistas;
  assert.equal(pb.frameOf(suc, "desktop", "antes").kind, "nueva");
  assert.equal(pb.frameOf(suc, "desktop", "despues").kind, "still");
  assert.deepEqual(pb.frameOf(apa, "desktop", "despues"), { kind: "none", why: "pidió entrar otra vez" });
  assert.equal(pb.frameOf(apa, "phone", "antes").kind, "none");
  assert.equal(pb.frameOf(enc, "desktop", "despues").ratio, 1.6);
  assert.equal(pb.firstVista(PROB), "sucursales", "a new screen first");
  assert.equal(pb.sideFor(enc), "comparar");
  assert.equal(pb.sideFor(suc), "despues");
  assert.equal(pb.stateLine(PROB), null);
  assert.equal(pb.stateLine({ ...PROB, state: { ...PROB.state, error: "1 de 6 fotos no salieron" } }), "Faltan fotos: 1 de 6 fotos no salieron");
  assert.equal(pb.stateLine({ ...PROB, state: { ...PROB.state, state: "tomando" } }), "Tomando las fotos de la entrega…");
  assert.match(pb.siAceptas(null, "MIA-28")[0], /^Pasa a sandbox, tu copia de prueba\. A producción solo llega cuando tú lances\./);
  assert.equal(pb.siAceptas(null, "MIA-28")[1], "Si no: MIA-28 espera a esta.");
});

test("I52-4 Ahora: a delivery with a muestra leads with one still per view, marked nueva or cambió; the QA stills step aside", () => {
  const d = delivery({ id: "m-pb-1" });
  store.setRead("demo", "DEM-3", d.id, READ);
  store.setProbador("demo", "DEM-3", d.id, PROB);
  const card = nowCard(render(company(project(), [d])));
  assert.ok(card.includes('data-probador-on="1"'));
  assert.ok(unq(text(card)).includes("Las asesoras pueden crear y apagar sucursales."));
  const thumbs = [...card.matchAll(/data-vista="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(thumbs, ["encabezado", "sucursales", "apagada"]);
  assert.deepEqual([...card.matchAll(/class="edi-pbk" data-kind="([^"]+)">([^<]+)</g)].map((m) => [m[1], m[2]]), [["cambio", "cambió"], ["nueva", "nueva"], ["cambio", "cambió"]]);
  assert.ok(card.includes("/api/projects/demo/captures/s-d.png"));
  assert.equal(card.includes('data-ev="stills"'), false, "the QA stills tile is not drawn twice");
  assert.ok(card.includes('data-ev="tests"'), "the tests still show");
});

test("I52-4 layer: El Probador opens on the new screen, with views, sides, widths, the live copy, three steps and what accepting does", () => {
  const d = delivery({ id: "m-pb-2" });
  store.setRead("demo", "DEM-3", d.id, READ);
  store.setProbador("demo", "DEM-3", d.id, PROB);
  store.openLayer("demo", d.id, null);
  const s = render(company(project(), [d]));
  store.closeLayer();
  const layer = /<div class="edi-layer"[\s\S]*$/.exec(s)?.[0] ?? "";
  assert.match(layer, /class="edi-lcard" data-wide="1"/);
  assert.match(layer, /data-probador="m-pb-2"/);
  assert.deepEqual([...layer.matchAll(/role="tab"[^>]*aria-selected="(true|false)"[^>]*data-vista="([^"]+)"/g)].map((m) => [m[2], m[1]]), [["encabezado", "false"], ["sucursales", "true"], ["apagada", "false"]]);
  assert.deepEqual([...layer.matchAll(/aria-pressed="(true|false)" data-side="([^"]+)"/g)].map((m) => [m[2], m[1]]), [["antes", "false"], ["despues", "true"], ["comparar", "false"]]);
  assert.deepEqual([...layer.matchAll(/aria-pressed="(true|false)" data-width="([^"]+)"/g)].map((m) => [m[2], m[1]]), [["desktop", "true"], ["phone", "false"]]);
  assert.ok(layer.includes('src="/api/projects/demo/captures/s-d.png"'));
  assert.match(layer, /data-control="abrir-vivo">Pruébala en vivo</, "the delivery's copy is on: one click opens it signed in (PLA-I52-5)");
  assert.ok(unq(text(layer)).includes("Pruébala en 3 pasos · 0 de 3"));
  assert.ok(unq(text(layer)).includes("Pasa a sandbox, tu copia de prueba."));
  assert.match(layer, /role="switch" class="edi-sw" aria-checked="true"[^>]*data-control="resaltar"/);
});

test("I52-4 layer: a changed view opens on Comparar with the line; a view without a picture says why", () => {
  const d = delivery({ id: "m-pb-3" });
  store.setRead("demo", "DEM-3", d.id, READ);
  store.setProbador("demo", "DEM-3", d.id, PROB);
  store.setView(d.id, "encabezado");
  store.openLayer("demo", d.id, null);
  let layer = /<div class="edi-layer"[\s\S]*$/.exec(render(company(project(), [d])))?.[0] ?? "";
  store.closeLayer();
  assert.match(layer, /data-side="comparar"/);
  assert.ok(layer.includes("edi-pbcmp") && layer.includes("e-a.png") && layer.includes("e-d.png"));
  assert.match(layer, /class="edi-pbbox"/);
  assert.match(layer, /type="range"[^>]*aria-label="Línea entre antes y después"/);
  store.setView(d.id, "apagada");
  store.openLayer("demo", d.id, null);
  layer = /<div class="edi-layer"[\s\S]*$/.exec(render(company(project(), [d])))?.[0] ?? "";
  store.closeLayer();
  assert.ok(layer.includes("edi-pbpair"), "a pair without both pictures is side by side");
  assert.ok(unq(text(layer)).includes("pidió entrar otra vez"));
});

test("I52-4: a delivery without a muestra keeps the old card", () => {
  const d = delivery({ id: "m-pb-4" });
  store.setRead("demo", "DEM-3", d.id, READ);
  store.setProbador("demo", "DEM-3", d.id, { ...PROB, muestra: null, vistas: [] });
  const card = nowCard(render(company(project(), [d])));
  assert.equal(card.includes("data-probador-on"), false);
  assert.ok(card.includes('data-ev="stills"'));
});
