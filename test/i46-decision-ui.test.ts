// PLA-I46-10 and PLA-I46-15 on the floor, rendered with react-dom/server and fake data (no browser, no database;
// fake names only).
//   I46-10  the evidence card in Ahora (tests, separate review, «Check list del PO», the stills, the switch) with
//           Aceptar / Devolver a Taller / Ver PR; the Devolver sheet; after a return the floor is violet with no
//           green button and Ahora shows only a grey «Ver nota»; the switch is off by default and needs the owner
//   I46-15  Una decisión: the layer for a delivery and for a leg's plan, its shortcuts (ignored in fields), focus
//           back to the floor on close, the whole screen on a phone
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { nextMove } from "../src/api/company-move.js";

(globalThis as { React?: unknown }).React = React;
const load = async (p: string) => (await import(new URL(`../ui/src/${p}`, import.meta.url).href)) as Record<string, any>;



const ev = await load("lib/evidencia.ts");
const edificio = await load("lib/edificio.ts");

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

const nowCard = (s: string) => /<div(?: id="[^"]+")? class="edi-nowb"[\s\S]*?(?=<div class="edi-home-q"|<div class="edi-fcol"|<nav class="edi-idx")/.exec(s)?.[0] ?? "";
const floorOf = (s: string) => s.slice(s.indexOf('data-floor="demo"'), s.indexOf("edi-street"));



test("I46-10: without a QA read the card says what it has (the ticket's own tests) and that there was no separate review", () => {
  const d = delivery();
  const v = ev.evidenceView(null, d);
  assert.deepEqual(v.tests, { value: "14 de 14", ok: true, sub: "según la última prueba del ticket" });
  assert.deepEqual(v.review, { value: "Sin revisión aparte", ok: null, sub: "no hay QA en este equipo" });
  assert.equal(v.checklist.title, "Check list del PO");
  assert.equal(ev.evidenceView(undefined, d).loading, true);
  const failed = ev.evidenceView({ ...READ, state: "fail", tests: { ...READ.tests, pass: 12, verdict: "fail" }, review: { verdict: "fail", notes: "src/x.ts:12 no filtra", model: null }, checklist: [{ n: 1, text: "Uno", mark: "fail", note: "no" }] }, d);
  assert.deepEqual([failed.tests.value, failed.tests.ok, failed.review.value, failed.checklist.title], ["12 de 14", false, "Encontró algo", "Check list del PO · 0 de 1"]);
});












