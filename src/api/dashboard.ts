// PLA-I24: GET /dashboard for the CEO screen. Cookie session only. A Bearer is an agent: 401, even with a cookie.
import { Hono } from "hono";
import { withDb } from "../db/client.js";
import { ceoDashboard } from "../mcp/dashboard.js";
import { ToolError } from "../mcp/errors.js";

export const dashboardRoutes = new Hono();

dashboardRoutes.get("/", async (c) => {
  if (/^\s*bearer\b/i.test(c.req.header("Authorization") ?? "")) return c.json({ error: "UNAUTHORIZED" }, 401);
  try {
    return c.json(await withDb((db) => ceoDashboard(db)));
  } catch (e) {
    if (e instanceof ToolError) return c.json({ error: e.code, ...e.detail }, e.status);
    throw e;
  }
});
