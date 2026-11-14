// PLA-I46-10 and PLA-I46-15 on the floor, rendered with react-dom/server and fake data (no browser, no database;
// fake names only).
//   I46-10  the evidence card in Ahora (tests, separate review, «Check list del PO», the stills, the switch) with
//           Aceptar / Devolver a Taller / Ver PR; the Devolver sheet; after a return the floor is violet with no
//           green button and Ahora shows only a grey «Ver nota»; the switch is off by default and needs the owner
//   I46-15  Una decisión: the layer for a delivery and for a leg's plan, its shortcuts (ignored in fields), focus
//           back to the floor on close, the whole screen on a phone
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
const nowc = await load("components/compania/edificio/now.tsx");
const store = await load("components/compania/edificio/evidence-store.ts");
const ev = await load("lib/evidencia.ts");
const edificio = await load("lib/edificio.ts");

type Json = Record<string, any>;
const h = React.createElement;
const html = (el: React.ReactElement) => renderToStaticMarkup(h(MemoryRouter, null, el));
const noop = () => {};
const NOW = new Date("2026-11-13T20:44:00Z").getTime();
const TZ = "America/Mexico_City";
const text = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const unq = (s: string) => s.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, "&");

const member = (role: string, patch: Json = {}): Json => ({ agent: `${role}-demo`, role, template: role, state: "idle", now: null, last: null, produced: null, waiting: null, queue: [], next_start: null, ...patch });
const project = (patch: Json = {}): Json => ({
  slug: "demo",
  title: "Demo",
  paused: false,
  light: "ok",
  light_reason: null,
  goal: "Tienda lista",
  rumbo: { goal_id: "g", goal: "Tienda lista", why: "", target_on: null, forecast_on: null, weeks_behind: null, missing: true },
  usage: { used: 0, last_week: 0 },
  team: ["product-owner", "taller", "qa"].map((r) => member(r)),
  thread: { id: "t", unread: 0, last: null },
  plan: null,
  route: { legs: [{ key: "DEM-I1", title: "Catálogo", done: 2, total: 3, state: "here", note: null, steps: [] }], more_legs: 0 },
  latest: [],
  stale_requests: [],
  this_week: { done: 2, docs: 0, prs: 0, last_at: null },
  next: null,
  ready: [],
  work: { open: 1, in_progress: 0 },
  orders: [],
  auto_accept: { on: false, hold: null },
  ...patch,
});
const PR = "https://github.com/example/demo/pull/7";
const delivery = (patch: Json = {}): Json => ({
  id: "m-dev-1",
  project: "demo",
  title: "Pantalla de gracias",
  kind: "pr",
  options: null,
  actions: ["fusionar", "cambios"],
  state: null,
  at: "2026-11-13T20:00:00Z",
  ref: "DEM-3",
  detail: null,
  links: [
    { kind: "ticket", ref: "DEM-3", title: "Pantalla de gracias" },
    { kind: "pr", ref: PR, title: "PR #7" },
  ],
  body: "Listo",
  checks: { open: 0, ci: "none" },
  release: null,
  combinable: [],
  recommended_reason: null,
  plan: null,
  evidence: { verdict: "pass", kind: "verify", cite: "QA pasa", pass: 14, fail: 0, at: "2026-11-13T20:00:00Z" },
  files: null,
  preview_url: null,
  hold: null,
  asker: { agent: "taller-demo", role: "taller" },
  file_step: null,
  verify: null,
  ...patch,
});
const READ: Json = {
  project: "demo",
  key: "DEM-3",
  enabled: true,
  state: "pass",
  tests: { pass: 14, total: 14, verdict: "pass", items: [{ name: "test", command: "pnpm test", ok: true, exit_code: 0, pass: 14, fail: 0, duration_s: 9 }] },
  review: { verdict: "pass", notes: "Hace lo que pide el ticket.", model: "sonnet" },
  checklist: [
    { n: 1, text: "Sale el nombre de la novia", mark: "pass", note: null },
    { n: 2, text: "El botón abre WhatsApp", mark: "pass", note: null },
    { n: 3, text: "Se lee bien a 390", mark: "pass", note: null },
  ],
  captures: { ids: ["a", "b"], image_urls: ["/api/projects/demo/captures/a.png", "/api/projects/demo/captures/b.png"], ok: 2, failed: 0, error: null },
  notes: null,
};
const company = (p: Json, ds: Json[]): Json => ({
  company: { paused: false },
  week: { starts_at: "2026-11-09T06:00:00Z", resets_at: "2026-11-16T06:00:00Z", timezone: TZ },
  asistente: { thread_id: "t-co", usage: { used: 0 }, last_run: null, state: "idle", unread: 0 },
  projects: [{ ...p, next_move: nextMove(p as never, ds as never) }],
  plumbing: { spend: 0, running: 0, paused: false },
  decisions: ds,
  inbox: { decisiones: 0, pasos: 0 },
});
const render = (c: Json, extra: Json = {}) =>
  html(
    h(building.Building, {
      company: c,
      decisions: c.decisions,
      now: NOW,
      timeZone: TZ,
      hello: "Buenas noches",
      day: "Viernes 13 de noviembre",
      onNew: noop,
      onFijar: noop,
      onPublish: noop,
      acts: { now: NOW, busy: null, onAct: extra.onAct ?? noop },
      nowActs: { onStart: noop, onPlan: noop, ...(extra.nowActs ?? { onAuto: noop }) },
      askFor: () => h("div", null, "Pedir"),
    }),
  );
const nowCard = (s: string) => /<div(?: id="[^"]+")? class="edi-nowb"[\s\S]*?(?=<div class="edi-slot")/.exec(s)?.[0] ?? "";
const floorOf = (s: string) => s.slice(s.indexOf('data-floor="demo"'), s.indexOf("edi-street"));

test("I46-10: a delivery to accept is one evidence card in Ahora: tests, separate review, check list 3 de 3, stills, three exits", () => {
  const d = delivery();
  store.setRead("demo", "DEM-3", d.id, READ);
  const c = company(project(), [d]);
  assert.deepEqual(c.projects[0].next_move.accion, { kind: "decision", id: d.id, action: "fusionar", label: "Aceptar" });
  const s = render(c);
  const card = nowCard(s);
  assert.ok(card.includes('data-breathe="1"'), "only Ahora breathes, and it is the owner's turn");
  assert.ok(card.includes(`data-evidence="${d.id}"`));
  const t = unq(text(card));
  for (const x of ["Aceptar «Pantalla de gracias»", "Pruebas", "14 de 14", "pasan en la entrega", "Revisión aparte", "Sin hallazgos", "otro agente, sin ver a Taller", "Check list del PO · 3 de 3", "Sale el nombre de la novia", "El botón abre WhatsApp", "Se lee bien a 390", "Capturas de la entrega"]) assert.ok(t.includes(x), x);
  assert.equal((card.match(/<img [^>]*src="\/api\/projects\/demo\/captures\/[ab]\.png"/g) ?? []).length, 2, "the delivery's stills");
  // The three exits: green Aceptar (the move), Devolver a Taller, Ver PR (a link to the PR). «Al frente» is a view.
  assert.match(card, /<button type="button" class="edi-nact edi-go"[^>]*data-where="ahora"[^>]*>Aceptar<\/button>/);
  assert.match(card, /data-ev-act="devolver" aria-expanded="false"[^>]*>Devolver a Taller</);
  assert.ok(card.includes(`href="${PR}"`) && card.includes(">Ver PR<"));
  assert.equal((card.match(/\bedi-go\b/g) ?? []).length, 1, "one green button on the card");
  // No second copy hanging under Taller's window; the Tú window and the phone bar carry the same Aceptar.
  assert.equal(s.includes(`data-bubble="${d.id}"`), false);
  assert.ok(/data-where="tu"[^>]*>Aceptar</.test(s) && /data-where="barra"[^>]*>Aceptar</.test(s));
  // Aceptar runs the same thing from every surface: the floor's fusionar on that delivery.
  const calls: unknown[][] = [];
  const run = nowc.runOf(c.projects[0], c.projects[0].next_move.accion, { decisions: [d], qacts: { now: NOW, busy: null, onAct: (...a: unknown[]) => calls.push(a) } });
  run();
  assert.deepEqual([(calls[0]![0] as Json).id, calls[0]![1]], [d.id, { action: "fusionar" }]);
});

test("I46-10: without a QA read the card says what it has (the ticket's own tests) and that there was no separate review", () => {
  const d = delivery();
  const v = ev.evidenceView(null, d);
  assert.deepEqual(v.tests, { value: "14 de 14", ok: true, sub: "según la última prueba del ticket" });
  assert.deepEqual(v.review, { value: "Sin revisión aparte", ok: null, sub: "no hay QA en este equipo" });
  assert.equal(v.checklist.title, "Check list del PO");
  assert.equal(ev.evidenceView(undefined, d).loading, true);
  const failed = ev.evidenceView({ ...READ, state: "fail", tests: { ...READ.tests, pass: 12, verdict: "fail" }, review: { verdict: "fail", notes: "src/x.ts:12 no filtra", model: null }, checklist: [{ n: 1, text: "Uno", mark: "fail", note: "no" }] }, d);
  assert.deepEqual([failed.tests.value, failed.tests.ok, failed.review.value, failed.checklist.title], ["12 de 14", false, "Encontró algo", "Check list del PO · 0 de 1"]);
});

test("I46-10: Devolver a Taller opens a short sheet: a quick reason (one tap), one optional line, Devolver", () => {
  const d = delivery({ id: "m-dev-2" });
  store.setRead("demo", "DEM-3", d.id, READ);
  store.setReturn(d.id, { open: true, reason: "Falta algo", line: "" });
  const card = nowCard(render(company(project(), [d])));
  assert.match(card, /data-ev-act="devolver" aria-expanded="true"/);
  const sheet = /<form class="edi-sheet"[\s\S]*?<\/form>/.exec(card)?.[0] ?? "";
  assert.deepEqual([...sheet.matchAll(/role="radio" class="edi-popt" aria-checked="(true|false)"[^>]*>([^<]+)/g)].map((m) => [m[2], m[1]]), [
    ["No se ve bien", "false"],
    ["Falta algo", "true"],
    ["El texto", "false"],
    ["Otra cosa", "false"],
  ]);
  assert.ok(sheet.includes('placeholder="Una línea para Taller (opcional)"'));
  assert.match(sheet, /<button type="submit" class="edi-nact edi-back"[^>]*>Devolver<\/button>/);
  assert.ok(sheet.includes(">Cancelar<"));
  // What Taller reads: the reason, then the line when there is one.
  assert.equal(ev.returnText("Falta algo", ""), "Falta algo");
  assert.equal(ev.returnText("El texto", " dice «Enviar»,   no «Mandar» "), "El texto: dice «Enviar», no «Mandar»");
  store.setReturn(d.id, { open: false });
});

test("I46-10 #3: after a return Taller's window is violet («Devuelto · arreglando»), Ahora shows only a grey «Ver nota», and no green button remains", () => {
  const back = delivery({ id: "m-dev-3", actions: [], state: { action: "cambios", at: "2026-11-13T20:30:00Z", result: { ticket: "DEM-3", status: "Ready", text: "No se ve bien: el botón queda cortado", wake: "queued" } } });
  // Taller is even queued for the fix: its next start must not turn into a move.
  const p = project({ team: [member("product-owner"), member("taller", { next_start: { key: "DEM-3", title: "Pantalla de gracias", hold: "unqueued", text: "", starts_at: null } }), member("qa")] });
  const c = company(p, [back]);
  assert.equal(c.projects[0].next_move, null, "the server's move is gone");
  const s = render(c);
  const floor = floorOf(s);
  assert.equal(/\bedi-go\b/.test(floor), false, "no green button on the floor");
  assert.equal(/data-breathe/.test(s), false, "nothing breathes");
  const card = nowCard(s);
  assert.match(card, /data-now="back"/);
  const t = unq(text(card));
  assert.ok(t.includes("Devuelto · arreglando") && t.includes("Taller arregla «Pantalla de gracias».") && t.includes("Vuelve a ti cuando QA lo pase otra vez."), t);
  assert.deepEqual([...card.matchAll(/<button[^>]*>([^<]+)<\/button>/g)].map((m) => m[1]), ["Ver nota"]);
  assert.match(card, /class="edi-btn edi-grey" aria-expanded="false" data-control="ver-nota"/);
  assert.match(floor, /data-state="back" data-agent="taller-demo"[^>]*aria-label="Taller de Demo, devuelto: arreglando"/);
  assert.ok(floor.includes(">Devuelto · arreglando<"));
  assert.ok(s.includes("Nada te toca ahora"), "the phone bar asks nothing");
  // QA's own return reads the same, and says it was QA.
  const qa = delivery({ id: "m-dev-4", actions: [], state: { action: "cambios", at: "2026-11-13T20:31:00Z", result: { by: "qa", text: "QA devolvió la entrega" } } });
  const l = edificio.nowLine({ ...project(), next_move: null }, [qa], NOW);
  assert.deepEqual([l.state, l.word, l.note], ["back", "Devuelto · arreglando", "QA devolvió la entrega"]);
  assert.match(l.why, /^QA lo devolvió\./);
  // A new delivery of the same ticket ends it: that one is the move again.
  const again = delivery({ id: "m-dev-5", at: "2026-11-13T20:40:00Z" });
  assert.equal(edificio.returnedOf("demo", [back, again]), null);
  assert.equal(nextMove(project() as never, [back, again] as never)?.origen.kind, "decision");
});

test("I46-10 #4: «Aceptar sola en la copia de prueba» is on the card, off by default, and only the owner's page can flip it", () => {
  const d = delivery({ id: "m-dev-6" });
  store.setRead("demo", "DEM-3", d.id, READ);
  const off = nowCard(render(company(project({ auto_accept: { on: false, hold: null } }), [d])));
  assert.match(off, /<button type="button" role="switch" class="edi-sw" aria-checked="false" data-control="aceptar-sola-card">/);
  assert.ok(text(off).includes("Aceptar sola en la copia de prueba · apagado"));
  // Without the owner's handler (any page that is not his) the switch is drawn but cannot be used.
  const none = nowCard(render(company(project(), [d]), { nowActs: {} }));
  assert.match(none, /role="switch" class="edi-sw" aria-checked="false" disabled=""/);
  // One switch on screen: Solo tú does not draw a second while the card shows it.
  const s = render(company(project({ latest: [] }), [d]));
  assert.equal(s.includes('data-control="aceptar-sola"'), false);
  assert.equal((s.match(/data-control="aceptar-sola-card"/g) ?? []).length, 1);
  const on = nowCard(render(company(project({ auto_accept: { on: true, hold: "Faltan pruebas que pasen." } }), [d])));
  assert.ok(on.includes('aria-checked="true"') && text(on).includes("· encendido") && text(on).includes("No se aceptó sola: Faltan pruebas que pasen."));
  // The page's call is the screen's PUT …/options (cookie only; test/i46-decision-api.test.ts).
  const page = readFileSync(new URL("../ui/src/pages/ceo.tsx", import.meta.url), "utf8");
  assert.match(page, /onAuto: \(slug: string, on: boolean\)/);
});

test("I46-15 #1 #4: Una decisión opens for an accept-delivery and an accept-plan decision; the building dims; full screen on a phone", () => {
  const d = delivery({ id: "m-dev-7" });
  store.setRead("demo", "DEM-3", d.id, READ);
  assert.equal(render(company(project(), [d])).includes("edi-layer"), false, "closed until asked");
  store.openLayer("demo", d.id, null);
  const s = render(company(project(), [d]));
  const layer = /<div class="edi-layer"[\s\S]*$/.exec(s)?.[0] ?? "";
  assert.match(layer, /data-layer="delivery"/);
  assert.match(layer, /role="dialog" aria-modal="true" aria-labelledby="layer-say-m-dev-7"/);
  assert.ok(unq(text(layer)).includes("Una decisión · Demo") && unq(text(layer)).includes("Aceptar «Pantalla de gracias»") && text(layer).includes("14 de 14"));
  assert.deepEqual([...layer.matchAll(/<button type="button" class="([^"]+)"[^>]*data-layer-(main|second|close)[^>]*>([^<]+)<kbd class="edi-kbd" aria-hidden="true">([^<]+)<\/kbd>/g)].map((m) => [m[3], m[4], m[1]]), [
    ["Aceptar", "A", "edi-nact edi-go"],
    ["Devolver a Taller", "D", "edi-btn"],
    ["Cerrar", "Esc", "edi-btn"],
  ]);
  store.closeLayer();

  // The plan to accept: Aceptar plan (A), Cambiar algo (C), Cerrar (Esc).
  const plan: Json = {
    ...delivery({ id: "m-plan-7", kind: "plan", title: "Pagos", actions: ["empezar", "cambiar", "despues"], ref: null, links: [], evidence: null, asker: { agent: "product-owner-demo", role: "product-owner" } }),
    plan: { order: "DEM-9", understood: "", steps: [{ title: "Pago", done_when: "cobra" }], cost: "", needs_approval: true, created: [], leg: { key: "DEM-I2", title: "Pagos" }, questions: [], checklist: ["a", "b", "c"], later_at: null },
  };
  const pp = project({ route: { legs: [{ key: "DEM-I1", title: "Catálogo", done: 3, total: 3, state: "here", note: null, steps: [] }, { key: "DEM-I2", title: "Pagos", done: 0, total: 0, state: "unplanned", note: null }], more_legs: 0 } });
  assert.ok(nowCard(render(company(pp, [plan]))).includes('data-ev-act="frente"'), "Al frente on the plan too");
  store.openLayer("demo", plan.id, null);
  const ps = render(company(pp, [plan]));
  const pl = /<div class="edi-layer"[\s\S]*$/.exec(ps)?.[0] ?? "";
  assert.match(pl, /data-layer="plan"/);
  assert.deepEqual([...pl.matchAll(/data-layer-(?:main|second|close)[^>]*>([^<]+)<kbd class="edi-kbd" aria-hidden="true">([^<]+)</g)].map((m) => [m[1], m[2]]), [
    ["Aceptar plan", "A"],
    ["Cambiar algo", "C"],
    ["Cerrar", "Esc"],
  ]);
  assert.ok(pl.includes("Check list del PO · la puedes editar"));
  store.closeLayer();

  // A decision that is no longer the move (taken meanwhile) draws no layer.
  store.openLayer("demo", "m-gone", null);
  assert.equal(render(company(project(), [d])).includes('class="edi-layer"'), false);
  store.closeLayer();

  // The CSS: dims behind, centred card on a desktop, the whole screen under 40rem; no motion in this block.
  const css = readFileSync(new URL("../ui/src/index.css", import.meta.url), "utf8");
  const start = css.indexOf("/* PLA-I46-15: Una decisión");
  const block = css.slice(start, css.indexOf("@media (width < 64rem)", start));
  assert.match(block, /\.edi-layer \{[^}]*position: fixed; inset: 0;[^}]*background: rgb\(5 7 16 \/ 0\.74\); backdrop-filter: blur\(3px\)/);
  assert.match(block, /\.edi-lcard \{ width: min\(760px, 100%\)/);
  assert.match(block, /@media \(width < 40rem\) \{\s*\.edi-layer \{ padding: 0; place-items: stretch; \}\s*\.edi-lcard \{ width: 100%; min-height: 100dvh; border-radius: 0;/);
  const ten = css.slice(css.indexOf("/* PLA-I46-10: the evidence card"), start);
  assert.ok(!/animation\s*:/.test(block) && !/animation\s*:/.test(ten), "only Ahora breathes");
  assert.ok(ten.includes("#b9a6ff") && !ten.includes("#ff9f43"), "violet for returned; orange stays the owner's turn");
});

test("I46-15 #2: A, D, C and Esc do what the buttons do, and nothing while typing in a field or with a modifier", () => {
  const k = (key: string, extra: Json = {}) => ({ key, target: { tagName: "BUTTON" }, ...extra });
  assert.equal(ev.layerKey(k("a"), "delivery"), "accept");
  assert.equal(ev.layerKey(k("A"), "plan"), "accept");
  assert.equal(ev.layerKey(k("d"), "delivery"), "return");
  assert.equal(ev.layerKey(k("d"), "plan"), null, "a plan is not returned");
  assert.equal(ev.layerKey(k("c"), "plan"), "change");
  assert.equal(ev.layerKey(k("c"), "delivery"), null);
  assert.equal(ev.layerKey(k("Escape"), "delivery"), "close");
  for (const tagName of ["INPUT", "TEXTAREA", "SELECT", "input"]) for (const key of ["a", "d", "c", "Escape"]) assert.equal(ev.layerKey(k(key, { target: { tagName } }), "delivery"), null, `${key} in ${tagName}`);
  assert.equal(ev.layerKey(k("a", { target: { tagName: "DIV", isContentEditable: true } }), "plan"), null);
  assert.equal(ev.layerKey(k("a", { metaKey: true }), "delivery"), null, "⌘A stays the browser's");
  assert.equal(ev.layerKey(k("c", { ctrlKey: true }), "plan"), null);
  // The layer wires each key to the same handler as its button.
  const src = readFileSync(new URL("../ui/src/components/compania/edificio/decision-layer.tsx", import.meta.url), "utf8");
  assert.match(src, /const c = layerKey\(e, kind\);\s*if \(!c\) return;\s*e\.preventDefault\(\);\s*doIt\(c\);/);
  assert.match(src, /if \(c === "accept"\) return run && !busy \? run\(\) : undefined;/);
});

test("I46-15 #3: focus starts on the main button and goes back to the floor on close", () => {
  const src = readFileSync(new URL("../ui/src/components/compania/edificio/decision-layer.tsx", import.meta.url), "utf8");
  assert.match(src, /useEffect\(\(\) => \{\s*main\.current\?\.focus\(\);/);
  // closeLayer: the button that opened it, else the floor (the article is focusable for this).
  const g = globalThis as Json;
  const had = g.document;
  const focused: string[] = [];
  const floor = { focus: () => focused.push("floor") };
  g.document = { getElementById: (id: string) => (id === "piso-demo" ? floor : null), activeElement: null };
  try {
    store.openLayer("demo", "m-x", { isConnected: true, focus: () => focused.push("opener") });
    store.closeLayer();
    store.openLayer("demo", "m-x", { isConnected: false, focus: () => focused.push("gone") });
    store.closeLayer();
  } finally {
    g.document = had;
  }
  assert.deepEqual(focused, ["opener", "floor"]);
  assert.equal(store.layerOf(), null);
  const floorSrc = readFileSync(new URL("../ui/src/components/compania/edificio/floor.tsx", import.meta.url), "utf8");
  assert.match(floorSrc, /<article id=\{`piso-\$\{p\.slug\}`\} tabIndex=\{-1\}/);
});
