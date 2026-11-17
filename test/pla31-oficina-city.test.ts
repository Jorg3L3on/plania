// PLA-31: Oficina (?edificio) shows the city in place of Brief de hoy and the one-row-per-project facade. Server-rendered
// with fake data; no browser, no database.
//   #1  Building on Oficina with a city: no sky strip, no Brief de hoy, no rows; Tu oficina on top, then the city
//   #2  zoomed in (a floor), the sky strip and the floor are as before and the city is not drawn
//   #3  CiudadOficina: the header holds the greeting, headline, voice and links; the legend is hidden until the «i»;
//       one district per floor, an empty lot keeps its plate; the paused floors render under the street
//   #4  the page wires it: the city only on Oficina, Asistente in the app bar's slot there
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";

(globalThis as { React?: unknown }).React = React;
const load = async (p: string) => (await import(new URL(`../ui/src/${p}`, import.meta.url).href)) as Record<string, any>;

const ciudad = await load("components/home/ciudad.tsx");

type Json = Record<string, any>;
const h = React.createElement;
const NOW = new Date("2026-11-10T18:00:00Z").getTime();
const TZ = "America/Mexico_City";
const member = (slug: string, role: string): Json => ({ agent: `${role}-${slug}`, role, template: role, state: "idle", now: null, last: null, produced: null, waiting: null, queue: [] });
const project = (slug: string, title: string, patch: Json = {}): Json => ({
  slug,
  title,
  paused: false,
  light: "ok",
  light_reason: null,
  goal: null,
  rumbo: { goal_id: "g", goal: `Meta de ${title}`, why: "", target_on: "2026-12-05", forecast_on: "2026-12-05", weeks_behind: 0, missing: false },
  usage: { used: 0 },
  team: ["product-owner", "taller"].map((r) => member(slug, r)),
  thread: { id: `t-${slug}`, unread: 0, last: null },
  plan: null,
  route: { legs: [{ key: `${slug.toUpperCase()}-I1`, title: "Arranque", done: 1, total: 3, state: "here", note: null, steps: [] }], more_legs: 0 },
  this_week: { done: 0, docs: 0, prs: 0, last_at: null },
  next: null,
  ready: [],
  work: { open: 0, in_progress: 0 },
  orders: [],
  next_move: null,
  ...patch,
});
const projects = [project("alba", "Alba"), project("cauce", "Cauce"), project("eco", "Eco", { paused: true, light: "paused" })];
const company = { company: { paused: false }, week: { starts_at: "2026-11-09T06:00:00Z", resets_at: "2026-11-16T06:00:00Z", timezone: TZ }, asistente: { thread_id: "t", usage: { used: 0 }, last_run: { status: "ok", summary: "ok: success, 7 turns" }, state: "idle", unread: 0 }, projects, plumbing: { spend: 0, running: 0, paused: false }, decisions: [], inbox: { decisiones: 0, pasos: 0 } };






test("PLA-31 #3: CiudadOficina: header, legend behind the «i», a plate per district, the basement under the street", () => {
  const tower = { slug: "alba", key: "ALBA-I1", title: "Arranque", stage: "building", columns: 2, windows: ["lit", "now", "dark"], agents: [{ key: "ALBA-I1-1", title: "x", agent: "taller", model: null }], waits: false, awaitsGo: false, working: true, closed: 1, total: 3, inbox: [] };
  const districts = [
    { slug: "alba", title: "Alba", towers: [tower] },
    { slug: "cauce", title: "Cauce", towers: [] },
  ];
  const out = renderToStaticMarkup(
    h(MemoryRouter, null,
      h(ciudad.CiudadOficina, {
        districts,
        pre: "Buenas noches, Jorge · Sábado, 14 de noviembre · 20:06",
        headline: { title: "Un agente trabaja ahora.", voice: [{ text: "Plania avanza sola." }] },
        links: h("a", { href: "/machine", "data-plumbing": "" }, "Plomería · nada corre"),
        plateFor: (d: Json) => h("button", { type: "button", "data-plate": d.slug }, d.title),
        under: h("div", { className: "city-under", "data-fa-under": 1 }, "Bajo la calle · en pausa"),
      }),
    ),
  );
  for (const s of ["Buenas noches, Jorge", "Un agente trabaja ahora.", "Plania avanza sola.", "data-plumbing", "1 agente"]) assert.ok(out.includes(s), s);
  assert.match(out, /<div id="city-legend" class="city-legend" hidden="">/, "legend hidden on load");
  assert.match(out, /aria-expanded="false"[^>]*aria-controls="city-legend"/);
  assert.deepEqual([...out.matchAll(/data-plate="([a-z]+)"/g)].map((m) => m[1]), ["alba", "cauce"], "an empty lot keeps its plate");
  assert.ok(out.indexOf("data-plate=\"cauce\"") < out.indexOf("data-fa-under"), "the basement under the street");
});


