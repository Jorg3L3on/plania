// PLA-I29: the runner's screen routes. Jorge's session cookie only, like the delegation switch:
// a Bearer (any agent token) is 403 even with a cookie, no cookie is 401. No MCP tool writes these.
//   GET  /api/company                      the Compañía read (switches, budgets, runs, plan reading)
//   POST /api/company/switch               {paused}            company kill switch
//   POST /api/company/projects/:slug/switch {paused}           project kill switch
//   PUT  /api/company/budgets              {scope, role|project, weekly_limit|null}
//   PUT  /api/company/settings             {max_concurrent?, cooldown_minutes?, plan_guard_pct?, reserve_tokens?, max_turns?, timeout_minutes?}
//   POST /api/company/runs/:id/ack-usage   a run whose usage is unknown stops blocking
//   POST /api/company/projects             {name, goal}  PLA-I31-3: a new project, paused, with its PO
//        → 201 {slug, key_prefix, paused: true, po, prompt_doc_id}; 409 PROJECT_EXISTS | PROMPT_DOC_MISSING
import { Hono, type Context } from "hono";
import { getCookie } from "hono/cookie";
import { z } from "zod";
import { SESSION_COOKIE, verifySession } from "../auth/session.js";
import { withDb } from "../db/client.js";
import { ToolError } from "../mcp/errors.js";
import { createProjectFromTemplate } from "../runner/new-project.js";
import { ackUnknownUsage, companyState, setBudget, setCompanyPaused, setProjectPaused, setRunnerSettings } from "../runner/company.js";

export const companyRoutes = new Hono();

companyRoutes.use("*", async (c, next) => {
  if (/^\s*bearer\b/i.test(c.req.header("Authorization") ?? "")) {
    return c.json({ error: "FORBIDDEN", hint: "limits and kill switches are Jorge's screen only" }, 403);
  }
  if (!verifySession(getCookie(c, SESSION_COOKIE))) return c.json({ error: "UNAUTHORIZED" }, 401);
  await next();
});

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

const Paused = z.object({ paused: z.boolean() }).strict();

companyRoutes.get("/", async (c) => c.json(await withDb((db) => companyState(db))));

companyRoutes.post("/switch", async (c) => {
  const input = await body(c, Paused);
  if (input instanceof Response) return input;
  return c.json(await withDb((db) => setCompanyPaused(db, input.paused)));
});

companyRoutes.post("/projects/:slug/switch", async (c) => {
  const input = await body(c, Paused);
  if (input instanceof Response) return input;
  try {
    return c.json(await withDb((db) => setProjectPaused(db, c.req.param("slug"), input.paused)));
  } catch (e) {
    return fail(c, e);
  }
});

const Budget = z
  .object({
    scope: z.enum(["role", "project"]),
    role: z.string().min(1).max(40).optional(),
    project: z.string().min(1).max(80).optional(),
    weekly_limit: z.number().int().min(1).max(10_000_000_000).nullable(),
  })
  .strict();

companyRoutes.put("/budgets", async (c) => {
  const input = await body(c, Budget);
  if (input instanceof Response) return input;
  try {
    return c.json(await withDb((db) => setBudget(db, input)));
  } catch (e) {
    return fail(c, e);
  }
});

const Settings = z
  .object({
    max_concurrent: z.number().int().min(0).max(8).optional(),
    cooldown_minutes: z.number().int().min(0).max(1440).optional(),
    plan_guard_pct: z.number().int().min(0).max(100).optional(),
    reserve_tokens: z.number().int().min(0).max(5_000_000).optional(),
    max_turns: z.number().int().min(1).max(500).optional(),
    timeout_minutes: z.number().int().min(1).max(600).optional(),
  })
  .strict();

companyRoutes.put("/settings", async (c) => {
  const input = await body(c, Settings);
  if (input instanceof Response) return input;
  return c.json(await withDb((db) => setRunnerSettings(db, input)));
});

companyRoutes.post("/runs/:id/ack-usage", async (c) => {
  const id = c.req.param("id");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return c.json({ error: "INVALID_BODY" }, 400);
  return c.json(await withDb((db) => ackUnknownUsage(db, id)));
});

const NewProjectBody = z.object({ name: z.string().min(1).max(40), goal: z.string().min(1).max(280) }).strict();

companyRoutes.post("/projects", async (c) => {
  const input = await body(c, NewProjectBody);
  if (input instanceof Response) return input;
  const out = await withDb((db) => createProjectFromTemplate(db, input));
  if ("error" in out) {
    const { status, ...rest } = out;
    return c.json(rest, status);
  }
  return c.json(out, 201);
});
