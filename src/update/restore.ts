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
import { defineWords, say } from "../words.js";

// PLA-I2-10: what the restore command says, in the install's language; the Spanish is unchanged.
export const RESTORE_WORDS = defineWords({
  es: {
    noFile: (file: string) => `No encuentro el respaldo ${file}, o está vacío.`,
    badName: "El nombre de la base debe ir en minúsculas, con números o guion bajo.",
    noServer: (why: string) => `No se pudo conectar con Postgres (${why}): revisa que esté encendido.`,
    hasData: (name: string) => `La base ${name} ya tiene datos, así que no se restaura encima. Si de verdad quieres reemplazarla, pídelo dos veces: --overwrite --confirm ${name}.`,
    dropping: (name: string) => `Borro la base ${name} para traerla del respaldo.`,
    created: (name: string) => `Base ${name} creada.`,
    restoring: (file: string, name: string) => `Traigo el respaldo ${file} a la base ${name}.`,
    failed: (name: string, why: string) => `El respaldo no entró completo en la base ${name} (${why}). La base quedó a medias: bórrala o vuelve a correr con --overwrite --confirm ${name}.`,
    done: (name: string, tables: number) => `Listo: la base ${name} volvió del respaldo con ${tables} tablas.`,
  },
  en: {
    noFile: (file: string) => `I cannot find the backup ${file}, or it is empty.`,
    badName: "The database name must be lowercase letters, numbers or underscores.",
    noServer: (why: string) => `Could not connect to Postgres (${why}): check that it is running.`,
    hasData: (name: string) => `The database ${name} already holds data, so the backup is not restored over it. If you really want to replace it, ask twice: --overwrite --confirm ${name}.`,
    dropping: (name: string) => `Dropping the database ${name} to bring it back from the backup.`,
    created: (name: string) => `Database ${name} created.`,
    restoring: (file: string, name: string) => `Restoring the backup ${file} into the database ${name}.`,
    failed: (name: string, why: string) => `The backup did not load completely into the database ${name} (${why}). The database is half done: drop it or run again with --overwrite --confirm ${name}.`,
    done: (name: string, tables: number) => `Done: the database ${name} is back from the backup with ${tables} tables.`,
  },
});

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
  const w = say(RESTORE_WORDS);
  if (!existsSync(opts.file) || statSync(opts.file).size === 0) throw new RestoreError("NO_FILE", w.noFile(opts.file));
  let name: string;
  try {
    name = databaseName(opts.url);
    assertDatabaseName(name);
  } catch {
    throw new RestoreError("BAD_NAME", w.badName);
  }

  const admin = new pg.Client({ connectionString: withDatabase(opts.url, "postgres"), connectionTimeoutMillis: 5_000 });
  try {
    await admin.connect();
  } catch (e) {
    throw new RestoreError("NO_SERVER", w.noServer(why(e)));
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
            w.hasData(name),
          );
        }
        log(w.dropping(name));
        await admin.query(`drop database ${name} with (force)`);
        await admin.query(`create database ${name}`);
        replaced = true;
      }
    } else {
      await admin.query(`create database ${name}`);
      created = true;
      log(w.created(name));
    }
  } finally {
    await admin.end().catch(() => {});
  }

  log(w.restoring(opts.file, name));
  try {
    await opts.psql(opts.url, opts.file);
  } catch (e) {
    throw new RestoreError(
      "RESTORE_FAILED",
      w.failed(name, why(e)),
    );
  }
  const c = new pg.Client({ connectionString: opts.url });
  await c.connect();
  try {
    const tables = await userTableCount(c);
    let migrations: number | null = null;
    if (await hasRecord(c)) migrations = Number((await c.query("select count(*)::int as n from plania_migrations")).rows[0].n);
    log(w.done(name, tables));
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
