import { mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import type { Db } from "../db/client.js";
import type { Finding } from "../mcp/audit.js";
import type { Q } from "../mcp/tx.js";
import { writeVia } from "../runner/limits.js";
import { DevvaStore } from "../store/devva.js";
import { storeOfHandle } from "../store/handles.js";
import { readerOf } from "../store/port.js";
import type { Job } from "./index.js";

// The nightly backup: once per local day after 03:00 (PLANIA_TZ), the store's commit log as gzipped text in
// ~/plania-backups/plania-<YYYYMMDD>.devva.jsonl.gz. A dump only counts after it has been loaded into a
// throwaway store and compared row by row with the live one. Keeps the last KEEP daily dumps; anything
// else in the folder is never touched. The last run lives in machine_state (key "backup"), so
// GET /api/machine and the audit can tell when it failed or went stale.

export const KEEP = 14;
export const STALE_MS = 48 * 3600_000;
const AFTER_HOUR = 3;
const STATE_KEY = "backup";
const DAILY = /^plania-(\d{8})\.devva\.jsonl\.gz$/;

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

export async function backupState(db: Q): Promise<BackupState> {
  const row = await readerOf(db).get("machineState", { key: STATE_KEY });
  return { ...EMPTY, ...(row?.value as Partial<BackupState> | undefined) };
}

// The machine_state row written whole; machine state belongs to no project.
async function saveState(db: Q, value: BackupState): Promise<void> {
  await writeVia(db, async (uow) => {
    if (await uow.get("machineState", { key: STATE_KEY })) await uow.update("machineState", { key: STATE_KEY }, { value, updatedAt: uow.now });
    else await uow.insert("machineState", { key: STATE_KEY, value });
  });
}

// Deletes daily dumps beyond the newest KEEP; anything else in the folder stays.
export async function prune(dir: string, keep = KEEP): Promise<string[]> {
  const daily = (await readdir(dir)).filter((f) => DAILY.test(f)).sort();
  const old = daily.slice(0, Math.max(0, daily.length - keep));
  for (const f of old) await rm(path.join(dir, f), { force: true });
  return old;
}

// The dump, written only after the restore drill agrees with the live store.
async function dumpChecked(live: DevvaStore, file: string): Promise<void> {
  const text = await live.dump();
  const drill = await DevvaStore.open({ prefix: `drill_${process.pid}_${Date.now().toString(36)}` });
  try {
    await drill.restore(text);
    const [a, b] = [await live.fingerprint(), await drill.fingerprint()];
    const differing = [...a].filter(([k, v]) => b.get(k) !== v).length + [...b.keys()].filter((k) => !a.has(k)).length;
    if (differing > 0) throw new Error(`restore drill: ${differing} rows differ from the live store`);
  } finally {
    await drill.purge();
    drill.close();
  }
  await writeFile(file, gzipSync(text));
}

// One tick: dumps when today's dump is still missing and it is past 03:00 local time.
export async function runBackup(db: Db, now: Date, deps: BackupDeps = {}): Promise<{ dumped: number; pruned: number; failed: number }> {
  const tz = deps.tz ?? (process.env.PLANIA_TZ || "America/Mexico_City");
  const { day, hour } = localParts(now, tz);
  const state = await backupState(db);
  if (hour < AFTER_HOUR || state.day === day) return { dumped: 0, pruned: 0, failed: 0 };

  const dir = deps.dir ?? backupDir();
  const live = storeOfHandle(db)?.store;
  const file = path.join(dir, `plania-${day.replaceAll("-", "")}.devva.jsonl.gz`);
  const tmp = `${file}.partial`;
  try {
    await mkdir(dir, { recursive: true });
    if (!(live instanceof DevvaStore)) throw new Error("the store has no dump");
    await dumpChecked(live, tmp);
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
  return [{ code: "BACKUP_STALE", key: null, detail: s.error ? `${detail}; last attempt failed: ${s.error}` : detail, fix_hint: "check the devva engine and ~/plania-backups; the backup job retries every hour" }];
}

export const backupJob: Job = {
  name: "backup",
  intervalMs: 60 * 60 * 1000,
  runOnce: (db, now) => runBackup(db, now),
};
