// PLA-I68-6: what Publicar reads from Camino's production environment. Only the camino row: no key, no GitHub call.
import { createHash } from "node:crypto";
import type { ReleaseSettings } from "../db/schema.js";
import type { CaminoConfig, CaminoEnv, ProdMigrationsOf } from "./types.js";

// ---- production, as Publicar reads it
/** The environment a release reaches: the one whose record is the release's env, else the production one. */
export function prodEnvOf(config: CaminoConfig, release: ReleaseSettings | undefined | null): CaminoEnv | null {
  const envs = config.envs ?? [];
  return envs.find((e) => release && e.record === release.env) ?? envs.find((e) => e.kind === "produccion") ?? null;
}

/** Who migrates production, from its environment: a step of its own or the build → the deploy; by hand → the
 * owner; no database or never → nobody needs to. Null when no environment says. */
export function prodMigrationsFromEnv(env: CaminoEnv | null): ProdMigrationsOf {
  if (!env) return null;
  if (!env.database || !env.database.provider) return env.database === null ? "none" : null;
  const w = env.database.migrate_when;
  return w === "paso" || w === "build" || w === "llegar" ? "deploy" : w === "mano" ? "owner" : "none";
}

/** The freeze window: Friday from 18:00 (the server's clock). */
export const frozen = (env: CaminoEnv | null, now: Date): boolean => !!env?.freeze && now.getDay() === 5 && now.getHours() >= 18;

// ---- the SQL a release carries
const DESTROYS = [
  /\bdrop\s+(table|schema|database|view|materialized\s+view|type|index)\b[^;]*/gi,
  /\balter\s+table\b[^;]*\bdrop\s+(column|constraint)\b[^;]*/gi,
  /\btruncate\b[^;]*/gi,
  /\bdelete\s+from\b(?![^;]*\bwhere\b)[^;]*/gi,
  /\balter\s+table\b[^;]*\balter\s+(column\s+)?\S+\s+(set\s+data\s+)?type\b[^;]*/gi,
  /\balter\s+table\b[^;]*\brename\b[^;]*/gi,
];
/** The statements of a migration that destroy or reshape existing data, as written. */
export function destructive(sql: string): string[] {
  const clean = sql.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  const out: string[] = [];
  for (const re of DESTROYS) for (const m of clean.matchAll(re)) out.push(m[0]!.replace(/\s+/g, " ").trim().slice(0, 160));
  return [...new Set(out)];
}
export const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

