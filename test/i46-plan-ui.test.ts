// PLA-I46-11: el plan para aceptar on the floor (design screen 4). Rendered with react-dom/server and fake data; no
// browser, no database. Fake names only.
//   - the plan's move: «Aceptar el plan de …» in Ahora, the Tú window and the phone bar, all «Aceptar plan»
//   - Ahora carries the steps, the questions with the suggestion marked, the editable check list, and the other two
//     exits (Cambiar algo, Después); it does not hang a second time under the PO's window
//   - a changed answer and an edited line are what Aceptar plan sends, from any of the three buttons
//   - Después: a quiet line, no green button, Ver el plan opens it with its own Aceptar plan
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
const now = await load("components/compania/edificio/now.tsx");
const draft = await load("components/compania/edificio/plan-draft.ts");
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
  team: ["product-owner", "taller"].map((r) => member(r)),
  thread: { id: "t", unread: 0, last: null },
  plan: null,
  route: {
    legs: [
      { key: "DEM-I1", title: "Catálogo", done: 3, total: 3, state: "here", note: null, steps: [] },
      { key: "DEM-I2", title: "Pagos y envío", done: 0, total: 0, state: "unplanned", note: null },
    ],
    more_legs: 0,
  },
  latest: [],
  stale_requests: [],
  this_week: { done: 3, docs: 0, prs: 0, last_at: null },
  next: null,
  ready: [],
  work: { open: 0, in_progress: 0 },
  orders: [],
  ...patch,
});
const LIST = ["Se ve el total", "El correo llega", "Se lee bien a 390"];
const planDecision = (patch: Json = {}, plan: Json = {}): Json => ({
  id: "m-plan-1",
  project: "demo",
  title: "Pagos y envío",
  kind: "plan",
  options: null,
  actions: ["empezar", "cambiar", "despues"],
  state: null,
  at: "2026-11-13T20:00:00Z",
  ref: null,
  detail: null,
  links: [],
  body: null,
  checks: null,
  release: null,
  hold: null,
  asker: { agent: "product-owner-demo", role: "product-owner" },
  plan: {
    order: "DEM-7",
    understood: "cobrar y enviar",
    steps: [
      { title: "Pago con tarjeta", done_when: "se cobra en la copia de prueba" },
      { title: "Correo de envío", done_when: "llega el correo" },
    ],
    cost: "",
    needs_approval: true,
    created: [],
    leg: { key: "DEM-I2", title: "Pagos y envío" },
    questions: [
      { text: "¿Envío gratis?", options: ["Sí", "No"], suggested: 1 },
      { text: "¿Quién recibe el aviso?", options: ["Solo la tienda", "La tienda y yo"], suggested: 0 },
    ],
    checklist: LIST,
    later_at: null,
    ...plan,
  },
  ...patch,
});
const company = (p: Json, ds: Json[]): Json => ({
  company: { paused: false },
  week: { starts_at: "2026-11-09T06:00:00Z", resets_at: "2026-11-16T06:00:00Z", timezone: TZ },
  asistente: { thread_id: "t-co", usage: { used: 0 }, last_run: null, state: "idle", unread: 0 },
  projects: [{ ...p, next_move: nextMove(p as never, ds as never) }],
  plumbing: { spend: 0, running: 0, paused: false },
  decisions: ds,
  inbox: { decisiones: 0, pasos: 0 },
});
const render = (c: Json, onAct: (...a: unknown[]) => void = noop) =>
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
      acts: { now: NOW, busy: null, onAct },
      nowActs: { onStart: noop, onPlan: noop },
      askFor: () => h("div", null, "Pedir"),
    }),
  );
const nowCard = (s: string) => /<div class="edi-nowb"[\s\S]*?(?=<div class="edi-slot")/.exec(s)?.[0] ?? "";

test("I46-11 #1: the plan is the move, and Ahora shows its steps, questions with the suggestion marked and an editable check list", () => {
  const d = planDecision();
  const m = nextMove(project() as never, [d] as never)!;
  assert.deepEqual([m.verbo, m.texto, m.accion], ["aceptar", "Aceptar el plan de «Pagos y envío»", { kind: "decision", id: d.id, action: "empezar", label: "Aceptar plan" }]);
  const s = render(company(project(), [d]));
  const card = nowCard(s);
  assert.ok(card.includes('data-breathe="1"'), "Ahora breathes: it is the owner's turn");
  assert.ok(unq(text(card)).includes("Aceptar el plan de «Pagos y envío»"));
  assert.ok(text(card).includes("El PO propone 2 pasos y 2 preguntas, con su respuesta sugerida ya marcada."));
  for (const t of ["2 pasos", "Pago con tarjeta", "Correo de envío", "2 preguntas", "¿Envío gratis?", "Check list del PO · la puedes editar", "Cambiar algo", "Después"]) assert.ok(unq(text(card)).includes(t), t);
  // The suggestion is marked and checked: «No» for the first, «Solo la tienda» for the second.
  const radios = [...card.matchAll(/role="radio" class="edi-popt" aria-checked="(true|false)"( data-suggested="1")?[^>]*>([^<]+)/g)].map((x) => [x[3], x[1], !!x[2]]);
  assert.deepEqual(radios, [["Sí", "false", false], ["No", "true", true], ["Solo la tienda", "true", true], ["La tienda y yo", "false", false]]);
  assert.equal((card.match(/<sup>sugerida<\/sup>/g) ?? []).length, 2);
  // The list is three inputs with the PO's lines.
  assert.deepEqual([...card.matchAll(/class="edi-pfield"[^>]*value="([^"]*)"/g)].map((x) => x[1]), LIST);
  // Three exits: the green Aceptar plan, Cambiar algo, Después.
  assert.deepEqual([...card.matchAll(/<button[^>]*>([^<]+)<\/button>/g)].map((x) => x[1]!).filter((l) => !/^(Sí|No|Solo|La tienda)/.test(l)), ["Aceptar plan", "Cambiar algo", "Después"]);
  // The same button on the Tú window and in the phone bar; no second copy hanging under the PO.
  assert.ok(/data-where="tu"[^>]*>Aceptar plan</.test(s), "Tú");
  assert.ok(/data-where="barra"[^>]*>Aceptar plan</.test(s), "phone bar");
  assert.ok(!s.includes(`data-bubble="${d.id}"`), "not hung under the PO's window");
});

test("I46-11: a changed answer and an edited line are what Aceptar plan sends, from Ahora, Tú and the bar alike", () => {
  const d = planDecision({ id: "m-plan-2" });
  const p = { ...project(), next_move: nextMove(project() as never, [d] as never)! };
  const sent: Json[] = [];
  const ctx = { decisions: [d], qacts: { now: NOW, busy: null, onAct: (_d: Json, input: Json) => sent.push(input) } };
  now.runOf(p, p.next_move.accion, ctx)();
  assert.deepEqual(sent[0], { action: "empezar", answers: [1, 0], checklist: LIST }, "untouched: the suggestions and the PO's list");
  draft.setDraft(d, { answers: [0, 1], checklist: ["Se ve el total", "El correo llega a la tienda", "Se lee bien a 390"] });
  now.runOf(p, p.next_move.accion, ctx)();
  assert.deepEqual(sent[1], { action: "empezar", answers: [0, 1], checklist: ["Se ve el total", "El correo llega a la tienda", "Se lee bien a 390"] });
  // The rendered card shows the edit.
  const card = nowCard(render(company(project(), [d])));
  assert.ok(card.includes('value="El correo llega a la tienda"'));
  assert.ok(/aria-checked="true" data-suggested="1"[^>]*>Solo la tienda|aria-checked="false" data-suggested="1"[^>]*>Solo la tienda/.test(card));
  assert.ok(/aria-checked="true"[^>]*>La tienda y yo/.test(card), "his answer is checked");
});

test("I46-11 #3: Después leaves the plan waiting: a quiet line, no green button anywhere, and Ver el plan", () => {
  const d = planDecision({ id: "m-plan-3" }, { later_at: "2026-11-13T20:40:00Z" });
  assert.equal(nextMove(project() as never, [d] as never), null, "not his move, and no second Que PO lo planee");
  const s = render(company(project(), [d]));
  const card = nowCard(s);
  assert.ok(unq(text(card)).includes("El plan de «Pagos y envío» te espera."));
  assert.ok(text(card).includes("Nadie empieza hasta que lo aceptes."));
  assert.ok(card.includes(">Ver el plan<"));
  assert.ok(!/edi-go[" ]|data-breathe/.test(card), "no green button, no breathing");
  assert.ok(!card.includes("data-plan="), "the plan is closed");
  assert.ok(!s.includes("Te toca 1"), "the roof does not count it");
  // Opened: the plan with its own Aceptar plan and Cambiar algo.
  draft.setDraft(d, { open: true });
  const open = nowCard(render(company(project(), [d])));
  assert.ok(open.includes(`data-plan="${d.id}"`));
  assert.deepEqual([...open.matchAll(/data-plan-act="([a-z]+)"/g)].map((x) => x[1]), ["empezar", "cambiar", "cerrar"]);
  assert.equal(edificio.nowLine({ ...project(), next_move: null }, [d], NOW).word, "En pausa");
});

test("I46-11: Cambiar algo opens one line for the PO; the plan's CSS has no motion and wraps at 390", () => {
  const d = planDecision({ id: "m-plan-4" });
  draft.setDraft(d, { changing: true, text: "Solo un paso" });
  const card = nowCard(render(company(project(), [d])));
  assert.ok(card.includes('aria-label="Qué cambiar del plan"') && card.includes('value="Solo un paso"') && card.includes(">Enviar al PO<"));
  const css = readFileSync(new URL("../ui/src/index.css", import.meta.url), "utf8");
  const start = css.indexOf("/* PLA-I46-11");
  const block = css.slice(start, css.indexOf("@media", start));
  assert.ok(block.includes(".edi-plan {") && block.includes("minmax(220px, 1fr)"), "columns wrap to one on a phone");
  assert.ok(!/animation\s*:/.test(block));
});
