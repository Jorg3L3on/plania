import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { html } from "hono/html";
import { createMiddleware } from "hono/factory";
import { asc } from "drizzle-orm";
import { verifyPassword } from "../auth/password.js";
import { SESSION_COOKIE, createSession, sessionCookieOptions, verifySession } from "../auth/session.js";
import { withDb } from "../db/client.js";
import { projects, type Project } from "../db/schema.js";
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
