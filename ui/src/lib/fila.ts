// PLA-I3-3: the row of the project's list (components/corriente/todo.tsx), tested without a browser: the token line
// under an initiative's name, and the counts above the list that filter it.
// PLA-I2-10: the words are in FILA_WORDS, in both languages; numbers follow the screen's locale (lib/locale.ts).
import type { Tokens } from "./api";
import { GRUPO_NAME, grupoName, type Cosas, type Grupo } from "./cosas";
import { defineWords, getLanguage, words, type Language } from "./i18n.js";
import { LOCALE } from "./locale.js";

export const FILA_WORDS = defineWords({
  es: {
    todo: "Todo",
    title: (used: string, read: string, written: string, runs: string) => `Entrada y salida: ${used} · caché leída: ${read} · caché escrita: ${written} (${runs})`,
    runs: (n: number, whole: string) => (n === 1 ? "1 corrida" : `${whole} corridas`),
  },
  en: {
    todo: "All",
    title: (used: string, read: string, written: string, runs: string) => `Input and output: ${used} · cache read: ${read} · cache written: ${written} (${runs})`,
    runs: (n: number, whole: string) => (n === 1 ? "1 run" : `${whole} runs`),
  },
});

// ---- tokens

/** Drops a trailing «.0» so 2.0 reads «2». */
const trim = (x: number) => String(Number(x.toFixed(1)));

/** One figure for what an initiative spent: «0 tokens», «950 tokens», «96 k tokens», «2.4 M tokens». Under ten
 *  thousand and under ten million it keeps one decimal; above, a whole number. The same in both languages. */
export function tokensLabel(n: number): string {
  const v = Math.max(0, Math.round(n));
  if (v < 1000) return `${v} tokens`;
  if (v < 999_500) {
    const k = v / 1000;
    return `${k < 10 ? trim(k) : Math.round(k)} k tokens`;
  }
  const m = v / 1_000_000;
  return `${m < 10 ? trim(m) : Math.round(m)} M tokens`;
}

const whole = (n: number) => new Intl.NumberFormat(LOCALE).format(Math.max(0, Math.round(n)));

/** The split, for the figure's title: the runner keeps input and output as one sum, the prompt cache apart. */
export function tokensTitle(t: Tokens, language: Language = getLanguage()): string {
  const w = words(FILA_WORDS, language);
  return w.title(whole(t.used), whole(t.cache_read), whole(t.cache_write), w.runs(t.runs, whole(t.runs)));
}

// ---- the counts that filter the list

export type Filtro = "todo" | Exclude<Grupo, "hecho">;
export const FILTROS = ["todo", "toca", "mueve", "fila", "quieto"] as const satisfies readonly Filtro[];
/** The Spanish names, kept for their readers; the screen reads filtroName(). */
export const FILTRO_NAME: Record<Filtro, string> = { todo: FILA_WORDS.es.todo, toca: GRUPO_NAME.toca, mueve: GRUPO_NAME.mueve, fila: GRUPO_NAME.fila, quieto: GRUPO_NAME.quieto };
export const filtroName = (f: Filtro, language: Language = getLanguage()): string => (f === "todo" ? words(FILA_WORDS, language).todo : grupoName(f, language));

export type Cuenta = { id: Filtro; label: string; n: number };

/** The row of counts: Todo (every open thing), then each group's. Hecho is a door, counted apart. */
export function cuentasOf(c: Cosas, language: Language = getLanguage()): { cuentas: Cuenta[]; hecho: number } {
  const n = (g: Exclude<Grupo, "hecho">) => c.grupos.find((x) => x.grupo === g)?.cosas.length ?? 0;
  return {
    cuentas: FILTROS.map((id) => ({ id, label: filtroName(id, language), n: id === "todo" ? c.abiertas : n(id) })),
    hecho: c.hecho.iniciativas.length + c.hecho.sueltos,
  };
}

/** The list a count shows: Todo leaves it whole; a group's count keeps only that group (empty or not) and leaves Hecho
 *  and the shelf out. */
export function filtrar(c: Cosas, f: Filtro): Cosas {
  if (f === "todo") return c;
  const grupos = c.grupos.filter((g) => g.grupo === f);
  return {
    ...c,
    grupos,
    hecho: { iniciativas: [], sueltos: 0, ultimo_suelto: null },
    guardadas: 0,
    guardadasList: [],
    abiertas: grupos.reduce((s, g) => s + g.cosas.length, 0),
  };
}

/** The words on a count for screen readers: «Te toca: 2». */
export const cuentaAria = (k: Cuenta): string => `${k.label}: ${k.n}`;
