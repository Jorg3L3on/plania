import { Hono } from "hono";
import type { Auth } from "../auth/bearer.js";
import { withDb } from "../db/client.js";
import { inbox } from "../mcp/inbox.js";
import { ToolError, findProject, listEvents } from "../mcp/queries.js";
import { getDigest, getRunning, listProjects, readerOf } from "../mcp/watch.js";

// 2.7: the Watch API as plain Bearer GET JSON for assistants that speak HTTP, not MCP. Mounted at
// /bot/v1 behind a read-scoped Bearer (app.ts); the screen cookie never opens it and /api stays
// cookie-only. Each route answers exactly what the MCP tool of the same name does.
export const bot = new Hono<{ Variables: { auth: Auth } }>();

const num = (v: string | undefined) => (v === undefined || v === "" ? undefined : Number(v));

bot.onError((e, c) => {
  if (e instanceof ToolError) return c.json({ error: e.code, ...e.detail }, e.status);
  throw e;
});

bot.get("/digest", async (c) => {
  const since = num(c.req.query("since"));
  const per = num(c.req.query("max_events_per_project"));
  if ((since !== undefined && !Number.isInteger(since)) || (per !== undefined && !Number.isInteger(per))) return c.json({ error: "INVALID_FILTER", field: "since" }, 400);
  const auth = c.get("auth");
  const reader = readerOf(auth.identity, auth.scopes);
  return c.json(await withDb((db) => getDigest(db, { since, project: c.req.query("project") || undefined, max_events_per_project: per, reader })));
});

bot.get("/projects", async (c) => c.json(await withDb((db) => listProjects(db))));

bot.get("/running", async (c) => c.json(await withDb((db) => getRunning(db))));

bot.get("/inbox", async (c) => {
  const slug = c.req.query("project") || "all";
  return c.json(await withDb(async (db) => inbox(db, slug === "all" ? "all" : await findProject(db, slug))));
});

bot.get("/events", async (c) => {
  const slug = c.req.query("project") || "all";
  const since = num(c.req.query("since"));
  const limit = num(c.req.query("limit"));
  if (since !== undefined && !Number.isInteger(since)) return c.json({ error: "INVALID_FILTER", field: "since" }, 400);
  const types = c.req.query("types")?.split(",").filter(Boolean);
  const key = c.req.query("key") || undefined;
  return c.json(
    await withDb(async (db) => listEvents(db, slug === "all" ? null : (await findProject(db, slug)).id, { since, key, types, limit })),
  );
});
