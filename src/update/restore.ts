// PLA-I2-8: bring a database back from a backup file (the nightly plania-<day>.sql.gz or an update's
// plania-pre-update-*.sql.gz), into a database named on the command line. Replaces the README's three hand-typed
// lines. A database that already holds tables is never replaced unless the person asks twice: --overwrite and the
// database's name again (--confirm <name>); it is then dropped and made again before the restore.
// The restore itself is psql reading the gunzipped dump with ON_ERROR_STOP, injected so tests choose the binary.
import { spawn } from "node:child_process";
import { createReadStream, existsSync, statSync } from "node:fs";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import pg from "pg";
import { assertDatabaseName, databaseName, hasRecord, userTableCount, withDatabase } from "../db/migrate.js";

export type RestoreErrorCode = "NO_FILE" | "BAD_NAME" | "NO_SERVER" | "HAS_DATA" | "RESTORE_FAILED";
export class RestoreError extends Error {
  constructor(
    readonly code: RestoreErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export type RestoreOptions = {
  file: string;
  // Connection URL of the database to restore into (its server is reached through `postgres`).
  url: string;
  overwrite?: boolean;
  // Must repeat the database's name when overwrite is asked.
  confirm?: string;
  // Feeds the plain SQL dump (gunzipped when the file ends in .gz) to psql on url.
  psql: (url: string, file: string) => Promise<void>;
  log?: (line: string) => void;
};

export type RestoreResult = { database: string; created: boolean; replaced: boolean; tables: number; migrations: number | null };

const why = (e: unknown) => (e instanceof Error ? e.message : String(e)).split("\n")[0]!.slice(0, 300);

export async function restore(opts: RestoreOptions): Promise<RestoreResult> {
  const log = opts.log ?? (() => {});
  if (!existsSync(opts.file) || statSync(opts.file).size === 0) throw new RestoreError("NO_FILE", `No encuentro el respaldo ${opts.file}, o está vacío.`);
  let name: string;
  try {
    name = databaseName(opts.url);
    assertDatabaseName(name);
  } catch {
    throw new RestoreError("BAD_NAME", "El nombre de la base debe ir en minúsculas, con números o guion bajo.");
  }

  const admin = new pg.Client({ connectionString: withDatabase(opts.url, "postgres"), connectionTimeoutMillis: 5_000 });
  try {
    await admin.connect();
  } catch (e) {
    throw new RestoreError("NO_SERVER", `No se pudo conectar con Postgres (${why(e)}): revisa que esté encendido.`);
  }
  let created = false;
  let replaced = false;
  try {
    const { rows } = await admin.query("select 1 from pg_database where datname = $1", [name]);
    if (rows.length > 0) {
      const c = new pg.Client({ connectionString: opts.url });
      await c.connect();
      const tables = await userTableCount(c).finally(() => c.end().catch(() => {}));
      if (tables > 0) {
        if (!opts.overwrite || opts.confirm !== name) {
          throw new RestoreError(
            "HAS_DATA",
            `La base ${name} ya tiene datos, así que no se restaura encima. Si de verdad quieres reemplazarla, pídelo dos veces: --overwrite --confirm ${name}.`,
          );
        }
        log(`Borro la base ${name} para traerla del respaldo.`);
        await admin.query(`drop database ${name} with (force)`);
        await admin.query(`create database ${name}`);
        replaced = true;
      }
    } else {
      await admin.query(`create database ${name}`);
      created = true;
      log(`Base ${name} creada.`);
    }
  } finally {
    await admin.end().catch(() => {});
  }

  log(`Traigo el respaldo ${opts.file} a la base ${name}.`);
  try {
    await opts.psql(opts.url, opts.file);
  } catch (e) {
    throw new RestoreError(
      "RESTORE_FAILED",
      `El respaldo no entró completo en la base ${name} (${why(e)}). La base quedó a medias: bórrala o vuelve a correr con --overwrite --confirm ${name}.`,
    );
  }
  const c = new pg.Client({ connectionString: opts.url });
  await c.connect();
  try {
    const tables = await userTableCount(c);
    let migrations: number | null = null;
    if (await hasRecord(c)) migrations = Number((await c.query("select count(*)::int as n from plania_migrations")).rows[0].n);
    log(`Listo: la base ${name} volvió del respaldo con ${tables} tablas.`);
    return { database: name, created, replaced, tables, migrations };
  } finally {
    await c.end().catch(() => {});
  }
}

// The real psql: the dump (gunzipped when .gz) into psql's stdin, stopping at the first error.
export function psqlRestore(psqlBin: string) {
  return (url: string, file: string): Promise<void> =>
    new Promise((resolve, reject) => {
      const child = spawn(psqlBin, ["-q", "-v", "ON_ERROR_STOP=1", "-d", url], { stdio: ["pipe", "ignore", "pipe"] });
      let stderr = "";
      child.stderr.on("data", (d) => (stderr += String(d)));
      child.on("error", reject);
      const source = createReadStream(file);
      const fed = file.endsWith(".gz") ? pipeline(source, createGunzip(), child.stdin) : pipeline(source, child.stdin);
      fed.catch(() => {}); // psql exiting early closes stdin; its exit code says why
      child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(stderr.trim().split("\n").pop() || `psql exited ${code}`))));
    });
}
