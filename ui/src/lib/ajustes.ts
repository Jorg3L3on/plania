// NEWPROJ-6: what the project's Ajustes view says and checks before sending (GET/PUT /api/company/projects/:slug/settings,
// src/api/project-settings.ts). Plain Spanish, pure, tested without a browser (test/newproj-6-settings.test.ts).
// The server checks everything again; these only keep a button off while a field cannot be right.
// PLA-I2-10: the words are in AJUSTES_WORDS, in Spanish and English; SECCIONES, LANZAMIENTO_CAMPOS, CONTEXTO and
// GUARDADO stay the Spanish ones (tests read them), and the view reads ajustesWords() for the screen's language.
import { githubWords, type CodigoOpcion } from "./nuevo-proyecto.js";
// PLA-I2-10: re-exported for the Ajustes view, whose import of the module by name read as a Spanish sentence to
// scripts/inline-words.ts.
export { CODIGO_OPCIONES, codigoBody, codigoOpciones, type CodigoOpcion } from "./nuevo-proyecto.js";
import { avanzadoError, type ArranqueRead, type AvanzadoRead } from "./ajustes-avanzado.js";
import { defineWords, getLanguage, words, type Language } from "./i18n.js";

export type AjustesCodigo = { repo_path: string | null; github_repo: string | null; no_code: boolean };
export type AjustesContextoId = "glossary" | "commands" | "map";
export type AjustesContexto = { id: AjustesContextoId; title: string; doc_id: string | null; version: number | null; markdown: string; template: string };
export type Ajustes = {
  slug: string;
  title: string;
  version: number;
  code: AjustesCodigo;
  release: { from: string; into: string; env: string; mode: "command" | "merge" } | null;
  verify: { name: string; command: string }[];
  preview_url: string | null;
  plan_approval: boolean;
  context: AjustesContexto[];
  // PLA-I2-6: «Cómo arranca la app» and «Avanzado» (@/lib/ajustes-avanzado).
  capture: ArranqueRead | null;
  avanzado: AvanzadoRead[];
};

/** Which of the three code choices the saved settings are; null when none was said yet. */
export function codigoDe(c: AjustesCodigo): CodigoOpcion | null {
  if (c.no_code) return "ninguno";
  if (c.repo_path) return "carpeta";
  if (c.github_repo) return "github";
  return null;
}

export const AJUSTES_WORDS = defineWords({
  es: {
    secciones: {
      codigo: { titulo: "Dónde está el código", texto: "De esta carpeta parte cada paso de Taller. Al cambiarla, la reviso antes de guardar." },
      lanzamiento: {
        titulo: "El paso a producción",
        texto: "La fusión que solo tú haces: de la rama de prueba a la rama publicada. Plania te muestra qué lleva y el comando, o la fusiona contigo desde Bandeja.",
      },
      pruebas: { titulo: "Lo que QA comprueba", texto: "Un comando por línea. QA los corre en orden en cada entrega; si uno falla, la entrega vuelve a Taller." },
      vista: { titulo: "Vista previa y planes", texto: "Dónde ves la app corriendo, y si un plan del PO espera tu «Sí, empiecen»." },
      contexto: { titulo: "Contexto del equipo", texto: "Tres notas que cada corrida lee al empezar. Se crean de una plantilla y se editan aquí." },
      // PLA-I3-2: Borrar left the project's bar; it opens from here (the same sheet, which asks for the name and the code).
      borrar: { titulo: "Borrar el proyecto", texto: "Se borra su plan en Plania; su código y su repositorio se quedan. Antes de borrar te pido su nombre y tu código." },
    },
    /** The button of Ajustes' last section, which opens Borrar proyecto's sheet. */
    borrarBoton: (title: string) => `Borrar ${title}`,
    lanzamientoCampos: {
      from: { label: "Rama de prueba", hint: "La que recibe lo que aceptas." },
      into: { label: "Rama publicada", hint: "La que se publica." },
      env: { label: "Nombre del entorno", hint: "En minúsculas, por ejemplo prod." },
      merge: { label: "Fusionar desde Plania", hint: "Apagado: Plania te da el comando para correrlo tú." },
    },
    contexto: {
      glossary: { titulo: "Glosario", para: "Las palabras del proyecto y lo que significan aquí." },
      commands: { titulo: "Comandos", para: "Cómo instalar, correr y probar el proyecto, y qué se ve cuando funcionó." },
      map: { titulo: "Mapa", para: "Dónde está cada cosa en el código." },
    } as Record<AjustesContextoId, { titulo: string; para: string }>,
    guardado: "Guardado.",
    demasiados: "Caben 8 comandos como máximo.",
    muyLargo: "Cada comando cabe en 300 caracteres.",
    noExiste: "No existe todavía.",
    vacio: "Existe, pero está vacío: el equipo no lo lee.",
    lineas: (n: number) => (n === 1 ? "Existe: 1 línea." : `Existe: ${n} líneas.`),
    carpeta: (path: string) => `la carpeta ${path}`,
    esaCarpeta: "esa carpeta",
    folderMissing: (folder: string) => `No se guardó: ${folder} no existe en esta máquina. Revisa la ruta, o créala con «Preparar el código».`,
    notGit: (folder: string) => `No se guardó: ${folder} tiene archivos pero no es un repositorio. Plania no toca una carpeta con archivos: elige la carpeta del código o una vacía.`,
    noOrigin: (folder: string) => `No se guardó: ${folder} no está conectada a GitHub. «Preparar el código» crea su repositorio en GitHub con tu cuenta.`,
    originUnreachable: (folder: string) => `No se guardó: no pude leer el repositorio en GitHub de ${folder}. Revisa en «Qué le falta» (en Máquina) que GitHub tenga la sesión iniciada.`,
    noStartBranch: "No se guardó: el repositorio en GitHub no tiene la rama de trabajo. «Crear la rama de trabajo» la crea desde la rama principal.",
    stale: "No se guardó: esto cambió mientras lo editabas. Recarga para ver lo último y vuelve a hacer tu cambio.",
    docExists: "No se guardó: esta nota ya existe. Recarga para editarla.",
    docNotFound: "No se guardó: esa nota ya no está. Recarga la página.",
    projectNotFound: "No se guardó: el proyecto ya no está.",
    release: "No se guardó: revisa las ramas (deben ser distintas) y el nombre del entorno.",
    qa: "No se guardó: revisa los comandos (hasta 8, de 300 caracteres cada uno).",
    invalid: "No se guardó: algún valor no es válido.",
    githubRepo: "No se guardó: el repositorio de GitHub se escribe como dueño/nombre.",
    repoPath: "No se guardó: la carpeta va con su ruta completa, empezando con / o con ~/.",
    noCode: "No se guardó: elige solo una opción para el código.",
    noAnswer: "No se guardó: no hubo respuesta. Si la máquina está dormida, intenta al despertar.",
    other: "No se guardó. Recarga la página y vuelve a intentar.",
  },
  en: {
    secciones: {
      codigo: { titulo: "Where the code is", texto: "Every Taller step starts from this folder. When you change it, I check it before saving." },
      lanzamiento: {
        titulo: "The step to production",
        texto: "The merge only you make: from the test branch to the published branch. Plania shows you what it carries and the command, or merges it with you from Inbox.",
      },
      pruebas: { titulo: "What QA checks", texto: "One command per line. QA runs them in order on every delivery; if one fails, the delivery goes back to Taller." },
      vista: { titulo: "Preview and plans", texto: "Where you see the app running, and whether a plan from the PO waits for your «Yes, go ahead»." },
      contexto: { titulo: "Team context", texto: "Three notes every run reads when it starts. They are made from a template and edited here." },
      borrar: { titulo: "Delete the project", texto: "Its plan in Plania is deleted; its code and its repository stay. Before deleting I ask for its name and your code." },
    },
    borrarBoton: (title: string) => `Delete ${title}`,
    lanzamientoCampos: {
      from: { label: "Test branch", hint: "The one that gets what you accept." },
      into: { label: "Published branch", hint: "The one that gets published." },
      env: { label: "Environment name", hint: "Lowercase, for example prod." },
      merge: { label: "Merge from Plania", hint: "Off: Plania gives you the command to run it yourself." },
    },
    contexto: {
      glossary: { titulo: "Glossary", para: "The project's words and what they mean here." },
      commands: { titulo: "Commands", para: "How to install, run and test the project, and what you see when it worked." },
      map: { titulo: "Map", para: "Where each thing is in the code." },
    },
    guardado: "Saved.",
    demasiados: "8 commands at most.",
    muyLargo: "Each command fits in 300 characters.",
    noExiste: "It doesn't exist yet.",
    vacio: "It exists, but it is empty: the team doesn't read it.",
    lineas: (n: number) => (n === 1 ? "It exists: 1 line." : `It exists: ${n} lines.`),
    carpeta: (path: string) => `the folder ${path}`,
    esaCarpeta: "that folder",
    folderMissing: (folder: string) => `Not saved: ${folder} doesn't exist on this machine. Check the path, or create it with «Prepare the code».`,
    notGit: (folder: string) => `Not saved: ${folder} has files but is not a repository. Plania doesn't touch a folder with files: choose the code's folder or an empty one.`,
    noOrigin: (folder: string) => `Not saved: ${folder} is not connected to GitHub. «Prepare the code» creates its repository on GitHub with your account.`,
    originUnreachable: (folder: string) => `Not saved: I couldn't read the GitHub repository of ${folder}. Check in «What's missing» (in Machine) that GitHub is signed in.`,
    noStartBranch: "Not saved: the GitHub repository doesn't have the working branch. «Create the working branch» creates it from the main branch.",
    stale: "Not saved: this changed while you were editing it. Reload to see the latest and make your change again.",
    docExists: "Not saved: this note already exists. Reload to edit it.",
    docNotFound: "Not saved: that note is gone. Reload the page.",
    projectNotFound: "Not saved: the project is gone.",
    release: "Not saved: check the branches (they must be different) and the environment name.",
    qa: "Not saved: check the commands (up to 8, of 300 characters each).",
    invalid: "Not saved: some value is not valid.",
    githubRepo: "Not saved: the GitHub repository is written as owner/name.",
    repoPath: "Not saved: the folder goes with its full path, starting with / or ~/.",
    noCode: "Not saved: choose only one option for the code.",
    noAnswer: "Not saved: no answer came back. If the machine is asleep, try again when it wakes.",
    other: "Not saved. Reload the page and try again.",
  },
});

/** The view's words in the screen's language (or the one given). */
export const ajustesWords = (language: Language = getLanguage()) => words(AJUSTES_WORDS, language);

export const SECCIONES = AJUSTES_WORDS.es.secciones;
export const LANZAMIENTO_CAMPOS = AJUSTES_WORDS.es.lanzamientoCampos;
/** PLA-I3-2: the button of Ajustes' last section, which opens Borrar proyecto's sheet. */
export const borrarBoton = (title: string, language: Language = getLanguage()): string => words(AJUSTES_WORDS, language).borrarBoton(title);

// The shapes checkReleaseSettings takes (src/mcp/release-plan.ts).
const BRANCH = /^[A-Za-z0-9._/-]{1,100}$/;
const ENV = /^[a-z][a-z0-9_-]{0,29}$/;
export type LanzamientoForm = { from: string; into: string; env: string; merge: boolean };
/** The release step to send, or null while a field is not right yet. */
export function lanzamientoBody(f: LanzamientoForm): { from: string; into: string; env: string; mode?: "merge" } | null {
  const from = f.from.trim();
  const into = f.into.trim();
  const env = f.env.trim();
  if (!BRANCH.test(from) || !BRANCH.test(into) || from === into || !ENV.test(env)) return null;
  return { from, into, env, ...(f.merge ? { mode: "merge" as const } : {}) };
}

/** The verify list's lines: one command each, blank lines dropped. */
export const comandos = (text: string): string[] =>
  text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

/** Why the list cannot be saved as it is, or null. */
export function comandosAviso(cmds: string[], language: Language = getLanguage()): string | null {
  const w = words(AJUSTES_WORDS, language);
  if (cmds.length > 8) return w.demasiados;
  if (cmds.some((c) => c.length > 300)) return w.muyLargo;
  return null;
}

/** An empty address clears it; otherwise http or https. */
export const vistaPreviaOk = (v: string): boolean => {
  const t = v.trim();
  if (!t) return true;
  if (!/^https?:\/\//.test(t) || t.length > 300) return false;
  try {
    new URL(t);
    return true;
  } catch {
    return false;
  }
};

export const CONTEXTO: Record<AjustesContextoId, { titulo: string; para: string }> = AJUSTES_WORDS.es.contexto;

/** One line on a context doc: missing, empty, or how long it is. */
export function contextoEstado(c: Pick<AjustesContexto, "doc_id" | "markdown">, language: Language = getLanguage()): string {
  const w = words(AJUSTES_WORDS, language);
  if (!c.doc_id) return w.noExiste;
  const lines = c.markdown.trim() ? c.markdown.trim().split("\n").length : 0;
  if (lines === 0) return w.vacio;
  return w.lineas(lines);
}

export const GUARDADO = AJUSTES_WORDS.es.guardado;

/** The refusal line for any save in the view: the server's code and detail, or null when no answer came back. */
export function ajustesError(code: string | null, detail: Record<string, unknown> = {}, language: Language = getLanguage()): string {
  const w = words(AJUSTES_WORDS, language);
  const folder = typeof detail.path === "string" && detail.path ? w.carpeta(detail.path) : w.esaCarpeta;
  const nuevo = avanzadoError(code, detail, language);
  if (nuevo) return nuevo;
  switch (code) {
    // PLA-I2-5: the fix is «Preparar el código» or «Crear la rama de trabajo», just below in the same block.
    case "REPO_FOLDER_MISSING":
      return w.folderMissing(folder);
    case "REPO_NOT_GIT":
      return w.notGit(folder);
    case "REPO_NO_ORIGIN":
      return w.noOrigin(folder);
    case "REPO_ORIGIN_UNREACHABLE":
      return w.originUnreachable(folder);
    case "REPO_NO_START_BRANCH":
      return w.noStartBranch;
    case "REPO_GITHUB_NO_GH":
    case "REPO_GITHUB_SIGNED_OUT":
    case "REPO_GITHUB_NOT_FOUND":
    case "REPO_GITHUB_NO_WRITE":
    case "REPO_GITHUB_FAILED":
      // The GitHub lines are githubWords' (./nuevo-proyecto.ts), shared with the new-project sheet.
      return githubWords(code, "save", language)!;
    case "STALE_VERSION":
      return w.stale;
    case "DOC_EXISTS":
      return w.docExists;
    case "DOC_NOT_FOUND":
      return w.docNotFound;
    case "PROJECT_NOT_FOUND":
      return w.projectNotFound;
    case "INVALID_FILTER":
      if (typeof detail.field === "string" && detail.field.startsWith("settings.release")) return w.release;
      if (typeof detail.field === "string" && detail.field.startsWith("settings.qa")) return w.qa;
      return w.invalid;
    case "INVALID_BODY":
      if (detail.field === "github_repo") return w.githubRepo;
      if (detail.field === "repo_path") return w.repoPath;
      if (detail.field === "no_code") return w.noCode;
      return w.invalid;
    case null:
      return w.noAnswer;
    default:
      return w.other;
  }
}
