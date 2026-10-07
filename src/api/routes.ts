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
import { projects, tasks, type Actor } from "../db/schema.js";
import { bus } from "../events.js";
import { listDecisions } from "../mcp/decisions.js";
import { ToolError, findProject, findTask, taskShape } from "../mcp/queries.js";
import { answer } from "../mcp/questions.js";
import { resumeDigest, type ResumeDigest } from "../mcp/resume.js";
import { webCtx } from "../mcp/tx.js";
import { claim, setTask } from "../mcp/writes.js";

// JSON API for the screen, behind the plania_session cookie. Separate from /mcp:
// the MCP Bearer never opens it and the cookie never opens /mcp.
export const api = new Hono();

const HEARTBEAT_MS = 25_000;

// Contract errors keep their detail (e.g. STALE_VERSION carries current_version).
function errorResponse(c: Context, e: unknown) {
  if (e instanceof ToolError) return c.json({ error: e.code, ...e.detail }, e.status);
  throw e;
}

// One line per project for the list: open questions first, then what is claimed, else what is next.
export function resumeLine(d: ResumeDigest): string {
  if (d.claims.length) return `En curso: ${d.claims.map((c) => `${c.key} (${c.owner?.agent})`).join(", ")}`;
  const noted = d.initiatives.find((i) => i.next_action.note);
  if (noted) return `${noted.key}: ${noted.next_action.note}`;
  if (d.next_claimable) return `Siguiente: ${d.next_claimable.key} · ${d.next_claimable.title}`;
  return d.legacy_card?.in_progress || d.legacy_card?.next_action || "Sin ficha.";
}

const DECISIONS_LIMIT = 30;

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

// Every project with its generated line, open question count, and all its tasks without scope.
api.get("/projects", async (c) => {
  const rows = await withDb(async (db) => {
    const all = await db.select().from(projects).orderBy(asc(projects.slug));
    const allTasks = await screenTasks(db);
    return Promise.all(
      all.map(async (p) => {
        const digest = await resumeDigest(db, p);
        return {
          slug: p.slug,
          title: p.title,
          line: resumeLine(digest),
          open_questions: digest.open_questions.length,
          // The index draws one lane per initiative, so it needs every project's tasks.
          tasks: allTasks.filter((t) => t.project_id === p.id).map(({ project_id: _, ...t }) => t),
        };
      }),
    );
  });
  return c.json(rows);
});

// All tasks without scope, ordered like list_tasks: P0..P3, null last, then most recently updated.
// version goes back with every change; claimed_by is the live lease, if any.
// One project, or every project when projectId is omitted.
async function screenTasks(db: Db, projectId?: string) {
  const parent = alias(tasks, "parent");
  return db
    .select({
      project_id: tasks.projectId,
      key: tasks.key,
      kind: tasks.kind,
      title: tasks.title,
      summary: tasks.summary,
      status: tasks.status,
      priority: tasks.priority,
      work_type: tasks.workType,
      parent_key: parent.key,
      blocked_note: tasks.blockedNote,
      pr_url: tasks.prUrl,
      branch: tasks.branch,
      base_branch: tasks.baseBranch,
      version: tasks.version,
      claimed_by: sql<Actor | null>`case when ${tasks.leaseUntil} > now() then ${tasks.owner} end`,
      lease_until: sql<string | null>`case when ${tasks.leaseUntil} > now()
        then to_char(${tasks.leaseUntil} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end`,
      updated_at: sql<string>`to_char(${tasks.updatedAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
    })
    .from(tasks)
    .leftJoin(parent, eq(parent.id, tasks.parentId))
    .where(projectId ? eq(tasks.projectId, projectId) : undefined)
    .orderBy(sql`${tasks.priority} asc nulls last`, desc(tasks.updatedAt));
}

api.get("/projects/:slug", async (c) => {
  try {
    const data = await withDb(async (db) => {
      const p = await findProject(db, c.req.param("slug"));
      const rows = await screenTasks(db, p.id);
      return {
        slug: p.slug,
        title: p.title,
        resume: await resumeDigest(db, p),
        tasks: rows.map(({ project_id: _, ...t }) => t),
        decisions: await listDecisions(db, p.id, { limit: DECISIONS_LIMIT }),
      };
    });
    return c.json(data);
  } catch (e) {
    return errorResponse(c, e);
  }
});

// One task in the same shape the get_task MCP tool returns.
api.get("/projects/:slug/tasks/:key", async (c) => {
  try {
    const data = await withDb(async (db) => {
      const p = await findProject(db, c.req.param("slug"));
      const t = await findTask(db, p.id, c.req.param("key"));
      if (!t) throw new ToolError("TASK_NOT_FOUND");
      return taskShape(db, t);
    });
    return c.json(data);
  } catch (e) {
    return errorResponse(c, e);
  }
});

// Status and priority changes from the screen go through the same set_task path agents use, as Jorge:
// any move is allowed (Done included) and leases do not stop him, but the version shown must be current.
const taskPatch = z.object({
  status: z.string().optional(),
  priority: z.string().optional(),
  note: z.string().optional(),
  version: z.number().int().optional(),
});

api.patch("/projects/:slug/tasks/:key", async (c) => {
  const body = await readJson(c, taskPatch);
  if (body instanceof Response) return body;
  try {
    const result = await withDb((db) => setTask(db, { project: c.req.param("slug"), key: c.req.param("key"), ...body }, webCtx));
    return c.json(result);
  } catch (e) {
    return errorResponse(c, e);
  }
});

// Jorge frees a lease held by a session that is gone.
api.post("/projects/:slug/tasks/:key/release", async (c) => {
  try {
    const result = await withDb((db) =>
      claim(db, { project: c.req.param("slug"), key: c.req.param("key"), action: "release" }, webCtx),
    );
    return c.json(result);
  } catch (e) {
    return errorResponse(c, e);
  }
});

// Jorge answers a question an agent asked; the answer becomes a decision on the task.
api.post("/projects/:slug/questions/:id/answer", async (c) => {
  const body = await readJson(c, z.object({ answer: z.string().trim().min(1) }));
  if (body instanceof Response) return body;
  try {
    const result = await withDb((db) =>
      answer(db, { project: c.req.param("slug"), question_id: c.req.param("id"), answer: body.answer }, webCtx),
    );
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
