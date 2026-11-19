// PLA-I2-8: pnpm restore:plania <backup file> --database <name> — bring a database back from a backup
// (src/update/restore.ts). A database that already has data is replaced only when asked twice:
//   pnpm restore:plania ~/plania-backups/plania-20261118.sql.gz --database plania_restore
//   pnpm restore:plania <file> --database plania --overwrite --confirm plania
// Stop Plania before replacing the database it uses. The server is the one in DATABASE_URL (or --url).
import path from "node:path";
import { parseArgs } from "node:util";
import pg from "pg";
import { withDatabase } from "../src/db/migrate.js";
import { pgToolFor } from "../src/lib/pg-bin.js";
import { psqlRestore, restore, RestoreError } from "../src/update/restore.js";

const { values, positionals } = parseArgs({
  options: {
    database: { type: "string" },
    url: { type: "string" },
    overwrite: { type: "boolean", default: false },
    confirm: { type: "string" },
  },
  allowPositionals: true,
  strict: true,
});
const file = positionals[0];
const base = values.url ?? process.env.DATABASE_URL ?? "postgres://localhost:5432/postgres";
if (!file || (!values.database && !values.url)) {
  console.error("Uso: pnpm restore:plania <respaldo .sql.gz> --database <nombre> [--overwrite --confirm <nombre>]");
  process.exit(2);
}
const url = values.database ? withDatabase(base, values.database) : base;

// psql of the server's major version (PLANIA_PG_BIN first), as the backup's pg_dump.
async function serverMajor(): Promise<number> {
  const c = new pg.Client({ connectionString: withDatabase(url, "postgres"), connectionTimeoutMillis: 5_000 });
  try {
    await c.connect();
    return Math.floor(Number((await c.query("show server_version_num")).rows[0].server_version_num) / 10000);
  } catch {
    return 0;
  } finally {
    await c.end().catch(() => {});
  }
}

try {
  await restore({
    file: path.resolve(file),
    url,
    overwrite: values.overwrite,
    confirm: values.confirm,
    psql: psqlRestore(pgToolFor("psql", await serverMajor())),
    log: (line) => console.log(line),
  });
} catch (e) {
  if (e instanceof RestoreError) {
    console.error(e.message);
    process.exit(1);
  }
  throw e;
}
