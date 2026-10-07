import { timingSafeEqual } from "node:crypto";
import { StreamableHTTPTransport } from "@hono/mcp";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { makeDb } from "./db/client.js";
import { createMcpServer } from "./mcp/register.js";
import { web } from "./web/routes.js";

export const app = new Hono();

app.get("/health", (c) => c.json({ ok: true }));

// POST /mcp only, JSON responses, stateless: no sessions, no GET listen stream.

function tokenMatches(header: string | undefined): boolean {
  const expected = process.env.MCP_BEARER_TOKEN;
  if (!expected || !header?.startsWith("Bearer ")) return false;
  const a = Buffer.from(header.slice("Bearer ".length));
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// The screen cookie never counts here; only the Bearer token does.
const requireBearer = createMiddleware(async (c, next) => {
  if (!tokenMatches(c.req.header("Authorization"))) return c.json({ error: "UNAUTHORIZED" }, 401);
  await next();
});

app.use("/mcp", requireBearer);

app.post("/mcp", async (c) => {
  const { db, close } = makeDb();
  const server = createMcpServer(db);
  const transport = new StreamableHTTPTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  try {
    await server.connect(transport);
    const res = await transport.handleRequest(c);
    return res ?? c.body(null, 202);
  } finally {
    await server.close();
    await close();
  }
});

app.on(["GET", "DELETE"], "/mcp", (c) => c.json({ error: "METHOD_NOT_ALLOWED" }, 405));

app.route("/", web);
