// PLA-I68-6: Camino's environments, the server side.
//   adapters        one interface per service: what it can do, and the lists Plania picks from with its saved key
//                   (Vercel projects and their variable names, Neon projects and branches, the repo's GitHub Releases).
//                   Services without an adapter stay Manual: the owner's own command and a checklist.
//   prodEnvOf       the production environment a release reaches (its record is settings.release.env)
//   prodMigrations  who migrates production, from that environment (Publicar reads it; F1's setting still wins)
//   destructive     statements that destroy data, so the owner approves the exact file (by its sha256) first
//   sqlReview       squawk's lint of a migration (free; when it is not on this Mac the review says so)
//   frozen          the freeze window: no release on Friday from 18:00
import type { Project } from "../db/schema.js";
import { caminoKeys } from "./keys.js";
import type { HttpFetch } from "./providers.js";
import type { ProviderId } from "./types.js";
import type { GhApi } from "./github.js";

export type ListItem = { id: string; name: string; url?: string | null; note?: string | null };
type Adapter = {
  /** Projects (or apps, or releases) the key opens. */
  list?: (key: string, fetch: HttpFetch, opts: { project?: string; gh?: GhApi | null; repo?: string | null }) => Promise<ListItem[]>;
  /** Variable NAMES an environment has on the service; never their values. */
  vars?: (key: string, fetch: HttpFetch, project: string, target: string | null) => Promise<string[]>;
};

const json = async (fetch: HttpFetch, url: string, key: string): Promise<any> => {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${key}`, Accept: "application/json", "User-Agent": "plania" } });
  if (r.status < 200 || r.status >= 300) throw Object.assign(new Error(`status ${r.status}`), { status: r.status });
  return r.json();
};

export const ADAPTERS: Partial<Record<ProviderId, Adapter>> = {
  vercel: {
    list: async (key, fetch) => {
      const b = await json(fetch, "https://api.vercel.com/v9/projects?limit=50", key);
      return ((b?.projects ?? []) as any[]).map((p) => ({ id: String(p.id), name: String(p.name), url: p.targets?.production?.alias?.[0] ? `https://${p.targets.production.alias[0]}` : null }));
    },
    vars: async (key, fetch, project, target) => {
      // decrypt is never asked: only the keys come back.
      const b = await json(fetch, `https://api.vercel.com/v9/projects/${encodeURIComponent(project)}/env`, key);
      return [...new Set(((b?.envs ?? []) as any[]).filter((e) => !target || (e.target ?? []).includes(target)).map((e) => String(e.key)))];
    },
  },
  neon: {
    list: async (key, fetch, { project }) => {
      if (project) {
        const b = await json(fetch, `https://console.neon.tech/api/v2/projects/${encodeURIComponent(project)}/branches`, key);
        return ((b?.branches ?? []) as any[]).map((x) => ({ id: String(x.id), name: String(x.name), note: x.default ? "default" : null }));
      }
      const b = await json(fetch, "https://console.neon.tech/api/v2/projects?limit=50", key);
      return ((b?.projects ?? []) as any[]).map((p) => ({ id: String(p.id), name: String(p.name), note: p.region_id ?? null }));
    },
  },
  github_releases: {
    list: async (_key, _fetch, { gh, repo }) => {
      if (!gh || !repo) return [];
      const r = await gh.call("GET", `/repos/${repo}/releases?per_page=10`);
      if (r.status !== 200) return [];
      return ((await r.json()) as any[]).map((x) => ({ id: String(x.id), name: String(x.tag_name), url: x.html_url, note: x.prerelease ? "pre" : null }));
    },
  },
};

/** The services Camino can list from (with a saved key, or GitHub's own connection for Releases). */
export const LISTABLE = Object.keys(ADAPTERS) as ProviderId[];

/** PLA-I70-23: the service said no to the key (401/403): that is not «the key opens nothing». */
const refusedBy = (e: unknown): boolean => [401, 403].includes((e as { status?: number } | null)?.status ?? 0);

export async function listFor(p: Project, provider: ProviderId, fetch: HttpFetch, opts: { project?: string; gh?: GhApi | null }): Promise<{ items: ListItem[]; connected: boolean; refused?: boolean }> {
  const a = ADAPTERS[provider];
  if (!a?.list) return { items: [], connected: false };
  if (provider === "github_releases") return { items: await a.list("", fetch, { gh: opts.gh ?? null, repo: p.settings.github?.repo ?? null }).catch(() => []), connected: !!opts.gh };
  const key = await caminoKeys().get(p.slug, provider);
  if (!key) return { items: [], connected: false };
  try {
    return { items: await a.list(key, fetch, { project: opts.project }), connected: true };
  } catch (e) {
    return refusedBy(e) ? { items: [], connected: true, refused: true } : { items: [], connected: true };
  }
}

export async function varsFor(p: Project, provider: ProviderId, fetch: HttpFetch, project: string, target: string | null): Promise<{ names: string[]; connected: boolean; refused?: boolean }> {
  const a = ADAPTERS[provider];
  const key = a?.vars ? await caminoKeys().get(p.slug, provider) : null;
  if (!a?.vars || !key) return { names: [], connected: false };
  try {
    return { names: await a.vars(key, fetch, project, target), connected: true };
  } catch (e) {
    return refusedBy(e) ? { names: [], connected: true, refused: true } : { names: [], connected: true };
  }
}

export { destructive, frozen, prodEnvOf, prodMigrationsFromEnv, sha256 } from "./prod.js";

export { runSquawk, squawkPath, type SqlIssue, type SqlReview } from "./squawk.js";
