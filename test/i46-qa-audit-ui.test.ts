// AUDIT-6 on screen: the QA evidence card of a delivery (La corriente, Entrega) shows the review's two verdicts as two
// short lines and whether QA walked the app; a review with one verdict (before AUDIT-6) reads as before. Rendered
// with react-dom/server and fake data (no browser, no database).
import assert from "node:assert/strict";
import { test } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

(globalThis as { React?: unknown }).React = React;
const load = async (p: string) => (await import(new URL(`../ui/src/${p}`, import.meta.url).href)) as Record<string, any>;
const ev = await load("lib/evidencia.ts");
const entrega = await load("components/corriente/entrega.tsx");
const h = React.createElement;
type Json = Record<string, any>;

const PR = "https://github.com/x/demo/pull/7";
const D: Json = {
  id: "d1",
  project: "demo",
  title: "Pantalla de gracias",
  kind: "pr",
  options: null,
  actions: ["fusionar", "cambios"],
  state: null,
  at: "2026-11-17T20:00:00Z",
  ref: "DEM-3",
  detail: null,
  links: [
    { kind: "ticket", ref: "DEM-3", title: "Pantalla de gracias" },
    { kind: "pr", ref: PR, title: "PR #7" },
  ],
  evidence: null,
  preview_url: null,
  hold: null,
};
const read = (review: Json | null, over: Json = {}): Json => ({
  project: "demo",
  key: "DEM-3",
  enabled: true,
  state: "pass",
  tests: { pass: 14, total: 14, verdict: "pass", items: [{ name: "test", command: "pnpm test", ok: true, exit_code: 0, pass: 14, fail: 0, duration_s: 9 }] },
  review,
  checklist: [],
  captures: null,
  notes: null,
  ...over,
});
const P: Json = { slug: "demo", title: "Demo", paused: false, light: "ok", goal: null, usage: { used: 0 }, team: [], thread: { id: "t", unread: 0, last: null }, plan: null, this_week: { done: 0, docs: 0, prs: 0, last_at: null }, next: null, work: { open: 0, in_progress: 0 } };
const rec = () => () => undefined;
const acts = { refresh: rec(), decisions: { decide: rec(), withActed: (d: unknown[]) => d, busy: null, errors: {}, prefill: {}, setPrefill: rec() }, busy: null, stopRun: rec(), resumeRun: rec(), start: rec(), plan: rec(), autoAccept: rec(), autoInvisible: rec(), resend: rec(), closeRequest: rec(), cancelOrder: rec(), pickNext: rec(), note: rec(), resume: rec(), pause: rec() };

// The card as Entrega draws it, with the QA read already in the cache.
const card = (qa: Json): string => {
  const client = new QueryClient();
  client.setQueryData(["qa", "demo", "DEM-3"], qa);
  const out = renderToStaticMarkup(h(QueryClientProvider, { client }, h(MemoryRouter, { initialEntries: ["/corriente"] }, h(entrega.Entrega, { p: P, d: D, acts, back: "/corriente" }))));
  return /<section[^>]*data-evidencia[\s\S]*?<\/section>/.exec(out)?.[0] ?? "";
};
const text = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

const TWO = { verdict: "fail", notes: "x", model: "sonnet", spec: { verdict: "pass", notes: "Cumple el alcance." }, code: { verdict: "fail", notes: "src/form.ts:12 no valida el correo antes de guardar." } };

test("AUDIT-6 view: two verdicts become two lines in the owner's words; one verdict stays one tile", () => {
  const v = ev.evidenceView(read(TWO), D);
  assert.deepEqual(v.axes, [
    { axis: "spec", ok: true, text: "Hace lo que se pidió", sub: "" },
    { axis: "code", ok: false, text: "El código tiene un problema", sub: "src/form.ts:12 no valida el correo antes de guardar." },
  ]);
  assert.equal(v.walked, null, "the project does not ask for the walk-through");
  assert.deepEqual([v.review.value, v.review.ok], ["Encontró algo", false], "the overall tile stays for readers from before");
  const ok = ev.evidenceView(read({ ...TWO, verdict: "pass", code: { verdict: "pass", notes: "Sin errores." }, walked: true }), D);
  assert.deepEqual(ok.axes.map((a: Json) => a.text), ["Hace lo que se pidió", "El código está bien"]);
  assert.deepEqual(ok.walked, { text: "QA recorrió la app", ok: true });
  assert.deepEqual(ev.evidenceView(read({ ...TWO, spec: { verdict: "fail", notes: "Falta el aviso." }, walked: false }), D).walked, { text: "QA no recorrió la app", ok: false });
  assert.equal(ev.evidenceView(read({ ...TWO, spec: { verdict: "fail", notes: "Falta el aviso." } }), D).axes[0].text, "No hace todo lo que se pidió");
  // A review from before AUDIT-6, no review, no read: no lines, the tile as it was.
  const old = ev.evidenceView(read({ verdict: "pass", notes: "Hace lo que pide el ticket.", model: "sonnet" }), D);
  assert.deepEqual([old.axes, old.walked, old.review], [[], null, { value: "Sin hallazgos", ok: true, sub: "otro agente, sin ver a Taller" }]);
  assert.deepEqual(ev.evidenceView(read(null), D).axes, []);
  assert.deepEqual(ev.evidenceView(null, D).axes, []);
  // Plain words on screen: no ticket key, no English, no jargon.
  for (const w of [...Object.values(ev.AXIS_WORDS).flatMap((x: any) => Object.values(x)), ...Object.values(ev.WALKED_WORDS)] as string[]) assert.doesNotMatch(w, /spec|code|verdict|[A-Z]{2,}-\d/);
});

test("AUDIT-6 card: Entrega draws a line per verdict and the walk-through; an old review draws as before", () => {
  const two = card(read({ ...TWO, walked: true }));
  assert.ok(two, "the evidence section renders");
  assert.match(two, /<div data-eje="spec" data-ok="true">Hace lo que se pidió<\/div>/);
  assert.match(two, /<div data-eje="code" data-ok="false">El código tiene un problema · src\/form\.ts:12 no valida el correo antes de guardar\.<\/div>/);
  assert.match(two, /<div data-recorrido="true">QA recorrió la app<\/div>/);
  assert.doesNotMatch(text(two), /Encontró algo|Sin hallazgos/, "the two lines take the single word's place");
  assert.match(two, /Ver el PR/);
  assert.match(card(read({ ...TWO, walked: false })), /<div data-recorrido="false">QA no recorrió la app<\/div>/);

  const old = card(read({ verdict: "pass", notes: "Hace lo que pide el ticket.", model: "sonnet" }));
  assert.match(text(old), /Revisión Sin hallazgos Ver el PR/);
  assert.doesNotMatch(old, /data-eje|data-recorrido/);
  const none = card(read(null, { enabled: false, state: "off" }));
  assert.match(text(none), /Revisión Sin revisión aparte/);
  assert.doesNotMatch(none, /data-eje|data-recorrido/);
});
