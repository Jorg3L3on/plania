// NEWPROJ-6: what the project's Ajustes view says and checks before sending (GET/PUT /api/company/projects/:slug/settings,
// src/api/project-settings.ts). Plain Spanish, pure, tested without a browser (test/newproj-6-settings.test.ts).
// The server checks everything again; these only keep a button off while a field cannot be right.
import { githubWords, type CodigoOpcion } from "./nuevo-proyecto.js";
import { avanzadoError, type ArranqueRead, type AvanzadoRead } from "./ajustes-avanzado.js";

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

export const SECCIONES = {
  codigo: { titulo: "Dónde está el código", texto: "De esta carpeta parte cada paso de Taller. Al cambiarla, la reviso antes de guardar." },
  lanzamiento: {
    titulo: "El paso a producción",
    texto: "La fusión que solo tú haces: de la rama de prueba a la rama publicada. Plania te muestra qué lleva y el comando, o la fusiona contigo desde Bandeja.",
  },
  pruebas: { titulo: "Lo que QA comprueba", texto: "Un comando por línea. QA los corre en orden en cada entrega; si uno falla, la entrega vuelve a Taller." },
  vista: { titulo: "Vista previa y planes", texto: "Dónde ves la app corriendo, y si un plan del PO espera tu «Sí, empiecen»." },
  contexto: { titulo: "Contexto del equipo", texto: "Tres notas que cada corrida lee al empezar. Se crean de una plantilla y se editan aquí." },
} as const;

export const LANZAMIENTO_CAMPOS = {
  from: { label: "Rama de prueba", hint: "La que recibe lo que aceptas." },
  into: { label: "Rama publicada", hint: "La que se publica." },
  env: { label: "Nombre del entorno", hint: "En minúsculas, por ejemplo prod." },
  merge: { label: "Fusionar desde Plania", hint: "Apagado: Plania te da el comando para correrlo tú." },
} as const;

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
export function comandosAviso(cmds: string[]): string | null {
  if (cmds.length > 8) return "Caben 8 comandos como máximo.";
  if (cmds.some((c) => c.length > 300)) return "Cada comando cabe en 300 caracteres.";
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

export const CONTEXTO: Record<AjustesContextoId, { titulo: string; para: string }> = {
  glossary: { titulo: "Glosario", para: "Las palabras del proyecto y lo que significan aquí." },
  commands: { titulo: "Comandos", para: "Cómo instalar, correr y probar el proyecto, y qué se ve cuando funcionó." },
  map: { titulo: "Mapa", para: "Dónde está cada cosa en el código." },
};

/** One line on a context doc: missing, empty, or how long it is. */
export function contextoEstado(c: Pick<AjustesContexto, "doc_id" | "markdown">): string {
  if (!c.doc_id) return "No existe todavía.";
  const lines = c.markdown.trim() ? c.markdown.trim().split("\n").length : 0;
  if (lines === 0) return "Existe, pero está vacío: el equipo no lo lee.";
  return lines === 1 ? "Existe: 1 línea." : `Existe: ${lines} líneas.`;
}

export const GUARDADO = "Guardado.";

/** The refusal line for any save in the view: the server's code and detail, or null when no answer came back. */
export function ajustesError(code: string | null, detail: Record<string, unknown> = {}): string {
  const folder = typeof detail.path === "string" && detail.path ? `la carpeta ${detail.path}` : "esa carpeta";
  const nuevo = avanzadoError(code, detail);
  if (nuevo) return nuevo;
  switch (code) {
    // PLA-I2-5: the fix is «Preparar el código» or «Crear la rama de trabajo», just below in the same block.
    case "REPO_FOLDER_MISSING":
      return `No se guardó: ${folder} no existe en esta máquina. Revisa la ruta, o créala con «Preparar el código».`;
    case "REPO_NOT_GIT":
      return `No se guardó: ${folder} tiene archivos pero no es un repositorio. Plania no toca una carpeta con archivos: elige la carpeta del código o una vacía.`;
    case "REPO_NO_ORIGIN":
      return `No se guardó: ${folder} no está conectada a GitHub. «Preparar el código» crea su repositorio en GitHub con tu cuenta.`;
    case "REPO_ORIGIN_UNREACHABLE":
      return `No se guardó: no pude leer el repositorio en GitHub de ${folder}. Revisa en «Qué le falta» (en Máquina) que GitHub tenga la sesión iniciada.`;
    case "REPO_NO_START_BRANCH":
      return "No se guardó: el repositorio en GitHub no tiene la rama de trabajo. «Crear la rama de trabajo» la crea desde la rama principal.";
    case "REPO_GITHUB_NO_GH":
    case "REPO_GITHUB_SIGNED_OUT":
    case "REPO_GITHUB_NOT_FOUND":
    case "REPO_GITHUB_NO_WRITE":
    case "REPO_GITHUB_FAILED":
      return githubWords(code)!;
    case "STALE_VERSION":
      return "No se guardó: esto cambió mientras lo editabas. Recarga para ver lo último y vuelve a hacer tu cambio.";
    case "DOC_EXISTS":
      return "No se guardó: esta nota ya existe. Recarga para editarla.";
    case "DOC_NOT_FOUND":
      return "No se guardó: esa nota ya no está. Recarga la página.";
    case "PROJECT_NOT_FOUND":
      return "No se guardó: el proyecto ya no está.";
    case "INVALID_FILTER":
      if (typeof detail.field === "string" && detail.field.startsWith("settings.release")) return "No se guardó: revisa las ramas (deben ser distintas) y el nombre del entorno.";
      if (typeof detail.field === "string" && detail.field.startsWith("settings.qa")) return "No se guardó: revisa los comandos (hasta 8, de 300 caracteres cada uno).";
      return "No se guardó: algún valor no es válido.";
    case "INVALID_BODY":
      if (detail.field === "github_repo") return "No se guardó: el repositorio de GitHub se escribe como dueño/nombre.";
      if (detail.field === "repo_path") return "No se guardó: la carpeta va con su ruta completa, empezando con / o con ~/.";
      if (detail.field === "no_code") return "No se guardó: elige solo una opción para el código.";
      return "No se guardó: algún valor no es válido.";
    case null:
      return "No se guardó: no hubo respuesta. Si la Mac está dormida, intenta al despertar.";
    default:
      return "No se guardó. Recarga la página y vuelve a intentar.";
  }
}
