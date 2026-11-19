// PLA-I3-5 (board «Un paso abierto»): a step opens in a panel beside the list. What the panel says, from what the list
// already has (the row's steps and the ticket's etapa) plus the step's own read for its summary and priority. Pure;
// components/corriente/lado.tsx draws it.
//   head     «PLA-I3-5» · «PASO 2 DE 5» · previous / next (inert at the ends) · Abrir · Cerrar
//   state    the stage word, who holds it and since when («Construyendo» · «Taller · hace 12 min»)
//   espera   the step's reason, or what its tone says when the server gives none
import type { Etapa } from "./api";
import type { Cosa, Cosas, Tramo, TramoTono } from "./cosas";
import { ETAPA_WORD, holderWord, wordOf } from "./etapas";
import { ago } from "./time";

export const LADO_ESPERA = "Qué espera";
export const LADO_ABRIR = "Abrir el paso";
export const LADO_ABRIR_CAP = "Completo: hecho cuando, evidencia, PR e historia.";
export const LADO_KEYS = "← → otro paso · Esc cerrar";
export const LADO_PREV = "Paso anterior";
export const LADO_NEXT = "Paso siguiente";
export const LADO_CLOSE = "Cerrar el paso";
export const LADO_FULL = "Abrir el paso completo";
export const LADO_INICIATIVA = "Iniciativa";
export const LADO_SUELTO = "Paso suelto, sin iniciativa";
export const LADO_PRIORIDAD = "Prioridad";

/** When the server gives no reason: what the step's tone says it waits for. */
export const ESPERA_OF: Record<TramoTono, string> = {
  hecho: "Nada: ya está hecho.",
  vivo: "Que quien lo tiene termine su turno.",
  toca: "Tu decisión.",
  fila: "Su turno: arranca solo cuando le toque.",
  quieto: "Que algo lo destrabe; no se mueve solo.",
};

const PRIORIDAD: Record<string, string> = { P0: "P0 · urgente", P1: "P1 · alta", P2: "P2 · normal", P3: "P3 · baja" };
/** «P1 · alta»; null while the step's read has not arrived. */
export const prioridadWord = (p: string | null | undefined): string => (p ? (PRIORIDAD[p] ?? p) : "Sin prioridad");

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
export function ladoOf(k: string, tramos: readonly Tramo[], etapa: Etapa | null, nowMs = Date.now()): Lado | null {
  const i = tramos.findIndex((t) => t.key === k);
  if (i < 0) return null;
  const t = tramos[i]!;
  const n = tramos.length;
  const word = etapa ? wordOf(etapa) : (t.word ?? ETAPA_WORD[t.etapa] ?? t.etapa);
  const holder = holderWord(etapa?.holder ?? t.holder ?? null);
  const since = etapa?.since ?? t.since ?? null;
  const when = since && t.tono !== "hecho" ? ago(since, nowMs) : null;
  return {
    key: t.key,
    i,
    n,
    pos: `Paso ${i + 1} de ${n}`.toUpperCase(),
    prev: i > 0 ? tramos[i - 1]!.key : null,
    next: i < n - 1 ? tramos[i + 1]!.key : null,
    tono: t.tono,
    word,
    who: [holder, when].filter(Boolean).join(" · ") || null,
    title: t.title,
    espera: etapa?.reason?.trim() || ESPERA_OF[t.tono],
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
