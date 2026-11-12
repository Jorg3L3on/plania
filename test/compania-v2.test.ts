// PLA-I35-2/3/4: Compañía v2 rendered with fake data (Design afdb15dd v2, canvas docs/company-mockups/compania-v2.html).
// Te toca with named options, the card as a report, En pausa as a list, Asistente folded; one test per state of
// the Design's Scope. The whole page's blocks are scanned: never "Sin corridas todavía", never a null key, no money.
// Server-rendered with react-dom/server; no browser, no database.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";

(globalThis as { React?: unknown }).React = React;
const load = async (p: string) => (await import(new URL(`../ui/src/${p}`, import.meta.url).href)) as Record<string, any>;
const v2 = await load("components/compania/v2.tsx");
const lib = await load("lib/v2.ts");

const h = React.createElement;
const html = (el: React.ReactElement) => renderToStaticMarkup(h(MemoryRouter, null, el));
const noop = () => {};
const NOW = new Date("2026-11-09T03:00:00Z").getTime();
const TZ = "America/Mexico_City";
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;
const clean = (s: string) => {
  assert.equal(s.includes("Sin corridas todavía"), false, "never Sin corridas todavía");
  assert.equal(/\bnull\b|\bundefined\b|NaN|\[object Object\]/.test(s), false, "never a null key");
  assert.equal(/\$|USD/.test(s), false, "tokens, never money");
};

const budget = (used: number, limit: number) => {
  const pct = Math.floor((used / limit) * 1000) / 10;
  return { used, limit, pct, state: pct >= 100 ? "stopped" : pct >= 80 ? "warn" : "ok", reason: null };
};
const member = (role: string, slug: string, patch: Record<string, unknown> = {}) => ({
  agent: role === "product-owner" ? `po-${slug}` : `${role}-${slug}`,
  role,
  template: role,
  state: "idle",
  now: null,
  last: null,
  produced: null,
  waiting: null,
  ...patch,
});
const team = (slug: string, patch: Record<string, Record<string, unknown>> = {}) => ["product-owner", "research", "artist", "taller"].map((r) => member(r, slug, patch[r] ?? {}));
const project = (slug: string, title: string, patch: Record<string, unknown> = {}) => ({
  slug,
  title,
  paused: false,
  light: "ok",
  goal: "Meta de prueba",
  budget: budget(1_250_000, 6_000_000),
  team: team(slug),
  thread: { id: `t-${slug}`, unread: 0, last: null },
  plan: null,
  this_week: { done: 0, docs: 0, prs: 0, last_at: "2026-11-08T20:00:00Z" },
  next: null,
  work: { open: 0, in_progress: 0 },
  ...patch,
});

const MIANOVIA = project("mianovia", "Mianovia", {
  light: "needs_jorge",
  plan: { initiative: { key: "MIA-I1", title: "Arranque y configuración" }, done: 3, total: 5, start_on: "2026-11-02", due_on: "2026-12-12", weeks: 6, today_pct: 12, done_pct: 30, pace: "ok", weeks_behind: 0, forecast_on: "2026-12-12" },
  this_week: { done: 3, docs: 1, prs: 0, last_at: "2026-11-09T02:08:00Z" },
  next: { title: "Kickoff con la boutique", key: "MIA-I1-1", owner: "jorge", due: null },
  thread: { id: "t-mianovia", unread: 1, last: { at: "2026-11-09T02:08:00Z", author_role: "product-owner", body: "Leí el proyecto. Propongo tres pasos para no esperar el kickoff y recomiendo el primero." } },
});
const PAUSED = ["filmia:Filmia:22", "workia:Workia:5", "micasa:MiCasa:0", "plania:Plania:0", "zigzag:Zigzag:0"].map((x) => {
  const [slug, title, open] = x.split(":");
  return project(slug!, title!, { paused: true, light: "paused", work: { open: Number(open), in_progress: 0 }, this_week: { done: 0, docs: 0, prs: 0, last_at: "2026-11-03T02:00:00Z" } });
});

const proposal = (patch: Record<string, unknown> = {}) => ({
  id: "m-00000000-0000-4000-8000-000000000001",
  project: "mianovia",
  title: "Propongo tres pasos para no esperar el kickoff",
  kind: "proposal",
  options: [
    { n: 1, label: "Planear el formulario con las respuestas por defecto del borrador, provisional", recommended: true },
    { n: 2, label: "Wireframes del formulario (375 y 768 px) para llevarlos al kickoff", recommended: false },
    { n: 3, label: "Research sin costo: anti-spam del formulario y acceso al panel", recommended: false },
  ],
  actions: ["elegir", "responder"],
  state: null,
  at: "2026-11-09T02:08:00Z",
  ref: null,
  detail: "1 y 2 pueden ir en paralelo.",
  ...patch,
});
const kickoff = (patch: Record<string, unknown> = {}) => ({
  id: "t-00000000-0000-4000-8000-000000000002",
  project: "mianovia",
  title: "Kickoff con la boutique",
  kind: "action",
  options: null,
  actions: ["hecho", "aplazar"],
  state: null,
  at: "2026-11-04T21:00:00Z",
  ref: "MIA-I1-1",
  detail: "Llevar el borrador Campos y flujos.",
  ...patch,
});
const TITLES = { mianovia: "Mianovia" };
const teToca = (decisions: unknown[]) => html(h(v2.TeToca, { decisions, titles: TITLES, now: NOW, busy: null, onAct: noop }));
const card = (p: Record<string, unknown>, decisions: unknown[] = []) => html(h(v2.ProjectReport, { project: p, decisions, now: NOW, companyPaused: false, timeZone: TZ }));

const msg = (id: string, at: string, patch: Record<string, unknown> = {}) => ({
  id,
  at,
  author: { agent: "asistente", role: "asistente" },
  body: `Mensaje ${id}`,
  links: [],
  actions: [],
  action_state: null,
  question_id: null,
  ...patch,
});
const THREAD = {
  id: "t-company",
  kind: "company",
  project: null,
  messages: [
    msg("a1", "2026-11-09T02:55:00Z", { author: { agent: "jorge", role: "ceo" }, body: "¿Dónde quedó Mianovia?" }),
    msg("a2", "2026-11-09T02:56:00Z", { body: "Semana 1 de 5, Arranque 3/5. Su PO te propuso 3 pasos; está arriba, en Te toca." }),
    msg("a3", "2026-11-09T02:57:00Z", { author: { agent: "jorge", role: "ceo" }, body: "Gracias" }),
    msg("a4", "2026-11-09T02:58:00Z", { body: "De nada." }),
  ],
};
const asistente = (patch: Record<string, unknown> = {}) =>
  html(
    h(v2.AsistenteFolded, {
      thread: THREAD,
      loading: false,
      error: false,
      onRetry: noop,
      projects: [MIANOVIA, ...PAUSED],
      now: NOW,
      timeZone: TZ,
      send: { kind: "idle" },
      onSend: noop,
      expanded: false,
      onToggle: noop,
      ...patch,
    }),
  );

// ---- PLA-I35-2 Te toca

test("I35-2 a proposal shows its three named options, the recommended one first and primary, 1 + 2 and Responder", () => {
  const out = teToca([proposal(), kickoff()]);
  assert.equal(count(out, /data-option=/g), 3);
  assert.deepEqual([...out.matchAll(/data-option="(\d)"/g)].map((m) => m[1]), ["1", "2", "3"]);
  for (const t of ["Planear el formulario con las respuestas por defecto del borrador, provisional", "Wireframes del formulario", "Research sin costo", "· recomendado", "Responder", "1 y 2 pueden ir en paralelo."]) {
    assert.ok(out.includes(t), t);
  }
  // PLA-I36-7: "1 + 2" only when the PO marked the options combinable.
  assert.equal(out.includes('data-action="combo"'), false);
  assert.ok(teToca([proposal({ combinable: [[1, 2]] })]).includes("1 + 2"));
  const first = out.slice(out.indexOf('data-option="1"'), out.indexOf('data-option="2"'));
  assert.ok(first.includes("bg-foreground"), "the recommended Elegir is the primary button");
  const second = out.slice(out.indexOf('data-option="2"'), out.indexOf('data-option="3"'));
  assert.equal(second.includes("bg-foreground"), false);
  assert.ok(out.includes("Te toca"));
  assert.ok(out.includes('data-te-toca="2"'));
  // A recommended option that is not the first moves to the top.
  const swapped = teToca([proposal({ options: [{ n: 1, label: "Uno", recommended: false }, { n: 2, label: "Dos", recommended: true }] })]);
  assert.deepEqual([...swapped.matchAll(/data-option="(\d)"/g)].map((m) => m[1]), ["2", "1"]);
  clean(out);
});

test("I35-2 Jorge's own ticket shows Hecho / Aplazar with its key and detail", () => {
  const out = teToca([kickoff()]);
  for (const t of ['data-action="hecho"', 'data-action="aplazar"', "MIA-I1-1", "Llevar el borrador", "Kickoff con la boutique", "Mianovia"]) assert.ok(out.includes(t), t);
  assert.equal(count(out, /data-action="elegir"/g), 0);
  clean(out);
});

test("I35-2 an acted row keeps its place, dimmed, with the result written in it and no buttons", () => {
  const acted = proposal({ actions: [], state: { action: "elegir", at: "2026-11-09T02:59:00Z", result: { option: 1, label: "Planear MIA-I2", wake: "queued", ticket: "MIA-7" } } });
  const out = teToca([acted, kickoff()]);
  assert.ok(out.includes("✓ Elegiste 1 · Planear MIA-I2 · el PO despierta en su turno"));
  assert.ok(out.includes('data-acted="1"'));
  assert.ok(out.includes("opacity-60"));
  assert.equal(count(out.slice(0, out.indexOf("Kickoff")), /data-action=/g), 0, "no buttons on the acted row");
  assert.ok(out.includes('data-te-toca="1"'), "only the kickoff still waits");
  assert.equal(lib.stateText({ action: "hecho", at: "x", result: { ticket: "MIA-I1-1", status: "Done" } }), "Hecho", "PLA-I36-11: no key on the main line");
  assert.equal(lib.stateText({ action: "elegir", at: "x", result: { option: [1, 2], label: "A + B", wake: "busy" } }), "Elegiste 1 + 2 · A + B · el PO lo toma al terminar lo que corre");
  clean(out);
});

test("I35-2 empty: Nada te espera. El equipo sigue.", () => {
  const out = teToca([]);
  assert.ok(out.includes("Nada te espera. El equipo sigue; Asistente te avisa cuando haga falta."));
  assert.ok(out.includes('data-te-toca="0"'));
  clean(out);
});

test("I35-2 six decisions show the first five and the link to Bandeja", () => {
  const six = Array.from({ length: 6 }, (_, i) => kickoff({ id: `t-00000000-0000-4000-8000-00000000001${i}`, title: `Cosa ${i + 1}`, ref: `MIA-${i + 1}` }));
  const out = teToca(six);
  assert.equal(count(out, /data-decision=/g), 5);
  assert.ok(out.includes("Cosa 5") && !out.includes("Cosa 6"));
  assert.ok(out.includes('href="/inbox"'));
  assert.ok(out.includes("Todo lo tuyo en Bandeja (1 más)"));
  assert.ok(out.includes('data-te-toca="6"'));
});

// ---- PLA-I35-3 the card as a report, En pausa, Asistente folded

test("I35-3 Mianovia's card (PLA-I36-5: by calendar): Arranque y configuración · 3 de 5 hechos, pace, this week, Siguiente te toca, the PO's line pointing to Te toca", () => {
  const out = card(MIANOVIA, [proposal()]);
  const text = out.replace(/<[^>]+>/g, "").replace(/\s+/g, " ");
  assert.ok(text.includes("Arranque y configuración · 3 de 5 hechos"), text);
  assert.equal(text.includes("Semana 1 de"), false, "no week of a list (PLA-I36-5)");
  for (const t of ["a tiempo · entrega 12 dic", "Esta semana: 3 hechos · 1 doc", "Kickoff con la boutique", "te toca", "Propongo tres pasos", "↑ Decidir en Te toca", "Nadie trabaja ahora", "el PO espera tu elección", "1.25M / 6M · en marcha", "Abrir →"]) {
    assert.ok(text.includes(t), t);
  }
  // Fixed order: Rumbo (PLA-I36-4), plan, this week, Siguiente, the PO's line, Ahora, the foot.
  const order = ["data-rumbo", "data-plan", "data-this-week", "data-next", "data-po-line", "data-now", "data-plumbing"].map((k) => out.indexOf(k));
  assert.deepEqual([...order].sort((a, b) => a - b), order, "the blocks keep their order");
  assert.equal(count(out, /data-action=/g), 0, "a decision lives in Te toca only");
  assert.ok(out.includes('data-rumbo="missing"'), "no rumbo in the payload: Sin meta ni fecha (PLA-I36-4)");
  assert.equal(out.includes("Vista previa"), false);
  clean(out);
});

test("I35-3 state Bien corriendo: one role row, the one that runs; the pace a week behind turns amber", () => {
  const p = project("mianovia", "Mianovia", {
    plan: { initiative: { key: "MIA-I2", title: "Formulario de bienvenida" }, done: 1, total: 6, start_on: "2026-10-20", due_on: "2026-12-12", weeks: 8, today_pct: 40, done_pct: 30, pace: "late", weeks_behind: 1, forecast_on: "2026-12-19" },
    this_week: { done: 1, docs: 0, prs: 1, last_at: "2026-11-09T02:00:00Z" },
    next: { title: "Primera revisión del formulario", key: "MIA-I2-2", owner: "po", due: null },
    team: team("mianovia", { taller: { state: "running", now: { ticket: "MIA-I2-1", since: "2026-11-09T02:32:00Z" } } }),
  });
  const out = card(p);
  assert.equal(count(out, /data-role-row=/g), 1);
  assert.ok(out.includes('data-role-row="Taller"'));
  assert.ok(out.includes(">trabaja<"), "PLA-I36-11: no key on the main line");
  assert.ok(out.includes("1 semana atrás · entrega 12 dic"));
  assert.ok(out.includes('data-pace="late"') && out.includes("text-ink-now"));
  assert.ok(out.includes("Esta semana: 1 hecho · 1 PR"));
  assert.ok(out.includes("Bien"));
  assert.equal(out.includes("Nadie trabaja"), false);
  clean(out);
});

test("I35-3 state Te necesita: the PO's line with ↑ Responder en Te toca and no buttons", () => {
  const q = { ...kickoff(), id: "q-00000000-0000-4000-8000-000000000003", kind: "question", actions: ["responder"], ref: "MIA-I1-5" };
  const out = card(MIANOVIA, [q]);
  assert.ok(out.includes("Te necesita"));
  assert.ok(out.includes("↑ Responder en Te toca"));
  assert.ok(out.includes('href="#te-toca"'));
  assert.equal(count(out, /<button/g), 0);
  clean(out);
});

test("I35-3 state Quieto: Quieto n días, nothing this week, Sin tickets listos, nobody works and why", () => {
  const out = card(project("workia", "Workia", { light: "quiet", this_week: { done: 0, docs: 0, prs: 0, last_at: "2026-11-06T03:00:00Z" } }));
  for (const t of ["Quieto 3 días", "Esta semana: nada · la última vez, hace 3 días", "Sin tickets listos", "Nadie trabaja ahora", "sin trabajo listo"]) assert.ok(out.includes(t), t);
  assert.equal(out.includes("data-plan"), false, "no plan, no plan line");
  clean(out);
});

test("I35-3 state Sin presupuesto: red light, spent of limit and Subir límite as the only way out", () => {
  const p = project("micasa", "MiCasa", {
    light: "no_budget",
    budget: budget(2_000_000, 2_000_000),
    plan: { initiative: { key: "MIC-I4", title: "Pagos" }, done: 2, total: 5, start_on: "2026-10-01", due_on: "2026-12-20", weeks: 12, today_pct: 50, done_pct: 30, pace: "bad", weeks_behind: 2, forecast_on: "2027-01-03" },
  });
  const out = card(p);
  for (const t of ["Sin presupuesto", "Gastó 2M / 2M esta semana", "Subir límite", "2 semanas atrás · entrega 20 dic", "2M / 2M · sin presupuesto"]) assert.ok(out.includes(t), t);
  assert.ok(out.includes('data-pace="bad"'));
  clean(out);
});

test("I35-3 state En pausa: a list with what each keeps and Reanudar; on a phone one row and n más", () => {
  let resumed = "";
  const out = html(h(v2.PausedList, { projects: PAUSED, now: NOW, onResume: (s: string) => (resumed = s) }));
  assert.equal(count(out, /data-paused=/g), 5);
  assert.equal(count(out, /data-control="reanudar"/g), 5);
  for (const t of ["En pausa", "22 tickets abiertos guardados · quieto 6 días", "5 tickets abiertos guardados", "Sin trabajo abierto", "Nada arranca aquí hasta que reanudes", "4 más", "Workia, MiCasa, Plania, Zigzag"]) assert.ok(out.includes(t), t);
  assert.equal(count(out, /max-sm:hidden/g) >= 4, true, "rows after the first hide on a phone");
  assert.equal(resumed, "");
  assert.equal(html(h(v2.PausedList, { projects: [], now: NOW, onResume: noop })), "");
  clean(out);
});

test("I35-3 Asistente folded: box and suggestions, its latest message, Conversación de hoy · 4 mensajes · Ver; expanded shows all", () => {
  const out = asistente();
  for (const t of ["Dile a Asistente…", "¿Cómo va Mianovia?", "¿Qué espera de mí?", "Mianovia: …", "De nada.", "Conversación de hoy · 4 mensajes", ">Ver<"]) assert.ok(out.includes(t), t);
  assert.equal(count(out, /data-message=/g), 1, "folded: one message");
  assert.equal(out.includes("¿Dónde quedó Mianovia?"), false);
  assert.ok(out.includes('data-folded="1"'));
  const open = asistente({ expanded: true });
  assert.equal(count(open, /data-message=/g), 4);
  assert.ok(open.includes("Plegar"));
  clean(out + open);
});

// ---- PLA-I35-4 one test per state of the Design's Scope, and the phone

test("I35-4 state Asistente vacío and Te toca vacío (frame 2e)", () => {
  const out = asistente({ thread: { ...THREAD, messages: [] } }) + teToca([]);
  assert.ok(out.includes("Todavía no hay mensajes. Pregúntame cómo va un proyecto"));
  assert.ok(out.includes("¿Qué espera de mí?"), "suggestions stay");
  assert.ok(out.includes("Nada te espera. El equipo sigue"));
  assert.equal(out.includes('data-control="fold"'), false);
  clean(out);
});

test("I35-4 state carga y error por bloque: skeletons, and Asistente says the Mac may be asleep", () => {
  assert.ok(html(h(v2.ProjectsSkeleton, {})).includes("cards-skeleton"));
  assert.ok(asistente({ thread: undefined, loading: true }).includes("thread-skeleton"));
  const err = asistente({ thread: undefined, error: true });
  assert.ok(err.includes("No se pudo cargar el hilo.") && err.includes("Reintentar") && err.includes("Dile a Asistente…"));
});

test("I35-4 the whole page with fake data: never Sin corridas todavía, never null, tokens only", () => {
  const nobody = project("nuevo", "Nuevo", { team: team("nuevo") });
  const page =
    teToca([proposal(), kickoff()]) +
    asistente() +
    card(MIANOVIA, [proposal(), kickoff()]) +
    card(nobody) +
    card(project("x", "X", { team: [] })) +
    html(h(v2.PausedList, { projects: PAUSED, now: NOW, onResume: noop }));
  clean(page);
  assert.equal(lib.companyLine([MIANOVIA, ...PAUSED]), "Mianovia avanza, cinco proyectos en pausa");
  assert.equal(lib.companyLine([...PAUSED]), "Nada avanza, cinco proyectos en pausa");
});

test("I35-4 phone at 390: Te toca options wrap their Elegir under the label, the card hides Ahora and this week, one column", async () => {
  const out = teToca([proposal()]);
  assert.ok(out.includes("max-sm:flex-wrap") && out.includes("max-sm:ml-6"), "options stack on a phone");
  const c = card(MIANOVIA, [proposal()]);
  assert.ok(/data-this-week[^>]*|max-sm:hidden[^>]*data-this-week/.test(c));
  assert.ok(c.includes('class="grid gap-1 text-sm max-sm:hidden" data-now'), "Ahora hides on a phone");
  const { readFileSync } = await import("node:fs");
  const page = readFileSync(new URL("../ui/src/pages/ceo.tsx", import.meta.url), "utf8");
  assert.ok(page.includes("<Building"));
  assert.ok(page.indexOf("<TeToca") < page.indexOf("<Building"), "Te toca first");
});
