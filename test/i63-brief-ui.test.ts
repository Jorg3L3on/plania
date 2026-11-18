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
  assert.deepEqual(lib.atOf("?v=brief"), { view: "brief", slug: null, tab: "ahora", ver: null });
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

// ---- I63-2: the delta's model
const city = await load("lib/brief-city.ts");
const deltaUi = await load("components/corriente/brief-delta.tsx");
const item = (app: string, status: string, n: number, title = `Fila ${n}`) => ({ id: `i|${app}|${status}${n}`, app, status, ref: `${app.slice(0, 3).toUpperCase()}-${n}`, title, targets: [{ kind: status === "blocker" ? "step" : status === "needs_you" ? "question" : "ticket", project: app, key: `K-${n}` }] });
const idea = (app: string, n: number) => ({ id: `d|${app}|${n}`, code: `I${n}`, app, title: `Idea ${n}`, why: "porque", source: "x" });
const brief = (apps: string[], items: any[], ideas: any[] = []) => ({ version: 2, generatedAt: "2026-11-17T13:00:00Z", timezone: "America/Mexico_City", timezoneLabel: "CDMX", window: { from: "", to: "" }, reply: { prefix: "", destination: "Plania" }, apps: apps.map((a) => ({ id: a, name: a === "cross" ? "" : a[0]!.toUpperCase() + a.slice(1), color: "c0" })), items, ideas, sources: [], mode: "full", language: "es" });

test("I63-2: a stream's lights in order: ideas, what follows, what waits, the blocker last as a dam", () => {
  const data = brief(["micasa"], [item("micasa", "blocker", 1), item("micasa", "needs_you", 2), item("micasa", "next", 3)], [idea("micasa", 1), idea("micasa", 2)]);
  const d = delta.deltaOf({ list: city.stations(data, undefined), w: 1440, h: 650 });
  const s = d.streams[0];
  assert.deepEqual(s.lights.map((l: any) => l.kind), ["idea", "idea", "next", "toca", "block"]);
  const xs = s.lights.map((l: any) => l.x);
  assert.deepEqual([...xs].sort((a, b) => a - b), xs);
  assert.equal(s.dam, s.lights[4].x);
  assert.equal(s.sub, "detenido: tu paso");
  assert.equal(s.lights[3].label, "tag");
  assert.equal(s.lights[4].verb, "Tu paso · MIC-1");
  assert.equal(s.lights[3].verb, "Responder MIC-2");
  assert.equal(d.geo.gx, 1440 - 32 - 423 - 60);
  assert.deepEqual(delta.walkOf(d), ["i|micasa|blocker1", "i|micasa|needs_you2", "i|micasa|next3", "d|micasa|1", "d|micasa|2"]);
  assert.equal(delta.firstLight(d), "i|micasa|blocker1");
  // No blocker: the stream reaches Tú (no dam).
  const free = delta.deltaOf({ list: city.stations(brief(["filmia"], [item("filmia", "next", 1)]), undefined), w: 1440, h: 650 });
  assert.equal(free.streams[0].dam, null);
  assert.equal(free.streams[0].sub, "puede seguir solo");
});

test("I63-2: the cap: three ideas, five rows, two tags; the rest bare and +N picks the first hidden", () => {
  const rows = [1, 2, 3, 4].map((n) => item("plania", "needs_you", n)).concat([5, 6, 7].map((n) => item("plania", "next", n)));
  const data = brief(["plania"], rows, [1, 2, 3, 4, 5].map((n) => idea("plania", n)));
  const d = delta.deltaOf({ list: city.stations(data, undefined), w: 1440, h: 650 });
  const s = d.streams[0];
  assert.equal(s.lights.filter((l: any) => l.kind === "idea").length, 3);
  assert.equal(s.lights.filter((l: any) => l.kind !== "idea").length, 5);
  const toca = s.lights.filter((l: any) => l.kind === "toca");
  // Four «te toca» and three ideas leave room for one tag at 1440; the rest are rhombi with the title in their label.
  assert.deepEqual(toca.map((l: any) => l.label), ["tag", "bare", "bare", "bare"]);
  const two = delta.deltaOf({ list: city.stations(brief(["plania"], [item("plania", "needs_you", 1), item("plania", "needs_you", 2), item("plania", "next", 3)], [idea("plania", 1)]), undefined), w: 1440, h: 650 });
  assert.deepEqual(two.streams[0].lights.filter((l: any) => l.kind === "toca").map((l: any) => l.label), ["tag", "tag"]);
  assert.equal(two.streams[0].lights.find((l: any) => l.kind === "next").label, "key");
  assert.equal(s.more.n, 4);
  assert.equal(s.more.first, "d|plania|4");
  assert.equal(s.sub, "4 te tocan");
  assert.ok(s.lights.every((l: any) => l.x < d.geo.xc + 30));
  // A narrow stage drops the keys, then the tags, before anything leaves its zone.
  const narrow = delta.deltaOf({ list: city.stations(data, undefined), w: 1000, h: 560 });
  assert.ok(narrow.streams[0].lights.filter((l: any) => l.kind === "toca" && l.label === "tag").length < 2);
});

test("I63-2: counts, the river of Resuelto and the headline that follows them", () => {
  const data = brief(["filmia", "micasa"], [item("filmia", "needs_you", 1), item("filmia", "next", 2), item("micasa", "blocker", 3)], [idea("filmia", 1)]);
  const state = { brief_id: "b", read_only: false, items: { "i|filmia|needs_you1": { state: "handled", line: null, actions: [], action_id: "a", undo: true, at: "2026-11-17T15:00:00Z" } }, ideas: {} };
  const list = city.stations(data, state);
  const d = delta.deltaOf({ list, w: 1440, h: 650, settled: ["i|filmia|needs_you1"] });
  assert.deepEqual(d.counts, { ideas: 1, next: 1, toca: 1, blocked: 1, needs: 0, done: 1, total: 4 });
  assert.equal(d.river.length, 1);
  assert.equal(d.river[0].y, d.geo.oy);
  assert.deepEqual(delta.headlineOf({ total: 4, open: 3, blocked: 1, needs: 0 }), { l1: "Quedan tres de cuatro.", l2: "Una bloquea.", tone: "a" });
  assert.equal(delta.stepLight(d, d.river[0].id, 1), delta.walkOf(d)[0]);
  assert.equal(delta.hopStream(d, "i|filmia|next2", 1), "i|micasa|blocker3");
});

test("I63-2: seven projects and «Entre apps»: the step narrows to 64px and then the streams scroll", () => {
  const apps = ["a1", "a2", "a3", "a4", "a5", "a6"];
  const data = brief([...apps, "cross"], [...apps.map((a, i) => item(a, "next", i)), item("cross", "needs_you", 9)]);
  const list = city.stations(data, undefined);
  assert.equal(list[list.length - 1].slug, "cross");
  const d = delta.deltaOf({ list, w: 1440, h: 650 });
  assert.equal(d.streams.length, 7);
  assert.equal(d.streams[6].name, "Entre apps");
  assert.ok(d.geo.step >= 64 && d.geo.step < 80);
  assert.equal(d.geo.scroll, false);
  // One more stream, or a short window: the step stops at 64px and the streams scroll in their own box.
  const eight = city.stations(brief([...apps, "a7", "cross"], [...[...apps, "a7"].map((a, i) => item(a, "next", i)), item("cross", "needs_you", 9)]), undefined);
  const tight = delta.deltaOf({ list: eight, w: 1440, h: 650 });
  assert.equal(tight.geo.step, 64);
  assert.equal(tight.geo.scroll, true);
  assert.ok(tight.geo.oy > tight.streams[7].y);
  const out = html(h(deltaUi.BriefDelta, { delta: d, selected: d.streams[6].lights[0].id, onPick: () => {}, inHand: true }));
  assert.match(out, /data-who="cross"/);
  assert.match(out, /Entre apps/);
  assert.match(out, /aria-pressed="true"[^>]*data-light="i\|cross\|needs_you9"/);
  assert.match(out, /TÚ/);
  assert.match(out, /RESUELTO<b>0 \/ 7/);
  // Every light is a button with its kind and title in its label.
  assert.match(out, /<button type="button" class="cor-bf-lt[^"]*"[^>]*aria-label="Sigue: Fila 0"/);
});

test("I63-2: amber only on rhombi, the dam and Tú; reduced motion stops particles and pulses", () => {
  assert.match(css, /prefers-reduced-motion: reduce\) \{\n  \.cor \.cor-bf-spark, \.cor \.cor-bf-tu, \.cor \.cor-bf-lt\.arrive \{ animation: none; \}\n  \.cor \.cor-bf-pt, \.cor \.cor-bf-hp \{ display: none; \}/);
  assert.match(css, /\.cor-bf-lt \{[^}]*height: 44px/);
  assert.match(css, /\.cor-bf-who \{[^}]*height: 44px/);
});
