// PLA-I68-3: Camino's change set on the screen. Edits are staged here (one per key, so editing the same thing twice
// keeps one change), counted in the bar by where they apply, reviewed in the server's order (Plania, the services,
// GitHub's API, PRs) and sent together (POST …/camino/apply). Pure, tested without a browser (test/i68-3-codigo.test.ts).
import { defineWords, getLanguage, words, type Language } from "./i18n.js";

export type Dest = "plania" | "proveedor" | "github" | "pr";
export type Change = { kind: string; label: string; [k: string]: unknown };
/** A staged edit: the change sent to the server, where it applies, and the before and after said for the owner. */
export type Staged = { key: string; change: Change; dest: Dest; from: string; to: string; diff?: { path: string; before: string; after: string } | null; /** One plain line per changed field, shown in the review instead of the before → after text. */ lines?: string[]; /** Why it cannot be applied (actionlint's errors). */ blocked?: string | null };

export const DEST_ORDER: Dest[] = ["plania", "proveedor", "github", "pr"];
/** The server's destOf (src/camino/changes.ts), for the kinds the screen stages. */
export function destOf(kind: string, rulesAvailable: boolean): Dest {
  if (["config", "roles", "repo", "folder", "no_code", "release_mode", "start_branch", "github_key_env", "release_rule", "vercel"].includes(kind)) return "plania";
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
      github: (status: number | null): string =>
        status === 404 ? "GitHub no encontró lo que se le pidió (puede haber cambiado o tu llave no lo ve)."
        : status === 401 ? "GitHub rechazó la llave."
        : status === 403 ? "GitHub no deja a esta llave hacer ese cambio (falta permiso)."
        : status === 409 || status === 422 ? "GitHub no aceptó el cambio tal como está."
        : status && status >= 500 ? "GitHub falló al responder. Prueba de nuevo en un momento."
        : status === null ? "No se pudo hablar con GitHub (sin red)."
        : "GitHub rechazó el cambio.",
      CAMINO_NO_GITHUB: "Falta el repositorio o la llave de GitHub.",
      invalid: {
        not_a_clone: "La carpeta elegida no es una copia de este repositorio.",
        other_repo: "La carpeta elegida pertenece a otro repositorio.",
        role_branch: "Esa rama es la publicada o la de integración: no se borra desde aquí.",
        missing_file: "Ese archivo ya no está en el repositorio.",
        missing_base: (b: string) => `La rama ${b || "de destino"} no existe en GitHub. Elige otra en «Repositorio y ramas».`,
      } as Record<string, string | ((b: string) => string)>,
      invalidOther: "El cambio no cuadra con lo que hay ahora. Vuelve a comprobar y revísalo.",
      actionlint: "El flujo tiene errores que GitHub no aceptaría. Corrígelos antes de proponerlo.",
      other: "No se pudo aplicar este cambio.",
      detail: "Detalle",
    },
    keepMine: "Volver a leer y conservar mis cambios",
    kept: "Listo: se volvió a leer el camino y tus cambios siguen en la lista. Revisa y aplica de nuevo.",
    leave: "Tienes cambios sin aplicar. Si sales, se pierden.",
    prOpen: (n: number) => `Propuesta #${n} abierta`,
    prOpened: (n: number) => `Propuesta #${n}`,
    beforeAfter: (from: string, to: string) => `${from} → ${to}`,
    guard: {
      lost: (path: string, names: string) => `Este cambio a ${path} quita o renombra ${names}, que una regla exige: ninguna propuesta se podría fusionar. Cambia primero la prueba exigida.`,
      offImpact: (n: string, names: string) => `Apagar «${n}» deja sin correr ${names}, que una regla exige: ninguna propuesta se podrá fusionar mientras esté apagado.`,
    },
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
      github: (status: number | null): string =>
        status === 404 ? "GitHub could not find what was asked (it may have changed, or your key cannot see it)."
        : status === 401 ? "GitHub refused the key."
        : status === 403 ? "GitHub does not let this key make that change (permission missing)."
        : status === 409 || status === 422 ? "GitHub did not accept the change as it is."
        : status && status >= 500 ? "GitHub failed to answer. Try again in a moment."
        : status === null ? "Could not reach GitHub (no network)."
        : "GitHub refused the change.",
      CAMINO_NO_GITHUB: "The repository or the GitHub key is missing.",
      invalid: {
        not_a_clone: "The chosen folder is not a copy of this repository.",
        other_repo: "The chosen folder belongs to another repository.",
        role_branch: "That branch is the published or integration one: it is not deleted from here.",
        missing_file: "That file is no longer in the repository.",
        missing_base: (b: string) => `The branch ${b || "to land on"} does not exist on GitHub. Pick another in «Repository and branches».`,
      } as Record<string, string | ((b: string) => string)>,
      invalidOther: "The change does not fit what is there now. Check again and review it.",
      actionlint: "The workflow has errors GitHub would not accept. Fix them before proposing it.",
      other: "This change could not be applied.",
      detail: "Detail",
    },
    keepMine: "Read again and keep my changes",
    kept: "Done: the path was read again and your changes are still in the list. Review and apply again.",
    leave: "You have changes that are not applied. If you leave, they are lost.",
    prOpen: (n: number) => `PR #${n} open`,
    prOpened: (n: number) => `PR #${n}`,
    beforeAfter: (from: string, to: string) => `${from} → ${to}`,
    guard: {
      lost: (path: string, names: string) => `This change to ${path} removes or renames ${names}, which a rule requires: no PR could merge. Change the required check first.`,
      offImpact: (n: string, names: string) => `Turning «${n}» off leaves ${names} unrun, which a rule requires: no PR can merge while it is off.`,
    },
  },
});
export const cambiosWords = (language: Language = getLanguage()) => words(CAMBIOS_WORDS, language);

/** Why one change stopped the set, in the owner's words: one sentence, never a code or the service's English. */
export function whyStopped(error: string, detail: Record<string, unknown> = {}, language: Language = getLanguage()): string {
  const w = cambiosWords(language).why;
  if (error === "CAMINO_GITHUB_REFUSED") return w.github(typeof detail.status === "number" ? detail.status : null);
  if (error === "CAMINO_NO_GITHUB") return w.CAMINO_NO_GITHUB;
  if (error === "CAMINO_ACTIONLINT") return w.actionlint;
  if (error === "CAMINO_CHANGE_INVALID") {
    const h = w.invalid[String(detail.reason ?? "")];
    return typeof h === "function" ? h(String(detail.branch ?? "")) : (h ?? w.invalidOther);
  }
  return w.other;
}
/** The service's own words, for the «Detalle» under a refusal (empty when there are none). */
export function whyDetail(error: string, detail: Record<string, unknown> = {}): string {
  if (error === "CAMINO_GITHUB_REFUSED") return String(detail.message ?? "");
  if (error === "CAMINO_ACTIONLINT") return ((detail.errors as { line: number; message: string }[] | undefined) ?? []).map((e) => `${e.line}: ${e.message}`).join(" · ");
  return "";
}
