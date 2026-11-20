// PLA-I67-5: what the page says about a lesson without a browser: its row's word (waits, repeats, unused, runs), the
// budget bar's share, and a change in the history in words.
import assert from "node:assert/strict";
import { test } from "node:test";
import { budgetShare, historyLine, lessonCap, type LessonView } from "../ui/src/lib/oficio-lessons.js";

const l = (over: Partial<LessonView>): LessonView => ({ id: "x", text: "t", applies_when: null, state: "active", proposed_by: "owner", version: 1, owner_words: null, task_key: null, task_title: null, conflicts_with: null, at: "", carried: 3, ...over });
const rep = (confirmed: number) => ({ confirmed, flagged: confirmed >= 2, suggested: [], last: null });

test("PLA-I67-5: a lesson row says it waits, it came back, it went unused, or how many runs carried it", () => {
  assert.deepEqual(lessonCap(l({ state: "proposed" }), "es"), { text: "te toca", tone: "amber" });
  assert.deepEqual(lessonCap(l({ repeats: rep(2) }), "es"), { text: "2 repetidas", tone: "amber" });
  assert.deepEqual(lessonCap(l({ repeats: rep(1) }), "es"), { text: "1 repetida", tone: null });
  assert.deepEqual(lessonCap(l({ retire_due: true }), "es"), { text: "sin usar", tone: "amber" });
  assert.deepEqual(lessonCap(l({}), "es"), { text: "3 corridas", tone: null });
});

test("PLA-I67-5: the budget bar never passes full; the history reads in words", () => {
  assert.equal(budgetShare({ used: 750, budget: 1500 }), 0.5);
  assert.equal(budgetShare({ used: 2000, budget: 1500 }), 1);
  assert.equal(historyLine({ at: "", kind: "skill_version", what: "Boceto", n: 3, by: "owner" }, "es"), "Editaste «Boceto»: versión 3.");
  assert.equal(historyLine({ at: "", kind: "lesson_proposed", what: "Un botón", by: "plania" }, "es"), "Plania propuso «Un botón».");
});
