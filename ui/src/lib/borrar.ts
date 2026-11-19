// NEWPROJ-7: the words of Borrar proyecto (components/corriente/hoja-borrar.tsx), tested without a browser.
// The sheet says what goes and what stays, asks for the owner's code, and cannot be confirmed by accident: the owner
// types the project's name and a six-digit code before the button turns on.

export const borrarTitle = (title: string): string => `¿Borrar ${title}?`;

export const borrarRows = (title: string, running: number): [string, string][] => [
  [
    "Se detiene",
    running === 0 ? "Nada está corriendo ahora." : running === 1 ? "El agente que está trabajando se detiene antes de borrar." : `Los ${running} agentes que están trabajando se detienen antes de borrar.`,
  ],
  ["Se borra", `${title} en Plania: su plan, sus pasos, sus ideas, sus documentos, su historial y su equipo (PO, Research, Artist y Taller).`],
  ["Y además", "Las copias de trabajo de sus agentes en esta máquina. Lo que no se subió a GitHub se pierde."],
  ["Se queda", `El código de ${title} y su repositorio, tal cual. Nada se borra en GitHub.`],
];

export const BORRAR_UNDO = "No se puede deshacer.";

export const nameHint = (title: string): string => `Escribe «${title}» para confirmar.`;

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

export const borrarButton = (title: string, pending: boolean): string => (pending ? "Borrando…" : `Borrar ${title}`);

/** One sentence for each refusal of DELETE /company/projects/:slug. */
export function borrarError(code: string): string {
  switch (code) {
    case "OWNER_CODE_UNSET":
      return "Todavía no hay código del dueño. Configúralo en Plomería y vuelve a intentarlo.";
    case "OWNER_CODE_REQUIRED":
      return "Falta el código del dueño: escríbelo para borrar.";
    case "OWNER_CODE_INVALID":
      return "Ese código no sirve o ya se usó. Espera el siguiente y vuelve a escribirlo.";
    case "PROJECT_NOT_FOUND":
      return "Ese proyecto ya no existe.";
    default:
      return "No se pudo borrar el proyecto. Vuelve a intentarlo.";
  }
}

export const borrarDone = (title: string): string => `${title} se borró`;
