// PLA-I46-7/8: la Ventana a la app on the floor. The state it draws from a captures read (lib/ventana.ts), the
// markup of each state (con captura, en vivo, vacío, cargando, error, apagada), its place beside Ahora on the
// Mianovia floor, and the CSS that stacks it under Ahora's text at 390. react-dom/server and fake data; fake names.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { nextMove } from "../src/api/company-move.js";

(globalThis as { React?: unknown }).React = React;
const load = async (p: string) => (await import(new URL(`../ui/src/${p}`, import.meta.url).href)) as Record<string, any>;
const lib = await load("lib/ventana.ts");



type Json = Record<string, any>;
const h = React.createElement;
const html = (el: React.ReactElement) => renderToStaticMarkup(h(MemoryRouter, null, el));
const text = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const TZ = "America/Mexico_City";
const AT = "2026-11-14T02:14:00Z"; // 8:14 pm in Mexico City

const still = (page: string, vp: "desktop" | "phone", at = AT): Json => ({
  id: `${page}-${vp}`,
  image_url: `/api/projects/mianovia/captures/${page}-${vp}.png`,
  width: vp === "desktop" ? 1280 : 390,
  height: vp === "desktop" ? 800 : 844,
  url: `http://localhost:3000/${page}`,
  commit: "4c4d49f",
  branch: "sandbox",
  task_key: null,
  taken_at: at,
});
const page = (key: string, label: string, shots: Json = {}): Json => ({
  key,
  label,
  path: `/${key}`,
  session: key !== "formulario",
  desktop: { still: null, error: null, ...shots.desktop },
  phone: { still: null, error: null, ...shots.phone },
});
const full = (key: string, label: string) => page(key, label, { desktop: { still: still(key, "desktop") }, phone: { still: still(key, "phone") } });
const prueba = (phase: string, patch: Json = {}): Json => ({ phase, managed: false, port: null, url: null, started_at: null, error: null, detail: null, ...patch });
const read = (pages: Json[], pr: Json = prueba("running", { port: 3000, url: "http://localhost:3000" })): Json => ({
  project: "mianovia",
  configured: true,
  start: { command: "npm run dev -- --port {port}", port: 3000, url: "http://localhost:3000" },
  viewports: { desktop: { width: 1280, height: 800 }, phone: { width: 390, height: 844 } },
  pages,
  last_ok_at: AT,
  last_run_at: AT,
  prueba: pr,
});
const PAGES = () => [full("formulario", "Formulario de bienvenida"), full("panel", "Panel del equipo"), page("ficha", "Ficha de la novia")];
const view = (r: Json | undefined, o: Json = {}) => lib.ventanaView(r, { timeZone: TZ, ...o });














test("the floor reads the Ventana fast while it moves, slowly while on (that keeps it on), never while off", () => {
  assert.equal(lib.ventanaPoll(read([], prueba("starting"))), 1500);
  assert.equal(lib.ventanaPoll(read([], prueba("capturing"))), 1500);
  assert.equal(lib.ventanaPoll(read([], prueba("live"))), 60_000);
  assert.equal(lib.ventanaPoll(read([], prueba("off"))), false);
});

// ---- On the Mianovia floor

const member = (role: string): Json => ({ agent: `${role}-mia`, role, template: role, state: "idle", now: null, last: null, produced: null, waiting: null, queue: [], next_start: null });
const project = (): Json => ({
  slug: "mianovia",
  title: "Mianovia",
  paused: false,
  light: "ok",
  light_reason: null,
  goal: "Registro listo para la boutique",
  rumbo: { goal_id: "g", goal: "Registro listo para la boutique", why: "", target_on: null, forecast_on: null, weeks_behind: null, missing: true },
  usage: { used: 0, last_week: 0 },
  team: ["product-owner", "taller"].map(member),
  thread: { id: "t", unread: 0, last: null },
  plan: null,
  route: { legs: [{ key: "MIA-I5", title: "Ajustes finales y entrega", done: 0, total: 0, state: "unplanned", note: null }], more_legs: 0 },
  latest: [],
  stale_requests: [],
  this_week: { done: 0, docs: 0, prs: 0, last_at: null },
  next: null,
  ready: [],
  work: { open: 0, in_progress: 0 },
  orders: [],
});





