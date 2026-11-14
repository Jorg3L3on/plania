// PLA-I47-2: one floor at a time, with the tower rail (Design doc of PLA-IDEA13, frames 1-6). Server-rendered with
// react-dom/server and fake data; no browser, no database. The size check runs in headless Chrome, outside the repo.
//   #2  two projects: one floor in the markup, the rail with two tiles, ?piso=<slug> choosing the floor
//   #5  ↑ ↓ walk the tower's order (stepFloor); the page listens for the keys, Building stays hook-free
//   and: the CSS sizes the building to the window (never a min-height from content) and keeps no plate column
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { nextMove } from "../src/api/company-move.js";

(globalThis as { React?: unknown }).React = React;
const load = async (p: string) => (await import(new URL(`../ui/src/${p}`, import.meta.url).href)) as Record<string, any>;
const building = await load("components/compania/edificio/building.tsx");
const tower = await load("components/compania/edificio/tower.tsx");

type Json = Record<string, any>;
const h = React.createElement;
const NOW = new Date("2026-11-10T18:00:00Z").getTime();
const TZ = "America/Mexico_City";
const member = (slug: string, role: string, patch: Json = {}): Json => ({ agent: `${role}-${slug}`, role, template: role, state: "idle", now: null, last: null, produced: null, waiting: null, queue: [], ...patch });
const project = (slug: string, title: string, patch: Json = {}): Json => ({
  slug,
  title,
  paused: false,
  light: "ok",
  light_reason: null,
  goal: null,
  rumbo: { goal_id: null, goal: "Una meta de prueba", why: "", target_on: "2026-12-05", forecast_on: "2026-12-05", weeks_behind: 0, missing: false },
  usage: { used: 0 },
  team: ["product-owner", "taller"].map((r) => member(slug, r)),
  thread: { id: `t-${slug}`, unread: 0, last: null },
  plan: null,
  this_week: { done: 0, docs: 0, prs: 0, last_at: null },
  next: null,
  ready: [],
  work: { open: 0, in_progress: 0 },
  orders: [],
  ...patch,
});
const company = (projects: Json[]): Json => ({
  company: { paused: false },
  week: { starts_at: "2026-11-09T06:00:00Z", resets_at: "2026-11-16T06:00:00Z", timezone: TZ },
  asistente: { thread_id: "t-co", usage: { used: 0 }, last_run: null, state: "idle", unread: 0 },
  projects: projects.map((p) => ({ ...p, next_move: nextMove(p as never, [], { companyPaused: false }) })),
  plumbing: { spend: 0, running: 0, paused: false },
  decisions: [],
  inbox: { decisiones: 0, pasos: 0 },
});
const render = (c: Json, extra: Json = {}) =>
  renderToStaticMarkup(h(MemoryRouter, null, h(building.Building, { company: c, decisions: [], now: NOW, timeZone: TZ, hello: "Hola", day: "Martes", onNew: () => {}, ...extra })));

const two = company([project("lumen", "Lumen"), project("faro", "Faro")]);

test("I47-2 #2: two projects draw one floor, a rail with two tiles, and ?piso=<slug> picks the floor", () => {
  const out = render(two);
  assert.equal((out.match(/<article [^>]*class="edi-floor"/g) ?? []).length, 1, "one floor in the markup");
  assert.equal((out.match(/data-tile="/g) ?? []).length, 2, "two tiles on the rail");
  assert.match(out, /<nav class="edi-rail"[^>]*data-tower="2"/);
  // Without ?piso the first floor in the tower's order is open, and its tile is aria-current.
  assert.equal(tower.openFloor([], [], null), null, "no floors, nothing open");
  const order = [...out.matchAll(/data-tile="([a-z]+)"/g)].map((m) => m[1]);
  assert.ok(out.includes(`data-floor="${order[0]}"`));
  assert.match(out, new RegExp(`aria-current="true" data-tile="${order[0]}"`));
  // ?piso=<slug> opens that floor.
  const other = order[1]!;
  const picked = render(two, { piso: other });
  assert.ok(picked.includes(`data-floor="${other}"`) && !picked.includes(`data-floor="${order[0]}"`));
  assert.match(picked, new RegExp(`aria-current="true" data-tile="${other}"`));
  // An unknown slug falls back to the first floor.
  assert.ok(render(two, { piso: "nadie" }).includes(`data-floor="${order[0]}"`));
  // The rail comes before the floor, and the floor ends with Pedir (Tab: rail, floor, Pedir).
  const asked = render(two, { askFor: (p: Json) => h("button", { "data-control": "pedir-abrir" }, `Pedir ${p.slug}`) });
  assert.ok(asked.indexOf("edi-rail") < asked.indexOf('class="edi-floor"') && asked.indexOf('class="edi-floor"') < asked.indexOf('data-control="pedir-abrir"'));
  // A tile click calls onPiso with its slug; «+» is the new-floor door.
  const seen: string[] = [];
  const rail = tower.Tower({ floors: two.projects, basement: [], decisions: [], projects: two.projects, open: "lumen", onPiso: (s: string) => seen.push(s), onNew: () => seen.push("+") });
  const kids = (el: Json): Json[] => [el, ...React.Children.toArray(el?.props?.children).flatMap((c) => (typeof c === "object" ? kids(c as Json) : []))];
  const all = kids(rail);
  for (const el of all.filter((e) => e.props?.p)) (el.type as (p: Json) => Json)(el.props).props.onClick();
  all.find((e) => e.props?.["data-control"] === "piso-nuevo")!.props.onClick();
  assert.deepEqual(seen, ["lumen", "faro", "+"]);
});

test("I47-2 #5: ↑ ↓ walk the tower's order, then the basement, and stop at the ends", () => {
  const floors = [{ slug: "a" }, { slug: "b" }];
  const basement = [{ slug: "z" }];
  assert.equal(tower.stepFloor(floors, basement, "a", 1), "b");
  assert.equal(tower.stepFloor(floors, basement, "b", 1), "z");
  assert.equal(tower.stepFloor(floors, basement, "z", 1), "z");
  assert.equal(tower.stepFloor(floors, basement, "a", -1), "a");
  assert.equal(tower.stepFloor(floors, basement, null, 1), "b");
  assert.equal(tower.stepFloor([], [], null, 1), null);
  assert.equal(tower.openFloor(floors, basement, "z").slug, "z");
  assert.equal(tower.openFloor(floors, basement, null).slug, "a");
  const page = readFileSync(new URL("../ui/src/pages/ceo.tsx", import.meta.url), "utf8");
  assert.ok(page.includes('e.key === "ArrowUp"') && page.includes("stepFloor(") && page.includes("typingIn(e.target)"), "the page owns the keys and skips typing");
  const b = readFileSync(new URL("../ui/src/components/compania/edificio/building.tsx", import.meta.url), "utf8");
  assert.equal(/\buse(State|Effect)\(/.test(b), false, "Building stays hook-free");
});

test("I47-2: the building is the window's height, the floor has no plate column and no Tú window", () => {
  const css = readFileSync(new URL("../ui/src/index.css", import.meta.url), "utf8");
  assert.match(css, /\.edi:has\(\.edi-bld\) \{[^}]*height: calc\(100svh - 89px/);
  assert.match(css, /\.edi-bld \{[^}]*flex: 1 1 0; min-height: 0;/);
  assert.match(css, /\.edi-stage > \.edi-nowb \{ flex: 1 1 0; min-height: 0; overflow: auto;/, "only Ahora grows, and it scrolls inside");
  assert.match(css, /\.edi-fcol \{ min-height: 0; min-width: 0; overflow: auto;/, "the right column scrolls inside");
  const out = render(two);
  assert.equal(/edi-plate|edi-you|data-owner/.test(out), false);
});
