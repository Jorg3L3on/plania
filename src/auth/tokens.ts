import { createHash, randomBytes } from "node:crypto";
import type { Db } from "../db/client.js";
import type { Actor } from "../db/schema.js";
import { iso, type Q } from "../mcp/tx.js";
import { writeVia } from "../runner/limits.js";
import { readerOf } from "../store/pg.js";
import type { Row } from "../store/types.js";

// Per-agent tokens (2.1, R-04). Issued on screen, shown once, stored as a sha256. Each one names the
// agent and machine it belongs to and the scopes it may use: read (read tools), write (every write
// but ops), ops (set_env, reserve_sequence). Revoking a token stops its next call.
// Tokens belong to no project: their writes go to the store under the company's empty id (writeVia).

export const TOKEN_SCOPES = ["read", "write", "ops"] as const;
export type TokenScope = (typeof TOKEN_SCOPES)[number];
export const TOKEN_PREFIX = "pla_";

type TokenRow = Row<"agentTokens">;

// A row id as Postgres prints it. Ids were matched as text, so only this canonical lowercase form names a token.
const UUID_TEXT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

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

// Live tokens first, then revoked ones, newest first within each.
export async function listTokens(db: Q) {
  const rows = await readerOf(db).find("agentTokens", {}, { orderBy: [{ column: "createdAt", desc: true }] });
  // A stable sort keeps the store's newest-first order inside each group.
  rows.sort((a, b) => Number(a.revokedAt !== null) - Number(b.revokedAt !== null));
  return rows.map(tokenShape);
}

export async function issueToken(
  db: Q,
  input: { name: string; agent: string; machine?: string | null; scopes: TokenScope[] },
  by: Actor,
) {
  const secret = `${TOKEN_PREFIX}${randomBytes(30).toString("base64url")}`;
  const row = await writeVia(db, (uow) =>
    uow.insert("agentTokens", {
      name: input.name.trim(),
      agent: input.agent.trim(),
      machine: input.machine?.trim() || null,
      scopes: [...new Set(input.scopes)],
      tokenHash: hashToken(secret),
      prefix: secret.slice(0, TOKEN_PREFIX.length + 6),
      createdBy: by,
    }),
  );
  return { token: tokenShape(row), secret };
}

// A token revoked again keeps its first revoked_at; its reason is replaced (by null when none is given).
export async function revokeToken(db: Q, id: string, reason?: string) {
  if (typeof id !== "string" || !UUID_TEXT.test(id)) return null;
  const row = await writeVia(db, async (uow) => {
    const cur = await uow.get("agentTokens", { id });
    if (!cur) return undefined;
    const [changed] = await uow.update("agentTokens", { id }, { revokedAt: cur.revokedAt ?? uow.now, revokedReason: reason ?? null });
    return changed;
  });
  return row ? tokenShape(row) : null;
}

export type Identity = { tokenId: string; agent: string; machine: string | null; scopes: TokenScope[] };

// The live token behind a secret, or null. last_used_at moves at most once a minute.
export async function findToken(db: Db, secret: string): Promise<Identity | null> {
  if (!secret.startsWith(TOKEN_PREFIX)) return null;
  const row = await readerOf(db).get("agentTokens", { tokenHash: hashToken(secret), revokedAt: null });
  if (!row) return null;
  if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 60_000) {
    await writeVia(db, (uow) => uow.update("agentTokens", { id: row.id }, { lastUsedAt: uow.now }));
  }
  return { tokenId: row.id, agent: row.agent, machine: row.machine, scopes: row.scopes as TokenScope[] };
}
