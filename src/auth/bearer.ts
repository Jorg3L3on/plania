import { timingSafeEqual } from "node:crypto";
import type { Db } from "../db/client.js";
import { findToken, type Identity, type TokenScope } from "./tokens.js";

// What a Bearer token may do. Agent tokens (agent_tokens, issued on screen) carry their scopes and
// identify the agent; the three static env tokens keep working, unbound: MCP_BEARER_TOKEN is
// read+write+ops, MCP_READ_TOKEN read only, PLANIA_CI_TOKEN the inbound hooks only.
export type Scope = TokenScope | "hooks";
export type Auth = { scopes: Scope[]; identity?: Identity };

const STATIC: [string, Scope[]][] = [
  ["MCP_BEARER_TOKEN", ["read", "write", "ops"]],
  ["MCP_READ_TOKEN", ["read"]],
  ["PLANIA_CI_TOKEN", ["hooks"]],
];

function same(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function staticScopes(token: string): Scope[] | null {
  for (const [env, scopes] of STATIC) {
    const expected = process.env[env];
    if (expected && same(token, expected)) return scopes;
  }
  return null;
}

export async function resolveBearer(db: Db, header: string | undefined): Promise<Auth | null> {
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length);
  const scopes = staticScopes(token);
  if (scopes) return { scopes };
  const identity = await findToken(db, token);
  return identity ? { scopes: identity.scopes, identity } : null;
}
