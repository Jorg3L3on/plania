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
  light: "needs_owner",
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



test("I47-7: the sky line ends with one period", () => {
  const p = project({ next_move: { verbo: "ver", texto: "Una entrega espera tu visto bueno.", accion: { kind: "publish", label: "Publicar" }, origen: { kind: "light" } } });
  assert.equal(lib.skyLine([p], [], "x"), "Te toca: Una entrega espera tu visto bueno.");
  const q = project({ next_move: { verbo: "aceptar", texto: "Aceptar «Acceso»", accion: { kind: "publish", label: "Publicar" }, origen: { kind: "light" } } });
  assert.equal(lib.skyLine([q], [], "x"), "Te toca: Aceptar «Acceso».");
});







test("I61-6: with nothing to do, the sky says something waits to be looked at; Te toca still comes first", () => {
  const look = project({ next_move: null, pedidos: [{ key: "LUM-IDEA1", title: "x", stop: "plan", state: "quieta", who: "product-owner", guardada: false, unseen: 1, unseen_stop: "diseno" }] });
  assert.equal(lib.skyLine([look], [], "Lumen avanza"), `Lumen avanza. Te espera algo para mirar en ${look.title}.`);
  const none = project({ next_move: null, pedidos: [] });
  assert.equal(lib.skyLine([none], [], "Lumen avanza"), "Lumen avanza. Nada te espera.");
  const both = project({ pedidos: look.pedidos, next_move: { verbo: "ver", texto: "Una entrega espera tu visto bueno.", accion: { kind: "publish", label: "Publicar" }, origen: { kind: "light" } } });
  assert.equal(lib.skyLine([both], [], "x"), "Te toca: Una entrega espera tu visto bueno.");
});
