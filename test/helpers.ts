// Shared setup: points the app at a throwaway plania_test database and rebuilds it from the migrations.
import { readFileSync, readdirSync } from "node:fs";
import { userInfo } from "node:os";
import pg from "pg";

const ADMIN_URL = `postgres://${userInfo().username}@localhost:5432/postgres`;
const TEST_DB = "plania_test";

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
}

// Drops and recreates plania_test, applies every migration, inserts the four projects.
// Returns a raw client for assertions; the caller ends it.
export async function resetTestDb(): Promise<pg.Client> {
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
    "insert into projects (slug, title) values ('micasa','MiCasa'), ('workia','Workia'), ('filmia','Filmia'), ('zigzag','Zigzag')",
  );
  return raw;
}
