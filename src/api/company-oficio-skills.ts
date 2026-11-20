// PLA-I67-2: the owner's skills and «tu manera» from the Oficio page (src/runner/skills.ts). Mounted on companyRoutes,
// so only the owner's session cookie reaches them (a Bearer is 403).
//   GET    /api/company/projects/:slug/team/:agent/skills/:skill            the skill card (content, versions, scope)
//   POST   /api/company/projects/:slug/team/:agent/skills                   {name, description, body, scope?, files?} → 201 card
//   PUT    /api/company/projects/:slug/team/:agent/skills/:skill            {name?, description?, body?, scope?, files?} → card
//          a factory skill gets an owner copy first; the kit file is never written
//   PUT    /api/company/projects/:slug/team/:agent/skills/:skill/state      {on} an owner skill on or off → card
//   POST   /api/company/projects/:slug/team/:agent/skills/:skill/rollback   {n} → card
//   POST   /api/company/projects/:slug/team/:agent/skills/:skill/duplicate  → 201 card of the copy
//   DELETE /api/company/projects/:slug/team/:agent/skills/:skill            archived (kept 30 days) → {archived}
//   POST   /api/company/projects/:slug/team/:agent/skills/:skill/restore    → card
//   GET    /api/company/projects/:slug/team/:agent/puesto                   {role, manner, manner_version, motor, archived}
//   PUT    /api/company/projects/:slug/team/:agent/manner                   {text} → puesto
// Errors: 400 SKILL_INVALID | SKILL_NOT_ALLOWED | TOO_LARGE {field}, 404 PROJECT_NOT_FOUND | AGENT_NOT_FOUND |
// SKILL_NOT_FOUND, 409 SKILL_EXISTS.
import { Hono, type Context } from "hono";
import { z } from "zod";
import { withDb } from "../db/client.js";
import { ToolError } from "../mcp/errors.js";
import { SKILL_SCOPES } from "../db/schema.js";
import { archiveSkill, archivedSkills, createSkill, duplicateSkill, editSkill, puestoRead, restoreSkill, rollbackSkill, seatOf, setManner, setSkillState, skillCard } from "../runner/skills.js";

export const oficioSkillRoutes = new Hono();

function fail(c: Context, e: unknown): Response {
  if (e instanceof ToolError) return c.json({ error: e.code, ...e.detail }, e.status);
  throw e;
}

async function body<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T> | Response> {
  if (!c.req.header("Content-Type")?.startsWith("application/json")) return c.json({ error: "JSON_REQUIRED" }, 415);
  const parsed = schema.safeParse(await c.req.json().catch(() => undefined));
  if (!parsed.success) return c.json({ error: "INVALID_BODY" }, 400);
  return parsed.data;
}

const Files = z.array(z.object({ path: z.string().max(200), content: z.string().max(60_000) }).strict()).max(20);
const Scope = z.enum(SKILL_SCOPES);
const NewSkill = z.object({ name: z.string().max(400), description: z.string().max(4000), body: z.string().max(80_000), scope: Scope.optional(), files: Files.optional() }).strict();
const EditBody = z.object({ name: z.string().max(400).optional(), description: z.string().max(4000).optional(), body: z.string().max(80_000).optional(), scope: Scope.optional(), files: Files.optional() }).strict();
const SKILL = "/projects/:slug/team/:agent/skills/:skill";

const card = (c: Context, slug: string, status: 200 | 201 = 200) => withDb((db) => skillCard(db, c.req.param("slug")!, c.req.param("agent")!, slug)).then((out) => c.json(out, status));
const act = async (c: Context, run: () => Promise<Response>) => {
  try {
    return await run();
  } catch (e) {
    return fail(c, e);
  }
};

oficioSkillRoutes.get(SKILL, (c) => act(c, () => card(c, c.req.param("skill"))));

oficioSkillRoutes.post("/projects/:slug/team/:agent/skills", async (c) => {
  const input = await body(c, NewSkill);
  if (input instanceof Response) return input;
  return act(c, async () => card(c, await withDb((db) => createSkill(db, c.req.param("slug"), c.req.param("agent"), input)), 201));
});

oficioSkillRoutes.put(SKILL, async (c) => {
  const input = await body(c, EditBody);
  if (input instanceof Response) return input;
  return act(c, async () => {
    await withDb((db) => editSkill(db, c.req.param("slug"), c.req.param("agent"), c.req.param("skill"), input));
    return card(c, c.req.param("skill"));
  });
});

oficioSkillRoutes.put(`${SKILL}/state`, async (c) => {
  const input = await body(c, z.object({ on: z.boolean() }).strict());
  if (input instanceof Response) return input;
  return act(c, async () => {
    await withDb(async (db) => {
      await seatOf(db, c.req.param("slug"), c.req.param("agent"));
      await setSkillState(db, c.req.param("skill"), input.on);
    });
    return card(c, c.req.param("skill"));
  });
});

oficioSkillRoutes.post(`${SKILL}/rollback`, async (c) => {
  const input = await body(c, z.object({ n: z.number().int().min(1).max(100_000) }).strict());
  if (input instanceof Response) return input;
  return act(c, async () => {
    await withDb(async (db) => {
      await seatOf(db, c.req.param("slug"), c.req.param("agent"));
      await rollbackSkill(db, c.req.param("skill"), input.n);
    });
    return card(c, c.req.param("skill"));
  });
});

oficioSkillRoutes.post(`${SKILL}/duplicate`, (c) => act(c, async () => card(c, await withDb((db) => duplicateSkill(db, c.req.param("slug"), c.req.param("agent"), c.req.param("skill"))), 201)));

oficioSkillRoutes.delete(SKILL, (c) =>
  act(c, async () => {
    await withDb(async (db) => {
      await seatOf(db, c.req.param("slug"), c.req.param("agent"));
      await archiveSkill(db, c.req.param("skill"));
    });
    return c.json({ archived: c.req.param("skill") });
  }),
);

oficioSkillRoutes.post(`${SKILL}/restore`, (c) =>
  act(c, async () => {
    await withDb(async (db) => {
      await seatOf(db, c.req.param("slug"), c.req.param("agent"));
      await restoreSkill(db, c.req.param("skill"));
    });
    return card(c, c.req.param("skill"));
  }),
);

const puesto = (c: Context) =>
  withDb(async (db) => {
    const p = await puestoRead(db, c.req.param("slug")!, c.req.param("agent")!);
    const a = await seatOf(db, c.req.param("slug")!, c.req.param("agent")!);
    return c.json({ ...p, archived: await archivedSkills(db, a) });
  });

oficioSkillRoutes.get("/projects/:slug/team/:agent/puesto", (c) => act(c, () => puesto(c)));

oficioSkillRoutes.put("/projects/:slug/team/:agent/manner", async (c) => {
  const input = await body(c, z.object({ text: z.string().max(10_000) }).strict());
  if (input instanceof Response) return input;
  return act(c, async () => {
    await withDb((db) => setManner(db, c.req.param("slug"), c.req.param("agent"), input.text));
    return puesto(c);
  });
});
