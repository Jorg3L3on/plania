// PLA-41: the tower rail shows each project's logo, as Inicio and the brief do; a project without one keeps its
// initial. Server-rendered with fake data; no browser, no database.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

(globalThis as { React?: unknown }).React = React;
const load = async (p: string) => (await import(new URL(`../ui/src/${p}`, import.meta.url).href)) as Record<string, any>;
const tower = await load("components/compania/edificio/tower.tsx");

const project = (slug: string, title: string) => ({ slug, title, team: [], plan: null, route: null });

test("PLA-41: a tile with a logo draws the logo; one without keeps its initial", () => {
  const s = renderToStaticMarkup(
    React.createElement(tower.Tower, { floors: [project("mianovia", "Mianovia")], basement: [project("workia", "Workia"), project("zigzag", "Zigzag")], decisions: [], projects: [], open: "mianovia", onNew: () => {} }),
  );
  const tile = (slug: string) => new RegExp(`data-tile="${slug}"[^>]*>([\\s\\S]*?)</button>`).exec(s)![1]!;
  assert.match(tile("workia"), /<svg[^>]*class="[^"]*edi-tile-mark/);
  assert.match(tile("zigzag"), /edi-tile-mark/);
  assert.doesNotMatch(tile("workia"), /<b aria-hidden="true">W</);
  assert.match(tile("mianovia"), /<b aria-hidden="true">M</);
  assert.doesNotMatch(tile("mianovia"), /edi-tile-mark/);
});
