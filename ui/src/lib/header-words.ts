// PLA-I2-10: the words of the global header (ui/src/components/corriente/header.tsx).
import { defineWords } from "./i18n.js";

export const HEADER_WORDS = defineWords({
  es: {
    company: "Compañía",
    corriente: "Corriente",
    tetoca: "Te toca",
    asistente: "Asistente",
    plomeria: "Plomería",
    brief: "Brief",
    unread: (n: number) => `${n} sin leer`,
    live: "En vivo",
    waiting: (n: number) => (n === 1 ? "1 te espera" : `${n} te esperan`),
    close: "Cerrar",
    pedir: "Pedir",
  },
  en: {
    company: "Company",
    corriente: "Corriente",
    tetoca: "Your turn",
    asistente: "Asistente",
    plomeria: "Plomería",
    brief: "Brief",
    unread: (n: number) => `${n} unread`,
    live: "Live",
    waiting: (n: number) => `${n} waiting on you`,
    close: "Close",
    pedir: "Ask",
  },
});
