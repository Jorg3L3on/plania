import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { agentTokens, type Actor } from "../db/schema.js";
import { iso, type Q } from "../mcp/tx.js";

// Per-agent tokens (2.1, R-04). Issued on screen, shown once, stored as a sha256. Each one names the
// agent and machine it belongs to and the scopes it may use: read (read tools), write (every write
// but ops), ops (set_env, reserve_sequence). Revoking a token stops its next call.

export const TOKEN_SCOPES = ["read", "write", "ops"] as const;
export type TokenScope = (typeof TOKEN_SCOPES)[number];
export const TOKEN_PREFIX = "pla_";

type TokenRow = typeof agentTokens.$inferSelect;

export const hashToken = (secret: string) => createHash("sha256").update(secret).digest("hex");

export function tokenShape(t: TokenRow) {
  return {
    id: t.id,
    name: t.name,
    agent: t.agent,
    machine: t.machine,
    scopes: t.scopes,
    prefix: t.prefix,
    created_at: iso(t.createdAt),
    last_used_at: iso(t.lastUsedAt),
    revoked_at: iso(t.revokedAt),
    revoked_reason: t.revokedReason,
  };
}

export async function listTokens(db: Q) {
  const rows = await db.select().from(agentTokens).orderBy(sql`${agentTokens.revokedAt} is not null, ${agentTokens.createdAt} desc`);
  return rows.map(tokenShape);
}

export async function issueToken(
  db: Q,
  input: { name: string; agent: string; machine?: string | null; scopes: TokenScope[] },
  by: Actor,
) {
  const secret = `${TOKEN_PREFIX}${randomBytes(30).toString("base64url")}`;
  const [row] = await db
    .insert(agentTokens)
    .values({
      name: input.name.trim(),
      agent: input.agent.trim(),
      machine: input.machine?.trim() || null,
      scopes: [...new Set(input.scopes)],
      tokenHash: hashToken(secret),
      prefix: secret.slice(0, TOKEN_PREFIX.length + 6),
      createdBy: by,
    })
    .returning();
  return { token: tokenShape(row!), secret };
}

export async function revokeToken(db: Q, id: string, reason?: string) {
  const [row] = await db
    .update(agentTokens)
    .set({ revokedAt: sql`coalesce(${agentTokens.revokedAt}, now())`, revokedReason: reason ?? null })
    .where(sql`${agentTokens.id}::text = ${id}`)
    .returning();
  return row ? tokenShape(row) : null;
}

export type Identity = { tokenId: string; agent: string; machine: string | null; scopes: TokenScope[] };

// The live token behind a secret, or null. last_used_at moves at most once a minute.
export async function findToken(db: Db, secret: string): Promise<Identity | null> {
  if (!secret.startsWith(TOKEN_PREFIX)) return null;
  const [row] = await db
    .select()
    .from(agentTokens)
    .where(and(eq(agentTokens.tokenHash, hashToken(secret)), isNull(agentTokens.revokedAt)))
    .limit(1);
  if (!row) return null;
  if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 60_000) {
    await db.update(agentTokens).set({ lastUsedAt: sql`now()` }).where(eq(agentTokens.id, row.id));
  }
  return { tokenId: row.id, agent: row.agent, machine: row.machine, scopes: row.scopes as TokenScope[] };
}
