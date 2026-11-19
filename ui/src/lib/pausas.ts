// F6 (first-install audit): a new install's first project has two pauses, the company's and its own. Where both hold,
// the project page and the Reanudar sheet show one button that resumes the two (the project first, then the company,
// so a failure in between leaves the company stopped and nothing running). Words and the rule, tested without a browser.
// No "@/" imports: a test reads this file with node directly.
import { defineWords, getLanguage, words, type Language } from "./i18n.js";

/** Which pause holds a project: both, the company's only, its own only, or none. */
export type Pausa = "ambas" | "compania" | "proyecto" | null;

export function pausaDe(companyPaused: boolean, projectPaused: boolean): Pausa {
  if (companyPaused && projectPaused) return "ambas";
  if (companyPaused) return "compania";
  if (projectPaused) return "proyecto";
  return null;
}

export const PAUSAS_WORDS = defineWords({
  es: {
    ambasAviso: (title: string) => `La compañía y ${title} están en pausa: nada arranca.`,
    ambasBoton: (title: string) => `Reanudar la compañía y ${title}`,
    ambasHecho: (title: string) => `La compañía y ${title} ya están andando`,
    ambasNota: "Este botón reanuda también la compañía, que estaba detenida.",
  },
  en: {
    ambasAviso: (title: string) => `The company and ${title} are paused: nothing starts.`,
    ambasBoton: (title: string) => `Resume the company and ${title}`,
    ambasHecho: (title: string) => `The company and ${title} are running`,
    ambasNota: "This button resumes the company too, which was stopped.",
  },
});

export const pausasWords = (language: Language = getLanguage()) => words(PAUSAS_WORDS, language);
