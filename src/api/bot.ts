import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { bus } from "../events.js";
import type { Auth } from "../auth/bearer.js";
import { withDb } from "../db/client.js";
import { inbox } from "../mcp/inbox.js";
import { ToolError, findProject, listEvents } from "../mcp/queries.js";
import { getDigest, getRunning, listProjects, readerOf } from "../mcp/watch.js";

// 2.7: the Watch API as plain Bearer GET JSON for assistants that speak HTTP, not MCP. Mounted at
// /bot/v1 behind a read-scoped Bearer (app.ts); the screen cookie never opens it and /api stays
// cookie-only. Each route answers exactly what the MCP tool of the same name does.
export const bot = new Hono<{ Variables: { auth: Auth } }>();

const num = (v: string | undefined) => (v === undefined || v === "" ? undefined : Number(v));

bot.onError((e, c) => {
  if (e instanceof ToolError) return c.json({ error: e.code, ...e.detail }, e.status);
  throw e;
});

bot.get("/digest", async (c) => {
  const since = num(c.req.query("since"));
  const per = num(c.req.query("max_events_per_project"));
  if ((since !== undefined && !Number.isInteger(since)) || (per !== undefined && !Number.isInteger(per))) return c.json({ error: "INVALID_FILTER", field: "since" }, 400);
  const auth = c.get("auth");
  const reader = readerOf(auth.identity, auth.scopes);
  return c.json(await withDb((db) => getDigest(db, { since, project: c.req.query("project") || undefined, max_events_per_project: per, reader })));
});

bot.get("/projects", async (c) => c.json(await withDb((db) => listProjects(db))));

bot.get("/running", async (c) => c.json(await withDb((db) => getRunning(db))));

bot.get("/inbox", async (c) => {
  const slug = c.req.query("project") || "all";
  return c.json(await withDb(async (db) => inbox(db, slug === "all" ? "all" : await findProject(db, slug))));
});

bot.get("/events", async (c) => {
  const slug = c.req.query("project") || "all";
  const since = num(c.req.query("since"));
  const limit = num(c.req.query("limit"));
  if (since !== undefined && !Number.isInteger(since)) return c.json({ error: "INVALID_FILTER", field: "since" }, 400);
  const types = c.req.query("types")?.split(",").filter(Boolean);
  const key = c.req.query("key") || undefined;
  return c.json(
    await withDb(async (db) => listEvents(db, slug === "all" ? null : (await findProject(db, slug)).id, { since, key, types, limit })),
  );
});

// 2.8: the feed as server-sent events for an assistant that can hold a connection. ?project=all
// (default) or a slug, ?types=a,b, and the cursor from ?since= or the Last-Event-ID header (the id of
// the last message seen). Replays what the cursor missed, then streams as writes commit; every
// message is one list_events row and its id is the next cursor. Polling /digest stays the default.
const STREAM_PING_MS = 25_000;
bot.get("/stream", async (c) => {
  const slug = c.req.query("project") || "all";
  const types = c.req.query("types")?.split(",").filter(Boolean);
  let since = Number(c.req.query("since") ?? c.req.header("Last-Event-ID") ?? 0) || 0;
  const projectId = slug === "all" ? null : (await withDb((db) => findProject(db, slug))).id;
  return streamSSE(c, async (stream) => {
    const send = async () => {
      const page = await withDb((db) => listEvents(db, projectId, { since, types, limit: 500 }));
      for (const e of page.events) await stream.writeSSE({ event: e.type, id: String(e.id), data: JSON.stringify(e) });
      since = Math.max(since, page.next_cursor);
      if (page.more) await send();
    };
    await send();
    await stream.writeSSE({ event: "ready", data: JSON.stringify({ cursor: since, project: slug }) });
    let pending: Promise<void> = Promise.resolve();
    const unsubscribe = bus.subscribe((change) => {
      if (slug !== "all" && change.project !== slug) return;
      pending = pending.then(send).catch(() => undefined);
    });
    const ping = setInterval(() => void stream.writeSSE({ event: "ping", data: JSON.stringify({ cursor: since }) }), STREAM_PING_MS);
    await new Promise<void>((resolve) =>
      stream.onAbort(() => {
        clearInterval(ping);
        unsubscribe();
        resolve();
      }),
    );
  });
});
