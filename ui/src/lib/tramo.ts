// PLA-I3-4 (board «La fila, de cerca»): each step of a thread's construction part is a button. What its tooltip says
// and the button's accessible name, from the step alone. Pure; components/corriente/hilo.tsx draws it.
//   key        «PLA-I3-4»
//   pos        «PASO 2 DE 5»
//   title      the step's title (the tooltip wraps it to two lines)
//   state      «Construyendo · Taller · 12 min», «Te toca · 3 h», «Lista para empezar», «Después», «Hecho»
//   hint       «CLIC PARA ABRIRLO»
//   aria       one sentence: «Paso 2 de 5, «Título»: construyendo, Taller, 12 min.»
// PLA-I2-10: the words are in TRAMO_WORDS, in both languages; the Spanish constants keep their names for their readers.
import type { Tramo } from "./cosas";
import { etapaWord, holderWord } from "./etapas";
import { defineWords, getLanguage, words, type Language } from "./i18n.js";
import { span } from "./time";

export const TRAMO_WORDS = defineWords({
  es: {
    hint: "Clic para abrirlo",
    pos: (i: number, n: number) => `Paso ${i} de ${n}`,
    aria: (i: number, n: number, title: string, said: string) => `Paso ${i} de ${n}, «${title}»: ${said}.`,
    cuenta: (done: number, n: number) => `${done} de ${n}`,
    pasos: (cuenta: string, n: number) => `${cuenta} ${n === 1 ? "paso" : "pasos"}`,
    tramosAria: (title: string, cuenta: string, n: number) => `Ver los pasos de «${title}»: ${cuenta} ${n === 1 ? "hecho" : "hechos"}.`,
    lista: "Pasos de la iniciativa",
    cerrar: "Cerrar los pasos",
    /** The steps' toolbar, and its name on a row. */
    steps: "Pasos",
    stepsOf: (title: string) => `Pasos de «${title}»`,
  },
  en: {
    hint: "Click to open it",
    pos: (i: number, n: number) => `Step ${i} of ${n}`,
    aria: (i: number, n: number, title: string, said: string) => `Step ${i} of ${n}, “${title}”: ${said}.`,
    cuenta: (done: number, n: number) => `${done} of ${n}`,
    pasos: (cuenta: string, n: number) => `${cuenta} ${n === 1 ? "step" : "steps"}`,
    tramosAria: (title: string, cuenta: string, _n: number) => `See the steps of “${title}”: ${cuenta} done.`,
    lista: "The initiative's steps",
    cerrar: "Close the steps",
    steps: "Steps",
    stepsOf: (title: string) => `Steps of “${title}”`,
  },
});

/** The words in the screen's language (or the one given). */
export const tramoWords = (language: Language = getLanguage()) => words(TRAMO_WORDS, language);

export type TramoTip = { key: string; pos: string; title: string; state: string; hint: string; aria: string };

export const TRAMO_HINT = TRAMO_WORDS.es.hint;

/** The state line: the stage word; while someone works it, who and for how long; while it waits on the owner, for how
 *  long. A step that only waits its turn, does not move or is done says its word alone. */
export function tramoState(t: Tramo, nowMs = Date.now(), language: Language = getLanguage()): string {
  const word = t.word ?? etapaWord(t.etapa, language) ?? t.etapa;
  const since = t.since ? span(t.since, nowMs, language) : null;
  if (t.tono === "vivo") return [word, holderWord(t.holder ?? null, language), since].filter(Boolean).join(" · ");
  if (t.tono === "toca") return [word, since].filter(Boolean).join(" · ");
  return word;
}

/** The tooltip and the accessible name of step i (0-based) of n. */
export function tramoTip(t: Tramo, i: number, n: number, nowMs = Date.now(), language: Language = getLanguage()): TramoTip {
  const w = words(TRAMO_WORDS, language);
  const state = tramoState(t, nowMs, language);
  const said = state.split(" · ").join(", ");
  return {
    key: t.key,
    pos: w.pos(i + 1, n).toUpperCase(),
    title: t.title,
    state,
    hint: w.hint.toUpperCase(),
    aria: w.aria(i + 1, n, t.title, `${said.charAt(0).toLowerCase()}${said.slice(1)}`),
  };
}

/** The step a row's single tab stop starts on: the first that is not done, else the first. */
export const firstOpen = (ts: readonly Pick<Tramo, "tono">[]): number => Math.max(0, ts.findIndex((t) => t.tono !== "hecho"));

// ---- PLA-I3-7 (the project page on a phone): an initiative's steps are one control on its card («3 de 8» beside the
// segments) that opens a sheet from the foot: «PLA-I3 · 3 DE 8 PASOS», the title, then one row per step (its square,
// title and tramoState) that opens the step.

/** How many of the steps are done, and how many there are. */
export const tramosHechos = (ts: readonly Pick<Tramo, "tono">[]): number => ts.filter((t) => t.tono === "hecho").length;
/** The control's count: «3 de 8». */
export const tramosCuenta = (ts: readonly Pick<Tramo, "tono">[], language: Language = getLanguage()): string => words(TRAMO_WORDS, language).cuenta(tramosHechos(ts), ts.length);
/** The sheet's caps line after the key: «3 DE 8 PASOS». */
export const tramosPos = (ts: readonly Pick<Tramo, "tono">[], language: Language = getLanguage()): string => words(TRAMO_WORDS, language).pasos(tramosCuenta(ts, language), ts.length).toUpperCase();
/** The control's accessible name: «Ver los pasos de «Pagos»: 3 de 8 hechos.» */
export const tramosAria = (title: string, ts: readonly Pick<Tramo, "tono">[], language: Language = getLanguage()): string =>
  words(TRAMO_WORDS, language).tramosAria(title, tramosCuenta(ts, language), ts.length);
/** The sheet's list and its close button. */
export const TRAMOS_LISTA = TRAMO_WORDS.es.lista;
export const TRAMOS_CERRAR = TRAMO_WORDS.es.cerrar;

/** PLA-I3-4: where an arrow key moves the focus inside a row's steps; null when it does not move it. */
export function rovingNext(key: string, i: number, n: number): number | null {
  if (n === 0) return null;
  if (key === "ArrowRight") return Math.min(n - 1, i + 1);
  if (key === "ArrowLeft") return Math.max(0, i - 1);
  if (key === "Home") return 0;
  if (key === "End") return n - 1;
  return null;
}
