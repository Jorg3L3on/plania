// PLA-I67-6: «Traer de un enlace» and «Probar» on the Oficio page (src/runner/skill-import.ts, src/runner/trial.ts).
// Mounted on companyRoutes, so only the owner's session cookie reaches them (a Bearer is 403).
//   POST /api/company/projects/:slug/team/:agent/import/preview           {url} → every file, the content hash, the slug
//   POST /api/company/projects/:slug/team/:agent/import                   {url, source_hash, scope?} → 201 card (saved off)
//   POST /api/company/projects/:slug/team/:agent/skills/:skill/link/check → {changed, saved_hash, source_hash, current, fetched}
//   POST /api/company/projects/:slug/team/:agent/skills/:skill/link/update {source_hash} → card (the confirmed content)
//   GET  /api/company/projects/:slug/team/:agent/skills/:skill/trials     → {deliveries, trials}
//   POST /api/company/projects/:slug/team/:agent/skills/:skill/trials     {run_id} → 201 {trial, outcome}
//   GET  /api/company/projects/:slug/team/:agent/trials/:id               → the trial (before and after)
// PLA-I71-5:
//   GET  /api/company/catalog/skills?q=                                   skills.sh's search (public, no key) → {skills}
//   preview takes {url} or {catalog: {source, skill}} (a pick, read from its GitHub folder), and returns the review
//   import takes on (false: «Nadie todavía», saved off) and via (skills.sh when it came from the catalog)
//   POST …/skills/:skill/link/decline → the pin stays; that upstream content is not offered again
// Errors: 400 FETCH_* | SKILL_IMPORT_FORMAT | SKILL_NOT_ALLOWED | SKILL_INVALID | SKILL_NOT_IMPORTED | TRIAL_NO_DELIVERY,
// 404 PROJECT_NOT_FOUND | AGENT_NOT_FOUND | SKILL_NOT_FOUND, 409 SKILL_EXISTS | SKILL_IMPORT_CHANGED.
import { Hono, type Context } from "hono";
import { z } from "zod";
import { withDb } from "../db/client.js";
import { SKILL_SCOPES } from "../db/schema.js";
import { ToolError } from "../mcp/errors.js";
import { startTrial, type RunnerDeps } from "../runner/runner.js";
import { applyUpdate, checkUpdate, declineUpdate, importSkill, previewImport, type ImportDeps } from "../runner/skill-import.js";
import { resolveCatalog, searchCatalog } from "../runner/skill-catalog.js";
import { seatOf, skillCard } from "../runner/skills.js";
import { createTrial, trialDeliveries, trialOf, trialsOf, type TrialDeps } from "../runner/trial.js";

export const oficioTrialRoutes = new Hono();

type Deps = { fetch?: ImportDeps["fetch"]; git?: TrialDeps["git"]; runner?: RunnerDeps; now?: () => Date };
let deps: Deps = {};
export const setOficioTrialDepsForTests = (d: Deps) => {
  deps = d;
};
const now = () => (deps.now ? deps.now() : new Date());

function fail(c: Context, e: unknown): Response {
  if (e instanceof ToolError) return c.json({ error: e.code, ...e.detail }, e.status);
  throw e;
}
const act = async (c: Context, run: () => Promise<Response>) => {
  try {
    return await run();
  } catch (e) {
    return fail(c, e);
  }
};
async function body<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T> | Response> {
  if (!c.req.header("Content-Type")?.startsWith("application/json")) return c.json({ error: "JSON_REQUIRED" }, 415);
  const parsed = schema.safeParse(await c.req.json().catch(() => undefined));
  if (!parsed.success) return c.json({ error: "INVALID_BODY" }, 400);
  return parsed.data;
}

const Url = z.string().min(1).max(2048);
const Hash = z.string().regex(/^[0-9a-f]{64}$/);
const SEAT = "/projects/:slug/team/:agent";
const SKILL = `${SEAT}/skills/:skill`;
const p = (c: Context) => ({ slug: c.req.param("slug")!, agent: c.req.param("agent")! });
const fetchDeps = (): ImportDeps => ({ fetch: deps.fetch });

oficioTrialRoutes.get("/catalog/skills", (c) => act(c, async () => c.json({ skills: await searchCatalog(c.req.query("q") ?? "", fetchDeps()) })));

const Pick = z.object({ source: z.string().min(3).max(200), skill: z.string().min(1).max(100) }).strict();
oficioTrialRoutes.post(`${SEAT}/import/preview`, async (c) => {
  const input = await body(c, z.union([z.object({ url: Url }).strict(), z.object({ catalog: Pick }).strict()]));
  if (input instanceof Response) return input;
  return act(c, async () => {
    const url = "url" in input ? input.url : await resolveCatalog(input.catalog.source, input.catalog.skill, fetchDeps());
    return c.json(await withDb((db) => previewImport(db, p(c).slug, p(c).agent, url, fetchDeps(), "url" in input ? null : "skills.sh")));
  });
});

oficioTrialRoutes.post(`${SKILL}/link/decline`, (c) =>
  act(c, async () =>
    c.json(
      await withDb(async (db) => {
        await declineUpdate(db, p(c).slug, p(c).agent, c.req.param("skill")!);
        return skillCard(db, p(c).slug, p(c).agent, c.req.param("skill")!);
      }),
    ),
  ),
);

oficioTrialRoutes.post(`${SEAT}/import`, async (c) => {
  const input = await body(c, z.object({ url: Url, source_hash: Hash, scope: z.enum(SKILL_SCOPES).optional(), on: z.boolean().optional(), via: z.enum(["skills.sh"]).nullable().optional() }).strict());
  if (input instanceof Response) return input;
  return act(c, async () => {
    const card = await withDb(async (db) => {
      const slug = await importSkill(db, p(c).slug, p(c).agent, input, fetchDeps(), now());
      return skillCard(db, p(c).slug, p(c).agent, slug);
    });
    return c.json(card, 201);
  });
});

oficioTrialRoutes.post(`${SKILL}/link/check`, (c) => act(c, async () => c.json(await withDb((db) => checkUpdate(db, p(c).slug, p(c).agent, c.req.param("skill")!, fetchDeps(), now())))));

oficioTrialRoutes.post(`${SKILL}/link/update`, async (c) => {
  const input = await body(c, z.object({ source_hash: Hash }).strict());
  if (input instanceof Response) return input;
  return act(c, async () =>
    c.json(
      await withDb(async (db) => {
        await applyUpdate(db, p(c).slug, p(c).agent, c.req.param("skill")!, input, fetchDeps(), now());
        return skillCard(db, p(c).slug, p(c).agent, c.req.param("skill")!);
      }),
    ),
  );
});

oficioTrialRoutes.get(`${SKILL}/trials`, (c) =>
  act(c, async () =>
    c.json(
      await withDb(async (db) => ({
        deliveries: await trialDeliveries(db, p(c).slug, p(c).agent),
        trials: await trialsOf(db, p(c).slug, p(c).agent, c.req.param("skill")!),
      })),
    ),
  ),
);

oficioTrialRoutes.post(`${SKILL}/trials`, async (c) => {
  const input = await body(c, z.object({ run_id: z.string().uuid() }).strict());
  if (input instanceof Response) return input;
  return act(c, async () =>
    withDb(async (db) => {
      const agent = await seatOf(db, p(c).slug, p(c).agent);
      const made = await createTrial(db, p(c).slug, p(c).agent, c.req.param("skill")!, input, { git: deps.git ?? deps.runner?.git, env: deps.runner?.env });
      const outcome = await startTrial(db, { agent, trialId: made.id, now: now() }, deps.runner ?? {});
      const t = await trialOf(db, p(c).slug, p(c).agent, made.id);
      return c.json({ trial: t, outcome: { kind: outcome.kind, summary: outcome.summary } }, 201);
    }),
  );
});

oficioTrialRoutes.get(`${SEAT}/trials/:id`, (c) => act(c, async () => c.json(await withDb((db) => trialOf(db, p(c).slug, p(c).agent, c.req.param("id")!)))));


