// PLA-I23: the screen's comment thread and routine history. Session cookie only, like /team.
import { Hono, type Context } from "hono";
import { withDb } from "../db/client.js";
import { listComments, listRoutineRuns } from "../mcp/delegation.js";
import { ToolError } from "../mcp/errors.js";

export const delegationRoutes = new Hono();

function fail(c: Context, e: unknown): Response {
  if (e instanceof ToolError) return c.json({ error: e.code, ...e.detail }, e.status);
  throw e;
}

delegationRoutes.get("/comments", async (c) => {
  const project = c.req.query("project")?.trim() ?? "";
  const key = c.req.query("key")?.trim() ?? "";
  if (!project || !key) return c.json({ error: "INVALID_BODY" }, 400);
  try {
    return c.json({ comments: await withDb((db) => listComments(db, project, key)) });
  } catch (e) {
    return fail(c, e);
  }
});

delegationRoutes.get("/routines", async (c) => {
  const agent = c.req.query("agent")?.trim() || undefined;
  const date = c.req.query("date")?.trim() || undefined;
  try {
    return c.json(await withDb((db) => listRoutineRuns(db, { agent, date })));
  } catch (e) {
    return fail(c, e);
  }
});
