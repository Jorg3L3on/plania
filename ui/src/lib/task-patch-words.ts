// PLA-I2-10: the words of a status or priority change from the screen (lib/use-task-patch.ts), in both languages.
import { defineWords } from "./i18n.js";

export const TASK_PATCH_WORDS = defineWords({
  es: {
    /** One sentence for each refusal of PATCH /tasks/:key. */
    refused: {
      BLOCKED_REQUIRES_NOTE: "Blocked necesita una nota.",
      INVALID_STATUS: "Ese estado no aplica aquí.",
      INVALID_PRIORITY: "Esa prioridad no aplica aquí.",
      TASK_NOT_FOUND: "La tarea ya no existe.",
      STALE_VERSION: "Cambió mientras la veías. Ya está al día: revisa y vuelve a intentarlo.",
      CHECKS_OPEN: "Quedan puntos del Done when sin cerrar: márcalos o exímelos en la ficha.",
      INITIATIVE_CHILDREN_OPEN: "La iniciativa tiene tickets abiertos; ciérralos primero.",
      HUMAN_ONLY: "Won't do y reabrir piden un motivo.",
    } as Record<string, string>,
    childrenOpen: (keys: string) => `La iniciativa tiene tickets abiertos: ${keys}. Ciérralos primero.`,
    failed: "No se pudo guardar el cambio.",
    stillRunning: (title: string, n: number) => `${title} sigue con ${n === 1 ? "algo corriendo" : `${n} cosas corriendo`}`,
    undo: "Deshacer",
  },
  en: {
    refused: {
      BLOCKED_REQUIRES_NOTE: "Blocked needs a note.",
      INVALID_STATUS: "That status does not apply here.",
      INVALID_PRIORITY: "That priority does not apply here.",
      TASK_NOT_FOUND: "The task no longer exists.",
      STALE_VERSION: "It changed while you were looking. It is up to date now: check it and try again.",
      CHECKS_OPEN: "Some Done when items are still open: tick them or waive them on the card.",
      INITIATIVE_CHILDREN_OPEN: "The initiative has open tickets; close them first.",
      HUMAN_ONLY: "Won't do and reopening need a reason.",
    },
    childrenOpen: (keys: string) => `The initiative has open tickets: ${keys}. Close them first.`,
    failed: "The change could not be saved.",
    stillRunning: (title: string, n: number) => `${title} still has ${n === 1 ? "something running" : `${n} things running`}`,
    undo: "Undo",
  },
});

export const QUESTION_ANSWER_WORDS = defineWords({
  es: {
    savedAsDecision: "Respuesta guardada como decisión",
    saved: "Respuesta guardada",
    failed: "No se pudo guardar la respuesta.",
  },
  en: {
    savedAsDecision: "Answer saved as a decision",
    saved: "Answer saved",
    failed: "The answer could not be saved.",
  },
});
