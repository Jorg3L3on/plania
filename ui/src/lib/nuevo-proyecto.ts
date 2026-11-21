// NEWPROJ-2: what the sheet «Nuevo proyecto» says when the server refuses (POST /company/projects).
// Plain words, never the error code. Pure, so the tests call it directly.
// PLA-I2-10: the words are in NUEVO_PROYECTO_WORDS, in both languages; CODIGO_OPCIONES stays the Spanish one (tests
// read it) and the sheets read codigoOpciones(). Each function takes the language last.
import { seatName } from "./corriente.js";
import { defineWords, getLanguage, words, type Language } from "./i18n.js";

/** How a GitHub refusal starts: the Ajustes view did not save, the sheet did not make the project. */
export type GithubLead = "save" | "create";

export const NUEVO_PROYECTO_WORDS = defineWords({
  es: {
    and: "y",
    seatsNone: "No se creó nada: falta el texto de instrucciones de algún puesto del equipo.",
    seatOne: (seat: string) => `No se creó nada: ${seat} no tiene su texto de instrucciones.`,
    seatsMany: (seats: string) => `No se creó nada: ${seats} no tienen su texto de instrucciones.`,
    projectExists: "No se creó nada: ya hay un proyecto con ese nombre.",
    keyTaken: "No se creó nada: esa clave ya es de otro proyecto.",
    carpeta: (path: string) => `la carpeta ${path}`,
    esaCarpeta: "esa carpeta",
    // PLA-I2-5: no terminal and no branch name: what has no button here is done after creating, from Despliegue (PLA-132)
    // («Preparar el código», «Crear la rama de trabajo»), choosing «Todavía no hay código» for now.
    despues: "Elige «Todavía no hay código» y prepáralo después desde Despliegue.",
    folderMissing: (folder: string, despues: string) => `No se creó nada: ${folder} no existe en esta máquina. Revisa la ruta, o ${despues}`,
    notGit: (folder: string, despues: string) => `No se creó nada: ${folder} tiene archivos pero no es un repositorio. Elige la carpeta del código, o ${despues}`,
    noOrigin: (folder: string, despues: string) => `No se creó nada: ${folder} no está conectada a GitHub. ${despues}`,
    originUnreachable: (folder: string) => `No se creó nada: no pude leer el repositorio en GitHub de ${folder}. Revisa en «Qué le falta» (en Máquina) que GitHub tenga la sesión iniciada.`,
    noStartBranch: (despues: string) => `No se creó nada: el repositorio en GitHub no tiene la rama de trabajo. ${despues}`,
    lead: { save: "No se guardó", create: "No se creó nada" } as Record<GithubLead, string>,
    github: {
      REPO_GITHUB_NO_GH: (lead: string) => `${lead}: GitHub no está instalado en esta máquina. «Qué le falta» (en Máquina) dice cómo instalarlo.`,
      REPO_GITHUB_SIGNED_OUT: (lead: string) => `${lead}: GitHub no tiene la sesión iniciada en esta máquina. «Qué le falta» (en Máquina) dice cómo entrar.`,
      REPO_GITHUB_NOT_FOUND: (lead: string) => `${lead}: tu cuenta de GitHub no encuentra ese repositorio. Revisa el dueño y el nombre.`,
      REPO_GITHUB_NO_WRITE: (lead: string) => `${lead}: tu cuenta de GitHub no puede escribir en ese repositorio. Pide acceso de escritura o usa otro.`,
      REPO_GITHUB_FAILED: (lead: string) => `${lead}: GitHub no respondió. Vuelve a intentar en un momento.`,
    } as Record<string, (lead: string) => string>,
    githubRepo: "No se creó nada: el repositorio de GitHub se escribe como dueño/nombre, por ejemplo ana/mi-proyecto.",
    repoPath: "No se creó nada: la carpeta va con su ruta completa, empezando con / o con ~/.",
    noCode: "No se creó nada: elige solo una opción para el código.",
    invalid: "No se creó nada: revisa el nombre y la meta.",
    other: "No se pudo crear el proyecto.",
    opciones: [
      { key: "carpeta", label: "Ya está en esta máquina", hint: "Su carpeta, con git y conectada a GitHub. La reviso antes de crear nada." },
      { key: "github", label: "Está en GitHub", hint: "Se guarda el repositorio; la carpeta se busca en la de proyectos con el nombre del proyecto." },
      { key: "ninguno", label: "Todavía no hay código", hint: "Se crea el proyecto sin código. Máquinas lo dirá hasta que tenga carpeta." },
    ] as { key: CodigoOpcion; label: string; hint: string }[],
  },
  en: {
    and: "and",
    seatsNone: "Nothing was made: some seat on the team is missing its instructions text.",
    seatOne: (seat: string) => `Nothing was made: ${seat} doesn't have its instructions text.`,
    seatsMany: (seats: string) => `Nothing was made: ${seats} don't have their instructions text.`,
    projectExists: "Nothing was made: there is already a project with that name.",
    keyTaken: "Nothing was made: that key already belongs to another project.",
    carpeta: (path: string) => `the folder ${path}`,
    esaCarpeta: "that folder",
    despues: "Choose «There is no code yet» and prepare it later from Deploy.",
    folderMissing: (folder: string, despues: string) => `Nothing was made: ${folder} doesn't exist on this machine. Check the path, or ${despues}`,
    notGit: (folder: string, despues: string) => `Nothing was made: ${folder} has files but is not a repository. Choose the code's folder, or ${despues}`,
    noOrigin: (folder: string, despues: string) => `Nothing was made: ${folder} is not connected to GitHub. ${despues}`,
    originUnreachable: (folder: string) => `Nothing was made: I couldn't read the GitHub repository of ${folder}. Check in «What's missing» (in Machine) that GitHub is signed in.`,
    noStartBranch: (despues: string) => `Nothing was made: the GitHub repository doesn't have the working branch. ${despues}`,
    lead: { save: "Not saved", create: "Nothing was made" },
    github: {
      REPO_GITHUB_NO_GH: (lead: string) => `${lead}: GitHub is not installed on this machine. «What's missing» (in Machine) says how to install it.`,
      REPO_GITHUB_SIGNED_OUT: (lead: string) => `${lead}: GitHub is not signed in on this machine. «What's missing» (in Machine) says how to sign in.`,
      REPO_GITHUB_NOT_FOUND: (lead: string) => `${lead}: your GitHub account can't find that repository. Check the owner and the name.`,
      REPO_GITHUB_NO_WRITE: (lead: string) => `${lead}: your GitHub account can't write to that repository. Ask for write access or use another.`,
      REPO_GITHUB_FAILED: (lead: string) => `${lead}: GitHub didn't answer. Try again in a moment.`,
    },
    githubRepo: "Nothing was made: the GitHub repository is written as owner/name, for example ana/my-project.",
    repoPath: "Nothing was made: the folder goes with its full path, starting with / or ~/.",
    noCode: "Nothing was made: choose only one option for the code.",
    invalid: "Nothing was made: check the name and the goal.",
    other: "The project could not be made.",
    opciones: [
      { key: "carpeta", label: "It's already on this machine", hint: "Its folder, with git and connected to GitHub. I check it before making anything." },
      { key: "github", label: "It's on GitHub", hint: "The repository is saved; the folder is looked for in the projects folder, by the project's name." },
      { key: "ninguno", label: "There is no code yet", hint: "The project is made with no code. Machines will say so until it has a folder." },
    ],
  },
});

const list = (names: string[], language: Language): string =>
  names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} ${words(NUEVO_PROYECTO_WORDS, language).and} ${names.at(-1)}`;
const lowerFirst = (s: string): string => `${s.charAt(0).toLowerCase()}${s.slice(1)}`;

/** The refusal line: code and detail from the server's reply, or null when the request never got an answer. */
export function nuevoProyectoError(code: string | null, detail: Record<string, unknown> = {}, language: Language = getLanguage()): string {
  const w = words(NUEVO_PROYECTO_WORDS, language);
  if (code === "PROMPT_DOC_MISSING") {
    const raw: unknown[] = Array.isArray(detail.seats) ? detail.seats : [];
    const seats = raw.filter((s): s is string => typeof s === "string").map((s) => seatName(s));
    if (seats.length === 0) return w.seatsNone;
    return seats.length === 1 ? w.seatOne(seats[0]!) : w.seatsMany(list(seats, language));
  }
  if (code === "PROJECT_EXISTS") return w.projectExists;
  if (code === "KEY_PREFIX_TAKEN") return w.keyTaken;
  // NEWPROJ-3: the folder's checks, one sentence each, saying what to fix.
  const folder = typeof detail.path === "string" && detail.path ? w.carpeta(detail.path) : w.esaCarpeta;
  if (code === "REPO_FOLDER_MISSING") return w.folderMissing(folder, lowerFirst(w.despues));
  if (code === "REPO_NOT_GIT") return w.notGit(folder, lowerFirst(w.despues));
  if (code === "REPO_NO_ORIGIN") return w.noOrigin(folder, w.despues);
  if (code === "REPO_ORIGIN_UNREACHABLE") return w.originUnreachable(folder);
  if (code === "REPO_NO_START_BRANCH") return w.noStartBranch(w.despues);
  return githubWords(code, "create", language) ?? restOf(code, detail, language);
}

/** PLA-I2-5: the GitHub choice's check, the same sentences in the sheet and in Ajustes. Null for another code. */
export function githubWords(code: string | null, lead: GithubLead = "save", language: Language = getLanguage()): string | null {
  const w = words(NUEVO_PROYECTO_WORDS, language);
  const line = code && Object.hasOwn(w.github, code) ? w.github[code] : undefined;
  return line ? line(w.lead[lead]) : null;
}

function restOf(code: string | null, detail: Record<string, unknown>, language: Language): string {
  const w = words(NUEVO_PROYECTO_WORDS, language);
  if (code === "INVALID_BODY" && detail.field === "github_repo") return w.githubRepo;
  if (code === "INVALID_BODY" && detail.field === "repo_path") return w.repoPath;
  if (code === "INVALID_BODY" && detail.field === "no_code") return w.noCode;
  if (code === "INVALID_BODY") return w.invalid;
  return w.other;
}

// NEWPROJ-8: the inputs stop where the server does (NEW_PROJECT_NAME_MAX / NEW_PROJECT_GOAL_MAX in
// src/runner/new-project.ts). The screen does not import server code; test/newproj-8-sheet-details.test.ts compares them.
export const NOMBRE_MAX = 40;
export const META_MAX = 280;

// NEWPROJ-8: a mouse-down on the dimmed background closes the creation sheet only while nothing is typed, so a stray
// click never throws text away. Esc and «Cancelar» still close. Pure, so the test drives it with fake events.
export const nuevoProyectoSinTexto = (fields: string[]): boolean => fields.every((f) => !f.trim());
export const fondoMouseDown =
  (closes: boolean, onClose: () => void) =>
  (e: { target: unknown; currentTarget: unknown }): void => {
    if (closes && e.target === e.currentTarget) onClose();
  };

// NEWPROJ-3: where the project's code is. A folder on this machine (with its GitHub repo if there is one), only a GitHub
// repo, or no code yet. The same shapes the server checks (src/runner/repo-check.ts); GitHub is never called.
export type CodigoOpcion = "carpeta" | "github" | "ninguno";
export const CODIGO_OPCIONES: { key: CodigoOpcion; label: string; hint: string }[] = NUEVO_PROYECTO_WORDS.es.opciones;
/** The three choices in the screen's language (or the one given). */
export const codigoOpciones = (language: Language = getLanguage()): { key: CodigoOpcion; label: string; hint: string }[] => words(NUEVO_PROYECTO_WORDS, language).opciones;
const GITHUB_REPO = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;
export const githubRepoOk = (v: string): boolean => GITHUB_REPO.test(v.trim());
export const carpetaOk = (v: string): boolean => {
  const t = v.trim();
  return t.length > 0 && t.length <= 500 && (t.startsWith("/") || t.startsWith("~/") || /^[A-Za-z]:[\\/]/.test(t));
};

export type CodigoBody = { repo_path?: string; github_repo?: string; no_code?: true };
/** What the sheet sends for the choice, or null while the choice is missing or its field is not right yet. */
export function codigoBody(opcion: CodigoOpcion | null, carpeta: string, repo: string): CodigoBody | null {
  if (opcion === "ninguno") return { no_code: true };
  if (opcion === "github") return githubRepoOk(repo) ? { github_repo: repo.trim() } : null;
  if (opcion === "carpeta") {
    if (!carpetaOk(carpeta)) return null;
    if (repo.trim() && !githubRepoOk(repo)) return null;
    return { repo_path: carpeta.trim(), ...(repo.trim() ? { github_repo: repo.trim() } : {}) };
  }
  return null;
}
