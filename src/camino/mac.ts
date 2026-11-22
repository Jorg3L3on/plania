// PLA-I68-2: what Camino reads from this machine. Files only (no git process): whether the folder is a clone of the
// project's repo (its .git/config origin), the other local clones of that repo under the projects root (F3's folder
// picker), the variable NAMES in .env.example (never .env), package.json scripts, top folders, the migrations folder
// and its tool, and the local Postgres databases by name. Nothing here reads a value.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { DiscoveryMac } from "./types.js";

export type MacDeps = {
  /** Database names on the local Postgres server, or null when it cannot be reached. */
  listDatabases: () => Promise<string[] | null>;
  projectsRoot: string;
  /** PLA-158 (F-26): the database name the project's own env file points at (it may live on another port), or null. */
  ownDatabase?: string | null;
};

// PLA-158 (F-26): the «Base de datos» picker listed every database on Plania's own Postgres: test databases, demo
// servers and the throwaway copies El Probador and Máquinas make (<db>_entrega, _prueba, _taller, _plantilla, _ini_<key>). None
// of them is a project's base, and the project's own base (on another port) was missing. Plania's leftovers are
// hidden and the project's own name leads the list.
const LEFTOVER = [/^plania_test_/, /_demo$/, /_(entrega|prueba|taller|plantilla)$/, /_ini_[a-z0-9_]+$/];
export const isLeftover = (name: string): boolean => LEFTOVER.some((re) => re.test(name));
export function pickDatabases(listed: string[], own: string | null | undefined): string[] {
  const out = listed.filter((d) => !isLeftover(d) || d === own);
  return own ? [own, ...out.filter((d) => d !== own)] : out;
}

const readText = (p: string): string | null => {
  try {
    return readFileSync(p, "utf8");
  } catch {
    return null;
  }
};

/** The origin URL in a clone's .git/config (a worktree's .git file points elsewhere: read through it). */
export function originOf(folder: string): string | null {
  let gitDir = path.join(folder, ".git");
  try {
    if (statSync(gitDir).isFile()) {
      const m = readText(gitDir)?.match(/^gitdir:\s*(.+)$/m);
      if (!m) return null;
      gitDir = path.resolve(folder, m[1]!.trim());
      const common = readText(path.join(gitDir, "commondir"));
      if (common) gitDir = path.resolve(gitDir, common.trim());
    }
  } catch {
    return null;
  }
  const cfg = readText(path.join(gitDir, "config"));
  if (!cfg) return null;
  const block = cfg.split(/^\[/m).find((b) => /^remote\s+"origin"\]/.test(b));
  return block?.match(/^\s*url\s*=\s*(.+)$/m)?.[1]?.trim() ?? null;
}

/** owner/name from a GitHub remote (https or ssh), or null. */
export function repoOfRemote(url: string | null): string | null {
  const m = url?.match(/github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/i);
  return m ? m[1]! : null;
}

/** Variable names in a .env.example (comments and values dropped). */
export function envNames(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (m && !out.includes(m[1]!)) out.push(m[1]!);
  }
  return out;
}

const MIGRATION_DIRS = ["drizzle/migrations", "drizzle", "prisma/migrations", "supabase/migrations", "db/migrations", "migrations"];

export function migrationsOf(folder: string, pkg: Record<string, any> | null): DiscoveryMac["migrations"] {
  const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
  for (const d of MIGRATION_DIRS) {
    const dir = path.join(folder, d);
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      continue;
    }
    const count = d.startsWith("prisma") ? names.filter((n) => existsSync(path.join(dir, n, "migration.sql"))).length : names.filter((n) => /\.sql$/.test(n)).length;
    if (!count) continue;
    const tool = d.startsWith("prisma") ? "prisma" : d.startsWith("drizzle") || deps["drizzle-kit"] ? "drizzle" : d.startsWith("supabase") ? "supabase" : deps.knex ? "knex" : null;
    return { dir: d, count, tool };
  }
  return null;
}

export async function discoverMac(folder: string | null, repo: string | null, deps: MacDeps): Promise<DiscoveryMac> {
  const clones: string[] = [];
  try {
    for (const name of readdirSync(deps.projectsRoot).slice(0, 80)) {
      const p = path.join(deps.projectsRoot, name);
      if (repo && repoOfRemote(originOf(p))?.toLowerCase() === repo.toLowerCase()) clones.push(p);
    }
  } catch {
    // No projects root yet.
  }
  const exists = !!folder && existsSync(folder);
  const remote = exists ? originOf(folder!) : null;
  const pkgText = exists ? readText(path.join(folder!, "package.json")) : null;
  let pkg: Record<string, any> | null = null;
  try {
    pkg = pkgText ? JSON.parse(pkgText) : null;
  } catch {
    pkg = null;
  }
  const envText = exists ? readText(path.join(folder!, ".env.example")) : null;
  let folders: string[] | null = null;
  if (exists) {
    try {
      const top = readdirSync(folder!, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.name.startsWith(".") && !["node_modules", "dist", "build", "out", "coverage", "public", "test", "tests"].includes(d.name))
        .map((d) => d.name);
      const src = top.includes("src") ? readdirSync(path.join(folder!, "src"), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => `src/${d.name}`) : [];
      folders = [...top.filter((n) => n !== "src"), ...src].slice(0, 24);
    } catch {
      folders = null;
    }
  }
  const databases = await deps.listDatabases().catch(() => null);
  // PLA-I70-25: a folder that is a clone of ANOTHER repo (or no clone at all, when a repo is set) feeds nothing: its scripts,
  // package manager, .env.example names, folders and migrations belong to a different project. They read «—» (null).
  const matches = remote && repo ? repoOfRemote(remote)?.toLowerCase() === repo.toLowerCase() : null;
  const foreign = !!repo && exists && matches === false;
  const trusted = exists && !foreign;
  return {
    folder: folder ? { path: folder, exists, clone: !!remote, remote, matches, clones } : null,
    postgres: databases ? { ok: true, databases: pickDatabases(databases, deps.ownDatabase), own: deps.ownDatabase ?? null } : { ok: false, databases: deps.ownDatabase ? [deps.ownDatabase] : [], own: deps.ownDatabase ?? null },
    env_example: trusted && envText ? envNames(envText) : null,
    scripts: trusted && pkg?.scripts ? Object.keys(pkg.scripts) : null,
    folders: trusted ? folders : null,
    migrations: trusted ? migrationsOf(folder!, pkg) : null,
    pm: !trusted || !pkg ? null : existsSync(path.join(folder!, "pnpm-lock.yaml")) ? "pnpm" : existsSync(path.join(folder!, "yarn.lock")) ? "yarn" : "npm",
  };
}
