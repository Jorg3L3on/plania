// PLA-I3-3: the row of the project's list (components/corriente/todo.tsx), tested without a browser: the token line
// under an initiative's name, and the counts above the list that filter it.
import type { Tokens } from "./api";
import { GRUPO_NAME, type Cosas, type Grupo } from "./cosas";

// ---- tokens

/** Drops a trailing «.0» so 2.0 reads «2». */
const trim = (x: number) => String(Number(x.toFixed(1)));

/** One figure for what an initiative spent: «0 tokens», «950 tokens», «96 k tokens», «2.4 M tokens». Under ten
 *  thousand and under ten million it keeps one decimal; above, a whole number. */
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

const whole = (n: number) => new Intl.NumberFormat("es-MX").format(Math.max(0, Math.round(n)));

/** The split, for the figure's title: the runner keeps input and output as one sum, the prompt cache apart. */
export function tokensTitle(t: Tokens): string {
  const parts = [`Entrada y salida: ${whole(t.used)}`, `caché leída: ${whole(t.cache_read)}`, `caché escrita: ${whole(t.cache_write)}`];
  const runs = t.runs === 1 ? "1 corrida" : `${whole(t.runs)} corridas`;
  return `${parts.join(" · ")} (${runs})`;
}

// ---- the counts that filter the list

export type Filtro = "todo" | Exclude<Grupo, "hecho">;
export const FILTROS = ["todo", "toca", "mueve", "fila", "quieto"] as const satisfies readonly Filtro[];
export const FILTRO_NAME: Record<Filtro, string> = { todo: "Todo", toca: GRUPO_NAME.toca, mueve: GRUPO_NAME.mueve, fila: GRUPO_NAME.fila, quieto: GRUPO_NAME.quieto };

export type Cuenta = { id: Filtro; label: string; n: number };

/** The row of counts: Todo (every open thing), then each group's. Hecho is a door, counted apart. */
export function cuentasOf(c: Cosas): { cuentas: Cuenta[]; hecho: number } {
  const n = (g: Exclude<Grupo, "hecho">) => c.grupos.find((x) => x.grupo === g)?.cosas.length ?? 0;
  return {
    cuentas: FILTROS.map((id) => ({ id, label: FILTRO_NAME[id], n: id === "todo" ? c.abiertas : n(id) })),
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
