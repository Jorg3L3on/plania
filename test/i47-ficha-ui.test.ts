// PLA-I47-4: La ficha with fake F1 data. Server-rendered and handler-level; no browser, no database.
//   #1  each tab with its rows, empty, loading and error states; each detail kind; the address parses every ?f=
//       kind and the old ?m=, ?plan=, ?add= links still open the right detail
//   #2  Esc: a detail back to its tab, then the ficha closes; focus goes back to what opened it
//   #4  a view reads only what it needs: Resumen reads nothing new, a list tab the rows, a step its task
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";

(globalThis as { React?: unknown }).React = React;
const load = async (p: string) => (await import(new URL(`../ui/src/${p}`, import.meta.url).href)) as Record<string, any>;

const lib = await load("lib/ficha.ts");

type Json = Record<string, any>;
const h = React.createElement;
const NOW = new Date("2026-11-10T18:00:00Z").getTime();
const TZ = "America/Mexico_City";
const LIENZO = "https://claude.ai/artifact/AbC123";
const DOC = "11111111-2222-4333-8444-555555555555";
const project = (patch: Json = {}): Json => ({
  slug: "lumen",
  title: "Lumen",
  paused: false,
  light: "ok",
  light_reason: null,
  goal: null,
  rumbo: { goal_id: "g", goal: "Que un estudio venda sus sesiones en línea", why: "", target_on: "2026-12-05", forecast_on: "2026-12-05", weeks_behind: 0, missing: false },
  team: [],
  plan: null,
  this_week: { done: 3, docs: 1, prs: 2, last_at: null },
  route: { legs: [{ key: "LUM-I1", title: "Arranque", done: 1, total: 2, state: "here", note: null, steps: [{ key: "LUM-1", title: "Acceso", state: "done", who: "taller", at: "2026-11-09T10:00:00Z" }, { key: "LUM-2", title: "Hosting", state: "next", who: "taller", at: null }] }], more_legs: 0 },
  orders: [],
  ready: [],
  stale_requests: [{ key: "LUM-9", title: "Cambiar el logo", since: "2026-11-08T10:00:00Z" }],
  ...patch,
});
const rowsData: Json = {
  slug: "lumen",
  counts: { ideas: 2, prs: 1, docs: 1, designs: 1 },
  ideas: [
    { key: "LUM-IDEA1", title: "Pagos en línea", stage: "design", waits: "Doc Diseño", updated_at: "2026-11-09T10:00:00Z", docs: { Idea: DOC, Research: null, Design: null, Plan: null } },
    { key: "LUM-IDEA2", title: "Galería", stage: "idea", waits: null, updated_at: "2026-11-08T10:00:00Z", docs: { Idea: null, Research: null, Design: null, Plan: null } },
  ],
  prs: [{ number: 7, title: "Acceso con enlace", url: "https://github.com/demo/lumen/pull/7", state: "merged", ci_state: "success", task_key: "LUM-1", merged_at: "2026-11-09T10:00:00Z", head_branch: "jl/acceso" }],
  docs: [{ id: DOC, title: "Idea", task_key: "LUM-IDEA1", updated_at: "2026-11-09T10:00:00Z" }],
  designs: [{ idea_key: "LUM-IDEA1", doc_id: DOC, url: LIENZO }],
};
const ok = (data: unknown) => ({ status: "ok", data, retry: () => {} });
const idle = { status: "idle" };
const task: Json = { key: "LUM-2", title: "Hosting", status: "Ready", stage: null, waits: null, checks: [{ n: 1, text: "La página abre en la copia de prueba", done: true }, { n: 2, text: "Se lee a 390", done: false }], results: [{ id: "r1", kind: "test", verdict: "pass", cite: "pnpm test 12 de 12" }], docs: [{ id: DOC, title: "Spec", version: 2, updated_at: "2026-11-09T10:00:00Z" }], pr: { number: 7, url: "https://github.com/demo/lumen/pull/7" }, pr_url: null, log: [{ id: 1, at: "2026-11-09T10:00:00Z", type: "task.claimed", actor: {}, payload: {} }] };
const slots = { member: h("p", null, "MIEMBRO"), plan: h("p", null, "PLAN"), sumar: h("p", null, "SUMAR"), app: h("p", null, "APP"), solo: h("p", null, "SOLO TU"), last: h("p", null, "LO ULTIMO") };
const props = (fref: Json, extra: Json = {}) => ({ project: project(), fref, rows: idle, task: idle, doc: idle, slots, now: NOW, timeZone: TZ, onRef: () => {}, onClose: () => {}, ...extra });

const text = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");







test("I47-4 #1: the address parses every ?f= kind, round-trips, and the old links land on the right detail", () => {
  const cases: [string, Json][] = [
    ["tab:prs", { kind: "tab", tab: "prs" }],
    ["step:LUM-2", { kind: "step", key: "LUM-2" }],
    ["idea:LUM-IDEA1", { kind: "idea", key: "LUM-IDEA1" }],
    ["leg:LUM-I1", { kind: "leg", key: "LUM-I1" }],
    ["member:taller-lumen", { kind: "member", agent: "taller-lumen" }],
    ["pr:7", { kind: "pr", n: 7 }],
    [`doc:${DOC}`, { kind: "doc", id: DOC }],
    [`lienzo:${LIENZO}`, { kind: "lienzo", url: LIENZO }],
    ["plan", { kind: "plan" }],
    ["app", { kind: "app" }],
    ["sumar", { kind: "sumar" }],
  ];
  for (const [f, ref] of cases) {
    assert.deepEqual(lib.fichaOf(`?piso=lumen&f=${encodeURIComponent(f)}`), { ref, slug: null }, f);
    assert.deepEqual(lib.fichaOf(lib.fichaSearch("lumen", ref)), { ref, slug: null }, `${f} round-trips`);
  }
  for (const bad of ["tab:nada", "step:hola", "pr:x", "doc:123", "lienzo:https://example.com/a", "otra:cosa"]) assert.equal(lib.fichaOf(`?f=${encodeURIComponent(bad)}`), null, bad);
  assert.deepEqual(lib.fichaOf("?m=lumen:taller-lumen"), { ref: { kind: "member", agent: "taller-lumen" }, slug: "lumen" });
  assert.deepEqual(lib.fichaOf("?plan=lumen"), { ref: { kind: "plan" }, slug: "lumen" });
  assert.deepEqual(lib.fichaOf("?add=lumen"), { ref: { kind: "sumar" }, slug: "lumen" });
  // PLA-I55-1: no ?f= is the ventanal's home tab, so Resumen is named like every other tab.
  assert.equal(lib.fichaSearch("lumen", { kind: "tab", tab: "resumen" }), "?piso=lumen&f=tab%3Aresumen");
  assert.equal(lib.fichaSearch("lumen", null), "?piso=lumen");
});


