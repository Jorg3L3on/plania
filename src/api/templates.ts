// PLA-I25: the screen's company template. Session cookie only.
import { Hono, type Context } from "hono";
import { z } from "zod";
import { withDb } from "../db/client.js";
import { ToolError } from "../mcp/errors.js";
import { createCompanyProject } from "../mcp/templates.js";
import { webCtx } from "../mcp/tx.js";

export const templateRoutes = new Hono();

const bodySchema = z.object({
  slug: z.string(),
  name: z.string(),
  owner_bot_name: z.string(),
});

function fail(c: Context, e: unknown): Response {
  if (e instanceof ToolError) return c.json({ error: e.code, ...e.detail }, e.status);
  throw e;
}

templateRoutes.post("/company", async (c) => {
  if (!c.req.header("Content-Type")?.startsWith("application/json")) return c.json({ error: "JSON_REQUIRED" }, 415);
  const parsed = bodySchema.safeParse(await c.req.json().catch(() => undefined));
  if (!parsed.success) return c.json({ error: "INVALID_BODY" }, 400);
  try {
    const result = await withDb((db) => createCompanyProject(db, parsed.data, webCtx));
    return c.json(result, result.created ? 201 : 200);
  } catch (e) {
    return fail(c, e);
  }
});
