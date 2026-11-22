// Inicio sits open all day, so its motion only marks a change while the owner watches: a window that changes state,
// a count that moves, a decision that arrives, a headline that changes, a tile's signal. Nothing plays on load and
// nothing loops. Read from the sources; no browser, no database.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (p: string) => readFileSync(new URL(`../ui/src/${p}`, import.meta.url), "utf8");

test("a city window eases into its new colour, never a motion, so it stays with reduced motion", () => {
  const css = read("index.css");
  assert.match(css, /\.city-win \{[^}]*transition: background-color 300ms ease, box-shadow 300ms ease, border-color 300ms ease;/);
});

test("the Bandeja badge: the count rolls, the badge comes and goes once, and its count is still in the markup", () => {
  const nav = read("components/main-nav.tsx");
  const badge = nav.slice(nav.indexOf("const Badge"), nav.indexOf("export const Logo"));
  assert.match(badge, /<AnimatePresence initial=\{false\}>/);
  assert.match(badge, /<Cifra value=\{n\} \/>/);
  assert.doesNotMatch(badge, /repeat|animate-ping|infinite/, "no loop on a page open all day");
});

test("Hoy: an arriving decision folds in, keyed by the decision and never by its position", () => {
  const hoy = read("components/home/hoy.tsx");
  const lista = hoy.slice(hoy.indexOf("waiting.slice(0, 6).map"), hoy.indexOf("</AnimatePresence>", hoy.indexOf("waiting.slice(0, 6).map")));
  assert.match(lista, /key=\{`\$\{i\.project\}-\$\{i\.kind\}-\$\{i\.key \?\? i\.title\}`\}/);
  assert.doesNotMatch(lista, /\$\{n\}/);
  assert.match(hoy, /<AnimatePresence initial=\{false\}>\s*\{waiting\.slice/);
});

test("the headline and a tile's signals crossfade or fold when they change, and not on first paint", () => {
  const parts = read("components/home/parts.tsx");
  const cambia = parts.slice(parts.indexOf("function Cambia"), parts.indexOf("export function Titular"));
  assert.match(cambia, /<AnimatePresence initial=\{false\} mode="popLayout">/);
  assert.match(parts, /<Cambia clave=\{headline\.title\}>/);
  // Signals are keyed by their kind, so «2 decisiones» → «3 decisiones» is the same line changing its words.
  assert.match(parts, /<motion\.span key=\{s\.kind\}/);
  assert.match(parts, /className="grid text-sm leading-snug empty:hidden"/);
});
