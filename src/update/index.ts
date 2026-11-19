// PLA-I2-8: update an installed package to a newer one, without losing anything. Plania makes no call home: the
// buyer downloads the package file (pnpm release:pack's plania-<version>.tar.gz) and hands it to `pnpm update:plania`.
//
// The steps, each said in one sentence (ui/src/lib/actualizar.ts PASOS):
//   1. refuse while work is in flight (src/ops/in-flight.ts), as a restart does;
//   2. open the package beside the install, check its manifest (name, sha256 when the .sha256 is beside it) and that
//      its version is newer;
//   3. install its production dependencies there (nothing is built);
//   4. back up the database (the nightly job's dump) as plania-pre-update-<from>-to-<to>-<time>.sql.gz, which the
//      nightly pruning never touches;
//   5. stop the service;
//   6. swap the program files: the install folder becomes <root>.previous-<from>, the new release takes its place,
//      and the buyer's own files come across (.env, kit edits: src/update/kit-merge.ts);
//   7. check that a backup from today exists, then migrate with the recorded migrations in ONE transaction;
//   8. sync role prompts that nobody edited in Plania and report the ones that were (kit:sync without --force);
//   9. record the report (the screen shows it), start the service, point at the release notes.
// A failure before step 5 changes nothing. A failure at 6 or 7 puts the previous folder back (the database is as it
// was: the migration is all or nothing), starts the old version and names the backup and how to restore it.
// Every outside call is injected: tests run it on temp folders and a plania_test_* database.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { compareVersions, readManifest, type Manifest } from "../release.js";
import type { InFlight } from "../ops/in-flight.js";
import { keepKitEdits } from "./kit-merge.js";
import { STEPS, reportLines, type KitHeldRole, type UpdateReport } from "../../ui/src/lib/actualizar.js";
import { installLanguage } from "../language.js";
import { defineWords, say } from "../words.js";

// PLA-I2-10: the update's reasons and notes in the install's language (the steps are STEPS in
// ui/src/lib/actualizar.ts); the Spanish is unchanged.
export const UPDATE_WORDS = defineWords({
  es: {
    badSha: "su suma de verificación no coincide con el archivo .sha256",
    noFile: (file: string) => `no existe ${file}`,
    noManifest: "no trae release.json",
    noScreen: "no trae la pantalla armada",
    emptyBackup: "el archivo quedó vacío",
    stopFailed: (why: string) => `no se pudo apagar Plania (${why})`,
    swapFailed: (why: string) => `no se pudieron cambiar los archivos (${why})`,
    noFreshBackup: "no hay un respaldo de hoy",
    migrationFailed: (why: string) => `falló la actualización de la base (${why})`,
    kitFailed: (why: string) => `No se pudieron revisar los textos de los roles en Plania (${why}); corre pnpm kit:status después.`,
    recordFailed: (why: string) => `No se guardó el resumen para la pantalla (${why}).`,
  },
  en: {
    badSha: "its checksum does not match the .sha256 file",
    noFile: (file: string) => `${file} does not exist`,
    noManifest: "it has no release.json",
    noScreen: "it has no built screen",
    emptyBackup: "the file came out empty",
    stopFailed: (why: string) => `Plania could not be stopped (${why})`,
    swapFailed: (why: string) => `the files could not be replaced (${why})`,
    noFreshBackup: "there is no backup from today",
    migrationFailed: (why: string) => `the database update failed (${why})`,
    kitFailed: (why: string) => `The role texts in Plania could not be checked (${why}); run pnpm kit:status afterwards.`,
    recordFailed: (why: string) => `The summary for the screen was not saved (${why}).`,
  },
});

export type UpdateErrorCode =
  | "IN_FLIGHT"
  | "NOT_PACKAGE"
  | "BAD_PACKAGE"
  | "NOT_NEWER"
  | "DEPS_FAILED"
  | "BACKUP_FAILED"
  | "NO_FRESH_BACKUP"
  | "NO_SERVICE"
  | "STOP_FAILED"
  | "SWAP_FAILED"
  | "MIGRATION_FAILED"
  | "START_FAILED";

export class UpdateError extends Error {
  constructor(
    readonly code: UpdateErrorCode,
    message: string,
  ) {
    super(message);
  }
}

// The files of an install that are the buyer's, not the release's: carried into the new program files.
export const OWN_FILES = [".env", ".env.local"];

export type UpdateDeps = {
  // The installed package (holds release.json).
  root: string;
  packageFile: string;
  now: () => Date;
  log: (line: string) => void;
  inFlight: () => Promise<InFlight[]>;
  // Unpacks packageFile into dir (tar -xzf).
  extract: (packageFile: string, dir: string) => Promise<void>;
  // pnpm install --prod --frozen-lockfile in dir.
  installDeps: (dir: string) => Promise<void>;
  backupDir: string;
  // Writes a gzipped pg_dump of the database to file.
  dump: (file: string) => Promise<void>;
  // null: there is no service (--no-service); the buyer stopped Plania and starts it after.
  service: { stop: () => Promise<void>; start: () => Promise<void> } | null;
  // Applies the pending migrations from dir in one transaction; returns the files applied.
  migrate: (migrationsDir: string) => Promise<string[]>;
  // After the swap: role prompts edited in Plania that were left alone (kit:sync without --force).
  kitRoles?: () => Promise<KitHeldRole[]>;
  // Keeps the report for the screen (machine_state).
  record?: (report: UpdateReport) => Promise<void>;
  port?: number;
};

const why = (e: unknown) => (e instanceof Error ? e.message : String(e)).split("\n")[0]!.slice(0, 300);
const stampOf = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\..*$/, "").replace("T", "-");

// The local calendar day of a time, in this machine's zone.
const localDay = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

// A backup made today (local day): a non-empty plania-*.sql.gz in dir written today. Checked before any migration.
export function freshBackup(dir: string, now: Date): string | null {
  if (!existsSync(dir)) return null;
  for (const name of readdirSync(dir).sort().reverse()) {
    if (!/^plania-.*\.sql\.gz$/.test(name)) continue;
    const s = statSync(path.join(dir, name));
    if (s.size > 0 && localDay(s.mtime) === localDay(now)) return path.join(dir, name);
  }
  return null;
}

// The release folder inside an unpacked package: the folder itself or its one sub-folder that holds release.json.
function releaseDir(dir: string): string | null {
  if (existsSync(path.join(dir, "release.json"))) return dir;
  const subs = readdirSync(dir).filter((n) => statSync(path.join(dir, n)).isDirectory());
  for (const s of subs) if (existsSync(path.join(dir, s, "release.json"))) return path.join(dir, s);
  return null;
}

function checkSha(packageFile: string): void {
  const PASOS = say(STEPS);
  const side = `${packageFile}.sha256`;
  if (!existsSync(side)) return;
  const want = readFileSync(side, "utf8").trim().split(/\s+/)[0]?.toLowerCase();
  const got = createHash("sha256").update(readFileSync(packageFile)).digest("hex");
  if (want !== got) throw new UpdateError("BAD_PACKAGE", PASOS.badPackage(say(UPDATE_WORDS).badSha));
}

export async function update(deps: UpdateDeps): Promise<UpdateReport> {
  const { root, log } = deps;
  const now = deps.now();
  const stamp = stampOf(now);
  const PASOS = say(STEPS);
  const w = say(UPDATE_WORDS);

  log(PASOS.checking);
  const busy = await deps.inFlight();
  if (busy.length > 0) throw new UpdateError("IN_FLIGHT", PASOS.inFlight(busy.map((b) => b.text)));

  const current = readManifest(root);
  if (!current) throw new UpdateError("NOT_PACKAGE", PASOS.notPackage);
  if (!existsSync(deps.packageFile)) throw new UpdateError("BAD_PACKAGE", PASOS.badPackage(w.noFile(deps.packageFile)));

  log(PASOS.unpacking(path.basename(deps.packageFile)));
  const incoming = path.join(path.dirname(root), `.plania-incoming-${stamp}`);
  const cleanIncoming = () => rmSync(incoming, { recursive: true, force: true });
  let next: Manifest;
  let nextDir: string;
  try {
    checkSha(deps.packageFile);
    rmSync(incoming, { recursive: true, force: true });
    mkdirSync(incoming, { recursive: true });
    await deps.extract(deps.packageFile, incoming);
    const dir = releaseDir(incoming);
    const m = dir ? readManifest(dir) : null;
    if (!dir || !m) throw new UpdateError("BAD_PACKAGE", PASOS.badPackage(w.noManifest));
    if (!existsSync(path.join(dir, "dist/ui/index.html"))) throw new UpdateError("BAD_PACKAGE", PASOS.badPackage(w.noScreen));
    next = m;
    nextDir = dir;
  } catch (e) {
    cleanIncoming();
    if (e instanceof UpdateError) throw e;
    throw new UpdateError("BAD_PACKAGE", PASOS.badPackage(why(e)));
  }
  if (compareVersions(next.version, current.version) <= 0) {
    cleanIncoming();
    throw new UpdateError("NOT_NEWER", PASOS.notNewer(current.version, next.version));
  }
  log(PASOS.newer(current.version, next.version));

  log(PASOS.deps);
  try {
    await deps.installDeps(nextDir);
  } catch (e) {
    cleanIncoming();
    throw new UpdateError("DEPS_FAILED", PASOS.depsFailed(why(e)));
  }

  log(PASOS.backingUp);
  const backup = path.join(deps.backupDir, `plania-pre-update-${current.version}-to-${next.version}-${stamp}.sql.gz`);
  try {
    mkdirSync(deps.backupDir, { recursive: true });
    await deps.dump(backup);
    if (!existsSync(backup) || statSync(backup).size === 0) throw new Error(w.emptyBackup);
  } catch (e) {
    rmSync(backup, { force: true });
    cleanIncoming();
    throw new UpdateError("BACKUP_FAILED", PASOS.backupFailed(why(e)));
  }
  log(PASOS.backedUp(backup));

  if (deps.service) {
    log(PASOS.stopping);
    try {
      await deps.service.stop();
    } catch (e) {
      cleanIncoming();
      await deps.service.start().catch(() => {});
      throw new UpdateError("STOP_FAILED", PASOS.failedAfterStop(w.stopFailed(why(e)), current.version, backup));
    }
  }

  // From here a failure puts the previous program files back and starts them.
  const previous = `${root}.previous-${current.version}`;
  let swapped = false;
  const rollBack = async (code: UpdateErrorCode, reason: string): Promise<never> => {
    try {
      if (swapped) {
        const failed = `${root}.failed-${next.version}`;
        rmSync(failed, { recursive: true, force: true });
        renameSync(root, failed);
      }
      if (existsSync(previous) && !existsSync(root)) renameSync(previous, root);
    } finally {
      cleanIncoming();
      if (deps.service) await deps.service.start().catch(() => {});
    }
    throw new UpdateError(code, PASOS.failedAfterStop(reason, current.version, backup));
  };

  log(PASOS.swapping);
  let kept: ReturnType<typeof keepKitEdits> = [];
  try {
    rmSync(previous, { recursive: true, force: true });
    renameSync(root, previous);
    renameSync(nextDir, root);
    swapped = true;
    for (const f of OWN_FILES) if (existsSync(path.join(previous, f))) cpSync(path.join(previous, f), path.join(root, f));
    kept = keepKitEdits(previous, root, current.kit ?? null);
  } catch (e) {
    await rollBack("SWAP_FAILED", w.swapFailed(why(e)));
  }

  log(PASOS.migrating);
  if (!freshBackup(deps.backupDir, deps.now())) await rollBack("NO_FRESH_BACKUP", w.noFreshBackup);
  let applied: string[] = [];
  try {
    applied = await deps.migrate(path.join(root, "drizzle/migrations"));
  } catch (e) {
    await rollBack("MIGRATION_FAILED", w.migrationFailed(why(e)));
  }
  log(PASOS.migrated(applied.length));

  let roles: KitHeldRole[] = [];
  try {
    roles = deps.kitRoles ? await deps.kitRoles() : [];
  } catch (e) {
    log(w.kitFailed(why(e)));
  }
  const report: UpdateReport = { from: current.version, to: next.version, at: now.toISOString(), backup, kit_files: kept, kit_roles: roles };
  await deps.record?.(report).catch((e) => log(w.recordFailed(why(e))));
  cleanIncoming();
  // Only the latest previous version is kept for going back.
  const base = path.basename(root);
  for (const name of readdirSync(path.dirname(root))) {
    const full = path.join(path.dirname(root), name);
    if (full !== previous && name.startsWith(`${base}.previous-`)) rmSync(full, { recursive: true, force: true });
  }
  for (const line of reportLines(report, installLanguage())) log(line);

  if (deps.service) {
    log(PASOS.starting);
    try {
      await deps.service.start();
    } catch (e) {
      throw new UpdateError("START_FAILED", PASOS.startFailed(why(e), previous));
    }
  } else {
    log(PASOS.manualStart);
  }
  log(PASOS.done(next.version, deps.port ?? 3737));
  return report;
}
