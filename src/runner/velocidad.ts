// PLA-I73: how building goes fast, with its defaults. Measured on guided test 3: of 200 minutes after «Constrúyelo»,
// Taller built 85; the rest was waiting between steps (photos, the owner's review, stalls). settings.velocidad turns
// each part off for a project; absent, it is on.
import type { ProjectSettings, VelocidadSettings } from "../db/schema.js";
import { ToolError } from "../mcp/errors.js";

export type Velocidad = Required<VelocidadSettings>;
export const VELOCIDAD_DEFAULT: Velocidad = { apilar: true, revision: "por_modulo", carriles: 2, esqueleto_temprano: true, verificar: true };
export const MAX_CARRILES = 4;

export function velocidadOf(s: Pick<ProjectSettings, "velocidad"> | null | undefined): Velocidad {
  const v = s?.velocidad ?? {};
  return {
    apilar: v.apilar ?? VELOCIDAD_DEFAULT.apilar,
    revision: v.revision ?? VELOCIDAD_DEFAULT.revision,
    carriles: Math.max(1, Math.min(MAX_CARRILES, Math.round(v.carriles ?? VELOCIDAD_DEFAULT.carriles))),
    esqueleto_temprano: v.esqueleto_temprano ?? VELOCIDAD_DEFAULT.esqueleto_temprano,
    verificar: v.verificar ?? VELOCIDAD_DEFAULT.verificar,
  };
}

/** Refuses a malformed settings.velocidad (set_project and the screen). */
export function checkVelocidad(v: unknown): void {
  const bad = (field: string, allowed: unknown) => new ToolError("INVALID_FILTER", { field: `settings.velocidad.${field}`, allowed });
  if (v === undefined) return;
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new ToolError("INVALID_FILTER", { field: "settings.velocidad", hint: "an object" });
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (k === "apilar" || k === "esqueleto_temprano" || k === "verificar") {
      if (typeof x !== "boolean") throw bad(k, [true, false]);
    } else if (k === "revision") {
      if (x !== "por_paso" && x !== "por_modulo") throw bad(k, ["por_paso", "por_modulo"]);
    } else if (k === "carriles") {
      if (typeof x !== "number" || !Number.isInteger(x) || x < 1 || x > MAX_CARRILES) throw bad(k, `1 to ${MAX_CARRILES}`);
    } else throw bad(k, ["apilar", "revision", "carriles", "esqueleto_temprano", "verificar"]);
  }
}
