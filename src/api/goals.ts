// PLA-I22: the screen's goals. list_goals / set_goal, behind the same session cookie as the rest of /api.
import { Hono, type Context } from "hono";
import { z } from "zod";
import { withDb } from "../db/client.js";
import { listGoals, setGoal, type SetGoalInput } from "../mcp/goals.js";
import { ToolError } from "../mcp/errors.js";
import { webCtx } from "../mcp/tx.js";

export const goalsApi = new Hono();

const goalBody = z.object({
  project: z.string().trim().min(1).nullable().optional(),
  parent_id: z.string().uuid().nullable().optional(),
  title: z.string().optional(),
  why: z.string().optional(),
  status: z.string().optional(),
  target_on: z.string().nullable().optional(),
  position: z.number().int().optional(),
});

async function readBody(c: Context): Promise<SetGoalInput | Response> {
  if (!c.req.header("Content-Type")?.startsWith("application/json")) return c.json({ error: "JSON_REQUIRED" }, 415);
  const parsed = goalBody.safeParse(await c.req.json().catch(() => undefined));
  if (!parsed.success) return c.json({ error: "INVALID_BODY" }, 400);
  return parsed.data;
}

function fail(c: Context, e: unknown): Response {
  if (e instanceof ToolError) return c.json({ error: e.code, ...e.detail }, e.status);
  throw e;
}

goalsApi.get("/", async (c) => {
  const project = c.req.query("project")?.trim();
  try {
    return c.json(await withDb((db) => listGoals(db, project || undefined)));
  } catch (e) {
    return fail(c, e);
  }
});

goalsApi.post("/", async (c) => {
  const body = await readBody(c);
  if (body instanceof Response) return body;
  try {
    return c.json(await withDb((db) => setGoal(db, body, webCtx)), 201);
  } catch (e) {
    return fail(c, e);
  }
});

goalsApi.patch("/:id", async (c) => {
  const id = z.string().uuid().safeParse(c.req.param("id"));
  if (!id.success) return c.json({ error: "INVALID_BODY" }, 400);
  const body = await readBody(c);
  if (body instanceof Response) return body;
  try {
    return c.json(await withDb((db) => setGoal(db, { ...body, id: id.data }, webCtx)));
  } catch (e) {
    return fail(c, e);
  }
});
