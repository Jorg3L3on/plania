// PLA-I2-1: apply the migrations that are not recorded yet, or baseline a database that has them and no record.
//   pnpm db:migrate                                  the database in .env (it must already carry the record)
//   pnpm db:migrate --database <name>                that database on the same server; may bootstrap an empty one
//   pnpm db:migrate --database <name> --baseline <file>   mark everything up to <file> as applied, run nothing
// Node only, so it runs the same from PowerShell and bash. Reads .env itself when there is one.
import { existsSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import pg from "pg";
import { baseline, databaseName, MigrateError, migrate, withDatabase } from "../src/db/migrate.js";

const envPath = path.resolve(import.meta.dirname, "../.env");
if (existsSync(envPath)) process.loadEnvFile(envPath);

const { values } = parseArgs({
  options: { database: { type: "string" }, url: { type: "string" }, baseline: { type: "string" } },
  strict: true,
});

let url = values.url ?? process.env.DATABASE_URL;
if (!url) fail("Falta DATABASE_URL en .env y no se dio --url: corre pnpm plania:install.");
if (values.database) url = withDatabase(url, values.database);
const named = Boolean(values.database || values.url);
const name = databaseName(url);

if (values.baseline && !named) {
  fail(`Para marcar una base hay que nombrarla: pnpm db:migrate --database ${name} --baseline ${values.baseline}.`);
}

const c = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5_000 });
try {
  await c.connect();
} catch (e) {
  fail(`No se pudo abrir la base ${name} (${e instanceof Error ? e.message : String(e)}).`);
}
try {
  if (values.baseline) {
    const { marked } = await baseline(c, values.baseline);
    console.log(`Base ${name}: ${marked.length} migraciones marcadas como aplicadas, hasta ${marked.at(-1)}. No se corrió ninguna.`);
  } else {
    const r = await migrate(c, { named, log: (f) => console.log(`aplicada ${f}`) });
    for (const f of r.changed) console.log(`aviso: ${f} cambió desde que se aplicó; no se vuelve a correr.`);
    console.log(
      r.applied.length === 0
        ? `Base ${name}: nada que aplicar.`
        : `Base ${name}: ${r.applied.length} migraci${r.applied.length === 1 ? "ón aplicada" : "ones aplicadas"}.`,
    );
  }
} catch (e) {
  if (e instanceof MigrateError) {
    if (e.code === "NOT_NAMED") {
      fail(`La base ${name} no tiene registro de migraciones y no se nombró: si es la correcta, corre pnpm db:migrate --database ${name}.`);
    }
    if (e.code === "NEEDS_BASELINE") {
      fail(`La base ${name} tiene tablas y no tiene registro: márcala con pnpm db:migrate --database ${name} --baseline <última migración aplicada>.`);
    }
    if (e.code === "MIGRATION_FAILED") fail(`Falló ${e.file}; la base quedó como estaba antes de ese archivo. ${e.message}`);
    fail(e.message);
  }
  throw e;
} finally {
  await c.end().catch(() => {});
}

function fail(sentence: string): never {
  console.error(sentence);
  process.exit(1);
}
