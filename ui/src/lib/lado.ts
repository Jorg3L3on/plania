// PLA-I3-5 (board «Un paso abierto»): a step opens in a panel beside the list. What the panel says, from what the list
// already has (the row's steps and the ticket's etapa) plus the step's own read for its summary and priority. Pure;
// components/corriente/lado.tsx draws it.
//   head     «PLA-I3-5» · «PASO 2 DE 5» · previous / next (inert at the ends) · Abrir · Cerrar
//   state    the stage word, who holds it and since when («Construyendo» · «Taller · hace 12 min»)
//   espera   the step's reason, or what its tone says when the server gives none
// PLA-I2-10: the words are in LADO_WORDS, in both languages; the Spanish constants keep their names for their readers.
import type { Etapa } from "./api";
import type { Cosa, Cosas, Tramo, TramoTono } from "./cosas";
import { etapaWord, holderWord, wordOf } from "./etapas";
import { defineWords, getLanguage, words, type Language } from "./i18n.js";
import { ago } from "./time";

export const LADO_WORDS = defineWords({
  es: {
    espera: "Qué espera",
    abrir: "Abrir el paso",
    abrirCap: "Completo: hecho cuando, evidencia, PR e historia.",
    keys: "← → otro paso · Esc cerrar",
    prev: "Paso anterior",
    next: "Paso siguiente",
    close: "Cerrar el paso",
    full: "Abrir el paso completo",
    iniciativa: "Iniciativa",
    suelto: "Paso suelto, sin iniciativa",
    prioridad: "Prioridad",
    /** When the server gives no reason: what the step's tone says it waits for. */
    esperaOf: {
      hecho: "Nada: ya está hecho.",
      vivo: "Que quien lo tiene termine su turno.",
      toca: "Tu decisión.",
      fila: "Su turno: arranca solo cuando le toque.",
      quieto: "Que algo lo destrabe; no se mueve solo.",
    } as Record<TramoTono, string>,
    prioridades: { P0: "P0 · urgente", P1: "P1 · alta", P2: "P2 · normal", P3: "P3 · baja" } as Record<string, string>,
    sinPrioridad: "Sin prioridad",
    pos: (i: number, n: number) => `Paso ${i} de ${n}`,
    strip: "Los pasos de la iniciativa",
    reading: "Leyendo el paso",
    readFailed: "No se pudo leer el resumen del paso.",
  },
  en: {
    espera: "What it waits for",
    abrir: "Open the step",
    abrirCap: "In full: done when, evidence, PR and history.",
    keys: "← → another step · Esc close",
    prev: "Previous step",
    next: "Next step",
    close: "Close the step",
    full: "Open the full step",
    iniciativa: "Initiative",
    suelto: "Loose step, no initiative",
    prioridad: "Priority",
    esperaOf: {
      hecho: "Nothing: it is done.",
      vivo: "For whoever has it to finish their turn.",
      toca: "Your decision.",
      fila: "Its turn: it starts by itself when it comes.",
      quieto: "Something to unblock it; it does not move by itself.",
    },
    prioridades: { P0: "P0 · urgent", P1: "P1 · high", P2: "P2 · normal", P3: "P3 · low" },
    sinPrioridad: "No priority",
    pos: (i: number, n: number) => `Step ${i} of ${n}`,
    strip: "The initiative's steps",
    reading: "Reading the step",
    readFailed: "The step's summary could not be read.",
  },
});

/** The panel's words in the screen's language (or the one given). */
export const ladoWords = (language: Language = getLanguage()) => words(LADO_WORDS, language);

export const LADO_ESPERA = LADO_WORDS.es.espera;
export const LADO_ABRIR = LADO_WORDS.es.abrir;
export const LADO_ABRIR_CAP = LADO_WORDS.es.abrirCap;
export const LADO_KEYS = LADO_WORDS.es.keys;
export const LADO_PREV = LADO_WORDS.es.prev;
export const LADO_NEXT = LADO_WORDS.es.next;
export const LADO_CLOSE = LADO_WORDS.es.close;
export const LADO_FULL = LADO_WORDS.es.full;
export const LADO_INICIATIVA = LADO_WORDS.es.iniciativa;
export const LADO_SUELTO = LADO_WORDS.es.suelto;
export const LADO_PRIORIDAD = LADO_WORDS.es.prioridad;

/** When the server gives no reason: what the step's tone says it waits for. */
export const ESPERA_OF: Record<TramoTono, string> = LADO_WORDS.es.esperaOf;

/** «P1 · alta»; null while the step's read has not arrived. */
export const prioridadWord = (p: string | null | undefined, language: Language = getLanguage()): string => {
  const w = words(LADO_WORDS, language);
  return p ? (w.prioridades[p] ?? p) : w.sinPrioridad;
};

export type Lado = {
  key: string;
  /** 0-based place among the initiative's steps, and how many there are. */
  i: number;
  n: number;
  pos: string;
  prev: string | null;
  next: string | null;
  tono: TramoTono;
  word: string;
  /** «Taller · hace 12 min», «hace 3 h», or null when nobody holds it and no time is known. */
  who: string | null;
  title: string;
  espera: string;
};

/** The panel for step k among the row's steps; null when k is not one of them. etapa is the ticket's (for its reason
 *  and holder); without it the Tramo's own words are used. */
export function ladoOf(k: string, tramos: readonly Tramo[], etapa: Etapa | null, nowMs = Date.now(), language: Language = getLanguage()): Lado | null {
  const i = tramos.findIndex((t) => t.key === k);
  if (i < 0) return null;
  const w = words(LADO_WORDS, language);
  const t = tramos[i]!;
  const n = tramos.length;
  const word = etapa ? wordOf(etapa, language) : (t.word ?? etapaWord(t.etapa, language) ?? t.etapa);
  const holder = holderWord(etapa?.holder ?? t.holder ?? null, language);
  const since = etapa?.since ?? t.since ?? null;
  const when = since && t.tono !== "hecho" ? ago(since, nowMs, language) : null;
  return {
    key: t.key,
    i,
    n,
    pos: w.pos(i + 1, n).toUpperCase(),
    prev: i > 0 ? tramos[i - 1]!.key : null,
    next: i < n - 1 ? tramos[i + 1]!.key : null,
    tono: t.tono,
    word,
    who: [holder, when].filter(Boolean).join(" · ") || null,
    title: t.title,
    espera: etapa?.reason?.trim() || w.esperaOf[t.tono],
  };
}

/** ←/→ inside the panel: the step it moves to, or null (at either end, or another key). */
export function ladoMove(key: string, l: Pick<Lado, "prev" | "next">): string | null {
  if (key === "ArrowLeft") return l.prev;
  if (key === "ArrowRight") return l.next;
  return null;
}

/** The row whose thread holds step k (an initiative, or a loose step that is its own only step); null when no open
 *  row has it (a done initiative, a folded-away key, a step of another project). */
export const cosaOfPaso = (cosas: Pick<Cosas, "grupos">, k: string): Cosa | null =>
  cosas.grupos.flatMap((g) => g.cosas).find((c) => c.hilo.tramos.some((t) => t.key === k)) ?? null;
