// PLA-I59-3 (Motores): the console's draft logic (inherit vs own, ↺, presets, the pending count, the save it sends,
// the usage hint) and what the console, the Motor card and the Equipo chip render. Fake data, no browser.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

(globalThis as { React?: unknown }).React = React;
const load = async (p: string) => (await import(new URL(`../ui/src/${p}`, import.meta.url).href)) as Record<string, any>;
const lib = await load("lib/motores.ts");
const ui = await load("components/compania/edificio/motores.tsx");
const h = React.createElement;

const mv = (model: string | null, effort: string | null, own_model = false, own_effort = false) => ({ model, effort, own_model, own_effort });
const member = (role: string, agent: string, patch: Record<string, unknown> = {}) => ({ agent, role, template: role, state: "idle", now: null, last: null, produced: null, waiting: null, ...patch });
const DEF = { model: "opus", effort: "high" };
const TEAM = [
  member("product-owner", "po-mia", { motor: mv("opus", "high"), consulta_motor: mv("haiku", "high", true, false), used_week: { tokens: 10, share: 0.07 } }),
  member("research", "research-mia", { state: "running", motor: mv("opus", "high"), used_week: { tokens: 80, share: 0.58 } }),
  member("taller", "taller-mia", { motor: mv("sonnet", "max", true, true), used_week: { tokens: 50, share: 0.35 } }),
];
const project = { slug: "mia", title: "Mianovia", team: TEAM };

test("I59-3: the draft keeps only what each strip sets itself; Preguntar is a sub-strip of the PO", () => {
  const d = lib.draftOf(TEAM, DEF);
  assert.deepEqual(d.company, { model: "opus", effort: "high" });
  assert.deepEqual(d.strips.map((s: any) => s.key), ["po-mia", "po-mia#preguntar", "research-mia", "taller-mia"]);
  const ask = d.strips[1];
  assert.deepEqual([ask.sub, ask.ownModel, ask.model, ask.ownEffort], [true, true, "haiku", false]);
  assert.deepEqual(lib.shownOf(d, ask), { model: "haiku", effort: "high", fromCompany: { model: false, effort: true } });
  assert.deepEqual(lib.shownOf(d, d.strips[3]), { model: "sonnet", effort: "max", fromCompany: { model: false, effort: false } });
});

test("I59-3: changing a part makes it own; ↺ clears both; nothing changed means nothing pending", () => {
  const saved = lib.draftOf(TEAM, DEF);
  assert.deepEqual(lib.pendingOf(saved, saved), { strips: [], company: false });
  const r = lib.setModel(saved.strips[2], "sonnet");
  assert.deepEqual([r.ownModel, r.ownEffort], [true, false]);
  const back = lib.clearStrip(saved.strips[3]);
  assert.equal(lib.isOwn(back), false);
  const d = { ...saved, strips: saved.strips.map((s: any) => (s.key === "research-mia" ? r : s.key === "taller-mia" ? back : s)) };
  assert.deepEqual(lib.pendingOf(saved, d).strips, ["research-mia", "taller-mia"]);
  assert.deepEqual(lib.saveOf("mia", saved, d), { project: "mia", seats: [{ agent: "research-mia", motor: { model: "sonnet", effort: null } }, { agent: "taller-mia", motor: null }] });
});

test("I59-3: presets set every strip; «Como la compañía» clears them; the default saves as company", () => {
  const saved = lib.draftOf(TEAM, DEF);
  const fast = lib.applyPreset(saved, "rapido");
  assert.ok(fast.strips.every((s: any) => s.model === "sonnet" && s.ownModel && s.ownEffort));
  assert.equal(fast.strips.find((s: any) => s.key === "po-mia#preguntar").effort, "low");
  const deep = lib.applyPreset(saved, "fondo");
  assert.ok(deep.strips.filter((s: any) => !s.sub).every((s: any) => s.model === "opus" && s.effort === "xhigh"));
  const co = lib.applyPreset(saved, "compania");
  assert.ok(co.strips.every((s: any) => !lib.isOwn(s)));
  const save = lib.saveOf("mia", saved, { ...co, company: { model: "sonnet", effort: "medium" } });
  assert.deepEqual(save.company, { model: "sonnet", effort: "medium" });
  assert.deepEqual(save.seats.find((x: any) => x.agent === "po-mia"), { agent: "po-mia", consulta_motor: null });
});

test("I59-3: the hint names a big-share seat on Opus or Fable, and goes once it is on Sonnet", () => {
  const saved = lib.draftOf(TEAM, DEF);
  assert.deepEqual(lib.hintOf(TEAM, saved), { agent: "research-mia", role: "research", pct: 58, on: "opus" });
  const moved = { ...saved, strips: saved.strips.map((s: any) => (s.key === "research-mia" ? lib.setModel(s, "sonnet") : s)) };
  assert.equal(lib.hintOf(TEAM, moved), null);
});

test("I59-3: the console draws a strip per seat, Preguntar, the Compañía strip, presets and a disabled Guardar", () => {
  const html = renderToStaticMarkup(h(ui.MotoresConsole, { project, def: DEF, onSave: async () => ({}) })).replaceAll("<!-- -->", "");
  for (const k of ["po-mia", "po-mia#preguntar", "research-mia", "taller-mia", "compania"]) assert.ok(html.includes(`data-strip="${k}"`), k);
  assert.equal((html.match(/data-control="motor-preajuste-/g) ?? []).length, 4);
  assert.ok(html.includes("Motores de Mianovia"));
  // Preguntar and Taller set their own; PO and Research follow the company.
  assert.equal((html.match(/Propio · ↺/g) ?? []).length, 2);
  assert.equal((html.match(/>De la compañía</g) ?? []).length, 2);
  assert.match(html, /data-control="motor-guardar"[^>]*disabled|disabled[^>]*data-control="motor-guardar"/);
  assert.ok(html.includes('data-hint="research-mia"'));
  assert.equal(/\$|USD/.test(html), false, "no money on screen");
});

test("I59-3: the Motor card shows the seat's motor and where it comes from; the chip dims an inherited motor", () => {
  const card = renderToStaticMarkup(h(ui.MotorCard, { project, member: TEAM[2], def: DEF, onSave: async () => ({}), onAll: () => {} })).replaceAll("<!-- -->", "");
  assert.ok(card.includes("Motor en Mianovia") && card.includes("Sonnet · máximo") && card.includes("Propio de este proyecto"));
  assert.ok(card.includes("Volver al de la compañía (Opus · alto)"));
  const inherited = renderToStaticMarkup(h(ui.EngineChip, { m: TEAM[1] }));
  assert.ok(inherited.includes('data-own="0"') && inherited.includes(">O<"));
  assert.equal((inherited.match(/data-on="1"/g) ?? []).length, 3);
  const own = renderToStaticMarkup(h(ui.EngineChip, { m: TEAM[2] }));
  assert.ok(own.includes('data-own="1"') && (own.match(/data-on="1"/g) ?? []).length === 5);
  assert.equal(renderToStaticMarkup(h(ui.EngineChip, { m: member("qa", "qa-mia") })), "");
});
