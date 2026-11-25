// PLA-I2-10: the words of La corriente's stream (components/corriente/stream.tsx), in both languages (lib/i18n.ts).
// No "@/" imports: a test reads this file with node directly.
import { defineWords } from "./i18n.js";

/** The new-project button's data-control: an identifier, not words (kept here so the screen holds no Spanish). */
export const NEW_PROJECT_CONTROL = "nuevo-proyecto";

export const STREAM_WORDS = defineWords({
  es: {
    inColumn: (n: number, column: string) => `${n} en ${column}`,
    working: "trabajando",
    nobodyWorks: "nadie trabaja",
    more: (n: number) => `y ${n} más`,
    inReview: (n: number) => `${n} en revisión`,
    paused: "en pausa",
    seatWorks: (seat: string, key: string | null) => `${seat} trabaja ${key ?? "ahora"}`,
    next: (key: string) => `sigue ${key}`,
    noNext: "sin paso siguiente",
    pausedLane: "En pausa: nada arranca aquí.",
    resuming: "Reanudando…",
    resume: "Reanudar",
    now: "Ahora",
    totals: { revision: "En revisión", open: "Abiertos", done: "Hechos" },
    streamAria: "La corriente: el trabajo de cada proyecto por etapa",
    noProjects: "Todavía no hay proyectos.",
    newProject: "+ Agregar proyecto",
  },
  en: {
    inColumn: (n: number, column: string) => `${n} in ${column}`,
    working: "working",
    nobodyWorks: "nobody working",
    more: (n: number) => `and ${n} more`,
    inReview: (n: number) => `${n} in review`,
    paused: "paused",
    seatWorks: (seat: string, key: string | null) => (key ? `${seat} works on ${key}` : `${seat} is working now`),
    next: (key: string) => `next: ${key}`,
    noNext: "no next step",
    pausedLane: "Paused: nothing starts here.",
    resuming: "Resuming…",
    resume: "Resume",
    now: "Now",
    totals: { revision: "In review", open: "Open", done: "Done" },
    streamAria: "La corriente: each project's work by stage",
    noProjects: "No projects yet.",
    newProject: "+ Add project",
  },
});
