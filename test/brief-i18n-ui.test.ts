// PLA-I42-4: the /brief page's en/es label tables (D5), the settings sheet's form helpers, and a grep that no brief
// component hard-codes a label. Server-rendered with react-dom/server against the §17 sample; no browser, no database.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

(globalThis as { React?: unknown }).React = React;
const load = async (p: string) => (await import(new URL(`../ui/src/${p}`, import.meta.url).href)) as Record<string, any>;
const lib = await load("lib/brief.ts");
const i18n = await load("lib/brief-i18n.ts");
const settings = await load("components/brief/brief-settings.tsx");

const h = React.createElement;
const html = (el: React.ReactElement) => renderToStaticMarkup(h(QueryClientProvider, { client: new QueryClient() }, h(MemoryRouter, null, el)));
const text = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");
const sample = JSON.parse(readFileSync(new URL("./fixtures/brief-sample.json", import.meta.url), "utf8"));
const noop = () => {};
const DIR = new URL("../ui/src/components/brief/", import.meta.url);

/** Every string a table gives, functions called with a sample argument, nested tables flattened. */
function strings(t: unknown): string[] {
  if (typeof t === "string") return [t];
  if (typeof t === "function") {
    // PLA-I51: the city's tower and voice take counts; voice answers parts.
    const out = (t as (...a: unknown[]) => unknown)(2, { blocked: 1, needs: 2, next: 1, ideas: 3 });
    return Array.isArray(out) ? out.map((p) => (typeof p === "string" ? p : (p as { text: string }).text)) : [String(out)];
  }
  if (t && typeof t === "object") return Object.values(t).flatMap(strings);
  return [];
}
function shape(t: unknown): unknown {
  if (t && typeof t === "object") return Object.fromEntries(Object.entries(t).map(([k, v]) => [k, shape(v)]).sort());
  return typeof t;
}

test("the en and es tables have the same keys at every level, settings sheet included", () => {
  assert.deepEqual(shape(i18n.BRIEF_LABELS.es), shape(i18n.BRIEF_LABELS.en));
  assert.ok(Object.keys(i18n.BRIEF_LABELS.en.s).length > 40);
});

test("check 1: the Spanish stamp, day label and plurals (the brief in Compañía reads them)", () => {
  const stamp = i18n.briefStamp("2026-11-13T07:04:12-06:00", "America/Mexico_City", "CDMX", "es");
  assert.equal(stamp, "vie · 13 nov · 07:04 CDMX");
  assert.match(i18n.dayLabel("2026-11-12", "es"), /^jue · 12 nov$/);
  assert.equal(i18n.BRIEF_LABELS.es.ideas(1), "1 idea nueva");
  assert.equal(i18n.BRIEF_LABELS.es.ideas(9), "9 ideas nuevas");
  assert.equal(i18n.BRIEF_LABELS.es.checked(3), "3 marcadas");
  assert.equal(i18n.briefStamp("2026-11-13T07:04:12-06:00", "America/Mexico_City", "CDMX", "en"), "Fri · Nov 13 · 07:04 CDMX");
});

test("check 3: no hard-coded labels in ui/src/components/brief/* (grep), and labels.ts is gone", () => {
  assert.equal(existsSync(new URL("labels.ts", DIR)), false);
  const files = readdirSync(DIR).filter((f) => /\.tsx?$/.test(f));
  // PLA-I63-5: only the settings sheet is left here (the brief draws itself in components/corriente/brief*.tsx).
  assert.ok(files.length >= 1);
  const found: string[] = [];
  for (const f of files) {
    const src = readFileSync(new URL(f, DIR), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((l) => !/^\s*\/\//.test(l))
      .join("\n");
    // JSX text with a word in it: >Some words<
    // (code such as `>= 1 && max <` or generics `=> void; t: X; bad: Set<` is not text: no = & ; : ( in it)
    for (const m of src.matchAll(/>\s*([^<>{}\n=&;:()]*[A-Za-zÁÉÍÓÚáéíóúñ]{2,}[^<>{}\n=&;:()]*)\s*</g)) found.push(`${f}: >${m[1]}<`);
    // String-valued label attributes.
    for (const m of src.matchAll(/\b(aria-label|title|placeholder|alt)="([^"]+)"/g)) found.push(`${f}: ${m[1]}="${m[2]}"`);
    // Label-looking string literals passed as children or labels: "Two words" with a capital.
    for (const m of src.matchAll(/(?<![\w.-])"([A-Z][a-z]+(?: [a-z]+)+)"/g)) found.push(`${f}: "${m[1]}"`);
  }
  assert.deepEqual(found, []);
});

test("settings form: draftOf → patchOf keeps automatic letters automatic and sends what changed", () => {
  const reply = {
    settings: { ...lib, enabled: true, run_at: "07:00", timezone: null, timezone_label: null, language: "en", owner_name: null, hidden_refs: ["PLA-I16"], max_items_per_app: 5, ideas_per_project: 3, ideas_enabled: true, fallback_at: "11:00", model: null, pass_timeouts: { brief: 10, ideas: 20, plan: 30 }, projects: { zigzag: { letter: "Z" } }, github_mode: "poller" },
    resolved: { timezone: "America/Mexico_City", timezone_label: "CDMX", owner_name: "the owner" },
    personas: [],
    projects: [
      { slug: "workia", name: "Workia", key_prefix: "WRK", letter: "W", order: 0, include: true, include_ideas: true },
      { slug: "zigzag", name: "ZigZag", key_prefix: "ZIG", letter: "Z", order: 1, include: true, include_ideas: true },
    ],
  };
  const d = settings.draftOf(reply);
  assert.equal(d.timezone, "");
  assert.equal(d.max_items_per_app, "5");
  assert.deepEqual(settings.draftProblems(d), []);
  const p = settings.patchOf({ ...d, timezone: " ", owner_name: "Jorge", language: "es", projects: [{ ...d.projects[0], include_ideas: false }, d.projects[1]] }, reply);
  assert.equal(p.timezone, null);
  assert.equal(p.owner_name, "Jorge");
  assert.equal(p.language, "es");
  assert.equal(p.max_items_per_app, 5);
  assert.deepEqual(p.projects.workia, { include: true, include_ideas: false });
  assert.deepEqual(p.projects.zigzag, { include: true, include_ideas: true, letter: "Z" }, "a letter set by hand stays set");
  const moved = settings.patchOf({ ...d, projects: [{ ...d.projects[0], letter: "K", order: "3" }, d.projects[1]] }, reply);
  assert.deepEqual(moved.projects.workia, { include: true, include_ideas: true, letter: "K", order: 3 });
  assert.deepEqual(settings.draftProblems({ ...d, run_at: "25:00", ideas_per_project: "0", projects: [{ ...d.projects[0], letter: "X" }, { ...d.projects[1], order: "-1" }] }), [
    "run_at",
    "ideas_per_project",
    "letter:workia",
    "order:zigzag",
  ]);
});

test("settings form: hidden refs chips split on commas and spaces without repeats", () => {
  assert.deepEqual(settings.addRefs(["PLA-I16"], "FIL-I50, PLA-I16  WRK-13"), ["PLA-I16", "FIL-I50", "WRK-13"]);
  assert.deepEqual(settings.addRefs([], "  "), []);
});
