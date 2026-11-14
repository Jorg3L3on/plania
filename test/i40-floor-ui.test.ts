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
// PLA-I46-3: the floor's move comes from the server (src/api/company-move.ts); the helpers attach it as companyRead does.
const moved = (p: Json, ds: Json[] = [], opts: Json = {}): Json => ("next_move" in p ? p : { ...p, next_move: nextMove(p as never, ds as never, opts) });
const line = (p: Json, ds: Json[] = [], opts: Json = {}) => lib.nowLine(moved(p, ds, opts), ds, NOW, { timeZone: TZ, ...opts });
const floor = (p: Json, ds: Json[] = [], extra: Json = {}) =>
  html(h(floorc.Floor, { project: moved(p, ds), now: NOW, timeZone: TZ, decisions: ds, acts: { now: NOW, busy: null, onAct: noop }, nowActs: { onStart: noop, onPlan: noop }, ...extra }));

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
  assert.equal(mine.say, "Aceptar «Listado de novias con búsqueda y filtros»");
  assert.deepEqual(mine.action, { kind: "decision", id: "pr-1", action: "aceptar", label: "Aceptar" });
  assert.equal(line(project(), [delivery({ hold: "Las pruebas siguen corriendo." })]).action.kind, "reveal", "a held delivery is not one click");
  const asked = line(project(), [decision()]);
  assert.deepEqual([asked.say, asked.action.kind], ["Responder a Research: «¿Qué tienda abrimos primero?»", "reveal"]);
  const release = line(project(), [decision({ id: "release:workia", kind: "release", actions: [], asker: null, release: { tickets: [{}, {}] } })]);
  assert.deepEqual([release.say, release.action.kind], ["Publicar 2 cambios", "publish"]);

  const route = { legs: [{ key: "WRK-I1", title: "Panel administrativo", done: 4, total: 4, state: "here", note: null, steps: [] }, { key: "WRK-I2", title: "Contacto y avisos", done: 0, total: 0, state: "unplanned", note: null }], more_legs: 0 };
  const done = line(project({ route }));
  assert.deepEqual([done.state, done.say, done.action.kind, done.action.label], ["you", "Planear «Contacto y avisos»", "plan", "Que PO lo planee"]);
  assert.equal(done.why, "«Panel administrativo» está completo. El PO arma los pasos y tú los aceptas.");

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
  assert.ok(text(s).includes("Nada por ahora"));
  assert.equal(/edi-go[" ]|data-move=/.test(s), false, "a resting teammate is not the owner's turn: no green button");

  const calls: unknown[][] = [];
  const el = nowc.Now({ project: resting(), line: line(resting()), now: NOW, acts: { onStart: (...a: unknown[]) => calls.push(a) } });
  findButton(el).props.onClick();
  assert.deepEqual(calls, [["workia", "taller-workia", false]]);

  // The next read has the run live: the same floor now says it is working, with no countdown and no button.
  const after = floor(project({ team: [member("taller", { state: "running", now: { ticket: "WRK-9", title: ficha, since: "2026-11-13T20:44:00Z" } })] }));
  assert.match(after, /data-now="work"/);
  assert.ok(text(after).includes("Trabajando"));
  assert.equal(/data-countdown|data-now-action/.test(after), false);
  // Held by usage, the clock counts down to the retry, not to a start.
  const held = floor(resting({ hold: "usage", starts_at: "2026-11-13T23:10:00Z", text: "El uso de Claude va en 77 % y el tope es 70 %." }));
  assert.ok(text(held).includes("para reintentar") && !text(held).includes("para arrancar"));
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

test("I40-5 #1: five legs with their counts, the current one opened into named steps; the plate drops its dashes", () => {
  const s = floor({ ...resting(), route: mianovia, plan: { initiative: { key: "WRK-I3", title: "Panel administrativo" }, done: 2, total: 4 } });
  assert.equal((s.match(/class="edi-leg"/g) ?? []).length, 5);
  assert.match(s, /data-leg="here" aria-current="step"/);
  const t = text(s).replace(/\s+/g, " ");
  assert.ok(t.includes("11 de 14 pasos · 2 entregables sin planear"));
  for (const words of ["4 de 5 · pospuesto: Hosting y dominio", "completo", "2 de 4 · aquí", "sin planear"]) assert.ok(t.includes(words), words);
  assert.deepEqual([...s.matchAll(/data-step="([a-z]+)" data-mark="([a-z]+)"/g)].map((m) => `${m[1]}:${m[2]}`), ["published:done", "published:done", "next:now", "later:later"]);
  assert.ok(t.includes("Publicado hoy 2:35 pm") && t.includes("Después · espera el paso anterior"));
  assert.equal(/edi-segs|pasos hechos/.test(s), false, "the route says the steps, not the plate");
  // An older server sends no route: the plate keeps its strip and the floor draws no route.
  const old = floor({ ...resting(), plan: { initiative: { key: "WRK-I3", title: "Panel administrativo" }, done: 2, total: 4 } });
  assert.ok(old.includes("2 de 4 pasos hechos") && !old.includes("edi-route"));
  clean(s);
});

test("I40-5 #2: the step that comes next says what the band says", () => {
  const p: Json = { ...resting(), route: mianovia };
  const band = line(p);
  const next = lib.stepLine(mianovia.legs[2].steps[2], p.team, NOW, TZ);
  assert.equal(next, "Sigue · Taller arranca a las 2:52 pm");
  assert.ok(band.say.includes("a las 2:52 pm") && band.say.includes(ficha));
  // Other holds, and the other states.
  const held = resting({ hold: "usage", starts_at: null, text: "x" });
  assert.equal(lib.stepLine(mianovia.legs[2].steps[2], held.team, NOW, TZ), "Sigue · Taller: detenido por el uso");
  assert.equal(lib.stepLine(step("WRK-9", ficha, "next"), [], NOW, TZ), "Sigue · Taller");
  assert.equal(lib.stepLine(step("WRK-9", ficha, "delivered"), [], NOW, TZ), "Entregado · espera que lo aceptes");
  const busy = [member("taller", { state: "running", now: { ticket: "WRK-9", title: ficha, since: "2026-11-13T20:41:00Z" } })];
  assert.equal(lib.stepLine(step("WRK-9", ficha, "working"), busy, NOW, TZ), "En curso · Taller, desde hace 3 min");
  assert.equal(lib.stepLine(step("WRK-9", ficha, "done", "2026-11-12T20:00:00Z"), [], NOW, TZ), "Aceptado ayer");
  assert.equal(lib.stepLine(step("WRK-9", ficha, "published", "2026-11-02T20:00:00Z"), [], NOW, TZ), "Publicado el 2 nov");
});

test("I40-5 #1: no plan says so with Que PO lo planee; one leg; a 120-character step wraps whole", () => {
  const none = floor(project({ route: null }));
  assert.match(none, /data-route="empty"/);
  assert.ok(text(none).includes("Aún no hay plan") && none.includes('data-control="planear"'));
  assert.equal(floor(project({ route: null, paused: true, light: "paused" })).includes('data-control="planear"'), false, "a paused floor asks nothing");

  const long = "Importar el inventario de la bodega desde la hoja de cálculo que la tienda ya usa, con códigos, precios y existencias";
  assert.ok(long.length >= 115);
  const one = floor(project({ route: { legs: [{ key: "WRK-I1", title: "Inventario", done: 0, total: 1, state: "here", note: null, steps: [step("WRK-1", long, "next")], more_steps: 3 }], more_legs: 2 } }));
  assert.equal((one.match(/class="edi-leg"/g) ?? []).length, 1);
  assert.ok(one.includes(long), "never clipped");
  assert.ok(text(one).includes("+3 pasos más") && text(one).includes("+2 más"));
});

test("I40-5 #3: the legs never scroll sideways, and long text breaks", () => {
  const css = readFileSync(new URL("../ui/src/index.css", import.meta.url), "utf8");
  // PLA-I46-14: one row of legs on every width (Jorge, 13 Nov 2026), each column allowed to shrink.
  assert.ok(css.includes(".edi-legs { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(var(--n, 5), minmax(0, 1fr));"));
  assert.match(css, /\.edi-leg b \{[^}]*overflow-wrap: anywhere/);
  assert.match(css, /\.edi-stext b \{[^}]*overflow-wrap: anywhere/);
  assert.match(css, /\.edi-route \{[^}]*grid-column: 1 \/ -1[^}]*min-width: 0/);
});

// ---- PLA-I40-6

const after = await load("components/compania/edificio/after.tsx");
const answered = (patch: Json = {}) => delivery({ actions: [], state: { action: "aceptar", at: "2026-11-13T20:24:00Z", result: {} }, ...patch });
const full = (patch: Json = {}): Json => ({ ...resting(), route: mianovia, latest: [{ kind: "published", title: null, n: 6, at: "2026-11-13T20:35:00Z" }], stale_requests: [], ...patch });

test("I40-6 #1: an answered decision is a line under Lo último, not a bubble; a pending one still hangs", () => {
  const s = floor(full(), [answered()]);
  assert.equal(s.includes("data-bubble="), false);
  assert.equal(s.includes("Ya respondiste"), false);
  // PLA-I46-4: one line on the plate, then «Ver todo» with every line, newest first.
  assert.deepEqual([...s.matchAll(/data-last="([a-z]+)"/g)].map((m) => m[1]), ["seen", "seen", "answered"], "the newest, then all of them");
  assert.match(s, /<details class="edi-lastall" data-last-all="true"><summary>Ver todo<\/summary>/);
  const t = text(s).replace(/\s+/g, " ");
  assert.ok(t.includes("hoy 2:35 pm Publicaste 6 cambios"));
  assert.ok(t.includes("hoy 2:24 pm Aceptaste «Listado de novias con búsqueda y filtros»"));
  assert.match(s, /<details class="dark edi-lastd"><summary>Ver<\/summary>/);
  assert.equal(lib.hangingFor([answered()], "workia", "taller-workia"), null);

  // PLA-I46-10: a pending PR delivery is the move: Ahora carries it (the evidence card), no bubble hangs for it.
  const open = floor(full(), [delivery(), answered({ id: "pr-0", title: "Acceso privado del equipo" })]);
  assert.equal((open.match(/data-bubble="/g) ?? []).length, 0);
  assert.match(open, /data-evidence="pr-1"/);
  assert.ok(open.includes('data-last="answered"'));
  // Three lines at most, newest first.
  const many = lib.lastLines(full({ latest: [{ kind: "published", title: null, n: 1, at: "2026-11-13T20:35:00Z" }, { kind: "delivered", title: "Listado", n: null, at: "2026-11-13T20:21:00Z" }, { kind: "delivered", title: "Acceso", n: null, at: "2026-11-13T18:50:00Z" }] }), [answered()]);
  assert.deepEqual(many.map((l: Json) => l.text), ["Publicaste 1 cambio", "Aceptaste «Listado de novias con búsqueda y filtros»", "El equipo entregó «Listado»"]);
  clean(s);
});

test("I40-6: Solo tú says what is the owner's; Pasa sin ti is not drawn; Lo último sits on the plate", () => {
  const html = floor(full());
  const s = text(html).replace(/\s+/g, " ");
  assert.equal(s.includes("Pasa sin ti"), false);
  assert.ok(html.indexOf('data-col="ultimo"') < html.indexOf('class="edi-wins"'), "Lo último is on the plate, left of the team");
  assert.ok(s.includes("Solo tú Aceptar cada entrega para que el paso siguiente arranque, y publicar."));
  const working = { ...mianovia, legs: mianovia.legs.map((l: Json) => (l.steps ? { ...l, steps: l.steps.map((x: Json) => (x.state === "next" ? { ...x, state: "working" } : x)) } : l)) };
  assert.match(lib.sinTi(full({ route: working })), /^Taller termina «Ficha de la novia y notas internas» y te lo entrega\./);
  assert.equal(lib.sinTi(project({ route: null, latest: [] })), "Nada en fila. Lo que pidas lo reparte el PO.");
  assert.equal(lib.sinTi(project({ paused: true, light: "paused" })), "Nada: el proyecto está en pausa.");
  // An older server sends no latest: the floor draws none of this.
  assert.equal(floor(resting()).includes("data-after"), false);
  assert.equal(floor(resting()).includes('data-col="ultimo"'), false);
});

test("I40-6 #4: a request nobody took is a warning with Reenviar and Cerrar, and each calls its route", () => {
  const p = full({ stale_requests: [{ key: "WRK-12", title: "Tell Taller to continue", since: "2026-11-13T04:06:00Z" }] });
  const calls: unknown[][] = [];
  const acts = { onResend: (...a: unknown[]) => calls.push(["resend", ...a]), onClose: (...a: unknown[]) => calls.push(["close", ...a]) };
  const s = floor(p, [], { nowActs: acts });
  assert.ok(text(s).replace(/\s+/g, " ").includes("Tu pedido «Tell Taller to continue» lleva 17 h sin que nadie lo tome."));
  assert.ok(s.includes('data-control="reenviar"') && s.includes('data-control="cerrar-pedido"'));
  const el = after.Last({ project: p, decisions: [], now: NOW, timeZone: TZ, acts });
  const buttons: any[] = [];
  const walk = (x: any) => {
    if (!x || typeof x !== "object") return;
    if (Array.isArray(x)) return x.forEach(walk);
    if (x.type === "button") buttons.push(x);
    walk(x.props?.children);
  };
  walk(el);
  for (const b of buttons) b.props.onClick();
  assert.deepEqual(calls, [["resend", "workia", "WRK-12"], ["close", "workia", "WRK-12"]]);
  const page = readFileSync(new URL("../ui/src/pages/ceo.tsx", import.meta.url), "utf8");
  assert.ok(/\.resendRequest\(slug, key\)/.test(page) && /\.cancelOrder\(slug, key\)/.test(page));
  clean(s);
});

// ---- PLA-I40-7

test("I40-7 (UI): the switch sits under Solo tú, says why a delivery was not accepted, and an automatic accept reads as one", () => {
  const off = floor(full({ auto_accept: { on: false, hold: null } }), [], { nowActs: { onAuto: noop } });
  assert.match(off, /<input id="auto-workia" type="checkbox"[^>]*data-control="aceptar-sola"/);
  assert.equal(/id="auto-workia"[^>]*checked=""/.test(off), false);
  assert.ok(text(off).includes("Aceptar sola en la copia de prueba si las pruebas pasan"));
  assert.ok(text(off).includes("Aceptar cada entrega para que el paso siguiente arranque, y publicar."));

  const on = floor(full({ auto_accept: { on: true, hold: "Faltan pruebas que pasen." } }), [], { nowActs: { onAuto: noop } });
  assert.match(on, /id="auto-workia"[^>]*checked=""/);
  assert.ok(text(on).includes("No se aceptó sola: Faltan pruebas que pasen."));
  assert.ok(text(on).includes("Publicar. Las entregas con pruebas en verde se aceptan solas en la copia de prueba."));

  const calls: unknown[][] = [];
  const el = after.After({ project: full({ auto_accept: { on: false, hold: null } }), decisions: [], now: NOW, acts: { onAuto: (...a: unknown[]) => calls.push(a) } });
  const find = (x: any): any => (!x || typeof x !== "object" ? null : Array.isArray(x) ? x.map(find).find(Boolean) : x.type === "input" ? x : find(x.props?.children));
  find(el).props.onChange({ currentTarget: { checked: true } });
  assert.deepEqual(calls, [["workia", true]]);

  const auto = answered({ state: { action: "aceptar", at: "2026-11-13T20:24:00Z", result: { by: "auto" } }, evidence: { verdict: "pass", kind: "test", cite: "pnpm test", pass: 162, fail: 0, at: "2026-11-13T20:21:00Z" } });
  assert.equal(lib.lastLines(full({ latest: [] }), [auto])[0].text, "Se aceptó sola «Listado de novias con búsqueda y filtros» · 162 pruebas pasan");
  // An older server sends no auto_accept: no switch.
  assert.equal(floor(full(), [], { nowActs: { onAuto: noop } }).includes("aceptar-sola"), false);
});

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
