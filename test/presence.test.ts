// PLA-11: agent presence (src/mcp/team.ts presenceOf). A claim renewed inside the idle window is a sign of life,
// so an agent with an old check-in is alive, not stuck, while its session keeps the claim fresh. Pure, no database.
import assert from "node:assert/strict";
import { test } from "node:test";
import { presenceOf } from "../src/mcp/team.js";

const now = new Date("2026-11-08T05:40:00Z");
const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000);

test("no claim: alive inside the default window, idle outside", () => {
  assert.equal(presenceOf(ago(30), [], now), "alive");
  assert.equal(presenceOf(ago(121), [], now), "idle");
  assert.equal(presenceOf(null, [], now), "idle");
});

test("old check-in but a claim renewed 3 minutes ago: alive (the /ceo false atascado)", () => {
  assert.equal(presenceOf(ago(122), [{ idleMinutes: 120, seenAt: ago(3) }], now), "alive");
  assert.equal(presenceOf(null, [{ idleMinutes: 120, seenAt: ago(3) }], now), "alive");
});

test("claim quiet past the window and no recent check-in: stuck", () => {
  assert.equal(presenceOf(ago(200), [{ idleMinutes: 120, seenAt: ago(150) }], now), "stuck");
  assert.equal(presenceOf(null, [{ idleMinutes: 120, seenAt: null }], now), "stuck");
});

test("a recent check-in keeps a quiet claim alive, as before", () => {
  assert.equal(presenceOf(ago(10), [{ idleMinutes: 120, seenAt: ago(150) }], now), "alive");
});

test("one stale claim among fresh ones is still stuck", () => {
  assert.equal(presenceOf(ago(200), [{ idleMinutes: 120, seenAt: ago(5) }, { idleMinutes: 30, seenAt: ago(45) }], now), "stuck");
});
