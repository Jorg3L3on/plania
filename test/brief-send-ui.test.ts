// PLA-I43-4: Send to Plania on /brief (spec §8 item 6, D7): the cost line before sending, the progress per idea with
// links to the keys until every target is done, and the paused caption on the bar and the idea card. Rendered with
// react-dom/server from the §17 sample brief; no browser, no database.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import * as React from "react";

(globalThis as { React?: unknown }).React = React;
const load = async (p: string) => (await import(new URL(`../ui/src/${p}`, import.meta.url).href)) as Record<string, any>;
const lib = await load("lib/brief.ts");

const sample = JSON.parse(readFileSync(new URL("./fixtures/brief-sample.json", import.meta.url), "utf8"));
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

test("plan progress lines and links (the desk's Ideas in motion uses them)", () => {
  const done = progress("done", [
    row("W1", "workia", "Workia", "done", { result: { code: "W1", status: "created", initiative_key: "WRK-I18", ticket_keys: ["WRK-I18-1"] } }),
    row("Z1", "zigzag", "ZigZag", "done", { result: { code: "Z1", status: "duplicate", note: "duplicate of ZIG-IDEA7", idea_key: "ZIG-IDEA7" } }),
    row("F1", "filmia", "Filmia", "waiting_paused", { note: "Filmia runs are paused" }),
  ]);
  assert.equal(lib.planPollInterval(done), false, "polling stops once every target is done");
  assert.equal(lib.planPollInterval(progress("open", [])), 5000);
  assert.deepEqual(lib.planLine(done.ideas[0]), { kind: "planned", key: "WRK-I18", tickets: 1 });
  assert.deepEqual(lib.planLink(done.ideas[1]), { key: "ZIG-IDEA7", href: "/p/zigzag?task=ZIG-IDEA7" });
  assert.deepEqual(lib.planLine(done.ideas[2]), { kind: "waiting", project: "Filmia" });
});

// PLA-I49-6: Copy reply and the "yes W1 Z3" box are gone; ideas get their fates on the ficha (PLA-I51).
test("check 6: the Copy reply button and the reply box are gone from the brief (PLA-I63-5: in Compañía)", () => {
  for (const f of ["brief.tsx", "brief-card.tsx", "brief-delta.tsx"]) {
    const src = readFileSync(new URL(`../ui/src/components/corriente/${f}`, import.meta.url), "utf8");
    assert.doesNotMatch(src, /copyReply|replyText|clipboard|BriefSendBar/, f);
  }
});
