// PLA-I46-6: the stills of a project's running app, for the floor's Ventana and the QA evidence card.
// Mounted under /api/projects after the session check, so the screen cookie opens it and nothing else does.
//   GET /api/projects/:slug/captures[?task=<KEY>]  latest still per page and viewport (src/captures/store.ts)
//   GET /api/projects/:slug/captures/:id.png       one still's PNG
// PLA-I46-7/8: the read also says whether the test copy is on (prueba), and three clicks act on it, only from the
// screen (src/captures/prueba.ts):
//   POST /api/projects/:slug/captures/encender     Encenderla: start the test copy (sandbox) on this machine
//   POST /api/projects/:slug/captures/tomar        Reintentar: take the stills again
//   POST /api/projects/:slug/captures/apagar       turn Plania's test copy off
// PLA-I52-2: the delivery's own copy (its PR branch, next to sandbox's), for El Probador:
//   GET  /api/projects/:slug/entrega               the copy's read (null when off)
//   POST /api/projects/:slug/entrega/encender      {key}: start the copy of that delivery (its ticket's branch)
//   POST /api/projects/:slug/entrega/apagar        turn it off
// PLA-I74-6: «Revisar proyecto» (src/captures/revision.ts):
//   GET  /api/projects/:slug/revision              the last check-up, the one running, the measured waits
//   POST /api/projects/:slug/revision              start one (202), or say one is already running
import { Hono, type Context } from "hono";
import { withDb } from "../db/client.js";
import { ToolError } from "../mcp/errors.js";
import { apagar, apagarEntrega, encender, entregaRead, pruebaRead, tomar } from "../captures/prueba.js";
import { warmEntrega } from "../captures/entrega.js";
import { assertKey, probadorRead, probar } from "../captures/probador.js";
import { startVivo, vivoRead } from "../captures/vivo.js";
import { preguntar } from "../captures/preguntas.js";
import { imagenBytes, imagenesRead } from "../captures/imagenes.js";
import { latestStills, stillFile } from "../captures/store.js";
import { revisionRead, startRevision } from "../captures/revision.js";
import { projects } from "../db/schema.js";
import { eq } from "drizzle-orm";

export const captureRoutes = new Hono();

captureRoutes.get("/:slug/captures", async (c) => {
  const task = c.req.query("task") || undefined;
  const slug = c.req.param("slug");
  const out = await withDb(async (db) => {
    const read = await latestStills(db, slug, { taskKey: task });
    if (!read) return null;
    const [p] = await db.select({ settings: projects.settings }).from(projects).where(eq(projects.slug, slug));
    return { ...read, prueba: await pruebaRead(slug, p?.settings.capture) };
  });
  if (!out) return c.json({ error: task ? "TASK_NOT_FOUND" : "PROJECT_NOT_FOUND" }, 404);
  return c.json(out);
});

const acts = { encender, tomar, apagar } as const;
for (const name of Object.keys(acts) as (keyof typeof acts)[]) {
  captureRoutes.post(`/:slug/captures/${name}`, async (c) => {
    try {
      return c.json({ prueba: await withDb((db) => acts[name](db, c.req.param("slug"))) });
    } catch (e) {
      if (e instanceof ToolError) return c.json({ error: e.code, ...e.detail }, e.code === "PROJECT_NOT_FOUND" ? 404 : 400);
      throw e;
    }
  });
}

const fail = (c: Context, e: unknown) => {
  if (e instanceof ToolError) return c.json({ error: e.code, ...e.detail }, e.code === "PROJECT_NOT_FOUND" ? 404 : 400);
  throw e;
};

// PLA-I74-6: «Revisar proyecto». The last check-up (and the one running), and the button that starts one.
captureRoutes.get("/:slug/revision", async (c) => {
  try {
    return c.json({ revision: await withDb((db) => revisionRead(db, c.req.param("slug"))) });
  } catch (e) {
    return fail(c, e);
  }
});
captureRoutes.post("/:slug/revision", async (c) => {
  try {
    const slug = c.req.param("slug");
    const out = await withDb(async (db) => {
      const read = await revisionRead(db, slug);
      if (!read.available) return { started: false, revision: read };
      const started = startRevision(db, slug, "owner");
      return { started, revision: await revisionRead(db, slug) };
    });
    return c.json(out, out.started ? 202 : 200);
  } catch (e) {
    return fail(c, e);
  }
});

captureRoutes.get("/:slug/entrega", (c) => c.json({ entrega: entregaRead(c.req.param("slug")) }));
captureRoutes.post("/:slug/entrega/encender", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { key?: unknown };
  if (typeof body.key !== "string" || !body.key.trim()) return c.json({ error: "INVALID_FILTER", field: "key" }, 400);
  try {
    const r = await withDb((db) => warmEntrega(db, c.req.param("slug"), body.key as string));
    if (!r) return c.json({ error: "INVALID_FILTER", field: "key", hint: "the delivery has no muestra or no branch, or the project has no capture settings" }, 400);
    return c.json({ entrega: r });
  } catch (e) {
    return fail(c, e);
  }
});
// PLA-I52-5: En vivo. The delivery's copy, signed in, through Plania's proxy (and the tailnet when there is one).
captureRoutes.get("/:slug/entrega/vivo", (c) => c.json({ vivo: vivoRead(c.req.param("slug")) }));
captureRoutes.post("/:slug/entrega/vivo", async (c) => {
  try {
    return c.json({ vivo: await withDb((db) => startVivo(db, c.req.param("slug"))) });
  } catch (e) {
    return fail(c, e);
  }
});
captureRoutes.post("/:slug/entrega/apagar", async (c) => {
  try {
    return c.json({ entrega: null, prueba: await withDb((db) => apagarEntrega(db, c.req.param("slug"))) });
  } catch (e) {
    return fail(c, e);
  }
});

// PLA-I52-3: El Probador's read for one delivery, and Volver a tomar (the whole pass again, in the background).
captureRoutes.get("/:slug/probador/:key", async (c) => {
  try {
    const r = await withDb((db) => probadorRead(db, c.req.param("slug"), assertKey(c.req.param("key"))));
    return r ? c.json(r) : c.json({ error: "TASK_NOT_FOUND" }, 404);
  } catch (e) {
    return fail(c, e);
  }
});
// PLA-127: the images a delivery changes (an icons change shows on no page): the list, and each file before and after.
captureRoutes.get("/:slug/probador/:key/imagenes", async (c) => {
  try {
    const r = await withDb((db) => imagenesRead(db, c.req.param("slug"), assertKey(c.req.param("key"))));
    return c.json({ files: r?.files ?? [] });
  } catch (e) {
    return fail(c, e);
  }
});
captureRoutes.get("/:slug/probador/:key/imagen", async (c) => {
  try {
    const lado = c.req.query("lado") === "antes" ? "antes" : "despues";
    const file = c.req.query("path") ?? "";
    const r = await withDb((db) => imagenBytes(db, c.req.param("slug"), assertKey(c.req.param("key")), lado, file));
    if (!r) return c.json({ error: "IMAGE_NOT_FOUND" }, 404);
    return c.body(new Uint8Array(r.bytes), 200, { "Content-Type": r.mime, "Cache-Control": "private, max-age=60", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox" });
  } catch (e) {
    return fail(c, e);
  }
});
captureRoutes.post("/:slug/probador/:key/tomar", async (c) => {
  try {
    const slug = c.req.param("slug");
    const key = assertKey(c.req.param("key"));
    void withDb((db) => probar(db, slug, key)).catch((e) => console.log(`[probador] ${slug}/${key} failed: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`));
    return c.json({ ok: true });
  } catch (e) {
    return fail(c, e);
  }
});

// PLA-I52-6: «Pregúntale a Taller». The answer comes back in the project thread and shows on the card.
captureRoutes.post("/:slug/probador/:key/preguntar", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { text?: unknown };
  if (typeof body.text !== "string") return c.json({ error: "INVALID_FILTER", field: "text" }, 400);
  try {
    const slug = c.req.param("slug");
    const key = assertKey(c.req.param("key"));
    return c.json(await withDb((db) => preguntar(db, slug, key, body.text as string)));
  } catch (e) {
    return fail(c, e);
  }
});

captureRoutes.get("/:slug/captures/:file", async (c) => {
  const m = /^([0-9a-f-]{36})\.png$/.exec(c.req.param("file"));
  if (!m) return c.json({ error: "NOT_FOUND" }, 404);
  const png = await withDb((db) => stillFile(db, c.req.param("slug"), m[1]!));
  if (!png) return c.json({ error: "NOT_FOUND" }, 404);
  // A still never changes: its id names one file.
  return c.body(new Uint8Array(png), 200, { "Content-Type": "image/png", "Cache-Control": "private, max-age=31536000, immutable" });
});
