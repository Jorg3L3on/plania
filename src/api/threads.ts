// PLA-I32-3: the threads, on Jorge's screen. Cookie only, like the company routes: a Bearer (any agent
// token) is 403 even with a cookie, no cookie is 401. Bots read and write through MCP thread_read/thread_post.
//   GET  /api/threads                     every thread with its unread count and last message
//   GET  /api/threads/:id?after=          one thread's messages (after: an ISO time or a message id); marks it read
//   POST /api/threads/:id/messages {body} Jorge writes. In the company thread it wakes Asistente (event
//        thread.message). In a project thread it also makes a Ready ticket for the PO, origin jorge (as
//        Pedirle al PO does), whose creation wakes the PO; the message links that ticket.
//        → 201 {message, created: {kind, key} | null, wake}
//   POST /api/threads/:id/actions {message_id, action, text?}  PLA-I32-4 (src/api/thread-actions.ts) → {ok, action_state}
import { Hono, type Context } from "hono";
import { getCookie } from "hono/cookie";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { SESSION_COOKIE, verifySession } from "../auth/session.js";
import { withDb, type Db } from "../db/client.js";
import { agentRuns } from "../db/schema.js";
import { ToolError } from "../mcp/errors.js";
import { webCtx } from "../mcp/tx.js";
import { asistenteAgent, eventWakesEnabled } from "../runner/events.js";
import { loadSettings } from "../runner/limits.js";
import { JORGE, listThreads, markRead, messageView, postMessage, readThread, resolveThread, type ThreadRef } from "../runner/threads.js";
import { createPoTicket, projectPo } from "./company-actions.js";
import { threadAction } from "./thread-actions.js";

export const threadRoutes = new Hono();

threadRoutes.use("*", async (c, next) => {
  if (/^\s*bearer\b/i.test(c.req.header("Authorization") ?? "")) {
    return c.json({ error: "FORBIDDEN", hint: "threads are Jorge's screen; bots use thread_read and thread_post" }, 403);
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

threadRoutes.get("/", async (c) => c.json({ threads: await withDb((db) => listThreads(db)) }));

threadRoutes.get("/:id", async (c) => {
  try {
    return c.json(
      await withDb(async (db) => {
        const ref = await resolveThread(db, c.req.param("id"));
        const view = await readThread(db, ref, c.req.query("after"));
        await markRead(db, ref.thread.id);
        return view;
      }),
    );
  } catch (e) {
    return fail(c, e);
  }
});

export type WakeWord = "queued" | "busy" | "off" | "paused" | "no_agent";

async function asistenteWake(db: Db): Promise<WakeWord> {
  if (!eventWakesEnabled()) return "off";
  if ((await loadSettings(db)).companyPaused) return "paused";
  const a = await asistenteAgent(db);
  if (!a) return "no_agent";
  const [run] = await db.select({ id: agentRuns.id }).from(agentRuns).where(and(eq(agentRuns.agentId, a.id), inArray(agentRuns.status, ["queued", "running"]))).limit(1);
  return run ? "queued" : "off";
}

export type PostResult = { message: Awaited<ReturnType<typeof messageView>>; created: { kind: "ticket"; key: string } | null; wake: WakeWord };

export async function jorgePosts(db: Db, ref: ThreadRef, text: string): Promise<PostResult> {
  if (ref.thread.kind === "company" || !ref.project) {
    const msg = await postMessage(db, ref, { author: JORGE, body: text }, { ...webCtx, tool: "screen.thread_post" });
    return { message: await messageView(db, msg, null), created: null, wake: await asistenteWake(db) };
  }
  const project = ref.project;
  const po = await projectPo(db, project);
  if (!po) {
    const msg = await postMessage(db, ref, { author: JORGE, body: text }, { ...webCtx, tool: "screen.thread_post" });
    return { message: await messageView(db, msg, project.id), created: null, wake: "no_agent" };
  }
  const made = await createPoTicket(db, project, po, text, "el hilo del proyecto");
  const msg = await postMessage(
    db,
    ref,
    { author: JORGE, body: text, links: [{ kind: "ticket", ref: made.key, title: made.title }] },
    { ...webCtx, tool: "screen.thread_post" },
  );
  const settings = await loadSettings(db);
  const wake: WakeWord = made.wake === "off" && (settings.companyPaused || project.runsPaused) && eventWakesEnabled() ? "paused" : made.wake;
  return { message: await messageView(db, msg, project.id), created: { kind: "ticket", key: made.key }, wake };
}

const MessageBody = z.object({ body: z.string().trim().min(1).max(4000) }).strict();

threadRoutes.post("/:id/messages", async (c) => {
  const input = await body(c, MessageBody);
  if (input instanceof Response) return input;
  try {
    return c.json(
      await withDb(async (db) => jorgePosts(db, await resolveThread(db, c.req.param("id")), input.body)),
      201,
    );
  } catch (e) {
    return fail(c, e);
  }
});

const ActionBody = z
  .object({
    message_id: z.string().uuid(),
    action: z.enum(["aceptar", "fusionar", "cambios", "responder"]),
    text: z.string().trim().min(1).max(2000).optional(),
  })
  .strict();

// PLA-I32-4 (src/api/thread-actions.ts): Aceptar / Fusionar, Pedir cambios, Responder.
threadRoutes.post("/:id/actions", async (c) => {
  const input = await body(c, ActionBody);
  if (input instanceof Response) return input;
  try {
    const out = await withDb(async (db) => threadAction(db, await resolveThread(db, c.req.param("id")), input));
    if ("error" in out) {
      const { status, ...rest } = out;
      return c.json(rest, status);
    }
    return c.json(out);
  } catch (e) {
    return fail(c, e);
  }
});
