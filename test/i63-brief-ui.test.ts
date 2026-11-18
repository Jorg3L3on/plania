// PLA-I63: the Morning brief as a Compañía place (/ceo?v=brief). Server-rendered with react-dom/server and the pure
// model called directly. Clicks, measures, axe and motion run in the real-browser pass on the demo server.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

(globalThis as { React?: unknown }).React = React;
const load = async (p: string) => (await import(new URL(`../ui/src/${p}`, import.meta.url).href)) as Record<string, any>;
const lib = await load("lib/corriente.ts");
const delta = await load("lib/brief-delta.ts");
const page = await load("components/corriente/brief.tsx");
const header = await load("components/corriente/header.tsx");
const h = React.createElement;
const html = (el: React.ReactElement, at = "/ceo?v=brief") => renderToStaticMarkup(h(QueryClientProvider, { client: new QueryClient() }, h(MemoryRouter, { initialEntries: [at] }, el)));
const css = readFileSync(new URL("../ui/src/corriente.css", import.meta.url), "utf8");

test("I63-1: /ceo?v=brief is the brief view and the address round-trips", () => {
  assert.equal(lib.atOf("?v=brief").view, "brief");
  assert.deepEqual(lib.atOf("?v=brief"), { view: "brief", slug: null, tab: lib.atOf("").tab, ver: null });
  assert.equal(lib.hrefOf({ view: "brief" }), "/ceo?v=brief");
  assert.equal(lib.atOf(lib.searchOf({ view: "brief" })).view, "brief");
  assert.equal(lib.isBuilt({ view: "brief" }), true);
  assert.equal(page.diaOf("?v=brief&dia=2026-11-16"), "2026-11-16");
  assert.equal(page.diaOf("?v=brief&dia=ayer"), null);
});

test("I63-1: the date line and the headline in their forms", () => {
  assert.equal(delta.kickOf({ kind: "today", generatedAt: "2026-11-17T13:00:00Z", timeZone: "America/Mexico_City" }), "Brief · mar 17 nov · generado 07:00");
  assert.equal(delta.kickOf({ kind: "past", localDate: "2026-11-16" }), "Brief del lun 16 nov · solo lectura");
  assert.equal(delta.kickOf({ kind: "generating", minutes: 1, generatedAt: "2026-11-17T13:00:00Z", timeZone: "America/Mexico_City" }), "Generando… 1 min · sigues viendo el de las 07:00");
  assert.deepEqual(delta.headlineOf({ total: 16, open: 16, blocked: 1, needs: 4 }), { l1: "Dieciséis cosas esta mañana.", l2: "Una bloquea y cuatro te esperan.", tone: "a" });
  assert.deepEqual(delta.headlineOf({ total: 16, open: 9, blocked: 0, needs: 2 }), { l1: "Quedan nueve de dieciséis.", l2: "Dos te esperan.", tone: "a" });
  assert.deepEqual(delta.headlineOf({ total: 16, open: 3, blocked: 0, needs: 0 }), { l1: "Quedan tres de dieciséis.", l2: "Nada te espera: lo demás puede seguir solo.", tone: "q" });
  assert.deepEqual(delta.headlineOf({ total: 16, open: 0, blocked: 0, needs: 0 }, "06:30"), { l1: "Todo resuelto por hoy.", l2: "El brief de mañana llega a las 06:30.", tone: "q" });
  assert.equal(delta.headlineOf({ total: 22, open: 22, blocked: 2, needs: 0 }).l1, "Veintidós cosas esta mañana.");
  assert.equal(delta.headlineOf({ total: 22, open: 22, blocked: 2, needs: 0 }).l2, "Dos bloquean.");
  assert.equal(delta.headlineOf({ total: 1, open: 1, blocked: 0, needs: 1 }).l1, "Una cosa esta mañana.");
  assert.equal(delta.noBriefHeadline("empty").l1, "Aún no hay brief.");
  assert.deepEqual(delta.dayLine({ local_date: "2026-11-16", needs: 3, ideas: 4 }), { day: "Lun 16 nov", line: "3 te tocaban · 4 ideas" });
});

test("I63-1: the tools: Generar ahora with three passes, Días anteriores, Ajustes; white only with no brief", () => {
  const base = { language: "es", genLabel: "Generar ahora", canGenerate: true, genPrimary: false, onGenerate: () => {}, history: [{ id: "a", local_date: "2026-11-17", generated_at: "", mode: "full", needs: 2, next: 1, ideas: 3 }, { id: "b", local_date: "2026-11-16", generated_at: "", mode: "full", needs: 3, next: 1, ideas: 4 }], todayDate: "2026-11-17", date: null, onDate: () => {}, onSettings: () => {} };
  const gen = html(h(page.BriefTools, { ...base, initialMenu: "gen" }));
  assert.match(gen, /data-brief="generate-menu"/);
  for (const k of ["both", "brief", "ideas"]) assert.match(gen, new RegExp(`data-gen="${k}"`));
  assert.match(gen, /Pendientes e ideas.*Solo pendientes.*Solo ideas/s);
  assert.doesNotMatch(gen, /cor-btn primary/);
  const days = html(h(page.BriefTools, { ...base, initialMenu: "dias" }));
  assert.match(days, /data-dia="2026-11-16"/);
  assert.doesNotMatch(days, /data-dia="2026-11-17"/);
  assert.match(days, /Lun 16 nov.*3 te tocaban · 4 ideas/s);
  const past = html(h(page.BriefTools, { ...base, date: "2026-11-16" }));
  assert.match(past, /data-brief="back-today"/);
  assert.match(past, /data-brief="generate"[^>]*disabled|disabled[^>]*data-brief="generate"/);
  assert.match(html(h(page.BriefTools, { ...base, genPrimary: true })), /cor-btn primary small[^"]*" [^>]*data-brief="generate"|class="cor-btn primary small"/);
  assert.match(html(h(page.BriefTools, base)), /data-brief="settings"/);
});

test("I63-1: the states without a brief, and the Brief tab only when the address opens it", () => {
  for (const [state, text] of [["empty", "lo primero que te toca"], ["off", "brief apagado"], ["failed", "Reintentar"]] as const) {
    const out = html(h(page.BriefView, { kick: "Brief · mar 17 nov", live: false, headline: delta.noBriefHeadline(state), tools: null, state, onRetry: () => {} }));
    assert.match(out, new RegExp(`data-brief-state="${state}"`));
    assert.match(out, new RegExp(text));
  }
  assert.match(html(h(page.BriefView, { kick: "k", live: false, headline: delta.noBriefHeadline("loading"), tools: null, state: "loading" })), /aria-busy="true".*role="status"/s);
  const head = (view: string | null) => html(h(header.Head, { view, waiting: 0, now: Date.parse("2026-11-17T15:00:00Z"), pedirTo: "/ceo?v=pedir", tocaTo: "/ceo?v=tetoca" }));
  assert.doesNotMatch(head("corriente"), />Brief</);
  assert.match(head("brief"), /aria-current="page"[^>]*>Brief/);
  assert.match(css, /\.cor-bf-h1 \{ font-size: 40px/);
});
