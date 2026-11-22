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
  },
  en: {
    activas: (n: number) => `${n} active`,
    tareas: (done: number, total: number) => `${done} of ${total} ${total === 1 ? "task done" : "tasks done"}`,
    sinMetas: "No goals yet",
    sinActivas: "None active",
    nueva: "New",
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
