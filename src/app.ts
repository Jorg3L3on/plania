import { StreamableHTTPTransport } from "@hono/mcp";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { bearerScope, type Scope } from "./auth/bearer.js";
import { makeDb } from "./db/client.js";
import { hooks } from "./hooks/routes.js";
import { createMcpServer } from "./mcp/register.js";
import { exporter } from "./web/export.js";
import { web } from "./web/routes.js";

export const app = new Hono<{ Variables: { scope: Scope } }>();

app.get("/health", (c) => c.json({ ok: true }));

// POST /mcp only, JSON responses, stateless: no sessions, no GET listen stream.

// The screen cookie never counts here; only a Bearer token of an allowed scope does.
const requireScope = (...allowed: Scope[]) =>
  createMiddleware<{ Variables: { scope: Scope } }>(async (c, next) => {
    const scope = bearerScope(c.req.header("Authorization"));
    if (!scope || !allowed.includes(scope)) return c.json({ error: "UNAUTHORIZED" }, 401);
    c.set("scope", scope);
    await next();
  });

app.use("/mcp", requireScope("rw", "ro"));
app.use("/hooks/*", requireScope("ci"));

app.post("/mcp", async (c) => {
  const { db, close } = makeDb();
  const server = createMcpServer(db, { readOnly: c.get("scope") === "ro" });
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
app.route("/", web);
