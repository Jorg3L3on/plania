// PLA-I68-3: Camino's change set on the screen. Edits are staged here (one per key, so editing the same thing twice
// keeps one change), counted in the bar by where they apply, reviewed in the server's order (Plania, the services,
// GitHub's API, PRs) and sent together (POST …/camino/apply). Pure, tested without a browser (test/i68-3-codigo.test.ts).
import { defineWords, getLanguage, words, type Language } from "./i18n.js";

export type Dest = "plania" | "proveedor" | "github" | "pr";
export type Change = { kind: string; label: string; [k: string]: unknown };
/** A staged edit: the change sent to the server, where it applies, and the before and after said for the owner. */
export type Staged = { key: string; change: Change; dest: Dest; from: string; to: string; diff?: { path: string; before: string; after: string } | null };

export const DEST_ORDER: Dest[] = ["plania", "proveedor", "github", "pr"];
/** The server's destOf (src/camino/changes.ts), for the kinds the screen stages. */
export function destOf(kind: string, rulesAvailable: boolean): Dest {
  if (["config", "roles", "repo", "folder"].includes(kind)) return "plania";
  if (kind === "ruleset") return rulesAvailable ? "github" : "plania";
  if (["file_pr"].includes(kind)) return "pr";
  if (["provider"].includes(kind)) return "proveedor";
  return "github";
}

/** Adds or replaces the edit with the same key; an edit back to where it started drops it. */
export function stageIn(list: Staged[], s: Staged): Staged[] {
  const rest = list.filter((x) => x.key !== s.key);
  return s.from === s.to && !s.diff ? rest : [...rest, s];
}

/** The review's groups, in the order they apply. */
export function groups(list: Staged[]): { dest: Dest; items: Staged[] }[] {
  return DEST_ORDER.map((dest) => ({ dest, items: list.filter((x) => x.dest === dest) })).filter((g) => g.items.length);
}

/** The changes to send, in apply order. */
export const toSend = (list: Staged[]): Change[] => groups(list).flatMap((g) => g.items.map((x) => x.change));

export const counts = (list: Staged[]): Partial<Record<Dest, number>> => Object.fromEntries(DEST_ORDER.map((d) => [d, list.filter((x) => x.dest === d).length]).filter(([, n]) => n));

export const CAMBIOS_WORDS = defineWords({
  es: {
    pending: (n: number) => `${n} ${n === 1 ? "cambio" : "cambios"} sin aplicar`,
    where: { plania: "en Plania", proveedor: "en los servicios", github: "en GitHub", pr: "como propuesta" } as Record<Dest, string>,
    sub: { plania: "se guarda al aplicar", proveedor: "con la llave del servicio", github: "al momento, con tu conexión de GitHub", pr: (b: string) => `nada se escribe en ${b}` },
    discardAll: "Descartar todo",
    review: "Revisar y aplicar",
    reviewTitle: (n: number) => `Revisar ${n} ${n === 1 ? "cambio" : "cambios"}`,
    reviewLead: "En este orden. Si uno falla, los siguientes no se aplican y te digo por qué.",
    discard: "Descartar",
    keepEditing: "Seguir editando",
    apply: (n: number) => `Aplicar ${n} ${n === 1 ? "cambio" : "cambios"}`,
    applying: "Aplicando…",
    close: "Cerrar",
    done: (n: number) => `Listo: ${n} ${n === 1 ? "cambio aplicado" : "cambios aplicados"}. Están en Historial.`,
    stopped: (n: number, why: string) => `${n ? (n === 1 ? "Se aplicó 1. " : `Se aplicaron ${n}. `) : ""}Se detuvo en uno: ${why} Los siguientes no se aplicaron.`,
    skipped: "No se aplicó",
    ok: "Aplicado",
    failed: "Falló",
    stale: "Alguien cambió el camino mientras editabas. Vuelve a leerlo y revisa tus cambios.",
    why: {
      CAMINO_GITHUB_REFUSED: (status: number | null, msg: string) => `GitHub lo rechazó${status ? ` (${status})` : ""}${msg ? `: ${msg}` : ""}.`,
      CAMINO_NO_GITHUB: "Falta el repositorio o la llave de GitHub.",
      CAMINO_CHANGE_INVALID: (field: string) => `El cambio no cuadra (${field}).`,
      other: (code: string, field: string) => `No se pudo (${code}${field ? `: ${field}` : ""}).`,
    },
    beforeAfter: (from: string, to: string) => `${from} → ${to}`,
  },
  en: {
    pending: (n: number) => `${n} ${n === 1 ? "change" : "changes"} not applied`,
    where: { plania: "in Plania", proveedor: "in the services", github: "on GitHub", pr: "as a PR" },
    sub: { plania: "saved when applied", proveedor: "with the service's key", github: "right away, with your GitHub connection", pr: (b: string) => `nothing is written to ${b}` },
    discardAll: "Discard all",
    review: "Review and apply",
    reviewTitle: (n: number) => `Review ${n} ${n === 1 ? "change" : "changes"}`,
    reviewLead: "In this order. If one fails, the rest are not applied and I tell you why.",
    discard: "Discard",
    keepEditing: "Keep editing",
    apply: (n: number) => `Apply ${n} ${n === 1 ? "change" : "changes"}`,
    applying: "Applying…",
    close: "Close",
    done: (n: number) => `Done: ${n} ${n === 1 ? "change applied" : "changes applied"}. They are in History.`,
    stopped: (n: number, why: string) => `${n ? `${n} applied. ` : ""}It stopped at one: ${why} The rest were not applied.`,
    skipped: "Not applied",
    ok: "Applied",
    failed: "Failed",
    stale: "Someone changed the path while you edited. Read it again and check your changes.",
    why: {
      CAMINO_GITHUB_REFUSED: (status: number | null, msg: string) => `GitHub refused it${status ? ` (${status})` : ""}${msg ? `: ${msg}` : ""}.`,
      CAMINO_NO_GITHUB: "The repository or the GitHub key is missing.",
      CAMINO_CHANGE_INVALID: (field: string) => `The change does not fit (${field}).`,
      other: (code: string, field: string) => `It could not be done (${code}${field ? `: ${field}` : ""}).`,
    },
    beforeAfter: (from: string, to: string) => `${from} → ${to}`,
  },
});
export const cambiosWords = (language: Language = getLanguage()) => words(CAMBIOS_WORDS, language);

/** Why one change stopped the set, in the owner's words. */
export function whyStopped(error: string, detail: Record<string, unknown> = {}, language: Language = getLanguage()): string {
  const w = cambiosWords(language).why;
  if (error === "CAMINO_GITHUB_REFUSED") return w.CAMINO_GITHUB_REFUSED((detail.status as number | null) ?? null, String(detail.message ?? ""));
  if (error === "CAMINO_NO_GITHUB") return w.CAMINO_NO_GITHUB;
  if (error === "CAMINO_CHANGE_INVALID") return w.CAMINO_CHANGE_INVALID(String(detail.reason ?? detail.field ?? ""));
  return w.other(error, String(detail.field ?? ""));
}
