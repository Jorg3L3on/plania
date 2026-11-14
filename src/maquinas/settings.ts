// PLA-I48-2: projects.settings.maquinas, set with set_project. Every field is optional; the defaults are detected
// from the repo (src/maquinas/detect.ts). Names and commands only: never a value of a variable.
import { z } from "zod";
import type { MaquinasSettings } from "./env.js";

const rel = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine((v) => !v.startsWith("/") && !v.split("/").includes(".."), "a path inside the repo");

export const maquinasSettingsSchema = z
  .object({
    env_file: z.string().trim().regex(/^\.env[A-Za-z0-9._-]*$/, "an env file name such as .env.local").optional(),
    migrate: z.string().trim().min(1).max(300).optional(),
    seed: z.string().trim().min(1).max(300).optional(),
    migrations_dir: rel.optional(),
  })
  .strict();

export function parseMaquinasSettings(v: unknown): { ok: true; settings: MaquinasSettings } | { ok: false; field: string; hint: string } {
  const r = maquinasSettingsSchema.safeParse(v);
  if (r.success) return { ok: true, settings: r.data };
  const issue = r.error.issues[0]!;
  return { ok: false, field: ["settings", "maquinas", ...issue.path].join("."), hint: issue.message };
}
