// PLA-I46-6: the stills of a project's running app, for the floor's Ventana and the QA evidence card.
// Mounted under /api/projects after the session check, so the screen cookie opens it and nothing else does.
//   GET /api/projects/:slug/captures[?task=<KEY>]  latest still per page and viewport (src/captures/store.ts)
//   GET /api/projects/:slug/captures/:id.png       one still's PNG
import { Hono } from "hono";
import { withDb } from "../db/client.js";
import { latestStills, stillFile } from "../captures/store.js";

export const captureRoutes = new Hono();

captureRoutes.get("/:slug/captures", async (c) => {
  const task = c.req.query("task") || undefined;
  const read = await withDb((db) => latestStills(db, c.req.param("slug"), { taskKey: task }));
  if (!read) return c.json({ error: task ? "TASK_NOT_FOUND" : "PROJECT_NOT_FOUND" }, 404);
  return c.json(read);
});

captureRoutes.get("/:slug/captures/:file", async (c) => {
  const m = /^([0-9a-f-]{36})\.png$/.exec(c.req.param("file"));
  if (!m) return c.json({ error: "NOT_FOUND" }, 404);
  const png = await withDb((db) => stillFile(db, c.req.param("slug"), m[1]!));
  if (!png) return c.json({ error: "NOT_FOUND" }, 404);
  // A still never changes: its id names one file.
  return c.body(new Uint8Array(png), 200, { "Content-Type": "image/png", "Cache-Control": "private, max-age=31536000, immutable" });
});
