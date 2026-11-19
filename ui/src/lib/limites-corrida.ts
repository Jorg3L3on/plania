// PLA-I2-6: the company limits each run meets (runner_settings: max_turns, timeout_minutes, cooldown_minutes), set from
// Plomería (PUT /api/company/settings). Plain Spanish, pure, tested without a browser (test/settings-registry.test.ts).
// The bounds are the route's own (src/api/company.ts Settings); the defaults are the table's (src/db/schema.ts).
// PLA-I2-10: the words are in LIMITES_WORDS, in both languages; the functions that return words take the language last.
import { defineWords, getLanguage, words, type Language } from "./i18n.js";

export type LimiteCorrida = "max_turns" | "timeout_minutes" | "cooldown_minutes";

type LimiteTexto = { label: string; texto: string; unidad: string };

export const LIMITES_WORDS = defineWords({
  es: {
    titulo: "Cada corrida",
    texto: "Los topes de cada corrida de cualquier agente. Los valores de fábrica sirven para empezar.",
    limites: {
      max_turns: { label: "Turnos por corrida", texto: "Cuántas veces puede actuar un agente en una corrida antes de que Plania la corte.", unidad: "turnos" },
      timeout_minutes: { label: "Minutos por corrida", texto: "Cuánto puede durar una corrida antes de que Plania la detenga.", unidad: "minutos" },
      cooldown_minutes: { label: "Descanso entre corridas", texto: "Cuántos minutos espera un agente antes de su siguiente corrida. 0: sin descanso.", unidad: "minutos" },
    } as Record<LimiteCorrida, LimiteTexto>,
    aviso: (min: number, max: number, unidad: string) => `Un número entero de ${min} a ${max} ${unidad}.`,
    deFabrica: (n: number, unidad: string) => `De fábrica: ${n} ${unidad}.`,
    guardado: "Guardado",
    noGuardo: "No se pudo guardar",
    guardar: "Guardar",
  },
  en: {
    titulo: "Each run",
    texto: "The caps on every run of any agent. The factory values are fine to start with.",
    limites: {
      max_turns: { label: "Turns per run", texto: "How many times an agent can act in a run before Plania cuts it off.", unidad: "turns" },
      timeout_minutes: { label: "Minutes per run", texto: "How long a run can last before Plania stops it.", unidad: "minutes" },
      cooldown_minutes: { label: "Rest between runs", texto: "How many minutes an agent waits before its next run. 0: no rest.", unidad: "minutes" },
    },
    aviso: (min: number, max: number, unidad: string) => `A whole number from ${min} to ${max} ${unidad}.`,
    deFabrica: (n: number, unidad: string) => `Factory value: ${n} ${unidad}.`,
    guardado: "Saved",
    noGuardo: "Could not save",
    guardar: "Save",
  },
});

const BOUNDS: Record<LimiteCorrida, { min: number; max: number; defecto: number }> = {
  max_turns: { min: 1, max: 500, defecto: 40 },
  timeout_minutes: { min: 1, max: 600, defecto: 45 },
  cooldown_minutes: { min: 0, max: 1440, defecto: 30 },
};

/** Each limit's words and bounds, in the language given (the screen's by default). */
export const limitesCorrida = (language: Language = getLanguage()): Record<LimiteCorrida, LimiteTexto & { min: number; max: number; defecto: number }> => {
  const w = words(LIMITES_WORDS, language).limites;
  return {
    max_turns: { ...w.max_turns, ...BOUNDS.max_turns },
    timeout_minutes: { ...w.timeout_minutes, ...BOUNDS.timeout_minutes },
    cooldown_minutes: { ...w.cooldown_minutes, ...BOUNDS.cooldown_minutes },
  };
};

/** The limits in Spanish (kept for callers that read the bounds and defaults). */
export const LIMITES_CORRIDA = limitesCorrida("es");

export const LIMITES_TITULO = LIMITES_WORDS.es.titulo;
export const LIMITES_TEXTO = LIMITES_WORDS.es.texto;

/** The number to send, or null while the field is not a whole number in range. */
export function limiteValor(k: LimiteCorrida, text: string): number | null {
  const t = text.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  const l = BOUNDS[k];
  return n >= l.min && n <= l.max ? n : null;
}

export const limiteAviso = (k: LimiteCorrida, language: Language = getLanguage()): string => {
  const w = words(LIMITES_WORDS, language);
  return w.aviso(BOUNDS[k].min, BOUNDS[k].max, w.limites[k].unidad);
};

export const deFabrica = (k: LimiteCorrida, language: Language = getLanguage()): string => {
  const w = words(LIMITES_WORDS, language);
  return w.deFabrica(BOUNDS[k].defecto, w.limites[k].unidad);
};
