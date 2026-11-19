// PLA-I2-9: a test copy of Plania itself (src/captures/prueba.ts calls these when isSelfProject). The copy gets a
// new database of its own, built by the migrate module from the copy's own migration files, never a dump of the
// live one; its env file is rewritten so it points there with jobs and runs off; and it is refused if anything would
// still point it at the live database or the live server's port.
import { existsSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { assertDatabaseName, migrate, readMigrations, withDatabase } from "../db/migrate.js";
import { copyDatabaseUrl, rewriteEnvText, sameDatabase, selfCopyEnv, type CopySuffix } from "./plania-self.js";
import { defineWords, say } from "../words.js";

// PLA-I2-10: why a test copy of Plania is not started, in the install's language; the Spanish is unchanged.
export const SELF_COPY_WORDS = defineWords({
  es: {
    noLive: "No sé cuál es la base de datos del Plania que estás usando, así que no enciendo la copia.",
    noOwnDb: "La copia de Plania no tendría una base de datos propia; no la enciendo.",
    buildFailed: (name: string, error: string) => `No se pudo preparar la base de datos de la copia (${name}): ${error}`,
    livePort: "La copia de Plania usaría el puerto del Plania que estás usando; no la enciendo.",
    liveDb: "La copia de Plania apuntaría a la base de datos del Plania que estás usando; no la enciendo.",
    jobsOn: "La copia de Plania tendría sus trabajos de fondo encendidos; no la enciendo.",
  },
  en: {
    noLive: "I do not know which database the Plania you are using has, so I do not start the copy.",
    noOwnDb: "The Plania copy would not have a database of its own; I do not start it.",
    buildFailed: (name: string, error: string) => `The copy's database could not be prepared (${name}): ${error}`,
    livePort: "The Plania copy would use the port of the Plania you are using; I do not start it.",
    liveDb: "The Plania copy would point at the database of the Plania you are using; I do not start it.",
    jobsOn: "The Plania copy would have its background jobs on; I do not start it.",
  },
});

export type Built = { ok: true } | { ok: false; error: string };
/** Drops and creates the copy's database, then applies the copy's migrations to it. Injected in tests. */
export type SelfDbBuild = (copyUrl: string, name: string, migrationsDir: string) => Promise<Built>;

export const defaultSelfDbBuild: SelfDbBuild = async (copyUrl, name, migrationsDir) => {
  try {
    assertDatabaseName(name);
    // The maintenance database, never the live one, to drop and create the copy's.
    const admin = new pg.Client({ connectionString: withDatabase(copyUrl, "postgres"), connectionTimeoutMillis: 5_000 });
    await admin.connect();
    try {
      await admin.query(`drop database if exists ${name} with (force)`);
      await admin.query(`create database ${name}`);
    } finally {
      await admin.end().catch(() => undefined);
    }
    const c = new pg.Client({ connectionString: copyUrl, connectionTimeoutMillis: 5_000 });
    await c.connect();
    try {
      await migrate(c, { files: readMigrations(migrationsDir), named: true });
    } finally {
      await c.end().catch(() => undefined);
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
};

export type SelfCopyDb = { ok: true; url: string; name: string; env: Record<string, string> } | { ok: false; error: string };

/** The copy's own database, built new. live is the running server's DATABASE_URL. */
export async function selfCopyDatabase(live: string | undefined, suffix: CopySuffix, wt: string, build: SelfDbBuild = defaultSelfDbBuild): Promise<SelfCopyDb> {
  if (!live) return { ok: false, error: say(SELF_COPY_WORDS).noLive };
  const target = copyDatabaseUrl(live, suffix);
  if (!target || sameDatabase(target.url, live)) return { ok: false, error: say(SELF_COPY_WORDS).noOwnDb };
  const built = await build(target.url, target.name, path.join(wt, "drizzle", "migrations"));
  if (!built.ok) return { ok: false, error: say(SELF_COPY_WORDS).buildFailed(target.name, built.error.slice(0, 160)) };
  return { ok: true, url: target.url, name: target.name, env: selfCopyEnv(target.url, 0) };
}

/** The live server's port: PLANIA_PORT, else the service's 3737. */
export const livePort = (liveEnv: NodeJS.ProcessEnv): number => Number(liveEnv.PLANIA_PORT) || 3737;

export type SelfCopyFile = { ok: true; file: string; env: Record<string, string> } | { ok: false; error: string };

/** Sets the copy's port, rewrites its env file (envFile, else .env) with the copy's values, reads it back and
 * refuses when the copy would still reach the live database, run jobs, or take the live server's port. */
export function selfCopyEnvFile(wt: string, envFile: string | null, copyEnv: Record<string, string>, port: number, liveEnv: NodeJS.ProcessEnv): SelfCopyFile {
  const live = liveEnv.DATABASE_URL;
  if (port === livePort(liveEnv)) return { ok: false, error: say(SELF_COPY_WORDS).livePort };
  const env: Record<string, string> = { ...copyEnv, PLANIA_PORT: String(port) };
  if (!env.DATABASE_URL || sameDatabase(env.DATABASE_URL, live)) return { ok: false, error: say(SELF_COPY_WORDS).liveDb };
  const file = path.join(wt, envFile ?? ".env");
  const before = existsSync(file) ? readFileSync(file, "utf8") : "";
  writeFileSync(file, rewriteEnvText(before, env), { mode: 0o600 });
  chmodSync(file, 0o600);
  const back = readFileSync(file, "utf8");
  const value = (name: string): string | null => {
    let found: string | null = null;
    for (const line of back.split(/\r?\n/)) {
      const m = new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=\\s*(.*)$`).exec(line);
      if (m) found = m[1]!.trim().replace(/^(['"])(.*)\1$/, "$2");
    }
    return found;
  };
  const url = value("DATABASE_URL");
  if (!url || sameDatabase(url, live) || url !== env.DATABASE_URL) return { ok: false, error: say(SELF_COPY_WORDS).liveDb };
  if (value("PLANIA_JOBS") !== "0") return { ok: false, error: say(SELF_COPY_WORDS).jobsOn };
  return { ok: true, file: path.relative(wt, file), env };
}
