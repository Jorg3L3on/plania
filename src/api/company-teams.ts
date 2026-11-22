// PLA-I71-6: the team catalog and the whole company in a file (src/runner/teams.ts, src/runner/company-package.ts).
// Mounted on companyRoutes: only the owner's session reaches them (a Bearer is 403).
//   GET  /api/company/teams                                    the catalog: factory (kit/teams), saved and brought teams
//   POST /api/company/projects/:slug/teams/save                {name, line?, lessons?, references?} → 201 the team
//   GET  /api/company/projects/:slug/teams/:team/adopt?mode=   the plan, computed without writing (keep | also)
//   POST /api/company/projects/:slug/teams/:team/adopt         {mode} → the plan applied (new seats arrive paused)
//   POST /api/company/teams/import                             {source: {files} | {tar} | {url}} → 201 {slug, ignored}
//   GET  /api/company/export?lessons=&references=              {files: [{path, content}]} (what the file holds)
//   GET  /api/company/export.tar?lessons=&references=          the same files as one plain tar
//   POST /api/company/import/preview                           {source} → create / rename / skip per item; no writes
//   POST /api/company/import                                   {source, choices?: {key: create|rename|skip}}
// source: {files: [{path, content}]}, {tar: base64 of a plain tar}, or {url: a public GitHub folder in the open layout}.
import { Hono, type Context } from "hono";
import { z } from "zod";
import { withDb } from "../db/client.js";
import { ToolError } from "../mcp/errors.js";
import { adopt, adoptPreview, bringTeam, deleteTeam, saveTeam, teamCatalog } from "../runner/teams.js";
import { applyCompany, exportCompany, previewCompany, tarOf, teamSpecOf, untar, type PackageFile } from "../runner/company-package.js";
import { repoFiles } from "../runner/skill-catalog.js";
import type { ImportDeps } from "../runner/skill-import.js";

export const teamRoutes = new Hono();
let deps: ImportDeps = {};
export const setTeamDepsForTests = (d: ImportDeps) => {
  deps = d;
};

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
const File = z.object({ path: z.string().min(1).max(300), content: z.string().max(400_000) });
const Source = z.union([z.object({ files: z.array(File).max(2000) }).strict(), z.object({ tar: z.string().max(12_000_000) }).strict(), z.object({ url: z.string().url().max(500) }).strict()]);
type SourceIn = z.infer<typeof Source>;
async function filesOf(s: SourceIn): Promise<{ files: PackageFile[]; source: string | null; commit: string | null }> {
  if ("files" in s) return { files: s.files, source: null, commit: null };
  if ("tar" in s) return { files: untar(Buffer.from(s.tar, "base64")), source: null, commit: null };
  const r = await repoFiles(s.url, deps);
  return { files: r.files, source: r.source, commit: r.commit };
}
const flags = (c: Context) => ({ lessons: c.req.query("lessons") === "1", references: c.req.query("references") === "1" });

teamRoutes.get("/teams", (c) => act(c, async () => c.json({ teams: await withDb((db) => teamCatalog(db)) })));
// PLA-142: a team the owner saved or brought can be deleted; factory teams cannot.
teamRoutes.delete("/teams/:team", (c) => act(c, async () => c.json(await withDb((db) => deleteTeam(db, c.req.param("team"))))));
teamRoutes.post("/projects/:slug/teams/save", async (c) => {
  const input = await body(c, z.object({ name: z.string().min(1).max(80), line: z.string().max(300).optional(), lessons: z.boolean().optional(), references: z.boolean().optional() }).strict());
  if (input instanceof Response) return input;
  return act(c, async () => c.json(await withDb((db) => saveTeam(db, c.req.param("slug"), input)), 201));
});
teamRoutes.get("/projects/:slug/teams/:team/adopt", (c) => act(c, async () => c.json(await withDb((db) => adoptPreview(db, c.req.param("slug"), c.req.param("team"), c.req.query("mode") === "also" ? "also" : "keep")))));
teamRoutes.post("/projects/:slug/teams/:team/adopt", async (c) => {
  const input = await body(c, z.object({ mode: z.enum(["keep", "also"]).optional() }).strict());
  if (input instanceof Response) return input;
  return act(c, async () => c.json(await withDb((db) => adopt(db, c.req.param("slug"), c.req.param("team"), input.mode ?? "keep"))));
});
teamRoutes.post("/teams/import", async (c) => {
  const input = await body(c, z.object({ source: Source }).strict());
  if (input instanceof Response) return input;
  return act(c, async () => {
    const got = await filesOf(input.source);
    const t = teamSpecOf(got.files);
    if (!t.spec.seats.length) throw new ToolError("SKILL_IMPORT_FORMAT", { reason: "no_agents" });
    const slug = await withDb((db) => bringTeam(db, { name: t.name, spec: t.spec, source: got.source, commit: got.commit }));
    return c.json({ slug, ignored: t.ignored }, 201);
  });
});
teamRoutes.get("/export", (c) => act(c, async () => c.json({ files: await withDb((db) => exportCompany(db, flags(c))) })));
teamRoutes.get("/export.tar", (c) =>
  act(c, async () => {
    const tar = tarOf(await withDb((db) => exportCompany(db, flags(c))));
    return new Response(new Uint8Array(tar), { headers: { "Content-Type": "application/x-tar", "Content-Disposition": 'attachment; filename="compania.tar"', "Cache-Control": "no-store" } });
  }),
);
teamRoutes.post("/import/preview", async (c) => {
  const input = await body(c, z.object({ source: Source }).strict());
  if (input instanceof Response) return input;
  return act(c, async () => c.json(await withDb(async (db) => previewCompany(db, (await filesOf(input.source)).files))));
});
teamRoutes.post("/import", async (c) => {
  const input = await body(c, z.object({ source: Source, choices: z.record(z.string(), z.enum(["create", "rename", "skip"])).optional() }).strict());
  if (input instanceof Response) return input;
  return act(c, async () => c.json(await withDb(async (db) => applyCompany(db, (await filesOf(input.source)).files, input.choices ?? {}))));
});
