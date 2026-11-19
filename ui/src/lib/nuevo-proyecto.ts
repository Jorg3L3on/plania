// NEWPROJ-2: what the sheet «Nuevo proyecto» says when the server refuses (POST /company/projects).
// Plain Spanish, never the error code. Pure, so the tests call it directly.
import { seatName } from "./corriente.js";

const list = (names: string[]): string => (names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} y ${names.at(-1)}`);

/** The refusal line: code and detail from the server's reply, or null when the request never got an answer. */
export function nuevoProyectoError(code: string | null, detail: Record<string, unknown> = {}): string {
  if (code === "PROMPT_DOC_MISSING") {
    const raw: unknown[] = Array.isArray(detail.seats) ? detail.seats : [];
    const seats = raw.filter((s): s is string => typeof s === "string").map((s) => seatName(s));
    if (seats.length === 0) return "No se creó nada: falta el texto de instrucciones de algún puesto del equipo.";
    return seats.length === 1
      ? `No se creó nada: ${seats[0]} no tiene su texto de instrucciones.`
      : `No se creó nada: ${list(seats)} no tienen su texto de instrucciones.`;
  }
  if (code === "PROJECT_EXISTS") return "No se creó nada: ya hay un proyecto con ese nombre.";
  if (code === "KEY_PREFIX_TAKEN") return "No se creó nada: esa clave ya es de otro proyecto.";
  // NEWPROJ-3: the folder's checks, one sentence each, saying what to fix.
  const folder = typeof detail.path === "string" && detail.path ? `la carpeta ${detail.path}` : "esa carpeta";
  const branch = typeof detail.branch === "string" && detail.branch ? detail.branch : "sandbox";
  if (code === "REPO_FOLDER_MISSING") return `No se creó nada: ${folder} no existe en esta Mac. Revisa la ruta o elige otra opción.`;
  if (code === "REPO_NOT_GIT") return `No se creó nada: ${folder} no es un repositorio de git. Ábrela en la terminal y corre git init, o elige la carpeta correcta.`;
  if (code === "REPO_NO_ORIGIN") return `No se creó nada: ${folder} no está conectada a GitHub (no tiene origin). Agrégale el repositorio remoto y vuelve a intentar.`;
  if (code === "REPO_ORIGIN_UNREACHABLE") return `No se creó nada: no pude leer el repositorio remoto de ${folder}. Revisa la conexión, la dirección del remoto o tu acceso a GitHub.`;
  if (code === "REPO_NO_START_BRANCH") return `No se creó nada: el repositorio remoto de ${folder} no tiene la rama ${branch}, de donde parte el equipo. Créala y súbela, y vuelve a intentar.`;
  if (code === "INVALID_BODY" && detail.field === "github_repo") return "No se creó nada: el repositorio de GitHub se escribe como dueño/nombre, por ejemplo ana/viajia.";
  if (code === "INVALID_BODY" && detail.field === "repo_path") return "No se creó nada: la carpeta va con su ruta completa, empezando con / o con ~/.";
  if (code === "INVALID_BODY" && detail.field === "no_code") return "No se creó nada: elige solo una opción para el código.";
  if (code === "INVALID_BODY") return "No se creó nada: revisa el nombre y la meta.";
  return "No se pudo crear el proyecto.";
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

// NEWPROJ-3: where the project's code is. A folder on this Mac (with its GitHub repo if there is one), only a GitHub
// repo, or no code yet. The same shapes the server checks (src/runner/repo-check.ts); GitHub is never called.
export type CodigoOpcion = "carpeta" | "github" | "ninguno";
export const CODIGO_OPCIONES: { key: CodigoOpcion; label: string; hint: string }[] = [
  { key: "carpeta", label: "Ya está en esta Mac", hint: "Su carpeta, con git y conectada a GitHub. La reviso antes de crear nada." },
  { key: "github", label: "Está en GitHub", hint: "Se guarda el repositorio; la carpeta se busca en la de proyectos con el nombre del proyecto." },
  { key: "ninguno", label: "Todavía no hay código", hint: "Se crea el proyecto sin código. Máquinas lo dirá hasta que tenga carpeta." },
];
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
