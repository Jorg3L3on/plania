// PLA-I2-10: the resume, question cards and decision log's words, in both languages.
// No "@/" imports: the server and node tests import wording modules directly.
import { defineWords } from "./i18n.js";

export const RESUME = defineWords({
  es: {
    inProgress: "En curso",
    next: "Siguiente",
    pinnedRow: "Fijo",
    wholeProject: "Todo el proyecto",
    noContext: "Sin contexto para retomar.",
    otherAnswer: "Otra respuesta",
    answer: "Responder",
    decisionPlaceholder: "Si esto decide algo, una línea para el registro de decisiones (opcional)",
    decision: "Decisión",
    questionsForYou: "Preguntas para ti",
    decisions: "Decisiones",
    pinned: "fija",
    retired: "retirada",
  },
  en: {
    inProgress: "In progress",
    next: "Next",
    pinnedRow: "Pinned",
    wholeProject: "The whole project",
    noContext: "No context to pick up from.",
    otherAnswer: "Another answer",
    answer: "Answer",
    decisionPlaceholder: "If this decides something, one line for the decision log (optional)",
    decision: "Decision",
    questionsForYou: "Questions for you",
    decisions: "Decisions",
    pinned: "pinned",
    retired: "retired",
  },
});
