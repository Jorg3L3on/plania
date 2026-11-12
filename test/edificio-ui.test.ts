// PLA-I39-3..9: the building on /ceo rendered with fake data (Design doc of PLA-IDEA11, frames F1-F11). One test per
// state the tickets name. Server-rendered with react-dom/server; no browser, no database. Fake names and numbers.
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

type Json = Record<string, any>;
const h = React.createElement;
const html = (el: React.ReactElement) => renderToStaticMarkup(h(MemoryRouter, null, el));
const noop = () => {};
const NOW = new Date("2026-11-10T18:00:00Z").getTime();
const TZ = "America/Mexico_City";
const clean = (s: string) => {
  assert.equal(/\bnull\b|\bundefined\b|NaN|\[object Object\]/.test(s), false, "never a null key");
  assert.equal(/\$|USD/.test(s), false, "tokens, never money");
  assert.equal(/\b[A-Z]{2,4}-(I\d+-)?\d+\b/.test(s.replace(/data-[a-z-]+="[^"]*"/g, "").replace(/id="[^"]*"/g, "")), false, "never a ticket key on screen");
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
  budget: { used: 100_000, limit: 5_000_000, pct: 2, state: "ok", reason: null },
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
  asistente: { thread_id: "t-co", budget: { used: 0, limit: null, pct: null, state: "ok", reason: null }, last_run: { status: "ok", at: "2026-11-10T17:00:00Z", summary: "Resumen: Workia avanza." }, state: "idle", unread: 0 },
  projects: [project()],
  plumbing: { spend: 1_250_000, limit: 6_000_000, running: 1, paused: false },
  decisions: [],
  inbox: { decisiones: 0, pasos: 0 },
  ...patch,
});
const render = (c: Json, extra: Json = {}) =>
  html(h(building.Building, { company: c, decisions: c.decisions, now: NOW, timeZone: TZ, hello: "Buenas tardes", day: "Martes 10 de noviembre", onNew: noop, ...extra }));
const one = (m: Json, extra: Json = {}) => html(h(win.Window, { member: m, project: "Workia", now: NOW, ...extra }));

// ---- PLA-I39-3

test("I39-3 #1: a window is lit with a laptop only while running; orange with a hand when it asks; blinds when paused; dim when out of budget", () => {
  const work = one(member("taller", { state: "running", now: { ticket: "WRK-3", title: "Pantalla del carrito", since: "2026-11-10T17:20:00Z" } }));
  assert.match(work, /data-state="work"/);
  assert.ok(work.includes("edi-lap"));
  const ask = one(member("product-owner", { state: "waiting_jorge", waiting: "¿Qué tienda abrimos primero?" }));
  assert.match(ask, /data-state="ask"/);
  assert.ok(ask.includes("edi-arm") && ask.includes("Te pregunta algo"));
  const off = one(member("research", { state: "paused" }));
  assert.match(off, /data-state="off"/);
  assert.ok(off.includes("En pausa"));
  const hold = one(member("artist", { state: "no_budget" }));
  assert.match(hold, /data-state="hold"/);
  assert.ok(/sin presupuesto/i.test(hold));
  const idle = one(member("artist"));
  assert.match(idle, /data-state="idle"/);
  // Only running lights a window: idle, paused and out of budget are never "work".
  for (const s of [ask, off, hold, idle]) assert.equal(/data-state="work"/.test(s), false);
  // The company switch puts every blind down.
  assert.match(one(member("research"), { companyPaused: true }), /data-state="off"/);
  // The laptop and the hand are CSS-gated by state.
  const css = readFileSync(new URL("../ui/src/index.css", import.meta.url), "utf8");
  assert.ok(css.includes('.edi-win[data-state="work"] .edi-lap { display: block; }'));
  assert.ok(css.includes('.edi-win[data-state="ask"] .edi-arm { display: block; }'));
  assert.ok(css.includes(".edi-arm, .edi-lap { display: none; }"));
});

test("I39-3 #2: the caption is role and verb, then what it is on with since when, else its queue, else its last delivery", () => {
  const work = one(member("taller", { state: "running", now: { ticket: "WRK-3", title: "Pantalla del carrito", since: "2026-11-10T17:20:00Z" } }));
  assert.ok(text(work).includes("Taller") && text(work).includes("construye") && work.includes("Pantalla del carrito") && work.includes("desde hace 40 min"));
  const queued = one(member("product-owner", { queue: [{ key: "WRK-5", title: "Entrevistar a tres tiendas" }, { key: "WRK-6", title: "Otra" }] }));
  assert.ok(queued.includes("Sigue: Entrevistar a tres tiendas") && queued.includes("1 más en fila") && text(queued).includes("coordina"));
  const delivered = one(member("artist", { produced: { kind: "doc", ref: "d-1", title: "Boceto del carrito" }, last: { ticket: "WRK-2", title: "Boceto", status: "ok", at: "2026-11-10T15:00:00Z" } }));
  assert.ok(delivered.includes("Entregó: Boceto del carrito") && delivered.includes("hace 3 h"));
  const none = one(member("research"));
  assert.ok(none.includes("Sin trabajo"));
  // A run without a ticket title never shows its key.
  const keyOnly = one(member("taller", { state: "running", now: { ticket: "WRK-9", title: null, since: "2026-11-10T17:58:00Z" } }));
  assert.ok(keyOnly.includes("Trabajando"));
  const qa = one(member("qa"));
  assert.ok(text(qa).includes("QA") && text(qa).includes("prueba") && qa.includes('data-prop="magnifier"'));
  for (const s of [work, queued, delivered, none, keyOnly, qa]) clean(s);
  // Every prop by role.
  assert.deepEqual(["product-owner", "research", "artist", "taller", "qa", "copy"].map(lib.propOf), ["headset", "glasses", "beret", "hardhat", "magnifier", "none"]);
});

test("I39-3 #3: the roof shows Te toca with the number, one chip per decision, deliveries and tokens this week", () => {
  const ds = [decision(), decision({ id: "m-2", kind: "proposal", title: "Dos caminos", asker: { agent: "product-owner-workia", role: "product-owner" } })];
  const out = html(h(roof.Roof, { decisions: ds, projects: [project()], plumbing: { spend: 1_250_000, limit: 6_000_000, running: 1, paused: false } }));
  assert.match(out, /data-te-toca="2"/);
  assert.ok(text(out).includes("Te toca") && out.includes(">2<"));
  assert.equal((out.match(/data-chip=/g) ?? []).length, 2);
  assert.ok(out.includes("Workia: ¿Qué tienda abrimos primero?") && out.includes('href="#piso-workia"'));
  assert.ok(out.includes("2 entregas esta semana") && out.includes("1.25M tokens esta semana"));
  clean(out);
  const calm = html(h(roof.Roof, { decisions: [], projects: [project()], plumbing: { spend: 0, limit: null, running: 0, paused: false } }));
  assert.ok(calm.includes("Nada te espera.") && /data-te-toca="0"/.test(calm));
});

test("I39-3 #4: empty is a lot with the door, loading the outline with dark windows, error the existing block", () => {
  const empty = render(company({ projects: [] }));
  assert.ok(empty.includes('data-empty="projects"') && empty.includes("Abrir el primer piso"));
  assert.equal(empty.includes("data-roof"), false);
  const loading = html(h(building.BuildingBlock, { loading: true, error: false, onRetry: noop, children: null }));
  assert.ok(loading.includes('data-testid="edificio-skeleton"'));
  assert.equal((loading.match(/class="edi-floor"/g) ?? []).length, 3);
  assert.equal(/data-state="(work|ask)"/.test(loading), false);
  const error = html(h(building.BuildingBlock, { loading: false, error: true, onRetry: noop, children: null }));
  assert.ok(error.includes("data-edificio-error") && /la compañía/.test(error));
  const full = render(company({ decisions: [decision()] }));
  assert.ok(full.includes("data-roof") && full.includes('data-floor="workia"') && full.includes("Workia avanza."));
  assert.ok(full.includes("Resumen: Workia avanza."));
  clean(full);
});

test("I39-3 #5: floors that need the owner come first; the hue is fixed per slug; the sky follows the hour", () => {
  const a = project({ slug: "alfa", title: "Alfa" });
  const b = project({ slug: "beta", title: "Beta", light: "quiet" });
  const c = project({ slug: "gama", title: "Gama", paused: true, light: "paused" });
  const { floors, basement } = lib.floorOrder([a, b, c], [decision({ project: "beta" })]);
  assert.deepEqual(floors.map((p: Json) => p.slug), ["beta", "alfa"]);
  assert.deepEqual(basement.map((p: Json) => p.slug), ["gama"]);
  assert.equal(lib.floorHue("workia"), lib.floorHue("workia"));
  assert.ok(lib.HUES.includes(lib.floorHue("plania")));
  assert.equal(lib.skyAt(23).orb, "moon");
  assert.equal(lib.skyAt(12).orb, "sun");
  assert.notEqual(lib.skyAt(12).top, lib.skyAt(2).top);
});

test("I39-3 #6: with prefers-reduced-motion nothing in the scene animates", () => {
  const css = readFileSync(new URL("../ui/src/index.css", import.meta.url), "utf8");
  const block = /@media \(prefers-reduced-motion: reduce\) \{\s*\.edi \*, \.edi \*::before, \.edi \*::after \{ animation: none !important; transition: none !important; \}/.test(css);
  assert.ok(block, "the .edi reduced-motion rule");
  // Nothing in the scene moves to look busy: the only animations are the stars and the antenna.
  const edi = css.slice(css.indexOf("/* PLA-I39: the building"), css.indexOf("@keyframes edi-twinkle"));
  const animated = [...edi.matchAll(/^\s*(\.[^{]+)\{[^}]*animation:/gm)].map((m) => m[1]!.trim());
  assert.deepEqual(animated, [".edi-star", ".edi-antenna::after"]);
  const out = html(h(scene.EdificioSkeleton, {}));
  assert.ok(out.includes("edi"));
});

// ---- handlers without a DOM: expand hook-free components into their element tree and call the handler.
type El = { type: unknown; props: Json };
const expand = (node: unknown): unknown => {
  if (Array.isArray(node)) return node.map(expand);
  if (!node || typeof node !== "object" || !("type" in node)) return node;
  const el = node as El;
  if (typeof el.type === "function") return expand((el.type as (p: Json) => unknown)(el.props));
  return { ...el, props: { ...el.props, children: expand(el.props?.children) } };
};
const findAll = (node: unknown, pred: (el: El) => boolean, out: El[] = []): El[] => {
  if (Array.isArray(node)) for (const n of node) findAll(n, pred, out);
  else if (node && typeof node === "object" && "props" in node) {
    const el = node as El;
    if (pred(el)) out.push(el);
    findAll(el.props?.children, pred, out);
  }
  return out;
};
const control = (tree: unknown, name: string) => findAll(tree, (el) => el.props?.["data-control"] === name);
const tree = (c: Json, extra: Json = {}) => expand(h(building.Building, { company: c, decisions: c.decisions, now: NOW, timeZone: TZ, hello: "Hola", day: "Martes", onNew: noop, ...extra }));

// ---- PLA-I39-4

const plan = { initiative: { key: "WRK-I2", title: "Formulario de bienvenida" }, done: 2, total: 5, start_on: null, due_on: null, weeks: null, today_pct: null, done_pct: null, pace: null, weeks_behind: null, forecast_on: null };

test("I39-4 #1: the plate shows name, deliverable, steps done of total, goal with date or Sin meta: Fijar, and the light's reason", () => {
  const set = project({
    plan,
    rumbo: { goal_id: "g-1", goal: "Que una tienda reciba su primer pedido", why: "", target_on: "2026-12-05", forecast_on: "2026-12-05", weeks_behind: 0, missing: false },
    light: "needs_jorge",
    light_reason: { text: "El equipo te hizo una pregunta y espera tu respuesta.", action: { label: "Ver en Te toca", href: "#te-toca" } },
  });
  const out = render(company({ projects: [set] }), { onFijar: noop });
  assert.ok(out.includes("Workia") && out.includes('title="Workia"'));
  assert.ok(out.includes("Formulario de bienvenida") && out.includes("2 de 5 pasos hechos"));
  assert.equal((out.match(/edi-seg edi-seg-done/g) ?? []).length, 2);
  assert.ok(out.includes("Meta: <b>Que una tienda reciba su primer pedido</b> · 5 dic") && out.includes("a tiempo"));
  assert.ok(out.includes("El equipo te hizo una pregunta y espera tu respuesta.") && out.includes('href="#te-toca"'));
  assert.ok(out.includes("100k tokens esta semana"));
  clean(out);
  const missing = render(company({ projects: [project({ next: { title: "Pantalla del carrito", key: "WRK-3", owner: "taller", due: null } })] }), { onFijar: noop });
  assert.ok(missing.includes('data-rumbo="missing"') && missing.includes("Sin meta: ") && missing.includes('data-control="fijar"'));
  assert.ok(missing.includes("Pantalla del carrito") && missing.includes("Aún no hay pasos"));
  clean(missing);
  // Fijar opens the goal dialog for that project.
  let fixed: Json | null = null;
  control(tree(company({ projects: [project()] }), { onFijar: (p: Json) => (fixed = p) }), "fijar")[0]!.props.onClick();
  assert.equal(fixed!.slug, "workia");
});

test("I39-4 #2: a paused project sits below the street with Reanudar and no lit window; Reanudar calls the project switch", () => {
  const paused = project({ slug: "nido", title: "Nido", paused: true, light: "paused", team: ["product-owner", "taller"].map((r) => member(r, { agent: `${r}-nido`, state: "paused" })) });
  const c = company({ projects: [project(), paused] });
  const out = render(c, { onResume: noop });
  const under = out.slice(out.indexOf("data-basement"));
  assert.ok(under.includes("Bajo la calle · en pausa") && under.includes('data-floor="nido"') && under.includes("Reanudar"));
  assert.equal(/data-state="(work|ask)"/.test(under), false);
  assert.ok(out.indexOf('data-floor="workia"') < out.indexOf("edi-street") && out.indexOf("edi-street") < out.indexOf('data-floor="nido"'));
  const calls: string[] = [];
  const [btn] = control(tree(c, { onResume: (slug: string) => calls.push(slug) }), "reanudar");
  btn!.props.onClick();
  assert.deepEqual(calls, ["nido"]);
  assert.equal(control(tree(c, { onResume: noop, resuming: "nido" }), "reanudar")[0]!.props.disabled, true);
});

test("I39-4 #3: company paused: no window is lit and the banner says it resumes in Máquina", () => {
  const busy = project({ team: [member("taller", { state: "running", now: { ticket: "WRK-3", title: "Pantalla", since: "2026-11-10T17:00:00Z" } }), member("product-owner", { state: "waiting_jorge" })] });
  const out = render(company({ company: { paused: true }, projects: [busy] }));
  assert.equal(/data-state="(work|ask|hold|idle)"/.test(out.slice(out.indexOf("edi-tower"))), false);
  assert.ok((out.match(/data-state="off"/g) ?? []).length >= 2);
  const page = readFileSync(new URL("../ui/src/pages/ceo.tsx", import.meta.url), "utf8");
  assert.ok(page.includes('data-banner="paused"') && page.includes("La compañía está detenida: nada arranca. Se reanuda en Máquina."));
});

test("I39-4 #4: a long name stays on one line with ellipsis and its full text in title; a long deliverable wraps to two lines", () => {
  const name = "Telar de cuentos para niños y abuelos que leen en voz alta";
  const deliv = "Una pantalla del cuento con un título muy largo que ocupa por lo menos dos líneas en el teléfono y algo más";
  const out = render(company({ projects: [project({ title: name, plan: { ...plan, initiative: { key: "WRK-I3", title: deliv } } })] }));
  assert.ok(new RegExp(`<a[^>]*class="edi-nm"[^>]*title="${name}"`).test(out) && out.includes(`>${name}</a>`));
  assert.ok(new RegExp(`class="edi-deliv"[^>]*title="${deliv}"`).test(out));
  const css = readFileSync(new URL("../ui/src/index.css", import.meta.url), "utf8");
  assert.ok(/\.edi-nm \{[^}]*overflow: hidden; text-overflow: ellipsis; white-space: nowrap;/.test(css), "one line with ellipsis");
  assert.ok(/\.edi-deliv \{[^}]*-webkit-line-clamp: 2;/.test(css), "two lines at most");
});

test("I39-4 #5: the door opens the new-project dialog and a created project shows as a new floor", () => {
  let opened = 0;
  const c = company();
  control(tree(c, { onNew: () => opened++ }), "piso-nuevo")[0]!.props.onClick();
  assert.equal(opened, 1);
  const page = readFileSync(new URL("../ui/src/pages/ceo.tsx", import.meta.url), "utf8");
  assert.ok(page.includes('openSheet("?nuevo")') && page.includes("onNew={onNew}") && page.includes('sheet?.kind === "nuevo"'));
  const after = render(company({ projects: [project(), project({ slug: "faro", title: "Faro" })] }));
  assert.ok(after.includes('data-floor="faro"') && after.includes('data-tower="2"'));
});
