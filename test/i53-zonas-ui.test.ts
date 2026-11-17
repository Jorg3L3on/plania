// PLA-I53-6 #2: the zone tag on the board's card and in La ficha (nothing for a ticket without areas), the folded
// line of completed initiatives under the floor's board, and the newest landed loose title on the Sueltos stack.
// Server-rendered; no browser, no database. Fake names only. The browser pass is in the ticket's evidence.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";

(globalThis as { React?: unknown }).React = React;
const load = async (p: string) => (await import(new URL(`../ui/src/${p}`, import.meta.url).href)) as Record<string, any>;
const board = await load("components/plan/stage-board.tsx");



type Json = Record<string, any>;
const h = React.createElement;
const NOW = new Date("2026-11-15T20:00:00Z").getTime();
const TZ = "America/Mexico_City";
const noop = () => {};
const text = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const etapa = (id: string, patch: Json = {}): Json => ({ etapa: id, qa: null, holder: null, live: false, since: "2026-11-15T19:00:00Z", ci: null, reason: null, ...patch });
const tk = (key: string, title: string, e: Json, zonas: string[] | undefined, parent: string | null = null): Json => ({ key, title, status: "x", phase: null, parent_key: parent, etapa: e, ...(zonas ? { zonas } : {}) });

const tablero = (patch: Json = {}): Json => ({
  initiatives: [
    {
      key: "DEM-I2",
      title: "Agenda",
      status: "Active",
      done: 0,
      total: 3,
      tickets: [
        tk("DEM-I2-1", "Con pantalla y servidor", etapa("lista"), ["pantalla", "servidor"], "DEM-I2"),
        tk("DEM-I2-2", "Sin áreas", etapa("lista"), [], "DEM-I2"),
        tk("DEM-I2-3", "Lectura vieja", etapa("en_revision"), undefined, "DEM-I2"),
      ],
    },
  ],
  loose: [tk("DEM-81", "Suelto de datos", etapa("lista"), ["datos"])],
  loose_done: 4,
  loose_done_title: "Último suelto hecho",
  done_initiatives: [
    { key: "DEM-I1", title: "Alta", done_at: "2026-11-10T10:00:00Z" },
    ...["DEM-I0", "DEM-H9", "DEM-H8", "DEM-H7", "DEM-H6"].map((key, i) => ({ key, title: `Vieja ${i}`, done_at: "2026-10-01T10:00:00Z" })),
  ],
  ...patch,
});
const cardOf = (html: string, key: string) => html.slice(html.indexOf(`data-card="${key}"`)).split('class="sb-card"')[0]!;

test("I53-6 #2: the card shows the zone tags of a ticket with areas, and nothing for one without", () => {
  const html = renderToStaticMarkup(h(board.StageBoard, { tablero: tablero(), now: NOW }));
  const mixed = cardOf(html, "DEM-I2-1");
  assert.match(mixed, /data-zonas="pantalla servidor"/);
  assert.ok(text(mixed).includes("Pantalla") && text(mixed).includes("Servidor"));
  assert.match(cardOf(html, "DEM-81"), /data-zona="datos"[^>]*>Datos</);
  for (const k of ["DEM-I2-2", "DEM-I2-3"]) assert.equal(cardOf(html, k).includes("data-zona"), false, k);
});

test("I53-6: the Sueltos Hecho stack shows the newest landed loose title; folded shows four and the rest behind «+ n más»", () => {
  const html = renderToStaticMarkup(h(board.StageBoard, { tablero: tablero(), now: NOW, folded: tablero().done_initiatives, onFolded: noop }));
  const sueltos = html.slice(html.indexOf('data-row="sueltos"'));
  assert.match(sueltos, /✓ 4 hechos<\/b><span>Último suelto hecho<\/span>/);
  assert.match(html, /data-folded="6"/);
  const line = html.slice(html.indexOf("data-folded"));
  const before = line.split("sb-folded-more")[0]!;
  assert.equal([...before.matchAll(/data-control="tablero-completa"/g)].length, 4);
  assert.match(line, /<summary data-control="tablero-completas-mas">\+ 2 más<\/summary>/);
  // An old read without the title keeps the count alone.
  const old = renderToStaticMarkup(h(board.StageBoard, { tablero: tablero({ loose_done_title: undefined }), now: NOW }));
  assert.match(old.slice(old.indexOf('data-row="sueltos"')), /✓ 4 hechos<\/b><\/button>/);
});

const project = (patch: Json = {}): Json => ({
  slug: "demo",
  title: "Demo",
  paused: false,
  light: "ok",
  goal: "Tienda lista",
  team: [{ agent: "taller-demo", role: "taller", state: "idle", now: null, queue: [] }],
  thread: { id: "t", unread: 0, last: null },
  plan: null,
  this_week: { done: 0, docs: 0, prs: 0, last_at: null },
  next: null,
  work: { open: 0, in_progress: 0 },
  usage: { tokens: 0 },
  route: { legs: [{ key: "DEM-I2", title: "Agenda", done: 0, total: 3, state: "here", note: null }], more_legs: 0 },
  orders: [],
  latest: [],
  stale_requests: [],
  tablero: tablero(),
  ahora: [],
  ...patch,
});




