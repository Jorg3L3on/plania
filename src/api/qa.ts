// PLA-I46-9: a delivery's QA evidence, for the floor's evidence card, and the PO's check list. Mounted under
// /api/projects after the session check, so the screen cookie opens it and nothing else does.
//   GET /api/projects/:slug/qa/:key[?commit=<sha>]  the latest QA pass on the ticket (or the one on that commit)
//   PUT /api/projects/:slug/qa/:key/checklist         {items: string[] (≤ 3)}: Jorge edits the PO's check list
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { withDb } from "../db/client.js";
import { projects, tasks } from "../db/schema.js";
import { ToolError } from "../mcp/errors.js";
import { WEB_ACTOR } from "../mcp/tx.js";
import { qaEvidence, setPoChecks } from "../runner/qa.js";

export const qaRoutes = new Hono();

qaRoutes.get("/:slug/qa/:key", async (c) => {
  const commit = c.req.query("commit");
  if (commit !== undefined && !/^[0-9a-f]{7,40}$/i.test(commit)) return c.json({ error: "INVALID_FILTER", field: "commit" }, 400);
  const out = await withDb(async (db) => {
    const [p] = await db.select().from(projects).where(eq(projects.slug, c.req.param("slug"))).limit(1);
    if (!p) return { error: "PROJECT_NOT_FOUND" as const };
    const [t] = await db.select().from(tasks).where(and(eq(tasks.projectId, p.id), eq(tasks.key, c.req.param("key")))).limit(1);
    if (!t) return { error: "TASK_NOT_FOUND" as const };
    return qaEvidence(db, p, t, { commit: commit?.toLowerCase() });
  });
  if ("error" in out) return c.json(out, 404);
  return c.json(out);
});

const checklistBody = z.object({ items: z.array(z.string().max(300)).max(3) });

qaRoutes.put("/:slug/qa/:key/checklist", async (c) => {
  if (!c.req.header("Content-Type")?.startsWith("application/json")) return c.json({ error: "JSON_REQUIRED" }, 415);
  const body = checklistBody.safeParse(await c.req.json().catch(() => undefined));
  if (!body.success) return c.json({ error: "INVALID_BODY", hint: "items: hasta 3 cosas a verificar" }, 400);
  try {
    const items = await withDb((db) => setPoChecks(db, { project: c.req.param("slug"), key: c.req.param("key"), items: body.data.items }, WEB_ACTOR));
    return c.json({ items: items.map((i) => ({ n: i.n, text: i.text })) });
  } catch (e) {
    if (e instanceof ToolError) return c.json({ error: e.code, ...e.detail }, e.code.endsWith("NOT_FOUND") ? 404 : 400);
    throw e;
  }
});
