// PLA-I71-3: Equipo's seat changes (src/runner/puestos.ts). Mounted on companyRoutes, so only the owner's session
// cookie reaches them (a Bearer is 403 before any of this runs): runs never create, move, pause or retire seats, and
// never accept a proposal.
//   GET  /api/company/projects/:slug/equipo                 {puestos: the role catalog with taken, proposals: open ones}
//   GET  /api/company/projects/:slug/team/:agent/below      {below: the seats that cannot be its manager (itself and its reports)}
//   PUT  /api/company/projects/:slug/team/:agent/manager    {reports_to: slug | null (the owner)}
//   PUT  /api/company/projects/:slug/team/:agent/pause      {paused}
//   POST /api/company/projects/:slug/team/:agent/retire     {} → {moved: its reports, now under its manager}
//   POST /api/company/puestos                               {title, line, base} a role of the owner's own → 201
//   POST /api/company/projects/:slug/proposals/:id/decide   {accept} → {state, agent}
// PLA-I71-4:
//   GET  /api/company/projects/:slug/tienda                 the skill store (src/api/company-tienda.ts)
// Errors: 400 PUESTO_INVALID | MANAGER_NOT_ON_TEAM, 404 AGENT_NOT_FOUND | PROPOSAL_NOT_FOUND, 409 MANAGER_LOOP |
// TEAM_FULL | SEAT_REQUIRED | SEAT_TAKEN | PROPOSAL_DECIDED.
import { Hono, type Context } from "hono";
import { z } from "zod";
import { withDb } from "../db/client.js";
import { ToolError } from "../mcp/errors.js";
import { tiendaRead } from "./company-tienda.js";
import { belowOf, catalog, createPuesto, decideProposal, deletePuesto, moveSeat, pauseSeat, proposalsOf, retireSeat } from "../runner/puestos.js";

export const equipoRoutes = new Hono();

async function body<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T> | Response> {
  if (!c.req.header("Content-Type")?.startsWith("application/json")) return c.json({ error: "JSON_REQUIRED" }, 415);
  const parsed = schema.safeParse(await c.req.json().catch(() => undefined));
  if (!parsed.success) return c.json({ error: "INVALID_BODY" }, 400);
  return parsed.data;
}
const act = async (c: Context, run: () => Promise<Response>) => {
  try {
    return await run();
  } catch (e) {
    if (e instanceof ToolError) return c.json({ error: e.code, ...e.detail }, e.status);
    throw e;
  }
};
const SEAT = "/projects/:slug/team/:agent";

equipoRoutes.get("/projects/:slug/equipo", (c) =>
  act(c, async () => c.json(await withDb(async (db) => ({ puestos: await catalog(db, c.req.param("slug")), proposals: await proposalsOf(db, c.req.param("slug")) })))),
);
equipoRoutes.get(`${SEAT}/below`, (c) => act(c, async () => c.json({ below: await withDb((db) => belowOf(db, c.req.param("slug"), c.req.param("agent"))) })));

equipoRoutes.put(`${SEAT}/manager`, async (c) => {
  const input = await body(c, z.object({ reports_to: z.string().max(80).nullable() }).strict());
  if (input instanceof Response) return input;
  return act(c, async () => {
    await withDb((db) => moveSeat(db, c.req.param("slug"), c.req.param("agent"), input.reports_to));
    return c.json({ ok: true });
  });
});
equipoRoutes.put(`${SEAT}/pause`, async (c) => {
  const input = await body(c, z.object({ paused: z.boolean() }).strict());
  if (input instanceof Response) return input;
  return act(c, async () => {
    await withDb((db) => pauseSeat(db, c.req.param("slug"), c.req.param("agent"), input.paused));
    return c.json({ paused: input.paused });
  });
});
equipoRoutes.post(`${SEAT}/retire`, async (c) => {
  const input = await body(c, z.object({}).strict());
  if (input instanceof Response) return input;
  return act(c, async () => c.json(await withDb((db) => retireSeat(db, c.req.param("slug"), c.req.param("agent")))));
});
equipoRoutes.post("/puestos", async (c) => {
  const input = await body(c, z.object({ title: z.string().max(200), line: z.string().max(400), base: z.string().max(40) }).strict());
  if (input instanceof Response) return input;
  return act(c, async () => c.json(await withDb((db) => createPuesto(db, input)), 201));
});
// PLA-142: a role of the owner's own that no live seat holds can be deleted.
equipoRoutes.delete("/puestos/:slug", (c) => act(c, async () => c.json(await withDb((db) => deletePuesto(db, c.req.param("slug"))))));
equipoRoutes.post("/projects/:slug/proposals/:id/decide", async (c) => {
  const input = await body(c, z.object({ accept: z.boolean() }).strict());
  if (input instanceof Response) return input;
  if (!/^[0-9a-f-]{36}$/i.test(c.req.param("id"))) return c.json({ error: "PROPOSAL_NOT_FOUND" }, 404);
  return act(c, async () => c.json(await withDb((db) => decideProposal(db, c.req.param("slug"), c.req.param("id"), input.accept))));
});

equipoRoutes.get("/projects/:slug/tienda", (c) => act(c, async () => c.json(await withDb((db) => tiendaRead(db, c.req.param("slug"))))));
