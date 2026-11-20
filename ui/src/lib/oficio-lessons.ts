// PLA-I67-3: lessons on the Oficio page, the pure part: their types, which rows the drawing gives them (proposals
// first, then the active ones, newest first), where the return arc from a delivery to its proposal runs, and the
// error a decision shows. Tested without a browser (test/i67-lessons-ui.test.ts). Pure: no "@/" imports.
import { getLanguage, words, type Language } from "./i18n.js";
import { LESSON_WORDS } from "./oficio-lesson-words.js";

export type LessonView = {
  id: string;
  text: string;
  applies_when: string | null;
  state: "proposed" | "active" | "one-off" | "rejected" | "retired" | "expired";
  proposed_by: "reflector" | "owner";
  version: number;
  owner_words: string | null;
  task_key: string | null;
  task_title: string | null;
  conflicts_with: { id: string; text: string } | null;
  at: string;
  carried: number;
};
export type LessonsRead = { project: string; agent: string; lessons: LessonView[]; reading: { task_key: string | null; at: string }[] };
export type LessonAction = "approve" | "one-off" | "reject" | "retire";

/** Proposals first (oldest waiting first), then active lessons (newest first), cut to max rows. */
export function lessonRowsOf(lessons: LessonView[], max: number): LessonView[] {
  const waiting = lessons.filter((l) => l.state === "proposed").sort((a, b) => a.at.localeCompare(b.at));
  const active = lessons.filter((l) => l.state === "active").sort((a, b) => b.at.localeCompare(a.at));
  return [...waiting, ...active].slice(0, Math.max(0, max));
}

/** How many rows lessons take when room is short: every proposal, then up to half the room. */
export function lessonRoom(lessons: LessonView[], rows: number): number {
  const waiting = lessons.filter((l) => l.state === "proposed").length;
  const active = lessons.filter((l) => l.state === "active").length;
  if (waiting + active === 0) return 0;
  return Math.min(waiting + active, Math.max(waiting, Math.floor(rows / 2)));
}

/** The return arc: from the delivery's dot, down under the line, back left to the gate on the lesson's thread. */
export function returnArc(from: { x: number; y: number }, gate: { x: number; y: number }, floor: number): string {
  const r = 14;
  const low = Math.max(from.y, gate.y) + floor;
  return [`M ${from.x} ${from.y + 8}`, `L ${from.x} ${low - r}`, `Q ${from.x} ${low} ${from.x - r} ${low}`, `L ${gate.x + r} ${low}`, `Q ${gate.x} ${low} ${gate.x} ${low - r}`, `L ${gate.x} ${gate.y + 9}`].join(" ");
}

/** The amber end of the headline: one lesson waits, or how many. Null when none. */
export function waitingLine(lessons: LessonView[], language: Language = getLanguage()): string | null {
  const n = lessons.filter((l) => l.state === "proposed").length;
  const w = words(LESSON_WORDS, language);
  return n === 0 ? null : n === 1 ? w.oneWaits : w.manyWait(n);
}

/** A refused decision or rule, in words. */
export function lessonError(code: string | null, language: Language = getLanguage()): string | null {
  if (!code) return null;
  const w = words(LESSON_WORDS, language);
  if (code === "LESSON_NOT_ALLOWED") return w.notAllowed;
  if (code === "TOO_LARGE") return w.tooLong;
  return w.failed(code);
}
