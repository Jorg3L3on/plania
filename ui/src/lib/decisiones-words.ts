// PLA-I2-10: the words of the PO's decisions on an idea (ui/src/components/corriente/decisiones.tsx).
import { defineWords } from "./i18n.js";

/** Where a change goes once the idea is past the PO's stop: who has it now and the stop it stays on. */
type Forward = { to: string; stop: string };

export const DECISIONES_WORDS = defineWords({
  es: {
    forward: { research: { to: "a Research", stop: "Investigación" }, design: { to: "a Artist", stop: "Diseño" }, planning: { to: "al PO", stop: "Plan" }, ready: { to: "al PO", stop: "Lista" } } as Record<string, Forward>,
    changeForward: (option: string, f: Forward) => `Si cambias a ${option}, se lo pasamos ${f.to} y la idea sigue en ${f.stop}.`,
    changeBack: (option: string) => `Si cambias a ${option}, la idea vuelve al PO para rehacerla con tu respuesta.`,
    changeTo: (option: string) => `Cambiar a ${option}`,
    decided: (option: string) => `Tú decidiste ${option}.`,
    recommended: (option: string) => ` El PO recomendaba ${option}.`,
    applies: (option: string, why: string) => `Se aplica ${option} si no la cambias. ${why}`,
    quote: (option: string) => `«${option}»`,
    fine: "Así está bien",
    title: "Lo que el PO da por hecho",
    intro: "Son sus dudas, ya con respuesta. La marcada se aplica si no la cambias; nada te espera.",
    recommendedTag: "recomendada",
    whyLabel: "Por qué la cambias (opcional)",
    whyPlaceholder: "¿Por qué? (opcional)",
  },
  en: {
    forward: { research: { to: "to Research", stop: "Research" }, design: { to: "to Artist", stop: "Design" }, planning: { to: "to the PO", stop: "Plan" }, ready: { to: "to the PO", stop: "Ready" } },
    changeForward: (option: string, f: Forward) => `If you change to ${option}, we pass it ${f.to} and the idea stays in ${f.stop}.`,
    changeBack: (option: string) => `If you change to ${option}, the idea goes back to the PO to redo it with your answer.`,
    changeTo: (option: string) => `Change to ${option}`,
    decided: (option: string) => `You decided ${option}.`,
    recommended: (option: string) => ` The PO recommended ${option}.`,
    applies: (option: string, why: string) => `${option} applies unless you change it. ${why}`,
    quote: (option: string) => `“${option}”`,
    fine: "That's fine",
    title: "What the PO takes as given",
    intro: "Its doubts, already answered. The marked one applies unless you change it; nothing waits on you.",
    recommendedTag: "recommended",
    whyLabel: "Why you change it (optional)",
    whyPlaceholder: "Why? (optional)",
  },
});
