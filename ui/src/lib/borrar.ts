// NEWPROJ-7: the words of Borrar proyecto (components/corriente/hoja-borrar.tsx), tested without a browser.
// The sheet says what goes and what stays, asks for the owner's code, and cannot be confirmed by accident: the owner
// types the project's name and a six-digit code before the button turns on.
// PLA-I2-10: the words are in BORRAR_WORDS, in both languages; each function takes the language last.
import { defineWords, getLanguage, words, type Language } from "./i18n.js";

export const BORRAR_WORDS = defineWords({
  es: {
    title: (title: string) => `¿Borrar ${title}?`,
    stopsLabel: "Se detiene",
    stopsNone: "Nada está corriendo ahora.",
    stopsOne: "El agente que está trabajando se detiene antes de borrar.",
    stopsMany: (n: number) => `Los ${n} agentes que están trabajando se detienen antes de borrar.`,
    goesLabel: "Se borra",
    goes: (title: string) => `${title} en Plania: su plan, sus pasos, sus ideas, sus documentos, su historial y su equipo (PO, Research, Artist y Taller).`,
    alsoLabel: "Y además",
    also: "Las copias de trabajo de sus agentes en esta máquina. Lo que no se subió a GitHub se pierde.",
    staysLabel: "Se queda",
    stays: (title: string) => `El código de ${title} y su repositorio, tal cual. Nada se borra en GitHub.`,
    undo: "No se puede deshacer.",
    nameHint: (title: string) => `Escribe «${title}» para confirmar.`,
    pending: "Borrando…",
    button: (title: string) => `Borrar ${title}`,
    codeUnset: "Todavía no hay código del dueño. Configúralo en Plomería y vuelve a intentarlo.",
    codeRequired: "Falta el código del dueño: escríbelo para borrar.",
    codeInvalid: "Ese código no sirve o ya se usó. Espera el siguiente y vuelve a escribirlo.",
    notFound: "Ese proyecto ya no existe.",
    failed: "No se pudo borrar el proyecto. Vuelve a intentarlo.",
    done: (title: string) => `${title} se borró`,
    // The sheet itself (hoja-borrar.tsx).
    sheet: "Borrar proyecto",
    code: "Código del dueño",
    cancel: "Cancelar",
  },
  en: {
    title: (title: string) => `Delete ${title}?`,
    stopsLabel: "Stops",
    stopsNone: "Nothing is running now.",
    stopsOne: "The agent at work stops before the delete.",
    stopsMany: (n: number) => `The ${n} agents at work stop before the delete.`,
    goesLabel: "Deleted",
    goes: (title: string) => `${title} in Plania: its plan, its steps, its ideas, its documents, its history and its team (PO, Research, Artist and Taller).`,
    alsoLabel: "And also",
    also: "Its agents' working copies on this machine. Whatever was not pushed to GitHub is lost.",
    staysLabel: "Stays",
    stays: (title: string) => `${title}'s code and its repository, as they are. Nothing is deleted on GitHub.`,
    undo: "This cannot be undone.",
    nameHint: (title: string) => `Type “${title}” to confirm.`,
    pending: "Deleting…",
    button: (title: string) => `Delete ${title}`,
    codeUnset: "There is no owner's code yet. Set it up in Plomería and try again.",
    codeRequired: "The owner's code is missing: type it to delete.",
    codeInvalid: "That code is wrong or already used. Wait for the next one and type it again.",
    notFound: "That project no longer exists.",
    failed: "The project could not be deleted. Try again.",
    done: (title: string) => `${title} was deleted`,
    sheet: "Delete project",
    code: "Owner's code",
    cancel: "Cancel",
  },
});

export const borrarTitle = (title: string, language: Language = getLanguage()): string => words(BORRAR_WORDS, language).title(title);

export const borrarRows = (title: string, running: number, language: Language = getLanguage()): [string, string][] => {
  const w = words(BORRAR_WORDS, language);
  return [
    [w.stopsLabel, running === 0 ? w.stopsNone : running === 1 ? w.stopsOne : w.stopsMany(running)],
    [w.goesLabel, w.goes(title)],
    [w.alsoLabel, w.also],
    [w.staysLabel, w.stays(title)],
  ];
};

export const borrarUndo = (language: Language = getLanguage()): string => words(BORRAR_WORDS, language).undo;
/** The Spanish sentence, kept for callers that read the constant; the sheet uses borrarUndo(). */
export const BORRAR_UNDO = BORRAR_WORDS.es.undo;

export const nameHint = (title: string, language: Language = getLanguage()): string => words(BORRAR_WORDS, language).nameHint(title);

const fold = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();

/** The typed name matches the project's title (accents, case and extra spaces do not matter). */
export const nameMatches = (typed: string, title: string): boolean => fold(typed) !== "" && fold(typed) === fold(title);

export const canBorrar = (typed: string, title: string, code: string): boolean => nameMatches(typed, title) && /^\d{6}$/.test(code);

export const borrarButton = (title: string, pending: boolean, language: Language = getLanguage()): string => {
  const w = words(BORRAR_WORDS, language);
  return pending ? w.pending : w.button(title);
};

/** One sentence for each refusal of DELETE /company/projects/:slug. */
export function borrarError(code: string, language: Language = getLanguage()): string {
  const w = words(BORRAR_WORDS, language);
  switch (code) {
    case "OWNER_CODE_UNSET":
      return w.codeUnset;
    case "OWNER_CODE_REQUIRED":
      return w.codeRequired;
    case "OWNER_CODE_INVALID":
      return w.codeInvalid;
    case "PROJECT_NOT_FOUND":
      return w.notFound;
    default:
      return w.failed;
  }
}

export const borrarDone = (title: string, language: Language = getLanguage()): string => words(BORRAR_WORDS, language).done(title);
