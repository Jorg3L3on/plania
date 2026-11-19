// PLA-I2-5: what «Preparar el código» and «Crear la rama de trabajo» say in Ajustes (src/api/repo-setup.ts). Plain
// Spanish, never a branch name, a code or a terminal step. Pure, tested without a browser.

export type PasoId = "folder" | "git" | "first_commit" | "github" | "push" | "start_branch";
export type PasoEstado = "done" | "already" | "failed" | "pending";
export type Paso = { id: PasoId; state: PasoEstado; code: string | null };
export type Preparacion = { ok: boolean; path: string; github_repo: string | null; steps: Paso[]; failed: string | null };

export const PASO: Record<PasoId, string> = {
  folder: "La carpeta",
  git: "El repositorio en esta máquina",
  first_commit: "El primer registro, vacío",
  github: "El repositorio en GitHub",
  push: "Subirlo a GitHub",
  start_branch: "La rama de trabajo",
};

export const ESTADO: Record<PasoEstado, string> = { done: "hecho", already: "ya estaba", failed: "no se pudo", pending: "falta" };

/** Why a step stopped, and what to do: a button here or the machine page, never a terminal. */
export function porQue(code: string | null): string {
  switch (code) {
    case "REPO_FOLDER_NOT_EMPTY":
      return "La carpeta tiene archivos y no es un repositorio: Plania no la toca. Elige una carpeta vacía, o la del código si ya existe.";
    case "REPO_GIT_FAILED":
      return "git no pudo hacer este paso en la carpeta. Vuelve a intentarlo; lo que ya se hizo se queda.";
    case "REPO_NO_IDENTITY":
      return "git no sabe a nombre de quién registrar y tu cuenta de GitHub no respondió. Revisa en «Qué le falta» (en Máquina) que GitHub tenga la sesión iniciada.";
    case "REPO_NO_ORIGIN":
      return "La carpeta no está conectada a GitHub: marca «Crear su repositorio en GitHub» y vuelve a intentarlo.";
    case "REPO_PUSH_FAILED":
      return "GitHub no aceptó el envío. Revisa que tu cuenta pueda escribir en el repositorio y vuelve a intentarlo.";
    case "REPO_ORIGIN_UNREACHABLE":
      return "No pude leer el repositorio en GitHub. Revisa la conexión y, en «Qué le falta» (en Máquina), que GitHub tenga la sesión iniciada.";
    case "REPO_GITHUB_NO_GH":
      return "GitHub no está instalado en esta máquina. «Qué le falta» (en Máquina) dice cómo instalarlo.";
    case "REPO_GITHUB_SIGNED_OUT":
      return "GitHub no tiene la sesión iniciada en esta máquina. «Qué le falta» (en Máquina) dice cómo entrar.";
    case "REPO_GITHUB_NOT_FOUND":
      return "Tu cuenta de GitHub no encuentra ese repositorio.";
    case "REPO_GITHUB_NO_WRITE":
      return "Tu cuenta de GitHub no puede escribir en ese repositorio.";
    case "REPO_GITHUB_FAILED":
      return "GitHub no respondió. Vuelve a intentarlo en un momento; lo que ya se hizo se queda.";
    default:
      return "Algo no salió. Vuelve a intentarlo; lo que ya se hizo se queda.";
  }
}

/** The line under the steps: all done, or what was done and what is missing. */
export function resumen(p: Preparacion): string {
  if (p.ok) return "El código está listo: la carpeta, su repositorio en GitHub y la rama de trabajo.";
  const failed = p.steps.find((s) => s.state === "failed");
  const hechos = p.steps.filter((s) => s.state === "done").length;
  const falta = failed ? PASO[failed.id].toLowerCase() : "un paso";
  return `${hechos ? "Lo que se hizo se queda. " : ""}Falta ${falta}: ${porQue(p.failed)}`;
}

/** The working branch's answer. */
export function ramaDicho(r: { state: "done" | "already" | "failed"; code: string | null }): string {
  if (r.state === "done") return "Listo: la rama de trabajo ya está en GitHub, creada desde la rama principal.";
  if (r.state === "already") return "La rama de trabajo ya estaba en GitHub.";
  return `No se pudo crear la rama de trabajo. ${porQue(r.code)}`;
}

/** Which actions the block offers, from the code item of the readiness list. */
export function acciones(code: { state: string; why?: string } | undefined, guardado: { no_code: boolean }): { preparar: boolean; rama: boolean } {
  const why = code?.why;
  const preparar = guardado.no_code || why === "REPO_FOLDER_MISSING" || why === "REPO_NO_ORIGIN" || why === "no_code";
  return { preparar, rama: why === "REPO_NO_START_BRANCH" };
}

/** The repository's name on GitHub: the project's slug unless the owner writes another. */
export const NOMBRE_GITHUB = /^[A-Za-z0-9._-]{1,100}$/;
