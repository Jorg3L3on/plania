// Inicio's goals as one line (ui/src/lib/metas-linea.ts, GoalsHome in components/goals/goals-board.tsx): the active
// company goals and their tasks done, never the cards. Pure, no database.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { metasLinea, metasLineaTexto } from "../ui/src/lib/metas-linea.js";

const meta = (over: Partial<{ project: string | null; status: string; done: number; total: number }> = {}) => ({
  project: over.project ?? null,
  status: over.status ?? "active",
  progress: { done: over.done ?? 0, total: over.total ?? 0 },
});

test("the line counts the company's active goals and their tasks; done, dropped and project goals stay out", () => {
  const goals = [meta({ done: 3, total: 8 }), meta({ done: 2, total: 4 }), meta({ status: "done", done: 5, total: 5 }), meta({ status: "dropped", total: 9 }), meta({ project: "zeep", done: 1, total: 1 })];
  assert.deepEqual(metasLinea(goals), { hay: true, activas: 2, done: 5, total: 12 });
  assert.deepEqual(metasLineaTexto(metasLinea(goals), "es"), ["2 activas", "5 de 12 tareas hechas"]);
  assert.deepEqual(metasLineaTexto(metasLinea(goals), "en"), ["2 active", "5 of 12 tasks done"]);
});

test("the line with no goals, none active, or no work yet", () => {
  assert.deepEqual(metasLineaTexto(metasLinea([]), "es"), ["Sin metas todavía"]);
  assert.deepEqual(metasLineaTexto(metasLinea([meta({ project: "zeep" })]), "es"), ["Sin metas todavía"], "a project's goal is not the company's");
  assert.deepEqual(metasLineaTexto(metasLinea([meta({ status: "done", total: 3 })]), "es"), ["Ninguna activa"]);
  assert.deepEqual(metasLineaTexto(metasLinea([meta()]), "es"), ["1 activa"], "no tasks yet: no «0 de 0»");
});

test("Inicio draws the line, not the board, and «Nueva» opens the dialog in place", () => {
  const src = readFileSync(new URL("../ui/src/components/goals/goals-board.tsx", import.meta.url), "utf8");
  const home = src.slice(src.indexOf("export function GoalsHome"), src.indexOf("export function GoalsProject"));
  assert.match(home, /metasLinea\(goals\)/);
  assert.doesNotMatch(home, /GoalsBlock|GoalList|GoalCard/);
  assert.match(home, /<GoalDialog open=\{open\} goal=\{null\}/);
  assert.match(home, /onClick=\{\(\) => setOpen\(true\)\}/);
});
