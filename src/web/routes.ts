import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { html } from "hono/html";
import { createMiddleware } from "hono/factory";
import { and, asc, desc, eq, notInArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { verifyPassword } from "../auth/password.js";
import { SESSION_COOKIE, createSession, sessionCookieOptions, verifySession } from "../auth/session.js";
import { withDb, type Db } from "../db/client.js";
import { projects, tasks, type Project } from "../db/schema.js";
import { ToolError, findTask } from "../mcp/queries.js";
import { setInitiative, setTask } from "../mcp/writes.js";
import { layout } from "./html.js";

// Handoff §6. HTML forms only; no public JSON API besides /mcp.
export const web = new Hono();

const requireSession = createMiddleware(async (c, next) => {
  if (!verifySession(getCookie(c, SESSION_COOKIE))) return c.redirect("/login", 302);
  await next();
});

function loginPage(error?: string) {
  return layout(
    "Plania · Entrar",
    html`<h1>Plania</h1>
      <form method="post" action="/login">
        <label for="password">Contraseña</label>
        <input id="password" name="password" type="password" autocomplete="current-password" autofocus required />
        ${error ? html`<p class="error">${error}</p>` : ""}
        <button class="primary" type="submit">Entrar</button>
      </form>`,
  );
}

web.get("/login", (c) => {
  if (verifySession(getCookie(c, SESSION_COOKIE))) return c.redirect("/", 302);
  return c.html(loginPage());
});

web.post("/login", async (c) => {
  const form = await c.req.parseBody();
  const password = typeof form.password === "string" ? form.password : "";
  const stored = process.env.PLANIA_PASSWORD_HASH ?? "";
  if (!password || !stored || !(await verifyPassword(stored, password))) {
    return c.html(loginPage("Contraseña incorrecta."), 401);
  }
  setCookie(c, SESSION_COOKIE, createSession(), sessionCookieOptions);
  return c.redirect("/", 302);
});

web.post("/logout", (c) => {
  deleteCookie(c, SESSION_COOKIE, { path: "/", secure: true });
  return c.redirect("/login", 302);
});

// One line of the resume card for the list: what is in progress, else what is next.
function resumeLine(p: Project): string {
  return p.resumeInProgress || p.resumeNextAction || "Sin ficha.";
}

web.get("/", requireSession, async (c) => {
  const rows = await withDb((db) => db.select().from(projects).orderBy(asc(projects.slug)));
  return c.html(
    layout(
      "Plania",
      html`<h1>Proyectos</h1>
        <div class="list">
          ${rows.map(
            (p) => html`<a class="card" href="/p/${p.slug}">
              <strong>${p.title} <span class="meta mono">${p.slug}</span></strong>
              <p>${resumeLine(p)}</p>
            </a>`,
          )}
        </div>`,
      { nav: true },
    ),
  );
});

// ---- Project detail (handoff §6): resume card + short list of open initiatives and tickets.
// The screen shows title, one line, status and priority. No counts, no blocker graph, no bodies.

const CLOSED = ["Done", "Won't do"];

type OpenTask = {
  key: string;
  kind: string;
  title: string;
  summary: string;
  status: string;
  priority: string | null;
  blockedNote: string | null;
  prUrl: string | null;
  parentKey: string | null;
};

async function openTasks(db: Db, projectId: string): Promise<OpenTask[]> {
  const parent = alias(tasks, "parent");
  return db
    .select({
      key: tasks.key,
      kind: tasks.kind,
      title: tasks.title,
      summary: tasks.summary,
      status: tasks.status,
      priority: tasks.priority,
      blockedNote: tasks.blockedNote,
      prUrl: tasks.prUrl,
      parentKey: parent.key,
    })
    .from(tasks)
    .leftJoin(parent, eq(parent.id, tasks.parentId))
    .where(and(eq(tasks.projectId, projectId), notInArray(tasks.status, CLOSED)))
    .orderBy(sql`${tasks.priority} asc nulls last`, desc(tasks.updatedAt));
}

function notFound(c: Context) {
  return c.html(layout("Plania · No encontrado", html`<h1>No encontrado</h1><p><a href="/">Volver a proyectos</a></p>`, { nav: true }), 404);
}

const RESUME_FIELDS: [keyof Project, string][] = [
  ["resumeInProgress", "En curso"],
  ["resumeNextAction", "Siguiente"],
  ["resumeBranchOrProd", "Rama / prod"],
  ["resumeMustKeepDecision", "Decisión fija"],
];

function doneButton(slug: string, t: OpenTask) {
  const path = t.kind === "initiative" ? "initiatives" : "tasks";
  return html`<form class="inline" method="post" action="/p/${slug}/${path}/${encodeURIComponent(t.key)}/done">
    <button type="submit">Done</button>
  </form>`;
}

function item(slug: string, t: OpenTask, child: boolean) {
  // Jorge marks Done after merging, so tickets offer Done once they are In review.
  // Initiatives offer it while open; closing one is always his call.
  const canClose = t.kind === "initiative" || t.status === "In review";
  const showPr = t.status === "In review" && !!t.prUrl;
  return html`<div class="item${child ? " child" : ""}">
    <div class="text">
      <div class="title">${t.title} <span class="meta mono">${t.key}</span></div>
      ${t.summary ? html`<p class="line">${t.summary}</p>` : ""}
      ${t.status === "Blocked" && t.blockedNote ? html`<p class="note">${t.blockedNote}</p>` : ""}
    </div>
    <div class="side">
      <div class="row">
        <span class="status">${t.status}</span>
        ${t.priority ? html`<span class="prio">${t.priority}</span>` : ""}
      </div>
      ${showPr || canClose
        ? html`<div class="row">
            ${showPr ? html`<a href="${t.prUrl}" rel="noreferrer">PR</a>` : ""} ${canClose ? doneButton(slug, t) : ""}
          </div>`
        : ""}
    </div>
  </div>`;
}

web.get("/p/:slug", requireSession, async (c) => {
  const slug = c.req.param("slug");
  const data = await withDb(async (db) => {
    const [p] = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
    return p ? { p, open: await openTasks(db, p.id) } : undefined;
  });
  if (!data) return notFound(c);
  const { p, open } = data;

  const initiatives = open.filter((t) => t.kind === "initiative");
  const openInitiativeKeys = new Set(initiatives.map((t) => t.key));
  const childrenOf = (key: string) => open.filter((t) => t.kind === "ticket" && t.parentKey === key);
  // Standalone specs, plus open tickets whose initiative is already closed.
  const loose = open.filter((t) => t.kind === "ticket" && !(t.parentKey && openInitiativeKeys.has(t.parentKey)));

  return c.html(
    layout(
      `Plania · ${p.title}`,
      html`<h1>${p.title}</h1>
        <p class="meta mono">${p.slug}</p>
        <h2>Ficha</h2>
        <dl class="resume">
          ${RESUME_FIELDS.map(([field, label]) => {
            const value = String(p[field] ?? "");
            return html`<dt>${label}</dt><dd class="${value ? "" : "empty"}">${value || "—"}</dd>`;
          })}
        </dl>
        <h2>Abierto</h2>
        ${open.length === 0 ? html`<p class="empty-list">Nada abierto.</p>` : ""}
        ${initiatives.map(
          (i) => html`<div class="group">
            ${item(p.slug, i, false)} ${childrenOf(i.key).map((t) => item(p.slug, t, true))}
          </div>`,
        )}
        ${loose.length
          ? html`<div class="group">${loose.map((t) => item(p.slug, t, false))}</div>`
          : ""}`,
      { nav: true },
    ),
  );
});

// Both Done routes reuse the MCP write path, so resolved_at and validation match set_task / set_initiative.
async function markDone(slug: string, key: string, kind: "ticket" | "initiative"): Promise<"ok" | "not_found"> {
  return withDb(async (db) => {
    const [p] = await db.select({ id: projects.id }).from(projects).where(eq(projects.slug, slug)).limit(1);
    const t = p ? await findTask(db, p.id, key) : undefined;
    if (!t || t.kind !== kind) return "not_found";
    try {
      if (kind === "ticket") await setTask(db, { project: slug, key, status: "Done" });
      else await setInitiative(db, { project: slug, key, status: "Done" });
      return "ok";
    } catch (e) {
      if (e instanceof ToolError) return "not_found";
      throw e;
    }
  });
}

web.post("/p/:slug/tasks/:key/done", requireSession, async (c) => {
  const { slug, key } = c.req.param();
  if ((await markDone(slug, key, "ticket")) === "not_found") return notFound(c);
  return c.redirect(`/p/${slug}`, 302);
});

web.post("/p/:slug/initiatives/:key/done", requireSession, async (c) => {
  const { slug, key } = c.req.param();
  if ((await markDone(slug, key, "initiative")) === "not_found") return notFound(c);
  return c.redirect(`/p/${slug}`, 302);
});
