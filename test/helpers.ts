// Shared setup: points the app at a throwaway plania_test_<hash> database and rebuilds it from the migrations.
import { createHash } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import path from "node:path";
import pg from "pg";
import { resetPool } from "../src/db/client.js";
import { MemoryCaminoKeyStore, useCaminoKeyStore } from "../src/camino/keys.js";
import { migrate } from "../src/db/migrate.js";

// PLANIA_TEST_PGUSER: the Postgres role the tests connect as, when it is not the OS user (a Windows machine whose
// only role is postgres). PLA-I2-4: on Windows it defaults to postgres, so `pnpm test` needs no prefix there.
export const PG_USER = encodeURIComponent(process.env.PLANIA_TEST_PGUSER || (process.platform === "win32" ? "postgres" : userInfo().username));
export const ADMIN_URL = `postgres://${PG_USER}@localhost:5432/postgres`;

// One database per checkout: the suffix is a stable hash of this repo's absolute root,
// so worktrees running `pnpm test` at the same time never drop each other's database.
const REPO_ROOT = path.resolve(import.meta.dirname, "..");
export const TEST_DB = `plania_test_${createHash("sha256").update(REPO_ROOT).digest("hex").slice(0, 6)}`;

// Guard: resetTestDb drops TEST_DB, so it must never be anything but a plania_test database.
if (!/^plania_test_[0-9a-f]{6}$/.test(TEST_DB)) throw new Error(`refusing to use test database ${TEST_DB}`);

export const TEST_DATABASE_URL = `postgres://${PG_USER}@localhost:5432/${TEST_DB}`;
export const TEST_BEARER = "test-token";
export const TEST_READ_TOKEN = "test-read-token";
export const TEST_CI_TOKEN = "test-ci-token";

// Must run before the app reads its env, so call it at module top level before importing src/.
export function useTestEnv(): void {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  process.env.MCP_BEARER_TOKEN = TEST_BEARER;
  process.env.MCP_READ_TOKEN = TEST_READ_TOKEN;
  process.env.PLANIA_CI_TOKEN = TEST_CI_TOKEN;
  process.env.SESSION_SECRET = "test-session-secret-that-is-at-least-32-bytes";
  process.env.PLANIA_JOBS = "0";
  // PLA-I60-2: admission's free-memory and disk floor reads this machine; tests that check it pass deps.machine.
  process.env.PLANIA_MACHINE_CHECK = "0";
  // PLA-I2-4: machine-bound parts (test copy, stills, base lever) count as available; i2-4 tests decide per case.
  process.env.PLANIA_TEST_SYSTEM_SUPPORT = "all";
  // PLA-170: Camino's keys live in a memory store, never this machine's keychain (the Vercel poller reads it now).
  useCaminoKeyStore(new MemoryCaminoKeyStore());
  // AUDIT-2: tests never read the repo's own kit (its skills and default kits would join every run). A test that
  // wants a kit points PLANIA_KIT_DIR at its own folder.
  process.env.PLANIA_KIT_DIR ??= path.join(REPO_ROOT, "test", "fixtures", "no-kit");
  // PLA-I72-4: the kept test passwords go to a scratch file, never the user's ~/.config. PLA-159: the file this
  // chose is removed when the test process ends (one was left in the temp folder on every run); a path a test set
  // itself stays the test's to clean.
  if (!process.env.PLANIA_TEST_PASSWORDS_FILE) {
    const file = path.join(tmpdir(), `plania-test-passwords-${process.pid}.json`);
    process.env.PLANIA_TEST_PASSWORDS_FILE = file;
    process.once("exit", () => rmSync(file, { force: true }));
  }
}

// Drops and recreates this checkout's test database, applies every migration, inserts the four projects.
// Returns a raw client for assertions; the caller ends it.
export async function resetTestDb(): Promise<pg.Client> {
  // The shared pool holds connections to the database about to be dropped; the next query opens a fresh one.
  await resetPool();
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${TEST_DB} with (force)`);
  await admin.query(`create database ${TEST_DB}`);
  await admin.end();

  const raw = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await raw.connect();
  // PLA-I2-1: the same migrate as `pnpm db:migrate`, so every test database carries the migration record.
  await migrate(raw, { named: true });
  await raw.query(
    "insert into projects (slug, title, key_prefix) values ('micasa','MiCasa','MIC'), ('workia','Workia','WRK'), ('filmia','Filmia','FIL'), ('zigzag','Zigzag','ZIG')",
  );
  return raw;
}

// PLA-I36-11: the owner's code in tests. A fixed secret in a memory store (never the keychain); each call moves
// the TOTP clock one step, so two codes in the same test never share a time step.
const OWNER_SECRET = Buffer.alloc(20, 7);
let ownerTick = 0;
export async function useOwnerCode(enrolled = true): Promise<void> {
  const { MemoryOwnerSecretStore, useOwnerStore } = await import("../src/auth/owner-store.js");
  const store = new MemoryOwnerSecretStore();
  if (enrolled) await store.set(OWNER_SECRET);
  useOwnerStore(store);
}
export async function ownerCode(): Promise<string> {
  const { ownerClock, totp } = await import("../src/auth/owner-totp.js");
  const base = Date.now();
  ownerTick += 1;
  const at = base + ownerTick * 30_000;
  ownerClock.now = () => at;
  return totp(OWNER_SECRET, at);
}
