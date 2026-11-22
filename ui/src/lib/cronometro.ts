// PLA-I73-1: the stopwatch on an initiative's «Construcción» tab: where the time went, per step and in total, in the
// owner's words. Pure, tested without a browser (test/i73-cronometro.test.ts).
import { defineWords, words } from "./i18n.js";

export type Tramo = "construye" | "rehace" | "fotos" | "verifica" | "dueno" | "detenido";
export const TRAMOS: Tramo[] = ["construye", "rehace", "fotos", "verifica", "dueno", "detenido"];
export type CronoStep = { key: string; title: string; start: string | null; end: string | null; ms: number; totals: Record<Tramo, number> };
export type Cronometro = { start: string | null; end: string | null; ms: number; before_ms: number | null; totals: Record<Tramo, number>; steps: CronoStep[]; open: boolean };

export const CRONO_WORDS = defineWords({
  es: {
    title: "Dónde se fue el tiempo",
    tramo: { construye: "Taller construye", rehace: "Taller rehace", fotos: "Fotos", verifica: "Plania verifica", dueno: "Esperando tu revisión", detenido: "Detenido" } as Record<Tramo, string>,
    total: (t: string) => `${t} de construcción`,
    running: (t: string) => `${t} hasta ahora`,
    before: (t: string) => `${t} antes, de la idea a «Constrúyelo»`,
    notStarted: "Aún no empieza",
    empty: "Todavía no hay tiempo que medir.",
  },
  en: {
    title: "Where the time went",
    tramo: { construye: "Taller builds", rehace: "Taller redoes", fotos: "Photos", verifica: "Plania checks", dueno: "Waiting for your review", detenido: "Stalled" } as Record<Tramo, string>,
    total: (t: string) => `${t} of building`,
    running: (t: string) => `${t} so far`,
    before: (t: string) => `${t} before, from the idea to «Build it»`,
    notStarted: "Not started yet",
    empty: "No time to measure yet.",
  },
});
const w = () => words(CRONO_WORDS);

/** 3 h 47, 26 min, 40 s. */
export function duracion(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${String(r).padStart(2, "0")}` : `${h} h`;
}

export type CronoBar = { tramo: Tramo; label: string; ms: number; pct: number; text: string };
/** The non-empty pieces of one total, largest first is not wanted: they keep the fixed order of TRAMOS. */
export function barsOf(totals: Record<Tramo, number>): CronoBar[] {
  const sum = TRAMOS.reduce((a, t) => a + (totals[t] ?? 0), 0);
  if (!sum) return [];
  return TRAMOS.filter((t) => (totals[t] ?? 0) > 0).map((t) => ({ tramo: t, label: w().tramo[t], ms: totals[t], pct: Math.round((totals[t] / sum) * 1000) / 10, text: duracion(totals[t]) }));
}

export type CronoView = { headline: string; before: string | null; total: CronoBar[]; steps: { key: string; title: string; text: string; bars: CronoBar[] }[] } | null;
export function cronoView(c: Cronometro | null | undefined): CronoView {
  if (!c || !c.start) return null;
  return {
    headline: c.open ? w().running(duracion(c.ms)) : w().total(duracion(c.ms)),
    before: c.before_ms ? w().before(duracion(c.before_ms)) : null,
    total: barsOf(c.totals),
    steps: c.steps.map((s) => ({ key: s.key, title: s.title, text: s.start ? duracion(s.ms) : w().notStarted, bars: barsOf(s.totals) })),
  };
}
