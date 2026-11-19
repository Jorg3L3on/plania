// PLA-I2-1: the migrate command's core. Applies drizzle/migrations/*.sql in file-name order and records each one
// in plania_migrations (name, checksum, applied at) inside the same transaction as the file, so a failed file leaves
// the database as it was before it and no record. The record table is created here (bootstrap), not by a numbered
// migration. Most files before 0027 fail when run twice, so the record, not re-running, is what makes this safe.
//
// Never on the owner's database by accident: a database without the record is touched only when its name was given
// on the command line (`named`), and one with tables and no record only through baseline().
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import pg from "pg";

export const MIGRATIONS_TABLE = "plania_migrations";
export const MIGRATIONS_DIR = path.resolve(import.meta.dirname, "../../drizzle/migrations");
// One migrate at a time per database (two installs, or a migrate during a start-up check).
const LOCK_KEY = 7_173_820_241;

export type MigrationFile = { name: string; sql: string; checksum: string };

export type MigrateResult = {
  applied: string[];
  // Recorded files whose content changed since they were applied: reported, never re-applied.
  changed: string[];
  bootstrapped: boolean;
};

// Codes the CLIs turn into one sentence. The file is named on a failed migration.
export type MigrateErrorCode = "NOT_NAMED" | "NEEDS_BASELINE" | "MIGRATION_FAILED" | "BASELINE_REFUSED" | "UNKNOWN_FILE";
export class MigrateError extends Error {
  constructor(
    readonly code: MigrateErrorCode,
    message: string,
    readonly file?: string,
  ) {
    super(message);
  }
}

// The checksum ignores line endings, so a Windows (CRLF) checkout of the same file is the same file.
export function checksumOf(sql: string): string {
  return createHash("sha256").update(sql.replace(/\r\n/g, "\n")).digest("hex");
}

export function readMigrations(dir = MIGRATIONS_DIR): MigrationFile[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((name) => {
      const sql = readFileSync(path.join(dir, name), "utf8");
      return { name, sql, checksum: checksumOf(sql) };
    });
}

type Queryable = Pick<pg.Client, "query">;

export async function hasRecord(c: Queryable): Promise<boolean> {
  const { rows } = await c.query("select to_regclass($1) is not null as present", [`public.${MIGRATIONS_TABLE}`]);
  return rows[0].present === true;
}

// Tables in public other than the record: a database with any is not empty.
export async function userTableCount(c: Queryable): Promise<number> {
  const { rows } = await c.query(
    `select count(*)::int as n from information_schema.tables where table_schema = 'public' and table_name <> $1`,
    [MIGRATIONS_TABLE],
  );
  return rows[0].n;
}

async function recorded(c: Queryable): Promise<Map<string, string>> {
  const { rows } = await c.query(`select name, checksum from ${MIGRATIONS_TABLE}`);
  return new Map(rows.map((r) => [r.name as string, r.checksum as string]));
}

async function createRecord(c: Queryable): Promise<void> {
  await c.query(
    `create table if not exists ${MIGRATIONS_TABLE} (
       name text primary key,
       checksum text not null,
       applied_at timestamptz not null default now()
     )`,
  );
}

export type Status = { pending: string[]; changed: string[]; hasRecord: boolean; tables: number };

// Read-only: what migrate would do. For the start-up check and the CLIs.
export async function migrationStatus(c: Queryable, files = readMigrations()): Promise<Status> {
  const present = await hasRecord(c);
  const tables = await userTableCount(c);
  if (!present) return { pending: files.map((f) => f.name), changed: [], hasRecord: false, tables };
  const done = await recorded(c);
  return {
    pending: files.filter((f) => !done.has(f.name)).map((f) => f.name),
    changed: files.filter((f) => done.has(f.name) && done.get(f.name) !== f.checksum).map((f) => f.name),
    hasRecord: true,
    tables,
  };
}

async function withLock<T>(c: pg.Client, fn: () => Promise<T>): Promise<T> {
  await c.query("select pg_advisory_lock($1)", [LOCK_KEY]);
  try {
    return await fn();
  } finally {
    await c.query("select pg_advisory_unlock($1)", [LOCK_KEY]);
  }
}

export type MigrateOptions = {
  files?: MigrationFile[];
  // The database was named on the command line (or created by the install command): a database without the
  // record may then be bootstrapped, as long as it has no tables.
  named?: boolean;
  log?: (line: string) => void;
};

// Applies every unrecorded file in order, each in its own transaction with its record. Stops at the first failure.
export async function migrate(c: pg.Client, opts: MigrateOptions = {}): Promise<MigrateResult> {
  const files = opts.files ?? readMigrations();
  const log = opts.log ?? (() => {});
  return withLock(c, async () => {
    let bootstrapped = false;
    if (!(await hasRecord(c))) {
      if (!opts.named) {
        throw new MigrateError("NOT_NAMED", "the database has no migration record and was not named on the command line");
      }
      if ((await userTableCount(c)) > 0) {
        throw new MigrateError("NEEDS_BASELINE", "the database has tables and no migration record");
      }
      await createRecord(c);
      bootstrapped = true;
    }
    const done = await recorded(c);
    const changed = files.filter((f) => done.has(f.name) && done.get(f.name) !== f.checksum).map((f) => f.name);
    const applied: string[] = [];
    for (const f of files) {
      if (done.has(f.name)) continue;
      await c.query("begin");
      try {
        await c.query(f.sql);
        await c.query(`insert into ${MIGRATIONS_TABLE} (name, checksum) values ($1, $2)`, [f.name, f.checksum]);
        await c.query("commit");
      } catch (e) {
        await c.query("rollback").catch(() => {});
        const why = e instanceof Error ? e.message : String(e);
        throw new MigrateError("MIGRATION_FAILED", `${f.name} failed: ${why}`, f.name);
      }
      applied.push(f.name);
      log(f.name);
    }
    return { applied, changed, bootstrapped };
  });
}

// For a database that already has migrations and no record (the owner's): marks every file up to and including
// `upTo` as applied without running it. Refused when a record exists or the database has no tables.
export async function baseline(
  c: pg.Client,
  upTo: string,
  opts: { files?: MigrationFile[] } = {},
): Promise<{ marked: string[] }> {
  const files = opts.files ?? readMigrations();
  const target = files.find((f) => f.name === upTo || f.name === `${upTo}.sql` || f.name.startsWith(`${upTo}_`));
  if (!target) throw new MigrateError("UNKNOWN_FILE", `no migration file named ${upTo}`, upTo);
  return withLock(c, async () => {
    if (await hasRecord(c)) {
      throw new MigrateError("BASELINE_REFUSED", "the database already has a migration record");
    }
    if ((await userTableCount(c)) === 0) {
      throw new MigrateError("BASELINE_REFUSED", "the database is empty; migrate it instead");
    }
    const marked = files.filter((f) => f.name <= target.name);
    await c.query("begin");
    try {
      await createRecord(c);
      for (const f of marked) {
        await c.query(`insert into ${MIGRATIONS_TABLE} (name, checksum) values ($1, $2)`, [f.name, f.checksum]);
      }
      await c.query("commit");
    } catch (e) {
      await c.query("rollback").catch(() => {});
      throw e;
    }
    return { marked: marked.map((f) => f.name) };
  });
}

// The database name in a connection URL, and the same URL pointed at another database on that server.
export function databaseName(url: string): string {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
}
export function withDatabase(url: string, name: string): string {
  const u = new URL(url);
  u.pathname = `/${encodeURIComponent(name)}`;
  return u.toString();
}

// Postgres identifiers the commands create: lower case, digits, underscore. Anything else is refused rather than quoted.
export function assertDatabaseName(name: string): void {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(name)) throw new Error(`not a database name: ${name}`);
}

// PLA-I2-1: the start-up check. Null when the server may start; otherwise one sentence for the person running it.
export async function startupProblem(url: string | undefined, files = readMigrations()): Promise<string | null> {
  if (!url) return "Falta DATABASE_URL en .env: corre pnpm plania:install.";
  let name = "";
  try {
    name = databaseName(url);
  } catch {
    return "DATABASE_URL en .env no es una dirección de Postgres válida.";
  }
  const c = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5_000 });
  try {
    await c.connect();
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    return `No se pudo abrir la base ${name} (${why}): revisa que Postgres esté encendido y que DATABASE_URL sea correcta.`;
  }
  try {
    const s = await migrationStatus(c, files);
    if (!s.hasRecord) {
      return s.tables > 0
        ? `La base ${name} no tiene registro de migraciones: márcala una vez con pnpm db:migrate --database ${name} --baseline <última migración aplicada>.`
        : `La base ${name} está vacía: corre pnpm db:migrate --database ${name}.`;
    }
    if (s.pending.length > 0) {
      const n = s.pending.length;
      return `La base ${name} tiene ${n} migraci${n === 1 ? "ón" : "ones"} sin aplicar (desde ${s.pending[0]}): corre pnpm db:migrate.`;
    }
    return null;
  } finally {
    await c.end().catch(() => {});
  }
}
