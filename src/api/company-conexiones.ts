// PLA-I75 (Conexiones): a seat's tools beyond Plania, from its sheet (src/runner/conexiones-store.ts). Mounted on
// companyRoutes, so only the owner's session cookie reaches them (a Bearer is 403). Every write answers with the fresh
// read. No route takes or returns a key's value: keys are names.
//   GET    /api/company/projects/:slug/team/:agent/conexiones                         the sheet's read
//   PUT    /api/company/projects/:slug/team/:agent/conexiones/:server                 {keys?} connect a catalog entry (reads only)
//   PUT    /api/company/projects/:slug/team/:agent/conexiones/:server/writes/:tool    {on} one write tool on or off
//   POST   /api/company/projects/:slug/team/:agent/conexiones/:server/version         accept the catalog's new version
//   POST   /api/company/projects/:slug/team/:agent/conexiones/:server/review          accept a custom server (expert mode)
//   DELETE /api/company/projects/:slug/team/:agent/conexiones/:server                 disconnect
//   POST   /api/company/projects/:slug/team/:agent/conexiones-propias                 {server, package, version, args?} expert mode
//   POST   /api/company/projects/:slug/team/:agent/conexiones-pedidos/:id             {accept} answer an agent's request
// Errors: 400 CONNECTION_INVALID {field}, 403 CONNECTION_TOOL_NEVER, 404 PROJECT_NOT_FOUND | AGENT_NOT_FOUND |
// CONNECTION_UNKNOWN | CONNECTION_NOT_FOUND | CONNECTION_REQUEST_NOT_FOUND, 409 CONNECTION_EXISTS |
// CONNECTION_NEEDS_LOGIN | CONNECTION_REQUEST_DECIDED.
import { Hono, type Context } from "hono";
import { z } from "zod";
import { withDb } from "../db/client.js";
import { ToolError } from "../mcp/errors.js";
import { acceptVersion, addCustom, conexionesRead, connect, decideRequest, disconnect, reviewCustom, setWrite } from "../runner/conexiones-store.js";

export const conexionesRoutes = new Hono();

const BASE = "/projects/:slug/team/:agent";
const ONE = `${BASE}/conexiones/:server`;

async function body<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T> | Response> {
  if (!c.req.header("Content-Type")?.startsWith("application/json")) return c.json({ error: "JSON_REQUIRED" }, 415);
  const parsed = schema.safeParse(await c.req.json().catch(() => undefined));
  if (!parsed.success) return c.json({ error: "INVALID_BODY" }, 400);
  return parsed.data;
}

const read = (c: Context) => withDb((db) => conexionesRead(db, c.req.param("slug")!, c.req.param("agent")!)).then((out) => c.json(out));
const act = async (c: Context, change: (slug: string, agent: string) => Promise<unknown>) => {
  try {
    await change(c.req.param("slug")!, c.req.param("agent")!);
    return await read(c);
  } catch (e) {
    if (e instanceof ToolError) return c.json({ error: e.code, ...e.detail }, e.status);
    throw e;
  }
};

const Connect = z.object({ keys: z.record(z.string().max(80), z.string().max(80)).optional() }).strict();
const Write = z.object({ on: z.boolean() }).strict();
const Custom = z.object({ server: z.string().max(40), package: z.string().max(120), version: z.string().max(40), args: z.array(z.string().max(120)).max(12).optional() }).strict();
const Decide = z.object({ accept: z.boolean() }).strict();

conexionesRoutes.get(`${BASE}/conexiones`, (c) => act(c, async () => undefined));

conexionesRoutes.put(ONE, async (c) => {
  const input = await body(c, Connect);
  if (input instanceof Response) return input;
  return act(c, (slug, agent) => withDb((db) => connect(db, slug, agent, c.req.param("server")!, input.keys)));
});

conexionesRoutes.put(`${ONE}/writes/:tool`, async (c) => {
  const input = await body(c, Write);
  if (input instanceof Response) return input;
  return act(c, (slug, agent) => withDb((db) => setWrite(db, slug, agent, c.req.param("server")!, c.req.param("tool")!, input.on)));
});

conexionesRoutes.post(`${ONE}/version`, (c) => act(c, (slug, agent) => withDb((db) => acceptVersion(db, slug, agent, c.req.param("server")!))));
conexionesRoutes.post(`${ONE}/review`, (c) => act(c, (slug, agent) => withDb((db) => reviewCustom(db, slug, agent, c.req.param("server")!))));
conexionesRoutes.delete(ONE, (c) => act(c, (slug, agent) => withDb((db) => disconnect(db, slug, agent, c.req.param("server")!))));

conexionesRoutes.post(`${BASE}/conexiones-propias`, async (c) => {
  const input = await body(c, Custom);
  if (input instanceof Response) return input;
  return act(c, (slug, agent) => withDb((db) => addCustom(db, slug, agent, input.server, { package: input.package, version: input.version, args: input.args ?? [] })));
});

conexionesRoutes.post(`${BASE}/conexiones-pedidos/:id`, async (c) => {
  const input = await body(c, Decide);
  if (input instanceof Response) return input;
  return act(c, (slug, agent) => withDb((db) => decideRequest(db, slug, agent, c.req.param("id")!, input.accept)));
});
