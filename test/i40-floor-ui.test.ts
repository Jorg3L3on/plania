// PLA-I40-4..6: the floor that explains itself, rendered with fake data. Server-rendered with react-dom/server;
// no browser, no database. Fake names and numbers.
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
const NOW = new Date("2026-11-13T20:44:00Z").getTime();
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



// ---- PLA-I40-4

const ficha = "Ficha de la novia y notas internas";
const resting = (patch: Json = {}) =>
  project({
    team: [member("product-owner"), member("research"), member("artist"), member("taller", { queue: [{ key: "WRK-9", title: ficha }], next_start: { key: "WRK-9", title: ficha, hold: "rest", starts_at: "2026-11-13T20:52:00Z", text: "Descansa entre un trabajo y otro.", ...patch } })],
  });
const delivery = (patch: Json = {}) =>
  decision({ id: "pr-1", kind: "pr", title: "Listado de novias con búsqueda y filtros", options: null, actions: ["aceptar", "cambios"], asker: { agent: "taller-workia", role: "taller" }, ...patch });
// PLA-I46-3: the floor's move comes from the server (src/api/company-move.ts); the helpers attach it as companyRead does.
const moved = (p: Json, ds: Json[] = [], opts: Json = {}): Json => ("next_move" in p ? p : { ...p, next_move: nextMove(p as never, ds as never, opts) });
const line = (p: Json, ds: Json[] = [], opts: Json = {}) => lib.nowLine(moved(p, ds, opts), ds, NOW, { timeZone: TZ, ...opts });


test("I40-4 #1: the sentence for a teammate resting says who starts what and at what time", () => {
  const l = line(resting());
  assert.equal(l.say, "Taller arranca «Ficha de la novia y notas internas» a las 2:52 pm.");
  assert.deepEqual([l.state, l.word, l.holder, l.starts_at], ["rest", "Pausa corta", "taller-workia", "2026-11-13T20:52:00Z"]);
  assert.deepEqual(l.action, { kind: "start", agent: "taller-workia", pastGuard: false, label: "Que empiece ya" });
  assert.match(l.why, /Descansa entre un trabajo y otro\. No tienes que hacer nada\./);
  assert.equal(lib.countdown("2026-11-13T20:52:00Z", NOW), "8:00");
  assert.equal(lib.countdown("2026-11-13T20:52:00Z", NOW + 9 * 60_000), "0:00", "never negative");
});

test("I40-4 #1: one sentence per state: working, soon, stuck, your turn, plan finished, paused, idle", () => {
  const working = line(project({ team: [member("taller", { state: "running", now: { ticket: "WRK-9", title: ficha, since: "2026-11-13T20:41:00Z" } })] }));
  assert.deepEqual([working.state, working.say, working.why, working.holder, working.action], ["work", `Taller construye «${ficha}».`, "Trabaja desde hace 3 min.", "taller-workia", null]);

  const soon = line(resting({ hold: "soon", starts_at: null, text: "Arranca en un momento." }));
  assert.deepEqual([soon.state, soon.say, soon.action], ["rest", `Taller arranca «${ficha}» en un momento.`, null]);

  const usage = line(resting({ hold: "usage", starts_at: "2026-11-13T23:10:00Z", text: "El uso de Claude va en 77 % y el tope es 70 %." }));
  assert.deepEqual([usage.state, usage.word, usage.say], ["stuck", "Atorado", `Taller no arrancó «${ficha}».`]);
  assert.equal(usage.why, "El uso de Claude va en 77 % y el tope es 70 %. Vuelve a intentarlo solo a las 5:10 pm.");
  assert.deepEqual(usage.action, { kind: "start", agent: "taller-workia", pastGuard: true, label: "Seguir de todos modos" });

  // PLA-I46-3: a hold that needs the owner is the floor's move: Te toca, with the move's texto.
  const nobody = line(resting({ hold: "unqueued", starts_at: null, text: "Nadie lo ha despertado todavía." }));
  assert.deepEqual([nobody.state, nobody.say, nobody.action.kind, nobody.action.label], ["you", `Arrancar «${ficha}»`, "start", "Que empiece ya"]);
  const goal = line(resting({ hold: "no_goal", starts_at: null, text: "Falta fijar la meta del proyecto." }));
  assert.deepEqual([goal.state, goal.holder, goal.action.kind, goal.say], ["you", "owner", "fijar", "Fijar la meta del proyecto"]);
  assert.equal(line(resting({ hold: "slot", starts_at: null, text: "Espera un lugar: ya hay otros trabajando." })).action, null);
  assert.equal(line(resting({ hold: "waiting_owner", starts_at: null, text: "Espera que aceptes la entrega anterior." })).holder, "owner");

  const mine = line(resting(), [delivery()]);
  assert.deepEqual([mine.state, mine.word, mine.holder], ["you", "Te toca", "owner"], "a delivery comes before the next start");
  assert.equal(mine.say, "Aprobar «Listado de novias con búsqueda y filtros»");
  // PLA-93: the floor opens the delivery's card; Aceptar lives only there.
  assert.deepEqual(mine.action, { kind: "reveal", id: "pr-1", label: "Ver la entrega" });
  assert.equal(line(project(), [delivery({ hold: "Las pruebas siguen corriendo." })]).action.kind, "reveal", "a held delivery is not one click");
  const asked = line(project(), [decision()]);
  assert.deepEqual([asked.say, asked.action.kind], ["Responder a Research: «¿Qué tienda abrimos primero?»", "reveal"]);
  const release = line(project(), [decision({ id: "release:workia", kind: "release", actions: [], asker: null, release: { tickets: [{}, {}] } })]);
  assert.deepEqual([release.say, release.action.kind], ["Publicar 2 cambios", "publish"]);

  const route = { legs: [{ key: "WRK-I1", title: "Panel administrativo", done: 4, total: 4, state: "here", note: null, steps: [] }, { key: "WRK-I2", title: "Contacto y avisos", done: 0, total: 0, state: "unplanned", note: null }], more_legs: 0 };
  const done = line(project({ route }));
  assert.deepEqual([done.state, done.say, done.action.kind, done.action.label], ["you", "Planear «Contacto y avisos»", "plan", "Que PO lo planee"]);
  assert.equal(done.why, "«Panel administrativo» está completo. El PO arma los pasos y tú los apruebas.");

  assert.deepEqual([line(project({ paused: true, light: "paused" })).state, line(project(), [], { companyPaused: true }).say], ["off", "La compañía está en pausa."]);
  assert.deepEqual([line(project()).state, line(project()).action], ["idle", null]);
  for (const l of [working, soon, usage, nobody, mine, asked, release, done]) clean(`${l.say} ${l.why}`);
});









// ---- PLA-I40-5

const step = (key: string, title: string, state: string, at: string | null = null): Json => ({ key, title, state, who: "taller", at });
const mianovia: Json = {
  legs: [
    { key: "WRK-I1", title: "Arranque y configuración", done: 4, total: 5, state: "planned", note: "Pospuesto: Hosting y dominio" },
    { key: "WRK-I2", title: "Formulario de bienvenida", done: 5, total: 5, state: "done", note: null },
    {
      key: "WRK-I3",
      title: "Panel administrativo",
      done: 2,
      total: 4,
      state: "here",
      note: null,
      steps: [
        step("WRK-7", "Acceso privado del equipo", "published", "2026-11-13T20:35:00Z"),
        step("WRK-8", "Listado de novias con búsqueda y filtros", "published", "2026-11-13T20:35:00Z"),
        step("WRK-9", ficha, "next"),
        step("WRK-10", "Revisión del panel y lista de supuestos", "later"),
      ],
    },
    { key: "WRK-I4", title: "Contacto, exportación y avisos", done: 0, total: 0, state: "unplanned", note: null },
    { key: "WRK-I5", title: "Ajustes finales y entrega", done: 0, total: 0, state: "unplanned", note: null },
  ],
  more_legs: 0,
};

// PLA-I53-3: the Entrega strip (the legs and the leg's steps) is gone from the floor; the stage board took its place



const answered = (patch: Json = {}) => delivery({ actions: [], state: { action: "aceptar", at: "2026-11-13T20:24:00Z", result: {} }, ...patch });
const full = (patch: Json = {}): Json => ({ ...resting(), route: mianovia, latest: [{ kind: "published", title: null, n: 6, at: "2026-11-13T20:35:00Z" }], stale_requests: [], ...patch });









function findButton(el: any): any {
  if (!el || typeof el !== "object") return null;
  if (el.type === "button") return el;
  // PLA-I46-3: the band's button is drawn by ActButton (no hooks): render it to reach the button.
  if (typeof el.type === "function") return findButton(el.type(el.props));
  const kids = el.props?.children;
  for (const k of Array.isArray(kids) ? kids.flat() : [kids]) {
    const found = findButton(k);
    if (found) return found;
  }
  return null;
}
