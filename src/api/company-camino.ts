// PLA-I68: Camino's routes, under /api/company (the owner's cookie only; company.ts's guard refuses any Bearer).
//   GET    /projects/:slug/camino                    the read (src/camino/store.ts caminoRead). The first open and a
//                                                    read older than STALE_MS start discovery in the background
//                                                    (checking: true) and answer at once with Plania's own config.
//   POST   /projects/:slug/camino/recheck            «Volver a comprobar»: discovery now, then the read
//   PUT    /projects/:slug/camino/keys/:provider     {value}: tried, then saved in the keychain; only metadata returns
//   POST   /projects/:slug/camino/keys/:provider/test  «Probar» with the saved key
//   DELETE /projects/:slug/camino/keys/:provider     removes the key
//   POST   /projects/:slug/camino/repo-check         {repo}: a pasted repository looked up on GitHub before it is staged
//   POST   /projects/:slug/camino/lint               {path, content}: actionlint's verdict on a workflow before staging
//   POST   /projects/:slug/camino/pins               {uses: ["owner/repo@tag"]}: the commit each tag points at, to pin
//   POST   /projects/:slug/camino/runs/:id/rerun     re-runs a run's failed jobs on GitHub
//   POST   /projects/:slug/camino/providers/:provider/list  {project?}: what the saved key opens (projects, branches,
//                                                    releases), to pick from
//   POST   /projects/:slug/camino/providers/:provider/vars  {project, target?}: variable NAMES on the service
//   POST   /projects/:slug/camino/approve            {path, sha256}: the owner approves that exact migration file
//   POST   /projects/:slug/camino/migrations         {database, tool}: rows in the local database's migration table
//   POST   /projects/:slug/camino/apply              {version, changes}: the change set, in order (src/camino/changes.ts);
//                                                    answers the results, where it stopped, and the read
import { Hono, type Context } from "hono";
import { z } from "zod";
import { withDb } from "../db/client.js";
import { ToolError } from "../mcp/errors.js";
import { findProject } from "../mcp/queries.js";
import { removeKey, saveKey, tryKey } from "../camino/connections.js";
import { applyChanges, ChangeSchema, GITHUB_FILE, rerunFailed, resolvePins } from "../camino/changes.js";
import { addHistory, caminoDeps, caminoRead, caminoRow, discoverOnce, githubFor, STALE_MS } from "../camino/store.js";
import { listFor, varsFor } from "../camino/envs.js";
import { approveMigration, localMigrationCount } from "../camino/approve.js";
import { PROVIDERS, type ProviderId } from "../camino/types.js";

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
        // PLA-I70-41: Plania's own configuration answers at once; the GitHub read (40+ calls on a real repo) fills in behind it.
        if (!row.discovery || age > STALE_MS) void discoverOnce(db, p).catch(() => {});
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
        // PLA-I70-7: what was applied on GitHub (or the repo or folder it is read from) shows at once, not after a recheck.
        if (out.results.some((x) => x.ok && (x.dest === "github" || x.dest === "pr" || x.kind === "repo" || x.kind === "folder"))) {
          await discoverOnce(db, await findProject(db, c.req.param("slug"))).catch(() => {});
        }
        return { ...out, read: await caminoRead(db, c.req.param("slug")) };
      }),
    );
  } catch (e) {
    return fail(c, e);
  }
});

// PLA-I70-11: a pasted repository is looked up on GitHub before it is staged.
caminoRoutes.post("/projects/:slug/camino/repo-check", async (c) => {
  const input = await json(c, z.object({ repo: z.string().regex(/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/) }).strict());
  if (input instanceof Response) return input;
  try {
    return c.json(
      await withDb(async (db) => {
        const api = await githubFor(await findProject(db, c.req.param("slug")));
        if (!api) return { ok: false, reason: "no_token" };
        try {
          const r = await api.call("GET", `/repos/${input.repo}`);
          if (r.status === 404) return { ok: false, reason: "not_found" };
          if (r.status === 401 || r.status === 403) return { ok: false, reason: "refused" };
          if (r.status < 200 || r.status >= 300) return { ok: false, reason: "network" };
          const j = (await r.json()) as { full_name: string; private: boolean; default_branch: string };
          return { ok: true, repo: j.full_name, private: j.private, default_branch: j.default_branch };
        } catch {
          return { ok: false, reason: "network" };
        }
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

caminoRoutes.post("/projects/:slug/camino/providers/:provider/list", async (c) => {
  const input = await json(c, z.object({ project: z.string().max(200).optional() }).strict());
  if (input instanceof Response) return input;
  try {
    return c.json(
      await withDb(async (db) => {
        const p = await findProject(db, c.req.param("slug"));
        const provider = c.req.param("provider") as ProviderId;
        if (!(PROVIDERS as readonly string[]).includes(provider)) throw new ToolError("CAMINO_PROVIDER_UNKNOWN", { provider });
        return listFor(p, provider, caminoDeps.fetch, { project: input.project, gh: provider === "github_releases" ? await githubFor(p) : null });
      }),
    );
  } catch (e) {
    return fail(c, e);
  }
});

caminoRoutes.post("/projects/:slug/camino/providers/:provider/vars", async (c) => {
  const input = await json(c, z.object({ project: z.string().min(1).max(200), target: z.string().max(40).nullable().optional() }).strict());
  if (input instanceof Response) return input;
  try {
    return c.json(
      await withDb(async (db) => {
        const p = await findProject(db, c.req.param("slug"));
        const provider = c.req.param("provider") as ProviderId;
        if (!(PROVIDERS as readonly string[]).includes(provider)) throw new ToolError("CAMINO_PROVIDER_UNKNOWN", { provider });
        return varsFor(p, provider, caminoDeps.fetch, input.project, input.target ?? null);
      }),
    );
  } catch (e) {
    return fail(c, e);
  }
});

caminoRoutes.post("/projects/:slug/camino/approve", async (c) => {
  const input = await json(c, z.object({ path: z.string().min(1).max(300), sha256: z.string().regex(/^[0-9a-f]{64}$/) }).strict());
  if (input instanceof Response) return input;
  try {
    return c.json(await withDb((db) => approveMigration(db, c.req.param("slug"), input.path, input.sha256)));
  } catch (e) {
    return fail(c, e);
  }
});

caminoRoutes.post("/projects/:slug/camino/migrations", async (c) => {
  const input = await json(c, z.object({ database: z.string().regex(/^[A-Za-z0-9_-]{1,63}$/), tool: z.enum(["drizzle", "prisma", "supabase", "knex"]) }).strict());
  if (input instanceof Response) return input;
  return c.json(await localMigrationCount(input.database, input.tool));
});
