import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";

export type Db = NodePgDatabase<typeof schema>;

// Handoff §9: one Pool per request, never a global pool across invocations.
// Neon Free sleeps after 5 min, so nothing should hold a connection between requests.
export function makeDb(): { db: Db; close: () => Promise<void> } {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  return { db: drizzle(pool, { schema }), close: () => pool.end() };
}

// Runs fn with a fresh Db and always closes the pool afterwards.
export async function withDb<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const { db, close } = makeDb();
  try {
    return await fn(db);
  } finally {
    await close();
  }
}
