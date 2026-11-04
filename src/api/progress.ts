// PLA-I19: Mi progreso. Derived reads for Jorge's screen.
// Mounted under the session cookie. A Bearer is a bot: 401, even with a cookie.
import { Hono, type Context } from "hono";
import { withDb } from "../db/client.js";
import { progressItem, progressLog, progressSummary } from "../mcp/progress.js";
import { ToolError } from "../mcp/queries.js";

export const progressRoutes = new Hono();

const bearerRefused = (c: Context): Response | null => {
  if (/^\s*bearer\b/i.test(c.req.header("Authorization") ?? "")) return c.json({ error: "UNAUTHORIZED" }, 401);
  return null;
};

const errorResponse = (c: Context, e: unknown): Response => {
  if (e instanceof ToolError) return c.json({ error: e.code, ...e.detail }, e.status);
  throw e;
};

progressRoutes.get("/summary", async (c) => {
  const refused = bearerRefused(c);
  if (refused) return refused;
  try {
    return c.json(await withDb((db) => progressSummary(db, { range: c.req.query("range"), date: c.req.query("date") })));
  } catch (e) {
    return errorResponse(c, e);
  }
});

progressRoutes.get("/log", async (c) => {
  const refused = bearerRefused(c);
  if (refused) return refused;
  try {
    return c.json(
      await withDb((db) =>
        progressLog(db, {
          from: c.req.query("from"),
          to: c.req.query("to"),
          project: c.req.query("project"),
          type: c.req.query("type"),
          q: c.req.query("q"),
          cursor: c.req.query("cursor"),
        }),
      ),
    );
  } catch (e) {
    return errorResponse(c, e);
  }
});

progressRoutes.get("/item/:project/:key", async (c) => {
  const refused = bearerRefused(c);
  if (refused) return refused;
  try {
    return c.json(await withDb((db) => progressItem(db, c.req.param("project"), c.req.param("key"))));
  } catch (e) {
    return errorResponse(c, e);
  }
});
