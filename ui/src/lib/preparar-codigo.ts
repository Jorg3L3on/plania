// PLA-I2-5: what «Preparar el código» and «Crear la rama de trabajo» say in Ajustes (src/api/repo-setup.ts). Plain
// words, never a branch name, a code or a terminal step. Pure, tested without a browser.
// PLA-I2-10: in both languages (lib/i18n.ts), with the words of the block itself (components/corriente/preparar-codigo.tsx).
// No "@/" imports: a test reads this file with node directly.
import { defineWords, getLanguage, words, type Language } from "./i18n.js";

export type PasoId = "folder" | "git" | "first_commit" | "github" | "push" | "start_branch";
export type PasoEstado = "done" | "already" | "failed" | "pending";
export type Paso = { id: PasoId; state: PasoEstado; code: string | null };
export type Preparacion = { ok: boolean; path: string; github_repo: string | null; steps: Paso[]; failed: string | null };

export const PREPARAR_CODIGO_WORDS = defineWords({
  es: {
    steps: {
      folder: "La carpeta",
      git: "El repositorio en esta máquina",
      first_commit: "El primer registro, vacío",
      github: "El repositorio en GitHub",
      push: "Subirlo a GitHub",
      start_branch: "La rama de trabajo",
    } as Record<PasoId, string>,
    states: { done: "hecho", already: "ya estaba", failed: "no se pudo", pending: "falta" } as Record<PasoEstado, string>,
    why: {
      REPO_FOLDER_NOT_EMPTY: "La carpeta tiene archivos y no es un repositorio: Plania no la toca. Elige una carpeta vacía, o la del código si ya existe.",
      REPO_GIT_FAILED: "git no pudo hacer este paso en la carpeta. Vuelve a intentarlo; lo que ya se hizo se queda.",
      REPO_NO_IDENTITY: "git no sabe a nombre de quién registrar y tu cuenta de GitHub no respondió. Revisa en «Qué le falta» (en Máquina) que GitHub tenga la sesión iniciada.",
      REPO_NO_ORIGIN: "La carpeta no está conectada a GitHub: marca «Crear su repositorio en GitHub» y vuelve a intentarlo.",
      REPO_PUSH_FAILED: "GitHub no aceptó el envío. Revisa que tu cuenta pueda escribir en el repositorio y vuelve a intentarlo.",
      REPO_ORIGIN_UNREACHABLE: "No pude leer el repositorio en GitHub. Revisa la conexión y, en «Qué le falta» (en Máquina), que GitHub tenga la sesión iniciada.",
      REPO_GITHUB_NO_GH: "GitHub no está instalado en esta máquina. «Qué le falta» (en Máquina) dice cómo instalarlo.",
      REPO_GITHUB_SIGNED_OUT: "GitHub no tiene la sesión iniciada en esta máquina. «Qué le falta» (en Máquina) dice cómo entrar.",
      REPO_GITHUB_NOT_FOUND: "Tu cuenta de GitHub no encuentra ese repositorio.",
      REPO_GITHUB_NO_WRITE: "Tu cuenta de GitHub no puede escribir en ese repositorio.",
      REPO_GITHUB_FAILED: "GitHub no respondió. Vuelve a intentarlo en un momento; lo que ya se hizo se queda.",
    } as Record<string, string>,
    whyOther: "Algo no salió. Vuelve a intentarlo; lo que ya se hizo se queda.",
    ready: "El código está listo: la carpeta, su repositorio en GitHub y la rama de trabajo.",
    aStep: "un paso",
    missing: (kept: boolean, step: string, why: string) => `${kept ? "Lo que se hizo se queda. " : ""}Falta ${step}: ${why}`,
    branchDone: "Listo: la rama de trabajo ya está en GitHub, creada desde la rama principal.",
    branchAlready: "La rama de trabajo ya estaba en GitHub.",
    branchFailed: (why: string) => `No se pudo crear la rama de trabajo. ${why}`,
    stale: "Esto cambió mientras lo veías. Recarga y vuelve a intentarlo.",
    intro: "Plania crea la carpeta, su repositorio y la rama de trabajo. Nunca toca una carpeta que ya tiene archivos.",
    folder: "Carpeta en esta máquina (vacía o nueva)",
    folderPlaceholder: "En la carpeta de proyectos, con el nombre del proyecto",
    onGithub: "Crear su repositorio en GitHub con tu cuenta",
    githubName: "Nombre en GitHub",
    private: "Privado",
    badName: "El nombre lleva letras, números, punto, guion o guion bajo.",
    preparing: "Preparando…",
    prepare: "Preparar el código",
    creatingBranch: "Creándola…",
    createBranch: "Crear la rama de trabajo",
    checking: "Revisando…",
    checkAgain: "Revisar de nuevo",
  },
  en: {
    steps: {
      folder: "The folder",
      git: "The repository on this machine",
      first_commit: "The first record, empty",
      github: "The repository on GitHub",
      push: "Uploading it to GitHub",
      start_branch: "The working branch",
    } as Record<PasoId, string>,
    states: { done: "done", already: "already there", failed: "could not be done", pending: "missing" } as Record<PasoEstado, string>,
    why: {
      REPO_FOLDER_NOT_EMPTY: "The folder has files and is not a repository: Plania doesn't touch it. Pick an empty folder, or the code's own if it already exists.",
      REPO_GIT_FAILED: "git could not do this step in the folder. Try again; what was already done stays.",
      REPO_NO_IDENTITY: "git doesn't know whose name to record under and your GitHub account didn't answer. Check in «Qué le falta» (in Máquina) that GitHub is signed in.",
      REPO_NO_ORIGIN: "The folder is not connected to GitHub: tick «Create its repository on GitHub» and try again.",
      REPO_PUSH_FAILED: "GitHub didn't accept the upload. Check that your account can write to the repository and try again.",
      REPO_ORIGIN_UNREACHABLE: "I couldn't read the repository on GitHub. Check the connection and, in «Qué le falta» (in Máquina), that GitHub is signed in.",
      REPO_GITHUB_NO_GH: "GitHub is not installed on this machine. «Qué le falta» (in Máquina) says how to install it.",
      REPO_GITHUB_SIGNED_OUT: "GitHub is not signed in on this machine. «Qué le falta» (in Máquina) says how to sign in.",
      REPO_GITHUB_NOT_FOUND: "Your GitHub account can't find that repository.",
      REPO_GITHUB_NO_WRITE: "Your GitHub account can't write to that repository.",
      REPO_GITHUB_FAILED: "GitHub didn't answer. Try again in a moment; what was already done stays.",
    } as Record<string, string>,
    whyOther: "Something didn't work. Try again; what was already done stays.",
    ready: "The code is ready: the folder, its repository on GitHub and the working branch.",
    aStep: "a step",
    missing: (kept: boolean, step: string, why: string) => `${kept ? "What was done stays. " : ""}Missing ${step}: ${why}`,
    branchDone: "Done: the working branch is now on GitHub, created from the main branch.",
    branchAlready: "The working branch was already on GitHub.",
    branchFailed: (why: string) => `The working branch could not be created. ${why}`,
    stale: "This changed while you were looking. Reload and try again.",
    intro: "Plania creates the folder, its repository and the working branch. It never touches a folder that already has files.",
    folder: "Folder on this machine (empty or new)",
    folderPlaceholder: "In the projects folder, with the project's name",
    onGithub: "Create its repository on GitHub with your account",
    githubName: "Name on GitHub",
    private: "Private",
    badName: "The name takes letters, numbers, dot, hyphen or underscore.",
    preparing: "Preparing…",
    prepare: "Prepare the code",
    creatingBranch: "Creating it…",
    createBranch: "Create the working branch",
    checking: "Checking…",
    checkAgain: "Check again",
  },
});

/** The steps' names, in the screen's language (fixed for the page's life). */
export const PASO: Record<PasoId, string> = words(PREPARAR_CODIGO_WORDS).steps;

/** How each step ended, in the screen's language. */
export const ESTADO: Record<PasoEstado, string> = words(PREPARAR_CODIGO_WORDS).states;

/** Why a step stopped, and what to do: a button here or the machine page, never a terminal. */
export function porQue(code: string | null, language: Language = getLanguage()): string {
  const w = words(PREPARAR_CODIGO_WORDS, language);
  return (code && Object.prototype.hasOwnProperty.call(w.why, code) ? w.why[code] : undefined) ?? w.whyOther;
}

/** The line under the steps: all done, or what was done and what is missing. */
export function resumen(p: Preparacion, language: Language = getLanguage()): string {
  const w = words(PREPARAR_CODIGO_WORDS, language);
  if (p.ok) return w.ready;
  const failed = p.steps.find((s) => s.state === "failed");
  const hechos = p.steps.filter((s) => s.state === "done").length;
  const falta = failed ? w.steps[failed.id].toLowerCase() : w.aStep;
  return w.missing(hechos > 0, falta, porQue(p.failed, language));
}

/** The working branch's answer. */
export function ramaDicho(r: { state: "done" | "already" | "failed"; code: string | null }, language: Language = getLanguage()): string {
  const w = words(PREPARAR_CODIGO_WORDS, language);
  if (r.state === "done") return w.branchDone;
  if (r.state === "already") return w.branchAlready;
  return w.branchFailed(porQue(r.code, language));
}

/** Which actions the block offers, from the code item of the readiness list. */
export function acciones(code: { state: string; why?: string } | undefined, guardado: { no_code: boolean }): { preparar: boolean; rama: boolean } {
  const why = code?.why;
  const preparar = guardado.no_code || why === "REPO_FOLDER_MISSING" || why === "REPO_NO_ORIGIN" || why === "no_code";
  return { preparar, rama: why === "REPO_NO_START_BRANCH" };
}

/** The repository's name on GitHub: the project's slug unless the owner writes another. */
export const NOMBRE_GITHUB = /^[A-Za-z0-9._-]{1,100}$/;
