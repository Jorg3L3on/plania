// PLA-I68-6: the owner approves one exact migration file that destroys data (its sha256), so Publicar lets it through;
// a changed file needs a new approval. And the row count of a LOCAL database's migration table, to show what ran
// there (never a production database: agents and Plania's reads stay off real data).
import { sql } from "drizzle-orm";
import pg from "pg";
import type { Db } from "../db/client.js";
import { camino } from "../db/schema.js";
import { findProject } from "../mcp/queries.js";
import { addHistory, caminoRow } from "./store.js";
import { caminoSay } from "./words.js";

export async function approveMigration(db: Db, slug: string, file: string, digest: string) {
  const p = await findProject(db, slug);
  const row = await caminoRow(db, p.id);
  const config = { ...row.config, approvals: { ...(row.config.approvals ?? {}), [file]: digest } };
  await db
    .insert(camino)
    .values({ projectId: p.id, config, version: 1 })
    .onConflictDoUpdate({ target: camino.projectId, set: { config, version: sql`${camino.version} + 1`, updatedAt: new Date() } });
  await addHistory(db, p.id, { who: "owner", label: caminoSay().approved(file), dest: "plania", undo: caminoSay().undoApproved, detail: { sha256: digest } });
  return { approved: file, sha256: digest };
}

const TABLES: Record<string, string> = {
  drizzle: "select count(*)::int as n from drizzle.__drizzle_migrations",
  prisma: "select count(*)::int as n from _prisma_migrations where finished_at is not null",
  supabase: "select count(*)::int as n from supabase_migrations.schema_migrations",
  knex: "select count(*)::int as n from knex_migrations",
};

export async function localMigrationCount(database: string, tool: string): Promise<{ ok: boolean; count: number | null }> {
  const url = process.env.DATABASE_URL;
  if (!url || !TABLES[tool]) return { ok: false, count: null };
  const u = new URL(url);
  if (!["localhost", "127.0.0.1", "::1"].includes(u.hostname)) return { ok: false, count: null };
  u.pathname = `/${database}`;
  const c = new pg.Client({ connectionString: u.toString(), connectionTimeoutMillis: 3_000 });
  try {
    await c.connect();
    const r = await c.query<{ n: number }>(TABLES[tool]!);
    return { ok: true, count: r.rows[0]?.n ?? 0 };
  } catch {
    return { ok: false, count: null };
  } finally {
    await c.end().catch(() => {});
  }
}
