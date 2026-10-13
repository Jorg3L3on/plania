import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import { streamSSE } from "hono/streaming";
import { asc, desc, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { verifyPassword } from "../auth/password.js";
import { SESSION_COOKIE, createSession, sessionCookieOptions, verifySession } from "../auth/session.js";
import { issueToken, listTokens, revokeToken, TOKEN_SCOPES } from "../auth/tokens.js";
import { withDb, type Db } from "../db/client.js";
import { projects, tasks, type Actor } from "../db/schema.js";
import { bus } from "../events.js";
import { machineInventory, machineTotals, thisMachine } from "../jobs/machine/index.js";
import { decideApproval } from "../mcp/approvals.js";
import { resolveHumanAction, SETTLED_STATUSES } from "../mcp/blockers.js";
import { waiveCheck } from "../mcp/checks.js";
import { listDecisions } from "../mcp/decisions.js";
import { footprintFindings } from "../mcp/footprint-audit.js";
import { inbox } from "../mcp/inbox.js";
import { setProject } from "../mcp/project.js";
import { ToolError, findProject, findTask, taskFull } from "../mcp/queries.js";
import { answer } from "../mcp/questions.js";
import { resumeDigest, resumeLine } from "../mcp/resume.js";
import { WEB_ACTOR, webCtx, writeTx } from "../mcp/tx.js";
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

const DECISIONS_LIMIT = 30;
const ACTIVITY_DAYS = 7;

// Events per project per day in the screen's time zone, the last ACTIVITY_DAYS days, oldest first.
// One query for every project; the index draws one small bar per day.
async function activityByProject(db: Db): Promise<Map<string, number[]>> {
  const tz = process.env.PLANIA_TZ || "America/Mexico_City";
  const rows = (
    await db.execute<{ project_id: string; d: string; n: number }>(sql`
      select project_id, to_char(created_at at time zone ${tz}, 'YYYY-MM-DD') as d, count(*)::int as n
      from events
      where created_at > now() - make_interval(days => ${ACTIVITY_DAYS})
      group by 1, 2`)
  ).rows;
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: tz });
  const days = Array.from({ length: ACTIVITY_DAYS }, (_, i) => day.format(new Date(Date.now() - (ACTIVITY_DAYS - 1 - i) * 86_400_000)));
  const out = new Map<string, number[]>();
  for (const r of rows) {
    const list = out.get(r.project_id) ?? out.set(r.project_id, days.map(() => 0)).get(r.project_id)!;
    const i = days.indexOf(r.d);
    if (i >= 0) list[i] = r.n;
  }
  return out;
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

// Every project with its generated line, open question count, and all its tasks without scope.
api.get("/projects", async (c) => {
  const rows = await withDb(async (db) => {
    const all = await db.select().from(projects).orderBy(asc(projects.slug));
    const allTasks = await screenTasks(db);
    const activity = await activityByProject(db);
    return Promise.all(
      all.map(async (p) => {
        const digest = await resumeDigest(db, p, { includeLegacy: true });
        return {
          slug: p.slug,
          title: p.title,
          line: resumeLine(digest),
          open_questions: digest.open_questions.length,
          // The index draws one lane per initiative, so it needs every project's tasks.
          tasks: allTasks.filter((t) => t.project_id === p.id).map(({ project_id: _, ...t }) => t),
          // Inicio: the next ticket an agent can take, each environment in one line, and a week of activity.
          next_claimable: digest.next_claimable,
          envs: digest.status.envs.map((e) => ({
            env: e.env,
            commit: e.commit,
            branch: e.branch,
            deployed_at: e.deployed_at,
            flags: e.flags,
            behind: e.drift.behind.length,
          })),
          activity: activity.get(p.id) ?? Array.from({ length: ACTIVITY_DAYS }, () => 0),
          // Inicio's city: what each open initiative says it is doing and what it needs next.
          initiatives: digest.initiatives.map((i) => ({ key: i.key, in_progress: i.in_progress.note, next_action: i.next_action.note })),
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
      // When the live lease started and when its holder last wrote, for "desde hace" and "visto hace".
      claimed_at: sql<string | null>`case when ${tasks.leaseUntil} > now()
        then to_char(${tasks.claimedAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end`,
      last_seen_at: sql<string | null>`case when ${tasks.leaseUntil} > now()
        then to_char(${tasks.lastSeenAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end`,
      updated_at: sql<string>`to_char(${tasks.updatedAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
      // Tasks this one still waits on (not yet settled), so the screen can queue it behind them.
      waits_on: sql<string[]>`coalesce((select array_agg(bt.key order by bt.key) from task_blockers tb
        join tasks bt on bt.id = tb.blocker_id
        where tb.task_id = ${tasks.id} and bt.status not in (${sql.join(SETTLED_STATUSES.map((s) => sql`${s}`), sql`, `)})), '{}')`,
      // Any typed blocker (env, flag, metric, time, an open human action) holds it outside the initiative.
      held: sql<boolean>`exists (select 1 from blockers bx where bx.task_id = ${tasks.id}
        and not (bx.type = 'human_action' and bx.satisfied_at is not null))`,
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
        version: p.version,
        resume: await resumeDigest(db, p, { includeLegacy: true }),
        tasks: rows.map(({ project_id: _, ...t }) => t),
        decisions: await listDecisions(db, p.id, { limit: DECISIONS_LIMIT, includeSuperseded: true, includeRetired: true }),
      };
    });
    return c.json(data);
  } catch (e) {
    return errorResponse(c, e);
  }
});

// The headline: one line on where the project stands, with the project version on screen.
api.patch("/projects/:slug", async (c) => {
  const body = await readJson(c, z.object({ headline: z.string().max(280), version: z.number().int() }));
  if (body instanceof Response) return body;
  try {
    const result = await withDb((db) => setProject(db, { project: c.req.param("slug"), ...body }, webCtx));
    return c.json(result);
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
      return taskFull(db, t, { log: true });
    });
    return c.json(data);
  } catch (e) {
    return errorResponse(c, e);
  }
});

// Writes from the screen ask for the full task back (verbose), so the panel can refresh in place.
const screenCtx = { ...webCtx, verbose: true };

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
    const result = await withDb((db) => setTask(db, { project: c.req.param("slug"), key: c.req.param("key"), ...body }, screenCtx));
    // warnings ride along: closing a ticket that still has things running on the Mac names each one.
    return c.json(result.warnings?.length ? { ...result.task, warnings: result.warnings } : result.task);
  } catch (e) {
    return errorResponse(c, e);
  }
});

// Jorge waives a check (no approval needed on screen); the note says why.
api.post("/projects/:slug/tasks/:key/checks/:n/waive", async (c) => {
  const body = await readJson(c, z.object({ reason: z.string().trim().min(1) }));
  if (body instanceof Response) return body;
  const n = Number(c.req.param("n"));
  if (!Number.isInteger(n)) return c.json({ error: "INVALID_BODY" }, 400);
  try {
    const result = await withDb((db) => waiveCheck(db, { project: c.req.param("slug"), key: c.req.param("key"), n, reason: body.reason }, screenCtx));
    return c.json(result.task);
  } catch (e) {
    return errorResponse(c, e);
  }
});

// Jorge marks a human action done (a ticket blocked on him); the ticket may go back to Ready at once.
api.post("/projects/:slug/blockers/:id/resolve", async (c) => {
  try {
    const result = await withDb(async (db) => {
      const p = await findProject(db, c.req.param("slug"));
      return writeTx(db, p, webCtx, (tx, emit) => resolveHumanAction(tx, emit, p.id, c.req.param("id"), WEB_ACTOR));
    });
    return c.json(result);
  } catch (e) {
    return errorResponse(c, e);
  }
});

// Jorge frees a lease held by a session that is gone.
api.post("/projects/:slug/tasks/:key/release", async (c) => {
  try {
    const result = await withDb((db) =>
      claim(db, { project: c.req.param("slug"), key: c.req.param("key"), action: "release" }, screenCtx),
    );
    return c.json(result.task);
  } catch (e) {
    return errorResponse(c, e);
  }
});

// Jorge answers a question an agent asked; with decision_text the answer is also logged as a decision.
api.post("/projects/:slug/questions/:id/answer", async (c) => {
  const body = await readJson(c, z.object({ answer: z.string().trim().min(1), decision_text: z.string().trim().optional() }));
  if (body instanceof Response) return body;
  try {
    const result = await withDb((db) =>
      answer(
        db,
        { project: c.req.param("slug"), question_id: c.req.param("id"), answer: body.answer, decision_text: body.decision_text || undefined },
        screenCtx,
      ),
    );
    return c.json(result);
  } catch (e) {
    return errorResponse(c, e);
  }
});

// ---- Inbox and approvals

// Everything waiting on Jorge, for one project or all of them.
api.get("/inbox", async (c) => {
  const which = c.req.query("project") || "all";
  try {
    const data = await withDb(async (db) => inbox(db, which === "all" ? "all" : await findProject(db, which)));
    return c.json(data);
  } catch (e) {
    return errorResponse(c, e);
  }
});

// Grant or reject approvals, several at once: each is its own write and its own event.
api.post("/approvals/decide", async (c) => {
  const body = await readJson(c, z.object({ ids: z.array(z.string().min(1)).min(1).max(100), decision: z.enum(["grant", "reject"]), note: z.string().optional() }));
  if (body instanceof Response) return body;
  const results = await withDb(async (db) =>
    Promise.all(
      body.ids.map(async (id) => {
        try {
          const { approval } = await decideApproval(db, { approval_id: id, decision: body.decision, note: body.note }, webCtx);
          return { id, ok: true, state: approval.state };
        } catch (e) {
          if (e instanceof ToolError) return { id, ok: false, error: e.code, ...e.detail };
          throw e;
        }
      }),
    ),
  );
  return c.json({ results, decided: results.filter((r) => r.ok).length });
});

// ---- Machine

// What runs and is stored on this Mac for agent work (the machine job's footprints plus declarations),
// every unreleased row with its project, initiative, ticket and session, and the header totals.
// Read-only: the screen never stops or deletes anything.
api.get("/machine", async (c) => {
  const { items, findings } = await withDb(async (db) => ({
    items: await machineInventory(db),
    // What no project audit can hold: rows without a project (Plania's own repo, shared servers, nobody's).
    findings: await footprintFindings(db, { projectless: true }),
  }));
  return c.json({ machine: thisMachine(), totals: machineTotals(items), findings, items });
});

// ---- Agent tokens (issued here only; the secret is shown once)

api.get("/tokens", async (c) => c.json(await withDb((db) => listTokens(db))));

api.post("/tokens", async (c) => {
  const body = await readJson(
    c,
    z.object({
      name: z.string().trim().min(1).max(80),
      agent: z.string().trim().min(1).max(60),
      machine: z.string().trim().max(120).optional(),
      scopes: z.array(z.enum(TOKEN_SCOPES)).min(1),
    }),
  );
  if (body instanceof Response) return body;
  if (body.agent.toLowerCase() === "jorge") return c.json({ error: "RESERVED_ACTOR" }, 400);
  const out = await withDb((db) => issueToken(db, body, WEB_ACTOR));
  return c.json(out, 201);
});

api.delete("/tokens/:id", async (c) => {
  const token = await withDb((db) => revokeToken(db, c.req.param("id"), c.req.query("reason")));
  if (!token) return c.json({ error: "NOT_FOUND" }, 404);
  return c.json(token);
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
