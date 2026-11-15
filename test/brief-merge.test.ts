// PLA-I41-5: the Morning brief merge (spec §7.1 server rules, §11). Pure functions, no database.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  briefApps,
  capItems,
  hasHiddenRef,
  ideaId,
  itemId,
  mergeBrief,
  norm,
  projectionLines,
  type MergeInput,
} from "../src/brief/merge.js";
import { briefProjects, DEFAULT_SETTINGS, resolveBriefSettings } from "../src/brief/settings.js";
import { BriefData, type BriefSettings, type Item } from "../src/brief/types.js";

const sample = JSON.parse(readFileSync(new URL("./fixtures/brief-sample.json", import.meta.url), "utf8")) as BriefData;

const PROJECTS = [
  { id: "1", slug: "workia", title: "Workia", keyPrefix: "WRK" },
  { id: "2", slug: "zigzag", title: "ZigZag", keyPrefix: "ZIG" },
  { id: "3", slug: "filmia", title: "Filmia", keyPrefix: "FIL" },
  { id: "4", slug: "micasa", title: "MiCasa", keyPrefix: "MIC" },
  { id: "5", slug: "mianovia", title: "Mianovia", keyPrefix: "MIA" },
];
const ORDER = { workia: { order: 0 }, zigzag: { order: 1 }, filmia: { order: 2 }, micasa: { order: 3 }, mianovia: { order: 4 } };

function input(over: Partial<MergeInput> = {}, settings: Partial<BriefSettings> = {}): MergeInput {
  const stored: BriefSettings = { ...structuredClone(DEFAULT_SETTINGS), projects: ORDER, ...settings };
  return {
    settings: resolveBriefSettings(stored, { PLANIA_TZ: "America/Mexico_City" }),
    projects: briefProjects(PROJECTS, stored),
    facts: { projects: [], source_errors: [] },
    generatedAt: "2026-11-13T07:04:12-06:00",
    window: { from: "2026-11-12T18:00:00-06:00", to: "2026-11-13T07:04:12-06:00" },
    brief: { ok: true, data: { items: [] } },
    ideas: { ok: true, data: { ideas: [{ app: "workia", title: "Renewal board", why: "Contracts due soon." }] } },
    ...over,
  };
}
const passItem = (over: Record<string, unknown> = {}) => ({ app: "workia", status: "needs_you", ref: "WRK-I14", title: "Release sandbox to main", ...over });

// ---- Check 1: stable ids

test("ids follow §7.1: the sample's sha1 ids are reproduced from ref and title", () => {
  for (const i of sample.items) assert.equal(itemId(i.app, i.ref, i.title), i.id, i.title);
  for (const d of sample.ideas) assert.equal(ideaId(d.app, d.title), d.id, d.title);
  assert.equal(norm("  Release   Sandbox\tto MAIN "), "release sandbox to main");
});

test("check 1: two merges with the same ref and title give the same ids, whatever the detail, case or spacing", () => {
  const a = mergeBrief(input({ brief: { ok: true, data: { items: [passItem({ detail: "Monday text" })] } } }));
  const b = mergeBrief(input({ brief: { ok: true, data: { items: [passItem({ title: "release  SANDBOX to main ", detail: "Tuesday text" })] } } }));
  assert.equal(a.items[0]!.id, b.items[0]!.id);
  assert.match(a.items[0]!.id, /^i\|workia\|[0-9a-f]{12}$/);
  const c = mergeBrief(input({ brief: { ok: true, data: { items: [passItem({ ref: "WRK-I15" })] } } }));
  assert.notEqual(a.items[0]!.id, c.items[0]!.id, "another ref is another item");
  assert.equal(a.ideas[0]!.id, mergeBrief(input()).ideas[0]!.id);
});

// ---- Check 2: hidden refs

test("hasHiddenRef matches whole tokens, ignoring case", () => {
  const hidden = ["PLA-I16"];
  assert.ok(hasHiddenRef("PLA-I16 · #9", hidden));
  assert.ok(hasHiddenRef("close pla-i16 today", hidden));
  assert.ok(hasHiddenRef("PLA-I16-2 is open", hidden), "a ticket of the hidden initiative");
  assert.ok(!hasHiddenRef("PLA-I160", hidden));
  assert.ok(!hasHiddenRef("XPLA-I16", hidden));
  assert.ok(!hasHiddenRef("anything", []));
});

test("check 2: hidden refs are dropped from items and ideas (ref, title and why)", () => {
  const data = mergeBrief(
    input(
      {
        brief: {
          ok: true,
          data: {
            items: [
              passItem({ ref: "PLA-I16 · #9", title: "Close the old gate" }),
              passItem({ ref: "#12", title: "Merge the pla-i16 follow-up" }),
              passItem({ ref: "PLA-I160", title: "Keep this one" }),
            ],
          },
        },
        ideas: {
          ok: true,
          data: {
            ideas: [
              { app: "workia", title: "PLA-I16 revival", why: "No." },
              { app: "workia", title: "Quiet idea", why: "Builds on PLA-I16." },
              { app: "workia", title: "Renewal board", why: "Contracts due soon." },
            ],
          },
        },
        openIdeas: [{ app: "zigzag", key: "PLA-I16", title: "hidden open idea", summary: null }],
      },
      { hidden_refs: ["PLA-I16"] },
    ),
  );
  assert.deepEqual(data.items.map((i) => i.title), ["Keep this one"]);
  assert.deepEqual(data.ideas.map((i) => i.title), ["Renewal board"]);
  assert.doesNotMatch(JSON.stringify(data), /PLA-I16\b(?!0)/i);
});

// ---- Check 3: ideas never empty

test("check 3: pass B failed -> fallback ideas from open Plania ideas, then yesterday's unchecked; partial + one cross item", () => {
  const data = mergeBrief(
    input({
      ideas: { ok: false, summary: "pass ideas timed out" },
      openIdeas: [
        { app: "zigzag", key: "ZIG-IDEA3", title: "Late-payer flag", summary: "Mark customers who pay late." },
        { app: "zigzag", key: "ZIG-IDEA4", title: "Quote templates", summary: null },
      ],
      yesterdayIdeas: [{ id: ideaId("filmia", "Taste map"), code: "F1", app: "filmia", title: "Taste map", why: "Map what you watched.", source: "Filmia" }],
    }),
  );
  assert.equal(data.mode, "partial");
  assert.deepEqual(
    data.ideas.map((i) => [i.code, i.title, i.source]),
    [
      ["Z1", "Late-payer flag", "Plania"],
      ["Z2", "Quote templates", "Plania"],
      ["F1", "Taste map", "Filmia"],
    ],
  );
  assert.equal(data.ideas[1]!.why, "Open idea in Plania (ZIG-IDEA4).");
  const cross = data.items.filter((i) => i.app === "cross");
  assert.equal(cross.length, 1);
  assert.match(cross[0]!.detail!, /timed out/);
  assert.equal(data.sources.find((s) => s.name === "claude_ideas")!.ok, false);
});

test("check 3: no ideas anywhere -> one cross idea; also when every Claude idea was dropped", () => {
  for (const ideas of [{ ok: false as const, summary: "error" }, { ok: true as const, data: { ideas: [{ app: "excluded", title: "x", why: "" }] } }]) {
    const data = mergeBrief(input({ ideas }));
    assert.equal(data.ideas.length, 1);
    assert.deepEqual([data.ideas[0]!.code, data.ideas[0]!.app, data.ideas[0]!.title], ["X1", "cross", "Write one idea per project in Plania"]);
  }
  assert.throws(() => BriefData.parse({ ...sample, ideas: [] }), "the schema itself refuses empty ideas");
});

// ---- Codes, letters, apps, caps

test("codes: per-project letters restart at 1, M collision takes the next free letter, cross is X, caps per project", () => {
  const ideas = [
    ...["A", "B", "C", "D"].map((t) => ({ app: "micasa", title: `MiCasa ${t}`, why: "w" })),
    { app: "mianovia", title: "Mianovia one", why: "w" },
    { app: "unknown-app", title: "Cross one", why: "w" },
    { app: "cross", title: "Cross two", why: "w" },
    { app: "cross", title: "Cross three", why: "w" },
    { app: "micasa", title: "micasa a", why: "duplicate by norm(title)" },
  ];
  const data = mergeBrief(input({ ideas: { ok: true, data: { ideas } } }));
  assert.deepEqual(
    data.ideas.map((i) => i.code),
    ["M1", "M2", "M3", "I1", "X1", "X2"],
  );
  assert.equal(data.ideas.find((i) => i.code === "I1")!.app, "mianovia");
  assert.equal(data.ideas.find((i) => i.code === "X1")!.source, "Plania");
  assert.equal(data.ideas[0]!.source, "MiCasa");
});

test("apps: included projects in order with c0..c5 slots, cross is other; no hex anywhere", () => {
  const data = mergeBrief(input({}, { projects: { ...ORDER, filmia: { order: 2, include: false } } }));
  assert.deepEqual(data.apps, [
    { id: "workia", name: "Workia", color: "c0" },
    { id: "zigzag", name: "ZigZag", color: "c1" },
    { id: "micasa", name: "MiCasa", color: "c2" },
    { id: "mianovia", name: "Mianovia", color: "c3" },
    { id: "cross", name: "Cross-app", color: "other" },
  ]);
  assert.doesNotMatch(JSON.stringify(data), /#[0-9a-f]{3,8}\b/i);
  assert.deepEqual(briefApps([]), [{ id: "cross", name: "Cross-app", color: "other" }]);
});

test("items: unknown app -> cross, bad status dropped, only http(s) URLs, cap by status order", () => {
  const items = [
    passItem({ status: "next", title: "n1" }),
    passItem({ status: "open_pr", title: "o1", url: "javascript:alert(1)" }),
    passItem({ status: "needs_you", title: "y1", url: "https://github.com/x/y/pull/1" }),
    passItem({ status: "blocker", title: "b1", url: "ftp://nope" }),
    passItem({ status: "next", title: "n2" }),
    passItem({ status: "done", title: "settled" }),
    passItem({ app: "nowhere", status: "next", title: "orphan" }),
  ];
  const data = mergeBrief(input({ brief: { ok: true, data: { items } } }, { max_items_per_app: 3 }));
  const workia = data.items.filter((i) => i.app === "workia");
  assert.deepEqual(workia.map((i) => i.title), ["b1", "y1", "n1"]);
  assert.equal(workia[0]!.url, undefined);
  assert.equal(workia[1]!.url, "https://github.com/x/y/pull/1");
  assert.deepEqual(data.items.filter((i) => i.app === "cross").map((i) => i.title), ["orphan"]);
  assert.equal(data.mode, "full");
});

test("capItems keeps the first of a repeated id", () => {
  const it = (title: string, status: Item["status"]): Item => ({ id: itemId("a", null, title), app: "a", status, title });
  assert.deepEqual(capItems([it("x", "next"), it("x", "next"), it("y", "blocker")], 5).map((i) => i.title), ["y", "x"]);
});

test("settled keys: an item whose every key is Done is dropped; one open key keeps it", () => {
  const items = [passItem({ ref: "WRK-12", title: "a" }), passItem({ ref: "WRK-12 · WRK-13", title: "b" })];
  const data = mergeBrief(input({ brief: { ok: true, data: { items } }, settledKeys: new Set(["WRK-12"]) }));
  assert.deepEqual(data.items.map((i) => i.title), ["b"]);
});

// ---- Failure items

test("pass A failed -> deterministic facts items + one cross item, partial", () => {
  const facts = {
    source_errors: [],
    projects: [
      {
        slug: "workia",
        inbox: [{ kind: "question", key: "WRK-9", title: "Pick a vendor", why: "The contract renews Friday.", waiting_since: "x", pr_url: null }],
        tickets_in_review: [{ key: "WRK-13", title: "Fix crash", parent: null, since: null, open_checks: 0, pr: { number: 41, url: "https://github.com/o/workia/pull/41" } }],
        audit: { at: "x", count: 1, findings: [{ code: "STALE", key: "WRK-I3", detail: "state note is stale", fix_hint: "Update it.", level: null }] },
        ready: [{ key: "WRK-20", title: "Next thing", priority: "P1", first: true }],
      },
    ],
  } as unknown as MergeInput["facts"];
  const data = mergeBrief(input({ facts, brief: { ok: false, summary: "pass brief gave invalid JSON twice" } }));
  assert.equal(data.mode, "partial");
  assert.deepEqual(
    data.items.map((i) => [i.app, i.status, i.ref ?? null]),
    [
      ["cross", "needs_you", null],
      ["workia", "needs_you", "WRK-9"],
      ["workia", "needs_you", "WRK-13 · #41"],
      ["workia", "next", "WRK-I3"],
      ["workia", "next", "WRK-20"],
    ],
  );
  assert.match(data.items[0]!.detail!, /invalid JSON/);
});

test("facts only: one cross item with the reason and the server lines; source errors give one cross item each", () => {
  const facts = {
    projects: [],
    source_errors: [{ project: "zigzag", source: "github", error: "no_repo", detail: "No GitHub repo is set.", fix: "Set github_repo on the project." }],
  } as unknown as MergeInput["facts"];
  const data = mergeBrief(input({ facts, factsOnly: "Add PLANIA_BRIEF_TOKEN (read scope) to .env", serverLines: ["Corren 2 proyectos."], brief: null, ideas: null }));
  assert.equal(data.mode, "facts_only");
  const cross = data.items.filter((i) => i.app === "cross");
  assert.equal(cross.length, 2);
  assert.match(cross[0]!.detail!, /PLANIA_BRIEF_TOKEN.*Corren 2 proyectos/);
  assert.equal(cross[1]!.title, "GitHub data missing for ZigZag");
  assert.deepEqual(data.sources.map((s) => [s.name, s.ok]), [["plania", true], ["github", false], ["claude_brief", false], ["claude_ideas", false]]);
  assert.equal(data.ideas.length, 1, "still never empty");
});

test("D7: a target waiting on paused runs gives one needs_you item per project, codes merged", () => {
  const data = mergeBrief(input({ waitingPaused: [{ slug: "zigzag", codes: ["Z3"] }, { slug: "zigzag", codes: ["Z1", "Z3"] }] }));
  const it = data.items.filter((i) => i.app === "zigzag");
  assert.equal(it.length, 1);
  assert.equal(it[0]!.status, "needs_you");
  assert.equal(it[0]!.title, "Turn on runs for ZigZag to plan Z3, Z1");
  assert.equal(it[0]!.id, itemId("zigzag", undefined, "Turn on runs for ZigZag to plan Z3, Z1"), "stable, so a check keeps it hidden");
});

test("Spanish: server texts follow the brief language", () => {
  const data = mergeBrief(input({ waitingPaused: [{ slug: "zigzag", codes: ["Z3"] }], ideas: { ok: false, summary: "x" } }, { language: "es" }));
  assert.ok(data.items.some((i) => i.title === "Activa las corridas de ZigZag para planear Z3"));
  assert.equal(data.ideas[0]!.title, "Escribe una idea por proyecto en Plania");
  assert.equal(data.language, "es");
});

// ---- Check 5 (pure half): Brief de hoy lines

test("projection: up to 5 lines, blockers first, then Needs you titles with the app name", () => {
  const items = [
    ...[1, 2, 3, 4].map((n) => passItem({ status: "needs_you", title: `need ${n}` })),
    passItem({ status: "next", title: "later" }),
    passItem({ app: "zigzag", status: "blocker", title: "prod is down" }),
    passItem({ app: "filmia", status: "needs_you", title: "need 5" }),
  ];
  const data = mergeBrief(input({ brief: { ok: true, data: { items } } }));
  assert.deepEqual(projectionLines(data), ["ZigZag: prod is down", "Workia: need 1", "Workia: need 2", "Workia: need 3", "Workia: need 4"]);
  assert.deepEqual(projectionLines({ ...data, items: [] }), ["Nothing needs you today."]);
  assert.deepEqual(projectionLines(sample).length, 5);
});

// ---- PLA-I49-2: typed rows

const factsSample = JSON.parse(readFileSync(new URL("./fixtures/brief-facts-sample.json", import.meta.url), "utf8")) as MergeInput["facts"];
const PROJECTS_PLUS = [...PROJECTS, { id: "6", slug: "plania", title: "Plania", keyPrefix: "PLA" }];
function inputV2(over: Partial<MergeInput> = {}): MergeInput {
  const stored: BriefSettings = { ...structuredClone(DEFAULT_SETTINGS), projects: { ...ORDER, plania: { order: 5 } } };
  return { ...input(over), settings: resolveBriefSettings(stored, { PLANIA_TZ: "America/Mexico_City" }), projects: briefProjects(PROJECTS_PLUS, stored), facts: factsSample, ...over };
}
const main = (i: Item | undefined) => (i?.targets?.[0] ? `${i.targets[0].kind}:${i.targets[0].project}:${i.targets[0].pr ?? i.targets[0].key ?? i.targets[0].env ?? ""}` : null);

test("v2: an about handle that is in the facts becomes a target; one that is not never reaches the brief", () => {
  const data = mergeBrief(
    inputV2({
      brief: {
        ok: true,
        data: {
          items: [
            passItem({ app: "filmia", ref: "FIL-I50-6", title: "Do the iPhone check", about: ["b:0b6c8a3e-1111-4f00-9000-000000000001", "q:made-up-id", "t:FIL-I50-6"] }),
            passItem({ app: "workia", ref: "WRK-I14", title: "Release workia", about: ["rel:workia", "rel:zigzag", "pr:workia#999", "t:NOPE-1"] }),
            passItem({ app: "workia", ref: "nothing here", title: "Talk to the lawyer", about: ["q:invented", "t:WRK-404"] }),
          ],
        },
      },
    }),
  );
  assert.equal(data.version, 2);
  const [step, rel, none] = ["Do the iPhone check", "Release workia", "Talk to the lawyer"].map((t) => data.items.find((i) => i.title === t));
  assert.deepEqual(step!.targets, [
    { kind: "step", project: "filmia", id: "0b6c8a3e-1111-4f00-9000-000000000001", key: "FIL-I50-6" },
    { kind: "ticket", project: "filmia", key: "FIL-I50-6" },
  ]);
  assert.deepEqual(rel!.targets, [{ kind: "release", project: "workia" }]);
  assert.equal(none!.targets, undefined, "no handle survived and the ref names nothing");
  const stored = JSON.stringify(data);
  for (const bad of ["made-up-id", "rel:zigzag", "#999", "NOPE-1", "invented", "WRK-404"]) assert.ok(!stored.includes(bad), bad);
  assert.equal(BriefData.safeParse(data).success, true);
});

test("v2: a facts-only brief (pass A failed) has a target on every inbox, review, audit and Ready row", () => {
  const facts = structuredClone(factsSample)!;
  const w = facts.projects.find((p) => p.slug === "workia")!;
  w.inbox.push({ handle: "q:q-1", id: "q-1", kind: "question", key: "WRK-I14", title: "Legal", why: "Ship the legal text?", options: ["yes", "no"], waiting_since: "x", pr_url: null });
  w.tickets_in_review.push({ handle: "t:WRK-I14-1", key: "WRK-I14-1", title: "Legal pages", parent: "WRK-I14", since: null, open_checks: 0, pr: { number: 50, url: "https://github.com/Jorg3L3on/workia/pull/50" } as never });
  w.pull_requests.open.push({ handle: "pr:workia#50", number: 50, title: "Legal", url: "https://github.com/Jorg3L3on/workia/pull/50", state: "open", base: "sandbox", head: "x", ticket: "WRK-I14-1", ci_state: null, opened_at: null, age_days: 1, merged_at: null, updated_at: null });
  w.audit = { at: "x", count: 1, findings: [{ handle: "f:workia/STALE_NOTE/WRK-I14", code: "STALE_NOTE", key: "WRK-I14", detail: "state note is stale", fix_hint: "Update it.", level: null }] };
  const data = mergeBrief(inputV2({ facts, brief: { ok: false, summary: "pass brief timed out" } }));
  const rows = data.items.filter((i) => i.app !== "cross");
  assert.ok(rows.length >= 6, `rows: ${rows.length}`);
  for (const i of rows) assert.ok(i.targets?.length, `no target on ${i.title}`);
  const kinds = rows.map((i) => i.targets![0]!.kind);
  for (const k of ["question", "step", "pr", "finding", "ticket"]) assert.ok(kinds.includes(k as never), k);
  assert.deepEqual(rows.find((i) => i.ref === "WRK-I14-1 · #50")!.targets![0], { kind: "pr", project: "workia", pr: 50, key: "WRK-I14-1" });
  assert.deepEqual(rows.find((i) => i.ref === "WRK-13")!.targets, [{ kind: "ticket", project: "workia", key: "WRK-13" }]);
});

test("v2: the D7 'Turn on runs' item is about the project's runs", () => {
  const data = mergeBrief(inputV2({ waitingPaused: [{ slug: "micasa", codes: ["C1"] }] }));
  const item = data.items.find((i) => i.title.startsWith("Turn on runs for MiCasa"))!;
  assert.deepEqual(item.targets, [{ kind: "runs", project: "micasa" }]);
});

test("v2 check 5: the Nov 13 sample's 7 items, without about, get their main target from ref, URL and action", () => {
  // What each item is about, by a person reading it (see brief-sample.json).
  const want: Record<string, string> = {
    "Close Juegos after the iPhone check; Quiniela data comes later": "step:filmia:FIL-I50-6",
    "Filmia prod record in Plania is stale": "env:filmia:prod",
    "Release sandbox to main (programados kit)": "release:micasa:",
    "Release sandbox to main after the legal check": "release:workia:",
    "Dependabot npm minor/patch bump": "pr:filmia:235",
    "Fix expediente crash on contracts with pay": "ticket:workia:WRK-13",
    "Close the leftover merge-gate PRs": "pr:plania:94",
  };
  const items = sample.items.map(({ id: _id, ...rest }) => rest);
  const data = mergeBrief(inputV2({ brief: { ok: true, data: { items } } }));
  assert.equal(data.items.length, 7);
  const right = data.items.filter((i) => main(i) === want[i.title]);
  const wrong = data.items.filter((i) => main(i) !== want[i.title]).map((i) => `${i.title}: ${main(i)}`);
  assert.ok(right.length >= 6, `right ${right.length}/7; wrong: ${wrong.join("; ")}`);
  console.log(`check 5: ${right.length}/7 items get the right main target${wrong.length ? `; wrong: ${wrong.join("; ")}` : ""}`);
  for (const i of data.items) assert.equal(i.id, sample.items.find((s) => s.title === i.title)!.id, "ids do not change, so old checks still hide the rows");
});

test("PLA-I49-3: rows the owner set aside (Not relevant, Later) are left out of the next brief", () => {
  const items = sample.items.map(({ id: _id, ...rest }) => rest);
  const aside = new Set([sample.items[0]!.id, sample.items[5]!.id]);
  const data = mergeBrief(inputV2({ brief: { ok: true, data: { items } }, setAside: aside }));
  assert.equal(data.items.length, 5);
  assert.ok(data.items.every((i) => !aside.has(i.id)));
});
