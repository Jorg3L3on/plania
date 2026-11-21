// PLA-I3-2: the words of the project's one bar (components/corriente/strip.tsx) and of the list's head (todo.tsx),
// tested without a browser. The bar carries the way back, the project switcher, the doors with their small counts and
// the project's state; Reanudar lives under the sentence, not in the bar.
// PLA-I2-10: the words are in BARRA_WORDS, in both languages. Each function takes the language last (the screen's by
// default); the Spanish constants keep their names for their readers.
import { defineWords, getLanguage, words, type Language } from "./i18n.js";

export const BARRA_WORDS = defineWords({
  es: {
    running: "En marcha",
    paused: "En pausa",
    pausar: "Pausar",
    reanudar: (title: string) => `Reanudar ${title}`,
    reanudarLine: "Nada arranca hasta que lo reanudes.",
    switcherMenu: "Proyectos",
    teEspera: ", te espera",
    todoCount: (open: number) => `${open} ${open === 1 ? "ABIERTA" : "ABIERTAS"}`,
    teamAgents: (n: number) => `${n} ${n === 1 ? "AGENTE" : "AGENTES"}`,
    noGoal: "Sin meta todavía",
    noDate: "sin fecha",
    setGoal: "Fijar meta",
    changeGoal: "Cambiar meta",
    pulsoLabel: (days: number) => `Pasos hechos en ${days} días`,
    pulsoLine: (total: number, days: number) => `${total} ${total === 1 ? "paso hecho" : "pasos hechos"} en ${days} días`,
  },
  en: {
    running: "Running",
    paused: "Paused",
    pausar: "Pause",
    reanudar: (title: string) => `Resume ${title}`,
    reanudarLine: "Nothing starts until you resume it.",
    switcherMenu: "Projects",
    teEspera: ", waiting on you",
    todoCount: (open: number) => `${open} OPEN`,
    teamAgents: (n: number) => `${n} ${n === 1 ? "AGENT" : "AGENTS"}`,
    noGoal: "No goal yet",
    noDate: "no date",
    setGoal: "Set a goal",
    changeGoal: "Change the goal",
    pulsoLabel: (days: number) => `Steps done in ${days} days`,
    pulsoLine: (total: number, days: number) => `${total} ${total === 1 ? "step done" : "steps done"} in ${days} days`,
  },
});

const w = (language: Language) => words(BARRA_WORDS, language);

/** The project's state at the bar's right: «En marcha» with Pausar beside it, or «En pausa» alone (a label). */
export const barState = (paused: boolean, language: Language = getLanguage()): { label: string; pausar: string | null } =>
  paused ? { label: w(language).paused, pausar: null } : { label: w(language).running, pausar: w(language).pausar };

/** The white button under the paused sentence, and the line beside it. */
export const reanudarLabel = (title: string, language: Language = getLanguage()): string => w(language).reanudar(title);
export const reanudarLine = (language: Language = getLanguage()): string => w(language).reanudarLine;
export const REANUDAR_LINE = BARRA_WORDS.es.reanudarLine;

/** The switcher's name for screen readers, and its menu's. */
export const switcherMenu = (language: Language = getLanguage()): string => w(language).switcherMenu;
export const SWITCHER_MENU = BARRA_WORDS.es.switcherMenu;
/** Said after a project's name in the menu when something waits on the owner there. */
export const teEspera = (language: Language = getLanguage()): string => w(language).teEspera;
export const TE_ESPERA = BARRA_WORDS.es.teEspera;

/** A project's chip in the strip on top: its title, and whether something waits on the owner there. */
export const peerTitle = (title: string, waits: boolean, language: Language = getLanguage()): string => (waits ? `${title}${w(language).teEspera}` : title);

/** Todo's count beside its door: the open things, nothing when there are none. */
export const todoCount = (open: number, language: Language = getLanguage()): string | null => (open > 0 ? w(language).todoCount(open) : null);

/** Equipo's word beside its door: «4 AGENTES» (PLA-I71-1: Equipo is about the agents; who works shows on the list). */
export const teamWord = (members: number, language: Language = getLanguage()): string => w(language).teamAgents(members);

/** The meta line above the sentence: «Meta · <goal · date>» and its link. */
export type MetaLine = { text: string; missing: boolean; link: string };
export const metaLine = (goal: string | null | undefined, date: string | null | undefined, missing: boolean, language: Language = getLanguage()): MetaLine => ({
  text: [goal ?? w(language).noGoal, date ?? (goal ? w(language).noDate : null)].filter(Boolean).join(" · "),
  missing,
  link: missing ? w(language).setGoal : w(language).changeGoal,
});

/** The pulse's label beside its figure. */
export const pulsoLabel = (days: number, language: Language = getLanguage()): string => w(language).pulsoLabel(days);
/** PLA-I3-7: on a phone the pulse is one small line instead of the figure and the bars. */
export const pulsoLine = (total: number, days: number, language: Language = getLanguage()): string => w(language).pulsoLine(total, days);
