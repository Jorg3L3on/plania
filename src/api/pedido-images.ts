// PLA-I54-2: pictures on a request (src/pedidos/images.ts). The owner's session cookie only, like the other company
// routes: a Bearer (any agent token) is 403 even with a cookie, no cookie is 401. No MCP tool writes these.
//   POST   /api/company/projects/:slug/tasks/:key/images      one picture: the raw bytes (Content-Type image/*) or
//          multipart with one file field. PNG, JPEG or WebP by its first bytes; 5 MB; 6 per request.
//          → 201 {image} (200 when the same picture was already there); 400/404/409/413/415 {error, message}
//   GET    /api/company/projects/:slug/tasks/:key/images      → {images: [{id, url, mime, bytes, width, height, created_at}]}
//   GET    /api/company/projects/:slug/tasks/:key/images/:id  the bytes, private cache
//   DELETE /api/company/projects/:slug/tasks/:key/images/:id  → {deleted: true}
// Mounted at /api/company before the company routes (src/api/routes.ts).
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { getCookie } from "hono/cookie";
import { SESSION_COOKIE, verifySession } from "../auth/session.js";
import { withDb } from "../db/client.js";
import { WEB_ACTOR } from "../mcp/tx.js";
import { ImageError, MAX_IMAGE_BYTES, addTaskImage, deleteTaskImage, imageErrors, listTaskImages, taskImageBytes } from "../pedidos/images.js";
import { defineWords, say } from "../words.js";

// PLA-I2-10: the route's refusals in the install's language; the Spanish is unchanged.
export const PEDIDO_IMAGE_WORDS = defineWords({
  es: {
    screenOnly: "Las imágenes de un pedido solo se tocan desde la pantalla.",
    signIn: "Inicia sesión otra vez.",
    oneAtATime: "Sube una imagen a la vez.",
  },
  en: {
    screenOnly: "A request's pictures are only touched from the screen.",
    signIn: "Sign in again.",
    oneAtATime: "Upload one picture at a time.",
  },
});

export const pedidoImageRoutes = new Hono();

const BASE = "/projects/:slug/tasks/:key/images";

pedidoImageRoutes.use(`${BASE}`, guard);
pedidoImageRoutes.use(`${BASE}/*`, guard);

async function guard(c: Context, next: () => Promise<void>) {
  if (/^\s*bearer\b/i.test(c.req.header("Authorization") ?? "")) {
    return c.json({ error: "FORBIDDEN", message: say(PEDIDO_IMAGE_WORDS).screenOnly }, 403);
  }
  if (!verifySession(getCookie(c, SESSION_COOKIE))) return c.json({ error: "UNAUTHORIZED", message: say(PEDIDO_IMAGE_WORDS).signIn }, 401);
  await next();
}

function fail(c: Context, e: unknown): Response {
  if (e instanceof ImageError) return c.json({ error: e.code, message: e.message }, e.status);
  throw e;
}

const params = (c: Context) => ({ slug: c.req.param("slug")!, key: c.req.param("key")! });

// The body is read once; 5 MB of picture plus room for a multipart envelope.
const limit = bodyLimit({
  maxSize: MAX_IMAGE_BYTES + 64 * 1024,
  onError: (c) => {
    const e = imageErrors.big();
    return c.json({ error: e.code, message: e.message }, e.status);
  },
});

async function picture(c: Context): Promise<Buffer> {
  const type = c.req.header("Content-Type") ?? "";
  if (type.startsWith("multipart/form-data")) {
    const form = await c.req.parseBody({ all: true });
    const files = Object.values(form)
      .flat()
      .filter((v): v is File => typeof v === "object" && v !== null && "arrayBuffer" in v);
    if (files.length === 0) throw imageErrors.empty();
    if (files.length > 1) throw new ImageError("UNA_IMAGEN", 400, say(PEDIDO_IMAGE_WORDS).oneAtATime);
    return Buffer.from(await files[0]!.arrayBuffer());
  }
  return Buffer.from(await c.req.arrayBuffer());
}

pedidoImageRoutes.post(BASE, limit, async (c) => {
  try {
    const bytes = await picture(c);
    const { slug, key } = params(c);
    const r = await withDb((db) => addTaskImage(db, { slug, key, bytes, actor: WEB_ACTOR }));
    return c.json({ image: r.image }, r.created ? 201 : 200);
  } catch (e) {
    return fail(c, e);
  }
});

pedidoImageRoutes.get(BASE, async (c) => {
  try {
    const { slug, key } = params(c);
    return c.json({ images: await withDb((db) => listTaskImages(db, slug, key)) });
  } catch (e) {
    return fail(c, e);
  }
});

pedidoImageRoutes.get(`${BASE}/:id`, async (c) => {
  try {
    const { slug, key } = params(c);
    const r = await withDb((db) => taskImageBytes(db, slug, key, c.req.param("id")));
    // An id names one file and never changes; private: it sits behind the session.
    return c.body(new Uint8Array(r.bytes), 200, {
      "Content-Type": r.mime,
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    });
  } catch (e) {
    return fail(c, e);
  }
});

pedidoImageRoutes.delete(`${BASE}/:id`, async (c) => {
  try {
    const { slug, key } = params(c);
    await withDb((db) => deleteTaskImage(db, slug, key, c.req.param("id")));
    return c.json({ deleted: true });
  } catch (e) {
    return fail(c, e);
  }
});
