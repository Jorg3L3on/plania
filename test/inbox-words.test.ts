// The Bandeja's words. Gate option words (Seguir, Soltar, ...) went with the gates in 2.17:
// an old answered gate question shows its stored answer as written.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as words from "../ui/src/lib/inbox.js";

test("approval actions read in Spanish and gate option words are gone", () => {
  assert.equal(words.actionWord("wont_do"), "marcar Won't do");
  assert.equal(words.actionWord("reopen"), "reabrir");
  assert.equal(words.actionWord("something_new"), "something_new");
  assert.equal("optionLabel" in words, false);
  assert.equal("questionMarkLabels" in words, false);
});

test("wait time reads in minutes, hours or days", () => {
  assert.equal(words.waitText(30), "1 min");
  assert.equal(words.waitText(7200), "2 h");
  assert.equal(words.waitText(3 * 86400), "3 d");
});
