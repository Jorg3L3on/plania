// PLA-I47-5: El edificio zoomed out, with fake data. Server-rendered and handler-level; no browser, no database.
//   #1  four running and one paused project: rows in the tower's order (floorOrder), the owner's move only on the rows
//       that have one, a row opens its floor; the paused one under the street
//   #3  nothing floats at the bottom right any more; the tower's top button zooms out and the page keeps ?edificio
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";

(globalThis as { React?: unknown }).React = React;
const load = async (p: string) => (await import(new URL(`../ui/src/${p}`, import.meta.url).href)) as Record<string, any>;
const building = await load("components/compania/edificio/building.tsx");
const facade = await load("components/compania/edificio/facade.tsx");
const lib = await load("lib/edificio.ts");

type Json = Record<string, any>;
const h = React.createElement;
const NOW = new Date("2026-11-10T18:00:00Z").getTime();
const TZ = "America/Mexico_City";
const member = (slug: string, role: string, state = "idle"): Json => ({ agent: `${role}-${slug}`, role, template: role, state, now: null, last: null, produced: null, waiting: null, queue: [] });
const project = (slug: string, title: string, patch: Json = {}): Json => ({
  slug,
  title,
  paused: false,
  light: "ok",
  light_reason: null,
  goal: null,
  rumbo: { goal_id: "g", goal: `Meta de ${title}`, why: "", target_on: "2026-12-05", forecast_on: "2026-12-05", weeks_behind: 0, missing: false },
  usage: { used: 0 },
  team: ["product-owner", "taller"].map((r) => member(slug, r)),
  thread: { id: `t-${slug}`, unread: 0, last: null },
  plan: null,
  route: { legs: [{ key: `${slug.toUpperCase()}-I1`, title: "Arranque", done: 1, total: 3, state: "here", note: null, steps: [] }], more_legs: 0 },
  this_week: { done: 0, docs: 0, prs: 0, last_at: null },
  next: null,
  ready: [],
  work: { open: 0, in_progress: 0 },
  orders: [],
  next_move: null,
  ...patch,
});
const publish = { verbo: "publicar", texto: "Publicar 2 cambios", accion: { kind: "publish", label: "Publicar" }, origen: { kind: "light" } };
const projects = [
  project("alba", "Alba"),
  project("brisa", "Brisa", { light: "needs_jorge", next_move: publish }),
  project("cauce", "Cauce", { team: [member("cauce", "product-owner"), member("cauce", "taller", "running")] }),
  project("duna", "Duna"),
  project("eco", "Eco", { paused: true, light: "paused" }),
];
const ctx = (calls: string[] = []) => ({ decisions: [], onPublish: (p: Json) => calls.push(`publish ${p.slug}`) });

test("I47-5 #1: one row per running project in the tower's order, the move only where it is the owner's, a row opens its floor", () => {
  const order = lib.floorOrder(projects, []).floors.map((p: Json) => p.slug);
  const out = renderToStaticMarkup(h(facade.Facade, { projects, decisions: [], now: NOW, timeZone: TZ, ctx: ctx() }));
  assert.deepEqual([...out.matchAll(/data-fa-row="([a-z]+)"/g)].map((m) => m[1]), order, "the tower's order");
  assert.equal(order[0], "brisa", "the floor that waits on the owner first");
  assert.deepEqual([...out.matchAll(/data-fa-move="([a-z]+)"/g)].map((m) => m[1]), ["brisa"], "the move only on the row that has one");
  assert.match(out, /data-where="edificio"[^>]*>Publicar</);
  const under = out.slice(out.indexOf("data-fa-under"));
  assert.ok(under.includes("Bajo la calle · en pausa") && under.includes('data-fa-off="eco"'));
  assert.equal(out.includes('data-fa-row="eco"'), false, "a paused project is not a row");
  assert.ok(out.includes("Meta de Alba") && out.includes('data-look="now"'));
  // A row opens its floor; the move runs the same thing as Ahora's.
  const seen: string[] = [];
  const el = facade.Facade({ projects, decisions: [], now: NOW, timeZone: TZ, ctx: ctx(seen), onPiso: (s: string) => seen.push(`piso ${s}`) });
  const kids = (n: any): any[] => {
    if (!n || typeof n !== "object") return [];
    if (Array.isArray(n)) return n.flatMap(kids);
    if (typeof n.type === "function" && n.type !== facade.Facade) return kids(n.type(n.props));
    return [n, ...kids(n.props?.children)];
  };
  const all = kids(el);
  all.filter((e) => e.props?.["data-control"] === "fa-abrir")[1].props.onClick();
  all.find((e) => e.props?.["data-where"] === "edificio").props.onClick();
  assert.deepEqual(seen, [`piso ${order[1]}`, "publish brisa"]);
});

test("I47-5: Building zooms out with office (?edificio): no floor, no ficha, the roof on top; zoomed in it draws one floor", () => {
  const company = { company: { paused: false }, week: { starts_at: "2026-11-09T06:00:00Z", resets_at: "2026-11-16T06:00:00Z", timezone: TZ }, asistente: { thread_id: "t", usage: { used: 0 }, last_run: null, state: "idle", unread: 0 }, projects, plumbing: { spend: 0, running: 0, paused: false }, decisions: [], inbox: { decisiones: 0, pasos: 0 } };
  const render = (extra: Json) => renderToStaticMarkup(h(MemoryRouter, null, h(building.Building, { company, decisions: [], now: NOW, timeZone: TZ, hello: "Hola", day: "Martes", onNew: () => {}, ventanal: () => h("section", { className: "edi-ficha" }), ...extra })));
  const out = render({ office: true });
  assert.ok(out.includes('data-zoom="out"') && out.includes("data-facade=") && out.includes("data-roof"));
  assert.equal(/<article [^>]*class="edi-floor"/.test(out) || out.includes('class="edi-ficha"'), false);
  assert.equal((out.match(/data-roof/g) ?? []).length, 1, "one roof, not the hidden overlay too");
  const inside = render({});
  assert.ok(inside.includes('data-zoom="in"') && /<article [^>]*class="edi-floor"/.test(inside) && inside.includes('class="edi-ficha"') && !inside.includes("data-facade="));
});

test("I47-5 #3: no floating corner button is left; the page keeps the zoom in the address and Esc walks it", () => {
  const css = readFileSync(new URL("../ui/src/index.css", import.meta.url), "utf8");
  assert.equal((css.match(/edi-fab/g) ?? []).length, 0);
  const page = readFileSync(new URL("../ui/src/pages/ceo.tsx", import.meta.url), "utf8");
  assert.ok(page.includes('has("edificio")') && page.includes("office={zoomOut}") && page.includes('e.key === "Escape" && zoomOut'));
  assert.ok(page.includes('openSheet(sheetSearch({ kind: "asistente" }))'), "Asistente still opens ?asistente");
});
