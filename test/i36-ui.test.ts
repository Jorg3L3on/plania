// PLA-I36 phase 1 on screen, rendered with fake data (react-dom/server; no browser, no database).
// The light's reason under the name (PLA-I36-1), Te toca's steps, releases and evidence (PLA-I36-2), Tus órdenes
// (PLA-I36-3). Fake names and numbers only.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";

(globalThis as { React?: unknown }).React = React;
const load = async (p: string) => (await import(new URL(`../ui/src/${p}`, import.meta.url).href)) as Record<string, any>;

const lib = await load("lib/v2.ts");
const org = await load("lib/org.ts");

const h = React.createElement;
const html = (el: React.ReactElement) => renderToStaticMarkup(h(MemoryRouter, null, el));
const noop = () => {};
const NOW = new Date("2026-11-10T18:00:00Z").getTime();
const clean = (s: string) => {
  assert.equal(/\bnull\b|\bundefined\b|NaN|\[object Object\]/.test(s), false, "never a null key");
  assert.equal(/\$|USD/.test(s), false, "tokens, never money");
};

const member = (role: string, patch: Record<string, unknown> = {}) => ({ agent: `${role}-x`, role, template: role, state: "idle", now: null, last: null, produced: null, waiting: null, ...patch });
const project = (patch: Record<string, unknown> = {}) => ({
  slug: "workia",
  title: "Workia",
  paused: false,
  light: "ok",
  light_reason: null,
  goal: null,
  usage: { used: 100_000 },
  team: ["product-owner", "research", "artist", "taller"].map((r) => member(r)),
  thread: { id: "t-workia", unread: 0, last: null },
  plan: null,
  this_week: { done: 1, docs: 0, prs: 0, last_at: "2026-11-10T17:00:00Z" },
  next: null,
  work: { open: 2, in_progress: 0 },
  orders: [],
  ...patch,
});
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;



const row = (patch: Record<string, unknown>) => ({
  id: "b-00000000-0000-4000-8000-000000000001",
  project: "workia",
  title: "Crear la cuenta de la tienda",
  kind: "step",
  options: null,
  actions: ["hecho"],
  state: null,
  at: "2026-11-10T12:00:00Z",
  ref: "WRK-4",
  detail: null,
  links: [],
  body: null,
  checks: null,
  release: null,
  ...patch,
});













test("I36-2 #3: Nada te espera only when Bandeja is empty too", () => {
  assert.equal(lib.teTocaEmpty({ decisiones: 0, pasos: 0 }), lib.TE_TOCA_EMPTY);
  assert.equal(lib.teTocaEmpty({ decisiones: 1, pasos: 1 }), "Nada urgente aquí · 2 cosas te esperan en Bandeja.");
  assert.equal(lib.teTocaEmpty(undefined), lib.TE_TOCA_EMPTY);
});





// ---- PLA-I36-3

const order = (patch: Record<string, unknown>) => ({ id: "t-1", kind: "order", title: "Agrega un botón de WhatsApp", at: "2026-11-10T16:00:00Z", state: "enviada", understood: null, who: null, link: null, age_h: null, ...patch });

test("I36-3 #1-#4: each order's state reads in words; sin tomar is amber with its age (the plan's side page lists them)", () => {
  assert.equal(lib.orderText(order({ state: "sin_tomar", age_h: 30 }), NOW).tone, "warn");
  assert.ok(lib.orderText(order({ state: "sin_tomar", age_h: 30 }), NOW).text.includes("sin tomar · 30 h"));
  assert.ok(lib.orderText(order({ state: "en_curso", who: "taller" }), NOW).text.includes("en curso · Taller"));
});
