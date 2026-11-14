// PLA-I46-6: the stills of a project's running app, for the floor's Ventana and the QA evidence card.
// Mounted under /api/projects after the session check, so the screen cookie opens it and nothing else does.
//   GET /api/projects/:slug/captures[?task=<KEY>]  latest still per page and viewport (src/captures/store.ts)
//   GET /api/projects/:slug/captures/:id.png       one still's PNG
// PLA-I46-7/8: the read also says whether the test copy is on (prueba), and three clicks act on it, only from the
// screen (src/captures/prueba.ts):
//   POST /api/projects/:slug/captures/encender     Encenderla: start the test copy (sandbox) on this Mac
//   POST /api/projects/:slug/captures/tomar        Reintentar: take the stills again
//   POST /api/projects/:slug/captures/apagar       turn Plania's test copy off
import { Hono } from "hono";
import { withDb } from "../db/client.js";
import { ToolError } from "../mcp/errors.js";
import { apagar, encender, pruebaRead, tomar } from "../captures/prueba.js";
import { latestStills, stillFile } from "../captures/store.js";
import { projects } from "../db/schema.js";
import { eq } from "drizzle-orm";

export const captureRoutes = new Hono();

captureRoutes.get("/:slug/captures", async (c) => {
  const task = c.req.query("task") || undefined;
  const slug = c.req.param("slug");
  const out = await withDb(async (db) => {
    const read = await latestStills(db, slug, { taskKey: task });
    if (!read) return null;
    const [p] = await db.select({ settings: projects.settings }).from(projects).where(eq(projects.slug, slug));
    return { ...read, prueba: await pruebaRead(slug, p?.settings.capture) };
  });
  if (!out) return c.json({ error: task ? "TASK_NOT_FOUND" : "PROJECT_NOT_FOUND" }, 404);
  return c.json(out);
});

const acts = { encender, tomar, apagar } as const;
for (const name of Object.keys(acts) as (keyof typeof acts)[]) {
  captureRoutes.post(`/:slug/captures/${name}`, async (c) => {
    try {
      return c.json({ prueba: await withDb((db) => acts[name](db, c.req.param("slug"))) });
    } catch (e) {
      if (e instanceof ToolError) return c.json({ error: e.code, ...e.detail }, e.code === "PROJECT_NOT_FOUND" ? 404 : 400);
      throw e;
    }
  });
}

captureRoutes.get("/:slug/captures/:file", async (c) => {
  const m = /^([0-9a-f-]{36})\.png$/.exec(c.req.param("file"));
  if (!m) return c.json({ error: "NOT_FOUND" }, 404);
  const png = await withDb((db) => stillFile(db, c.req.param("slug"), m[1]!));
  if (!png) return c.json({ error: "NOT_FOUND" }, 404);
  // A still never changes: its id names one file.
  return c.body(new Uint8Array(png), 200, { "Content-Type": "image/png", "Cache-Control": "private, max-age=31536000, immutable" });
});
