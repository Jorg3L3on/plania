import { StreamableHTTPTransport } from "@hono/mcp";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { streamSSE } from "hono/streaming";
import { resolveBearer, type Auth, type Scope } from "./auth/bearer.js";
import { makeDb, withDb } from "./db/client.js";
import { bus } from "./events.js";
import { hooks } from "./hooks/routes.js";
import { findProject, listEvents } from "./mcp/queries.js";
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
app.use("/mcp/events", requireScope("read", "write", "ops"));
app.use("/hooks/*", requireScope("hooks"));

// R-07: the change feed as server-sent events for agents. ?project=&since=<cursor>&key=&types=a,b
// replays what the cursor missed from the event log, then streams new events as they commit.
// Each message is one list_events row; its id is the next cursor. No hosting: localhost only.
const EVENTS_PING_MS = 25_000;
app.get("/mcp/events", async (c) => {
  const slug = c.req.query("project");
  if (!slug) return c.json({ error: "INVALID_FILTER", field: "project" }, 400);
  const key = c.req.query("key") || undefined;
  const types = c.req.query("types")?.split(",").filter(Boolean);
  let since = Number(c.req.query("since") ?? 0) || 0;
  let projectId: string;
  try {
    projectId = (await withDb((db) => findProject(db, slug))).id;
  } catch {
    return c.json({ error: "PROJECT_NOT_FOUND" }, 404);
  }
  return streamSSE(c, async (stream) => {
    const send = async () => {
      const page = await withDb((db) => listEvents(db, projectId, { since, key, types, limit: 500 }));
      for (const e of page.events) await stream.writeSSE({ event: e.type, id: String(e.id), data: JSON.stringify(e) });
      since = Math.max(since, page.next_cursor);
      if (page.more) await send();
    };
    await send();
    await stream.writeSSE({ event: "ready", data: JSON.stringify({ cursor: since }) });
    let pending: Promise<void> = Promise.resolve();
    const unsubscribe = bus.subscribe((change) => {
      if (change.project !== slug) return;
      pending = pending.then(send).catch(() => undefined);
    });
    const ping = setInterval(() => void stream.writeSSE({ event: "ping", data: JSON.stringify({ cursor: since }) }), EVENTS_PING_MS);
    await new Promise<void>((resolve) =>
      stream.onAbort(() => {
        clearInterval(ping);
        unsubscribe();
        resolve();
      }),
    );
  });
});

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
