import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";

export type Db = NodePgDatabase<typeof schema>;

// One pool for the whole process (Plania runs as one long-lived server on the Mac).
// Created on first use, so tests can set DATABASE_URL before anything connects.
let shared: { pool: pg.Pool; db: Db } | null = null;

function sharedDb(): { pool: pg.Pool; db: Db } {
  if (shared) return shared;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  // allowExitOnIdle: idle connections never keep a finished script or test process alive.
  const pool = new pg.Pool({ connectionString: url, max: 10, idleTimeoutMillis: 30_000, allowExitOnIdle: true });
  // An idle client that loses its connection (Postgres restart, a test dropping its database)
  // is removed by the pool; without a listener the error would crash the process.
  pool.on("error", (err) => console.error("[db] idle client error:", err.message));
  shared = { pool, db: drizzle(pool, { schema }) };
  return shared;
}

// The shared db. close is a no-op kept for callers written for the per-request pool.
export function makeDb(): { db: Db; close: () => Promise<void> } {
  return { db: sharedDb().db, close: async () => {} };
}

// Runs fn with the shared Db.
export async function withDb<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  return fn(sharedDb().db);
}

// Ends the shared pool; the next call opens a new one. For tests that drop and rebuild the database.
export async function resetPool(): Promise<void> {
  const old = shared;
  shared = null;
  if (old) await old.pool.end();
}
