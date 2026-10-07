import { asc, eq } from "drizzle-orm";
import { getCookie } from "hono/cookie";
import { Hono } from "hono";
import { bearerScope } from "../auth/bearer.js";
import { SESSION_COOKIE, verifySession } from "../auth/session.js";
import { withDb } from "../db/client.js";
import { docs, envCommits, projects, tasks } from "../db/schema.js";
import { listDecisions } from "../mcp/decisions.js";
import { projectEnv } from "../mcp/env.js";
import { legacyCard, listEvents, taskShape } from "../mcp/queries.js";
import { projectSequences } from "../mcp/sequences.js";
import { iso } from "../mcp/tx.js";

// A whole project as one JSON file: a backup, or a way to move it. Jorge's session or an MCP
// token (read-write or read-only) may download it; the CI token may not.
export const exporter = new Hono();

exporter.get("/export/:file", async (c) => {
  const file = c.req.param("file");
  if (!file.endsWith(".json")) return c.json({ error: "NOT_FOUND" }, 404);
  const scope = bearerScope(c.req.header("Authorization"));
  if (!verifySession(getCookie(c, SESSION_COOKIE)) && scope !== "rw" && scope !== "ro") {
    return c.json({ error: "UNAUTHORIZED" }, 401);
  }
  const slug = file.slice(0, -".json".length);
  const data = await withDb(async (db) => {
    const [p] = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
    if (!p) return undefined;
    const rows = await db.select().from(tasks).where(eq(tasks.projectId, p.id)).orderBy(asc(tasks.key));
    const allEvents = [];
    for (let since = 0; ; ) {
      const page = await listEvents(db, p.id, { since, limit: 1000 });
      allEvents.push(...page.events);
      if (!page.more) break;
      since = page.next_cursor;
    }
    const docRows = await db.select().from(docs).where(eq(docs.projectId, p.id)).orderBy(asc(docs.createdAt));
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
        legacy_card: legacyCard(p),
        created_at: iso(p.createdAt),
      },
      tasks: await Promise.all(
        rows.map(async (t) => {
          const { log: _log, log_total: _total, ...shape } = await taskShape(db, t);
          return { ...shape, legacy_body: t.body || undefined };
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
      env_commits: (await db.select().from(envCommits).where(eq(envCommits.projectId, p.id))).map((e) => ({
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
