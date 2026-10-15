import { spawn } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import { eq, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { machineState } from "../db/schema.js";
import type { Finding } from "../mcp/audit.js";
import type { Q } from "../mcp/tx.js";
import type { Job } from "./index.js";

// The nightly backup (2.9 fix b): once per local day after 03:00 (PLANIA_TZ), `pg_dump --no-owner`
// of DATABASE_URL, gzipped into ~/plania-backups/plania-<YYYYMMDD>.sql.gz. Keeps the last KEEP daily
// dumps; the hand-made plania-pre-* dumps are never touched. The last run lives in machine_state
// (key "backup"), so GET /api/machine and the audit can tell when it failed or went stale.

export const KEEP = 14;
export const STALE_MS = 48 * 3600_000;
const AFTER_HOUR = 3;
const DAILY = /^plania-(\d{8})\.sql\.gz$/;

export type BackupState = {
  at: string | null; // last success
  path: string | null;
  bytes: number | null;
  day: string | null; // local YYYY-MM-DD of the last success
  error: string | null; // last attempt's error, null once one succeeds
  attempted_at: string | null;
};
const EMPTY: BackupState = { at: null, path: null, bytes: null, day: null, error: null, attempted_at: null };

export type BackupDeps = {
  dir?: string;
  url?: string;
  pgDump?: string;
  tz?: string;
};

export function backupDir(): string {
  return process.env.PLANIA_BACKUP_DIR || path.join(homedir(), "plania-backups");
}

// Local date and hour in the screen's time zone.
function localParts(now: Date, tz: string): { day: string; hour: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

// PLANIA_PG_BIN (a directory or the binary itself), else Homebrew's pg_dump for the server's major
// version (a newer pg_dump writes SET lines an older server rejects on restore), else Homebrew's default.
async function findPgDump(db: Q): Promise<string> {
  const env = process.env.PLANIA_PG_BIN;
  if (env) return env.endsWith("pg_dump") ? env : path.join(env, "pg_dump");
  const major = await db
    .execute<{ v: string }>(sql`select current_setting('server_version_num') as v`)
    .then((r) => Math.floor(Number(r.rows[0]?.v ?? 0) / 10000))
    .catch(() => 0);
  const candidates = [
    ...(major ? [`/opt/homebrew/opt/postgresql@${major}/bin/pg_dump`, `/usr/local/opt/postgresql@${major}/bin/pg_dump`] : []),
    "/opt/homebrew/bin/pg_dump",
    "/usr/local/bin/pg_dump",
  ];
  return candidates.find((c) => existsSync(c)) ?? "pg_dump";
}

export async function backupState(db: Q): Promise<BackupState> {
  const [row] = await db.select().from(machineState).where(eq(machineState.key, "backup")).limit(1);
  return { ...EMPTY, ...(row?.value as Partial<BackupState> | undefined) };
}

async function saveState(db: Q, value: BackupState): Promise<void> {
  await db
    .insert(machineState)
    .values({ key: "backup", value })
    .onConflictDoUpdate({ target: machineState.key, set: { value, updatedAt: sql`now()` } });
}

// pg_dump's stdout through gzip into `file`. Rejects with pg_dump's stderr when it fails.
function dumpTo(pgDump: string, url: string, file: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(pgDump, ["--no-owner", url], { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += String(d)));
    const written = pipeline(child.stdout, createGzip(), createWriteStream(file));
    let exit: number | null | undefined;
    child.on("error", reject);
    child.on("close", (code) => {
      exit = code;
      written.then(
        () => (exit === 0 ? resolve() : reject(new Error(stderr.trim().split("\n").pop() || `pg_dump exited ${exit}`))),
        reject,
      );
    });
  });
}

// Deletes daily dumps beyond the newest KEEP; anything else in the folder stays.
export async function prune(dir: string, keep = KEEP): Promise<string[]> {
  const daily = (await readdir(dir)).filter((f) => DAILY.test(f)).sort();
  const old = daily.slice(0, Math.max(0, daily.length - keep));
  for (const f of old) await rm(path.join(dir, f), { force: true });
  return old;
}

// One tick: dumps when today's dump is still missing and it is past 03:00 local time.
export async function runBackup(db: Db, now: Date, deps: BackupDeps = {}): Promise<{ dumped: number; pruned: number; failed: number }> {
  const tz = deps.tz ?? (process.env.PLANIA_TZ || "America/Mexico_City");
  const { day, hour } = localParts(now, tz);
  const state = await backupState(db);
  if (hour < AFTER_HOUR || state.day === day) return { dumped: 0, pruned: 0, failed: 0 };

  const dir = deps.dir ?? backupDir();
  const url = deps.url ?? process.env.DATABASE_URL;
  const file = path.join(dir, `plania-${day.replaceAll("-", "")}.sql.gz`);
  const tmp = `${file}.partial`;
  try {
    if (!url) throw new Error("DATABASE_URL is not set");
    await mkdir(dir, { recursive: true });
    await dumpTo(deps.pgDump ?? (await findPgDump(db)), url, tmp);
    await rename(tmp, file);
    const { size } = await stat(file);
    const pruned = await prune(dir);
    await saveState(db, { at: now.toISOString(), path: file, bytes: size, day, error: null, attempted_at: now.toISOString() });
    return { dumped: 1, pruned: pruned.length, failed: 0 };
  } catch (e) {
    await rm(tmp, { force: true });
    await saveState(db, { ...state, error: e instanceof Error ? e.message : String(e), attempted_at: now.toISOString() });
    return { dumped: 0, pruned: 0, failed: 1 };
  }
}

// What GET /api/machine shows: the last good dump, and the last error when the latest attempt failed.
export async function backupStatus(db: Q) {
  const s = await backupState(db);
  return { at: s.at, path: s.path, bytes: s.bytes, error: s.error, attempted_at: s.attempted_at };
}

// The audit's word on it (project null, served with the machine's findings): no dump in 48 h.
// Nothing until the job has tried once, so a fresh install is quiet until its first night.
export function backupFindings(s: Pick<BackupState, "at" | "error" | "attempted_at">, now = new Date()): Finding[] {
  if (!s.attempted_at) return [];
  if (s.at && now.getTime() - new Date(s.at).getTime() <= STALE_MS) return [];
  const detail = s.at ? `last backup ${s.at}, more than 48 h ago` : "no backup recorded yet";
  return [{ code: "BACKUP_STALE", key: null, detail: s.error ? `${detail}; last attempt failed: ${s.error}` : detail, fix_hint: "check pg_dump (PLANIA_PG_BIN) and ~/plania-backups; the backup job retries every hour" }];
}

export const backupJob: Job = {
  name: "backup",
  intervalMs: 60 * 60 * 1000,
  runOnce: (db, now) => runBackup(db, now),
};
