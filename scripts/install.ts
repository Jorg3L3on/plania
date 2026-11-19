// PLA-I2-1: install Plania on a new machine in one command.
//   pnpm plania:install                       database `plania` on localhost:5432, created here
//   pnpm plania:install --database <name>     another database name (an existing one is used only when named)
//   pnpm plania:install --url postgres://user@host:5432/<name>
// Machine check, create the database, write .env with generated secrets, migrate, build the screen when it is
// missing. Node only, so it runs the same from PowerShell and bash. Safe to run again.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv, parseArgs } from "node:util";
import { install, InstallError, type MachineCheck } from "../src/db/install.js";
import { withDatabase } from "../src/db/migrate.js";

const repoDir = path.resolve(import.meta.dirname, "..");
const envPath = path.join(repoDir, ".env");
const examplePath = path.join(repoDir, ".env.example");
const DEFAULT_URL = "postgres://localhost:5432/plania";

const { values } = parseArgs({
  options: { database: { type: "string" }, url: { type: "string" }, "skip-screen": { type: "boolean" } },
  strict: true,
});

// The URL: --url, else the one already in .env (a re-run), else the default; --database renames it.
const existing = existsSync(envPath) ? parseEnv(readFileSync(envPath, "utf8")).DATABASE_URL : undefined;
let url = values.url ?? (existing || DEFAULT_URL);
if (values.database) url = withDatabase(url, values.database);

// PLA-I2-12 builds the machine check in its own module. Until it lands this is the no-op; afterwards the install
// passes it here.
const machineCheck: MachineCheck | undefined = undefined;

async function buildScreen(): Promise<void> {
  if (values["skip-screen"] || existsSync(path.join(repoDir, "dist/ui/index.html"))) return;
  console.log("Construyendo la pantalla…");
  execFileSync(process.execPath, [path.join(repoDir, "node_modules/vite/bin/vite.js"), "build"], {
    cwd: repoDir,
    stdio: "inherit",
  });
}

try {
  const r = await install({
    url,
    named: Boolean(values.database || values.url),
    envPath,
    examplePath,
    machineCheck,
    buildScreen,
    log: (line) => console.log(line),
  });
  console.log(
    `Listo: base ${r.database}${r.created ? " (nueva)" : ""}, ${r.applied.length} migraciones aplicadas. Enciende Plania con pnpm start.`,
  );
} catch (e) {
  if (e instanceof InstallError) {
    console.error(e.message);
    process.exit(1);
  }
  throw e;
}
