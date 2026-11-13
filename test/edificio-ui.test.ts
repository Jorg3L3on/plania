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

// ---- PLA-I39-3

test("I39-3 #1: a window is lit with a laptop only while running; orange with a hand when it asks; blinds when paused; PLA-21: no out-of-budget window", () => {
  const work = one(member("taller", { state: "running", now: { ticket: "WRK-3", title: "Pantalla del carrito", since: "2026-11-10T17:20:00Z" } }));
  assert.match(work, /data-state="work"/);
  assert.ok(work.includes("edi-lap"));
  const ask = one(member("product-owner", { state: "waiting_jorge", waiting: "¿Qué tienda abrimos primero?" }));
  assert.match(ask, /data-state="ask"/);
  assert.ok(ask.includes("edi-arm") && ask.includes("Te pregunta algo"));
  const off = one(member("research", { state: "paused" }));
  assert.match(off, /data-state="off"/);
  assert.ok(off.includes("En pausa"));
  const idle = one(member("artist"));
  assert.match(idle, /data-state="idle"/);
  // Only running lights a window: idle and paused are never "work".
  for (const s of [ask, off, idle]) assert.equal(/data-state="work"/.test(s), false);
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
  const out = html(h(roof.Roof, { decisions: ds, projects: [project()], plumbing: { spend: 1_250_000, running: 1, paused: false } }));
  assert.match(out, /data-te-toca="2"/);
  assert.ok(text(out).includes("Te toca") && out.includes(">2<"));
  assert.equal((out.match(/data-chip=/g) ?? []).length, 2);
  assert.ok(out.includes("Workia: ¿Qué tienda abrimos primero?") && out.includes('href="#piso-workia"'));
  assert.ok(out.includes("2 entregas esta semana") && out.includes("1.25M tokens esta semana"));
  clean(out);
  const calm = html(h(roof.Roof, { decisions: [], projects: [project()], plumbing: { spend: 0, running: 0, paused: false } }));
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
// Components that hold state are left as elements (their own handlers are tested where they live).
const STATEFUL = new Set<unknown>();
const expand = (node: unknown): unknown => {
  if (Array.isArray(node)) return node.map(expand);
  if (!node || typeof node !== "object" || !("type" in node)) return node;
  const el = node as El;
  if (typeof el.type === "function" && !STATEFUL.has(el.type)) return expand((el.type as (p: Json) => unknown)(el.props));
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
  assert.ok(out.includes("El equipo te hizo una pregunta y espera tu respuesta.") && out.includes('href="#pregunta-workia"'));
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

// ---- PLA-I39-5

const v2 = await load("components/compania/v2.tsx");
const acts = (patch: Json = {}) => ({ now: NOW, busy: null, errors: {}, opened: null, onAct: noop, ...patch });
const proposal = decision({
  id: "m-00000000-0000-4000-8000-0000000000a1",
  kind: "proposal",
  title: "¿Con qué arrancamos el formulario?",
  options: [
    { n: 1, label: "Con el borrador", recommended: true, effect: "Taller arranca hoy", cost: "3 tickets · 2 días" },
    { n: 2, label: "Esperar a la tienda", recommended: false, effect: "Nadie construye", cost: "7 días" },
  ],
  combinable: [[1, 2]],
  recommended_reason: "deja probar algo esta semana",
  ref: null,
  asker: { agent: "product-owner-workia", role: "product-owner" },
});
const KINDS: Json[] = [
  proposal,
  decision({ id: "m-plan", kind: "plan", options: null, actions: ["empezar", "cambiar", "cancelar"], plan: { order: "WRK-9", understood: "Una tienda", steps: [{ title: "Pantalla", done_when: "se ve" }], cost: "2 días", needs_approval: true, created: [] }, asker: { agent: "product-owner-workia", role: "product-owner" } }),
  decision({ id: "t-action", kind: "action", options: null, actions: ["hecho", "aplazar"], asker: { agent: "artist-workia", role: "artist" } }),
  decision(),
  decision({ id: "m-deliv", kind: "deliverable", options: null, actions: ["aceptar", "cambios"], evidence: { verdict: "pass", kind: "test", cite: "ok", pass: 3, fail: 0, at: "2026-11-10T15:00:00Z" }, preview_url: null, hold: null, asker: { agent: "taller-workia", role: "taller" } }),
  decision({ id: "m-pr", kind: "pr", options: null, actions: ["fusionar", "cambios"], hold: "Las pruebas siguen corriendo.", asker: { agent: "taller-workia", role: "taller" } }),
  decision({ id: "b-step", kind: "step", options: null, actions: ["hecho"], asker: { agent: "research-workia", role: "research" } }),
  decision({ id: "r-workia", kind: "release", options: null, actions: [], ref: null, asker: null, release: { from: "sandbox", into: "main", env: "prod", ahead: 2, tickets: [{ key: "WRK-1", title: "Uno" }], open_checks: 0, before: 0 } }),
];
const actionsIn = (s: string) => [...s.matchAll(/data-action="([a-z]+)"/g)].map((m) => m[1]).sort();

test("I39-5 #1: a proposal hangs under the PO's window and a question under the window of who asked it", () => {
  const out = render(company({ decisions: [proposal, decision()] }), { acts: acts() });
  const floor = out.slice(out.indexOf('data-floor="workia"'));
  assert.match(floor, new RegExp(`data-bubble="${proposal.id}"[^>]*data-asker="product-owner-workia"`));
  assert.match(floor, /data-bubble="q-00000000-0000-4000-8000-000000000001"[^>]*data-asker="research-workia"/);
  assert.ok(floor.includes("PO te pregunta") && floor.includes("Research te pregunta"));
  // The bubble follows its asker's row: PO is window 0, Research window 1 (five per row on a Mac, two on a phone).
  assert.match(floor, /data-bubble="m-[^"]+"[^>]*style="--o-wide:7;--o-phone:3;--nx-wide:10%;--nx-phone:25%"/);
  assert.match(floor, /data-asker="research-workia"[^>]*style="--o-wide:7;--o-phone:3;--nx-wide:30%;--nx-phone:75%"/);
  // The plate's pointer goes to the question on this floor, and Te toca's block is gone from the page.
  const page = readFileSync(new URL("../ui/src/pages/ceo.tsx", import.meta.url), "utf8");
  assert.equal(page.includes("<TeToca"), false);
  assert.ok(page.includes('get("decision")'));
  const reason = render(company({ projects: [project({ light: "needs_jorge", light_reason: { text: "Te preguntan.", action: { label: "Ver en Te toca", href: "#te-toca" } } })], decisions: [decision()] }), { acts: acts() });
  assert.ok(reason.includes('href="#pregunta-workia"') && reason.includes('id="pregunta-workia"') && reason.includes("Ver la pregunta"));
  clean(out);
});

test("I39-5 #2: each of the eight decision kinds shows the same actions Te toca shows", () => {
  // What Te toca showed for each kind (recorded from its rows before the block left the page, PLA-I39-9).
  const TE_TOCA: Record<string, string[]> = {
    proposal: ["combo", "elegir", "elegir", "responder"],
    plan: ["cambiar", "cancelar", "empezar"],
    action: ["aplazar", "hecho"],
    question: ["elegir", "elegir", "responder"],
    deliverable: ["aceptar", "cambios"],
    pr: ["cambios", "fusionar"],
    step: ["hecho"],
    release: ["publicar"],
  };
  for (const d of KINDS) {
    const out = render(company({ decisions: [d] }), { acts: acts(), roofOpen: d.id });
    const where = d.asker ? out.slice(out.indexOf('data-floor="workia"')) : out.slice(out.indexOf("data-roof"), out.indexOf("edi-tower"));
    assert.ok(where.includes(`data-bubble="${d.id}"`), `${d.kind} is shown`);
    assert.deepEqual(actionsIn(where), TE_TOCA[d.kind], d.kind);
    clean(where);
  }
});

test("I39-5 #3: choosing an option acts once with that option; the result line and a refusal show in place", () => {
  const calls: Json[] = [];
  const ui = { reply: false, setReply: noop, text: "", setText: noop, open: false, setOpen: noop };
  const view = expand(h(v2.DecisionView, { d: proposal, now: NOW, busy: null, onAct: (d: Json, input: Json, key: string) => calls.push({ id: d.id, input, key }), ui }));
  const elegir = findAll(view, (el) => el.props?.["data-action"] === "elegir");
  assert.equal(elegir.length, 2);
  elegir[0]!.props.onClick();
  assert.deepEqual(calls, [{ id: proposal.id, input: { action: "elegir", option: 1 }, key: "elegir-1" }]);
  // While it is on its way the buttons are disabled, so it is sent once.
  const busy = expand(h(v2.DecisionView, { d: proposal, now: NOW, busy: { id: proposal.id, key: "elegir-1" }, onAct: noop, ui }));
  assert.ok(findAll(busy, (el) => el.props?.["data-action"] === "elegir").every((b) => b.props.disabled === true));
  const page = readFileSync(new URL("../ui/src/pages/ceo.tsx", import.meta.url), "utf8");
  assert.ok(page.includes("api.actDecision(v.d.id, v.input)") && page.includes("onAct: (d, input, key) => act.mutate({ d, input, key })"));
  // Acted: the floor keeps the result line.
  const done = render(company({ decisions: [{ ...proposal, actions: [], state: { action: "elegir", at: "2026-11-10T17:55:00Z", result: { option: 1, label: "Con el borrador" } } }] }), { acts: acts() });
  assert.ok(/data-bubble="m-[^"]+"[^>]*data-acted="1"/.test(done) && done.includes("✓") && done.includes("PO te preguntó"));
  // Refused: its sentence in place.
  const refused = render(company({ decisions: [proposal] }), { acts: acts({ errors: { [proposal.id]: "Ya actuaste sobre esto." } }) });
  const bubble = refused.slice(refused.indexOf(`data-bubble="${proposal.id}"`));
  assert.ok(bubble.includes("Ya actuaste sobre esto."));
});

test("I39-5 #4: two decisions from one asker: the oldest shows and +1 más is there", () => {
  const older = decision({ id: "q-old", title: "¿Primero la tienda de ropa?", at: "2026-11-10T10:00:00Z" });
  const newer = decision({ id: "q-new", title: "¿Y la de libros?", at: "2026-11-10T16:00:00Z" });
  const out = render(company({ decisions: [newer, older] }), { acts: acts() });
  assert.equal((out.match(/data-bubble="/g) ?? []).length, 1);
  assert.ok(out.includes('data-bubble="q-old"') && out.includes('data-more="1"') && out.includes("+1 más"));
  const floor = out.slice(out.indexOf('data-floor="workia"'));
  assert.ok(floor.indexOf("¿Primero la tienda de ropa?") < floor.indexOf("¿Y la de libros?"));
  const hang = lib.hangingFor([newer, older], "workia", "research-workia");
  assert.deepEqual([hang.decision.id, hang.more.map((d: Json) => d.id)], ["q-old", ["q-new"]]);
});

test("I39-5 #5: a release is a chip on the roof and not a bubble under a window", () => {
  const release = KINDS.at(-1)!;
  const closed = render(company({ decisions: [release] }), { acts: acts(), onChip: noop });
  assert.ok(closed.includes(`data-chip="${release.id}"`) && /data-on-team="0"/.test(closed));
  assert.equal(closed.includes("data-bubble"), false);
  const calls: string[] = [];
  const [chip] = findAll(tree(company({ decisions: [release] }), { acts: acts(), onChip: (d: Json) => calls.push(d.id) }), (el) => el.props?.["data-chip"] === release.id);
  chip!.props.onClick();
  assert.deepEqual(calls, [release.id]);
  const opened = render(company({ decisions: [release] }), { acts: acts(), onChip: noop, roofOpen: release.id });
  const roofPart = opened.slice(opened.indexOf("data-roof"), opened.indexOf("edi-tower"));
  assert.ok(roofPart.includes(`data-bubble="${release.id}"`) && roofPart.includes("Publicar en Bandeja"));
  assert.equal(opened.slice(opened.indexOf("edi-tower")).includes("data-bubble"), false);
});

// ---- PLA-I39-6

const side = await load("components/compania/edificio/side.tsx");
const timon = await load("components/compania/timon.tsx");
const companiaLib = await load("lib/compania.ts");
STATEFUL.add(timon.Detalles);
const taller = member("taller", {
  state: "running",
  now: { ticket: "WRK-3", title: "Pantalla del carrito", since: "2026-11-10T17:20:00Z", run_id: "00000000-0000-4000-8000-0000000000r1" },
  queue: [{ key: "WRK-5", title: "Guardar el carrito" }, { key: "WRK-6", title: "Pagar" }],
  produced: { kind: "doc", ref: "00000000-0000-4000-8000-0000000000d1", title: "Notas del carrito" },
  last: { ticket: "WRK-2", title: "Lista", status: "ok", at: "2026-11-10T15:00:00Z", run_id: "00000000-0000-4000-8000-0000000000r0" },
});
const steerSpy = () => {
  const calls: Json[] = [];
  const steer = {
    onAsk: async (slug: string, input: Json) => (calls.push({ ask: slug, ...input }), { key: "WRK-9", title: "x", po: "po", wake: "off", woke: null }),
    onPickNext: (slug: string, key: string) => calls.push({ next: slug, key }),
    onPause: (p: Json) => calls.push({ pause: p.slug }),
    onRun: (action: string, id: string) => calls.push({ run: action, id }),
    onNote: (slug: string, key: string, text: string) => calls.push({ note: slug, key, text }),
    onCancelOrder: (slug: string, key: string) => calls.push({ cancel: slug, key }),
    onOptions: noop,
    busy: null,
  };
  return { steer, calls };
};
const memberPage = (m: Json, extra: Json = {}) => h(side.MemberPage, { project: project({ team: [m] }), member: m, now: NOW, steer: steerSpy().steer, text: "", setText: noop, onSay: noop, ...extra });

test("I39-6 #1: a window opens that teammate's page with what it is on, its queue and its last delivery; the address carries ?m=", () => {
  const out = html(memberPage(taller));
  assert.ok(out.includes("Pantalla del carrito") && out.includes("desde hace 40 min"));
  assert.ok(out.includes('data-queue="2"') && out.includes("Guardar el carrito") && out.includes("Pagar"));
  assert.ok(out.includes("Notas del carrito") && out.includes("data-produced"));
  clean(out);
  // The address: ?m=<slug>:<agent>, and reading it back opens the same page (a reload reopens it).
  const search = companiaLib.sheetSearch({ kind: "member", slug: "workia", agent: "taller-workia" });
  assert.equal(search, "?m=workia:taller-workia");
  assert.deepEqual(companiaLib.sheetOf(search), { kind: "member", slug: "workia", agent: "taller-workia" });
  assert.deepEqual(companiaLib.sheetOf("?plan=workia"), { kind: "plan", slug: "workia" });
  assert.deepEqual(companiaLib.sheetOf("?add=workia"), { kind: "add", slug: "workia" });
  assert.deepEqual(companiaLib.sheetOf("?doc=d-1"), { kind: "doc", id: "d-1" });
  assert.deepEqual(companiaLib.sheetOf("?nuevo"), { kind: "nuevo" });
  // A window click goes there.
  const opened: string[] = [];
  const [win0] = findAll(tree(company({ projects: [project({ team: [taller] })] }), { onOpen: (slug: string, m: Json) => opened.push(companiaLib.sheetSearch({ kind: "member", slug, agent: m.agent })) }), (el) => el.props?.["data-agent"] === "taller-workia");
  win0!.props.onClick({ currentTarget: {} });
  assert.deepEqual(opened, ["?m=workia:taller-workia"]);
  const page = readFileSync(new URL("../ui/src/pages/ceo.tsx", import.meta.url), "utf8");
  assert.ok(page.includes('sheetSearch({ kind: "member", slug, agent: m.agent })') && page.includes("sheetOf(location.search)"));
});

test("I39-6 #2: Dile algo notes the teammate's current ticket, or sends an order to the PO naming the role", () => {
  assert.deepEqual(lib.sayTo(taller, "  usa el verde  "), { kind: "note", key: "WRK-3", text: "usa el verde" });
  assert.deepEqual(lib.sayTo(member("artist"), "otro boceto"), { kind: "order", text: "Para Artist: otro boceto" });
  assert.deepEqual(lib.sayTo(member("product-owner"), "prioriza pagos"), { kind: "order", text: "prioriza pagos" });
  assert.equal(lib.sayTo(taller, " a "), null);
  const said: Json[] = [];
  const view = expand(memberPage(taller, { text: "usa el verde", onSay: (x: Json) => said.push(x) }));
  const [form] = findAll(view, (el) => el.type === "form" && "data-say" in el.props);
  form!.props.onSubmit({ preventDefault: noop });
  assert.deepEqual(said, [{ kind: "note", key: "WRK-3", text: "usa el verde" }]);
});

test("I39-6 #3: Detener shows only for a live run and calls the stop route", () => {
  const { steer, calls } = steerSpy();
  const view = expand(memberPage(taller, { steer }));
  const [stop] = control(view, "detener");
  stop!.props.onClick();
  assert.deepEqual(calls, [{ run: "stop", id: "00000000-0000-4000-8000-0000000000r1" }]);
  assert.equal(html(memberPage(member("taller", { last: taller.last }))).includes('data-control="detener"'), false);
  const stopped = member("taller", { last: { ...taller.last, status: "stopped" } });
  const again = steerSpy();
  control(expand(memberPage(stopped, { steer: again.steer })), "reanudar-corrida")[0]!.props.onClick();
  assert.deepEqual(again.calls, [{ run: "resume", id: "00000000-0000-4000-8000-0000000000r0" }]);
  const page = readFileSync(new URL("../ui/src/pages/ceo.tsx", import.meta.url), "utf8");
  assert.ok(page.includes('action === "stop" ? api.stopRun(id) : api.resumeRun(id)'));
});

test("I39-6 #4: the plan page lists in progress, next and blocked, and your orders; Hacer primero and Quitar call their routes", () => {
  const sheet = {
    slug: "workia",
    title: "Workia",
    goal: null,
    pipeline: [],
    in_progress: [{ key: "WRK-3", title: "Pantalla del carrito", status: "In progress", owner: "Taller Workia" }],
    blocked: [{ key: "WRK-8", title: "Pagos con tarjeta", status: "Blocked", why: "falta la cuenta" }],
    next: [{ key: "WRK-5", title: "Guardar el carrito", priority: "P1", yours: false }],
    runs: [],
    bot_work: 1,
  };
  const orders = [{ id: "o-1", kind: "order", key: "WRK-9", title: "Una portada de otoño", text: null, at: "2026-11-10T12:00:00Z", state: "enviada", stage: "enviada", understood: null, who: null, link: null, age_h: 2, plan: null, run: null }];
  const p = project({ orders });
  const { steer, calls } = steerSpy();
  const el = h(side.PlanPage, { project: p, sheet, now: NOW, steer, onFijar: noop });
  const out = html(el);
  for (const t of ["Pantalla del carrito", "Guardar el carrito", "Pagos con tarjeta", "falta la cuenta", "Una portada de otoño"]) assert.ok(out.includes(t), t);
  assert.ok(out.includes('data-section="en-curso"') && out.includes('data-section="sigue"') && out.includes('data-section="bloqueado"') && out.includes('data-section="pedidos"'));
  const view = expand(el);
  control(view, "hacer-primero")[0]!.props.onClick();
  control(view, "quitar")[0]!.props.onClick();
  control(view, "pausar")[0]!.props.onClick();
  assert.deepEqual(calls, [{ next: "workia", key: "WRK-9" }, { cancel: "workia", key: "WRK-9" }, { pause: "workia" }]);
  const page = readFileSync(new URL("../ui/src/pages/ceo.tsx", import.meta.url), "utf8");
  assert.ok(page.includes("api.pickNext(slug, key)") && page.includes("api.cancelOrder(slug, key)"));
  // The project's name opens the plan.
  const plans: string[] = [];
  control(tree(company(), { onPlan: (x: Json) => plans.push(x.slug) }), "plan")[0]!.props.onClick({ currentTarget: {} });
  assert.deepEqual(plans, ["workia"]);
});

test("I39-6 #5: adding someone lists only the templates not on the team; the new window shows after the next read", () => {
  const added: string[] = [];
  const el = h(side.AddPage, { templates: [{ slug: "qa", title: "QA" }, { slug: "copy", title: "Copy" }], onAdd: (t: string) => added.push(t) });
  const out = html(el);
  assert.ok(out.includes('data-templates="2"') && out.includes("QA") && out.includes("Copy"));
  findAll(expand(el), (x) => x.props?.["data-add"] === "qa")[0]!.props.onClick();
  assert.deepEqual(added, ["qa"]);
  assert.ok(html(h(side.AddPage, { templates: [], onAdd: noop })).includes('data-empty="templates"'));
  // The "+" window opens it; after the next read the new teammate has its window.
  const opened: string[] = [];
  control(tree(company(), { onAdd: (slug: string) => opened.push(slug) }), "sumar")[0]!.props.onClick({ currentTarget: {} });
  assert.deepEqual(opened, ["workia"]);
  const after = render(company({ projects: [project({ team: [...project().team, member("qa")] })] }), { onAdd: noop });
  assert.ok(after.includes('data-agent="qa-workia"') && after.includes('data-prop="magnifier"'));
  const page = readFileSync(new URL("../ui/src/pages/ceo.tsx", import.meta.url), "utf8");
  assert.ok(page.includes("api.addToTeam(v.slug, v.template)") && page.includes('invalidateQueries({ queryKey: ["company"] })'));
});

// ---- PLA-I39-7

const ask = await load("components/compania/edificio/ask.tsx");
const fab = await load("components/compania/edificio/asistente.tsx");
const askView = (patch: Json = {}) => h(ask.AskView, { project: project(), text: "", setText: noop, now: false, setNow: noop, onSubmit: noop, ...patch });

test("I39-7 #1: a floor has one box and one send button; sending posts the text, with Que empiece ya also now: true; the plate confirms", () => {
  const out = render(company(), { askFor: (p: Json) => h(ask.AskView, { project: p, text: "", setText: noop, now: false, setNow: noop, onSubmit: noop }) });
  const floor = out.slice(out.indexOf('data-floor="workia"'));
  assert.equal((floor.match(/<input[^>]*type="text"/g) ?? []).length, 1);
  assert.equal((floor.match(/data-control="pedir"/g) ?? []).length, 1);
  assert.ok(floor.includes("Pide algo para Workia") && floor.includes("Que empiece ya"));
  assert.equal(/data-kind="(cambio|direccion|idea)"/.test(floor), false, "no kind picker");
  const sent: Json[] = [];
  const view = expand(askView({ text: "  un botón de WhatsApp  ", now: true, onSubmit: (i: Json) => sent.push(i) }));
  findAll(view, (el) => el.type === "form")[0]!.props.onSubmit({ preventDefault: noop });
  assert.deepEqual(sent, [{ text: "un botón de WhatsApp", now: true }]);
  const later: Json[] = [];
  findAll(expand(askView({ text: "otra cosa", onSubmit: (i: Json) => later.push(i) })), (el) => el.type === "form")[0]!.props.onSubmit({ preventDefault: noop });
  assert.deepEqual(later, [{ text: "otra cosa", now: false }]);
  // Too short: nothing is sent.
  const none: Json[] = [];
  findAll(expand(askView({ text: "ok", onSubmit: (i: Json) => none.push(i) })), (el) => el.type === "form")[0]!.props.onSubmit({ preventDefault: noop });
  assert.deepEqual(none, []);
  // The plate says where it landed, in plain words.
  assert.equal(lib.askedLine({ key: "WRK-9", title: "x", po: "po-workia", wake: "queued", woke: { woke: true, reason: "started", ticket: "WRK-9", summary: "" } }, "Workia"), "Le llegó a el PO de Workia y ya está en ello.");
  assert.equal(lib.askedLine({ key: "WRK-9", title: "x", po: "po-workia", wake: "queued", woke: null }, "Workia"), "Le llegó a el PO de Workia; lo toma en su turno.");
  const confirmed = html(askView({ sent: "Le llegó a el PO de Workia; lo toma en su turno." }));
  assert.ok(confirmed.includes("data-sent") && confirmed.includes("lo toma en su turno"));
  clean(confirmed);
  const page = readFileSync(new URL("../ui/src/pages/ceo.tsx", import.meta.url), "utf8");
  assert.ok(page.includes("steer.onAsk(slug, { text: input.text, now: input.now })") && page.includes("api.askProject(slug, input)"));
});

test("I39-7 #2: while the box has text the PO's window says Recibiría tu pedido; clearing it removes the line", () => {
  const typing = render(company(), { typing: { workia: true } });
  assert.match(typing, /data-state="ghost" data-agent="product-owner-workia"/);
  assert.ok(typing.includes("Recibiría tu pedido"));
  const cleared = render(company(), { typing: { workia: false } });
  assert.equal(cleared.includes("Recibiría tu pedido"), false);
  assert.equal(cleared.includes('data-state="ghost"'), false);
  // The box reports typing on every change.
  const box = readFileSync(new URL("../ui/src/components/compania/edificio/ask.tsx", import.meta.url), "utf8");
  assert.ok(box.includes("onTyping?.(project.slug, v.trim().length > 0)"));
});

test("I39-7 #3: the floating button shows the unread count and a dot when Asistente waits; it opens the thread in the side page", () => {
  const out = html(h(fab.AsistenteFab, { unread: 3, waiting: true, onOpen: noop }));
  assert.ok(out.includes('data-unread="3"') && out.includes('class="edi-badge"') && out.includes(">3<") && out.includes("edi-fab-dot") && out.includes('data-waiting="1"'));
  assert.ok(out.includes("3 mensajes sin leer, te espera"));
  const quiet = html(h(fab.AsistenteFab, { unread: 0, waiting: false, onOpen: noop }));
  assert.equal(quiet.includes("edi-badge") || quiet.includes("edi-fab-dot"), false);
  const opened: number[] = [];
  expand(h(fab.AsistenteFab, { unread: 0, waiting: false, onOpen: () => opened.push(1) }));
  (expand(h(fab.AsistenteFab, { unread: 0, waiting: false, onOpen: () => opened.push(1) })) as El).props.onClick({ currentTarget: {} });
  assert.deepEqual(opened, [1]);
  assert.deepEqual(companiaLib.sheetOf("?asistente"), { kind: "asistente" });
  const page = readFileSync(new URL("../ui/src/pages/ceo.tsx", import.meta.url), "utf8");
  assert.ok(page.includes('sheet?.kind === "asistente"') && page.includes("<ThreadPanel") && page.includes("onSend={asistente.onSend}") && page.includes("useThread(company?.asistente.thread_id"));
});

test("I39-7 #4: no 360 px column and no folded Asistente remain on the page", () => {
  const page = readFileSync(new URL("../ui/src/pages/ceo.tsx", import.meta.url), "utf8");
  assert.equal(page.includes("360px") || page.includes("AsistenteFolded") || page.includes("lg:grid-cols"), false);
});

// ---- PLA-I39-8

const clock = await load("components/compania/edificio/clock.tsx");
const H = (patch: Json = {}): Json => ({
  from: "2026-11-09T22:00:00.000Z",
  to: "2026-11-10T18:00:00.000Z",
  projects: [
    {
      slug: "workia",
      runs: [
        { agent: "taller-workia", role: "taller", ticket: "WRK-3", title: "Pantalla del carrito", from: "2026-11-10T10:00:00.000Z", to: "2026-11-10T12:00:00.000Z", status: "ok" },
        { agent: "product-owner-workia", role: "product-owner", ticket: null, title: null, from: "2026-11-10T17:30:00.000Z", to: null, status: "running" },
      ],
      events: [
        { at: "2026-11-10T02:00:00.000Z", kind: "ordered", role: "jorge", title: "Una tienda de prueba" },
        { at: "2026-11-10T12:00:00.000Z", kind: "delivered", role: "taller", title: "Pantalla del carrito" },
        { at: "2026-11-10T15:00:00.000Z", kind: "asked", role: "research", title: "¿Qué tienda?" },
      ],
    },
  ],
  ...patch,
});
const T = (iso: string) => Date.parse(iso);

test("I39-8 #1: at a past time a window is lit exactly when a run of that teammate covers it, first and last minute included", () => {
  const hist = H();
  assert.equal(lib.litAt(hist, "workia", "taller-workia", T("2026-11-10T09:59:59Z")), false);
  assert.equal(lib.litAt(hist, "workia", "taller-workia", T("2026-11-10T10:00:00Z")), true);
  assert.equal(lib.litAt(hist, "workia", "taller-workia", T("2026-11-10T10:00:59Z")), true);
  assert.equal(lib.litAt(hist, "workia", "taller-workia", T("2026-11-10T11:59:00Z")), true);
  assert.equal(lib.litAt(hist, "workia", "taller-workia", T("2026-11-10T12:00:00Z")), true);
  assert.equal(lib.litAt(hist, "workia", "taller-workia", T("2026-11-10T12:00:01Z")), false);
  // A live run reaches now.
  assert.equal(lib.litAt(hist, "workia", "product-owner-workia", T("2026-11-10T17:59:00Z")), true);
  assert.equal(lib.litAt(hist, "workia", "research-workia", T("2026-11-10T11:00:00Z")), false);
  assert.equal(lib.litAt(hist, "otro", "taller-workia", T("2026-11-10T11:00:00Z")), false);
  // On the building: at 11:00 only Taller is lit, with what it was on; the rest are dark.
  const out = render(company({ projects: [project({ team: [member("product-owner", { state: "running" }), member("taller")] })] }), { past: { at: T("2026-11-10T11:00:00Z"), history: hist } });
  assert.match(out, /data-state="work" data-agent="taller-workia"/);
  assert.match(out, /data-state="idle" data-agent="product-owner-workia"/);
  assert.ok(out.includes("Pantalla del carrito") && out.includes('data-mode="past"'));
  clean(out);
});

test("I39-8 #2: marks sit at their event times, and the arrow keys move to the previous and next event", () => {
  const hist = H();
  const marks = lib.marksOf(hist);
  assert.deepEqual(marks.map((m: Json) => [m.kind, Math.round(m.pct * 10) / 10]), [["ordered", 20], ["delivered", 70], ["asked", 85]]);
  assert.equal(lib.stepEvent(marks, T("2026-11-10T11:00:00Z"), 1), T("2026-11-10T12:00:00Z"));
  assert.equal(lib.stepEvent(marks, T("2026-11-10T12:00:00Z"), -1), T("2026-11-10T02:00:00Z"));
  assert.equal(lib.stepEvent(marks, T("2026-11-10T16:00:00Z"), 1), null);
  const out = html(h(clock.ClockBar, { history: hist, at: null, onAt: noop, onPlay: noop, onNow: noop }));
  assert.ok(out.includes('style="left:20%"') && out.includes('style="left:70%"') && out.includes('style="left:85%"'));
  const moved: number[] = [];
  let nowed = 0;
  const bar = (at: number | null) => expand(h(clock.ClockBar, { history: hist, at, onAt: (t: number) => moved.push(t), onPlay: noop, onNow: () => nowed++ }));
  const key = (at: number | null, k: string) => findAll(bar(at), (el) => el.props?.["data-control"] === "reloj")[0]!.props.onKeyDown({ key: k, preventDefault: noop });
  key(T("2026-11-10T11:00:00Z"), "ArrowRight");
  key(T("2026-11-10T11:00:00Z"), "ArrowLeft");
  key(null, "ArrowLeft");
  key(T("2026-11-10T16:00:00Z"), "ArrowRight");
  assert.deepEqual(moved, [T("2026-11-10T12:00:00Z"), T("2026-11-10T02:00:00Z"), T("2026-11-10T15:00:00Z")]);
  assert.equal(nowed, 1, "past the last event the arrow goes back to now");
});

test("I39-8 #3: in the past every action is disabled, and Volver a ahora restores the live view", () => {
  const hist = H();
  const ds = [decision()];
  const askFor = (p: Json) => h_ask(p, true);
  const out = render(company({ decisions: ds }), { acts: acts(), past: { at: T("2026-11-10T11:00:00Z"), history: hist }, onNow: noop, askFor });
  assert.ok(/data-bubble="q-[^"]+"[^>]*inert=""/.test(out), "the question is inert");
  assert.ok(out.includes("Estás viendo las") && out.includes('data-control="volver"'));
  assert.ok(/<input[^>]*type="text"[^>]*disabled=""/.test(out) && /data-control="pedir"[^>]*disabled=""|disabled=""[^>]*data-control="pedir"/.test(out));
  const css = readFileSync(new URL("../ui/src/index.css", import.meta.url), "utf8");
  assert.ok(css.includes('.edi[data-mode="past"] .edi-ask') && css.includes("pointer-events: none"));
  const live = render(company({ decisions: ds }), { acts: acts() });
  assert.equal(/inert=""/.test(live) || live.includes("Estás viendo las"), false);
  let back = 0;
  const [btn] = control(expand(h(clock.ClockBar, { history: hist, at: T("2026-11-10T11:00:00Z"), onAt: noop, onPlay: noop, onNow: () => back++ })), "volver-a-ahora");
  btn!.props.onClick();
  control(tree(company(), { past: { at: T("2026-11-10T11:00:00Z"), history: hist }, onNow: () => back++ }), "volver")[0]!.props.onClick();
  assert.equal(back, 2);
  assert.equal(html(h(clock.ClockBar, { history: hist, at: null, onAt: noop, onPlay: noop, onNow: noop })).includes("volver-a-ahora"), false);
  const page = readFileSync(new URL("../ui/src/pages/ceo.tsx", import.meta.url), "utf8");
  assert.ok(page.includes("disabled={company.company.paused || past != null}") && page.includes("setViewAt(null)"));
});
const h_ask = (p: Json, disabled: boolean) => h(ask.AskView, { project: p, text: "", setText: noop, now: false, setNow: noop, onSubmit: noop, disabled });

test("I39-8 #4: the bar cannot be dragged past now", () => {
  const hist = H();
  const to = T(hist.to);
  assert.equal(lib.timeAt(lib.RANGE + 500, hist), to);
  assert.equal(lib.timeAt(lib.RANGE, hist), to);
  assert.equal(lib.clampTime(to + 3_600_000, hist), to);
  assert.equal(lib.clampTime(T(hist.from) - 1, hist), T(hist.from));
  assert.equal(lib.valueAt(to + 3_600_000, hist), lib.RANGE);
  const seen: (number | string)[] = [];
  const range = (at: number | null) => findAll(expand(h(clock.ClockBar, { history: hist, at, onAt: (t: number) => seen.push(t), onPlay: noop, onNow: () => seen.push("now") })), (el) => el.props?.["data-control"] === "reloj")[0]!;
  const r = range(null);
  assert.equal(r.props.max, lib.RANGE);
  r.props.onChange({ target: { value: String(lib.RANGE) } });
  r.props.onChange({ target: { value: "500" } });
  assert.deepEqual(seen, ["now", T(hist.from) + (to - T(hist.from)) / 2]);
  assert.ok(seen.every((x) => x === "now" || (x as number) <= to));
});

// ---- PLA-I39-9

// WCAG relative luminance and contrast; colours are read from index.css so the test follows the stylesheet.
const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const contrast = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
};
// a over b at alpha (the floor's hue tint is 11 % over the wall).
const over = (a: string, b: string, alpha: number) =>
  "#" + [1, 3, 5].map((i) => Math.round(parseInt(a.slice(i, i + 2), 16) * alpha + parseInt(b.slice(i, i + 2), 16) * (1 - alpha)).toString(16).padStart(2, "0")).join("");

test("I39-9 #2: every window is named with role, state and what it is on; the tab order goes from a window to its question", () => {
  const team = [
    member("product-owner", { state: "waiting_jorge", waiting: "¿Qué tienda?" }),
    member("research"),
    member("taller", { state: "running", now: { ticket: "WRK-3", title: "Pantalla del carrito", since: "2026-11-10T17:20:00Z" } }),
  ];
  const out = render(company({ projects: [project({ team })], decisions: [proposal] }), { acts: acts(), onOpen: noop });
  const names = [...out.matchAll(/<button type="button" class="edi-win"[^>]*aria-label="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(names, ["PO de Workia, te espera: Te pregunta algo, ¿Qué tienda?", "Research de Workia, libre: Sin trabajo", "Taller de Workia, trabajando: Pantalla del carrito, desde hace 40 min"]);
  // DOM order (the tab order): the PO's window, then its question, then the next window.
  const po = out.indexOf('data-agent="product-owner-workia"');
  const q = out.indexOf(`data-bubble="${proposal.id}"`);
  const next = out.indexOf('data-agent="research-workia"');
  assert.ok(po < q && q < next, "window → its question → the next window");
  const firstButtonInQuestion = out.indexOf("<button", q);
  assert.ok(firstButtonInQuestion < next, "the question's controls come before the next window");
});

test("I39-9 #3: caption, plate and question text on the night panel reach 4.5:1", () => {
  const css = readFileSync(new URL("../ui/src/index.css", import.meta.url), "utf8");
  const v = (name: string, scope: string) => new RegExp(`${scope}[\\s\\S]*?${name}: (#[0-9a-f]{6})`, "i").exec(css)![1]!;
  const wall = v("--e-wall", "\\.edi \\{");
  const fg = v("--e-fg", "\\.edi \\{");
  const muted = v("--e-muted", "\\.edi \\{");
  const youInk = v("--e-you-ink", "\\.edi \\{");
  const workInk = /\.edi-win\[data-state="work"\] \.edi-do \{ color: (#[0-9a-f]{6})/.exec(css)![1]!;
  const darkCard = v("--card", "\\.dark \\{");
  const darkFg = v("--foreground", "\\.dark \\{");
  const darkMuted = v("--muted-foreground", "\\.dark \\{");
  // The worst floor background: the brightest hue tinted 11 % over the wall.
  const floors = lib.HUES.map((h: string) => over(h, wall, 0.11));
  const pairs: [string, string, string][] = [];
  for (const bg of [wall, ...floors]) {
    pairs.push(["plate and caption text", fg, bg], ["muted caption and plate lines", muted, bg], ["asking captions", youInk, bg], ["working caption", workInk, bg]);
  }
  pairs.push(["question text", darkFg, darkCard], ["question muted text", darkMuted, darkCard], ["question eyebrow", youInk, darkCard]);
  const low = pairs.map(([what, a, b]) => ({ what, a, b, ratio: Math.round(contrast(a, b) * 100) / 100 })).filter((p) => p.ratio < 4.5);
  assert.deepEqual(low, []);
  const worst = Math.min(...pairs.map(([, a, b]) => contrast(a, b)));
  console.log(`edificio contrast: worst ${worst.toFixed(2)}:1 over ${pairs.length} pairs`);
});

test("I39-9 live: the sky quotes Asistente only from a run that finished ok; the button keeps clear of the clock on a phone", () => {
  const skipped = render(company({ asistente: { ...company().asistente, last_run: { status: "skipped", at: "2026-11-10T17:00:00Z", summary: "skipped: BUDGET/STOPPED asistente at 177%" } } }));
  assert.equal(skipped.includes("BUDGET") || skipped.includes("data-asistente-line"), false);
  assert.ok(render(company()).includes("Resumen: Workia avanza."));
  const css = readFileSync(new URL("../ui/src/index.css", import.meta.url), "utf8");
  // The clock is 76 px tall on a phone; the button sits 88 px above its bottom edge, so 12 px apart.
  assert.ok(css.includes(".edi-fab { bottom: calc(4.5rem + 8px + 88px + env(safe-area-inset-bottom, 0px)); }"));
});
