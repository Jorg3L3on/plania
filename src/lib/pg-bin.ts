// PLA-I2-4: where Postgres's client programs (pg_dump, psql) are looked for, on macOS and Linux alike. Used by the
// nightly backup (src/jobs/backup.ts), the test copies' database copy (src/captures/prueba.ts, publicado.ts) and
// the machine check (src/machine-check/, through pgDumpFor).
// Order: PLANIA_PG_BIN (a folder, or the pg_dump binary itself); then a folder made for the server's major version
// (Homebrew's postgresql@N, Debian/Ubuntu's /usr/lib/postgresql/N/bin, Red Hat's /usr/pgsql-N/bin), because a newer
// pg_dump writes SET lines an older server rejects on restore; then PATH; then the usual folders of each system.
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { findOnPath, type Exists } from "./claude-bin.js";

export type PgTool = "pg_dump" | "psql";
export type PgBinDeps = { env?: NodeJS.ProcessEnv; exists?: Exists; platform?: NodeJS.Platform; listDir?: (dir: string) => string[] };

const listDirDefault = (dir: string): string[] => {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
};

// The folder PLANIA_PG_BIN names (it may name pg_dump itself).
function pgBinDir(env: NodeJS.ProcessEnv): string | null {
  const bin = env.PLANIA_PG_BIN?.trim();
  if (!bin) return null;
  return /pg_dump(\.exe)?$/i.test(path.basename(bin)) ? path.dirname(bin) : bin;
}

const versionedDirs = (major: number) => [
  `/opt/homebrew/opt/postgresql@${major}/bin`,
  `/usr/local/opt/postgresql@${major}/bin`,
  `/usr/lib/postgresql/${major}/bin`,
  `/usr/pgsql-${major}/bin`,
];

// Usual places when nothing above has it: Homebrew (both prefixes), keg-only libpq, Linuxbrew, the system's own.
const COMMON_DIRS = ["/opt/homebrew/bin", "/opt/homebrew/opt/libpq/bin", "/usr/local/bin", "/usr/local/opt/libpq/bin", "/home/linuxbrew/.linuxbrew/bin", "/usr/bin"];

// Debian keeps each installed major in /usr/lib/postgresql/<N>/bin and links only some of them into /usr/bin.
function debianDirs(listDir: (dir: string) => string[]): string[] {
  return listDir("/usr/lib/postgresql")
    .filter((d) => /^\d+$/.test(d))
    .sort((a, b) => Number(b) - Number(a))
    .map((d) => `/usr/lib/postgresql/${d}/bin`);
}

// The program to run: an absolute path when one is found, else its bare name (spawn then reports it missing).
export function pgToolFor(tool: PgTool, major: number, deps: PgBinDeps = {}): string {
  const env = deps.env ?? process.env;
  const exists = deps.exists ?? existsSync;
  const named = pgBinDir(env);
  if (named) return path.join(named, tool);
  for (const dir of major ? versionedDirs(major) : []) if (exists(path.join(dir, tool))) return path.join(dir, tool);
  const onPath = findOnPath(tool, env, exists, deps.platform);
  if (onPath) return onPath;
  for (const dir of [...COMMON_DIRS, ...debianDirs(deps.listDir ?? listDirDefault)]) if (exists(path.join(dir, tool))) return path.join(dir, tool);
  return tool;
}

// A PATH for a shell command that calls psql and pg_dump by name: the folders above that exist, then `base`.
export function pgSearchPath(base: string | undefined, deps: PgBinDeps = {}): string {
  const env = deps.env ?? process.env;
  const exists = deps.exists ?? existsSync;
  const named = pgBinDir(env);
  const dirs = [
    ...(named ? [named] : []),
    ...[17, 16, 15, 14].flatMap((m) => versionedDirs(m).slice(0, 2)),
    ...debianDirs(deps.listDir ?? listDirDefault),
    "/opt/homebrew/opt/libpq/bin",
    "/usr/local/opt/libpq/bin",
  ].filter((d) => d === named || exists(d));
  const parts = [...dirs, ...(base ?? "").split(path.delimiter)].filter(Boolean);
  return [...new Set(parts)].join(path.delimiter);
}
