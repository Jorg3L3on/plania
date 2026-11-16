// PLA-I47-7: what the browser pass found on /ceo v6, pinned. Server-rendered and handler-level; no browser.
//   an in-page link move («#te-toca») is a button that calls onLink, never a dead anchor
//   the sky line never doubles its period
//   the header does not repeat the route's count; Ojo does not repeat Ahora's sentence
//   the Edificio's pill takes the floor's tone; the evidence card survives a missing note
//   one dim grey that passes AA; Ahora keeps its height (one-row sky, one-line legs and captions)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";

(globalThis as { React?: unknown }).React = React;
const load = async (p: string) => (await import(new URL(`../ui/src/${p}`, import.meta.url).href)) as Record<string, any>;
const now = await load("components/compania/edificio/now.tsx");
const head = await load("components/compania/edificio/head.tsx");
const ficha = await load("components/compania/edificio/ficha.tsx");
const facade = await load("components/compania/edificio/facade.tsx");
const lib = await load("lib/edificio.ts");
const ev = await load("lib/evidencia.ts");

type Json = Record<string, any>;
const h = React.createElement;
const NOW = new Date("2026-11-10T18:00:00Z").getTime();
const html = (el: React.ReactElement) => renderToStaticMarkup(h(MemoryRouter, null, el));
const project = (patch: Json = {}): Json => ({
  slug: "lumen",
  title: "Lumen",
  paused: false,
  light: "needs_jorge",
  light_reason: { text: "Una entrega espera tu visto bueno.", action: { label: "Ver en Te toca", href: "#te-toca" } },
  goal: null,
  rumbo: { goal_id: "g", goal: "Vender sesiones", why: "", target_on: "2026-12-05", forecast_on: "2026-12-05", weeks_behind: 0, missing: false },
  team: [],
  plan: null,
  route: { legs: [{ key: "LUM-I1", title: "Arranque", done: 1, total: 4, state: "here", note: null, steps: [] }], more_legs: 0 },
  this_week: { done: 0, docs: 0, prs: 0, last_at: null },
  orders: [],
  ready: [],
  next_move: { verbo: "ver", texto: "Una entrega espera tu visto bueno.", accion: { kind: "link", href: "#te-toca", label: "Ver en Te toca" }, origen: { kind: "light" } },
  ...patch,
});

test("I47-7: an in-page link move is a button that calls onLink; without onLink it stays a link", () => {
  const p = project();
  const calls: string[] = [];
  const el = now.ActButton({ project: p, action: p.next_move.accion, move: true, where: "ahora", ctx: { acts: { onLink: (s: string, href: string) => calls.push(`${s} ${href}`) } } });
  assert.equal(el.type, "button");
  el.props.onClick();
  assert.deepEqual(calls, ["lumen #te-toca"]);
  assert.equal(now.ActButton({ project: p, action: p.next_move.accion, move: true, where: "ahora", ctx: {} }).type, "a");
  const page = readFileSync(new URL("../ui/src/pages/ceo.tsx", import.meta.url), "utf8");
  assert.ok(page.includes('onLink: (slug: string, href: string) => (href === "#publicar" ? openPublish(slug) : setZoom(true, slug))'));
});

test("I47-7: the sky line ends with one period", () => {
  const p = project({ next_move: { verbo: "ver", texto: "Una entrega espera tu visto bueno.", accion: { kind: "publish", label: "Publicar" }, origen: { kind: "light" } } });
  assert.equal(lib.skyLine([p], [], "x"), "Te toca: Una entrega espera tu visto bueno.");
  const q = project({ next_move: { verbo: "aceptar", texto: "Aceptar «Acceso»", accion: { kind: "publish", label: "Publicar" }, origen: { kind: "light" } } });
  assert.equal(lib.skyLine([q], [], "x"), "Te toca: Aceptar «Acceso».");
});

test("I47-7: the header shows no count the route already shows; Ojo leaves the owner's move to Ahora", () => {
  const line = { state: "you", word: "Te toca" };
  const withRoute = html(h(head.Head, { project: project({ light: "ok", light_reason: null }), line }));
  assert.equal(withRoute.includes("data-status"), false);
  const noRoute = html(h(head.Head, { project: project({ light: "ok", light_reason: null, route: null, plan: { initiative: { key: "LUM-I1", title: "x" }, done: 1, total: 4 } }), line }));
  assert.ok(noRoute.includes("data-status"));
  const res = html(h(ficha.Ficha, { project: project(), fref: { kind: "tab", tab: "resumen" }, rows: { status: "idle" }, task: { status: "idle" }, doc: { status: "idle" }, slots: {}, now: NOW, onRef: () => {}, onClose: () => {} }));
  assert.equal(res.includes("Una entrega espera tu visto bueno"), false, "Ojo does not repeat Ahora");
  const failed = html(h(ficha.Ficha, { project: project({ light: "failed", light_reason: { text: "La última corrida falló.", action: null } }), fref: { kind: "tab", tab: "resumen" }, rows: { status: "idle" }, task: { status: "idle" }, doc: { status: "idle" }, slots: {}, now: NOW, onRef: () => {}, onClose: () => {} }));
  assert.ok(failed.includes("La última corrida falló."), "a problem still shows in Ojo");
});

test("I47-7: the Edificio's pill has the floor's tone; the evidence card survives a review without notes", () => {
  const out = renderToStaticMarkup(h(facade.Facade, { projects: [project({ next_move: null, light: "ok", light_reason: null })], decisions: [], now: NOW, ctx: {} }));
  assert.match(out, /class="edi-pill" data-pill="[a-z]+" data-tone="[a-z]+"><i aria-hidden="true"><\/i>/);
  const d = { id: "m-1", kind: "pr", actions: ["fusionar"], state: null, evidence: null, links: [], checks: null };
  const read = { tests: { total: 0, pass: 0, verdict: "none", items: [] }, review: { verdict: "fail" }, checklist: [], stills: [], marks: [], status: "pass" };
  assert.doesNotThrow(() => ev.evidenceView(read, d), "a review without notes is an empty line, not a crash");
  assert.equal(ev.evidenceView(read, d).review.sub, "");
});

test("I47-7: dim text passes AA and Ahora gets its height back", () => {
  const css = readFileSync(new URL("../ui/src/index.css", import.meta.url), "utf8");
  assert.match(css, /\.edi-fi-tab small, \.edi-fi-li em, \.edi-fi-tube li, \.edi-fi-empty \{ color: #959cb8; \}/);
  assert.match(css, /grid-template-areas: "voice meta" "by by"/, "the sky is one row");
  assert.match(css, /\.edi-team \{ grid-template-columns: repeat\(var\(--n\), minmax\(0, 1fr\)\) var\(--add, 0px\);/, "a narrow track for «+»");
  const r = readFileSync(new URL("../ui/src/components/compania/edificio/resguardo.tsx", import.meta.url), "utf8");
  assert.ok(r.includes("getDerivedStateFromError") && r.includes("Reintentar"));
  const page = readFileSync(new URL("../ui/src/pages/ceo.tsx", import.meta.url), "utf8");
  assert.ok(page.includes('<Resguardo what="el edificio">') && page.includes('<Resguardo what="la ficha">'));
});
