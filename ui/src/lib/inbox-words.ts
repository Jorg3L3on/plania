// PLA-I2-10: the inbox page's words (Bandeja), in both languages. No "@/" imports.
import { defineWords } from "./i18n.js";

type Tab = { label: string; empty: string };

export const INBOX_PAGE = defineWords({
  es: {
    tabs: {
      decisiones: { label: "Decisiones", empty: "Nada que decidir." },
      pasos: { label: "Pasos", empty: "Ningún paso tuyo pendiente." },
      limpieza: { label: "Limpieza", empty: "La máquina está limpia." },
    } as Record<"decisiones" | "pasos" | "limpieza", Tab>,
    tablist: "Bandeja",
    waits: (wait: string) => `espera ${wait}`,
    parsedTitle: "Leído de una línea «Owner:» del ticket",
    parsed: "del texto",
    question: "Pregunta",
    markSeen: (key: string) => `Marcar como vista ${key}`.trim(),
    seen: "Visto",
    since: (wait: string) => `desde hace ${wait}`,
    markedSeen: (n: number) => (n === 1 ? "1 marcada como vista" : `${n} marcadas como vistas`),
    markFailed: "No se pudo marcar.",
    loadFailed: "No se pudo cargar la bandeja.",
    kicker: "Te toca a ti",
    title: "Bandeja",
    count: (n: number) => (n === 0 ? "Nada espera por ti." : `${n} ${n === 1 ? "cosa espera" : "cosas esperan"} por ti.`),
    delegated: "Respuestas delegadas",
    markAllSeen: "Marcar todas como vistas",
    machine: "Máquina",
  },
  en: {
    tabs: {
      decisiones: { label: "Decisions", empty: "Nothing to decide." },
      pasos: { label: "Steps", empty: "No steps of yours pending." },
      limpieza: { label: "Cleanup", empty: "The machine is clean." },
    },
    tablist: "Inbox",
    waits: (wait: string) => `waiting ${wait}`,
    parsedTitle: "Read from an «Owner:» line in the ticket",
    parsed: "from the text",
    question: "Question",
    markSeen: (key: string) => `Mark as seen ${key}`.trim(),
    seen: "Seen",
    since: (wait: string) => `for ${wait}`,
    markedSeen: (n: number) => (n === 1 ? "1 marked as seen" : `${n} marked as seen`),
    markFailed: "Could not mark it.",
    loadFailed: "The inbox could not be loaded.",
    kicker: "Your turn",
    title: "Inbox",
    count: (n: number) => (n === 0 ? "Nothing is waiting on you." : `${n} ${n === 1 ? "thing is" : "things are"} waiting on you.`),
    delegated: "Delegated answers",
    markAllSeen: "Mark all as seen",
    machine: "Machine",
  },
});
