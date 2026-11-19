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
  if (code === "INVALID_BODY") return "No se creó nada: revisa el nombre y la meta.";
  return "No se pudo crear el proyecto.";
}
