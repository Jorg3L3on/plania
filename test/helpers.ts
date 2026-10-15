// Shared setup: points the app at a throwaway plania_test_<hash> database and rebuilds it from the migrations.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { userInfo } from "node:os";
import path from "node:path";
import pg from "pg";
import { resetPool } from "../src/db/client.js";

const ADMIN_URL = `postgres://${userInfo().username}@localhost:5432/postgres`;

// One database per checkout: the suffix is a stable hash of this repo's absolute root,
// so worktrees running `pnpm test` at the same time never drop each other's database.
const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const TEST_DB = `plania_test_${createHash("sha256").update(REPO_ROOT).digest("hex").slice(0, 6)}`;

// Guard: resetTestDb drops TEST_DB, so it must never be anything but a plania_test database.
if (!/^plania_test_[0-9a-f]{6}$/.test(TEST_DB)) throw new Error(`refusing to use test database ${TEST_DB}`);

export const TEST_DATABASE_URL = `postgres://${userInfo().username}@localhost:5432/${TEST_DB}`;
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
  const dir = new URL("../drizzle/migrations/", import.meta.url);
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    await raw.query(readFileSync(new URL(f, dir), "utf8"));
  }
  await raw.query(
    "insert into projects (slug, title, key_prefix) values ('micasa','MiCasa','MIC'), ('workia','Workia','WRK'), ('filmia','Filmia','FIL'), ('zigzag','Zigzag','ZIG')",
  );
  return raw;
}
