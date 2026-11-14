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
const ui = await load("components/compania/edificio/ventana.tsx");
const building = await load("components/compania/edificio/building.tsx");

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
const draw = (v: Json) => html(h(ui.Ventana, { view: v, title: "Mianovia", onAct: () => {}, onApagar: () => {}, onPage: () => {} }));

test("con captura: desktop and phone stills of the first page, the capture time and Abrir ↗", () => {
  const v = view(read(PAGES()));
  assert.equal(v.state, "captura");
  assert.equal(v.page.key, "formulario");
  assert.deepEqual(v.pages.map((p: Json) => p.key), ["formulario", "panel"], "a page with nothing to show gets no chip");
  assert.equal(v.caption, "Copia de prueba · captura de las 8:14 pm");
  const m = draw(v);
  assert.match(m, /data-ventana="captura"/);
  assert.match(m, /<img class="edi-vshot" src="\/api\/projects\/mianovia\/captures\/formulario-desktop\.png" width="1280" height="800" alt="Formulario de bienvenida de Mianovia, escritorio"/);
  assert.match(m, /<img class="edi-vshot edi-vph" src="\/api\/projects\/mianovia\/captures\/formulario-phone\.png" width="390" height="844"/);
  assert.match(m, /<a class="edi-vopen" href="http:\/\/localhost:3000" target="_blank" rel="noreferrer"[^>]*>Abrir ↗<\/a>/);
  assert.match(text(m), /Ventana a la app .*Formulario de bienvenida Panel del equipo/);
  assert.doesNotMatch(m, /data-v="/, "not grey");
  // Picking the panel shows its stills.
  const panel = view(read(PAGES()), { page: "panel" });
  assert.equal(panel.desktop.id, "panel-desktop");
  assert.match(draw(panel), /aria-pressed="true" data-page="panel"/);
});

test("vacío: «Todavía no hay nada que ver», with Encenderla when the copy is off", () => {
  const off = view(read([page("formulario", "Formulario de bienvenida")], prueba("off")));
  assert.equal(off.state, "vacio");
  const m = draw(off);
  assert.match(text(m), /Todavía no hay nada que ver Encenderla Aparece con la primera entrega\./);
  assert.doesNotMatch(m, /<img/);
  assert.doesNotMatch(m, /Abrir ↗/);
  const on = view(read([page("formulario", "Formulario de bienvenida")]));
  assert.equal(on.state, "vacio");
  assert.deepEqual(on.button, { act: "tomar", label: "Tomar la captura" });
});

test("cargando: skeletons and «Tomando la captura…»; while starting, «Encendiendo…»", () => {
  const first = view(undefined, { pending: true });
  assert.equal(first.state, "cargando");
  const cap = view(read(PAGES(), prueba("capturing", { managed: true, port: 3001, url: "http://localhost:3001" })));
  assert.equal(cap.state, "cargando");
  assert.equal(cap.caption, "Tomando la captura…");
  const m = draw(cap);
  assert.match(m, /data-ventana="cargando"[^>]*aria-busy="true"/);
  assert.equal((m.match(/edi-vskel/g) ?? []).length, 2);
  assert.match(m, /data-skeleton/);
  assert.doesNotMatch(m, /<img/);
  assert.equal(view(read(PAGES(), prueba("starting", { managed: true }))).caption, "Encendiendo la copia de prueba…");
});

test("error: the last good capture in grey, Reintentar and Ver detalle with what failed", () => {
  const pages = PAGES();
  pages[0]!.desktop.error = { message: "/formulario respondió 500", commit: "4c4d49f", task_key: null, taken_at: "2026-11-14T02:30:00Z" };
  const v = view(read(pages));
  assert.equal(v.state, "error");
  assert.deepEqual(v.button, { act: "tomar", label: "Reintentar" });
  assert.equal(v.caption, "Se ve la última captura buena, de las 8:14 pm.");
  assert.equal(v.detail, "/formulario respondió 500");
  const m = draw(v);
  assert.match(m, /<div class="edi-vframe" data-v="error">/);
  assert.match(text(m), /No se pudo tomar la captura Reintentar Ver detalle/);
  assert.match(m, /<img class="edi-vshot"/, "the last good still stays under the grey");
  // No good still at all: the line and the button without a picture.
  const none = view(read([page("formulario", "Formulario", { desktop: { error: { message: "no responde", commit: null, task_key: null, taken_at: AT } } })]));
  assert.equal(none.state, "error");
  assert.match(draw(none), /class="edi-vempty" data-v="error"/);
  // The floor could not read the Ventana at all.
  const down = view(undefined, { failed: true });
  assert.equal(down.state, "error");
  assert.deepEqual(down.button, { act: "leer", label: "Reintentar" });
});

test("apagada: the last capture in grey, «Encenderla» and «Nada arranca sin tu clic»", () => {
  const v = view(read(PAGES(), prueba("off")));
  assert.equal(v.state, "apagada");
  assert.deepEqual(v.button, { act: "encender", label: "Encenderla" });
  assert.equal(v.caption, "Última captura: 8:14 pm. Nada arranca sin tu clic.");
  assert.equal(v.open, null);
  const m = draw(v);
  assert.match(m, /data-v="apagada"/);
  assert.match(text(m), /La copia de prueba está apagada Encenderla/);
  assert.match(m, /class="edi-btn edi-btn-primary"[^>]*data-control="ventana-encender"/);
  assert.doesNotMatch(m, /Abrir ↗/);
});

test("Encenderla: Cargando, then «En vivo en tu Mac» with Abrir ↗ and Apagar; a failed start is Error with Reintentar", () => {
  const live = view(read(PAGES(), prueba("live", { managed: true, port: 3001, url: "http://localhost:3001" })));
  assert.equal(live.state, "vivo");
  const m = draw(live);
  assert.match(m, /<span class="edi-vlive">En vivo en tu Mac<\/span>/);
  assert.match(m, /href="http:\/\/localhost:3001"/);
  assert.match(m, /data-control="ventana-apagar"/);
  const failed = view(read(PAGES(), prueba("failed", { managed: true, error: "La copia de prueba se cerró al arrancar (código 1)", detail: "Error: falta DATABASE_URL" })));
  assert.equal(failed.state, "error");
  assert.deepEqual(failed.button, { act: "encender", label: "Reintentar" });
  assert.equal(failed.detail, "La copia de prueba se cerró al arrancar (código 1)\nError: falta DATABASE_URL");
  assert.match(text(draw(failed)), /No se pudo encender Reintentar Ver detalle/);
  // Busy: the clicked button shows … and the others wait.
  const busy = html(h(ui.Ventana, { view: view(read(PAGES(), prueba("off"))), title: "Mianovia", busy: "encender", onAct: () => {} }));
  assert.match(busy, /disabled="" data-control="ventana-encender">…<\/button>/);
});

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
const floor = (ventanaFor?: (p: Json) => React.ReactNode) => {
  const p = project();
  const c = {
    company: { paused: false },
    week: { starts_at: "2026-11-09T06:00:00Z", resets_at: "2026-11-16T06:00:00Z", timezone: TZ },
    asistente: { thread_id: "t-co", usage: { used: 0 }, last_run: null, state: "idle", unread: 0 },
    projects: [{ ...p, next_move: nextMove(p as never, [] as never) }],
    plumbing: { spend: 0, running: 0, paused: false },
    decisions: [],
    inbox: { decisiones: 0, pasos: 0 },
  };
  return html(h(building.Building, { company: c, decisions: [], now: Date.parse(AT), timeZone: TZ, hello: "Hola", day: "Viernes", onNew: () => {}, acts: { now: 0, busy: null, onAct: () => {} }, nowActs: { onPlan: () => {} }, ventanaFor }));
};

test("the Mianovia floor shows the desktop and phone stills inside Ahora, beside its text", () => {
  const m = floor(() => h(ui.Ventana, { view: view(read(PAGES())), title: "Mianovia", onAct: () => {} }));
  const nowb = /<div class="edi-nowb"[^>]*data-side="1"[^>]*>([\s\S]*?)<\/section>/.exec(m);
  assert.ok(nowb, "Ahora carries the Ventana as its side");
  assert.ok(nowb[1]!.indexOf("edi-ntext") < nowb[1]!.indexOf("edi-vent"), "text first, then the Ventana");
  assert.match(nowb[1]!, /formulario-desktop\.png/);
  assert.match(nowb[1]!, /formulario-phone\.png/);
  // Without a Ventana (a floor with no capture settings) Ahora is as before.
  assert.doesNotMatch(floor(), /data-side|edi-vent/);
});

test("CSS: side by side on desktop, stacked under Ahora's text at 390, nothing wider than its column, the shimmer stops with reduced motion", () => {
  const css = readFileSync(new URL("../ui/src/index.css", import.meta.url), "utf8");
  assert.match(css, /\.edi-nowb\[data-side\] \{ grid-template-columns: minmax\(0, 1fr\) minmax\(0, 0\.9fr\);/);
  const phone = css.slice(css.indexOf("@media (width < 40rem) {\n    .edi-pbar"));
  assert.match(phone.slice(0, phone.indexOf("\n  }\n")), /\.edi-nowb\[data-side\] \{ grid-template-columns: minmax\(0, 1fr\); \}/);
  // Every Ventana box can shrink: min-width 0 on the grid parts, images at 100% of their track, no fixed widths.
  const rules = [...css.matchAll(/^\s*(\.edi-v[^{]*)\{([^}]*)\}/gm)];
  assert.ok(rules.length > 10);
  for (const [, sel, body] of rules) assert.doesNotMatch(body!, /(?<!max-|min-)width:\s*\d{3,}px/, `${sel} has a fixed width`);
  assert.match(css, /\.edi-vent \{[^}]*min-width: 0/);
  assert.match(css, /\.edi-vframe \{[^}]*grid-template-columns: minmax\(0, 1fr\) 24%[^}]*min-width: 0/);
  assert.match(css, /\.edi-vshot \{[^}]*width: 100%/);
  // The shimmer lives after the floor's static rules: on the floor only Ahora breathes.
  const mark = css.indexOf("@keyframes edi-twinkle");
  assert.ok(css.indexOf(".edi-vframe[data-skeleton] .edi-vskel { animation: edi-shim") > mark);
  assert.match(css, /\.edi \*, \.edi \*::before, \.edi \*::after \{ animation: none !important;/);
});
