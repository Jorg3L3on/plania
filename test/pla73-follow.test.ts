// PLA-73: follow takes a path prefix or a CSS selector (the photo pass threw on «/panel/novias/»).
import assert from "node:assert/strict";
import { test } from "node:test";
const { followSelector } = await import("../src/captures/run.js");
test("PLA-73: a path prefix becomes a link selector; a selector stays", () => {
  assert.equal(followSelector("/panel/novias/"), 'a[href^="/panel/novias/"]');
  assert.equal(followSelector("a.cor-row"), "a.cor-row");
  assert.equal(followSelector('a[href*="/panel/novias/"]'), 'a[href*="/panel/novias/"]');
});
