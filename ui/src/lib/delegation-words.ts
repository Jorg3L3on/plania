// PLA-I2-10: the words of delegated answers (the Delegada badge, the bot's kill switch), a ticket's comments and the
// routine runs, in both languages. No "@/" imports: the server and node tests import wording modules directly.
import { defineWords } from "./i18n.js";

export const DELEGATION = defineWords({
  es: {
    delegated: "Delegada",
    delegatedMark: "«Delegada»",
    botOn: "El bot puede responder por ti",
    botOff: "Solo respondes tú, en esta pantalla",
    changeFailed: "No se pudo cambiar.",
    switchHint: "Encendido por defecto. Apagado, una pregunta solo para ti o una aprobación solo se responde aquí.",
    commentsFailed: "No se pudieron cargar los comentarios.",
    comments: "Comentarios",
    noComments: "Sin comentarios.",
    routineOk: "Hecho",
    routineFail: "Falló",
    routineSkipped: "Omitida",
    routinesFailed: "No se pudieron cargar las rutinas.",
    noRoutines: "Todavía no hay rutinas.",
    routines: "Rutinas",
  },
  en: {
    delegated: "Delegated",
    delegatedMark: "“Delegated”",
    botOn: "The bot can answer for you",
    botOff: "Only you answer, on this screen",
    changeFailed: "Could not change it.",
    switchHint: "On by default. When off, a question only for you or an approval can only be answered here.",
    commentsFailed: "Could not load the comments.",
    comments: "Comments",
    noComments: "No comments.",
    routineOk: "Done",
    routineFail: "Failed",
    routineSkipped: "Skipped",
    routinesFailed: "Could not load the routines.",
    noRoutines: "No routines yet.",
    routines: "Routines",
  },
});
