// PLA-I3-2: the words of the project's one bar (components/corriente/strip.tsx) and of the list's head (todo.tsx),
// tested without a browser. The bar carries the way back, the project switcher, the doors with their small counts and
// the project's state; Reanudar lives under the sentence, not in the bar.

/** The project's state at the bar's right: «En marcha» with Pausar beside it, or «En pausa» alone (a label). */
export const barState = (paused: boolean): { label: string; pausar: string | null } => (paused ? { label: "En pausa", pausar: null } : { label: "En marcha", pausar: "Pausar" });

/** The white button under the paused sentence, and the line beside it. */
export const reanudarLabel = (title: string): string => `Reanudar ${title}`;
export const REANUDAR_LINE = "Nada arranca hasta que lo reanudes.";

/** The switcher's name for screen readers, and its menu's. */
export const switcherLabel = (title: string): string => `${title}: cambiar de proyecto`;
export const SWITCHER_MENU = "Proyectos";
/** Said after a project's name in the menu when something waits on the owner there. */
export const TE_ESPERA = ", te espera";

/** Todo's count beside its door: the open things, nothing when there are none. */
export const todoCount = (open: number): string | null => (open > 0 ? `${open} ${open === 1 ? "ABIERTA" : "ABIERTAS"}` : null);

/** Archivo's count beside its door («24 DOCS · 38 PRS»). */
export const archivoCount = (docs: number, prs: number): string => (docs + prs === 0 ? "VACÍO" : `${docs} ${docs === 1 ? "DOC" : "DOCS"} · ${prs} ${prs === 1 ? "PR" : "PRS"}`);

/** Equipo's word beside its door: «EN PAUSA», «2 TRABAJANDO», «4 LIBRES». */
export const teamWord = (members: number, working: number, paused: boolean): string =>
  paused ? "EN PAUSA" : working ? `${working} TRABAJANDO` : `${members} ${members === 1 ? "LIBRE" : "LIBRES"}`;

/** The meta line above the sentence: «Meta · <goal · date>» and its link. */
export type MetaLine = { text: string; missing: boolean; link: string };
export const metaLine = (goal: string | null | undefined, date: string | null | undefined, missing: boolean): MetaLine => ({
  text: [goal ?? "Sin meta todavía", date ?? (goal ? "sin fecha" : null)].filter(Boolean).join(" · "),
  missing,
  link: missing ? "Fijar meta" : "Cambiar meta",
});

/** The pulse's label beside its figure. */
export const pulsoLabel = (days: number): string => `Pasos hechos en ${days} días`;
/** PLA-I3-7: on a phone the pulse is one small line instead of the figure and the bars. */
export const pulsoLine = (total: number, days: number): string => `${total} ${total === 1 ? "paso hecho" : "pasos hechos"} en ${days} días`;
