import { timingSafeEqual } from "node:crypto";

// Three Bearer tokens, three scopes: rw for agents (MCP_BEARER_TOKEN), ro for planning sessions that
// must not write (MCP_READ_TOKEN), ci for inbound hooks only (PLANIA_CI_TOKEN). An unset token matches nothing.
export type Scope = "rw" | "ro" | "ci";

const SCOPE_TOKENS: [Scope, string][] = [
  ["rw", "MCP_BEARER_TOKEN"],
  ["ro", "MCP_READ_TOKEN"],
  ["ci", "PLANIA_CI_TOKEN"],
];

function same(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function bearerScope(header: string | undefined): Scope | null {
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length);
  for (const [scope, env] of SCOPE_TOKENS) {
    const expected = process.env[env];
    if (expected && same(token, expected)) return scope;
  }
  return null;
}
