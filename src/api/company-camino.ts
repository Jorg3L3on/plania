// PLA-I68: Camino's routes, under /api/company (the owner's cookie only; company.ts's guard refuses any Bearer).
//   GET    /projects/:slug/camino                    the read (src/camino/store.ts caminoRead). The first open runs
//                                                    discovery and waits for it; a read older than STALE_MS starts one
//                                                    in the background (checking: true) and answers at once.
//   POST   /projects/:slug/camino/recheck            «Volver a comprobar»: discovery now, then the read
//   PUT    /projects/:slug/camino/keys/:provider     {value}: tried, then saved in the keychain; only metadata returns
//   POST   /projects/:slug/camino/keys/:provider/test  «Probar» with the saved key
//   DELETE /projects/:slug/camino/keys/:provider     removes the key
//   POST   /projects/:slug/camino/lint               {path, content}: actionlint's verdict on a workflow before staging
//   POST   /projects/:slug/camino/pins               {uses: ["owner/repo@tag"]}: the commit each tag points at, to pin
//   POST   /projects/:slug/camino/runs/:id/rerun     re-runs a run's failed jobs on GitHub
//   POST   /projects/:slug/camino/apply              {version, changes}: the change set, in order (src/camino/changes.ts);
//                                                    answers the results, where it stopped, and the read
import { Hono, type Context } from "hono";
import { z } from "zod";
import { withDb } from "../db/client.js";
import { ToolError } from "../mcp/errors.js";
import { findProject } from "../mcp/queries.js";
import { removeKey, saveKey, tryKey } from "../camino/connections.js";
import { applyChanges, ChangeSchema, GITHUB_FILE, rerunFailed, resolvePins } from "../camino/changes.js";
import { caminoDeps, caminoRead, caminoRow, discoverOnce, STALE_MS } from "../camino/store.js";

export const caminoRoutes = new Hono();

function fail(c: Context, e: unknown): Response {
  if (e instanceof ToolError) return c.json({ error: e.code, ...e.detail }, e.status);
  throw e;
}
async function json<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T> | Response> {
  if (!c.req.header("Content-Type")?.startsWith("application/json")) return c.json({ error: "JSON_REQUIRED" }, 415);
  const parsed = schema.safeParse(await c.req.json().catch(() => undefined));
  if (!parsed.success) return c.json({ error: "INVALID_BODY" }, 400);
  return parsed.data;
}

caminoRoutes.get("/projects/:slug/camino", async (c) => {
  try {
    return c.json(
      await withDb(async (db) => {
        const p = await findProject(db, c.req.param("slug"));
        const row = await caminoRow(db, p.id);
        const age = row.checkedAt ? caminoDeps.now().getTime() - row.checkedAt.getTime() : Infinity;
        if (!row.discovery) await discoverOnce(db, p);
        else if (age > STALE_MS) void discoverOnce(db, p).catch(() => {});
        return caminoRead(db, p.slug);
      }),
    );
  } catch (e) {
    return fail(c, e);
  }
});

caminoRoutes.post("/projects/:slug/camino/recheck", async (c) => {
  try {
    return c.json(
      await withDb(async (db) => {
        const p = await findProject(db, c.req.param("slug"));
        await discoverOnce(db, p);
        return caminoRead(db, p.slug);
      }),
    );
  } catch (e) {
    return fail(c, e);
  }
});

caminoRoutes.put("/projects/:slug/camino/keys/:provider", async (c) => {
  const input = await json(c, z.object({ value: z.string().min(1).max(700) }).strict());
  if (input instanceof Response) return input;
  try {
    return c.json(await withDb((db) => saveKey(db, c.req.param("slug"), c.req.param("provider"), input.value)));
  } catch (e) {
    return fail(c, e);
  }
});

caminoRoutes.post("/projects/:slug/camino/keys/:provider/test", async (c) => {
  try {
    return c.json(await withDb((db) => tryKey(db, c.req.param("slug"), c.req.param("provider"))));
  } catch (e) {
    return fail(c, e);
  }
});

caminoRoutes.delete("/projects/:slug/camino/keys/:provider", async (c) => {
  try {
    return c.json(await withDb((db) => removeKey(db, c.req.param("slug"), c.req.param("provider"))));
  } catch (e) {
    return fail(c, e);
  }
});

caminoRoutes.post("/projects/:slug/camino/apply", async (c) => {
  const input = await json(c, z.object({ version: z.number().int().min(0), changes: z.array(ChangeSchema).min(1).max(60) }).strict());
  if (input instanceof Response) return input;
  try {
    return c.json(
      await withDb(async (db) => {
        const out = await applyChanges(db, c.req.param("slug"), input);
        return { ...out, read: await caminoRead(db, c.req.param("slug")) };
      }),
    );
  } catch (e) {
    return fail(c, e);
  }
});

caminoRoutes.post("/projects/:slug/camino/lint", async (c) => {
  const input = await json(c, z.object({ path: z.string().regex(GITHUB_FILE), content: z.string().max(200_000) }).strict());
  if (input instanceof Response) return input;
  return c.json(await caminoDeps.actionlint(input.path, input.content));
});

caminoRoutes.post("/projects/:slug/camino/pins", async (c) => {
  const input = await json(c, z.object({ uses: z.array(z.string().regex(/^[A-Za-z0-9-]+\/[A-Za-z0-9._/-]+@[A-Za-z0-9._/-]+$/)).max(40) }).strict());
  if (input instanceof Response) return input;
  try {
    return c.json(await withDb(async (db) => resolvePins(await findProject(db, c.req.param("slug")), input.uses)));
  } catch (e) {
    return fail(c, e);
  }
});

caminoRoutes.post("/projects/:slug/camino/runs/:id/rerun", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: "INVALID_BODY" }, 400);
  try {
    return c.json(await withDb(async (db) => rerunFailed(db, await findProject(db, c.req.param("slug")), id)));
  } catch (e) {
    return fail(c, e);
  }
});
