// PLA-I46-14: Entrega's leg looks, the pink light, the celebration and the 390 labels. Server-rendered with
// react-dom/server; no browser, no database. Fake names and numbers.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

(globalThis as { React?: unknown }).React = React;
const route = (await import(new URL("../ui/src/components/compania/edificio/route.tsx", import.meta.url).href)) as Record<string, any>;
const css = readFileSync(new URL("../ui/src/index.css", import.meta.url), "utf8");

type Json = Record<string, any>;
const h = React.createElement;
const NOW = new Date("2026-11-13T20:44:00Z").getTime();
const leg = (n: number, title: string, done: number, total: number, state: string, patch: Json = {}): Json => ({ key: `WRK-I${n}`, title, done, total, state, note: null, postponed: false, ...patch });
// Mianovia tonight: I1 has its hosting put off, I2 and I3 are complete, I4 is the one we stand on, I5 has no plan.
const legs = (i4done: number): Json[] => [
  leg(1, "Arranque", 4, 5, "planned", { note: "Pospuesto: Hosting y dominio", postponed: true }),
  leg(2, "Formulario", 4, 4, "done"),
  leg(3, "Panel", 5, 5, "done"),
  leg(4, "Contacto", i4done, 4, "here", { steps: [] }),
  leg(5, "Ajustes finales", 0, 0, "unplanned"),
];
const project = (l: Json[]): Json => ({ slug: "workia", title: "Workia", paused: false, team: [], route: { legs: l, more_legs: 0 } });
const render = (l: Json[], play: Json | null = null) => renderToStaticMarkup(h(route.Route, { project: project(l), now: NOW, play }));
const looks = (s: string) => [...s.matchAll(/<li class="edi-leg"[^>]*data-look="([a-z]+)"/g)].map((m) => m[1]);
const lit = (s: string) => [...s.matchAll(/<li class="edi-leg"([^>]*)>/g)].map((m) => m[1]!.includes("data-lit")).indexOf(true);
const text = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

test("I46-14 #1: complete, in course, postponed (striped) and not planned; the light is on the leg in course", () => {
  const s = render(legs(3));
  assert.deepEqual(looks(s), ["off", "done", "done", "now", "unplanned"]);
  assert.equal(lit(s), 3);
  assert.match(s, /data-leg="here" aria-current="step"/);
  const t = text(s);
  for (const w of ["4 de 5 · pospuesto: Hosting y dominio", "3 de 4 · aquí", "sin planear"]) assert.ok(t.includes(w), w);
  // The short labels for 390, and one detail line for the lit leg.
  const shorts = [...s.matchAll(/<small class="edi-legcode">(I\d)<span class="edi-legshort"> ([^<]+)<\/span>/g)].map((m) => `${m[1]} ${m[2]}`);
  assert.deepEqual(shorts, ["I1 4/5", "I2 ✓", "I3 ✓", "I4 3/4", "I5 —"]);
  assert.match(s, /<p class="edi-legdetail" data-detail-of="I4">I4 · Contacto · 3 de 4 · aquí<\/p>/);
  assert.equal(/edi-spark/.test(s), false, "nothing plays on a load");
});

test("I46-14 #1: once the leg in course is complete the light sits on the next one, «sigue», dotted when it has no plan", () => {
  const s = render(legs(4));
  assert.deepEqual(looks(s), ["off", "done", "done", "done", "next"]);
  assert.equal(lit(s), 4);
  assert.match(s, /data-look="next" data-lit="" data-plan="none"/);
  assert.ok(text(s).includes("sigue · sin planear"));
  assert.ok(s.includes('<span class="edi-legshort"> sigue</span>') && s.includes('<span class="edi-legshort"> ✓</span>'));
  assert.match(s, /data-detail-of="I5">I5 · Ajustes finales · sigue · sin planear</);
  // A next leg that already has steps is not dotted. With no leg we stand on, the first open one is next.
  const planned = render([leg(1, "A", 2, 2, "done"), leg(2, "B", 0, 3, "planned")]);
  assert.deepEqual(looks(planned), ["done", "next"]);
  assert.equal(/data-plan="none"/.test(planned), false);
  // A postponed leg is never where the light goes.
  assert.deepEqual(looks(render([leg(1, "A", 2, 2, "here"), leg(2, "B", 1, 3, "planned", { postponed: true }), leg(3, "C", 0, 0, "unplanned")])), ["done", "off", "next"]);
});

test("I46-14 #1: the light is pink, never orange, and the legs stay in one row at 390 with short labels", () => {
  assert.match(css, /\.edi-route \{ --e-light: #ff7ab6;/);
  const block = css.slice(css.indexOf("/* PLA-I46-14: one row of legs"), css.indexOf(".edi-steps { list-style"));
  assert.equal(/#ff9f43|--e-you|orange/i.test(block.replace(/\/\*[\s\S]*?\*\//g, "")), false, "no orange in Entrega");
  assert.match(block, /\.edi-leg\[data-look="off"\] \.edi-legbar \{ background: repeating-linear-gradient/);
  assert.match(block, /\.edi-leg\[data-look="next"\]\[data-plan="none"\] \.edi-legbar \{ background: none; border: 1\.5px dotted var\(--e-light\); \}/);
  assert.ok(block.includes("grid-template-columns: repeat(var(--n, 5), minmax(0, 1fr))"));
  const narrow = block.slice(block.indexOf("@media (width < 40rem)"));
  for (const rule of [".edi-legname, .edi-legline { display: none; }", ".edi-legshort { display: inline; }", ".edi-legdetail { display: block; }"]) assert.ok(narrow.includes(rule), rule);
  assert.ok(block.includes(".edi-route { --e-light: #ff7ab6; overflow-x: clip; }"), "sparks never make the page scroll sideways");
});

test("I46-14 #2: accepting a leg's last step plays fill, glow and pass, once, and a load plays nothing", () => {
  route.forgetRoutes();
  assert.equal(route.noteRoute("workia", legs(3)), null, "the first sight is a load");
  assert.equal(route.noteRoute("workia", legs(3)), null, "nothing changed");
  assert.deepEqual(route.noteRoute("workia", legs(4)), { key: "WRK-I4", from: 75 }, "the last step was accepted");
  assert.equal(route.noteRoute("workia", legs(4)), null, "it plays once");
  assert.equal(route.noteRoute("otro", legs(4)), null, "another floor's first sight is a load too");
  assert.deepEqual(route.PLAY_MS, { fill: 300, glow: 900, pass: 400 });

  const fill = render(legs(4), { key: "WRK-I4", from: 75, phase: "fill" });
  assert.match(fill, /data-look="done" data-lit="" data-play="fill"/, "the light stays on the leg while it fills");
  assert.ok(fill.includes("--from:75%") && fill.includes("width:100%"));
  assert.equal(/data-look="next"/.test(fill), false, "the light has not passed yet");
  const glow = render(legs(4), { key: "WRK-I4", from: 75, phase: "glow" });
  assert.match(glow, /data-play="glow"/);
  assert.equal((glow.match(/class="edi-spark"/g) ?? []).length, 10);
  const pass = render(legs(4), { key: "WRK-I4", from: 75, phase: "pass" });
  assert.equal(lit(pass), 4);
  assert.match(pass, /data-look="next" data-lit="" data-plan="none" data-arrive=""/);
  assert.equal(/edi-spark|data-play/.test(pass), false);
  // Each phase is drawn by a CSS animation of its length.
  assert.match(css, /\[data-play="fill"\] \.edi-legbar i \{ animation: edi-legfill 300ms/);
  assert.match(css, /\[data-play="glow"\] \.edi-legbar \{ animation: edi-legglow 900ms/);
  assert.match(css, /\.edi-spark \{[^}]*animation: edi-spark 900ms/);
  assert.match(css, /\[data-arrive\] \.edi-legbar \{ animation: edi-legarrive 400ms/);
});

test("I46-14 #3: with reduce-motion the end state shows with no animation", () => {
  // The component never starts the play when the media query matches; the end state is the plain render.
  const src = readFileSync(new URL("../ui/src/components/compania/edificio/route.tsx", import.meta.url), "utf8");
  assert.match(src, /matchMedia\("\(prefers-reduced-motion: reduce\)"\)/);
  assert.match(src, /if \(hit && !reducedMotion\(\)\) setPlay/);
  const end = render(legs(4));
  assert.equal(/data-play|data-arrive|edi-spark/.test(end), false);
  assert.equal(lit(end), 4);
  // And the stylesheet stills any animation that would start anyway: its own rule, and the building's for all of .edi.
  assert.match(css, /\.edi \*, \.edi \*::before, \.edi \*::after \{ animation: none !important;/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.edi-leg \.edi-legbar, \.edi-leg \.edi-legbar i \{ animation: none !important; \}\s*\.edi-spark \{ display: none; \}/);
});
