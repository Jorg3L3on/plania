// PLA-I67-4: one seat's references, from its «Oficio» page (src/references/store.ts). The owner's session cookie only,
// like the Pedir pictures: a Bearer (any agent token) is 403 even with a cookie, no cookie is 401. No MCP tool writes
// these: what an agent is given to look at is the owner's call.
//   GET    /api/company/projects/:slug/team/:agent/references              → {references: [...]}, own then shared
//   POST   …/references/link   {url, note?, stance?, applies?, scope?, title?}
//          → 201 {reference, error}: error is null, or the fetch's refusal {code, message} (the link is kept, failed)
//          400 FETCH_URL_INVALID | FETCH_SCHEME_REFUSED (nothing kept)
//   POST   …/references/file?name=<file name>   the raw bytes, or multipart with one file field
//          PNG, JPEG, WebP or PDF by its first bytes; 5 MB; images re-encoded and reduced → 201 {reference}
//          400 REFERENCE_FILE_EMPTY | REFERENCE_FILE_TYPE | REFERENCE_FILE_TOO_LARGE, 409 REFERENCE_LIMIT
//   PATCH  …/references/:id   {title?, note?, stance?, applies?, scope?, state?} → {reference}
//   POST   …/references/:id/retry   reads the link again → {reference, error}
//   DELETE …/references/:id   → {deleted: true, file_removed}
//   GET    …/references/:id/file   the stored file, private cache
//   GET    …/references/runs       the seat's last runs that carried references: {runs: [{run_id, task_key, at,
//          status, references: [{id, title, kind, stance, opened}]}]}
// Every refusal is {error, message}; error is a code from src/mcp/errors.ts. Mounted at /api/company before the
// company routes (src/api/routes.ts).
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { getCookie } from "hono/cookie";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { SESSION_COOKIE, verifySession } from "../auth/session.js";
import { withDb, type Db } from "../db/client.js";
import { WEB_ACTOR } from "../mcp/tx.js";
import { PEDIDO_IMAGE_WORDS } from "./pedido-images.js";
import { MAX_REFERENCE_BYTES, ReferenceError, addFileReference, addLinkReference, deleteReference, listReferences, referenceBytes, retryLink, updateReference, type ReferenceDeps } from "../references/store.js";
import { runReferences, type RunReference } from "../runner/references.js";
import { say } from "../words.js";

export const oficioRefRoutes = new Hono();

// Tests swap these (an injected fetch and reducer); the server uses the defaults.
let deps: ReferenceDeps = {};
export const setReferenceDepsForTests = (d: ReferenceDeps) => {
  deps = d;
};

const BASE = "/projects/:slug/team/:agent/references";
oficioRefRoutes.use(BASE, guard);
oficioRefRoutes.use(`${BASE}/*`, guard);

async function guard(c: Context, next: () => Promise<void>) {
  if (/^\s*bearer\b/i.test(c.req.header("Authorization") ?? "")) return c.json({ error: "FORBIDDEN", message: say(PEDIDO_IMAGE_WORDS).screenOnly }, 403);
  if (!verifySession(getCookie(c, SESSION_COOKIE))) return c.json({ error: "UNAUTHORIZED", message: say(PEDIDO_IMAGE_WORDS).signIn }, 401);
  await next();
}

function fail(c: Context, e: unknown): Response {
  if (e instanceof ReferenceError) return c.json({ error: e.code, message: e.message, ...e.detail }, e.status);
  throw e;
}

const seat = (c: Context) => ({ slug: c.req.param("slug")!, agent: c.req.param("agent")! });

const Fields = {
  title: z.string().max(400).optional(),
  note: z.string().max(4000).optional(),
  stance: z.string().max(20).optional(),
  applies: z.string().max(20).optional(),
  scope: z.string().max(20).optional(),
};
const LinkBody = z.object({ url: z.string().max(4000), ...Fields }).strict();
const PatchBody = z.object({ ...Fields, state: z.string().max(10).optional() }).strict();

async function json<T>(c: Context, schema: z.ZodType<T>): Promise<T | Response> {
  const raw = await c.req.json().catch(() => undefined);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const e = new ReferenceError("REFERENCE_INVALID", { field: String(parsed.error.issues[0]?.path[0] ?? "body") });
    return c.json({ error: e.code, message: e.message, field: e.detail.field }, 400);
  }
  return parsed.data;
}

type Fields = { title?: string; note?: string; stance?: "follow" | "avoid"; applies?: "always" | "on_topic"; scope?: "agent" | "project"; state?: "on" | "off" };
// The store checks the values; here they only get their types.
const asFields = (b: Record<string, unknown>) => b as Fields;

oficioRefRoutes.get(BASE, async (c) => {
  try {
    const { slug, agent } = seat(c);
    return c.json({ references: await withDb((db) => listReferences(db, slug, agent)) });
  } catch (e) {
    return fail(c, e);
  }
});

oficioRefRoutes.post(`${BASE}/link`, async (c) => {
  const body = await json(c, LinkBody);
  if (body instanceof Response) return body;
  try {
    const { slug, agent } = seat(c);
    const { url, ...rest } = body;
    const r = await withDb((db) => addLinkReference(db, { slug, agent, url, actor: WEB_ACTOR, ...asFields(rest) }, deps));
    return c.json({ reference: r.reference, error: r.error ? { code: r.error.code, message: r.error.message } : null }, 201);
  } catch (e) {
    return fail(c, e);
  }
});

const limit = bodyLimit({
  maxSize: MAX_REFERENCE_BYTES + 64 * 1024,
  onError: (c) => {
    const e = new ReferenceError("REFERENCE_FILE_TOO_LARGE", { max_bytes: MAX_REFERENCE_BYTES });
    return c.json({ error: e.code, message: e.message, max_bytes: MAX_REFERENCE_BYTES }, e.status);
  },
});

async function fileOf(c: Context): Promise<{ bytes: Buffer; name?: string }> {
  const type = c.req.header("Content-Type") ?? "";
  if (type.startsWith("multipart/form-data")) {
    const form = await c.req.parseBody({ all: true });
    const files = Object.values(form)
      .flat()
      .filter((v): v is File => typeof v === "object" && v !== null && "arrayBuffer" in v);
    if (files.length !== 1) throw new ReferenceError("REFERENCE_FILE_EMPTY");
    return { bytes: Buffer.from(await files[0]!.arrayBuffer()), name: files[0]!.name };
  }
  return { bytes: Buffer.from(await c.req.arrayBuffer()), name: c.req.query("name") ?? undefined };
}

oficioRefRoutes.post(`${BASE}/file`, limit, async (c) => {
  try {
    const { slug, agent } = seat(c);
    const { bytes, name } = await fileOf(c);
    const reference = await withDb((db) => addFileReference(db, { slug, agent, bytes, name, actor: WEB_ACTOR }, deps));
    return c.json({ reference }, 201);
  } catch (e) {
    return fail(c, e);
  }
});

oficioRefRoutes.get(`${BASE}/runs`, async (c) => {
  try {
    const { slug, agent } = seat(c);
    return c.json({ runs: await withDb((db) => seatRuns(db, slug, agent)) });
  } catch (e) {
    return fail(c, e);
  }
});

oficioRefRoutes.patch(`${BASE}/:id`, async (c) => {
  const body = await json(c, PatchBody);
  if (body instanceof Response) return body;
  try {
    const { slug, agent } = seat(c);
    return c.json({ reference: await withDb((db) => updateReference(db, slug, agent, c.req.param("id")!, asFields(body))) });
  } catch (e) {
    return fail(c, e);
  }
});

oficioRefRoutes.post(`${BASE}/:id/retry`, async (c) => {
  try {
    const { slug, agent } = seat(c);
    const r = await withDb((db) => retryLink(db, slug, agent, c.req.param("id")!, deps));
    return c.json({ reference: r.reference, error: r.error ? { code: r.error.code, message: r.error.message } : null });
  } catch (e) {
    return fail(c, e);
  }
});

oficioRefRoutes.delete(`${BASE}/:id`, async (c) => {
  try {
    const { slug, agent } = seat(c);
    const r = await withDb((db) => deleteReference(db, slug, agent, c.req.param("id")!));
    return c.json({ deleted: true, ...r });
  } catch (e) {
    return fail(c, e);
  }
});

oficioRefRoutes.get(`${BASE}/:id/file`, async (c) => {
  try {
    const { slug, agent } = seat(c);
    const r = await withDb((db) => referenceBytes(db, slug, agent, c.req.param("id")!));
    return c.body(new Uint8Array(r.bytes), 200, {
      "Content-Type": r.mime,
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    });
  } catch (e) {
    return fail(c, e);
  }
});

export type SeatRun = { run_id: string; task_key: string | null; status: string; at: string; references: RunReference[] };

/** The seat's last 20 runs that carried references, newest first, each with what it carried and opened. */
export async function seatRuns(db: Db, slug: string, agent: string): Promise<SeatRun[]> {
  const rows = (
    await db.execute<{ id: string; task_key: string | null; status: string; at: string } & Record<string, unknown>>(sql`
      select r.id, r.task_key, r.status, coalesce(r.ended_at, r.started_at, r.queued_at) as at
      from agent_runs r
      join agents a on a.id = r.agent_id
      join projects p on p.id = r.project_id
      where p.slug = ${slug} and a.slug = ${agent}
        and exists (select 1 from agent_reference_uses u where u.run_id = r.id)
      order by r.queued_at desc
      limit 20`)
  ).rows;
  return Promise.all(rows.map(async (r) => ({ run_id: r.id, task_key: r.task_key, status: r.status, at: new Date(r.at).toISOString(), references: await runReferences(db, r.id) })));
}
