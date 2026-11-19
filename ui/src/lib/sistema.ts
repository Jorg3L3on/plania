// PLA-I2-4: what the screen says when a part of Plania needs a program this system does not have (Chrome for the
// stills, brew for the base lever, a POSIX shell for the test copy). A plain state, never an error. The server
// imports these words (src/lib/system-support.ts), so this file stays free of "@/" imports.
// PLA-I2-10: in both languages (lib/i18n.ts). NO_DISPONIBLE and NO_DISPONIBLE_POR stay the Spanish, for the server.
import { defineWords, getLanguage, words, type Language } from "./i18n.js";

export const SISTEMA = defineWords({
  es: {
    unavailable: "No disponible en este sistema",
    // The sub-line for each part, under unavailable.
    by: {
      test_copy: "La copia de prueba necesita /bin/sh, que esta máquina no tiene.",
      stills: "Las capturas necesitan Chrome o Chromium en esta máquina.",
      base_lever: "Encender y apagar la base necesita brew o systemd en esta máquina.",
    },
  },
  en: {
    unavailable: "Not available on this system",
    by: {
      test_copy: "The test copy needs /bin/sh, which this machine does not have.",
      stills: "Stills need Chrome or Chromium on this machine.",
      base_lever: "Turning the database on and off needs brew or systemd on this machine.",
    },
  },
});

export const NO_DISPONIBLE = SISTEMA.es.unavailable;

// The sub-line for each part, under NO_DISPONIBLE.
export const NO_DISPONIBLE_POR = SISTEMA.es.by;

export type SystemFeature = keyof typeof NO_DISPONIBLE_POR;

/** The unavailable words in the screen's language. */
export const noDisponible = (language: Language = getLanguage()) => words(SISTEMA, language);
