// PLA-I42-2: the brief's pure model (sections, filters, counts) and Brief de hoy, with the §17 sample brief
// (test/fixtures/brief-sample.json). PLA-I63-5: the V1 page components are gone (the brief lives in Compañía; its
// drawing is tested in test/i63-brief-ui.test.ts); the model they used stays and is tested here.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

(globalThis as { React?: unknown }).React = React;
const load = async (p: string) => (await import(new URL(`../ui/src/${p}`, import.meta.url).href)) as Record<string, any>;
const lib = await load("lib/brief.ts");
const labels = await load("lib/brief-i18n.ts");
const ceo = await load("components/dashboard/ceo-v2.tsx");
const parts = await load("components/compania/parts.tsx");

const h = React.createElement;
const html = (el: React.ReactElement) => renderToStaticMarkup(h(QueryClientProvider, { client: new QueryClient() }, h(MemoryRouter, null, el)));
const text = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const sample = JSON.parse(readFileSync(new URL("./fixtures/brief-sample.json", import.meta.url), "utf8"));

test("sections: Needs you = blockers + needs_you (blockers first), Up next = next + open_pr", () => {
  const data = { ...sample, items: [...sample.items, { id: "i|zigzag|aaaaaaaaaaaa", app: "zigzag", status: "blocker", title: "Prod is down" }] };
  const needs = lib.sectionItems(data.items, lib.NEEDS, { app: null, view: "open", checks: [] });
  assert.equal(needs[0].status, "blocker");
  assert.deepEqual(new Set(needs.map((i: any) => i.status)), new Set(["blocker", "needs_you"]));
  const next = lib.sectionItems(data.items, lib.UP_NEXT, { app: null, view: "open", checks: [] });
  assert.deepEqual(next.map((i: any) => i.status), ["next", "open_pr"]);
});

test("check 2: checked items are hidden in Not checked and kept in All", () => {
  const id = "i|filmia|952a4f17d8ec";
  const open = lib.sectionItems(sample.items, lib.NEEDS, { app: null, view: "open", checks: [id] });
  const all = lib.sectionItems(sample.items, lib.NEEDS, { app: null, view: "all", checks: [id] });
  assert.equal(open.some((i: any) => i.id === id), false);
  assert.equal(all.some((i: any) => i.id === id), true);
});

test("check 3: the app filter narrows every section and the counts", () => {
  for (const statuses of [lib.NEEDS, lib.UP_NEXT]) {
    const rows = lib.sectionItems(sample.items, statuses, { app: "filmia", view: "all", checks: [] });
    assert.ok(rows.every((i: any) => i.app === "filmia"));
  }
  const all = lib.briefCounts(sample, []);
  const filmia = lib.briefCounts(sample, [], "filmia");
  assert.deepEqual(all, { needs: 5, blockers: 0, next: 2, ideas: 7, checked: 0 });
  assert.deepEqual(filmia, { needs: 2, blockers: 0, next: 1, ideas: 2, checked: 0 });
});

test("labels: en and es tables have the same keys", () => {
  assert.deepEqual(Object.keys(labels.BRIEF_LABELS.en).sort(), Object.keys(labels.BRIEF_LABELS.es).sort());
});

test("runMinutes is at least 1", () => {
  assert.equal(lib.runMinutes(new Date(1000).toISOString(), 1000), 1);
  assert.equal(lib.runMinutes(new Date(0).toISOString(), 10 * 60_000), 10);
});

test("PLA-I42-5: Brief de hoy shows its lines and a link to the brief (PLA-I63-5: /ceo?v=brief)", () => {
  const lines = ["Zigzag: Prod is down", "Workia: Need 1", "Workia: Need 2", "Workia: Need 3", "Workia: Need 4"];
  const out = html(h(ceo.Brief, { lines, title: "Brief de hoy", sign: "Asistente", link: { to: "/ceo?v=brief", label: parts.BRIEF_LINK_LABEL } }));
  assert.equal((out.match(/<li /g) ?? []).length, 5);
  assert.match(out, /<a [^>]*data-brief-link[^>]*href="\/ceo\?v=brief"[^>]*>Ver el brief completo →<\/a>/);
  assert.match(text(out), /Brief de hoy .*Asistente/);
  assert.doesNotMatch(html(h(ceo.Brief, { lines })), /data-brief-link/, "older callers get no link");
  const tz = "America/Mexico_City";
  const now = Date.parse("2026-11-13T20:00:00Z");
  assert.equal(parts.briefTitle("2026-11-13T13:04:12Z", now, tz), "Brief de hoy");
  assert.equal(parts.briefTitle("2026-11-12T13:04:12Z", now, tz), "Último brief");
});
