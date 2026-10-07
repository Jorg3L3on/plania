import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { html } from "hono/html";
import { createMiddleware } from "hono/factory";
import { and, asc, desc, eq, notInArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { verifyPassword } from "../auth/password.js";
import { SESSION_COOKIE, createSession, sessionCookieOptions, verifySession } from "../auth/session.js";
import { withDb, type Db } from "../db/client.js";
import { events, projects, tasks, type Actor } from "../db/schema.js";
import { ToolError, findTask, liveOwner } from "../mcp/queries.js";
import { webCtx } from "../mcp/tx.js";
import { listDecisions } from "../mcp/decisions.js";
import { answer } from "../mcp/questions.js";
import { resumeDigest, type ResumeDigest } from "../mcp/resume.js";
import { claim, setTask } from "../mcp/writes.js";
import { fmtLocal, layout } from "./html.js";

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

// One line of the generated resume for the list: what is claimed, else what is next, else the v1 card.
export function resumeLine(d: ResumeDigest): string {
  const asks = d.open_questions.length;
  const prefix = asks ? `${asks} ${asks === 1 ? "pregunta" : "preguntas"} para ti · ` : "";
  return prefix + workLine(d);
}

function workLine(d: ResumeDigest): string {
  if (d.claims.length) return `En curso: ${d.claims.map((c) => `${c.key} (${c.owner?.agent})`).join(", ")}`;
  const noted = d.initiatives.find((i) => i.next_action.note);
  if (noted) return `${noted.key}: ${noted.next_action.note}`;
  if (d.next_claimable) return `Siguiente: ${d.next_claimable.key} · ${d.next_claimable.title}`;
  return d.legacy_card?.in_progress || d.legacy_card?.next_action || "Sin ficha.";
}

web.get("/", requireSession, async (c) => {
  const rows = await withDb(async (db) => {
    const all = await db.select().from(projects).orderBy(asc(projects.slug));
    return Promise.all(all.map(async (p) => ({ ...p, line: resumeLine(await resumeDigest(db, p)) })));
  });
  return c.html(
    layout(
      "Plania",
      html`<h1>Proyectos</h1>
        <div class="list">
          ${rows.map(
            (p) => html`<a class="card" href="/p/${p.slug}">
              <strong>${p.title} <span class="meta mono">${p.slug}</span></strong>
              <p>${p.line}</p>
            </a>`,
          )}
        </div>`,
      { nav: true },
    ),
  );
});

// ---- Project detail: questions for Jorge, the generated resume, open work, decisions and activity.
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
  version: number;
  owner: Actor | null;
  leaseUntil: Date | null;
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
      version: tasks.version,
      owner: tasks.owner,
      leaseUntil: tasks.leaseUntil,
    })
    .from(tasks)
    .leftJoin(parent, eq(parent.id, tasks.parentId))
    .where(and(eq(tasks.projectId, projectId), notInArray(tasks.status, CLOSED)))
    .orderBy(sql`${tasks.priority} asc nulls last`, desc(tasks.updatedAt));
}

const ACTIVITY_LIMIT = 15;
const DECISIONS_LIMIT = 20;

function recentEvents(db: Db, projectId: string) {
  return db.select().from(events).where(eq(events.projectId, projectId)).orderBy(desc(events.id)).limit(ACTIVITY_LIMIT);
}

function notFound(c: Context) {
  return c.html(layout("Plania · No encontrado", html`<h1>No encontrado</h1><p><a href="/">Volver a proyectos</a></p>`, { nav: true }), 404);
}

const LEGACY_FIELDS: [keyof NonNullable<ResumeDigest["legacy_card"]>, string][] = [
  ["in_progress", "En curso"],
  ["next_action", "Siguiente"],
  ["branch_or_prod", "Rama / prod"],
  ["must_keep_decision", "Decisión fija"],
];

type Claim = ResumeDigest["claims"][number];

const claimText = (c: Claim) => html`<span class="mono">${c.key}</span> · ${c.owner?.agent}${c.workspace?.branch ? html` · <span class="mono">${c.workspace.branch}</span>` : ""}`;

// Questions agents asked Jorge. A suggested option answers with one click; the text box takes anything.
function questionsSection(slug: string, open: ResumeDigest["open_questions"]) {
  return html`<h2>Preguntas para ti</h2>
    ${open.map(
      (q) => html`<form class="question" method="post" action="/p/${slug}/questions/${q.id}/answer">
        <p><span class="mono">${q.task_key}</span> · ${q.asked_by.agent} · <time datetime="${q.asked_at}">${fmtLocal(new Date(q.asked_at))}</time></p>
        <p class="ask">${q.question}</p>
        ${q.options.length
          ? html`<div class="options">${q.options.map((o) => html`<button type="submit" name="answer" value="${o}">${o}</button>`)}</div>`
          : ""}
        <div class="free">
          <input type="text" name="free" placeholder="Otra respuesta" aria-label="Otra respuesta" />
          <button type="submit">Responder</button>
        </div>
      </form>`,
    )}`;
}

// The generated resume: per open initiative what is claimed, what is next and what must be kept;
// then the project-wide part (standalone claims, pinned decisions that belong to no initiative).
function resumeSection(d: ResumeDigest) {
  const row = (label: string, parts: unknown[]) => {
    const shown = parts.filter(Boolean);
    return html`<dt>${label}</dt><dd class="${shown.length ? "" : "empty"}">${shown.length ? shown.map((x, i) => html`${i ? html`<br />` : ""}${x}`) : "—"}</dd>`;
  };
  const next = (c: ResumeDigest["next_claimable"]) => (c ? html`<span class="mono">${c.key}</span> · ${c.title}` : "");
  const projectWide = d.standalone.claims.length || d.must_keep.length;
  return html`
    ${d.initiatives.map(
      (i) => html`<h3>${i.title} <span class="meta mono">${i.key} · ${i.status}</span></h3>
        <dl class="resume">
          ${row("En curso", [i.in_progress.note, ...i.in_progress.claims.map(claimText)])}
          ${row("Siguiente", [i.next_action.note, next(i.next_action.next_claimable)])}
          ${i.must_keep.length ? row("Fijo", i.must_keep.map((m) => m.text)) : ""}
        </dl>`,
    )}
    ${projectWide
      ? html`<h3>Todo el proyecto</h3>
          <dl class="resume">
            ${d.standalone.claims.length ? row("En curso", d.standalone.claims.map(claimText)) : ""}
            ${d.must_keep.length ? row("Fijo", d.must_keep.map((m) => m.text)) : ""}
          </dl>`
      : ""}
    ${!d.initiatives.length && !projectWide && !d.legacy_card ? html`<p class="empty-list">Sin ficha.</p>` : ""}
    ${d.legacy_card
      ? html`<details class="legacy"><summary>Ficha anterior (v1, solo lectura)</summary>
          <dl class="resume">${LEGACY_FIELDS.map(([field, label]) => row(label, [d.legacy_card![field]]))}</dl>
        </details>`
      : ""}`;
}

function doneButton(slug: string, t: OpenTask) {
  const path = t.kind === "initiative" ? "initiatives" : "tasks";
  // The version shown on screen goes back with the click, so a change made meanwhile is not overwritten.
  return html`<form class="inline" method="post" action="/p/${slug}/${path}/${encodeURIComponent(t.key)}/done">
    <input type="hidden" name="version" value="${t.version}" />
    <button type="submit">Done</button>
  </form>`;
}

function claimLine(slug: string, t: OpenTask) {
  const owner = liveOwner(t);
  if (!owner) return "";
  return html`<p class="claim">
    ${owner.agent} <span class="mono">${owner.session_id}</span> hasta ${fmtLocal(t.leaseUntil!)}
    <form class="inline" method="post" action="/p/${slug}/tasks/${encodeURIComponent(t.key)}/release">
      <button type="submit">Liberar</button>
    </form>
  </p>`;
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
      ${claimLine(slug, t)}
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
    if (!p) return undefined;
    return {
      p,
      open: await openTasks(db, p.id),
      activity: await recentEvents(db, p.id),
      digest: await resumeDigest(db, p),
      decisions: await listDecisions(db, p.id, { limit: DECISIONS_LIMIT }),
    };
  });
  if (!data) return notFound(c);
  const { p, open, activity, digest, decisions } = data;
  const stale = c.req.query("stale");

  const initiatives = open.filter((t) => t.kind === "initiative");
  const openInitiativeKeys = new Set(initiatives.map((t) => t.key));
  const childrenOf = (key: string) => open.filter((t) => t.kind === "ticket" && t.parentKey === key);
  // Standalone specs, plus open tickets whose initiative is already closed.
  const loose = open.filter((t) => t.kind === "ticket" && !(t.parentKey && openInitiativeKeys.has(t.parentKey)));

  return c.html(
    layout(
      `Plania · ${p.title}`,
      html`<h1>${p.title}</h1>
        <p class="meta mono">${p.slug} · <a href="/export/${p.slug}.json">Exportar JSON</a></p>
        ${stale
          ? html`<p class="flash">${stale} cambió mientras lo veías. Revisa su estado y vuelve a marcarlo.</p>`
          : ""}
        ${digest.open_questions.length ? questionsSection(p.slug, digest.open_questions) : ""}
        <h2>Ficha</h2>
        ${resumeSection(digest)}
        <h2>Abierto</h2>
        ${open.length === 0 ? html`<p class="empty-list">Nada abierto.</p>` : ""}
        ${initiatives.map(
          (i) => html`<div class="group">
            ${item(p.slug, i, false)} ${childrenOf(i.key).map((t) => item(p.slug, t, true))}
          </div>`,
        )}
        ${loose.length
          ? html`<div class="group">${loose.map((t) => item(p.slug, t, false))}</div>`
          : ""}
        ${decisions.length
          ? html`<h2>Decisiones</h2>
              <ul class="decisions">
                ${decisions.map(
                  (d) => html`<li class="${d.superseded_by ? "superseded" : ""}">
                    ${d.superseded_by ? html`<s>${d.text}</s>` : d.text}
                    <span class="meta">
                      ${d.pinned && !d.superseded_by ? html`<span class="pin">fija</span>` : ""}
                      ${d.task_key ? html`<span class="mono">${d.task_key}</span>` : ""}
                      <time datetime="${d.created_at}">${fmtLocal(new Date(d.created_at))}</time>
                    </span>
                  </li>`,
                )}
              </ul>`
          : ""}
        ${activity.length
          ? html`<h2>Actividad</h2>
              <ul class="activity">
                ${activity.map(
                  (e) => html`<li>
                    <time datetime="${e.createdAt.toISOString()}">${fmtLocal(e.createdAt)}</time>
                    <span>${e.actor.agent}</span> <span class="mono">${e.type}</span>
                    ${e.taskKey ? html`<span class="mono">${e.taskKey}</span>` : ""}
                  </li>`,
                )}
              </ul>`
          : ""}`,
      { nav: true },
    ),
  );
});

// Both Done routes reuse the MCP write path (as Jorge), so resolved_at, versions and events match set_task.
type DoneOutcome = "ok" | "not_found" | "stale";

async function markDone(slug: string, key: string, kind: "ticket" | "initiative", version: number | undefined): Promise<DoneOutcome> {
  return withDb(async (db) => {
    const [p] = await db.select({ id: projects.id }).from(projects).where(eq(projects.slug, slug)).limit(1);
    const t = p ? await findTask(db, p.id, key) : undefined;
    if (!t || t.kind !== kind) return "not_found";
    try {
      if (kind === "ticket") await setTask(db, { project: slug, key, status: "Done", version }, webCtx);
      else await setTask(db, { project: slug, key, status: "Done", version }, webCtx);
      return "ok";
    } catch (e) {
      if (e instanceof ToolError) return ["STALE_VERSION", "VERSION_REQUIRED"].includes(e.code) ? "stale" : "not_found";
      throw e;
    }
  });
}

async function formVersion(c: Context): Promise<number | undefined> {
  const v = (await c.req.parseBody()).version;
  return typeof v === "string" && /^\d+$/.test(v) ? Number(v) : undefined;
}

async function doneRoute(c: Context, kind: "ticket" | "initiative") {
  const { slug, key } = c.req.param() as { slug: string; key: string };
  const outcome = await markDone(slug, key, kind, await formVersion(c));
  if (outcome === "not_found") return notFound(c);
  if (outcome === "stale") return c.redirect(`/p/${slug}?stale=${encodeURIComponent(key)}`, 302);
  return c.redirect(`/p/${slug}`, 302);
}

web.post("/p/:slug/tasks/:key/done", requireSession, (c) => doneRoute(c, "ticket"));

// Jorge answers a question: an option button sends answer, the text box sends free (which wins if filled).
web.post("/p/:slug/questions/:id/answer", requireSession, async (c) => {
  const { slug, id } = c.req.param();
  const form = await c.req.parseBody();
  const text = [form.free, form.answer].find((v): v is string => typeof v === "string" && v.trim() !== "");
  if (!text) return c.redirect(`/p/${slug}`, 302);
  const ok = await withDb(async (db) => {
    try {
      await answer(db, { project: slug, question_id: id, answer: text.trim() }, webCtx);
      return true;
    } catch (e) {
      if (e instanceof ToolError && e.code === "ALREADY_ANSWERED") return true;
      if (e instanceof ToolError) return false;
      throw e;
    }
  });
  if (!ok) return notFound(c);
  return c.redirect(`/p/${slug}`, 302);
});

// Jorge frees a lease held by a session that is gone.
web.post("/p/:slug/tasks/:key/release", requireSession, async (c) => {
  const { slug, key } = c.req.param();
  const ok = await withDb(async (db) => {
    try {
      await claim(db, { project: slug, key, action: "release" }, webCtx);
      return true;
    } catch (e) {
      if (e instanceof ToolError) return false;
      throw e;
    }
  });
  if (!ok) return notFound(c);
  return c.redirect(`/p/${slug}`, 302);
});
web.post("/p/:slug/initiatives/:key/done", requireSession, (c) => doneRoute(c, "initiative"));
