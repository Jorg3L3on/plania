// PLA-I24: GET /dashboard for the CEO screen. Cookie session only. A Bearer is an agent: 401, even with a cookie.
// PLA-I28: the screen's two actions. Wake goes through wakeAgent, assign through assign, as the screen actor.
import { Hono, type Context } from "hono";
import { z } from "zod";
import { withDb } from "../db/client.js";
import { wakeAgent } from "../jobs/heartbeat.js";
import { wakeInfo } from "../mcp/ceo-signals.js";
import { ceoDashboard } from "../mcp/dashboard.js";
import { assign } from "../mcp/delegation.js";
import { ToolError } from "../mcp/errors.js";
import { listAgents } from "../mcp/team.js";
import { webCtx } from "../mcp/tx.js";

export const dashboardRoutes = new Hono();

const isBearer = (c: Context) => /^\s*bearer\b/i.test(c.req.header("Authorization") ?? "");

function fail(c: Context, e: unknown): Response {
  if (e instanceof ToolError) return c.json({ error: e.code, ...e.detail }, e.status);
  throw e;
}

async function body<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T> | Response> {
  if (!c.req.header("Content-Type")?.startsWith("application/json")) return c.json({ error: "JSON_REQUIRED" }, 415);
  const parsed = schema.safeParse(await c.req.json().catch(() => undefined));
  if (!parsed.success) return c.json({ error: "INVALID_BODY" }, 400);
  return parsed.data;
}

dashboardRoutes.use("*", async (c, next) => {
  if (isBearer(c)) return c.json({ error: "UNAUTHORIZED" }, 401);
  await next();
});

dashboardRoutes.get("/", async (c) => {
  try {
    return c.json(await withDb((db) => ceoDashboard(db)));
  } catch (e) {
    return fail(c, e);
  }
});

const wakeBody = z.object({ agent: z.string().trim().min(1).max(60), task_key: z.string().trim().min(1).max(80).optional() });

// An agent whose adapter cannot run answers why and records nothing: no run row, no process.
dashboardRoutes.post("/wake", async (c) => {
  const input = await body(c, wakeBody);
  if (input instanceof Response) return input;
  try {
    return c.json(
      await withDb(async (db) => {
        const { agents } = await listAgents(db);
        const agent = agents.find((row) => row.slug === input.agent.toLowerCase());
        if (!agent) throw new ToolError("AGENT_NOT_FOUND", { slug: input.agent });
        const info = wakeInfo(agent);
        if (!info.can_wake) return { woke: false, reason: "no_adapter", detail: info.wake_reason, run: null };
        return wakeAgent(db, { agent: agent.slug, taskKey: input.task_key });
      }),
    );
  } catch (e) {
    return fail(c, e);
  }
});

const assignBody = z.object({
  project: z.string().trim().min(1).max(60),
  key: z.string().trim().min(1).max(80),
  to_agent: z.string().trim().min(1).max(60),
  note: z.string().max(2000).optional(),
});

dashboardRoutes.post("/assign", async (c) => {
  const input = await body(c, assignBody);
  if (input instanceof Response) return input;
  try {
    return c.json(await withDb((db) => assign(db, input, webCtx)));
  } catch (e) {
    return fail(c, e);
  }
});
