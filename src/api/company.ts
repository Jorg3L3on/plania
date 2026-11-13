// PLA-I39-2: GET /api/company/history?hours=N (1..72, default 20): runs and events of the last hours, per project.
// PLA-I35-1: GET /api/company adds plan, this_week, next and work per project and decisions[] (Te toca);
// POST /api/company/decisions/:id {action, option?, text?} acts on one row (src/api/company-decisions.ts).
// PLA-I32-6: GET /api/company and GET /api/company/projects/:slug serve the Plan's read contract
// (src/api/company-org.ts); POST /api/company/projects/:slug/team {template} adds a team member; the runner's
// plumbing (switches, guard, runs, log) is read from GET /api/machine. The writes below stay.
// PLA-I29: the runner's screen routes. Jorge's session cookie only, like the delegation switch:
// a Bearer (any agent token) is 403 even with a cookie, no cookie is 401. No MCP tool writes these.
//   GET  /api/company                      the Compañía read (switches, runs, plan reading)
//   POST /api/company/switch               {paused}            company kill switch
//   POST /api/company/projects/:slug/switch {paused}           project kill switch
//   PUT  /api/company/settings             {max_concurrent?, cooldown_minutes?, plan_guard_pct?, reserve_tokens?, max_turns?, timeout_minutes?}
//   POST /api/company/projects             {name, goal}  PLA-I31-3: a new project, paused, with its PO
//        → 201 {slug, key_prefix, paused: true, po, prompt_doc_id}; 409 PROJECT_EXISTS | PROMPT_DOC_MISSING
// PLA-I30 (src/api/company-extra.ts): the read gains viewer, prompts, roster and project_facts, plus
//   GET  /api/company/projects/:slug       the project sheet
//   GET  /api/company/docs/:id             one role prompt doc (Prompt ↗)
// PLA-I30-6/7: POST /api/company/projects/:slug/ask {text}  and  POST /api/company/projects/:slug/wake
// PLA-I36-11: deleting a project needs the owner's code ({code}). src/auth/owner-code.ts.
// PLA-21: no token budgets, so no limit to raise.
//   GET  /api/company/owner-code          {enrolled}
//   POST /api/company/owner-code/enroll   {password, code?} → {secret_base32, otpauth_uri} once
//   DELETE /api/company/projects/:slug    {code}  the project and everything in it
import { Hono, type Context } from "hono";
import { getCookie } from "hono/cookie";
import { z } from "zod";
import { SESSION_COOKIE, verifySession } from "../auth/session.js";
import { withDb } from "../db/client.js";
import { ToolError } from "../mcp/errors.js";
import { createProjectFromTemplate } from "../runner/new-project.js";
import { askPo, pickNext, setProjectOptions, wakePo } from "./company-actions.js";
import { noteForAgent, resumeRun, stopOneRun } from "./company-runs.js";
import { cancelOrder } from "./company-orders.js";
import { promptDoc } from "./company-extra.js";
import { addTeamMember, companyRead, projectRead } from "./company-org.js";
import { companyHistory, parseHours } from "./company-history.js";
import { actOnDecision } from "./company-decisions.js";
import { setCompanyPaused, setProjectPaused, setRunnerSettings } from "../runner/company.js";
import { checkOwnerCode, enrolOwnerCode, ownerCodeEnrolled } from "../auth/owner-code.js";
import { findProject } from "../mcp/queries.js";
import { projects } from "../db/schema.js";
import { eq } from "drizzle-orm";

export const companyRoutes = new Hono();

companyRoutes.use("*", async (c, next) => {
  if (/^\s*bearer\b/i.test(c.req.header("Authorization") ?? "")) {
    return c.json({ error: "FORBIDDEN", hint: "the runner's settings and kill switches are Jorge's screen only" }, 403);
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

// PLA-I32-6: the read contract (src/api/company-org.ts). The runner's plumbing moved to GET /api/machine.
companyRoutes.get("/", async (c) => c.json(await withDb((db) => companyRead(db))));

// PLA-I39-2: what happened in the last hours (the clock of the building).
companyRoutes.get("/history", async (c) => {
  const hours = parseHours(c.req.query("hours"));
  if (hours == null) return c.json({ error: "INVALID_FILTER", field: "hours", hint: "hours is a whole number from 1 to 72" }, 400);
  return c.json(await withDb((db) => companyHistory(db, hours)));
});

companyRoutes.get("/projects/:slug", async (c) => {
  try {
    return c.json(await withDb((db) => projectRead(db, c.req.param("slug"))));
  } catch (e) {
    return fail(c, e);
  }
});

// PLA-I35-1 (src/api/company-decisions.ts): act on one Te toca row.
const DecisionBody = z
  .object({
    action: z.enum(["elegir", "responder", "hecho", "aplazar", "aceptar", "fusionar", "cambios", "empezar", "cambiar", "cancelar"]),
    option: z.union([z.number().int().min(1).max(20), z.array(z.number().int().min(1).max(20)).min(1).max(5)]).optional(),
    text: z.string().trim().min(1).max(2000).optional(),
  })
  .strict();

companyRoutes.post("/decisions/:id", async (c) => {
  const input = await body(c, DecisionBody);
  if (input instanceof Response) return input;
  try {
    const out = await withDb((db) => actOnDecision(db, c.req.param("id"), input));
    if ("error" in out) {
      const { status, ...rest } = out;
      return c.json(rest, status);
    }
    return c.json(out);
  } catch (e) {
    return fail(c, e);
  }
});

const TeamBody = z.object({ template: z.string().min(1).max(40) }).strict();

companyRoutes.post("/projects/:slug/team", async (c) => {
  const input = await body(c, TeamBody);
  if (input instanceof Response) return input;
  const out = await withDb((db) => addTeamMember(db, c.req.param("slug"), input.template.trim()));
  if ("error" in out) {
    const { status, ...rest } = out;
    return c.json(rest, status);
  }
  return c.json(out, 201);
});

companyRoutes.get("/docs/:id", async (c) => {
  const id = c.req.param("id");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return c.json({ error: "DOC_NOT_FOUND" }, 404);
  try {
    return c.json(await withDb((db) => promptDoc(db, id)));
  } catch (e) {
    return fail(c, e);
  }
});

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

// ---- PLA-I36-11: the owner's code

companyRoutes.get("/owner-code", async (c) => c.json({ enrolled: await ownerCodeEnrolled() }));

companyRoutes.post("/owner-code/enroll", async (c) => {
  const input = await body(c, z.object({ password: z.string().min(1).max(200), code: z.string().max(12).optional() }).strict());
  if (input instanceof Response) return input;
  const out = await withDb((db) => enrolOwnerCode(db, input));
  if ("error" in out) {
    const { status, ...rest } = out;
    return c.json(rest, status);
  }
  return c.json(out);
});

companyRoutes.delete("/projects/:slug", async (c) => {
  const input = await body(c, z.object({ code: z.string().max(12).optional() }).strict());
  if (input instanceof Response) return input;
  try {
    return await withDb(async (db) => {
      const p = await findProject(db, c.req.param("slug"));
      const refused = await checkOwnerCode(db, input.code);
      if (refused) {
        const { status, ...rest } = refused;
        return c.json(rest, status);
      }
      await db.delete(projects).where(eq(projects.id, p.id));
      return c.json({ deleted: p.slug });
    });
  } catch (e) {
    return fail(c, e);
  }
});

// PLA-I30-6/7 (src/api/company-actions.ts): Pedirle al PO and Despertar ahora on the project sheet.
const AskBody = z.object({ text: z.string().trim().min(3).max(500), kind: z.enum(["cambio", "direccion", "idea"]).optional(), now: z.boolean().optional() }).strict();

companyRoutes.post("/projects/:slug/ask", async (c) => {
  const input = await body(c, AskBody);
  if (input instanceof Response) return input;
  try {
    const out = await withDb((db) => askPo(db, c.req.param("slug"), input.text, { kind: input.kind, now: input.now }));
    if ("error" in out) {
      const { status, ...rest } = out;
      return c.json(rest, status);
    }
    return c.json(out, 201);
  } catch (e) {
    return fail(c, e);
  }
});

companyRoutes.post("/projects/:slug/wake", async (c) => {
  try {
    const out = await withDb((db) => wakePo(db, c.req.param("slug")));
    if ("error" in out) {
      const { status, ...rest } = out;
      return c.json(rest, status);
    }
    return c.json(out);
  } catch (e) {
    return fail(c, e);
  }
});

// PLA-I36-9: stop one run, resume it, or tell its agent something. PLA-I36-8: cancel an order.
const send = (c: Context, out: object) => {
  if ("error" in out) {
    const { status, ...rest } = out as unknown as { status: 400 | 404 | 409 };
    return c.json(rest, status);
  }
  return c.json(out);
};
companyRoutes.post("/runs/:id/stop", async (c) => send(c, await withDb((db) => stopOneRun(db, c.req.param("id")))));
companyRoutes.post("/runs/:id/resume", async (c) => send(c, await withDb((db) => resumeRun(db, c.req.param("id")))));
companyRoutes.post("/projects/:slug/tasks/:key/note", async (c) => {
  const input = await body(c, z.object({ text: z.string().trim().min(2).max(1000) }).strict());
  if (input instanceof Response) return input;
  return send(c, await withDb((db) => noteForAgent(db, c.req.param("slug"), c.req.param("key"), input.text)));
});
companyRoutes.post("/projects/:slug/orders/:key/cancel", async (c) => send(c, await withDb((db) => cancelOrder(db, c.req.param("slug"), c.req.param("key")))));

// PLA-I36-6: Cambiar lo siguiente.
companyRoutes.post("/projects/:slug/next", async (c) => {
  const input = await body(c, z.object({ key: z.string().min(1).max(40) }).strict());
  if (input instanceof Response) return input;
  const out = await withDb((db) => pickNext(db, c.req.param("slug"), input.key));
  if ("error" in out) {
    const { status, ...rest } = out;
    return c.json(rest, status);
  }
  return c.json(out);
});

// PLA-I36-8/10: plan approval and the preview address.
companyRoutes.put("/projects/:slug/options", async (c) => {
  const input = await body(c, z.object({ plan_approval: z.boolean().optional(), preview_url: z.string().url().regex(/^https?:\/\//).max(300).nullable().optional() }).strict());
  if (input instanceof Response) return input;
  const out = await withDb((db) => setProjectOptions(db, c.req.param("slug"), input));
  if ("error" in out) {
    const { status, ...rest } = out;
    return c.json(rest, status);
  }
  return c.json(out);
});

const NewProjectBody =z.object({ name: z.string().min(1).max(40), goal: z.string().min(1).max(280) }).strict();

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
