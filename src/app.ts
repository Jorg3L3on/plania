import { StreamableHTTPTransport } from "@hono/mcp";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { resolveBearer, type Auth, type Scope } from "./auth/bearer.js";
import { makeDb, withDb } from "./db/client.js";
import { hooks } from "./hooks/routes.js";
import { createMcpServer } from "./mcp/register.js";
import { api } from "./api/routes.js";
import { exporter } from "./web/export.js";

export const app = new Hono<{ Variables: { auth: Auth } }>();

app.get("/health", (c) => c.json({ ok: true }));

// POST /mcp only, JSON responses, stateless: no sessions, no GET listen stream.

// The screen cookie never counts here; only a Bearer token with one of the allowed scopes does
// (a static env token, or an agent token issued on screen).
const requireScope = (...allowed: Scope[]) =>
  createMiddleware<{ Variables: { auth: Auth } }>(async (c, next) => {
    const auth = await withDb((db) => resolveBearer(db, c.req.header("Authorization")));
    if (!auth || !auth.scopes.some((s) => allowed.includes(s))) return c.json({ error: "UNAUTHORIZED" }, 401);
    c.set("auth", auth);
    await next();
  });

app.use("/mcp", requireScope("read", "write", "ops"));
app.use("/hooks/*", requireScope("hooks"));

app.post("/mcp", async (c) => {
  const { db, close } = makeDb();
  const auth = c.get("auth");
  const server = createMcpServer(db, { scopes: auth.scopes, identity: auth.identity });
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

app.route("/", hooks);
app.route("/", exporter);
app.route("/api", api);
