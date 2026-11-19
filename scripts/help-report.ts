// PLA-I2-18: pnpm help:report — the help report for when the screen does not start. Writes
// plania-ayuda-<date>.txt in the current folder (or --out <file>, or - for the terminal) and prints where.
// It works without a database: then the file says the database did not answer and carries what it could read.
// It sends nothing anywhere.
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "../src/db/schema.js";
import { buildHelpReport, helpReportFileName, renderHelpReport } from "../src/help-report/index.js";

const { values } = parseArgs({ options: { out: { type: "string" } }, strict: true });
const root = path.resolve(import.meta.dirname, "..");

const report = await buildHelpReport({
  root,
  openDb: async () => {
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 5_000, allowExitOnIdle: true });
    pool.on("error", () => undefined);
    return { db: drizzle(pool, { schema }), close: () => pool.end() };
  },
});
const text = renderHelpReport(report);
if (values.out === "-") process.stdout.write(text);
else {
  const file = path.resolve(values.out ?? helpReportFileName(report));
  await writeFile(file, text, { mode: 0o600 });
  console.log(`Informe guardado en ${file}. Revísalo y, si quieres, mándalo a quien te ayuda: Plania no lo envía.`);
}
