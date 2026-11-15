// PLA-I49-4: the desk (ui/src/components/brief/desk.tsx, desk-paper.tsx). Server-rendered with react-dom/server against
// the §17 sample with v2 targets and a fake state reply; no browser, no database. The real-browser pass (every control,
// 1440x800 and 390x844, en and es, axe) runs on the demo server and is recorded as a Plania result.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

(globalThis as { React?: unknown }).React = React;
const load = async (p: string) => (await import(new URL(`../ui/src/${p}`, import.meta.url).href)) as Record<string, any>;
const desk = await load("components/brief/desk.tsx");
const paper = await load("components/brief/desk-paper.tsx");
const i18n = await load("lib/brief-i18n.ts");
const lib = await load("lib/brief.ts");

const h = React.createElement;
const html = (el: React.ReactElement) => renderToStaticMarkup(h(QueryClientProvider, { client: new QueryClient() }, h(MemoryRouter, null, el)));
const text = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const sample = JSON.parse(readFileSync(new URL("./fixtures/brief-sample.json", import.meta.url), "utf8"));
const noop = () => {};
const data = {
  ...sample,
  version: 2,
  items: sample.items.map((i: any, n: number) => (n === 2 ? { ...i, targets: [{ kind: "release", project: "micasa" }] } : n === 5 ? { ...i, targets: [{ kind: "ticket", project: "workia", key: "WRK-13" }] } : i)),
};
const open = (actions: string[], live: any = null) => ({ state: "open", line: null, actions: actions.map((id) => ({ id, level: ["publish", "accept_pr", "fix_finding", "resume_runs", "add_to_pr", "request_changes"].includes(id) ? "confirm" : "instant", undo: true, target: ["later", "dismiss"].includes(id) ? null : 0 })), action_id: null, undo: false, live });
const state = (items: Record<string, any>, read_only = false) => ({ brief_id: "b1", read_only, items });

function props(over: Record<string, unknown> = {}) {
  return {
    data,
    briefId: "b1",
    state: undefined,
    stateLoading: false,
    checks: [],
    language: "en",
    readOnly: false,
    stamp: "Fri · Nov 13 · 07:04 CDMX",
    run: null,
    generating: false,
    canGenerate: true,
    onGenerate: noop,
    history: [],
    todayDate: "2026-11-13",
    date: null,
    onDate: noop,
    onSettings: noop,
    banner: null,
    onRetry: noop,
    onAct: async () => ({ status: "done" }),
    onUndo: async () => ({}),
    acting: false,
    selected: new Set(),
    onSelect: noop,
    onClearSelection: noop,
    ideaCost: () => ({ bots: 1, low: 10, high: 25 }),
    sending: false,
    plans: new Map(),
    ...over,
  };
}

test("piles: open rows per pile, blockers first; handled rows go to the out tray, newest first", () => {
  const ids = data.items.map((i: any) => i.id);
  const st = state({
    [ids[0]]: { ...open([]), state: "handled", line: "Answered: yes", at: "2026-11-13T13:10:00Z", action: "answer" },
    [ids[1]]: { ...open([]), state: "dismissed", line: "Not relevant", at: "2026-11-13T13:20:00Z", action: "dismiss" },
  });
  const needs = desk.openRows(data.items, st, "needs");
  assert.ok(!needs.some((i: any) => i.id === ids[0] || i.id === ids[1]));
  assert.ok(needs.every((i: any) => ["blocker", "needs_you"].includes(i.status)));
  assert.deepEqual(desk.openRows(data.items, st, "next").map((i: any) => i.status), ["next", "open_pr"]);
  assert.deepEqual(desk.trayRows(data.items, st).map((r: any) => r.item.id), [ids[1], ids[0]]);
  const c = desk.deskCounts(data, st, [], new Set());
  assert.deepEqual([c.left, c.handled, c.total], [12, 2, 14]);
});

test("the sky shows what is left and handled today; the first paper is the first Needs you row with its main stamp", () => {
  const ids = data.items.map((i: any) => i.id);
  const out = html(h(desk.BriefDesk, props({ state: state({ [ids[0]]: open(["accept_pr", "later", "dismiss"], { kind: "pr", number: 238, state: "open", base: "sandbox", url: "x", ticket: { key: "FIL-I50-6", status: "In review" }, message_id: "m" }) }) })));
  const s = text(out);
  assert.match(s, /14 left on your desk · 0 handled today/);
  assert.match(out, /data-paper="i\|filmia\|952a4f17d8ec"/);
  assert.match(out, /data-stamp="accept_pr"[^>]*>Accept into sandbox/);
  assert.match(s, /PR #238 · open → sandbox/);
  assert.match(out, /data-pile="needs"/);
  assert.doesNotMatch(out, /data-stamp="later"/, "Later and Not relevant live in the drawer and the bin, not as stamps");
});

test("check 5: a row with no target shows Give to PO (disabled), Later, Not relevant and its link", () => {
  const item = data.items[6]; // cross, no targets
  assert.equal(item.targets, undefined);
  const st = state({ [item.id]: open(["later", "dismiss"]) });
  const out = html(h(desk.BriefDesk, props({ data: { ...data, items: [item] }, state: st })));
  assert.match(out, /data-person="po"[^>]*disabled=""|disabled=""[^>]*data-person="po"/);
  assert.match(text(out), /Give to PO/);
  assert.match(out, /data-away="later"/);
  assert.doesNotMatch(out, /disabled=""[^>]*data-away="later"/);
  assert.match(out, /data-away="dismiss"/);
  assert.match(out, /href="https:\/\/github.com\/Jorg3L3on\/plania\/pull\/94"/);
  assert.doesNotMatch(out, /class="dk-st[^"]*"[^>]*data-stamp=/, "no stamps: nothing to act on");
  assert.match(text(out), /Nothing to stamp here/);
});

test("check 6: a past day shows outcomes and no buttons", () => {
  const ids = data.items.map((i: any) => i.id);
  const st = state({ [ids[0]]: { ...open([]), state: "handled", line: "Answered: yes", at: "2026-11-13T13:10:00Z", action: "answer" }, [ids[1]]: open([]) }, true);
  const out = html(h(desk.BriefDesk, props({ state: st, readOnly: true, date: "2026-11-13", banner: "past" })));
  assert.match(out, /data-brief="past"/);
  assert.doesNotMatch(out, /data-stamp=/);
  assert.match(out, /disabled=""[^>]*data-away="later"|data-away="later"[^>]*disabled=""/);
  assert.match(text(out), /Answered: yes/, "the outcome is in the out tray");
  const p = html(h(paper.Paper, { item: data.items[0], app: data.apps[2], st: st.items[ids[0]], language: "en", readOnly: true, busy: false, pending: null, fresh: false, deal: false, onPress: noop, onRun: noop, onCancel: noop, onUndo: null }));
  assert.match(text(p), /Answered/);
  assert.match(text(p), /A past day: read only/);
  assert.doesNotMatch(p, /<button/);
});

test("the paper: a confirm box says what will happen; a failed action says nothing changed; a question shows its options", () => {
  const item = data.items[2];
  const live = { kind: "release", pending: true, unknown: false, ready: true, reason: null, ahead: 10, tickets: ["MIC-I16-1", "MIC-I16-2"], migrations: ["0031"], before: 0, open_checks: 0, from: "sandbox", into: "main", env: "prod" };
  const base = { item, app: data.apps[3], st: open(["publish"], live), language: "en", readOnly: false, busy: false, fresh: false, deal: false, onPress: noop, onRun: noop, onCancel: noop, onUndo: null };
  const confirm = text(html(h(paper.Paper, { ...base, pending: { kind: "confirm", action: "publish", target: 0 } })));
  assert.match(confirm, /This merges sandbox into main for MiCasa: 2 tickets, migrations 0031\. Prod deploys from main\./);
  const failed = text(html(h(paper.Paper, { ...base, pending: { kind: "failed", action: "publish", target: 0, error: "RELEASE_MERGE_FAILED", hint: "GitHub refused the merge" } })));
  assert.match(failed, /Could not do it: GitHub refused the merge Nothing changed\. Try again/);
  const q = { kind: "question", question: "Ship it?", options: ["yes", "no"], human_only: false, answered: false, answer: null, key: "WRK-1" };
  const ans = html(h(paper.Paper, { ...base, st: open(["answer"], q), pending: { kind: "answer", target: 0 } }));
  assert.equal((ans.match(/data-stamp="answer"/g) ?? []).length, 3, "two options and the written answer");
  const es = text(html(h(paper.Paper, { ...base, language: "es", pending: { kind: "confirm", action: "publish", target: 0 } })));
  assert.match(es, /Esto fusiona sandbox en main para MiCasa/);
  assert.match(es, /Publicación · lista/);
});

test("labels: the desk table has the same keys in en and es, and a verb and a stamp for every action", () => {
  const en = i18n.BRIEF_LABELS.en.d;
  const es = i18n.BRIEF_LABELS.es.d;
  assert.deepEqual(Object.keys(es.verbs).sort(), Object.keys(en.verbs).sort());
  const ids = ["answer", "step_done", "add_to_pr", "publish", "accept_pr", "request_changes", "resume_runs", "postpone", "put_first", "hold", "fix_finding", "later", "dismiss"];
  for (const id of ids) {
    assert.ok(en.verbs[id] && es.verbs[id] && en.stamps[id] && es.stamps[id], id);
    assert.ok(paper.INK[id], id);
  }
  assert.equal(lib.targetHref({ kind: "ticket", project: "workia", key: "WRK-13" }), "/p/workia?task=WRK-13");
  assert.equal(lib.targetHref({ kind: "pr", project: "plania", pr: 9 }, { kind: "pr", number: 9, state: "open", base: null, url: "", ticket: { key: "PLA-1", status: "In review" }, message_id: null }), "/p/plania?task=PLA-1");
});

test("PLA-I49-6: an idea paper offers Keep and Discard; the people plan, sketch and research it; Ideas in motion lists Plania ideas", () => {
  const z1 = data.ideas.find((i: any) => i.code === "Z1");
  const w1 = data.ideas.find((i: any) => i.code === "W1");
  const st = {
    brief_id: "b1",
    read_only: false,
    items: {},
    ideas: { [w1.id]: { state: "kept", line: "Kept in Plania: WRK-IDEA3", key: "WRK-IDEA3", action_id: "a1", undo: true, at: "2026-11-13T13:00:00Z", project: "workia", paused: false } },
    in_motion: [{ project: "filmia", key: "FIL-IDEA14", title: "Quiniela leaderboard", stage: "design", next: "sketch_ready", sketch: true, research: false, doc_url: "https://claude.ai/artifact/x" }],
  };
  const desk2 = (over: Record<string, unknown>) => html(h(desk.BriefDesk, props({ data: { ...data, items: [] }, state: st, ...over })));
  // Ideas pile: W1 is in motion (kept), FIL-IDEA14 too, then today's ideas without W1.
  const out = desk2({});
  assert.match(out, /data-pile="ideas"/);
  const ideasPile = html(h(desk.BriefDesk, props({ data: { ...data, items: [] }, state: st })));
  assert.match(ideasPile, /data-paper="d\|/, "with no rows, the first idea is on the paper");
  assert.match(ideasPile, /data-moving="d\|workia/);
  assert.match(ideasPile, /data-motion="FIL-IDEA14"[^>]*>|href="https:\/\/claude.ai\/artifact\/x"/);
  assert.match(text(ideasPile), /Sketch ready/);
  assert.doesNotMatch(ideasPile, new RegExp(`data-tab="${w1.id.replace(/\|/g, "\\|")}"`), "a kept idea leaves Today's ideas");
  assert.match(text(ideasPile), /Keep .*Discard/);
  assert.match(ideasPile, /data-person="po"[^>]*>|Plan it/);
  for (const v of ["Plan it", "Sketch it", "Research it"]) assert.match(text(ideasPile), new RegExp(v));
  assert.match(ideasPile, /data-away="keep"/);
  assert.match(ideasPile, /data-away="discard"/);
  assert.equal(desk.deskCounts(data, st, [], new Set(), new Set([w1.id])).left, data.items.length + data.ideas.length - 1);
  void z1;
});

test("PLA-33 check 5: the last-run banner shows the reason over the kept brief, in es and en", () => {
  const lastRun = { status: "fail", kind: "auth", reason: "Failed to authenticate", ended_at: "2026-11-15T03:10:00Z" };
  const en = html(h(desk.BriefDesk, props({ lastRun })));
  assert.match(en, /data-brief="last-run"/);
  assert.match(text(en), /Couldn't update at 21:10/);
  assert.match(text(en), /\/login/);
  const es = text(html(h(desk.BriefDesk, props({ lastRun, language: "es", data: { ...data, language: "es" } }))));
  assert.match(es, /No se pudo actualizar a las 21:10/);
  assert.match(es, /Claude no tiene sesión iniciada/);
  const other = text(html(h(desk.BriefDesk, props({ lastRun: { ...lastRun, kind: "other", reason: "pass brief timed out" } }))));
  assert.match(other, /pass brief timed out/);
  assert.doesNotMatch(html(h(desk.BriefDesk, props())), /data-brief="last-run"/);
});
