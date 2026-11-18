// PLA-I63: the Morning brief as a Compañía place (/ceo?v=brief). Server-rendered with react-dom/server and the pure
// model called directly. Clicks, measures, axe and motion run in the real-browser pass on the demo server.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
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

test("I63-1/5: the states without a brief, and the Brief tab after Plomería with its amber count", () => {
  for (const [state, text] of [["empty", "lo primero que te toca"], ["off", "brief apagado"], ["failed", "Reintentar"]] as const) {
    const out = html(h(page.BriefView, { kick: "Brief · mar 17 nov", live: false, headline: delta.noBriefHeadline(state), tools: null, state, onRetry: () => {} }));
    assert.match(out, new RegExp(`data-brief-state="${state}"`));
    assert.match(out, new RegExp(text));
  }
  assert.match(html(h(page.BriefView, { kick: "k", live: false, headline: delta.noBriefHeadline("loading"), tools: null, state: "loading" })), /aria-busy="true".*role="status"/s);
  const head = (view: string | null, briefToca = 0) => html(h(header.Head, { view, waiting: 0, now: Date.parse("2026-11-17T15:00:00Z"), pedirTo: "/ceo?v=pedir", tocaTo: "/ceo?v=tetoca", briefToca }));
  assert.match(head("corriente"), />Plomería<\/a><a class="cor-tab" href="\/ceo\?v=brief"[^>]*>Brief<\/a>/);
  assert.match(head("brief"), /aria-current="page"[^>]*>Brief/);
  assert.match(head("corriente", 5), />Brief<span class="cor-count amber">5<\/span>/);
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

// ---- I63-3: the card in hand
const card = await load("components/corriente/brief-card.tsx");
const i18n = await load("lib/brief-i18n.ts");
const cardProps = (over: Record<string, any> = {}) => {
  const data = brief(["filmia"], [item("filmia", "needs_you", 1, "Filtros por género"), item("filmia", "next", 2)], [idea("filmia", 1)]);
  const st = { brief_id: "b", read_only: false, items: {
    "i|filmia|needs_you1": { state: "open", line: null, action_id: null, undo: false, live: { kind: "pr", number: 212, state: "open", base: "sandbox", url: "https://github.com/x/y/pull/212", ticket: { key: "FIL-35", status: "In review" }, message_id: null }, actions: [{ id: "accept_pr", level: "confirm", undo: true, target: 0 }, { id: "request_changes", level: "instant", undo: true, target: 0 }, { id: "later", level: "instant", undo: true, target: null }, { id: "dismiss", level: "instant", undo: true, target: null }] },
    "i|filmia|next2": { state: "open", line: null, action_id: null, undo: false, live: { kind: "ticket", key: "K-2", status: "Ready", title: "x", first: false, paused: true, owner: null }, actions: [{ id: "put_first", level: "instant", undo: true, target: 0 }, { id: "start_now", level: "wake", undo: false, target: 0, wake: { agent: "taller-filmia", role: "taller", low: 10, high: 25, paused: true, company_paused: false, busy: false } }] },
  }, ideas: {} };
  const list = city.stations(data, st);
  const d = delta.deltaOf({ list, w: 1440, h: 650 });
  return { light: d.streams[0].lights.find((l: any) => l.kind === "toca"), station: list[0], data, state: st, local: {}, language: "es", readOnly: false, acting: false, position: [1, 3], onStep: () => {}, onAct: async () => ({}), onHandled: () => {}, onUndo: async () => {}, ideaCost: () => ({ bots: 1, low: 10, high: 25 }), plans: new Map(), links: { paso: (s: string, k: string) => `/ceo?proyecto=${s}&ver=paso:${k}`, idea: (s: string, k: string) => `/ceo?proyecto=${s}&ver=idea:${k}` }, ...over, d };
};

test("I63-3: La corriente's words over the brief's (both languages); the old /brief keeps its own", () => {
  const es = i18n.corLabels("es").d;
  assert.equal(es.verbs.accept_pr, "Aceptar");
  assert.equal(es.verbs.request_changes, "Pedir ajuste");
  assert.equal(es.verbs.publish, "Publicar");
  assert.equal(es.kinds.ticket, "Paso");
  assert.equal(es.kinds.pr, "Entrega");
  assert.equal(i18n.corLabels("en").d.verbs.accept_pr, "Accept");
  assert.equal(i18n.BRIEF_LABELS.es.d.verbs.accept_pr, "Aprobar y pasar a prueba");
  assert.equal(i18n.BRIEF_LABELS.en.d.verbs.accept_pr, "Approve into the test copy");
});

test("I63-3: a delivery's card: evidence, one white button (Aceptar ↵), Pedir ajuste, Después L, No aplica X, Ver its paso", () => {
  const p = cardProps();
  const out = html(h(card.BriefCard, p));
  assert.match(out, /data-brief="card"/);
  assert.match(out, /Te toca · Entrega/);
  assert.match(out, /data-brief="evidence".*#212 · open → copia de prueba.*Paso<\/dt><dd>FIL-35 · In review/s);
  assert.equal((out.match(/cor-btn primary/g) ?? []).length, 1);
  assert.match(out, /class="cor-btn primary"[^>]*data-act="accept_pr"[^>]*>Aceptar<kbd>↵<\/kbd>/);
  assert.match(out, /data-act="request_changes"[^>]*>Pedir ajuste/);
  assert.match(out, /data-act="later"[^>]*>Después <kbd>L<\/kbd>/);
  assert.match(out, /data-act="dismiss"[^>]*>No aplica <kbd>X<\/kbd>/);
  assert.match(out, /data-see="K-1" href="\/ceo\?proyecto=filmia&amp;ver=paso:K-1"/);
  assert.match(out, /En la mano · 1 de 3/);
});

test("I63-3: the confirm, the note for Pedir ajuste, the wake's cost line, failed, a paused project and a past day", () => {
  const p = cardProps();
  assert.match(html(h(card.BriefCard, { ...p, initialPending: { kind: "confirm", action: "accept_pr", target: 0 } })), /data-brief="confirm".*integra el PR #212.*data-act="confirm-accept_pr"[^>]*>Aceptar/s);
  assert.match(html(h(card.BriefCard, { ...p, initialPending: { kind: "changes", target: 0 } })), /data-brief="changes".*Enviar nota/s);
  assert.match(html(h(card.BriefCard, { ...p, initialPending: { kind: "failed", action: "accept_pr", target: 0, error: "GH", hint: "GitHub no respondió" } })), /role="alert".*No se pudo: GitHub no respondió.*Nada cambió.*Intentar otra vez/s);
  const next = { ...p, light: p.d.streams[0].lights.find((l: any) => l.kind === "next") };
  const paused = html(h(card.BriefCard, next));
  assert.match(paused, /data-brief="waiting-paused"[^>]*>En espera: las corridas de Filmia están en pausa/);
  assert.match(html(h(card.BriefCard, { ...next, initialPending: { kind: "wake", action: "start_now", target: 0 } })), /data-brief="cost"[^>]*>Despierta a taller-filmia · unos 10–25 min · usa tu plan, \$0 · espera a que Filmia tenga corridas/);
  const past = html(h(card.BriefCard, { ...p, readOnly: true }));
  assert.match(past, /Un día pasado: solo lectura/);
  assert.doesNotMatch(past, /data-act=/);
});

test("I63-3: an idea's five fates (Que lo planee ↵, Boceto, Investigar, Guardar, Descartar X) and the reasons", () => {
  const p = cardProps();
  const ideaLight = p.d.streams[0].lights.find((l: any) => l.kind === "idea");
  const out = html(h(card.BriefCard, { ...p, light: ideaLight }));
  for (const a of ["plan", "sketch", "research", "keep", "discard"]) assert.match(out, new RegExp(`data-act="${a}"`));
  assert.match(out, /class="cor-btn primary"[^>]*data-act="plan"[^>]*>Que lo planee/);
  const reasons = html(h(card.BriefCard, { ...p, light: ideaLight, initialPending: { kind: "discard" } }));
  for (const r of ["not_now", "not_for_product", "exists", "too_big", "costs_money", "other"]) assert.match(reasons, new RegExp(`data-act="reason-${r}"`));
  assert.match(html(h(card.BriefCard, { ...p, light: ideaLight, initialPending: { kind: "idea-wake", action: "plan" } })), /Despierta 1 bot de proyecto · unos 10–25 min · usa tu plan, \$0/);
});

test("I63-3: a settled card shows its stamp, its line and Deshacer (Z); this visit's settling drops it into the river", () => {
  const p = cardProps();
  const local = { "i|filmia|needs_you1": { word: "Aceptado", ink: "go", at: "2026-11-17T15:12:00Z", actionId: "a1", undo: true, line: "Pasó a la copia de prueba.", action: "accept_pr" } };
  const merged = delta.mergeLocal(p.state, local);
  assert.equal(merged.items["i|filmia|needs_you1"].state, "handled");
  const list = city.stations(p.data, merged);
  const d = delta.deltaOf({ list, w: 1440, h: 650, settled: ["i|filmia|needs_you1"] });
  assert.equal(d.river[0].id, "i|filmia|needs_you1");
  assert.equal(delta.nextAfter(p.d, "i|filmia|needs_you1"), "i|filmia|next2");
  const out = html(h(card.BriefCard, { ...p, light: d.river[0], state: merged, local }));
  assert.match(out, /data-brief="stamp".*Aceptado/s);
  assert.match(out, /Pasó a la copia de prueba\./);
  assert.match(out, /data-undo="i\|filmia\|needs_you1"[^>]*>Deshacer <kbd>Z<\/kbd>/);
});

// ---- I63-4: states and edges
test("I63-4: a failed run keeps the brief and says why, with the steps to fix it and Reintentar", () => {
  const base = { language: "es", refreshFailed: false, missing: null, generatedAt: "2026-11-17T13:00:00Z", timeZone: "America/Mexico_City", canRetry: true, onRetryRun: () => {}, onRefresh: () => {} };
  const auth = html(h(page.BriefNotice, { ...base, lastRun: { status: "fail", kind: "auth", reason: "x", ended_at: "2026-11-17T15:10:00Z" }, initialFix: true }));
  assert.match(auth, /data-brief="last-run".*No se pudo actualizar a las 09:10\..*Claude perdió su sesión.*Sigues viendo el brief de las 07:00/s);
  assert.match(auth, /data-brief="fix-steps".*Escribe claude y luego \/login/s);
  assert.match(auth, /data-brief="retry-run"/);
  assert.match(html(h(page.BriefNotice, { ...base, lastRun: { status: "fail", kind: "other", reason: "el pase tardó demasiado", ended_at: "2026-11-17T15:10:00Z" } })), /el pase tardó demasiado/);
  assert.match(html(h(page.BriefNotice, { ...base, lastRun: null, refreshFailed: true })), /data-brief="refresh-failed".*No se pudo actualizar\..*Reintentar/s);
  assert.match(html(h(page.BriefNotice, { ...base, lastRun: null, missing: "ideas" })), /data-brief="missing"[^>]*>.*No llegaron las ideas de hoy\./s);
  assert.equal(html(h(page.BriefNotice, { ...base, lastRun: null })), "");
});

test("I63-4: all settled: the headline, Tú violet, thin streams, a full river", () => {
  const data = brief(["filmia", "micasa"], [item("filmia", "needs_you", 1), item("micasa", "next", 2)]);
  const st = { brief_id: "b", read_only: false, items: Object.fromEntries(data.items.map((i: any) => [i.id, { state: "handled", line: null, actions: [], action_id: "a", undo: true, at: "2026-11-17T15:00:00Z" }])), ideas: {} };
  const d = delta.deltaOf({ list: city.stations(data, st), w: 1440, h: 650 });
  assert.deepEqual([d.counts.done, d.counts.total, d.counts.toca], [2, 2, 0]);
  assert.ok(d.streams.every((s: any) => s.width === 1 && s.sub === "al día" && !s.lights.length));
  assert.equal(d.river.length, 2);
  assert.equal(delta.headlineOf({ total: 2, open: 0, blocked: 0, needs: 0 }).l1, "Todo resuelto por hoy.");
  const out = html(h(deltaUi.BriefDelta, { delta: d, selected: null, onPick: () => {}, inHand: false }));
  assert.match(out, /cor-bf-tu free/);
  assert.match(out, /cor-bf-gl free/);
  assert.match(out, /RESUELTO<b>2 \/ 2/);
});

test("I63-4: the phone: no curves, one list per project, the card under the chosen light, Resuelto as a row", () => {
  const data = brief(["filmia", "micasa"], [item("filmia", "needs_you", 1), item("micasa", "blocker", 2)], [idea("filmia", 1)]);
  const d = delta.deltaOf({ list: city.stations(data, undefined), w: 1440, h: 650 });
  const out = html(h(deltaUi.BriefPhone, { delta: d, selected: "i|micasa|blocker2", onPick: () => {}, card: h("div", { "data-test": "card" }) }));
  assert.doesNotMatch(out, /<svg class="cor-bf-svg"/);
  assert.match(out, /data-stream="filmia".*data-stream="micasa".*data-test="card".*data-stream="resuelto"/s);
  assert.equal((out.match(/data-test="card"/g) ?? []).length, 1);
  assert.match(out, /class="cor-bf-lt flow sel"/);
  assert.match(css, /@media \(max-width: 639px\) \{\n  \.cor-bf \{ flex: none; \}/);
});

// ---- I63-5: the switch
test("I63-5: /brief, the Te toca link and a plan notice open /ceo?v=brief; Brief left the app bar", () => {
  const app = readFileSync(new URL("../ui/src/App.tsx", import.meta.url), "utf8");
  assert.match(app, /<Route path="\/brief" element={<Navigate to="\/ceo\?v=brief" replace \/>} \/>/);
  assert.doesNotMatch(app, /pages\/brief/);
  const org = readFileSync(new URL("../src/api/company-org.ts", import.meta.url), "utf8");
  assert.match(org, /link: "\/ceo\?v=brief" \} : null/);
  assert.match(readFileSync(new URL("../src/brief/pipeline.ts", import.meta.url), "utf8"), /link: "\/ceo\?v=brief"/);
  assert.match(readFileSync(new URL("../ui/src/lib/org.ts", import.meta.url), "utf8"), /brief_plan"\) return "\/ceo\?v=brief"/);
  const shell = readFileSync(new URL("../ui/src/components/app-shell.tsx", import.meta.url), "utf8");
  assert.match(shell, /\["\/ceo", "\/machine"\]/);
  for (const gone of ["../ui/src/pages/brief.tsx", "../ui/src/components/brief/city.tsx"]) assert.equal(existsSync(new URL(gone, import.meta.url)), false, gone);
  assert.equal(lib.legacyHref({ view: "brief" }), "/ceo?v=brief");
});

test("I63-5: the pure brief model the delta reads: keys, missing parts, open ideas", () => {
  assert.equal(city.keyCommand({ key: "j" }), "next");
  assert.equal(city.keyCommand({ key: "ArrowLeft" }), "prevProject");
  assert.equal(city.keyCommand({ key: "Enter", target: { tagName: "BUTTON" } }), null);
  assert.equal(city.keyCommand({ key: "l", target: { tagName: "TEXTAREA" } }), null);
  assert.equal(city.keyCommand({ key: "Escape", target: { tagName: "TEXTAREA" } }), "escape");
  assert.equal(city.keyCommand({ key: "z", metaKey: true }), null);
  const data = brief(["filmia"], [item("filmia", "next", 1)], [idea("filmia", 1)]);
  assert.equal(city.missingPart(data), null);
  assert.equal(city.missingPart({ ...data, mode: "partial", sources: [{ name: "claude_ideas", ok: false }] }), "ideas");
  assert.equal(city.ideaOpen(data.ideas[0], undefined, [], new Set(["I1"])), false);
  assert.equal(city.ideaOpen(data.ideas[0], undefined, [], new Set()), true);
});
