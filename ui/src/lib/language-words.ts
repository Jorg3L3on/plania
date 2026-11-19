// PLA-I2-10: the words of the language switch (Plomería) and the first-start choice.
import { defineWords } from "./i18n.js";

export const LANGUAGE_WORDS = defineWords({
  es: {
    label: "Idioma",
    hint: "La pantalla y el resumen de la mañana.",
    failed: "No se pudo cambiar el idioma.",
    firstStart: "Idioma de Plania",
    firstStartHint: "Lo puedes cambiar después en Plomería.",
  },
  en: {
    label: "Language",
    hint: "The screen and the morning brief.",
    failed: "The language could not be changed.",
    firstStart: "Plania's language",
    firstStartHint: "You can change it later in Plomería.",
  },
});
