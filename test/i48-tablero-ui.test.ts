// PLA-I48-7: el Tablero del edificio, the rail's light and the phone, with fake data. Server-rendered and
// handler-level; the 375 px check and the Playwright + axe pass run on the demo server, outside the repo.
//   #1  three configured floors and one without settings: the rows, the count in the link, and Apagar todo calls
//       apagar once per live copy Plania started
//   and: the rail tile of a floor whose app is on shows a light; the phone CSS stacks the levels
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

(globalThis as { React?: unknown }).React = React;
const load = async (p: string) => (await import(new URL(`../ui/src/${p}`, import.meta.url).href)) as Record<string, any>;
const tab = await load("components/compania/edificio/tablero.tsx");
const tower = await load("components/compania/edificio/tower.tsx");
const lib = await load("lib/maquinas.ts");

type Json = Record<string, any>;
const h = React.createElement;
const row = (project: string, patch: Json = {}): Json => ({ project, title: project[0]!.toUpperCase() + project.slice(1), configured: true, phase: "off", managed: false, port: null, url: null, error: null, ...patch });
const four: Json = {
  floors: [
    row("lumen", { phase: "live", managed: true, port: 3000, url: "http://localhost:3000" }),
    row("faro", { phase: "running", managed: false, port: 3100, url: "http://localhost:3100" }),
    row("mareo", { phase: "off" }),
    row("bruma", { configured: false }),
  ],
  on: 2,
};

test("I48-7 #1: the rows, the count in the link, and the controls each floor gets", () => {
  const v = lib.tableroView(four);
  assert.equal(v.count, 2);
  assert.equal(lib.tableroLabel(v.count), "Tablero · 2 encendidas");
  assert.equal(lib.tableroLabel(1), "Tablero · 1 encendida");
  const out = renderToStaticMarkup(h(tab.Tablero, { read: { status: "ok", data: four }, acts: {} }));
  assert.match(out, /role="dialog" aria-label="Tablero del edificio"/);
  assert.equal((out.match(/data-row="/g) ?? []).length, 4);
  assert.match(out, /data-row="lumen" data-on="true"[\s\S]*?data-word="true">Encendida<[\s\S]*?:3000[\s\S]*?role="switch" aria-checked="true"/);
  assert.match(out, /data-row="faro" data-on="true"[\s\S]*?Encendida fuera de Plania[\s\S]*?fuera de Plania<\/span>/, "Plania cannot switch what it did not start");
  assert.match(out, /data-row="mareo"[\s\S]*?Apagada[\s\S]*?aria-checked="false"/);
  assert.match(out, /data-row="bruma"[\s\S]*?Sin configurar[\s\S]*?data-control="tablero-configurar"[^>]*>Configurar</);
  assert.match(out, /Plomería sigue contando tokens y corridas/);
  assert.match(renderToStaticMarkup(h(tab.Tablero, { read: { status: "loading" }, acts: {} })), /data-state="loading"/);
  assert.match(renderToStaticMarkup(h(tab.Tablero, { read: { status: "error", retry: () => {} }, acts: {} })), /data-state="error"/);
});

test("I48-7 #1: Apagar todo calls apagar once per live copy Plania started", async () => {
  const more: Json = { ...four, floors: [...four.floors, row("nube", { phase: "starting", managed: true, port: 3200 }), row("roca", { phase: "failed", managed: true, port: 3300 })] };
  const calls: string[] = [];
  const done = await tab.apagarTodo(more, async (slug: string) => void calls.push(slug));
  assert.deepEqual(calls, ["lumen", "nube", "roca"], "one each; never faro (started outside), mareo (off) or bruma");
  assert.deepEqual(done, calls);
  // The button is wired to it, and is off when nothing is Plania's to stop.
  const quiet = renderToStaticMarkup(h(tab.Tablero, { read: { status: "ok", data: { floors: [row("mareo"), row("faro", { phase: "running", port: 3100 })], on: 1 } }, acts: {} }));
  assert.match(quiet, /disabled=""[^>]*data-control="tablero-apagar-todo"/);
  const src = readFileSync(new URL("../ui/src/components/compania/edificio/tablero.tsx", import.meta.url), "utf8");
  assert.ok(src.includes('apagarTodo(q.data!, (slug) => api.prueba(slug, "apagar"))'));
});

test("I48-7: the tablero sits beside Plomería, which keeps its meaning", () => {
  const page = readFileSync(new URL("../ui/src/pages/ceo.tsx", import.meta.url), "utf8");
  const at = page.indexOf("Plomería · {plumbingLine(company.plumbing).text}");
  assert.ok(at > 0);
  assert.ok(page.indexOf("<TableroLive", at) > at && page.indexOf("<TableroLive", at) - at < 400, "right after the Plomería link");
});

test("I48-7: the rail tile of a floor whose app is on shows a light", () => {
  const p = (slug: string): Json => ({ slug, title: slug, team: [], route: null, plan: null, light: "ok" });
  const out = renderToStaticMarkup(h(tower.Tower, { floors: [p("lumen"), p("mareo")], basement: [], decisions: [], projects: [], open: "lumen", appsOn: ["lumen"], onNew: () => {} }));
  assert.match(out, /data-tile="lumen"[^>]*data-app="on"[^>]*aria-label="lumen, la app está encendida"/);
  assert.match(out, /data-tile="lumen"[\s\S]*?<i class="edi-tile-app"/);
  assert.ok(!/data-tile="mareo"[^>]*data-app/.test(out));
});

test("I48-7: on a phone the levels stack, only the shown one is drawn, and La ficha stays the bottom sheet", () => {
  const css = readFileSync(new URL("../ui/src/index.css", import.meta.url), "utf8");
  const phone = css.slice(css.indexOf("/* Under 48rem the levels stack as one column"));
  assert.ok(phone.includes(".edi-level[inert] { display: none; }"));
  assert.ok(phone.includes(".edi-maq { height: auto; grid-template-columns: minmax(0, 1fr);"));
  assert.ok(phone.includes(".edi-maq-url code { flex-basis: 100%; order: 5; }"), "the address wraps instead of pushing sideways");
  assert.ok(!css.includes(".edi-bld > .edi-ficha"), "PLA-I55-1: La ficha is in the page's flow on a phone, not a sheet");
});
