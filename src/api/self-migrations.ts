// PLA-I2-9: GET /api/projects/:slug/migraciones-propias, the migrations agents wrote in deliveries of the Plania
// project that the live database has not applied (src/self/agent-migrations.ts). Words in
// ui/src/lib/migraciones-propias.ts. Any other project: {self: false, deliveries: []}.
import { Hono } from "hono";
import { withDb } from "../db/client.js";
import { agentMigrations } from "../self/agent-migrations.js";

export const selfMigrationRoutes = new Hono();
selfMigrationRoutes.get("/:slug/migraciones-propias", async (c) => {
  const out = await withDb((db) => agentMigrations(db, c.req.param("slug")));
  if (!out) return c.json({ error: "PROJECT_NOT_FOUND" }, 404);
  return c.json(out);
});
