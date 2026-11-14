// PLA-I42-2: the /brief page's header, summary, filters, Needs you, Up next and footer, rendered with the §17 sample
// brief (test/fixtures/brief-sample.json). Server-rendered with react-dom/server; no browser, no database.
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
const summary = await load("components/brief/brief-summary.tsx");
const items = await load("components/brief/brief-items.tsx");
const header = await load("components/brief/brief-header.tsx");
const footer = await load("components/brief/brief-footer.tsx");

const h = React.createElement;
const html = (el: React.ReactElement) => renderToStaticMarkup(h(QueryClientProvider, { client: new QueryClient() }, h(MemoryRouter, null, el)));
const text = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const sample = JSON.parse(readFileSync(new URL("./fixtures/brief-sample.json", import.meta.url), "utf8"));
const noop = () => {};

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
  const row = html(h(items.NeedsRow, { item: sample.items[0], index: 0, app: sample.apps[2], checked: true, readOnly: false, onCheck: noop, language: "en" }));
  assert.match(row, /opacity-45/);
  assert.match(row, /checked=""/);
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
  const out = html(h(summary.BriefSummary, { data: sample, checks: [], language: "en", view: "open", onView: noop, app: "filmia", onApp: noop }));
  assert.match(out, /data-brief-chip="filmia"[^>]*>|aria-pressed="true"[^>]*data-brief-chip="filmia"/);
  assert.match(out, /aria-pressed="true" class="[^"]*" data-brief-chip="filmia"/);
  assert.match(out, /data-brief-bar="workia"[^>]*/);
  assert.match(out, /opacity-25[^"]*" data-brief-bar="workia"/);
  assert.doesNotMatch(out, /opacity-25[^"]*" data-brief-bar="filmia"/);
  assert.match(text(out), /2 things need you/);
});

test("summary: big line, sub-line, toggle with aria-pressed, no hex", () => {
  const blocker = { id: "i|zigzag|bbbbbbbbbbbb", app: "zigzag", status: "blocker", title: "Prod is down" };
  const data = { ...sample, items: [...sample.items, blocker] };
  const out = html(h(summary.BriefSummary, { data, checks: ["i|filmia|952a4f17d8ec"], language: "en", view: "all", onView: noop, app: null, onApp: noop }));
  const s = text(out);
  assert.match(s, /5 things need you/);
  assert.match(s, /1 release blocker/);
  assert.match(s, /2 ready to pick up/);
  assert.match(s, /7 new ideas/);
  assert.match(s, /1 checked/);
  assert.match(out, /aria-pressed="true"[^>]*>All</);
  assert.match(out, /aria-pressed="false"[^>]*>Not checked</);
  assert.doesNotMatch(out, /#[0-9a-f]{3,8}\b(?![^<]*<\/)/i);
  const none = html(h(summary.BriefSummary, { data: { ...sample, items: [] }, checks: [], language: "en", view: "open", onView: noop, app: null, onApp: noop }));
  assert.match(text(none), /Nothing needs you/);
  assert.doesNotMatch(text(none), /release blocker/);
  const es = text(html(h(summary.BriefSummary, { data: sample, checks: [], language: "es", view: "open", onView: noop, app: null, onApp: noop })));
  assert.match(es, /5 cosas te necesitan/);
  assert.match(es, /Sin marcar/);
  assert.match(es, /Todas las apps/);
});

test("rows render as plain text only and only http(s) links", () => {
  const evil = { id: "i|cross|cccccccccccc", app: "cross", status: "needs_you", ref: "<b>X</b>", title: "<img src=x onerror=alert(1)>", detail: "**bold**", url: "javascript:alert(1)", action: "Open" };
  const out = html(h(items.NeedsRow, { item: evil, index: 0, app: sample.apps[4], checked: false, readOnly: false, onCheck: noop, language: "en" }));
  assert.doesNotMatch(out, /<img|<b>/);
  assert.match(out, /&lt;img src=x/);
  assert.doesNotMatch(out, /javascript:/);
  const ok = html(h(items.NeedsRow, { item: sample.items[0], index: 0, app: sample.apps[2], checked: false, readOnly: false, onCheck: noop, language: "en" }));
  assert.match(ok, /href="https:\/\/github.com\/Jorg3L3on\/filmia\/pull\/238"[^>]*rel="noopener noreferrer"/);
  assert.match(text(ok), /01 .*Filmia .*FIL-I50-6 · FIL-I51 · #238/);
  assert.equal(lib.safeUrl("https://a.b"), "https://a.b");
  assert.equal(lib.safeUrl("data:text/html,x"), null);
});

test("blocker row: danger index, Blocker pill, subtle danger background", () => {
  const blocker = { id: "i|zigzag|bbbbbbbbbbbb", app: "zigzag", status: "blocker", ref: "ZIG-4", title: "Prod is down" };
  const out = html(h(items.NeedsRow, { item: blocker, index: 0, app: sample.apps[1], checked: false, readOnly: false, onCheck: noop, language: "en" }));
  assert.match(out, /bg-destructive\/5/);
  assert.match(out, /text-destructive">01</);
  assert.match(text(out), /Blocker/);
});

test("check 4: a section header is a button with aria-expanded, and collapse state is stored per device", () => {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
  try {
    const open = html(h(items.BriefSection, { id: "needs", title: "Needs you", count: 3 }, h("p", null, "body")));
    assert.match(open, /aria-expanded="true"/);
    assert.doesNotMatch(open, /hidden=""/);
    lib.writeCollapsed({ needs: true });
    assert.equal(store.get(lib.COLLAPSED_KEY), '{"needs":true}');
    const closed = html(h(items.BriefSection, { id: "needs", title: "Needs you", count: 3 }, h("p", null, "body")));
    assert.match(closed, /aria-expanded="false"/);
    assert.match(closed, /hidden=""/);
    const other = html(h(items.BriefSection, { id: "next", title: "Up next", count: 1 }, h("p", null, "body")));
    assert.match(other, /aria-expanded="true"/);
    store.set(lib.COLLAPSED_KEY, "not json");
    assert.deepEqual(lib.readCollapsed(), {});
  } finally {
    delete (globalThis as any).localStorage;
  }
});

test("header: stamp, Generate now states, history select, 44 px targets", () => {
  const props = { language: "en", stamp: "Fri · Nov 13 · 07:04 CDMX", run: null, pending: false, canGenerate: true, onGenerate: noop, history: [], todayDate: "2026-11-13", date: null, onDate: noop };
  const out = html(h(header.BriefHeader, props));
  assert.match(text(out), /Fri · Nov 13 · 07:04 CDMX/);
  assert.match(text(out), /Morning brief/);
  assert.match(out, /min-h-11[^"]*" data-brief="generate"|data-brief="generate"/);
  assert.match(text(out), /Generate now/);
  const now = Date.parse("2026-11-13T13:07:00Z");
  assert.equal(header.generateLabel("en", { id: "r", status: "running", started_at: "2026-11-13T13:04:00Z", waiting_for_build: false }, false, now), "Generating… 3 min");
  assert.equal(header.generateLabel("en", { id: "r", status: "waiting", started_at: "2026-11-13T13:04:00Z", waiting_for_build: true }, false, now), "Waiting for the current build");
  assert.equal(header.generateLabel("es", null, true, now), "Generando…");
  const busy = html(h(header.BriefHeader, { ...props, run: { id: "r", status: "running", started_at: new Date().toISOString(), waiting_for_build: false } }));
  assert.match(busy, /disabled=""[^>]*data-brief="generate"/);
  assert.equal(labels.briefStamp("2026-11-13T07:04:12-06:00", "America/Mexico_City", "CDMX", "en"), "Fri · Nov 13 · 07:04 CDMX");
  assert.equal(labels.dayLabel("2026-11-12", "en"), "Thu · Nov 12");
  assert.match(labels.dayLabel("2026-11-12", "es"), /jue/);
});

test("check 5: footer and the missing-parts line", () => {
  const full = text(html(h(footer.BriefFooter, { data: sample, stamp: "Fri · Nov 13 · 07:04 CDMX", language: "en" })));
  assert.match(full, /Generated Fri · Nov 13 · 07:04 CDMX · Workia · ZigZag · Filmia · MiCasa · Cross-app/);
  assert.doesNotMatch(full, /Some parts are missing/);
  for (const mode of ["partial", "facts_only"]) {
    const out = text(html(h(footer.BriefFooter, { data: { ...sample, mode }, stamp: "x", language: "en" })));
    assert.match(out, /Some parts are missing\. See Needs you\./);
  }
  const t = labels.BRIEF_LABELS.en;
  assert.equal(t.empty("07:00"), "No brief yet. It runs at 07:00, or press Generate now.");
  assert.equal(t.off, "Morning brief is off. Turn it on in settings.");
  assert.equal(t.refreshFailed, "Couldn't refresh");
});

test("labels: en and es tables have the same keys", () => {
  assert.deepEqual(Object.keys(labels.BRIEF_LABELS.en).sort(), Object.keys(labels.BRIEF_LABELS.es).sort());
});

test("runMinutes is at least 1", () => {
  assert.equal(lib.runMinutes(new Date(1000).toISOString(), 1000), 1);
  assert.equal(lib.runMinutes(new Date(0).toISOString(), 10 * 60_000), 10);
});
