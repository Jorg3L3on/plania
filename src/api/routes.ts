import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import { streamSSE } from "hono/streaming";
import { asc, desc, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { verifyPassword } from "../auth/password.js";
import { SESSION_COOKIE, createSession, sessionCookieOptions, verifySession } from "../auth/session.js";
import { withDb, type Db } from "../db/client.js";
import { projects, tasks } from "../db/schema.js";
import { bus } from "../events.js";
import { ToolError, findProject, findTask, resumeShape, taskShape } from "../mcp/queries.js";
import { setTask } from "../mcp/writes.js";

// JSON API for the screen, behind the plania_session cookie. Separate from /mcp:
// the MCP Bearer never opens it and the cookie never opens /mcp.
export const api = new Hono();

const HEARTBEAT_MS = 25_000;

function errorResponse(c: Context, e: unknown) {
  if (e instanceof ToolError) return c.json({ error: e.code }, e.status);
  throw e;
}

async function readJson<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T> | Response> {
  if (!c.req.header("Content-Type")?.startsWith("application/json")) {
    return c.json({ error: "JSON_REQUIRED" }, 415);
  }
  const parsed = schema.safeParse(await c.req.json().catch(() => undefined));
  if (!parsed.success) return c.json({ error: "INVALID_BODY" }, 400);
  return parsed.data;
}

// ---- Session

api.post("/login", async (c) => {
  const body = await readJson(c, z.object({ password: z.string() }));
  if (body instanceof Response) return body;
  const stored = process.env.PLANIA_PASSWORD_HASH ?? "";
  if (!body.password || !stored || !(await verifyPassword(stored, body.password))) {
    return c.json({ error: "INVALID_PASSWORD" }, 401);
  }
  setCookie(c, SESSION_COOKIE, createSession(), sessionCookieOptions);
  return c.body(null, 204);
});

api.post("/logout", (c) => {
  deleteCookie(c, SESSION_COOKIE, { path: "/", secure: true });
  return c.body(null, 204);
});

// Everything below needs a valid session.
api.use("*", async (c, next) => {
  if (!verifySession(getCookie(c, SESSION_COOKIE))) return c.json({ error: "UNAUTHORIZED" }, 401);
  await next();
});

api.get("/session", (c) => c.body(null, 204));

// ---- Projects

api.get("/projects", async (c) => {
  const rows = await withDb((db) => db.select().from(projects).orderBy(asc(projects.slug)));
  return c.json(rows.map((p) => ({ slug: p.slug, title: p.title, resume: resumeShape(p) })));
});

// All tasks without bodies, ordered like list_tasks: P0..P3, null last, then most recently updated.
async function screenTasks(db: Db, projectId: string) {
  const parent = alias(tasks, "parent");
  return db
    .select({
      key: tasks.key,
      kind: tasks.kind,
      title: tasks.title,
      summary: tasks.summary,
      status: tasks.status,
      priority: tasks.priority,
      parent_key: parent.key,
      blocked_note: tasks.blockedNote,
      pr_url: tasks.prUrl,
      updated_at: tasks.updatedAt,
    })
    .from(tasks)
    .leftJoin(parent, eq(parent.id, tasks.parentId))
    .where(eq(tasks.projectId, projectId))
    .orderBy(sql`${tasks.priority} asc nulls last`, desc(tasks.updatedAt));
}

api.get("/projects/:slug", async (c) => {
  try {
    const data = await withDb(async (db) => {
      const p = await findProject(db, c.req.param("slug"));
      return { slug: p.slug, title: p.title, resume: resumeShape(p), tasks: await screenTasks(db, p.id) };
    });
    return c.json(data);
  } catch (e) {
    return errorResponse(c, e);
  }
});

// One task with its body, in the same shape the get_task MCP tool returns.
api.get("/projects/:slug/tasks/:key", async (c) => {
  try {
    const data = await withDb(async (db) => {
      const p = await findProject(db, c.req.param("slug"));
      const t = await findTask(db, p.id, c.req.param("key"));
      if (!t) throw new ToolError("TASK_NOT_FOUND", 404);
      return { ...(await taskShape(db, t)), updated_at: t.updatedAt };
    });
    return c.json(data);
  } catch (e) {
    return errorResponse(c, e);
  }
});

// Status and priority changes from the screen go through the same set_task path agents use.
const taskPatch = z.object({
  status: z.string().optional(),
  priority: z.string().optional(),
  note: z.string().optional(),
});

api.patch("/projects/:slug/tasks/:key", async (c) => {
  const body = await readJson(c, taskPatch);
  if (body instanceof Response) return body;
  try {
    const result = await withDb((db) => setTask(db, { project: c.req.param("slug"), key: c.req.param("key"), ...body }));
    return c.json(result);
  } catch (e) {
    return errorResponse(c, e);
  }
});

// ---- Live updates

api.get("/events", (c) =>
  streamSSE(c, async (stream) => {
    const unsubscribe = bus.subscribe((event) => {
      void stream.writeSSE({ event: "change", data: JSON.stringify(event) });
    });
    const heartbeat = setInterval(() => void stream.writeSSE({ event: "ping", data: "{}" }), HEARTBEAT_MS);
    await stream.writeSSE({ event: "ready", data: "{}" });
    // Keep the stream open until the browser goes away.
    await new Promise<void>((resolve) =>
      stream.onAbort(() => {
        clearInterval(heartbeat);
        unsubscribe();
        resolve();
      }),
    );
  }),
);

// Mounted sub-apps do not use their own notFound, so claim unknown API paths explicitly.
api.all("*", (c) => c.json({ error: "NOT_FOUND" }, 404));
