// PLA-I46-6: one capture run. Given a checkout whose app is already running (settings.capture.port), take a
// still of each page at 1280 and at 390 with headless Chrome and keep them in Plania (src/captures/store.ts),
// tied to the ticket or delivery when there is one, with the commit and the time. Nothing is written to the
// checkout. A page that fails gets an error row; its last good still stays and the read shows both.
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { projects, tasks, type Actor } from "../db/schema.js";
import { ToolError } from "../mcp/errors.js";
import { launchChrome, type BrowserPage, type LaunchBrowser } from "./chrome.js";
import { baseUrl, VIEWPORT_NAMES, VIEWPORTS, type CapturePage, type CaptureSettings, type ViewportName } from "./settings.js";
import { prune, recordStill } from "./store.js";

export type Exec = (
  command: string,
  opts: { cwd: string; stdin?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv },
) => Promise<{ code: number | null; stdout: string; stderr: string }>;

// What a command run in the app's checkout inherits: the shell basics only. Plania's own environment
// (DATABASE_URL, tokens, secrets) never reaches the app: its tools read their own .env.local, and Node's
// --env-file does not override a variable that is already set.
const CHECKOUT_ENV = ["PATH", "HOME", "USER", "LOGNAME", "SHELL", "LANG", "LC_ALL", "TMPDIR", "TERM", "NVM_DIR", "NVM_BIN", "PNPM_HOME", "COREPACK_HOME"];
export function checkoutEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const k of CHECKOUT_ENV) if (process.env[k] !== undefined) env[k] = process.env[k];
  return { ...env, ...extra };
}

export type CaptureDeps = {
  launch?: LaunchBrowser;
  exec?: Exec;
  password?: () => string;
  fetch?: typeof fetch;
  loginWaitMs?: number;
};

export type CaptureInput = {
  project: string;
  checkout: string; // where password_command runs and the commit is read; never written
  base_url?: string; // default http://localhost:<settings.capture.port>
  commit?: string;
  branch?: string;
  task_key?: string;
  pages?: string[]; // page keys; default every page
  viewports?: ViewportName[];
  actor: Actor;
};

export type CaptureOutcome = { page: string; viewport: ViewportName; status: "ok" | "error"; id: string; error?: string };
export type CaptureSummary = {
  run_id: string;
  project: string;
  task_key: string | null;
  commit: string | null;
  branch: string | null;
  base_url: string;
  ok: number;
  failed: number;
  stills: CaptureOutcome[];
};

const LOGIN_WAIT_MS = 15_000;

// sh -c in the checkout, with stdin, killed after timeoutMs.
export const shellExec: Exec = (command, { cwd, stdin, timeoutMs = 120_000, env }) =>
  new Promise((resolve) => {
    const child = spawn("/bin/sh", ["-c", command], { cwd, env: env ?? checkoutEnv(), stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (d) => (stdout += String(d)));
    child.stderr.on("data", (d) => (stderr += String(d)));
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr: stderr + e.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    child.stdin.end(stdin ?? "");
  });

const short = (e: unknown) => (e instanceof Error ? e.message : String(e)).split("\n")[0]!.slice(0, 300);

async function gitLine(exec: Exec, cwd: string, args: string): Promise<string | null> {
  const r = await exec(`git ${args}`, { cwd, timeoutMs: 10_000 });
  const line = r.stdout.trim();
  return r.code === 0 && line ? line : null;
}

// Logs in on the page with the test user and the password just set. Returns null or what went wrong.
async function logIn(page: BrowserPage, base: string, s: NonNullable<CaptureSettings["session"]>, password: string, waitMs: number): Promise<string | null> {
  await page.goto(base + s.login_path);
  const filled = await page.evaluate<string>(`(() => {
    const byName = (n) => document.querySelector('input[name=' + JSON.stringify(n) + ']');
    const user = byName(${JSON.stringify(s.user_field)});
    const pass = byName(${JSON.stringify(s.password_field)});
    if (!user || !pass) return 'missing';
    const set = (el, v) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    set(user, ${JSON.stringify(s.user)});
    set(pass, ${JSON.stringify(password)});
    if (!pass.form) return 'noform';
    pass.form.requestSubmit();
    return 'ok';
  })()`);
  if (filled === "missing") return `La página ${s.login_path} no tiene los campos ${s.user_field} y ${s.password_field}`;
  if (filled === "noform") return `Los campos de ${s.login_path} no están en un formulario`;
  const prefix = s.after_login_prefix;
  const until = Date.now() + waitMs;
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, 250));
    let at: string;
    try {
      at = await page.evaluate<string>("location.pathname");
    } catch {
      continue; // mid-navigation
    }
    if (at !== s.login_path && (!prefix || at.startsWith(prefix))) return null;
  }
  return `No se pudo entrar con ${s.user} (seguía en ${s.login_path})`;
}

// Opens one page (and its follow), checks it is the page and not an error or the login, and takes the still.
async function shoot(page: BrowserPage, base: string, pg: CapturePage, settings: CaptureSettings): Promise<{ png: Buffer; url: string }> {
  let nav = await page.goto(base + pg.path);
  const check = () => {
    if (nav.status !== null && nav.status >= 400) throw new Error(`${pg.path} respondió ${nav.status}`);
    const login = settings.session?.login_path;
    if (pg.session && login && new URL(nav.url).pathname === login) throw new Error(`${pg.path} pidió entrar otra vez`);
  };
  check();
  if (pg.follow) {
    const href = await page.evaluate<string | null>(`(() => { const a = document.querySelector(${JSON.stringify(pg.follow)}); return a ? a.href : null; })()`);
    if (!href) throw new Error(`En ${pg.path} no hay nada que coincida con ${pg.follow}`);
    if (new URL(href).origin !== new URL(base).origin) throw new Error(`${pg.follow} lleva fuera de la copia de prueba`);
    nav = await page.goto(href);
    check();
  }
  return { png: await page.screenshot(Boolean(pg.full_page)), url: nav.url };
}

export async function runCapture(db: Db, input: CaptureInput, deps: CaptureDeps = {}): Promise<CaptureSummary> {
  const exec = deps.exec ?? shellExec;
  const launch = deps.launch ?? launchChrome;
  const doFetch = deps.fetch ?? fetch;
  const [p] = await db.select().from(projects).where(eq(projects.slug, input.project));
  if (!p) throw new ToolError("PROJECT_NOT_FOUND", { project: input.project });
  const settings = p.settings.capture;
  if (!settings) throw new ToolError("INVALID_FILTER", { field: "settings.capture", hint: "the project has no capture settings (set_project settings.capture)" });
  let taskId: string | null = null;
  if (input.task_key) {
    const [t] = await db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.projectId, p.id), eq(tasks.key, input.task_key)));
    if (!t) throw new ToolError("TASK_NOT_FOUND", { key: input.task_key });
    taskId = t.id;
  }
  const pages = input.pages?.length ? settings.pages.filter((x) => input.pages!.includes(x.key)) : settings.pages;
  if (!pages.length) throw new ToolError("INVALID_FILTER", { field: "pages", allowed: settings.pages.map((x) => x.key) });
  const viewports = input.viewports?.length ? input.viewports : VIEWPORT_NAMES;
  const base = (input.base_url ?? baseUrl(settings)).replace(/\/$/, "");
  const commit = input.commit ?? (await gitLine(exec, input.checkout, "rev-parse HEAD"));
  const branch = input.branch ?? (await gitLine(exec, input.checkout, "branch --show-current"));
  const runId = randomUUID();
  const stills: CaptureOutcome[] = [];

  const save = async (pg: CapturePage, vp: ViewportName, r: { png: Buffer; url: string } | { error: string }) => {
    const v = VIEWPORTS[vp];
    const common = {
      projectId: p.id,
      taskId,
      runId,
      pageKey: pg.key,
      pageLabel: pg.label,
      path: pg.path,
      viewport: vp,
      width: v.width,
      commit,
      branch,
      actor: input.actor,
    };
    const row =
      "png" in r
        ? await recordStill(db, p.slug, { ...common, height: pngHeight(r.png, v.scale), ok: true, png: r.png, url: r.url })
        : await recordStill(db, p.slug, { ...common, height: null, ok: false, error: r.error, url: null });
    stills.push({ page: pg.key, viewport: vp, status: row.status as "ok" | "error", id: row.id, ...(row.error ? { error: row.error } : {}) });
  };
  const failAll = async (list: CapturePage[], error: string) => {
    for (const vp of viewports) for (const pg of list) await save(pg, vp, { error });
  };

  // Is the test copy up? If not, every page records why and keeps its last good still.
  let up: string | null = null;
  try {
    const r = await doFetch(base + (settings.ready_path ?? "/"), { redirect: "manual", signal: AbortSignal.timeout(10_000) });
    if (r.status >= 500) up = `La copia de prueba respondió ${r.status} en ${base}`;
  } catch {
    up = `La copia de prueba no responde en ${base}`;
  }
  if (up) {
    await failAll(pages, up);
    return finish();
  }

  let browser: Awaited<ReturnType<LaunchBrowser>>;
  try {
    browser = await launch();
  } catch (e) {
    await failAll(pages, `No se pudo abrir Chrome: ${short(e)}`);
    return finish();
  }
  try {
    // Behind the session: a fresh password on the seed's test user, then the login form. Never stored.
    let sessionError: string | null = null;
    if (pages.some((x) => x.session) && settings.session) {
      const s = settings.session;
      const password = (deps.password ?? (() => randomBytes(18).toString("base64url")))();
      const cmd = s.password_command.replaceAll("{user}", s.user);
      const r = await exec(cmd, { cwd: input.checkout, stdin: `${password}\n${password}\n`, timeoutMs: 120_000, env: checkoutEnv() });
      if (r.code !== 0) sessionError = `No se pudo preparar el usuario de prueba: ${(r.stderr || r.stdout).trim().split("\n").pop()?.slice(0, 200) ?? `código ${r.code}`}`;
      else {
        try {
          await browser.page.setViewport(VIEWPORTS.desktop);
          sessionError = await logIn(browser.page, base, s, password, deps.loginWaitMs ?? LOGIN_WAIT_MS);
        } catch (e) {
          sessionError = `No se pudo entrar: ${short(e)}`;
        }
      }
    }
    for (const vp of viewports) {
      await browser.page.setViewport(VIEWPORTS[vp]);
      for (const pg of pages) {
        if (pg.session && sessionError) {
          await save(pg, vp, { error: sessionError });
          continue;
        }
        try {
          await save(pg, vp, await shoot(browser.page, base, pg, settings));
        } catch (e) {
          await save(pg, vp, { error: short(e) });
        }
      }
    }
  } finally {
    await browser.close().catch(() => {});
  }
  return finish();

  async function finish(): Promise<CaptureSummary> {
    await prune(db, p!.id, p!.slug);
    const ok = stills.filter((s) => s.status === "ok").length;
    return { run_id: runId, project: p!.slug, task_key: input.task_key ?? null, commit, branch, base_url: base, ok, failed: stills.length - ok, stills };
  }
}

// The image's height in CSS pixels, from the PNG header (IHDR), so the floor can reserve the box.
export function pngHeight(png: Buffer, scale: number): number | null {
  if (png.length < 24 || png.readUInt32BE(12) !== 0x49484452) return null;
  return Math.round(png.readUInt32BE(20) / scale);
}
