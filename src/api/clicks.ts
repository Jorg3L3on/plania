// PLA-I74-1: every owner click on the screen leaves one event that says which control it was, so an initiative's
// run report can count the clicks beyond the decisions. The screen's writes are its POST, PUT, PATCH and DELETE
// calls under /api with the session cookie; this middleware runs after each one that succeeded and writes
// `owner.click` {control, decision, key?, ...small fields}. The control is the route with its slug, keys and ids
// taken out ("ideas.respuesta", "decisions.aceptar", "release.ship"); decision names the owner's decisions
// (DECISIONS below), null for everything else. Opening a stop («visto») is not a click: the screen sends it by itself.
// A click with no project in its path lands on the one its reply names, else on the home project, else nowhere.
import { and, eq } from "drizzle-orm";
import type { Context, MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { SESSION_COOKIE, verifySession } from "../auth/session.js";
import { withDb } from "../db/client.js";
import { projects, tasks } from "../db/schema.js";
import { webCtx, writeTx } from "../mcp/tx.js";

export const OWNER_CLICK = "owner.click";

/** The owner's decisions (PLA-I74 bar): everything else he clicks is an extra click. */
export const DECISIONS = ["pedir", "respuesta", "asi_es", "me_gusta", "construyelo", "aceptar", "ajuste", "publicar"] as const;
export type DecisionControl = (typeof DECISIONS)[number];

export type Click = { control: string; decision: DecisionControl | null; slug: string | null; key: string | null; detail: Record<string, string> };

const WRITES = new Set(["POST", "PUT", "PATCH", "DELETE"]);
// Not the owner's clicks: signing in and out, first start, and what the screen sends by itself.
const NOT_CLICKS = [/^\/(login|logout|first-start)(\/|$)/, /\/ideas\/[^/]+\/visto$/, /\/logo\/preview$/, /\/import\/preview$/, /\/camino\/lint$/];
// Segments that carry a ticket key, and the ones whose next segment is an id (dropped from the control).
const KEYED = new Set(["tasks", "ideas", "pedidos", "orders", "requests", "probador", "qa"]);
const ID_AFTER = new Set(["decisions", "runs", "copias", "sobrantes", "lessons", "repeats", "marks", "questions", "blockers", "threads", "tokens", "goals", "proposals", "puestos", "teams", "skills", "keys", "providers", "versions", "surface", "checks", "context", "seats", "team"]);
const KEY_SHAPE = /^[A-Z][A-Z0-9]*-[A-Z0-9-]+$/;
// Fields of the body worth keeping (short enums and numbers, never his words).
const DETAIL_FIELDS = ["verdict", "stop", "action", "mode", "kind", "status", "option", "decision"] as const;

/** The control a write is, or null when it is not one of his clicks. path is under /api (with or without it). */
export function clickOf(method: string, rawPath: string, body: Record<string, unknown> | null, reply: Record<string, unknown> | null): Click | null {
  if (!WRITES.has(method.toUpperCase())) return null;
  const path = rawPath.replace(/^\/api(?=\/)/, "").replace(/\/+$/, "") || "/";
  if (NOT_CLICKS.some((r) => r.test(path))) return null;
  const segs = path.split("/").filter(Boolean).map((s) => decodeURIComponent(s));
  let slug: string | null = null;
  let key: string | null = null;
  const parts: string[] = [];
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i]!;
    if (s === "company" && i === 0) continue;
    if (s === "projects") {
      if (segs[i + 1] !== undefined) slug = segs[++i]!;
      if (i === segs.length - 1) parts.push("project");
      continue;
    }
    parts.push(s);
    if (KEYED.has(s) && segs[i + 1] !== undefined) {
      const next = segs[i + 1]!;
      if (KEY_SHAPE.test(next)) key = next;
      i++;
    } else if (ID_AFTER.has(s) && segs[i + 1] !== undefined) i++;
  }
  const detail: Record<string, string> = {};
  for (const f of DETAIL_FIELDS) {
    const v = body?.[f];
    if (typeof v === "string" && v.length <= 40) detail[f] = v;
    else if (typeof v === "number" || typeof v === "boolean") detail[f] = String(v);
  }
  const replyDecision = (reply?.decision ?? null) as { project?: unknown; ref?: unknown } | null;
  if (!slug && typeof replyDecision?.project === "string") slug = replyDecision.project;
  if (!key && typeof replyDecision?.ref === "string" && KEY_SHAPE.test(replyDecision.ref)) key = replyDecision.ref;
  if (!key && typeof reply?.key === "string" && KEY_SHAPE.test(reply.key)) key = reply.key;
  let control = parts.join(".") || "root";
  if (control === "decisions" && detail.action) control = `decisions.${detail.action}`;
  return { control, decision: decisionOf(control, detail), slug, key, detail };
}

/** Which of the owner's decisions a control is (null: an extra click). */
export function decisionOf(control: string, detail: Record<string, string>): DecisionControl | null {
  switch (control) {
    case "ask":
      return "pedir";
    case "ideas.respuesta":
      if (detail.verdict === "deshacer") return null;
      if (detail.verdict === "ok" && detail.stop === "entendido") return "asi_es";
      if (detail.verdict === "ok" && detail.stop === "diseno") return "me_gusta";
      return "respuesta";
    case "ideas.decision":
    case "questions.answer":
      return "respuesta";
    case "pedidos.construir":
      return "construyelo";
    case "decisions.aceptar":
      return "aceptar";
    case "decisions.cambios":
    case "decisions.cambiar":
      return "ajuste";
    case "decisions.elegir":
    case "decisions.responder":
    case "decisions.aprobar":
    case "decisions.rechazar":
    case "decisions.once":
      return "respuesta";
    case "release.ship":
      return "publicar";
    default:
      return null;
  }
}

const homeSlug = () => process.env.PLANIA_HOME_PROJECT?.trim() || "plania";

async function jsonOf(read: () => Promise<unknown>): Promise<Record<string, unknown> | null> {
  try {
    const v = await read();
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Writes the click's event. Never fails the owner's request: a missing project or a write error is dropped. */
export async function recordClick(click: Click): Promise<boolean> {
  return withDb(async (db) => {
    const find = async (slug: string) => (await db.select({ id: projects.id, slug: projects.slug }).from(projects).where(eq(projects.slug, slug)).limit(1))[0] ?? null;
    const project = (click.slug ? await find(click.slug) : null) ?? (await find(homeSlug()));
    if (!project) return false;
    const [task] = click.key && project.slug === click.slug ? await db.select({ id: tasks.id, key: tasks.key }).from(tasks).where(and(eq(tasks.projectId, project.id), eq(tasks.key, click.key))).limit(1) : [];
    await writeTx(db, project, webCtx, async (_tx, emit) => {
      await emit(OWNER_CLICK, task ?? null, { control: click.control, decision: click.decision, ...(click.key ? { key: click.key } : {}), ...(project.slug !== click.slug ? { global: true } : {}), ...click.detail });
    });
    return true;
  });
}

/** The middleware: mount it on /api before the routes it watches. */
export const ownerClicks: MiddlewareHandler = async (c: Context, next) => {
  await next();
  try {
    if (!WRITES.has(c.req.method) || c.res.status >= 400) return;
    if (/^\s*bearer\b/i.test(c.req.header("Authorization") ?? "")) return;
    if (!verifySession(getCookie(c, SESSION_COOKIE))) return;
    const json = (c.req.header("Content-Type") ?? "").startsWith("application/json");
    const body = json ? await jsonOf(() => c.req.json()) : null;
    const reply = (c.res.headers.get("Content-Type") ?? "").includes("json") ? await jsonOf(() => c.res.clone().json()) : null;
    const click = clickOf(c.req.method, c.req.path, body, reply);
    if (click) await recordClick(click);
  } catch (e) {
    console.error("[plania] owner click not recorded:", (e as Error).message);
  }
};
