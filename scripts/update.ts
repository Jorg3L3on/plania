// PLA-I2-8: pnpm update:plania <package file> — update this install to a newer release package, keeping the data,
// the settings and the owner's kit edits (src/update/index.ts says every step).
//   pnpm update:plania ~/Downloads/plania-0.2.0.tar.gz
//   pnpm update:plania <file> --no-service     Plania is not a service here: stop it first, start it after
// Run it from the installed folder. It refuses while work is in flight.
import { execFileSync, execSync } from "node:child_process";
import { homedir, userInfo } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { eq } from "drizzle-orm";
import pg from "pg";
import { makeDb, resetPool, withDb } from "../src/db/client.js";
import { machineState, projects } from "../src/db/schema.js";
import { migrate, readMigrations } from "../src/db/migrate.js";
import { backupDir, dumpTo, findPgDump } from "../src/jobs/backup.js";
import { inFlight } from "../src/ops/in-flight.js";
import { detectSystem, serviceInstalled, startCommand, stopCommand } from "../src/packaging/service.js";
import { update, UpdateError } from "../src/update/index.js";
import { PASOS, type KitHeldRole } from "../ui/src/lib/actualizar.js";
import { kitStatus, kitSync } from "./kit.js";

const { values, positionals } = parseArgs({
  options: { "no-service": { type: "boolean", default: false }, port: { type: "string", default: "3737" } },
  allowPositionals: true,
  strict: true,
});
const packageFile = positionals[0];
if (!packageFile) {
  console.error("Uso: pnpm update:plania <archivo del paquete, plania-<versión>.tar.gz>");
  process.exit(2);
}
const root = path.resolve(import.meta.dirname, "..");
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Falta DATABASE_URL en .env: corre pnpm update:plania desde la carpeta donde instalaste Plania.");
  process.exit(1);
}

const sys = { platform: process.platform, uid: userInfo().uid, home: homedir(), ...detectSystem() };
let service: { stop: () => Promise<void>; start: () => Promise<void> } | null = null;
if (!values["no-service"]) {
  const stop = stopCommand(sys);
  const start = startCommand(sys);
  if (!stop || !start || !serviceInstalled(sys)) {
    console.error(PASOS.noService);
    process.exit(1);
  }
  service = {
    stop: async () => void execFileSync(stop.cmd, stop.args, { stdio: "inherit" }),
    start: async () => void execFileSync(start.cmd, start.args, { stdio: "inherit" }),
  };
}

const promptsProject = process.env.PLANIA_PROMPTS_PROJECT || "plania";

try {
  await update({
    root,
    packageFile: path.resolve(packageFile),
    now: () => new Date(),
    log: (line) => console.log(line),
    inFlight: () => inFlight(makeDb().db),
    extract: async (file, dir) => void execFileSync("tar", ["-xzf", file, "-C", dir], { stdio: "inherit" }),
    installDeps: async (dir) => void execSync("pnpm install --prod --frozen-lockfile", { cwd: dir, stdio: "inherit" }),
    backupDir: backupDir(),
    dump: async (file) => dumpTo(await withDb((db) => findPgDump(db)), url, file),
    service,
    migrate: async (dir) => {
      const c = new pg.Client({ connectionString: url });
      await c.connect();
      try {
        return (await migrate(c, { files: readMigrations(dir), atomic: true })).applied;
      } finally {
        await c.end().catch(() => {});
      }
    },
    // Role prompts nobody edited in Plania take the release's text; edited ones stay and are reported.
    kitRoles: () =>
      withDb(async (db): Promise<KitHeldRole[]> => {
        const [p] = await db.select({ id: projects.id }).from(projects).where(eq(projects.slug, promptsProject)).limit(1);
        if (!p) return [];
        await kitSync(db, { force: false });
        return (await kitStatus(db))
          .filter((r) => r.state === "doc_newer" || r.state === "both_changed")
          .map((r) => ({ role: r.role, title: r.title, state: r.state as KitHeldRole["state"] }));
      }),
    record: (report) =>
      withDb(async (db) => {
        await db
          .insert(machineState)
          .values({ key: "update.last", value: report })
          .onConflictDoUpdate({ target: machineState.key, set: { value: report, updatedAt: new Date() } });
      }),
    port: Number(values.port),
  });
  await resetPool().catch(() => {});
} catch (e) {
  await resetPool().catch(() => {});
  if (e instanceof UpdateError) {
    console.error(e.message);
    process.exit(1);
  }
  throw e;
}
