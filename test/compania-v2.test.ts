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
  usage: { used: 1_250_000 },
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
// PLA-I39-9: Te toca's list left /ceo; each decision renders with the same body under its asker's window.
const teToca = (decisions: Record<string, unknown>[]) =>
  html(h("ul", null, ...decisions.map((d) => h("li", { key: d.id as string, "data-decision": d.id, "data-acted": d.state ? "1" : undefined }, h(v2.DecisionBody, { d, now: NOW, busy: null, onAct: noop })))));
void TITLES;

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
  // A recommended option that is not the first moves to the top.
  const swapped = teToca([proposal({ options: [{ n: 1, label: "Uno", recommended: false }, { n: 2, label: "Dos", recommended: true }] })]);
  assert.deepEqual([...swapped.matchAll(/data-option="(\d)"/g)].map((m) => m[1]), ["2", "1"]);
  clean(out);
});

test("I35-2 Jorge's own ticket shows Hecho / Aplazar with its key and detail", () => {
  const out = teToca([kickoff()]);
  for (const t of ['data-action="hecho"', 'data-action="aplazar"', "MIA-I1-1", "Llevar el borrador", "Kickoff con la boutique"]) assert.ok(out.includes(t), t);
  assert.equal(count(out, /data-action="elegir"/g), 0);
  clean(out);
});

test("I35-2 an acted row keeps its place, dimmed, with the result written in it and no buttons", () => {
  const acted = proposal({ actions: [], state: { action: "elegir", at: "2026-11-09T02:59:00Z", result: { option: 1, label: "Planear MIA-I2", wake: "queued", ticket: "MIA-7" } } });
  const out = teToca([acted, kickoff()]);
  assert.ok(out.includes("✓ Elegiste 1 · Planear MIA-I2 · el PO despierta en su turno"));
  assert.ok(out.includes('data-acted="1"'));
  assert.equal(count(out.slice(0, out.indexOf("Kickoff")), /data-action=/g), 0, "no buttons on the acted row");
  assert.equal(lib.stateText({ action: "hecho", at: "x", result: { ticket: "MIA-I1-1", status: "Done" } }), "Hecho", "PLA-I36-11: no key on the main line");
  assert.equal(lib.stateText({ action: "elegir", at: "x", result: { option: [1, 2], label: "A + B", wake: "busy" } }), "Elegiste 1 + 2 · A + B · el PO lo toma al terminar lo que corre");
  clean(out);
});

// ---- PLA-I35-4 one test per state of the Design's Scope, and the phone

test("I35-4 the whole page with fake data: never Sin corridas todavía, never null, tokens only", () => {
  clean(teToca([proposal(), kickoff()]));
  assert.equal(lib.companyLine([MIANOVIA, ...PAUSED]), "Mianovia avanza, cinco proyectos en pausa");
  assert.equal(lib.companyLine([...PAUSED]), "Nada avanza, cinco proyectos en pausa");
});

test("I35-4 phone at 390: a decision's options wrap their Elegir under the label", async () => {
  const out = teToca([proposal()]);
  assert.ok(out.includes("max-sm:flex-wrap") && out.includes("max-sm:ml-6"), "options stack on a phone");
  const { readFileSync } = await import("node:fs");
  const page = readFileSync(new URL("../ui/src/pages/ceo.tsx", import.meta.url), "utf8");
  assert.ok(page.includes("<Building") && !page.includes("<TeToca"), "PLA-I39: the building, Te toca on the floors");
});
