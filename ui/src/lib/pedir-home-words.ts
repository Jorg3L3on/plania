// PLA-I2-10: the words of Pedir on Inicio, in both languages. The modes' own names and lines live in lib/corriente.ts.
// No "@/" imports: the server and node tests import wording modules directly.
import { defineWords } from "./i18n.js";

export const PEDIR_HOME = defineWords({
  es: {
    sendFailed: "No se pudo enviar. Si la máquina está dormida, intenta al despertar.",
    form: "Pedir",
    whatYouNeed: "Qué necesitas",
    placeholder: "Pedir algo…",
    project: "Proyecto",
    sending: "Enviando…",
    ask: "Preguntar",
    send: "Pedir",
    how: "Cómo",
  },
  en: {
    sendFailed: "Could not send. If the machine is asleep, try again when it wakes up.",
    form: "Ask",
    whatYouNeed: "What you need",
    placeholder: "Ask for something…",
    project: "Project",
    sending: "Sending…",
    ask: "Ask a question",
    send: "Ask",
    how: "How",
  },
});
