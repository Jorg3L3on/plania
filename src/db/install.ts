// PLA-I2-1: the install command's core. On a new machine: machine check, create the database, write the settings
// file with generated secrets, migrate, leave the built screen in place. No hand edit of .env.
//
// Never on the owner's database: an existing database is used only when it already carries the migration record
// (this command made it, and this is a re-run) or when its name was given on the command line; one with tables and
// no record is refused by migrate() and goes through `pnpm db:migrate --baseline`.
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parseEnv } from "node:util";
import pg from "pg";
import {
  assertDatabaseName,
  databaseName,
  hasRecord,
  MigrateError,
  migrate,
  type MigrationFile,
  withDatabase,
} from "./migrate.js";
import { hashSetupCode, newSetupCode } from "../install-state.js";

// The machine check (PLA-I2-12) is built in its own module; the install command passes it in. ok false stops the
// install before anything is created, and its lines are printed as they are.
export type MachineCheck = () => Promise<{ ok: boolean; lines: string[] }>;
export const noMachineCheck: MachineCheck = async () => ({ ok: true, lines: [] });

export const MIN_PG_VERSION = 140000;

export class InstallError extends Error {}

export type InstallOptions = {
  // Full connection URL of the database to install into (its server is reached through the `postgres` database).
  url: string;
  // The database name came from the command line (--database or --url).
  named: boolean;
  envPath: string;
  examplePath?: string;
  machineCheck?: MachineCheck;
  // Leaves dist/ui in place; the CLI builds it when missing, a pre-built package already has it.
  buildScreen?: () => Promise<void>;
  files?: MigrationFile[];
  secret?: (bytes: number, encoding: "hex" | "base64") => string;
  // PLA-I2-2: the one-time code for the first-start screen (tests pass a fixed one).
  setupCode?: () => string;
  log?: (line: string) => void;
};

// setupCode: the one-time code for the first-start screen, printed once; null when an owner already exists.
export type InstallResult = { database: string; created: boolean; applied: string[]; envKeys: string[]; setupCode: string | null };

const defaultSecret = (bytes: number, encoding: "hex" | "base64") => randomBytes(bytes).toString(encoding);

export async function install(opts: InstallOptions): Promise<InstallResult> {
  const log = opts.log ?? (() => {});
  const check = await (opts.machineCheck ?? noMachineCheck)();
  for (const line of check.lines) log(line);
  if (!check.ok) throw new InstallError("La revisión de la máquina encontró algo que arreglar antes de instalar.");

  const name = databaseName(opts.url);
  assertDatabaseName(name);

  // The server: reachable, recent enough, and whether the database is already there.
  const admin = new pg.Client({ connectionString: withDatabase(opts.url, "postgres"), connectionTimeoutMillis: 5_000 });
  try {
    await admin.connect();
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    throw new InstallError(`No se pudo conectar con Postgres (${why}): revisa que esté instalado y encendido y que la dirección sea correcta, y vuelve a correr la instalación.`);
  }
  let created = false;
  try {
    const { rows: v } = await admin.query("show server_version_num");
    if (Number(v[0].server_version_num) < MIN_PG_VERSION) {
      throw new InstallError(`Plania necesita Postgres 14 o más nuevo; este es ${v[0].server_version_num}.`);
    }
    const { rows } = await admin.query("select 1 from pg_database where datname = $1", [name]);
    if (rows.length === 0) {
      await admin.query(`create database ${name}`);
      created = true;
      log(`Base ${name} creada.`);
    }
  } finally {
    await admin.end().catch(() => {});
  }

  const c = new pg.Client({ connectionString: opts.url });
  await c.connect();
  let applied: string[];
  let envKeys: string[];
  let setupCode: string | null = null;
  try {
    if (!created && !opts.named && !(await hasRecord(c))) {
      throw new InstallError(
        `La base ${name} ya existe y no la creó la instalación: si es la que quieres usar, nómbrala con --database ${name}.`,
      );
    }
    envKeys = writeSettings(opts.envPath, opts.examplePath, opts.url, opts.secret ?? defaultSecret);
    if (envKeys.length > 0) log(`Ajustes escritos en ${opts.envPath}: ${envKeys.join(", ")}.`);
    try {
      ({ applied } = await migrate(c, { files: opts.files, named: true, log: (f) => log(`Migración ${f} aplicada.`) }));
    } catch (e) {
      if (e instanceof MigrateError && e.code === "NEEDS_BASELINE") {
        throw new InstallError(
          `La base ${name} tiene tablas y no tiene registro de migraciones: no se instala encima. Usa una base nueva.`,
        );
      }
      if (e instanceof MigrateError && e.file) throw new InstallError(`Falló la migración ${e.file}: ${e.message}`);
      throw e;
    }
    setupCode = await issueSetupCode(c, opts.envPath, opts.setupCode ?? newSetupCode);
  } finally {
    await c.end().catch(() => {});
  }
  if (opts.buildScreen) await opts.buildScreen();
  return { database: name, created, applied, envKeys, setupCode };
}

// PLA-I2-2: while no owner exists (no PLANIA_PASSWORD_HASH in the settings file, no password from first start), a
// new one-time code replaces any earlier one; only its sha256 is stored. Each run prints a fresh code, so a lost
// one is fixed by running the install again. Once the owner exists there is no code to give.
export async function issueSetupCode(c: pg.Client, envPath: string, make: () => string): Promise<string | null> {
  const env = existsSync(envPath) ? parseEnv(readFileSync(envPath, "utf8")) : {};
  if (env.PLANIA_PASSWORD_HASH?.trim()) return null;
  const code = make();
  const { rowCount } = await c.query(
    `insert into install_state (id, setup_code_hash, setup_code_at) values (1, $1, now())
     on conflict (id) do update set setup_code_hash = excluded.setup_code_hash, setup_code_at = now(), updated_at = now()
     where install_state.password_hash is null`,
    [hashSetupCode(code)],
  );
  return rowCount ? code : null;
}

// Writes the settings file: starts from .env.example when there is no .env, sets DATABASE_URL to the installed
// database, and generates the secrets that are empty. A value already set is never replaced (except DATABASE_URL).
// Returns the keys it wrote.
export function writeSettings(
  envPath: string,
  examplePath: string | undefined,
  url: string,
  secret: (bytes: number, encoding: "hex" | "base64") => string,
): string[] {
  const text = existsSync(envPath)
    ? readFileSync(envPath, "utf8")
    : examplePath && existsSync(examplePath)
      ? readFileSync(examplePath, "utf8")
      : "";
  const lines = text.split(/\r?\n/);
  const wanted: Array<[string, (current: string) => string | null]> = [
    ["DATABASE_URL", (cur) => (cur === url ? null : url)],
    ["SESSION_SECRET", (cur) => (cur ? null : secret(48, "base64"))],
    ["MCP_BEARER_TOKEN", (cur) => (cur ? null : secret(32, "hex"))],
  ];
  const written: string[] = [];
  for (const [key, next] of wanted) {
    const i = lines.findIndex((l) => l.startsWith(`${key}=`));
    const current = i >= 0 ? unquote(lines[i]!.slice(key.length + 1)) : "";
    const value = next(current);
    if (value === null) continue;
    const line = `${key}=${value}`;
    if (i >= 0) lines[i] = line;
    else lines.push(line);
    written.push(key);
  }
  if (written.length > 0 || !existsSync(envPath)) {
    const out = lines.join("\n").replace(/\n*$/, "\n");
    // The file holds secrets: readable by its owner only (ignored on Windows).
    writeFileSync(envPath, out, { mode: 0o600 });
  }
  return written;
}

function unquote(v: string): string {
  const t = v.trim();
  return /^(['"]).*\1$/.test(t) ? t.slice(1, -1) : t;
}
