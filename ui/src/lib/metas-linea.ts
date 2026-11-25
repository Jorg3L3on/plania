// Inicio's goals as one line (components/goals/goals-board.tsx GoalsHome): how many company goals are active and how
// far their work went. The cards themselves live on the goals screen. Pure and relative imports only, so the node
// tests load it (test/metas-linea.test.ts).
import { defineWords, getLanguage, words, type Language } from "./i18n.js";

export const METAS_LINEA_WORDS = defineWords({
  es: {
    activas: (n: number) => `${n} ${n === 1 ? "activa" : "activas"}`,
    tareas: (done: number, total: number) => `${done} de ${total} ${total === 1 ? "tarea hecha" : "tareas hechas"}`,
    sinMetas: "Sin metas todavía",
    sinActivas: "Ninguna activa",
    nueva: "Nueva",
    // The main goal (D) and its initiatives as segments (E).
    tareasDe: (done: number, total: number) => `${done} de ${total} ${total === 1 ? "tarea" : "tareas"}`,
    para: (dia: string) => `para el ${dia}`,
    segmento: { hecha: (n: number) => `${n} ${n === 1 ? "hecha" : "hechas"}`, enCurso: (n: number) => `${n} en curso`, porEmpezar: (n: number) => `${n} por empezar` },
    iniciativas: (hechas: number, total: number) => `${hechas} de ${total} ${total === 1 ? "iniciativa hecha" : "iniciativas hechas"}`,
    yMas: (n: number) => `y ${n} más`,
  },
  en: {
    activas: (n: number) => `${n} active`,
    tareas: (done: number, total: number) => `${done} of ${total} ${total === 1 ? "task done" : "tasks done"}`,
    sinMetas: "No goals yet",
    sinActivas: "None active",
    nueva: "New",
    tareasDe: (done: number, total: number) => `${done} of ${total} ${total === 1 ? "task" : "tasks"}`,
    para: (dia: string) => `by ${dia}`,
    segmento: { hecha: (n: number) => `${n} done`, enCurso: (n: number) => `${n} in progress`, porEmpezar: (n: number) => `${n} not started` },
    iniciativas: (hechas: number, total: number) => `${hechas} of ${total} ${total === 1 ? "initiative done" : "initiatives done"}`,
    yMas: (n: number) => `and ${n} more`,
  },
});

export const metasLineaWords = (language: Language = getLanguage()) => words(METAS_LINEA_WORDS, language);

type MetaLeida = { project: string | null; status: string; progress: { done: number; total: number } };

/**
 * The company's goals (no project) that are active, and the tasks of their initiatives, done out of all. The board
 * already rolls each goal's children into its progress, so the top goals' sums count every task once. Done and
 * dropped goals are left out.
 */
export function metasLinea(goals: readonly MetaLeida[]): { hay: boolean; activas: number; done: number; total: number } {
  const empresa = goals.filter((g) => g.project === null);
  const activas = empresa.filter((g) => g.status === "active");
  return {
    hay: empresa.length > 0,
    activas: activas.length,
    done: activas.reduce((n, g) => n + g.progress.done, 0),
    total: activas.reduce((n, g) => n + g.progress.total, 0),
  };
}

/** The line's words after «Metas»: none yet, none active, or the count and, once there is work, its progress. */
export function metasLineaTexto(m: ReturnType<typeof metasLinea>, language: Language = getLanguage()): string[] {
  const w = metasLineaWords(language);
  if (!m.hay) return [w.sinMetas];
  if (m.activas === 0) return [w.sinActivas];
  return m.total > 0 ? [w.activas(m.activas), w.tareas(m.done, m.total)] : [w.activas(m.activas)];
}

type MetaConTitulo = MetaLeida & { id: string; title: string; position: number };

/**
 * The side panel's list (wide screens only): the company's active goals in the board's order, the first `n`, and how
 * many more the goals screen holds.
 */
export function metasPrincipales<T extends MetaConTitulo>(goals: readonly T[], n = 3): { lista: T[]; mas: number } {
  const activas = goals
    .filter((g) => g.project === null && g.status === "active")
    .sort((a, b) => a.position - b.position || a.title.localeCompare(b.title));
  return { lista: activas.slice(0, n), mas: Math.max(0, activas.length - n) };
}

/** A goal's share done, whole percent; never 100 while a task is left, never 0 once one is done. */
export function porcentaje(done: number, total: number): number {
  if (total <= 0) return 0;
  const p = Math.round((done / total) * 100);
  return done < total ? Math.min(99, Math.max(done > 0 ? 1 : 0, p)) : 100;
}

export type Segmento = "hecha" | "enCurso" | "porEmpezar";

type MetaConIniciativas = { initiatives: readonly { key: string; status: string }[]; children?: readonly MetaConIniciativas[] };

const SEGMENTO: Record<string, Segmento> = { Done: "hecha", Active: "enCurso", Shipping: "enCurso", Planning: "porEmpezar", "On hold": "porEmpezar" };
const ORDEN: Segmento[] = ["hecha", "enCurso", "porEmpezar"];

/**
 * One segment per initiative under the goal and its sub-goals (the board rolls their progress up the same way), each
 * once, done first, then in progress, then not started, so the bar fills from the left. Won't do is left out.
 */
export function segmentosMeta(goal: MetaConIniciativas): Segmento[] {
  const vistos = new Map<string, Segmento>();
  const recorrer = (g: MetaConIniciativas) => {
    for (const i of g.initiatives) {
      const s = SEGMENTO[i.status];
      if (s && !vistos.has(i.key)) vistos.set(i.key, s);
    }
    for (const c of g.children ?? []) recorrer(c);
  };
  recorrer(goal);
  return [...vistos.values()].sort((a, b) => ORDEN.indexOf(a) - ORDEN.indexOf(b));
}
