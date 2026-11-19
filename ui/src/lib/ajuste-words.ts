// PLA-I2-10: the words of Pedir ajuste (ui/src/components/corriente/ajuste.tsx).
import { defineWords } from "./i18n.js";

export const AJUSTE_WORDS = defineWords({
  es: {
    title: "Pedir ajuste a Taller",
    marks: (n: number) => `Van tus ${n} ${n === 1 ? "marca" : "marcas"}, cada una con su foto.`,
    placeholder: "Qué cambiarías, para Taller (opcional)",
    noteLabel: "Nota para Taller",
    send: "Enviar a Taller",
    cancel: "Cancelar",
  },
  en: {
    title: "Ask Taller for changes",
    marks: (n: number) => `Your ${n} ${n === 1 ? "mark goes" : "marks go"} along, each with its picture.`,
    placeholder: "What you would change, for Taller (optional)",
    noteLabel: "Note for Taller",
    send: "Send to Taller",
    cancel: "Cancel",
  },
});
