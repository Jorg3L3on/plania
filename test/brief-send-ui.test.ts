// PLA-I43-4: Send to Plania on /brief (spec §8 item 6, D7): the cost line before sending, the progress per idea with
// links to the keys until every target is done, and the paused caption on the bar and the idea card. Rendered with
// react-dom/server from the §17 sample brief; no browser, no database.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";

(globalThis as { React?: unknown }).React = React;
const load = async (p: string) => (await import(new URL(`../ui/src/${p}`, import.meta.url).href)) as Record<string, any>;
const lib = await load("lib/brief.ts");
const ideas = await load("components/brief/brief-ideas.tsx");
const bar = await load("components/brief/brief-send-bar.tsx");

const h = React.createElement;
const html = (el: React.ReactElement) => renderToStaticMarkup(h(MemoryRouter, null, el));
const text = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const sample = JSON.parse(readFileSync(new URL("./fixtures/brief-sample.json", import.meta.url), "utf8"));
const noop = () => {};
const ID = { W1: "d|workia|f3ceac25381f", Z1: "d|zigzag|11d5e0e86475", Z2: "d|zigzag|00e15e4bc3f7", F1: "d|filmia|0b4dbcd96ba2", X1: "d|cross|6211b038eea4" };

const row = (code: string, slug: string, project: string, state: string, extra: Record<string, unknown> = {}) => ({ code, slug, project, title: code, state, note: null, result: null, ...extra });
const progress = (status: string, list: unknown[]) => ({ id: "11111111-2222-4333-8444-555555555555", brief_id: "b", status, codes: list.map((r: any) => r.code), ideas: list });

test("check 1: the cost counts one bot per target project (X ideas go to the home project) and runs of at most 3", () => {
  assert.deepEqual(lib.planCost(sample, new Set([ID.W1, ID.Z1, ID.X1]), "plania"), { bots: 3, runs: 3, low: 30, high: 75 });
  assert.deepEqual(lib.planCost(sample, new Set([ID.W1, ID.X1]), "workia"), { bots: 1, runs: 1, low: 10, high: 25 }, "W1 + X1 in workia is one run");
  assert.deepEqual(lib.planCost(sample, new Set([ID.Z1, ID.Z2]), "plania"), { bots: 1, runs: 1, low: 10, high: 25 });
  const many = { ...sample, ideas: [1, 2, 3, 4].map((n) => ({ ...sample.ideas[0], id: `d|workia|${String(n).repeat(12)}`, code: `W${n}` })) };
  assert.deepEqual(lib.planCost(many, new Set(many.ideas.map((i: any) => i.id)), "plania"), { bots: 1, runs: 2, low: 20, high: 50 });
  assert.deepEqual(lib.selectedCodes(sample, new Set([ID.X1, ID.W1])), ["W1", "X1"]);
});

test("check 1: the cost line shows before sending, in English and Spanish", () => {
  const en = html(h(bar.BriefSendBar, { count: 3, reply: "yes W1 Z1 X1", onClear: noop, language: "en", cost: { bots: 3, low: 30, high: 75 } }));
  assert.match(en, /data-brief="cost"/);
  assert.match(text(en), /This wakes 3 project bots, one after another, about 30–75 min/);
  assert.match(en, /data-brief="send"/);
  assert.match(text(html(h(bar.BriefSendBar, { count: 1, reply: "yes W1", onClear: noop, language: "en", cost: { bots: 1, low: 10, high: 25 } }))), /This wakes 1 project bot about 10–25 min/);
  const es = html(h(bar.BriefSendBar, { count: 3, reply: "sí W1 Z1 X1", onClear: noop, language: "es", cost: { bots: 3, low: 30, high: 75 } }));
  assert.match(text(es), /Esto despierta a 3 bots de proyecto, uno tras otro, unos 30–75 min/);
  assert.match(text(es), /Mandar a Plania/);
  // While sending, the button says so and is disabled; a failure says so.
  const busy = html(h(bar.BriefSendBar, { count: 1, reply: "yes W1", onClear: noop, language: "en", cost: { bots: 1, low: 10, high: 25 }, sending: true, sendError: false }));
  assert.match(busy, /disabled=""[^>]*data-brief="send"|data-brief="send"[^>]*disabled=""/);
  assert.match(text(busy), /Sending…/);
  assert.match(html(h(bar.BriefSendBar, { count: 1, reply: "yes W1", onClear: noop, language: "en", sendError: true })), /data-brief="send-failed"/);
  // No cost line on a read-only day (no Send).
  assert.doesNotMatch(html(h(bar.BriefSendBar, { count: 1, reply: "yes W1", onClear: noop, language: "en", canSend: false, cost: { bots: 1, low: 10, high: 25 } })), /data-brief="cost"/);
});

test("check 2: progress per idea, links to the keys, and polling until every target is done", () => {
  const open = progress("open", [
    row("W1", "workia", "Workia", "running"),
    row("Z1", "zigzag", "ZigZag", "queued"),
    row("X1", "plania", "Plania", "done", { result: { code: "X1", status: "created", idea_key: "PLA-IDEA40", initiative_key: "PLA-I46", ticket_keys: ["PLA-I46-1", "PLA-I46-2", "PLA-I46-3", "PLA-I46-4"] } }),
    row("F1", "filmia", "Filmia", "failed", { note: "F1: no product-owner bot for filmia", result: { code: "F1", status: "failed", note: "no product-owner bot for filmia" } }),
  ]);
  assert.equal(lib.planPollInterval(open), 5000);
  const out = html(h(bar.BriefSendBar, { count: 0, reply: "yes", onClear: noop, language: "en", plan: open, onDismiss: noop }));
  const rows = text(out);
  assert.match(rows, /W1 Planning in Workia/);
  assert.match(rows, /Z1 Queued/);
  assert.match(rows, /X1 Planned as PLA-I46 , 4 tickets, Backlog/);
  assert.match(rows, /F1 Failed: no product-owner bot for filmia/);
  assert.match(out, /data-brief="plan-link" href="\/p\/plania\?task=PLA-I46"/);
  assert.match(out, /data-status="open"/);
  assert.doesNotMatch(out, /data-brief="dismiss"/, "no close while targets still run");
  assert.match(rows, /The project bots plan these one after another\./);

  const done = progress("done", [
    row("W1", "workia", "Workia", "done", { result: { code: "W1", status: "created", initiative_key: "WRK-I18", ticket_keys: ["WRK-I18-1"] } }),
    row("Z1", "zigzag", "ZigZag", "done", { result: { code: "Z1", status: "duplicate", note: "duplicate of ZIG-IDEA7", idea_key: "ZIG-IDEA7" } }),
    row("Z2", "zigzag", "ZigZag", "done", { result: { code: "Z2", status: "proposed", note: "proposed in Te toca instead of planned" } }),
  ]);
  assert.equal(lib.planPollInterval(done), false, "polling stops once every target is done");
  const fin = html(h(bar.BriefSendBar, { count: 0, reply: "yes", onClear: noop, language: "en", plan: done, onDismiss: noop }));
  assert.match(text(fin), /W1 Planned as WRK-I18 , 1 ticket, Backlog/);
  assert.match(text(fin), /Z1 Duplicate of ZIG-IDEA7/);
  assert.match(text(fin), /Z2 Proposed in Te toca instead of planned/);
  assert.match(fin, /href="\/p\/zigzag\?task=ZIG-IDEA7"/);
  assert.match(fin, /data-brief="dismiss"/);
  assert.match(text(fin), /Every idea is planned\./);
  assert.match(text(html(h(bar.BriefSendBar, { count: 0, reply: "yes", onClear: noop, language: "en", plan: { ...done, status: "partial" }, onDismiss: noop }))), /Select them and send again/);
  // Spanish.
  assert.match(text(html(h(bar.BriefSendBar, { count: 0, reply: "sí", onClear: noop, language: "es", plan: done, onDismiss: noop }))), /W1 Planeada como WRK-I18 , 1 ticket, Backlog .*Z1 Duplicada de ZIG-IDEA7/);
  // Nothing selected and nothing sent: no bar.
  assert.equal(html(h(bar.BriefSendBar, { count: 0, reply: "yes", onClear: noop, language: "en" })), "");
});

test("check 3 (D7): the paused caption appears on the bar and on the idea card", () => {
  const z1 = row("Z1", "zigzag", "ZigZag", "waiting_paused", { note: "ZigZag runs are paused" });
  const p = progress("open", [z1]);
  const out = html(h(bar.BriefSendBar, { count: 0, reply: "yes", onClear: noop, language: "en", plan: p }));
  assert.match(out, /data-brief="paused"[^>]*>Waiting: ZigZag runs are paused</);
  const zig = sample.apps.find((a: any) => a.id === "zigzag");
  const idea = sample.ideas.find((i: any) => i.code === "Z1");
  const card = html(h(ideas.IdeaCard, { idea, app: zig, checked: false, selected: false, readOnly: false, onCheck: noop, onSelect: noop, language: "en", plan: z1 }));
  assert.match(card, /data-brief="plan-caption" data-state="waiting_paused">Waiting: ZigZag runs are paused</);
  const es = html(h(ideas.IdeaCard, { idea, app: zig, checked: false, selected: false, readOnly: false, onCheck: noop, onSelect: noop, language: "es", plan: z1 }));
  assert.match(es, />En espera: las corridas de ZigZag están en pausa</);
  // The whole ideas section passes progress to the right card only.
  const groups = lib.ideaGroups(sample, { app: null, view: "open", checks: [] });
  const all = html(h(ideas.BriefIdeas, { groups, checks: [], selected: new Set(), readOnly: false, onCheck: noop, onSelect: noop, language: "en", plans: new Map([["Z1", z1]]) }));
  assert.equal((all.match(/data-brief="plan-caption"/g) ?? []).length, 1);
  assert.match(all, /data-code="Z1"[\s\S]*Waiting: ZigZag runs are paused/);
  // A paused company reads as the company.
  assert.equal(text(html(h(bar.PlanProgressList, { ideas: [row("W1", "workia", "Workia", "waiting_paused", { note: "company runs are paused" })], language: "en" }))), "W1 Waiting: company runs are paused");
});
