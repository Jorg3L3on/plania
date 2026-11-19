// P3 (first-install audit): the machine check runs a short Claude test, about ten seconds. While it runs, the page says
// so instead of showing an empty card (ui/src/pages/falta.tsx, on /primer-arranque/falta and /machine/falta).
// The check's own words stay in lib/falta.ts. No "@/" imports: a test reads this file with node directly.
import { defineWords, getLanguage, words, type Language } from "./i18n.js";

export const REVISANDO_WORDS = defineWords({
  es: { revisando: "Revisando… la prueba de Claude tarda unos segundos." },
  en: { revisando: "Checking… the Claude test takes a few seconds." },
});

export const revisandoLine = (language: Language = getLanguage()): string => words(REVISANDO_WORDS, language).revisando;
