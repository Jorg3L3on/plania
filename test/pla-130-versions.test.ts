// PLA-130: Estilo and Voz versions. Quick changes join one version; a kept one (gone back to, sent to Taller) is never
// merged into or dropped; the cap drops the oldest unkept first.
import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_VERSIONS, QUIET_MS, SESSION_MS, keepCurrent, record, type Versioned } from "../src/brand/versions.js";

type V = Versioned & { n: number };
const T0 = Date.parse("2026-11-20T10:00:00Z");
const add = (f: { current: number; versions: V[] }, n: number, at: number, keep = false) => record(f, (b) => ({ ...b, n }), { now: at, keep });

test("changes a few seconds apart join one version; a pause starts a new one", () => {
  const f = { current: 0, versions: [] as V[] };
  add(f, 1, T0);
  add(f, 2, T0 + 20_000);
  add(f, 3, T0 + 40_000);
  assert.equal(f.versions.length, 1, "three quick clicks are one version");
  assert.equal(f.versions[0]!.n, 3, "with the last value");
  assert.equal(f.versions[0]!.from, new Date(T0).toISOString(), "and when it started");
  add(f, 4, T0 + 40_000 + QUIET_MS + 1);
  assert.equal(f.versions.length, 2, "after a pause, a new version");
  assert.equal(f.current, 2);
});

test("a long run of quick changes still splits after the session limit", () => {
  const f = { current: 0, versions: [] as V[] };
  for (let t = 0; t <= SESSION_MS + 60_000; t += 60_000) add(f, t, T0 + t);
  assert.equal(f.versions.length, 2);
});

test("a kept version is never joined, and the cap drops the oldest unkept", () => {
  const f = { current: 0, versions: [] as V[] };
  add(f, 1, T0);
  keepCurrent(f);
  add(f, 2, T0 + 1000);
  assert.equal(f.versions.length, 2, "a change after a sent version starts a new one");
  add(f, 3, T0 + 2000, true);
  assert.equal(f.versions.length, 3, "going back is its own, kept version");
  for (let i = 0; i < MAX_VERSIONS + 5; i++) add(f, 100 + i, T0 + 10_000_000 + i * (QUIET_MS + 1));
  assert.equal(f.versions.length, MAX_VERSIONS);
  assert.ok(f.versions.some((x) => x.n === 1 && x.keep), "the sent version survives");
  assert.ok(f.versions.some((x) => x.n === 3 && x.keep), "the gone-back version survives");
  assert.ok(!f.versions.some((x) => x.n === 2), "an unkept old one went first");
});
