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
const ui = await load("components/compania/edificio/ficha.tsx");
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
const render = (fref: Json, extra: Json = {}) => renderToStaticMarkup(h(MemoryRouter, null, h(ui.Ficha, props(fref, extra))));
const text = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

test("I47-4 #1: Resumen has rumbo, this week, Ojo, Solo tú and Lo último, and reads nothing new", () => {
  const out = render({ kind: "tab", tab: "resumen" });
  const t = text(out);
  for (const x of ["Que un estudio venda sus sesiones en línea", "Entrega", "Esta semana", "Ojo", "Nadie tomó «Cambiar el logo»", "SOLO TU", "LO ULTIMO", "El plan", "La app"]) assert.ok(t.includes(x), x);
  assert.match(out, /role="tab" class="edi-fi-tab" aria-selected="true"[^>]*data-control="ficha-tab-resumen"/);
  assert.equal(lib.needsRows({ kind: "tab", tab: "resumen" }), false);
  assert.equal(lib.needsTask({ kind: "tab", tab: "resumen" }), null);
});

test("I47-4 #1: each list tab draws its rows, its empty state, loading and error with Reintentar", () => {
  const empty = { ...rowsData, counts: { ideas: 0, prs: 0, docs: 0, designs: 0 }, ideas: [], prs: [], docs: [], designs: [] };
  const expect: Record<string, [string, string]> = { ideas: ["Pagos en línea", "No hay ideas abiertas."], diseno: ["Lienzo · LUM-IDEA1", "Ninguna idea tiene lienzo todavía."], prs: ["#7", "Este proyecto no tiene PRs."], docs: ["LUM-IDEA1 ·", "Este proyecto no tiene docs."] };
  for (const [tab, [row, none]] of Object.entries(expect)) {
    const r = { kind: "tab", tab };
    assert.equal(lib.needsRows(r), true, tab);
    const full = render(r, { rows: ok(rowsData) });
    assert.ok(text(full).includes(row), `${tab}: row`);
    assert.ok(text(render(r, { rows: ok(empty) })).includes(none), `${tab}: empty`);
    assert.match(render(r, { rows: { status: "loading" } }), /data-state="loading"/, `${tab}: loading`);
    const err = render(r, { rows: { status: "error", retry: () => {} } });
    assert.ok(err.includes('data-state="error"') && err.includes('data-control="ficha-reintentar"'), `${tab}: error`);
  }
  // The counts show once the rows are read, never before.
  assert.match(render({ kind: "tab", tab: "prs" }, { rows: ok(rowsData) }), /PRs<small>1<\/small>/);
  assert.equal(/<small>/.test(render({ kind: "tab", tab: "resumen" }).split('role="tabpanel"')[0]!), false);
  // Retry calls the read again.
  let again = 0;
  const el = ui.Ficha(props({ kind: "tab", tab: "ideas" }, { rows: { status: "error", retry: () => again++ } }));
  const find = (n: any, pred: (e: any) => boolean): any => {
    if (!n || typeof n !== "object") return null;
    if (Array.isArray(n)) return n.map((x) => find(x, pred)).find(Boolean) ?? null;
    if (pred(n)) return n;
    if (typeof n.type === "function") return find(n.type(n.props), pred);
    return find(n.props?.children, pred);
  };
  find(el, (e) => e.props?.["data-control"] === "ficha-reintentar").props.onClick();
  assert.equal(again, 1);
});

test("I47-4 #1: every detail kind draws, with a way back to its tab", () => {
  const step = render({ kind: "step", key: "LUM-2" }, { task: ok(task) });
  assert.ok(["Paso", "Hosting", "Hecho cuando", "La página abre en la copia de prueba", "Evidencia", "pnpm test 12 de 12", "PR #7", "Historia", "← Resumen"].every((x) => text(step).includes(x)));
  assert.match(step, /<li data-ok="">La página abre/);
  assert.match(render({ kind: "step", key: "LUM-2" }, { task: { status: "loading" } }), /data-state="loading"/);
  const idea = render({ kind: "idea", key: "LUM-IDEA1" }, { task: ok({ ...task, key: "LUM-IDEA1", title: "Pagos en línea", stage: "design" }), rows: ok(rowsData) });
  assert.ok(text(idea).includes("Doc Diseño") && text(idea).includes("← Ideas"));
  assert.equal((idea.match(/data-on=""/g) ?? []).length, 3, "idea, research and design lit");
  assert.match(idea, /data-here=""><i aria-hidden="true"><\/i><span>Diseño/);
  const leg = render({ kind: "leg", key: "LUM-I1" });
  // PLA-I53-3: with no board in the read (an older server) a leg says its count; the board's own list is in i53-board-ui.
  assert.ok(text(leg).includes("Arranque") && text(leg).includes("1 de 2 hechos") && text(leg).includes("todavía no trae los pasos"));
  assert.ok(text(render({ kind: "leg", key: "LUM-I9" })).includes("ya no está"));
  const pr = render({ kind: "pr", n: 7 }, { rows: ok(rowsData) });
  assert.ok(text(pr).includes("Fusionado · pruebas en verde") && pr.includes('href="https://github.com/demo/lumen/pull/7"') && pr.includes('data-control="ficha-pr-paso"') && text(pr).includes("← PRs"));
  const doc = render({ kind: "doc", id: DOC }, { doc: ok({ id: DOC, title: "Guía", version: 3, markdown: "# Guía\n\nCómo trabajamos.", task_key: null }) });
  assert.ok(text(doc).includes("Doc del proyecto") && doc.includes("<h1>Guía</h1>") && text(doc).includes("← Docs"));
  const lienzo = render({ kind: "lienzo", url: LIENZO }, { rows: ok(rowsData) });
  assert.ok(lienzo.includes(`href="${LIENZO}"`) && text(lienzo).includes("Pagos en línea") && text(lienzo).includes("← Diseño"));
  for (const [kind, word] of [["member", "MIEMBRO"], ["plan", "PLAN"], ["sumar", "SUMAR"], ["app", "APP"]] as const) {
    const r = kind === "member" ? { kind, agent: "taller-lumen" } : { kind };
    assert.ok(text(render(r)).includes(word), kind);
    assert.ok(text(render(r, { slots: {} })).length > 0, `${kind} without its slot says so`);
  }
});

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
  assert.equal(lib.fichaSearch("lumen", { kind: "tab", tab: "resumen" }), "?piso=lumen", "Resumen is the default: no ?f=");
});

test("I47-4 #2 / #4: Esc goes from a detail to its tab, then closes; reads follow the open view; the page wires both", () => {
  assert.deepEqual(lib.escStep({ kind: "pr", n: 7 }), { kind: "tab", tab: "prs" });
  assert.deepEqual(lib.escStep({ kind: "member", agent: "x" }), { kind: "tab", tab: "resumen" });
  assert.equal(lib.escStep({ kind: "tab", tab: "docs" }), "close");
  assert.equal(lib.needsTask({ kind: "step", key: "LUM-2" }), "LUM-2");
  assert.equal(lib.needsRows({ kind: "step", key: "LUM-2" }), false, "a step reads its task, not the rows");
  assert.equal(lib.needsRows({ kind: "pr", n: 7 }), true);
  // Close and Volver call back.
  const calls: string[] = [];
  const el = ui.Ficha(props({ kind: "pr", n: 7 }, { rows: ok(rowsData), onRef: (r: Json) => calls.push(JSON.stringify(r)), onClose: () => calls.push("close") }));
  const kids = (n: any): any[] => (!n || typeof n !== "object" ? [] : Array.isArray(n) ? n.flatMap(kids) : [n, ...kids(n.props?.children)]);
  const all = kids(el);
  all.find((e) => e.props?.["data-control"] === "ficha-volver").props.onClick();
  all.find((e) => e.props?.["data-control"] === "ficha-cerrar").props.onClick();
  all.find((e) => e.props?.["data-control"] === "ficha-tab-docs").props.onClick();
  assert.deepEqual(calls, ['{"kind":"tab","tab":"prs"}', "close", '{"kind":"tab","tab":"docs"}']);
  const page = readFileSync(new URL("../ui/src/pages/ceo.tsx", import.meta.url), "utf8");
  assert.ok(page.includes("const to = escStep(fref);") && page.includes("back.focus()"), "Esc walks back and focus returns to the opener");
  assert.ok(page.includes('queryKey: ["company-ficha", fslug]') && page.includes("enabled: fichaOpen && !!fslug && needsRows(fref)"), "one ficha query per project, only when needed");
  assert.equal(/<SidePage[\s\S]{0,200}kind === "member"/.test(page), false, "the teammate no longer opens the old side page");
});
