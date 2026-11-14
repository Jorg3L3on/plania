// PLA-I41-2: Morning brief types and settings. The §17 sample parses as BriefData; brief_settings loads its defaults,
// saves a patch (row 1 only, per-project overrides merged), refuses bad input, and resolves env fallbacks, idea
// letters (MiCasa/Mianovia collision), order and color slots. Throwaway plania_test_<hash> database only.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import type pg from "pg";
import { resetTestDb, TEST_DATABASE_URL, useTestEnv } from "./helpers.js";

useTestEnv();
const { makeDb } = await import("../src/db/client.js");
const { BriefData, BriefPassOutput, IdeasPassOutput, BriefSettingsPatch } = await import("../src/brief/types.js");
const S = await import("../src/brief/settings.js");

type Db = ReturnType<typeof makeDb>["db"];
let raw: pg.Client;
let db: Db;
let closeDb: () => Promise<void>;
const sample = JSON.parse(readFileSync(new URL("./fixtures/brief-sample.json", import.meta.url), "utf8"));

before(async () => {
  assert.match(TEST_DATABASE_URL, /\/plania_test_[0-9a-f]{6}$/);
  raw = await resetTestDb();
  ({ db, close: closeDb } = makeDb());
});

after(async () => {
  await closeDb();
  await raw.end();
});

test("the §17 sample is valid BriefData; bad shapes are refused", () => {
  const d = BriefData.parse(sample);
  assert.equal(d.items.length, 7);
  assert.deepEqual(d.ideas.map((i) => i.code), ["W1", "Z1", "Z2", "F1", "F2", "M1", "X1"]);
  assert.equal(BriefData.safeParse({ ...sample, ideas: [] }).success, false, "ideas are never empty");
  assert.equal(BriefData.safeParse({ ...sample, items: [{ ...sample.items[0], status: "done" }] }).success, false);
  assert.equal(BriefData.safeParse({ ...sample, apps: [{ id: "x", name: "X", color: "#ff0000" }] }).success, false, "no hex colors");
  assert.equal(BriefData.safeParse({ ...sample, items: [{ ...sample.items[0], url: "javascript:alert(1)" }] }).success, false);
});

test("pass outputs: what Claude returns, before merge adds ids and codes", () => {
  assert.ok(BriefPassOutput.safeParse({ items: [{ app: "workia", status: "next", title: "Fix it", action: "Open" }] }).success);
  assert.equal(BriefPassOutput.safeParse({ items: [{ app: "workia", status: "next", title: "Fix it", action: "Ship" }] }).success, false);
  assert.ok(IdeasPassOutput.safeParse({ ideas: [{ app: "filmia", title: "Taste map", why: "Because.", flags: ["big", "overlap:FIL-I51"] }] }).success);
  assert.equal(IdeasPassOutput.safeParse({ ideas: [{ app: "filmia", title: "Taste map", why: "Because.", flags: ["paid"] }] }).success, false);
  assert.equal(IdeasPassOutput.safeParse({ ideas: [] }).success, false);
});

test("load before any save gives the defaults (11:00 ceiling, en, 5 items, 3 ideas)", async () => {
  const s = await S.loadBriefSettings(db);
  assert.deepEqual(s, S.DEFAULT_SETTINGS);
  assert.equal(s.fallback_at, "11:00");
  const { rows } = await raw.query("select count(*)::int as n from brief_settings");
  assert.equal(rows[0].n, 0, "load does not write");
});

test("save merges a patch over the stored row, projects per slug; times read back as HH:MM", async () => {
  await S.saveBriefSettings(db, { run_at: "06:30", hidden_refs: [" PLA-I16 ", "PLA-I16"], projects: { workia: { order: 0, letter: "W" } } });
  const s = await S.saveBriefSettings(db, { language: "es", projects: { zigzag: { include_ideas: false } }, pass_timeouts: { brief: 12, ideas: 20, plan: 30 } });
  assert.equal(s.run_at, "06:30");
  assert.equal(s.language, "es");
  assert.deepEqual(s.hidden_refs, ["PLA-I16"]);
  assert.deepEqual(s.projects, { workia: { order: 0, letter: "W" }, zigzag: { include_ideas: false } });
  const loaded = await S.loadBriefSettings(db);
  assert.deepEqual(loaded, s);
  const { rows } = await raw.query("select id, run_at::text, fallback_at::text from brief_settings");
  assert.deepEqual(rows, [{ id: 1, run_at: "06:30:00", fallback_at: "11:00:00" }], "one row, id 1");
});

test("save refuses unknown keys, bad times, bad letters and bad time zones", async () => {
  await assert.rejects(S.saveBriefSettings(db, { colour: "red" }), S.BriefSettingsError);
  await assert.rejects(S.saveBriefSettings(db, { run_at: "7am" }), /run_at/);
  await assert.rejects(S.saveBriefSettings(db, { fallback_at: "25:00" }), /fallback_at/);
  await assert.rejects(S.saveBriefSettings(db, { projects: { workia: { letter: "X" } } }), /letter/);
  await assert.rejects(S.saveBriefSettings(db, { timezone: "Mars/Olympus" }), /timezone/);
  assert.equal(BriefSettingsPatch.safeParse({ github_mode: "gh" }).success, true);
  assert.equal((await S.loadBriefSettings(db)).language, "es", "a refused save writes nothing");
});

test("resolve: settings first, then PLANIA_TZ / PLANIA_CEO_NAME, then the defaults", () => {
  const base = S.DEFAULT_SETTINGS;
  const r = S.resolveBriefSettings(base, {});
  assert.equal(r.timezone, "America/Mexico_City");
  assert.equal(r.timezone_label, "CDMX");
  assert.equal(r.owner_name, "the owner");
  const env = S.resolveBriefSettings(base, { PLANIA_TZ: "America/Bogota", PLANIA_CEO_NAME: "Jorge" });
  assert.equal(env.timezone, "America/Bogota");
  assert.equal(env.timezone_label, "Bogota");
  assert.equal(env.owner_name, "Jorge");
  const own = S.resolveBriefSettings({ ...base, timezone: "America/Los_Angeles", timezone_label: "Pacific", owner_name: "Ana" }, { PLANIA_TZ: "UTC" });
  assert.deepEqual([own.timezone, own.timezone_label, own.owner_name], ["America/Los_Angeles", "Pacific", "Ana"]);
  assert.equal(S.resolveBriefSettings(base, { PLANIA_TZ: "Not/AZone" }).timezone, "America/Mexico_City");
});

test("projects: order, letters (MIC/MIA collision), include, color slots", () => {
  const mk = (slug: string, title: string, keyPrefix: string) => ({ id: slug, slug, title, keyPrefix });
  const all = [mk("micasa", "MiCasa", "MIC"), mk("mianovia", "Mianovia", "MIA"), mk("workia", "Workia", "WRK"), mk("filmia", "Filmia", "FIL"), mk("zigzag", "ZigZag", "ZIG")];
  const out = S.briefProjects(all, { projects: { workia: { order: 0 }, zigzag: { order: 1 }, filmia: { order: 2, include: false } } });
  assert.deepEqual(out.map((p) => p.slug), ["workia", "zigzag", "filmia", "mianovia", "micasa"]);
  const by = Object.fromEntries(out.map((p) => [p.slug, p]));
  assert.equal(by.workia!.letter, "W");
  assert.equal(by.zigzag!.letter, "Z");
  assert.equal(by.mianovia!.letter, "M", "mianovia sorts first among the unordered, so it keeps M");
  assert.equal(by.micasa!.letter, "I", "micasa collides on M and takes the next free letter of its title");
  assert.equal(by.filmia!.include, false);
  assert.equal(by.filmia!.include_ideas, false);
  assert.equal(by.filmia!.color, "other", "an excluded project takes no slot");
  assert.deepEqual(out.filter((p) => p.include).map((p) => p.color), ["c0", "c1", "c2", "c3"]);

  const pinned = S.briefProjects(all, { projects: { micasa: { letter: "M" } } });
  assert.equal(pinned.find((p) => p.slug === "micasa")!.letter, "M", "a letter set by hand wins");
  assert.equal(pinned.find((p) => p.slug === "mianovia")!.letter, "I");

  const many = Array.from({ length: 8 }, (_, i) => mk(`p${i}`, `P${i}`, `P${i}`));
  assert.deepEqual(S.briefProjects(many, { projects: {} }).map((p) => p.color), ["c0", "c1", "c2", "c3", "c4", "c5", "other", "other"]);
  assert.equal(new Set(S.briefProjects(many, { projects: {} }).map((p) => p.letter)).size, 8, "letters never repeat");
});
