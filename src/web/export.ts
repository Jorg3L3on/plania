import { getCookie } from "hono/cookie";
import { Hono } from "hono";
import { resolveBearer } from "../auth/bearer.js";
import { SESSION_COOKIE, verifySession } from "../auth/session.js";
import { withDb } from "../db/client.js";
import { listDecisions } from "../mcp/decisions.js";
import { projectEnv } from "../mcp/env.js";
import { listEvents, taskShape } from "../mcp/queries.js";
import { projectSequences } from "../mcp/sequences.js";
import { iso } from "../mcp/tx.js";
import { readerOf } from "../store/pg.js";

// A whole project as one JSON file: a backup, or a way to move it. Jorge's session or an MCP
// token (read-write or read-only) may download it; the CI token may not.
export const exporter = new Hono();

exporter.get("/api/export/:file", async (c) => {
  const file = c.req.param("file");
  if (!file.endsWith(".json")) return c.json({ error: "NOT_FOUND" }, 404);
  const auth = await withDb((db) => resolveBearer(db, c.req.header("Authorization")));
  if (!verifySession(getCookie(c, SESSION_COOKIE)) && !auth?.scopes.includes("read")) {
    return c.json({ error: "UNAUTHORIZED" }, 401);
  }
  const slug = file.slice(0, -".json".length);
  const data = await withDb(async (db) => {
    const r = readerOf(db);
    const p = await r.get("projects", { slug });
    if (!p) return undefined;
    const rows = await r.find("tasks", { projectId: p.id }, { orderBy: [{ column: "key" }] });
    const allEvents = [];
    for (let since = 0; ; ) {
      const page = await listEvents(db, p.id, { since, limit: 1000 });
      allEvents.push(...page.events);
      if (!page.more) break;
      since = page.next_cursor;
    }
    const docRows = await r.find("docs", { projectId: p.id }, { orderBy: [{ column: "createdAt" }] });
    const keyOf = new Map(rows.map((t) => [t.id, t.key]));
    return {
      format: "plania-export",
      version: 2,
      exported_at: new Date().toISOString(),
      project: {
        slug: p.slug,
        title: p.title,
        body: p.body,
        rules: p.rulesText,
        rules_version: p.rulesVersion,
        version: p.version,
        created_at: iso(p.createdAt),
      },
      tasks: await Promise.all(
        rows.map(async (t) => {
          const { log_total: _total, ...shape } = await taskShape(db, t);
          return shape;
        }),
      ),
      docs: docRows.map((d) => ({
        id: d.id,
        task_key: d.taskId ? (keyOf.get(d.taskId) ?? null) : null,
        title: d.title,
        markdown: d.markdown,
        version: d.version,
        actor: d.actor,
        created_at: iso(d.createdAt),
        updated_at: iso(d.updatedAt),
      })),
      decisions: await listDecisions(db, p.id, { limit: 500 }),
      env: await projectEnv(db, p.id),
      env_commits: (await r.find("envCommits", { projectId: p.id })).map((e) => ({
        env: e.env,
        sha: e.sha,
        seen_at: iso(e.seenAt),
      })),
      ...(await projectSequences(db, p.id)),
      events: allEvents,
    };
  });
  if (!data) return c.json({ error: "PROJECT_NOT_FOUND" }, 404);
  c.header("Content-Disposition", `attachment; filename="plania-${slug}-${data.exported_at.slice(0, 10)}.json"`);
  return c.json(data);
});
