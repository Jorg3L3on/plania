// PLA-I46-6: capture settings, the capture pipeline and the stills read. A fake browser covers the pipeline's
// rules (both widths, the test user, errors keep the last good still); one run drives the real headless Chrome
// against a tiny local app with a login form, when Chrome is on the machine.
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const STORE = mkdtempSync(path.join(tmpdir(), "plania-captures-test-"));
process.env.PLANIA_CAPTURES_DIR = STORE;
const { app } = await import("../src/app.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const { makeDb } = await import("../src/db/client.js");
const { createTask } = await import("../src/mcp/writes.js");
const { setProject } = await import("../src/mcp/project.js");
const { findProject } = await import("../src/mcp/queries.js");
const { parseCaptureSettings } = await import("../src/captures/settings.js");
const { runCapture, pngHeight } = await import("../src/captures/run.js");
const { findChrome, launchChrome } = await import("../src/captures/chrome.js");
const { KEEP_UNTIED } = await import("../src/captures/store.js");
type Browser = import("../src/captures/chrome.js").Browser;
type Exec = import("../src/captures/run.js").Exec;

type Json = Record<string, any>;
const ctx = { actor: { agent: "t", session_id: "s1", machine: "ci" } };
const actor = ctx.actor;
const jorge = () => ({ Cookie: `${SESSION_COOKIE}=${createSession()}` });
const read = async (q = ""): Promise<Json> => (await (await app.request(`/api/projects/zigzag/captures${q}`, { headers: jorge() })).json()) as Json;

// The settings exactly as migration 0047 writes them for Mianovia.
const MIGRATION = readFileSync(new URL("../drizzle/migrations/0047_capture_stills.sql", import.meta.url), "utf8");
const MIANOVIA = JSON.parse(/jsonb_build_object\('capture', '([\s\S]*?)'::jsonb\)/.exec(MIGRATION)![1]!) as Json;

// A PNG header is enough for the pipeline (it reads IHDR for the height).
function png(width: number, height: number, tag = ""): Buffer {
  const b = Buffer.alloc(33 + tag.length);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "ascii");
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  b.write(tag, 33, "ascii");
  return b;
}

const BASE = "http://localhost:3999";
type Fake = { logins: string[]; shots: string[]; broken: Set<string>; closed: number };
// A browser over a pretend app: /panel/** wants the login; /panel lists one ficha at /panel/novias/n1.
function fakeBrowser(state: Fake, password: () => string | null): () => Promise<Browser> {
  return async () => {
    let at = `${BASE}/`;
    let loggedIn = false;
    let vp = { width: 0, height: 0, scale: 1 };
    return {
      page: {
        async setViewport(v) {
          vp = v;
        },
        async goto(url) {
          const u = new URL(url);
          if (state.broken.has(u.pathname)) return { status: 500, url };
          if (u.pathname.startsWith("/panel") && u.pathname !== "/panel/entrar" && !loggedIn) at = `${BASE}/panel/entrar?desde=${u.pathname}`;
          else at = url;
          return { status: 200, url: at };
        },
        async evaluate<T>(js: string): Promise<T> {
          if (js.includes("requestSubmit")) {
            const pw = password();
            state.logins.push(js.includes(JSON.stringify("asesora@example.com")) ? "asesora@example.com" : "?");
            loggedIn = pw !== null && js.includes(JSON.stringify(pw));
            at = loggedIn ? `${BASE}/panel` : at;
            return "ok" as T;
          }
          if (js === "location.pathname") return new URL(at).pathname as T;
          if (js === "location.href") return at as T;
          if (js.includes("a ? a.href")) return (new URL(at).pathname === "/panel" ? `${BASE}/panel/novias/n1` : null) as T;
          throw new Error(`unexpected script ${js.slice(0, 40)}`);
        },
        async screenshot() {
          const p = new URL(at).pathname;
          state.shots.push(`${p}@${vp.width}`);
          return png(vp.width * vp.scale, 900 * vp.scale, `${p}@${vp.width}`);
        },
      },
      async close() {
        state.closed++;
      },
    };
  };
}

let raw: pg.Client;
let db: ReturnType<typeof makeDb>["db"];
let checkout: string;
let lastPassword: string | null = null;
let execCalls: { command: string; stdin?: string; cwd: string; env?: NodeJS.ProcessEnv }[] = [];
let passwordExitCode = 0;
const exec: Exec = async (command, opts) => {
  execCalls.push({ command, stdin: opts.stdin, cwd: opts.cwd, env: opts.env });
  if (command === "git rev-parse HEAD") return { code: 0, stdout: "c0ffee1234567890c0ffee1234567890c0ffee12\n", stderr: "" };
  if (command === "git branch --show-current") return { code: 0, stdout: "jl/mia-i5-3\n", stderr: "" };
  if (passwordExitCode !== 0) return { code: passwordExitCode, stdout: "", stderr: "Error: no existe la cuenta\n" };
  lastPassword = opts.stdin!.split("\n")[0]!;
  return { code: 0, stdout: "Contraseña cambiada.\n", stderr: "" };
};
let appUp = true;
const fakeFetch = (async () => {
  if (!appUp) throw new TypeError("fetch failed");
  return new Response("ok", { status: 200 });
}) as unknown as typeof fetch;
const fake: Fake = { logins: [], shots: [], broken: new Set(), closed: 0 };
const deps = () => ({ exec, fetch: fakeFetch, launch: fakeBrowser(fake, () => lastPassword) });
const listing = (dir: string) => readdirSync(dir, { recursive: true }).map(String).sort();

before(async () => {
  raw = await resetTestDb();
  ({ db } = makeDb());
  checkout = mkdtempSync(path.join(tmpdir(), "plania-capture-checkout-"));
  writeFileSync(path.join(checkout, "package.json"), "{}\n");
  const p = await findProject(db, "zigzag");
  await setProject(db, { project: "zigzag", version: p.version, settings: { capture: { ...MIANOVIA, port: 3999 } } }, ctx);
  await createTask(db, { project: "zigzag", title: "Ficha nueva", scope: "s", checks: ["c"] }, ctx);
});

after(async () => {
  await raw.end();
  rmSync(STORE, { recursive: true, force: true });
  rmSync(checkout, { recursive: true, force: true });
});

describe("capture settings", () => {
  test("Mianovia's settings (migration 0047) parse: start command, port, three pages, the seed's test user", () => {
    const r = parseCaptureSettings(MIANOVIA);
    assert.ok(r.ok, JSON.stringify(r));
    assert.equal(MIANOVIA.port, 3000);
    assert.deepEqual(
      MIANOVIA.pages.map((p: Json) => [p.key, p.label, Boolean(p.session)]),
      [
        ["formulario", "Formulario de bienvenida", false],
        ["ficha", "Ficha de la novia", true],
        ["panel", "Panel del equipo", true],
      ],
    );
    assert.equal(MIANOVIA.session.user, "asesora@example.com");
    assert.ok(!JSON.stringify(MIANOVIA).match(/contrase(ñ|n)a"\s*:\s*"[^c]/), "no password stored");
  });

  test("the migration writes them only for mianovia and only once", () => {
    assert.match(MIGRATION, /WHERE "slug" = 'mianovia' AND NOT \("settings" \? 'capture'\)/);
  });

  test("set_project refuses a real-looking account, a session page without a session, and an unknown field", async () => {
    const p = await findProject(db, "workia");
    const bad = async (capture: Json) => {
      await assert.rejects(setProject(db, { project: "workia", version: p.version, settings: { capture } }, ctx), (e: Json) => e.code === "INVALID_FILTER" && String(e.detail.field).startsWith("settings.capture"));
    };
    await bad({ ...MIANOVIA, session: { ...MIANOVIA.session, user: "maria.lopez@gmail.com" } });
    await bad({ ...MIANOVIA, session: undefined });
    await bad({ ...MIANOVIA, password: "x" });
    await bad({ ...MIANOVIA, pages: [MIANOVIA.pages[0], MIANOVIA.pages[0]] });
  });
});

describe("capture run (fake browser)", () => {
  let firstRun: Json;

  test("every page at 1280 and 390, tied to the ticket, with commit, branch and time; the panel pages with the test user", async () => {
    const before = listing(checkout);
    firstRun = await runCapture(db, { project: "zigzag", checkout, task_key: "ZIG-01", actor }, deps());
    assert.equal(firstRun.ok, 6);
    assert.equal(firstRun.failed, 0);
    assert.equal(firstRun.commit, "c0ffee1234567890c0ffee1234567890c0ffee12");
    assert.equal(firstRun.branch, "jl/mia-i5-3");
    assert.deepEqual(fake.shots.sort(), ["/panel/novias/n1@1280", "/panel/novias/n1@390", "/panel@1280", "/panel@390", "/registro/ejemplo@1280", "/registro/ejemplo@390"].sort());
    // A fresh password on the seed's test user, typed twice on stdin in the checkout, then used to log in.
    const pw = execCalls.find((c) => c.command.includes("panel:usuario"))!;
    assert.equal(pw.command, "npm run --silent panel:usuario -- contrasena asesora@example.com");
    assert.equal(pw.cwd, checkout);
    // Plania's own database and secrets never reach the app's command.
    assert.ok(pw.env && pw.env.PATH && !("DATABASE_URL" in pw.env) && !("SESSION_SECRET" in pw.env) && !("MCP_BEARER_TOKEN" in pw.env));
    const [a, b] = pw.stdin!.split("\n");
    assert.ok(a && a.length >= 20 && a === b);
    assert.deepEqual(fake.logins, ["asesora@example.com"]);
    assert.equal(fake.closed, 1);
    // Nothing written to the checkout; the files are in the store, one folder per project.
    assert.deepEqual(listing(checkout), before);
    assert.equal(readdirSync(path.join(STORE, "zigzag")).filter((f) => f.endsWith(".png")).length, 6);
    const rows = (await raw.query("select status, viewport, width, height, commit, branch, task_id is not null as tied, taken_at from capture_stills")).rows;
    assert.equal(rows.length, 6);
    assert.ok(rows.every((r) => r.status === "ok" && r.commit && r.branch === "jl/mia-i5-3" && r.tied && r.taken_at));
    assert.deepEqual([...new Set(rows.map((r) => `${r.viewport}:${r.width}:${r.height}`))].sort(), ["desktop:1280:900", "phone:390:900"]);
  });

  test("the read: each page with its desktop and phone still, and the PNG behind the screen session", async () => {
    const r = await read();
    assert.equal(r.project, "zigzag");
    assert.equal(r.configured, true);
    assert.deepEqual(r.start, { command: "npm run dev -- --port {port}", port: 3999, url: "http://localhost:3999" });
    assert.deepEqual(r.viewports, { desktop: { width: 1280, height: 800 }, phone: { width: 390, height: 844 } });
    assert.deepEqual(
      r.pages.map((p: Json) => [p.key, p.label, p.session]),
      [
        ["formulario", "Formulario de bienvenida", false],
        ["ficha", "Ficha de la novia", true],
        ["panel", "Panel del equipo", true],
      ],
    );
    const ficha = r.pages[1];
    assert.equal(ficha.desktop.error, null);
    assert.equal(ficha.desktop.still.url, `${BASE}/panel/novias/n1`);
    assert.equal(ficha.desktop.still.task_key, "ZIG-01");
    assert.equal(ficha.desktop.still.commit, "c0ffee1234567890c0ffee1234567890c0ffee12");
    assert.equal(ficha.phone.still.width, 390);
    assert.ok(r.last_ok_at && r.last_run_at);
    const img = await app.request(ficha.phone.still.image_url, { headers: jorge() });
    assert.equal(img.status, 200);
    assert.equal(img.headers.get("content-type"), "image/png");
    assert.match(Buffer.from(await img.arrayBuffer()).toString("latin1"), /\/panel\/novias\/n1@390/);
    assert.equal((await app.request(ficha.phone.still.image_url)).status, 401);
    assert.equal((await app.request(`/api/projects/workia/captures/${ficha.phone.still.id}.png`, { headers: jorge() })).status, 404);
    assert.equal((await read("?task=ZIG-01")).pages[0].desktop.still.task_key, "ZIG-01");
    assert.equal((await app.request("/api/projects/zigzag/captures?task=ZIG-99", { headers: jorge() })).status, 404);
  });

  test("a page that fails records the error and keeps its last good still", async () => {
    fake.broken.add("/registro/ejemplo");
    const r = await runCapture(db, { project: "zigzag", checkout, actor }, deps());
    fake.broken.clear();
    assert.equal(r.failed, 2);
    assert.deepEqual(
      r.stills.filter((s: Json) => s.status === "error").map((s: Json) => [s.page, s.error]),
      [
        ["formulario", "/registro/ejemplo respondió 500"],
        ["formulario", "/registro/ejemplo respondió 500"],
      ],
    );
    const form = (await read()).pages[0];
    assert.equal(form.desktop.still.task_key, "ZIG-01", "the last good still, from the first run");
    assert.equal(form.desktop.error.message, "/registro/ejemplo respondió 500");
    assert.equal((await read()).pages[2].desktop.error, null, "the other pages took new stills");
  });

  test("the test copy down: every page records why; every last good still stays", async () => {
    appUp = false;
    const r = await runCapture(db, { project: "zigzag", checkout, actor }, deps());
    appUp = true;
    assert.equal(r.ok, 0);
    assert.equal(r.failed, 6);
    const now = await read();
    for (const p of now.pages) {
      for (const v of ["desktop", "phone"]) {
        assert.ok(now.pages.length === 3 && p[v].still, `${p.key} ${v} keeps a still`);
        assert.equal(p[v].error.message, "La copia de prueba no responde en http://localhost:3999");
      }
    }
  });

  test("the test user cannot be prepared: the session pages record it, the public page is still taken", async () => {
    passwordExitCode = 1;
    const r = await runCapture(db, { project: "zigzag", checkout, actor }, deps());
    passwordExitCode = 0;
    const of = (page: string) => r.stills.filter((s: Json) => s.page === page);
    assert.ok(of("formulario").length === 2 && of("formulario").every((s: Json) => s.status === "ok"));
    assert.ok([...of("ficha"), ...of("panel")].every((s: Json) => s.status === "error" && s.error === "No se pudo preparar el usuario de prueba: Error: no existe la cuenta"));
    const now = await read();
    assert.equal(now.pages[0].desktop.error, null, "fixed since the 500");
  });

  test("a wrong password is not a session: the page that asks to log in again is an error, never a still of the login", async () => {
    const r = await runCapture(db, { project: "zigzag", checkout, pages: ["panel"], actor }, { ...deps(), launch: fakeBrowser(fake, () => "not-the-one"), loginWaitMs: 800 });
    assert.equal(r.ok, 0);
    assert.ok(r.stills.every((s: Json) => /No se pudo entrar con asesora@example.com/.test(s.error)));
  });

  test("untied stills are pruned to the last few per page and viewport; a ticket's stills stay", async () => {
    for (let i = 0; i < KEEP_UNTIED + 2; i++) await runCapture(db, { project: "zigzag", checkout, pages: ["formulario"], viewports: ["desktop"], actor }, deps());
    const { rows } = await raw.query("select count(*) filter (where task_id is null)::int as untied, count(*) filter (where task_id is not null)::int as tied from capture_stills where page_key = 'formulario' and viewport = 'desktop' and status = 'ok'");
    assert.deepEqual(rows[0], { untied: KEEP_UNTIED, tied: 1 });
    const files = new Set((await raw.query("select distinct file from capture_stills where file is not null")).rows.map((r) => r.file));
    assert.deepEqual(new Set(readdirSync(path.join(STORE, "zigzag")).filter((f) => f.endsWith(".png"))), files);
  });

  test("a project without capture settings is refused; its read says so", async () => {
    await assert.rejects(runCapture(db, { project: "filmia", checkout, actor }, deps()), (e: Json) => e.code === "INVALID_FILTER");
    const r = (await (await app.request("/api/projects/filmia/captures", { headers: jorge() })).json()) as Json;
    assert.deepEqual([r.configured, r.start, r.pages, r.last_ok_at], [false, null, [], null]);
    assert.equal((await app.request("/api/projects/nope/captures", { headers: jorge() })).status, 404);
  });

  test("pngHeight reads the PNG header in CSS pixels", () => {
    assert.equal(pngHeight(png(780, 1688), 2), 844);
    assert.equal(pngHeight(Buffer.from("nope"), 1), null);
  });
});

// The real thing: headless Chrome, a login form, a cookie, a list with a link to follow.
const chrome = findChrome();
describe("capture run (real headless Chrome)", { skip: chrome ? false : "no Chrome on this machine" }, () => {
  let server: Server;
  let port = 0;
  const secrets = mkdtempSync(path.join(tmpdir(), "plania-capture-pw-"));
  const pwFile = path.join(secrets, "pw.txt");
  const page = (body: string) => `<!doctype html><html><head><meta name="viewport" content="width=device-width"></head><body style="margin:0;font:16px sans-serif">${body}</body></html>`;

  before(async () => {
    server = createServer((req, res) => {
      const url = new URL(req.url!, "http://x");
      const authed = (req.headers.cookie ?? "").includes("sesion=ok");
      const html = (s: number, b: string, h: Record<string, string> = {}) => (res.writeHead(s, { "content-type": "text/html; charset=utf-8", ...h }), res.end(page(b)));
      if (url.pathname === "/registro/ejemplo") return html(200, `<h1>Formulario</h1><div style="height:1400px;background:#fce">x</div>`);
      if (url.pathname === "/panel/entrar" && req.method === "POST") {
        let body = "";
        req.on("data", (d) => (body += d));
        req.on("end", () => {
          const f = new URLSearchParams(body);
          const ok = f.get("correo") === "asesora@example.com" && f.get("contrasena") === readFileSync(pwFile, "utf8").trim();
          if (!ok) return html(200, "<p>mal</p>");
          res.writeHead(303, { location: "/panel", "set-cookie": "sesion=ok; Path=/panel; HttpOnly" });
          res.end();
        });
        return;
      }
      if (url.pathname === "/panel/entrar") return html(200, `<form method="post" action="/panel/entrar"><input name="correo"><input name="contrasena" type="password"><button>Entrar</button></form>`);
      if (url.pathname.startsWith("/panel") && !authed) return (res.writeHead(307, { location: "/panel/entrar" }), res.end());
      if (url.pathname === "/panel") return html(200, `<h1>Panel</h1><a href="/panel/novias/n7?q=1">Ana Ejemplo</a>`);
      if (url.pathname === "/panel/novias/n7") return html(200, `<h1>Ficha de Ana</h1>`);
      return html(404, "no");
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    port = (server.address() as { port: number }).port;
  });
  after(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    rmSync(secrets, { recursive: true, force: true });
  });

  test("stills at 1280 and 390, the panel and the ficha through the login with the test user", { timeout: 120_000 }, async () => {
    const p = await findProject(db, "micasa");
    await setProject(
      db,
      {
        project: "micasa",
        version: p.version,
        settings: { capture: { ...MIANOVIA, port, session: { ...MIANOVIA.session, password_command: `head -n 1 > ${JSON.stringify(pwFile)}` } } },
      },
      ctx,
    );
    const before = listing(checkout);
    const r = await runCapture(db, { project: "micasa", checkout, base_url: `http://127.0.0.1:${port}`, commit: "abc1234", branch: "sandbox", actor }, { launch: launchChrome });
    assert.equal(r.failed, 0, JSON.stringify(r.stills));
    assert.equal(r.ok, 6);
    assert.deepEqual(listing(checkout), before, "nothing written to the checkout");
    const rows = (await raw.query("select page_key, viewport, url, file from capture_stills where run_id = $1", [r.run_id])).rows;
    const ficha = rows.find((x) => x.page_key === "ficha" && x.viewport === "phone")!;
    assert.equal(new URL(ficha.url).pathname, "/panel/novias/n7");
    for (const row of rows) {
      const b = readFileSync(path.join(STORE, "micasa", row.file));
      assert.equal(b.readUInt32BE(0), 0x89504e47, "a PNG");
      assert.equal(b.readUInt32BE(16), row.viewport === "desktop" ? 1280 : 780, `${row.page_key} ${row.viewport} width in device pixels`);
    }
    // The panel pages are not the login page: their stills differ from each other and from the form's.
    assert.equal(new Set(rows.filter((x) => x.viewport === "desktop").map((x) => x.file)).size, 3);
  });
});
