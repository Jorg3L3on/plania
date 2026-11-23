// PLA-170: which Vercel project Plania reads for a project, and with which key: one rule for the Vercel poller
// (src/jobs/vercel.ts), the GitHub poller's host-status fallback (src/jobs/github.ts) and readiness.
//   vercelTargetOf  settings.vercel, else the Vercel project picked as Camino's production server
//   vercelTokenOf   the key saved in Camino › Conexiones, else the env var (settings.vercel.token_env, default VERCEL_TOKEN)
// Before, only settings.vercel and the env var counted, so a project set up through the screen was never read.
import { caminoKeys, type CaminoKeyStore } from "../camino/keys.js";
import { prodEnvOf } from "../camino/prod.js";
import { caminoRow } from "../camino/store.js";
import type { Db } from "../db/client.js";
import type { Project, ProjectSettings } from "../db/schema.js";

export type VercelTarget = NonNullable<ProjectSettings["vercel"]> & { from: "settings" | "camino" };

/** The Vercel project Plania reads for a project: settings.vercel, else Camino's production server when it is a Vercel
 * project the owner picked. Null when neither says. */
export async function vercelTargetOf(db: Db, p: Project): Promise<VercelTarget | null> {
  const own = p.settings.vercel;
  if (own?.project_id) return { ...own, from: "settings" };
  const env = prodEnvOf((await caminoRow(db, p.id)).config, p.settings.release ?? null);
  const project = env?.server?.provider === "vercel" ? env.server.project?.trim() : null;
  return project ? { project_id: project, from: "camino" } : null;
}

/** The key the reader uses: the one saved in Camino › Conexiones, else the env var (settings.vercel.token_env, default
 * VERCEL_TOKEN). A keychain that cannot be read counts as no saved key. */
export async function vercelTokenOf(p: Pick<Project, "slug">, target: Pick<VercelTarget, "token_env">, deps: { env?: Record<string, string | undefined>; keys?: CaminoKeyStore }): Promise<{ token: string; source: "camino" | "env" } | null> {
  const saved = await (deps.keys ?? caminoKeys()).get(p.slug, "vercel").catch(() => null);
  if (saved) return { token: saved, source: "camino" };
  const fromEnv = (deps.env ?? process.env)[target.token_env ?? "VERCEL_TOKEN"];
  return fromEnv ? { token: fromEnv, source: "env" } : null;
}

/** The poll error a missing key leaves; the GitHub poller and readiness read it. */
export const NO_TOKEN = "no token";
