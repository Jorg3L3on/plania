// PLA-I67-3: lessons on the Oficio page, without a browser: which rows they take (proposals first), how much room they
// get, the return arc from a delivery to the stop, the amber end of the headline and the refusals in words.
import assert from "node:assert/strict";
import { test } from "node:test";
import { lessonError, lessonRoom, lessonRowsOf, returnArc, waitingLine, type LessonView } from "../ui/src/lib/oficio-lessons.js";

const lesson = (id: string, state: LessonView["state"], at: string): LessonView => ({ id, text: `Lección ${id}`, applies_when: null, state, proposed_by: "reflector", version: 1, owner_words: null, task_key: null, task_title: null, conflicts_with: null, at, carried: 0 });

test("PLA-I67-3: proposals take the first lesson rows, then active ones newest first; room is every proposal or half the rows", () => {
  const ls = [lesson("a", "active", "2026-11-01"), lesson("p", "proposed", "2026-11-10"), lesson("b", "active", "2026-11-05"), lesson("q", "proposed", "2026-11-02")];
  assert.deepEqual(lessonRowsOf(ls, 10).map((l) => l.id), ["q", "p", "b", "a"]);
  assert.deepEqual(lessonRowsOf(ls, 3).map((l) => l.id), ["q", "p", "b"]);
  assert.equal(lessonRoom(ls, 12), 4);
  assert.equal(lessonRoom(ls, 4), 2);
  assert.equal(lessonRoom([], 10), 0);
});

test("PLA-I67-3: the return arc leaves the delivery downwards and comes up into the stop", () => {
  const d = returnArc({ x: 600, y: 300 }, { x: 340, y: 420 }, 30);
  assert.match(d, /^M 600 308 L 600 436 Q 600 450 586 450 L 354 450 Q 340 450 340 436 L 340 429$/);
});

test("PLA-I67-3: the headline says when a lesson waits; refusals read in words", () => {
  assert.equal(waitingLine([lesson("p", "proposed", "x")], "es"), "Una lección te espera.");
  assert.equal(waitingLine([lesson("p", "proposed", "x"), lesson("q", "proposed", "y")], "es"), "2 lecciones te esperan.");
  assert.equal(waitingLine([lesson("a", "active", "x")], "es"), null);
  assert.equal(lessonError("LESSON_NOT_ALLOWED", "es"), "Eso no se aprende: guarda un secreto o se salta una revisión.");
});
