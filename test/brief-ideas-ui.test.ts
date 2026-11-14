// PLA-I42-3: Today's ideas and the send bar, rendered with the §17 sample brief (test/fixtures/brief-sample.json).
// Server-rendered with react-dom/server; no browser, no database.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

(globalThis as { React?: unknown }).React = React;
const load = async (p: string) => (await import(new URL(`../ui/src/${p}`, import.meta.url).href)) as Record<string, any>;
const lib = await load("lib/brief.ts");
const labels = await load("lib/brief-i18n.ts");
const ideas = await load("components/brief/brief-ideas.tsx");
const bar = await load("components/brief/brief-send-bar.tsx");

const h = React.createElement;
const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const text = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const sample = JSON.parse(readFileSync(new URL("./fixtures/brief-sample.json", import.meta.url), "utf8"));
const noop = () => {};
const all = { app: null, view: "open", checks: [] as string[] };

test("ideas group per app in the brief's app order, filtered by app, checked hidden in Not checked", () => {
  const groups = lib.ideaGroups(sample, all);
  assert.deepEqual(groups.map((g: any) => g.app.id), ["workia", "zigzag", "filmia", "micasa", "cross"]);
  assert.deepEqual(groups[1].ideas.map((i: any) => i.code), ["Z1", "Z2"]);
  assert.deepEqual(lib.ideaGroups(sample, { ...all, app: "filmia" }).map((g: any) => g.app.id), ["filmia"]);
  const z1 = "d|zigzag|11d5e0e86475";
  assert.deepEqual(lib.ideaGroups(sample, { ...all, checks: [z1] })[1].ideas.map((i: any) => i.code), ["Z2"]);
  assert.deepEqual(lib.ideaGroups(sample, { ...all, view: "all", checks: [z1] })[1].ideas.map((i: any) => i.code), ["Z1", "Z2"]);
  // An idea on an app the brief doesn't list lands in Cross-app.
  const stray = { ...sample, ideas: [...sample.ideas, { id: "d|nope|aaaaaaaaaaaa", code: "X2", app: "nope", title: "Stray", why: "w", source: "Plania" }] };
  assert.deepEqual(lib.ideaGroups(stray, all).at(-1).ideas.map((i: any) => i.code), ["X1", "X2"]);
});

test("check 1: the reply text follows the brief's order and prefix", () => {
  const ids = new Set(["d|zigzag|00e15e4bc3f7", "d|workia|f3ceac25381f", "d|cross|6211b038eea4"]);
  assert.equal(lib.replyText(sample, ids), "yes W1 Z2 X1");
  assert.equal(lib.replyText({ ...sample, reply: { prefix: "sí", destination: "Plania" } }, new Set(["d|filmia|0b4dbcd96ba2"])), "sí F1");
  const out = html(h(bar.BriefSendBar, { count: 3, reply: "yes W1 Z2 X1", onClear: noop, language: "en" }));
  assert.match(text(out), /3 ideas → Plania/);
  assert.match(out, /data-brief="reply"[^>]*>yes W1 Z2 X1</);
  assert.match(out, /font-mono/);
  assert.match(text(out), /Clear/);
  assert.match(text(out), /Copy reply/);
  assert.match(out, /max-w-\[640px\]/);
  assert.equal(html(h(bar.BriefSendBar, { count: 0, reply: "yes", onClear: noop, language: "en" })), "");
  assert.match(text(html(h(bar.BriefSendBar, { count: 1, reply: "yes W1", onClear: noop, language: "es" }))), /1 idea → Plania .*Limpiar .*Copiar respuesta/);
});

test("check 1: Copy reply writes the reply to the clipboard", async () => {
  let wrote: string | null = null;
  const nav = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { clipboard: { writeText: async (s: string) => void (wrote = s) } } });
  try {
    assert.equal(await bar.copyText("yes W1 Z3"), true);
    assert.equal(wrote, "yes W1 Z3");
  } finally {
    if (nav) Object.defineProperty(globalThis, "navigator", nav);
  }
});

test("check 2: flags render as muted captions in the brief's language", () => {
  const en = labels.BRIEF_LABELS.en;
  const es = labels.BRIEF_LABELS.es;
  const flags = ["cost", "outside_service", "legal", "repo_change", "overlap:FIL-IDEA12", "big", "nonsense"];
  assert.deepEqual(ideas.flagCaptions(flags, en), ["costs money", "new outside service", "legal review", "repo change", "overlaps FIL-IDEA12", "big"]);
  assert.deepEqual(ideas.flagCaptions(flags, es), ["cuesta dinero", "servicio externo nuevo", "revisión legal", "cambio de repo", "se cruza con FIL-IDEA12", "grande"]);
  const idea = { ...sample.ideas[1], flags };
  const card = html(h(ideas.IdeaCard, { idea, app: sample.apps[1], checked: false, selected: false, readOnly: false, onCheck: noop, onSelect: noop, language: "en" }));
  assert.match(card, /class="[^"]*text-muted-foreground" data-brief="flags"/);
  assert.match(text(card), /costs money · new outside service · legal review · repo change · overlaps FIL-IDEA12 · big/);
  assert.doesNotMatch(card, /nonsense/);
});

test("idea card: code badge, from {source} only when it isn't the app, select circle with aria-pressed, hide check", () => {
  const x1 = sample.ideas.find((i: any) => i.code === "X1");
  const cross = sample.apps.find((a: any) => a.id === "cross");
  const card = html(h(ideas.IdeaCard, { idea: x1, app: cross, checked: false, selected: true, readOnly: false, onCheck: noop, onSelect: noop, language: "en" }));
  assert.match(card, /data-brief="code"[^>]*>X1</);
  assert.match(text(card), /from Plania/);
  assert.match(card, /aria-pressed="true"/);
  assert.match(card, /data-selected="true"/);
  assert.match(card, /aria-label="Hide: Local fallback lane for builds"/);
  const w1 = html(h(ideas.IdeaCard, { idea: sample.ideas[0], app: sample.apps[0], checked: true, selected: false, readOnly: false, onCheck: noop, onSelect: noop, language: "en" }));
  assert.doesNotMatch(text(w1), /from Workia/);
  assert.match(w1, /aria-pressed="false"/);
  assert.match(w1, /opacity-45/);
  assert.doesNotMatch(card + w1, /#[0-9a-f]{3,8}\b/i);
});

test("ideas section: heading, hint, collapsible groups with aria-expanded, minmax(240px, 1fr) grid", () => {
  const out = html(h(ideas.BriefIdeas, { groups: lib.ideaGroups(sample, all), checks: [], selected: new Set(), readOnly: false, onCheck: noop, onSelect: noop, language: "en" }));
  assert.match(text(out).replace(/&#x27;/g, "'"), /Today's ideas Select ideas to send to Plania, or reply with their codes\./);
  assert.equal((out.match(/aria-expanded="true"/g) ?? []).length, 5);
  assert.match(out, /minmax\(240px,1fr\)/);
  assert.match(out, /bg-brief-c1/);
  assert.match(out, /bg-brief-other/);
  const es = html(h(ideas.BriefIdeas, { groups: [], checks: [], selected: new Set(), readOnly: false, onCheck: noop, onSelect: noop, language: "es" }));
  assert.match(text(es), /Ideas de hoy .*Aquí no hay ideas\./);
});

test("check 3 (PLA-I43-4): Send to Plania shows by default and hides on a read-only day", () => {
  assert.equal(lib.BRIEF_SEND_ENABLED, undefined, "the PLA-I42-3 flag is gone");
  const on = html(h(bar.BriefSendBar, { count: 2, reply: "yes W1 Z1", onClear: noop, language: "en" }));
  assert.match(on, /data-brief="send"/);
  assert.match(on, /Send to Plania/);
  const off = html(h(bar.BriefSendBar, { count: 2, reply: "yes W1 Z1", onClear: noop, language: "en", canSend: false }));
  assert.doesNotMatch(off, /data-brief="send"/);
});
