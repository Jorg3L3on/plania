// PLA-I25: the screen's reported token totals. Session cookie only, like /team.
import { Hono, type Context } from "hono";
import { withDb } from "../db/client.js";
import { ToolError } from "../mcp/errors.js";
import { usageSummary } from "../mcp/usage.js";

export const usageRoutes = new Hono();

function fail(c: Context, e: unknown): Response {
  if (e instanceof ToolError) return c.json({ error: e.code, ...e.detail }, e.status);
  throw e;
}

usageRoutes.get("/", async (c) => {
  const project = c.req.query("project")?.trim() || undefined;
  const agent = c.req.query("agent")?.trim() || undefined;
  const week = c.req.query("week")?.trim() || undefined;
  try {
    return c.json(await withDb((db) => usageSummary(db, { project, agent, week })));
  } catch (e) {
    return fail(c, e);
  }
});
