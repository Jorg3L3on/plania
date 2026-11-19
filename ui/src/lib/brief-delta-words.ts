// PLA-I2-10: the words of the brief's delta (ui/src/components/corriente/brief-delta.tsx). The model's own words
// (the headline, a stream's line) are in brief-delta.ts.
import { defineWords } from "./i18n.js";

export const BRIEF_DELTA_WORDS = defineWords({
  es: {
    kind: { idea: "Idea nueva", next: "Sigue", toca: "Te toca", block: "Bloquea" },
    settled: "Resuelto",
    label: "El brief de hoy: un cauce por proyecto",
    bands: { ideas: "IDEAS", next: "SIGUE", toca: "TE TOCA", settled: "RESUELTO", you: "TÚ" },
    noBrief: "sin brief",
    more: (n: number, name: string) => `${n} más en ${name}`,
    river: (done: number, total: number) => `Resuelto: ${done} de ${total}`,
  },
  en: {
    kind: { idea: "New idea", next: "Next", toca: "Your turn", block: "Blocks" },
    settled: "Settled",
    label: "Today's brief: one stream per project",
    bands: { ideas: "IDEAS", next: "NEXT", toca: "YOUR TURN", settled: "SETTLED", you: "YOU" },
    noBrief: "no brief",
    more: (n: number, name: string) => `${n} more in ${name}`,
    river: (done: number, total: number) => `Settled: ${done} of ${total}`,
  },
});
