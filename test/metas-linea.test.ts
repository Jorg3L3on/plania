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

test("the wide panel lists the first three active company goals in the board's order, and how many more", async () => {
  const { metasPrincipales } = await import("../ui/src/lib/metas-linea.js");
  const g = (id: string, position: number, over: Partial<{ project: string | null; status: string }> = {}) => ({ id, title: id, position, project: over.project ?? null, status: over.status ?? "active", progress: { done: 0, total: 0 } });
  const goals = [g("d", 4), g("a", 1), g("x", 0, { status: "done" }), g("p", 0, { project: "zeep" }), g("c", 3), g("b", 2)];
  const r = metasPrincipales(goals);
  assert.deepEqual(r.lista.map((x) => x.id), ["a", "b", "c"]);
  assert.equal(r.mas, 1);
  assert.deepEqual(metasPrincipales([]), { lista: [], mas: 0 });
});

test("La máquina and Metas share one row from xl, the machine wide and Metas a 320px column; they stack below", () => {
  const home = readFileSync(new URL("../ui/src/pages/home.tsx", import.meta.url), "utf8");
  assert.match(home, /ver\.maquina && ver\.metas && "xl:grid-cols-\[minmax\(0,1fr\)_320px\]"/);
  // The row holds both, machine first, so on a phone the projects come before the goals.
  const fila = home.slice(home.indexOf("data-fila-maquina-metas"));
  assert.ok(fila.indexOf("<LaMaquina") < fila.indexOf("<GoalsHome"));
  const src = readFileSync(new URL("../ui/src/components/goals/goals-board.tsx", import.meta.url), "utf8");
  // The main goal and the others' list only where there is room for them; below xl the strip shows the main goal.
  assert.match(src, /<div className="hidden gap-2\.5 xl:grid" data-meta-principal>/);
  assert.match(src, /<ul className="hidden gap-1\.5 border-t pt-3 text-sm xl:grid" data-metas-resto>/);
  assert.match(src, /items-baseline gap-x-3 xl:hidden/);
});

test("the main goal leads: the first active goal, its why in the voice serif, its share and its initiatives as segments", () => {
  const src = readFileSync(new URL("../ui/src/components/goals/goals-board.tsx", import.meta.url), "utf8");
  const home = src.slice(src.indexOf("export function GoalsHome"), src.indexOf("export function GoalsProject"));
  assert.match(home, /const \[principal, \.\.\.resto\] = lista;/);
  assert.match(home, /<MetaPrincipal goal=\{principal\} \/>/);
  const principal = src.slice(src.indexOf("function MetaPrincipal"), src.indexOf("function Barra"));
  assert.match(principal, /font-voice/);
  assert.match(principal, /segmentosMeta\(goal\)/);
  assert.match(principal, /role="img" aria-label=\{l\.iniciativas\(/);
});

test("a goal's share never reads 100 with work left, nor 0 once something is done", async () => {
  const { porcentaje } = await import("../ui/src/lib/metas-linea.js");
  assert.deepEqual([porcentaje(14, 22), porcentaje(0, 5), porcentaje(1, 300), porcentaje(299, 300), porcentaje(4, 4), porcentaje(0, 0)], [64, 0, 1, 99, 100, 0]);
});

test("segments: one per initiative of the goal and its sub-goals, each once, done first; Won't do left out", async () => {
  const { segmentosMeta } = await import("../ui/src/lib/metas-linea.js");
  const i = (key: string, status: string) => ({ key, status });
  const goal = {
    initiatives: [i("A", "Planning"), i("B", "Done"), i("C", "Won't do"), i("D", "Active")],
    children: [{ initiatives: [i("B", "Done"), i("E", "Shipping"), i("F", "On hold")] }],
  };
  assert.deepEqual(segmentosMeta(goal), ["hecha", "enCurso", "enCurso", "porEmpezar", "porEmpezar"]);
  assert.deepEqual(segmentosMeta({ initiatives: [] }), []);
});
