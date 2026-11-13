// PLA-I40-4..6: the floor that explains itself, rendered with fake data. Server-rendered with react-dom/server;
// no browser, no database. Fake names and numbers.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";

(globalThis as { React?: unknown }).React = React;
const load = async (p: string) => (await import(new URL(`../ui/src/${p}`, import.meta.url).href)) as Record<string, any>;
const building = await load("components/compania/edificio/building.tsx");
const win = await load("components/compania/edificio/window.tsx");
const roof = await load("components/compania/edificio/roof.tsx");
const scene = await load("components/compania/edificio/scene.tsx");
const lib = await load("lib/edificio.ts");
const await0 = await load("components/compania/edificio/question.tsx");
const nowc = await load("components/compania/edificio/now.tsx");
const floorc = await load("components/compania/edificio/floor.tsx");

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
const render = (c: Json, extra: Json = {}) =>
  html(h(building.Building, { company: c, decisions: c.decisions, now: NOW, timeZone: TZ, hello: "Buenas tardes", day: "Martes 10 de noviembre", onNew: noop, ...extra }));
const one = (m: Json, extra: Json = {}) => html(h(win.Window, { member: m, project: "Workia", now: NOW, ...extra }));

// ---- PLA-I40-4

const ficha = "Ficha de la novia y notas internas";
const resting = (patch: Json = {}) =>
  project({
    team: [member("product-owner"), member("research"), member("artist"), member("taller", { queue: [{ key: "WRK-9", title: ficha }], next_start: { key: "WRK-9", title: ficha, hold: "rest", starts_at: "2026-11-13T20:52:00Z", text: "Descansa entre un trabajo y otro.", ...patch } })],
  });
const delivery = (patch: Json = {}) =>
  decision({ id: "pr-1", kind: "pr", title: "Listado de novias con búsqueda y filtros", options: null, actions: ["aceptar", "cambios"], asker: { agent: "taller-workia", role: "taller" }, ...patch });
const line = (p: Json, ds: Json[] = [], opts: Json = {}) => lib.nowLine(p, ds, NOW, { timeZone: TZ, ...opts });
const floor = (p: Json, ds: Json[] = [], extra: Json = {}) =>
  html(h(floorc.Floor, { project: p, now: NOW, timeZone: TZ, decisions: ds, acts: { now: NOW, busy: null, onAct: noop }, nowActs: { onStart: noop, onPlan: noop }, ...extra }));

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

  const nobody = line(resting({ hold: "unqueued", starts_at: null, text: "Nadie lo ha despertado todavía." }));
  assert.deepEqual([nobody.state, nobody.action.kind, nobody.action.label], ["stuck", "start", "Que empiece ya"]);
  const goal = line(resting({ hold: "no_goal", starts_at: null, text: "Falta fijar la meta del proyecto." }));
  assert.deepEqual([goal.state, goal.holder, goal.action.kind], ["stuck", "owner", "fijar"]);
  assert.equal(line(resting({ hold: "slot", starts_at: null, text: "Espera un lugar: ya hay otros trabajando." })).action, null);
  assert.equal(line(resting({ hold: "waiting_owner", starts_at: null, text: "Espera que aceptes la entrega anterior." })).holder, "owner");

  const mine = line(resting(), [delivery()]);
  assert.deepEqual([mine.state, mine.word, mine.holder], ["you", "Te toca", "owner"], "a delivery comes before the next start");
  assert.equal(mine.say, "Taller te entrega «Listado de novias con búsqueda y filtros».");
  assert.deepEqual(mine.action, { kind: "decision", id: "pr-1", action: "aceptar", label: "Aceptar" });
  assert.equal(line(project(), [delivery({ hold: "Las pruebas siguen corriendo." })]).action.kind, "reveal", "a held delivery is not one click");
  const asked = line(project(), [decision()]);
  assert.deepEqual([asked.say, asked.action.kind], ["Research te pregunta: ¿Qué tienda abrimos primero?", "reveal"]);
  const release = line(project(), [decision({ id: "release:workia", kind: "release", actions: [], asker: null, release: { tickets: [{}, {}] } })]);
  assert.deepEqual([release.say, release.action.kind], ["2 cambios listos esperan que los publiques.", "publish"]);

  const route = { legs: [{ key: "WRK-I1", title: "Panel administrativo", done: 4, total: 4, state: "here", note: null, steps: [] }, { key: "WRK-I2", title: "Contacto y avisos", done: 0, total: 0, state: "unplanned", note: null }], more_legs: 0 };
  const done = line(project({ route }));
  assert.deepEqual([done.state, done.say, done.action.kind, done.action.label], ["done", "«Panel administrativo» está completo. Sigue planear «Contacto y avisos».", "plan", "Que PO lo planee"]);

  assert.deepEqual([line(project({ paused: true, light: "paused" })).state, line(project(), [], { companyPaused: true }).say], ["off", "La compañía está en pausa."]);
  assert.deepEqual([line(project()).state, line(project()).action], ["idle", null]);
  for (const l of [working, soon, usage, nobody, mine, asked, release, done]) clean(`${l.say} ${l.why}`);
});

test("I40-4 #2: with a pending delivery the mark is under Tú and the main action is its accept", () => {
  const s = floor(resting(), [delivery()]);
  assert.match(s, /data-now="you"/);
  assert.match(s, /<div class="edi-slot"[^>]*data-owner="true"[^>]*data-holding="1"/);
  assert.equal((s.match(/class="edi-mark"/g) ?? []).length, 1, "one mark on the floor");
  assert.match(s, /data-now-action="decision"[^>]*>Aceptar</);
  assert.match(s, /class="edi-win edi-you" data-state="you"/);
  // The button runs the delivery's own accept.
  const calls: Json[] = [];
  const el = nowc.Now({ project: resting(), line: line(resting(), [delivery()]), now: NOW, decisions: [delivery()], qacts: { now: NOW, busy: null, onAct: (d: Json, input: Json, key: string) => calls.push({ id: d.id, input, key }) } });
  findButton(el).props.onClick();
  assert.deepEqual(calls, [{ id: "pr-1", input: { action: "aceptar" }, key: "now-aceptar" }]);
  clean(s);
});

test("I40-4 #3: Que empiece ya calls the start of that teammate; once it runs the band says Trabajando", () => {
  const s = floor(resting());
  assert.match(s, /data-now="rest"/);
  assert.match(s, /<div class="edi-slot"[^>]*data-holding="1"[^>]*>\s*<span class="edi-mark"[^>]*><\/span>\s*<div class="edi-win"[^>]*data-agent="taller-workia"/);
  assert.match(s, /data-countdown="2026-11-13T20:52:00Z"/);
  assert.ok(text(s).includes("8:00") && text(s).includes("para arrancar"));
  assert.ok(text(s).includes("descansa · arranca 2:52 pm"), "the window's caption says why, not just not yet");
  assert.equal(text(s).includes("aún no empieza"), false);
  assert.match(s, /class="edi-win edi-you" data-state="idle"/);
  assert.ok(text(s).includes("Nada pendiente"));

  const calls: unknown[][] = [];
  const el = nowc.Now({ project: resting(), line: line(resting()), now: NOW, acts: { onStart: (...a: unknown[]) => calls.push(a) } });
  findButton(el).props.onClick();
  assert.deepEqual(calls, [["workia", "taller-workia", false]]);

  // The next read has the run live: the same floor now says it is working, with no countdown and no button.
  const after = floor(project({ team: [member("taller", { state: "running", now: { ticket: "WRK-9", title: ficha, since: "2026-11-13T20:44:00Z" } })] }));
  assert.match(after, /data-now="work"/);
  assert.ok(text(after).includes("Trabajando"));
  assert.equal(/data-countdown|data-now-action/.test(after), false);
  clean(after);
});

test("I40-4 #4: six windows across on a Mac and two on a phone; the band is one column on a phone", () => {
  const css = readFileSync(new URL("../ui/src/index.css", import.meta.url), "utf8");
  assert.ok(css.includes(".edi-wins { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr));"));
  assert.ok(css.includes(".edi-wins { grid-template-columns: repeat(2, minmax(0, 1fr));"));
  assert.ok(css.includes(".edi-nowb { grid-template-columns: minmax(0, 1fr); }"));
  assert.match(css, /\.edi-nsay \{[^}]*overflow-wrap: anywhere/);
  // A team of four, the owner and the "+" are six slots; the bubble's notch counts them.
  const { bubblePlace, WIDE_COLS } = await0;
  assert.equal(WIDE_COLS, 6);
  assert.equal(bubblePlace(3, 6)["--nx-wide"], `${(3.5 / 6) * 100}%`);
});

function findButton(el: any): any {
  if (!el || typeof el !== "object") return null;
  if (el.type === "button") return el;
  const kids = el.props?.children;
  for (const k of Array.isArray(kids) ? kids.flat() : [kids]) {
    const found = findButton(k);
    if (found) return found;
  }
  return null;
}
