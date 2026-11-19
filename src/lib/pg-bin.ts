// PLA-I2-4: where Postgres's client programs (pg_dump, psql) are looked for, on macOS and Linux alike. Used by the
// nightly backup (src/jobs/backup.ts), the test copies' database copy (src/captures/prueba.ts, publicado.ts) and
// the machine check (src/machine-check/, through pgDumpFor).
// Order: PLANIA_PG_BIN (a folder, or the pg_dump binary itself); then a folder made for the server's major version
// (Homebrew's postgresql@N, Debian/Ubuntu's /usr/lib/postgresql/N/bin, Red Hat's /usr/pgsql-N/bin), because a newer
// pg_dump writes SET lines an older server rejects on restore; then PATH; then the usual folders of each system.
// B4: on Windows too: the EDB installer's C:\Program Files\PostgreSQL\<N>\bin and Laragon's
// C:\laragon\bin\pgsql\pgsql-<N>\bin, and the server's own folder (pg_config's BINDIR, src/lib/pg-connect.ts) when the
// caller read it, which goes before everything but PLANIA_PG_BIN. P2: the search PATH follows the server's major.
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { findOnPath, type Exists } from "./claude-bin.js";

export type PgTool = "pg_dump" | "psql";
export type PgBinDeps = {
  env?: NodeJS.ProcessEnv;
  exists?: Exists;
  platform?: NodeJS.Platform;
  listDir?: (dir: string) => string[];
  /** B4: the folder the server reports for its own programs (pg_config BINDIR); null when unknown. */
  serverBinDir?: string | null;
  /** P2: the server's major version, for pgSearchPath; 0 when unknown. */
  major?: number;
};

/** The majors looked for when the server's is unknown, newest first. */
export const KNOWN_MAJORS = [18, 17, 16, 15, 14];

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

const posixVersionedDirs = (major: number) => [
  `/opt/homebrew/opt/postgresql@${major}/bin`,
  `/usr/local/opt/postgresql@${major}/bin`,
  `/usr/lib/postgresql/${major}/bin`,
  `/usr/pgsql-${major}/bin`,
];

// Windows paths are built with path.win32, so a test on any system gets the same strings.
const programFiles = (env: NodeJS.ProcessEnv) => env.ProgramFiles?.trim() || "C:\\Program Files";
const LARAGON_PGSQL = "C:\\laragon\\bin\\pgsql";
const winVersionedDirs = (major: number, env: NodeJS.ProcessEnv) => [
  path.win32.join(programFiles(env), "PostgreSQL", String(major), "bin"),
  path.win32.join(LARAGON_PGSQL, `pgsql-${major}`, "bin"),
];

const versionedDirs = (major: number, env: NodeJS.ProcessEnv, platform: NodeJS.Platform) =>
  platform === "win32" ? winVersionedDirs(major, env) : posixVersionedDirs(major);

// Every PostgreSQL the EDB installer or Laragon put on a Windows machine, newest first.
function windowsDirs(env: NodeJS.ProcessEnv, listDir: (dir: string) => string[]): string[] {
  const edb = path.win32.join(programFiles(env), "PostgreSQL");
  const newest = (names: string[], re: RegExp) =>
    names
      .map((d) => ({ d, n: Number(re.exec(d)?.[1] ?? NaN) }))
      .filter((x) => Number.isFinite(x.n))
      .sort((a, b) => b.n - a.n)
      .map((x) => x.d);
  return [
    ...newest(listDir(edb), /^(\d+)(?:\.\d+)?$/).map((d) => path.win32.join(edb, d, "bin")),
    ...newest(listDir(LARAGON_PGSQL), /^(?:pgsql|postgresql)-?(\d+)/i).map((d) => path.win32.join(LARAGON_PGSQL, d, "bin")),
  ];
}

// The file to look for in a folder: pg_dump.exe on Windows.
const toolIn = (dir: string, tool: PgTool, platform: NodeJS.Platform) =>
  platform === "win32" ? path.win32.join(dir, `${tool}.exe`) : path.posix.join(dir, tool);

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
  const platform = deps.platform ?? process.platform;
  const listDir = deps.listDir ?? listDirDefault;
  const named = pgBinDir(env);
  if (named) return path.join(named, tool);
  const first = [...(deps.serverBinDir ? [deps.serverBinDir] : []), ...(major ? versionedDirs(major, env, platform) : [])];
  for (const dir of first) if (exists(toolIn(dir, tool, platform))) return toolIn(dir, tool, platform);
  const onPath = findOnPath(tool, env, exists, platform);
  if (onPath) return onPath;
  const usual = platform === "win32" ? windowsDirs(env, listDir) : [...COMMON_DIRS, ...debianDirs(listDir)];
  for (const dir of usual) if (exists(toolIn(dir, tool, platform))) return toolIn(dir, tool, platform);
  return tool;
}

/** B4, F1: the folder pg_dump was found in, or null when only its bare name is left (nothing found). */
export function pgBinFolder(major: number, deps: PgBinDeps = {}): string | null {
  const found = pgToolFor("pg_dump", major, deps);
  if (found === "pg_dump") return null;
  return (deps.platform ?? process.platform) === "win32" ? path.win32.dirname(found) : path.posix.dirname(found);
}

// A PATH for a shell command that calls psql and pg_dump by name: the folders above that exist, then `base`.
export function pgSearchPath(base: string | undefined, deps: PgBinDeps = {}): string {
  const env = deps.env ?? process.env;
  const exists = deps.exists ?? existsSync;
  const platform = deps.platform ?? process.platform;
  const listDir = deps.listDir ?? listDirDefault;
  const named = pgBinDir(env);
  // P2: the server's major first when it is known, then every known one, newest first.
  const majors = [...new Set([...(deps.major ? [deps.major] : []), ...KNOWN_MAJORS])];
  const dirs = [
    ...(named ? [named] : []),
    ...(deps.serverBinDir ? [deps.serverBinDir] : []),
    ...(platform === "win32"
      ? [...majors.flatMap((m) => winVersionedDirs(m, env)), ...windowsDirs(env, listDir)]
      : [...majors.flatMap((m) => posixVersionedDirs(m).slice(0, 2)), ...debianDirs(listDir), "/opt/homebrew/opt/libpq/bin", "/usr/local/opt/libpq/bin"]),
  ].filter((d) => d === named || exists(d));
  const parts = [...dirs, ...(base ?? "").split(path.delimiter)].filter(Boolean);
  return [...new Set(parts)].join(path.delimiter);
}
