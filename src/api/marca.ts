// PLA-I66-3: the Marca door's writes, cookie only (the owner's screen), mounted before companyRoutes:
//   POST /api/company/projects/:slug/logo/upload?name=   the file as the body (or multipart): staged and checked
//   POST /api/company/projects/:slug/logo/preview        {up, scale, bg}: the fitted tile (PNG data URL) and its tests
//   POST /api/company/projects/:slug/logo                {up, name, scale, bg}: it becomes the original
//   POST /api/company/projects/:slug/logo/candidate      {path}: another logo the repo has becomes the original
//   GET  /api/company/projects/:slug/logo/versions       every version, newest first
//   GET  /api/company/projects/:slug/logo/versions/:v    one version's file
//   POST /api/company/projects/:slug/logo/versions/:v    go back to that version
//   POST /api/company/projects/:slug/logo/release        let the repo's logo lead again
//   POST /api/company/projects/:slug/logo/keep           {sha}: keep this logo over the one the repo now shows
// PLA-I66-4:
//   GET  /api/company/projects/:slug/marca/plan?mode=    what a request to Taller would change (faltan | todo)
//   GET  /api/company/projects/:slug/marca/zip?mode=     the same files as a .zip
//   POST /api/company/projects/:slug/marca/pedido        {mode}: the ticket for Taller
// Refusals carry a code and the owner's sentence (src/brand/words.ts).
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { getCookie } from "hono/cookie";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { SESSION_COOKIE, verifySession } from "../auth/session.js";
import { withDb } from "../db/client.js";
import { projects, type Project } from "../db/schema.js";
import { WEB_ACTOR } from "../mcp/tx.js";
import { activateVersion, listVersions, LogoError, MAX_UPLOAD_BYTES, previewUpload, releaseChoice, stageUpload, useCandidate, useUpload, versionBytes } from "../brand/upload.js";
import { forgetMarcaOf, marcaRead } from "../brand/marca.js";
import { setProject } from "../mcp/project.js";
import { ToolError } from "../mcp/errors.js";
import { settingsCtx } from "./project-settings.js";
import { forgetLogoLooks } from "../brand/logos.js";
import { buildSet, keepOver, madeFile, originalOf, requestIcons, zipOf } from "../brand/pedido.js";
import { cancelMarks, latestRequest, markFile, requestMarks, settle, useMark, useMarkFor } from "../brand/marks.js";
import { clearSurface, isSurface, isVariant, keepSurface, setSurface, setVariant, startSurface, surfaceOriginals, surfacesOf } from "../brand/surfaces.js";
import { activeLogo, readLogoFile } from "../brand/logos.js";
import type { Surface } from "../brand/generate.js";
import { historialOf } from "../brand/historial.js";
import { goBackVoice, requestNames, saveVoice, voiceRead, voiceVersions } from "../brand/voz.js";
import { FONTS, goBackStyle, requestStyle, saveStyle, styleRead, styleVersions } from "../brand/style.js";

export const marcaRoutes = new Hono();
const BASE = "/projects/:slug/logo";

async function guard(c: Context, next: () => Promise<void>) {
  if (/^\s*bearer\b/i.test(c.req.header("Authorization") ?? "")) return c.json({ error: "FORBIDDEN" }, 403);
  if (!verifySession(getCookie(c, SESSION_COOKIE))) return c.json({ error: "UNAUTHORIZED" }, 401);
  await next();
}
marcaRoutes.use(BASE, guard);
marcaRoutes.use(`${BASE}/*`, guard);
marcaRoutes.use("/projects/:slug/marca/plan", guard);
marcaRoutes.use("/projects/:slug/marca/zip", guard);
marcaRoutes.use("/projects/:slug/marca/pedido", guard);

function fail(c: Context, e: unknown): Response {
  if (e instanceof LogoError) return c.json({ error: e.code, message: e.message }, e.status);
  throw e;
}

async function projectOf(c: Context): Promise<Project | null> {
  const slug = c.req.param("slug")!;
  return withDb(async (db) => (await db.select().from(projects).where(eq(projects.slug, slug)).limit(1))[0] ?? null);
}

async function json<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T> | Response> {
  const parsed = schema.safeParse(await c.req.json().catch(() => undefined));
  return parsed.success ? parsed.data : c.json({ error: "INVALID_BODY" }, 400);
}

const limit = bodyLimit({ maxSize: MAX_UPLOAD_BYTES + 64 * 1024, onError: (c) => c.json({ error: "LOGO_TOO_BIG" }, 413) });

marcaRoutes.post(`${BASE}/upload`, limit, async (c) => {
  try {
    const type = c.req.header("Content-Type") ?? "";
    let bytes: Buffer;
    let name = c.req.query("name") ?? "";
    if (type.startsWith("multipart/form-data")) {
      const form = await c.req.parseBody({ all: true });
      const file = Object.values(form).flat().find((v): v is File => typeof v === "object" && v !== null && "arrayBuffer" in v);
      if (!file) return c.json({ error: "LOGO_EMPTY" }, 400);
      bytes = Buffer.from(await file.arrayBuffer());
      name ||= file.name;
    } else bytes = Buffer.from(await c.req.arrayBuffer());
    const p = await projectOf(c);
    if (!p) return c.json({ error: "PROJECT_NOT_FOUND" }, 404);
    return c.json(await stageUpload(p.slug, bytes, name));
  } catch (e) {
    return fail(c, e);
  }
});

const Adjust = z.object({ up: z.string().min(1).max(80), scale: z.number(), bg: z.string().nullable(), name: z.string().max(200).optional() }).strict();

marcaRoutes.post(`${BASE}/preview`, async (c) => {
  try {
    const body = await json(c, Adjust);
    if (body instanceof Response) return body;
    const r = await previewUpload(c.req.param("slug")!, body.up, body.scale, body.bg);
    return c.json({ png: `data:image/png;base64,${r.png.toString("base64")}`, tests: r.tests });
  } catch (e) {
    return fail(c, e);
  }
});

marcaRoutes.post(BASE, async (c) => {
  try {
    const body = await json(c, Adjust);
    if (body instanceof Response) return body;
    const p = await projectOf(c);
    if (!p) return c.json({ error: "PROJECT_NOT_FOUND" }, 404);
    await withDb((db) => useUpload(db, p, { up: body.up, name: body.name ?? body.up, scale: body.scale, bg: body.bg }, WEB_ACTOR));
    return c.json(await withDb((db) => marcaRead(db, p.slug)));
  } catch (e) {
    return fail(c, e);
  }
});

marcaRoutes.post(`${BASE}/candidate`, async (c) => {
  try {
    const body = await json(c, z.object({ path: z.string().min(1).max(500) }).strict());
    if (body instanceof Response) return body;
    const p = await projectOf(c);
    if (!p) return c.json({ error: "PROJECT_NOT_FOUND" }, 404);
    await withDb(async (db) => {
      await marcaRead(db, p.slug); // the candidates are the read's
      await useCandidate(db, p, body.path, WEB_ACTOR);
    });
    return c.json(await withDb((db) => marcaRead(db, p.slug)));
  } catch (e) {
    return fail(c, e);
  }
});

marcaRoutes.get(`${BASE}/versions`, async (c) => {
  const p = await projectOf(c);
  if (!p) return c.json({ error: "PROJECT_NOT_FOUND" }, 404);
  return c.json({ versions: await withDb((db) => listVersions(db, p.id)) });
});

marcaRoutes.get(`${BASE}/versions/:v`, async (c) => {
  const r = await withDb((db) => versionBytes(db, c.req.param("slug")!, Number(c.req.param("v"))));
  if (!r) return c.json({ error: "LOGO_VERSION_NOT_FOUND" }, 404);
  return c.body(new Uint8Array(r.bytes), 200, {
    "Content-Type": r.mime,
    "Cache-Control": "private, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox",
  });
});

marcaRoutes.post(`${BASE}/versions/:v`, async (c) => {
  try {
    const p = await projectOf(c);
    if (!p) return c.json({ error: "PROJECT_NOT_FOUND" }, 404);
    await withDb((db) => activateVersion(db, p, Number(c.req.param("v"))));
    return c.json(await withDb((db) => marcaRead(db, p.slug)));
  } catch (e) {
    return fail(c, e);
  }
});

marcaRoutes.post(`${BASE}/release`, async (c) => {
  const p = await projectOf(c);
  if (!p) return c.json({ error: "PROJECT_NOT_FOUND" }, 404);
  await withDb((db) => releaseChoice(db, p));
  forgetLogoLooks();
  return c.json(await withDb((db) => marcaRead(db, p.slug, { fresh: true })));
});

const Mode = (v: string | undefined): "faltan" | "todo" => (v === "todo" ? "todo" : "faltan");
// PLA-122: one surface's files only.
const SurfaceQ = (v: string | undefined | null): Surface | null => (v && isSurface(v) ? v : null);

marcaRoutes.post(`${BASE}/keep`, async (c) => {
  const body = await json(c, z.object({ sha: z.string().regex(/^[0-9a-f]{64}$/) }).strict());
  if (body instanceof Response) return body;
  const p = await projectOf(c);
  if (!p) return c.json({ error: "PROJECT_NOT_FOUND" }, 404);
  await withDb((db) => keepOver(db, p, body.sha));
  return c.json(await withDb((db) => marcaRead(db, p.slug)));
});

marcaRoutes.get("/projects/:slug/marca/plan", async (c) => {
  const p = await projectOf(c);
  if (!p) return c.json({ error: "PROJECT_NOT_FOUND" }, 404);
  const set = await withDb((db) => buildSet(db, p, Mode(c.req.query("mode")), SurfaceQ(c.req.query("surface"))));
  if (!set) return c.json({ error: "LOGO_NONE" }, 409);
  return c.json({ plan: set.plan, set: set.id, dir: set.dir });
});

marcaRoutes.get("/projects/:slug/marca/zip", async (c) => {
  const p = await projectOf(c);
  if (!p) return c.json({ error: "PROJECT_NOT_FOUND" }, 404);
  const mode = Mode(c.req.query("mode"));
  const z = await withDb((db) => zipOf(db, p, mode, SurfaceQ(c.req.query("surface"))));
  if (!z) return c.json({ error: "LOGO_NONE" }, 409);
  return c.body(new Uint8Array(z), 200, {
    "Content-Type": "application/zip",
    "Content-Disposition": `attachment; filename="${p.slug}-iconos.zip"`,
    "Cache-Control": "no-store",
  });
});

marcaRoutes.post("/projects/:slug/marca/pedido", async (c) => {
  try {
    const body = await json(c, z.object({ mode: z.enum(["faltan", "todo"]), surface: z.enum(["iphone", "android", "navegador"]).nullable().optional() }).strict());
    if (body instanceof Response) return body;
    const p = await projectOf(c);
    if (!p) return c.json({ error: "PROJECT_NOT_FOUND" }, 404);
    const r = await withDb((db) => requestIcons(db, p, body.mode, body.surface ?? null));
    return c.json({ key: r.key, read: await withDb((db) => marcaRead(db, p.slug)) });
  } catch (e) {
    return fail(c, e);
  }
});

// PLA-122: one surface's own icon.
//   POST /api/company/projects/:slug/logo/surface/:s/start   the current original (or its own picture) staged
//   POST /api/company/projects/:slug/logo/surface/:s         {up, scale, bg, name?}: the surface keeps it
//   POST /api/company/projects/:slug/logo/surface/:s/reset   back to the original
//   GET  /api/company/projects/:slug/logo/surface/:s         its tile, for the card
marcaRoutes.post(`${BASE}/surface/:s/start`, async (c) => {
  try {
    const s = c.req.param("s")!;
    if (!isSurface(s)) return c.json({ error: "LOGO_SURFACE_UNKNOWN" }, 404);
    const p = await projectOf(c);
    if (!p) return c.json({ error: "PROJECT_NOT_FOUND" }, 404);
    const staged = await withDb((db) => startSurface(db, p, s));
    return staged ? c.json(staged) : c.json({ error: "LOGO_NONE" }, 409);
  } catch (e) {
    return fail(c, e);
  }
});

marcaRoutes.post(`${BASE}/surface/:s/reset`, async (c) => {
  const s = c.req.param("s")!;
  if (!isSurface(s)) return c.json({ error: "LOGO_SURFACE_UNKNOWN" }, 404);
  const p = await projectOf(c);
  if (!p) return c.json({ error: "PROJECT_NOT_FOUND" }, 404);
  clearSurface(p, s);
  return c.json(await withDb((db) => marcaRead(db, p.slug)));
});

marcaRoutes.post(`${BASE}/surface/:s`, async (c) => {
  try {
    const s = c.req.param("s")!;
    if (!isSurface(s)) return c.json({ error: "LOGO_SURFACE_UNKNOWN" }, 404);
    const body = await json(c, Adjust);
    if (body instanceof Response) return body;
    const p = await projectOf(c);
    if (!p) return c.json({ error: "PROJECT_NOT_FOUND" }, 404);
    // PLA-I69-2: the picture remembers the logo version it was made under (a newer logo asks).
    const logoV = (await withDb((db) => activeLogo(db, p.id)))?.version ?? null;
    await setSurface(p, s, { up: body.up, name: body.name ?? body.up, scale: body.scale, bg: body.bg }, logoV);
    return c.json(await withDb((db) => marcaRead(db, p.slug)));
  } catch (e) {
    return fail(c, e);
  }
});

// PLA-I69-2: a variant (a recipe on the current logo) and «Mantener la mía» after the logo changed.
//   POST /api/company/projects/:slug/logo/surface/:s/variant   {bg, scale}
//   POST /api/company/projects/:slug/logo/surface/:s/keep
marcaRoutes.post(`${BASE}/surface/:s/variant`, async (c) => {
  try {
    const s = c.req.param("s")!;
    if (!isSurface(s)) return c.json({ error: "LOGO_SURFACE_UNKNOWN" }, 404);
    const body = await json(c, z.object({ bg: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable(), scale: z.number().int().min(40).max(100) }).strict());
    if (body instanceof Response) return body;
    const p = await projectOf(c);
    if (!p) return c.json({ error: "PROJECT_NOT_FOUND" }, 404);
    setVariant(p, s, body);
    return c.json(await withDb((db) => marcaRead(db, p.slug)));
  } catch (e) {
    return fail(c, e);
  }
});
marcaRoutes.post(`${BASE}/surface/:s/keep`, async (c) => {
  const s = c.req.param("s")!;
  if (!isSurface(s)) return c.json({ error: "LOGO_SURFACE_UNKNOWN" }, 404);
  const p = await projectOf(c);
  if (!p) return c.json({ error: "PROJECT_NOT_FOUND" }, 404);
  const l = await withDb((db) => activeLogo(db, p.id));
  if (!l || !keepSurface(p, s, l.version)) return c.json({ error: "LOGO_SURFACE_NONE" }, 404);
  return c.json(await withDb((db) => marcaRead(db, p.slug)));
});

// PLA-I69-2: one file as Plania would make it now, for the scene's upper half.
//   GET /api/company/projects/:slug/marca/made/:key
const MADE_KEYS = ["ico", "svg", "apple", "a192", "a512", "mask", "mono", "og"] as const;
marcaRoutes.get("/projects/:slug/marca/made/:key", async (c) => {
  const key = c.req.param("key")!;
  if (!(MADE_KEYS as readonly string[]).includes(key)) return c.json({ error: "LOGO_SURFACE_UNKNOWN" }, 404);
  const p = await projectOf(c);
  if (!p) return c.json({ error: "PROJECT_NOT_FOUND" }, 404);
  const f = await withDb((db) => madeFile(db, p, key as (typeof MADE_KEYS)[number]));
  if (!f) return c.json({ error: "LOGO_NONE" }, 404);
  return c.body(new Uint8Array(f.bytes), 200, { "Content-Type": f.mime, "Cache-Control": "private, max-age=60", "X-Content-Type-Options": "nosniff" });
});

marcaRoutes.get(`${BASE}/surface/:s`, async (c) => {
  const s = c.req.param("s")!;
  const slug = c.req.param("slug")!;
  const entry = isSurface(s) ? surfacesOf(slug)[s] : undefined;
  if (isSurface(s) && isVariant(entry)) {
    const p = await projectOf(c);
    const l = p ? await withDb((db) => activeLogo(db, p.id)) : null;
    const o = p && l ? originalOf(p.slug, l) : null;
    const t = o ? (await surfaceOriginals(slug, { bytes: o.bytes, mime: o.mime, raw: l?.adjust?.raw ?? null }))[s] : undefined;
    if (!t) return c.json({ error: "LOGO_SURFACE_NONE" }, 404);
    return c.body(new Uint8Array(t.bytes), 200, { "Content-Type": "image/png", "Cache-Control": "private, max-age=60", "X-Content-Type-Options": "nosniff" });
  }
  const own = entry && !isVariant(entry) ? entry : undefined;
  const b = own ? readLogoFile(slug, own.file) : null;
  if (!b) return c.json({ error: "LOGO_SURFACE_NONE" }, 404);
  return c.body(new Uint8Array(b), 200, { "Content-Type": "image/png", "Cache-Control": "private, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" });
});

// PLA-I66-5: logo marks from Artist.
//   GET  /api/company/projects/:slug/logo/marks               the newest request (drawing, ready or failed)
//   POST /api/company/projects/:slug/logo/marks               {about, feel, avoid, colors, images, like?}: queue Artist
//   GET  /api/company/projects/:slug/logo/marks/:id/:file     a mark's SVG or its rendered tile
//   POST /api/company/projects/:slug/logo/marks/:id/:mark     that mark becomes the original
marcaRoutes.get(`${BASE}/marks`, async (c) => {
  const p = await projectOf(c);
  if (!p) return c.json({ error: "PROJECT_NOT_FOUND" }, 404);
  return c.json({ request: await withDb((db) => settle(db, latestRequest(p.slug))) });
});

const Hints = z
  .object({
    about: z.string().max(600).optional(),
    feel: z.array(z.string().max(40)).max(6).optional(),
    avoid: z.array(z.string().max(40)).max(6).optional(),
    colors: z.array(z.string().regex(/^#[0-9a-fA-F]{6}$/)).max(6).optional(),
    images: z.array(z.string().max(80)).max(6).optional(),
    like: z.string().max(40).nullable().optional(),
    change: z.string().max(200).nullable().optional(),
    surface: z.enum(["iphone", "android", "navegador"]).nullable().optional(),
  })
  .strict();

marcaRoutes.post(`${BASE}/marks`, async (c) => {
  const body = await json(c, Hints);
  if (body instanceof Response) return body;
  const p = await projectOf(c);
  if (!p) return c.json({ error: "PROJECT_NOT_FOUND" }, 404);
  return c.json({ request: await withDb((db) => requestMarks(db, p, body)) });
});

marcaRoutes.get(`${BASE}/marks/:id/:file`, async (c) => {
  const b = markFile(c.req.param("slug")!, c.req.param("id")!, c.req.param("file")!);
  if (!b) return c.json({ error: "LOGO_MARK_NOT_FOUND" }, 404);
  return c.body(new Uint8Array(b), 200, {
    "Content-Type": c.req.param("file")!.endsWith(".png") ? "image/png" : "image/svg+xml",
    "Cache-Control": "private, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox",
  });
});

// PLA-130: stop a request that is still drawing. Before /marks/:id/:mark, which would take «cancel» as a mark.
marcaRoutes.post(`${BASE}/marks/:id/cancel`, async (c) => {
  const p = await projectOf(c);
  if (!p) return c.json({ error: "PROJECT_NOT_FOUND" }, 404);
  const r = cancelMarks(p.slug, c.req.param("id")!);
  return r ? c.json({ request: r }) : c.json({ error: "LOGO_MARK_NOT_FOUND" }, 404);
});

marcaRoutes.post(`${BASE}/marks/:id/:mark`, async (c) => {
  try {
    const p = await projectOf(c);
    if (!p) return c.json({ error: "PROJECT_NOT_FOUND" }, 404);
    // PLA-I69-3: ?surface=… makes the mark that surface's own picture instead of the original.
    const s = c.req.query("surface");
    if (s) {
      if (!isSurface(s)) return c.json({ error: "LOGO_SURFACE_UNKNOWN" }, 404);
      await withDb((db) => useMarkFor(db, p, c.req.param("id")!, c.req.param("mark")!, s));
    } else await withDb((db) => useMark(db, p, c.req.param("id")!, c.req.param("mark")!, WEB_ACTOR));
    return c.json(await withDb((db) => marcaRead(db, p.slug)));
  } catch (e) {
    return fail(c, e);
  }
});

// PLA-I69-3: «Más caras»: a switch per extra surface (settings.marca.extras), sent whole with the native switch.
marcaRoutes.use("/projects/:slug/marca/extras", guard);
marcaRoutes.post("/projects/:slug/marca/extras", async (c) => {
  try {
    const body = await json(c, z.object({ key: z.enum(["avisos", "atajos", "capturas", "prueba"]), on: z.boolean() }).strict());
    if (body instanceof Response) return body;
    const p = await projectOf(c);
    if (!p) return c.json({ error: "PROJECT_NOT_FOUND" }, 404);
    const marca = { native: !!p.settings?.marca?.native, extras: { ...(p.settings?.marca?.extras ?? {}), [body.key]: body.on } };
    await withDb((db) => setProject(db, { project: p.slug, version: p.version, settings: { marca } }, settingsCtx));
    forgetMarcaOf(p.id);
    return c.json(await withDb((db) => marcaRead(db, p.slug)));
  } catch (e) {
    if (e instanceof ToolError) return c.json({ error: e.code, ...e.detail }, e.status);
    return fail(c, e);
  }
});

// PLA-I66-6: the switch that adds the native app icons and the iPhone launch screens (settings.marca.native).
marcaRoutes.use("/projects/:slug/marca/native", guard);
marcaRoutes.post("/projects/:slug/marca/native", async (c) => {
  try {
    const body = await json(c, z.object({ on: z.boolean() }).strict());
    if (body instanceof Response) return body;
    const p = await projectOf(c);
    if (!p) return c.json({ error: "PROJECT_NOT_FOUND" }, 404);
    await withDb((db) => setProject(db, { project: p.slug, version: p.version, settings: { marca: { native: body.on, extras: p.settings?.marca?.extras ?? {} } } }, settingsCtx));
    forgetMarcaOf(p.id);
    return c.json(await withDb((db) => marcaRead(db, p.slug)));
  } catch (e) {
    if (e instanceof ToolError) return c.json({ error: e.code, ...e.detail }, e.status);
    return fail(c, e);
  }
});

// PLA-I69-4: Estilo. The style is Plania's (versions kept); the request brings it to the repo through Taller.
const STYLE = "/projects/:slug/marca/estilo";
marcaRoutes.use(STYLE, guard);
marcaRoutes.use(`${STYLE}/*`, guard);
marcaRoutes.get(STYLE, async (c) => {
  try {
    const r = await withDb((db) => styleRead(db, c.req.param("slug")!, { fresh: c.req.query("fresh") === "1" }));
    return r ? c.json({ ...r, versionsList: styleVersions(c.req.param("slug")!), fonts: FONTS }) : c.json({ error: "PROJECT_NOT_FOUND" }, 404);
  } catch (e) {
    return fail(c, e);
  }
});
marcaRoutes.post(STYLE, async (c) => {
  try {
    const body = await json(c, z.record(z.string().max(20), z.union([z.string().max(60), z.number(), z.boolean()])).refine((o) => Object.keys(o).length <= 40));
    if (body instanceof Response) return body;
    const slug = c.req.param("slug")!;
    const r = await withDb((db) => saveStyle(db, slug, body as never));
    return r ? c.json({ ...r, versionsList: styleVersions(slug), fonts: FONTS }) : c.json({ error: "PROJECT_NOT_FOUND" }, 404);
  } catch (e) {
    return fail(c, e);
  }
});
marcaRoutes.post(`${STYLE}/back`, async (c) => {
  try {
    const body = await json(c, z.object({ v: z.number().int().min(1) }).strict());
    if (body instanceof Response) return body;
    const slug = c.req.param("slug")!;
    const r = await withDb((db) => goBackStyle(db, slug, body.v));
    return r ? c.json({ ...r, versionsList: styleVersions(slug), fonts: FONTS }) : c.json({ error: "PROJECT_NOT_FOUND" }, 404);
  } catch (e) {
    return fail(c, e);
  }
});
marcaRoutes.post(`${STYLE}/pedido`, async (c) => {
  try {
    const p = await projectOf(c);
    if (!p) return c.json({ error: "PROJECT_NOT_FOUND" }, 404);
    const made = await withDb((db) => requestStyle(db, p));
    const r = await withDb((db) => styleRead(db, p.slug));
    return c.json({ key: made.key, ...r, versionsList: styleVersions(p.slug), fonts: FONTS });
  } catch (e) {
    return fail(c, e);
  }
});

// PLA-I69-5: Voz y nombre. The voice rides in the project's runs; the name and texts go to the repo through Taller.
const VOZ = "/projects/:slug/marca/voz";
marcaRoutes.use(VOZ, guard);
marcaRoutes.use(`${VOZ}/*`, guard);
const voiceOut = async (slug: string, r: Awaited<ReturnType<typeof voiceRead>>) => (r ? { ...r, versionsList: voiceVersions(slug) } : null);
marcaRoutes.get(VOZ, async (c) => {
  try {
    const slug = c.req.param("slug")!;
    const r = await voiceOut(slug, await withDb((db) => voiceRead(db, slug, { fresh: c.req.query("fresh") === "1" })));
    return r ? c.json(r) : c.json({ error: "PROJECT_NOT_FOUND" }, 404);
  } catch (e) {
    return fail(c, e);
  }
});
const VoiceBody = z
  .object({
    cerca: z.number(), humor: z.number(), breve: z.number(), sencillo: z.number(), trato: z.enum(["tu", "usted", "vos"]),
    yes: z.array(z.string().max(60)).max(30), no: z.array(z.string().max(60)).max(30), guide: z.string().max(3000).nullable(),
    name: z.string().max(200), short: z.string().max(100), desc: z.string().max(600), tag: z.string().max(200),
  })
  .partial()
  .strict();
marcaRoutes.post(VOZ, async (c) => {
  try {
    const body = await json(c, VoiceBody);
    if (body instanceof Response) return body;
    const slug = c.req.param("slug")!;
    const r = await voiceOut(slug, await withDb((db) => saveVoice(db, slug, body)));
    return r ? c.json(r) : c.json({ error: "PROJECT_NOT_FOUND" }, 404);
  } catch (e) {
    return fail(c, e);
  }
});
marcaRoutes.post(`${VOZ}/back`, async (c) => {
  try {
    const body = await json(c, z.object({ v: z.number().int().min(1) }).strict());
    if (body instanceof Response) return body;
    const slug = c.req.param("slug")!;
    const r = await voiceOut(slug, await withDb((db) => goBackVoice(db, slug, body.v)));
    return r ? c.json(r) : c.json({ error: "PROJECT_NOT_FOUND" }, 404);
  } catch (e) {
    return fail(c, e);
  }
});
marcaRoutes.post(`${VOZ}/pedido`, async (c) => {
  try {
    const p = await projectOf(c);
    if (!p) return c.json({ error: "PROJECT_NOT_FOUND" }, 404);
    const made = await withDb((db) => requestNames(db, p));
    return c.json({ key: made.key, ...(await voiceOut(p.slug, await withDb((db) => voiceRead(db, p.slug)))) });
  } catch (e) {
    return fail(c, e);
  }
});

// PLA-I69-6: Marca → Historial.
marcaRoutes.use("/projects/:slug/marca/historial", guard);
marcaRoutes.get("/projects/:slug/marca/historial", async (c) => {
  const h = await withDb((db) => historialOf(db, c.req.param("slug")!));
  return h ? c.json(h) : c.json({ error: "PROJECT_NOT_FOUND" }, 404);
});
