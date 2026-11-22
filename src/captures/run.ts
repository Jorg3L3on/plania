// PLA-I46-6: one capture run. Given a checkout whose app is already running (settings.capture.port), take a
// still of each page at 1440 and at 390 with headless Chrome and keep them in Plania (src/captures/store.ts),
// tied to the ticket or delivery when there is one, with the commit and the time. Nothing is written to the
// checkout. A page that fails gets an error row; its last good still stays and the read shows both.
import { spawn } from "node:child_process";
import path from "node:path";
import { killTree, shellCommand } from "../lib/proc-tree.js";
import { randomBytes, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { projects, tasks, type Actor } from "../db/schema.js";
import { ToolError } from "../mcp/errors.js";
import { launchChrome, type BrowserPage, type LaunchBrowser } from "./chrome.js";
import { baseUrl, landingOf, landsOn, VIEWPORT_NAMES, VIEWPORTS, type CapturePage, type CaptureSettings, type ViewportName } from "./settings.js";
import { prune, recordStill } from "./store.js";
import { DEFAULT_WAITS, measuredWaits } from "./waits.js";
import { runEnv } from "../runner/run-env.js";
import { defineWords, say } from "../words.js";

// PLA-I2-10: why a still did not come out, in the install's language; the Spanish is unchanged. crashed() in
// src/captures/probador.ts reads `crash` and `answered` back in both languages: keep them in step.
export const RUN_WORDS = defineWords({
  es: {
    noFields: (page: string, user: string, pass: string) => `La página ${page} no tiene los campos ${user} y ${pass}`,
    noForm: (page: string) => `Los campos de ${page} no están en un formulario`,
    noLogin: (user: string, page: string) => `No se pudo entrar con ${user} (seguía en ${page})`,
    notYet: (path: string) => `${path} no existe todavía`,
    answered: (path: string, status: number) => `${path} respondió ${status}`,
    loginAgain: (path: string) => `${path} pidió entrar otra vez`,
    noMatch: (path: string, follow: string) => `En ${path} no hay nada que coincida con ${follow}`,
    leaves: (follow: string) => `${follow} lleva fuera de la copia de prueba`,
    noClick: (path: string, click: string) => `En ${path} no encontré «${click}»`,
    noFill: (path: string, fill: string) => `En ${path} no hay ${fill}`,
    noOption: (path: string, fill: string, value: string) => `En ${path}, ${fill} no tiene la opción «${value}»`,
    crash: (path: string, crash: string) => `${path} muestra un error: ${crash}`,
    noUserCode: (code: number | null) => `No se pudo preparar el usuario de prueba (código ${code})`,
    copyAnswered: (status: number, base: string) => `La copia de prueba respondió ${status} en ${base}`,
    copyDown: (base: string) => `La copia de prueba no responde en ${base}`,
    noChrome: (why: string) => `No se pudo abrir Chrome: ${why}`,
    code: (code: number | null) => `código ${code}`,
    noUser: (why: string) => `No se pudo preparar el usuario de prueba: ${why}`,
    noSignIn: (why: string) => `No se pudo entrar: ${why}`,
    noPages: "El proyecto no tiene páginas para fotografiar",
    // PLA-I74-10: crashed() and wrongPage() in probador.ts read this back.
    wrongPage: (label: string, at: string, want: string) => `Foto equivocada: «${label}» salió en ${at} y debía salir en ${want}`,
  },
  en: {
    noFields: (page: string, user: string, pass: string) => `The page ${page} has no ${user} and ${pass} fields`,
    noForm: (page: string) => `The fields on ${page} are not in a form`,
    noLogin: (user: string, page: string) => `Could not sign in as ${user} (still on ${page})`,
    notYet: (path: string) => `${path} does not exist yet`,
    answered: (path: string, status: number) => `${path} answered ${status}`,
    loginAgain: (path: string) => `${path} asked to sign in again`,
    noMatch: (path: string, follow: string) => `On ${path} nothing matches ${follow}`,
    leaves: (follow: string) => `${follow} leads outside the test copy`,
    noClick: (path: string, click: string) => `On ${path} I did not find «${click}»`,
    noFill: (path: string, fill: string) => `On ${path} there is no ${fill}`,
    noOption: (path: string, fill: string, value: string) => `On ${path}, ${fill} has no option «${value}»`,
    crash: (path: string, crash: string) => `${path} shows an error: ${crash}`,
    noUserCode: (code: number | null) => `Could not prepare the test user (code ${code})`,
    copyAnswered: (status: number, base: string) => `The test copy answered ${status} at ${base}`,
    copyDown: (base: string) => `The test copy does not answer at ${base}`,
    noChrome: (why: string) => `Could not open Chrome: ${why}`,
    code: (code: number | null) => `code ${code}`,
    noUser: (why: string) => `Could not prepare the test user: ${why}`,
    noSignIn: (why: string) => `Could not sign in: ${why}`,
    noPages: "The project has no pages to photograph",
    wrongPage: (label: string, at: string, want: string) => `Wrong picture: «${label}» landed on ${at} and should have been on ${want}`,
  },
});

export type Exec = (
  command: string,
  opts: { cwd: string; stdin?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv },
) => Promise<{ code: number | null; stdout: string; stderr: string }>;

// What a command run in the app's checkout inherits: the shell basics only. Plania's own environment
// (DATABASE_URL, tokens, secrets) never reaches the app: its tools read their own .env.local, and Node's
// --env-file does not override a variable that is already set.
// PLA-I2-13: the same allow-list as a run (src/runner/run-env.ts), without Claude's variables: an app needs no
// Claude sign-in. extra (PORT, a test copy's own database URL) goes in as given.
export function checkoutEnv(extra: Record<string, string> = {}, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env = runEnv(base, { claude: false });
  env.PATH = toolPath(base.PATH, process.execPath);
  return { ...env, ...extra };
}

// PLA-39: under launchd Plania's PATH is the bare system one, so npm and node are not found. The running node's own
// folder (where npm lives for nvm and Homebrew) and the usual tool folders go first; what PATH had stays, once each.
export const TOOL_DIRS = ["/opt/homebrew/bin", "/usr/local/bin"];
// PLA-I2-4: joined with the system's separator (path.delimiter).
export function toolPath(current: string | undefined, execPath: string, sep: string = path.delimiter): string {
  const parts = [path.dirname(execPath), ...TOOL_DIRS, ...(current ?? "").split(sep)].filter(Boolean);
  return [...new Set(parts)].join(sep);
}

export type CaptureDeps = {
  launch?: LaunchBrowser;
  exec?: Exec;
  password?: () => string;
  fetch?: typeof fetch;
  loginWaitMs?: number;
  formWaitMs?: number; // PLA-I74-7
};

export type CaptureInput = {
  project: string;
  checkout: string; // where password_command runs and the commit is read; never written
  base_url?: string; // default http://localhost:<settings.capture.port>
  commit?: string;
  branch?: string;
  task_key?: string;
  pages?: string[]; // page keys; default every page
  // PLA-I52-3: El Probador. The delivery's own views (its muestra) instead of the project's pages, which side of
  // the pair this run is, and whether a path that is not there yet (404) is a new screen rather than an error.
  views?: ViewPage[];
  side?: "antes" | "despues";
  allow_missing?: boolean;
  viewports?: ViewportName[];
  actor: Actor;
  // PLA-75: extra variables for commands run in the checkout (the delivery copy's own database URL).
  env?: Record<string, string>;
};

// A muestra's view as a page to shoot: the page fields plus what to do on it before the still.
export type ViewPage = CapturePage & { acciones?: ({ click: string } | { fill: string; value: string })[] };
class Missing extends Error {}
// PLA-I74-10: the photo was of another page than the one the view declares.
class WrongPage extends Error {
  constructor(
    message: string,
    readonly at: string,
  ) {
    super(message);
  }
}

export type CaptureOutcome = { page: string; viewport: ViewportName; status: "ok" | "error"; id: string; error?: string; missing?: boolean; wrong?: boolean };
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

// PLA-168: a dev server compiles the login and its auth route on first use; on a copy that just started that took
// longer than 15 s and the pass gave up on a correct password. Wait longer, and try once more before giving up.
// PLA-I74-7: today's value; runCapture waits twice the last check-up's cold start instead (src/captures/waits.ts).
const LOGIN_WAIT_MS: number = DEFAULT_WAITS.login_ms;

// sh -c in the checkout, with stdin, killed after timeoutMs.
// PLA-I2-19 (audit B5): cmd.exe on Windows, and the timeout stops the whole tree there (taskkill /T): killing cmd.exe
// alone would leave the command running.
export const shellExec: Exec = (command, { cwd, stdin, timeoutMs = 120_000, env }) =>
  new Promise((resolve) => {
    const e = env ?? checkoutEnv();
    const sh = shellCommand(command, process.platform, e);
    const child = spawn(sh.file, sh.args, { ...sh.options, cwd, env: e, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => (process.platform === "win32" && child.pid ? killTree(child.pid, "SIGKILL") : child.kill("SIGKILL")), timeoutMs);
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
    // PLA-I2-19: a command that exits without reading its stdin closes the pipe first; on Linux the write then fails
    // with EPIPE, which must not escape as an uncaught error. The exit code still says how the command ended.
    child.stdin.on("error", () => undefined);
    child.stdin.end(stdin ?? "");
  });

const short = (e: unknown) => (e instanceof Error ? e.message : String(e)).split("\n")[0]!.slice(0, 300);

async function gitLine(exec: Exec, cwd: string, args: string): Promise<string | null> {
  const r = await exec(`git ${args}`, { cwd, timeoutMs: 10_000 });
  const line = r.stdout.trim();
  return r.code === 0 && line ? line : null;
}

// Logs in on the page with the test user and the password just set. Returns null or what went wrong.
// PLA-166 (guided test 2026-11-22): on a React login (Next.js app router, onSubmit + signIn) the fields were filled
// and requestSubmit()ed as soon as goto resolved, before React attached to the form: the submit never reached the
// app and the page stayed on the login. The form is live once the page is complete and, on a React page, the password
// field carries React's props. A page without React is live on load. Waits at most FORM_WAIT_MS, then fills anyway.
export const FORM_WAIT_MS: number = DEFAULT_WAITS.form_ms;
export const formReadyScript = (passwordField: string) => `(() => { /* __planiaFormReady */
  if (document.readyState !== 'complete') return false;
  const pass = document.querySelector('input[name=' + ${JSON.stringify(JSON.stringify(passwordField))} + ']');
  if (!pass) return false;
  const react = !!(window.__next_f || window.__NEXT_DATA__ || window.next || document.querySelector('[data-reactroot]'));
  return !react || Object.keys(pass).some((k) => k.startsWith('__react'));
})()`;

async function logIn(page: BrowserPage, base: string, s: NonNullable<CaptureSettings["session"]>, password: string, waitMs: number, formWaitMs = FORM_WAIT_MS): Promise<string | null> {
  const first = await logInOnce(page, base, s, password, waitMs, formWaitMs);
  if (first === null || first !== say(RUN_WORDS).noLogin(s.user, s.login_path)) return first;
  // PLA-168: still on the login after the wait: once more, now that the app has compiled what it needed.
  return logInOnce(page, base, s, password, waitMs, formWaitMs);
}

async function logInOnce(page: BrowserPage, base: string, s: NonNullable<CaptureSettings["session"]>, password: string, waitMs: number, formWaitMs: number): Promise<string | null> {
  await page.goto(base + s.login_path);
  const live = Date.now() + Math.min(formWaitMs, waitMs);
  while (Date.now() < live) {
    let ready = false;
    try {
      ready = await page.evaluate<boolean>(formReadyScript(s.password_field));
    } catch {
      // mid-navigation
    }
    if (ready) break;
    await new Promise((r) => setTimeout(r, 250));
  }
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
  if (filled === "missing") return say(RUN_WORDS).noFields(s.login_path, s.user_field, s.password_field);
  if (filled === "noform") return say(RUN_WORDS).noForm(s.login_path);
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
  return say(RUN_WORDS).noLogin(s.user, s.login_path);
}

// Opens one page (and its follow), checks it is the page and not an error or the login, and takes the still.
async function shoot(page: BrowserPage, base: string, pg: ViewPage, settings: CaptureSettings, allowMissing = false): Promise<{ png: Buffer; url: string }> {
  let nav = await page.goto(base + pg.path);
  const check = () => {
    if (allowMissing && nav.status === 404) throw new Missing(say(RUN_WORDS).notYet(pg.path));
    if (nav.status !== null && nav.status >= 400) throw new Error(say(RUN_WORDS).answered(pg.path, nav.status));
    const login = settings.session?.login_path;
    if (pg.session && login && new URL(nav.url).pathname === login) throw new Error(say(RUN_WORDS).loginAgain(pg.path));
  };
  check();
  if (pg.follow) {
    // PLA-73: a follow that is a path («/panel/novias/») means the first link whose href starts with it; anything else
    // is a CSS selector, as before. Taller was told to give the prefix and the photo pass threw on it.
    const sel = followSelector(pg.follow);
    const href = await page.evaluate<string | null>(`(() => { const a = document.querySelector(${JSON.stringify(sel)}); return a ? a.href : null; })()`);
    if (!href) throw new Error(say(RUN_WORDS).noMatch(pg.path, pg.follow));
    if (new URL(href).origin !== new URL(base).origin) throw new Error(say(RUN_WORDS).leaves(pg.follow));
    nav = await page.goto(href);
    check();
  }
  for (const a of pg.acciones ?? []) {
    // PLA-105: a target that is not there yet (shown after an async load, e.g. the free times of a day) is looked for
    // again every ACTION_POLL_MS for up to ACTION_WAIT_MS; a fixed 400 ms missed it on a slow dev copy.
    const act = () =>
      page.evaluate<string>(
      "click" in a
        ? clickScript(a.click)
        : `(() => {
            const el = document.querySelector(${JSON.stringify(a.fill)});
            if (!el) return 'missing';
            // PLA-80: a <select> has its own value setter (the input one threw «Illegal invocation»), and its value
            // may be given as the option's visible text.
            let v = ${JSON.stringify(a.value)};
            if (el instanceof HTMLSelectElement) {
              const opt = [...el.options].find((o) => o.value === v) || [...el.options].find((o) => o.text.trim().toLowerCase() === v.trim().toLowerCase());
              if (!opt) return 'nooption';
              v = opt.value;
            }
            const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
            Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            return 'ok';
          })()`,
      );
    let done = await act();
    for (let waited = 0; done === "missing" && waited < ACTION_WAIT_MS; waited += ACTION_POLL_MS) {
      await new Promise((res) => setTimeout(res, ACTION_POLL_MS));
      done = await act();
    }
    if (done === "missing") throw new Error("click" in a ? say(RUN_WORDS).noClick(pg.path, a.click) : say(RUN_WORDS).noFill(pg.path, a.fill));
    if (done === "nooption") throw new Error(say(RUN_WORDS).noOption(pg.path, "fill" in a ? a.fill : "", "fill" in a ? a.value : ""));
    await new Promise((res) => setTimeout(res, 400)); // let the page settle after the action
  }
  // PLA-76 (F-24): a page that answered 200 but shows the framework's error (Next's overlay, «Application error»)
  // is not a picture of the delivery: it becomes an error with the error's first line, so the card says «error»
  // and holds Aceptar back instead of calling it «cambió».
  const crash = pageError(await page.evaluate<PageText>(PAGE_TEXT_SCRIPT).catch(() => null));
  if (crash) throw new Error(say(RUN_WORDS).crash(pg.path, crash));
  // PLA-I74-10: the page the browser is on now (after the follow and the actions) must be the declared one; a photo of
  // another page is wrong, never shown as the delivery.
  const at = await page.evaluate<string>("location.href").catch(() => nav.url);
  const want = landingOf(pg);
  if (want && !landsOn(want, at)) {
    let shown = at;
    try {
      const u = new URL(at);
      shown = u.origin === new URL(base).origin ? u.pathname + u.search : at;
    } catch {
      // keep the raw value
    }
    throw new WrongPage(say(RUN_WORDS).wrongPage(pg.label, shown, want), at);
  }
  return { png: await page.screenshot(Boolean(pg.full_page)), url: at || nav.url };
}

// PLA-I52-5: sign the test user in on a running copy and return the session cookies, for El Probador's live copy.
// A fresh password every time (never kept), the same login as the stills. Throws with the reason in the install's language.
export async function sessionCookies(
  input: { base_url: string; checkout: string; settings: CaptureSettings; env?: Record<string, string> },
  deps: CaptureDeps = {},
): Promise<{ name: string; value: string }[]> {
  const s = input.settings.session;
  if (!s) return [];
  const exec = deps.exec ?? shellExec;
  const password = (deps.password ?? (() => randomBytes(18).toString("base64url")))();
  const r = await exec(s.password_command.replaceAll("{user}", s.user), { cwd: input.checkout, stdin: `${password}\n${password}\n`, timeoutMs: 120_000, env: checkoutEnv(input.env ?? {}) });
  if (r.code !== 0) throw new Error(say(RUN_WORDS).noUserCode(r.code));
  const browser = await (deps.launch ?? launchChrome)();
  try {
    await browser.page.setViewport(VIEWPORTS.desktop);
    const err = await logIn(browser.page, input.base_url.replace(/\/$/, ""), s, password, deps.loginWaitMs ?? LOGIN_WAIT_MS);
    if (err) throw new Error(err);
    return (await browser.page.cookies?.()) ?? [];
  } finally {
    await browser.close().catch(() => {});
  }
}

// PLA-I74-6: the check-up's sixth step. Sign the capture user in (when the project has one), take one photo of the
// first page behind the login (else the first page) and check it landed on its declared URL. Nothing is stored.
export type PhotoCheck = { ok: true; page: string; url: string } | { ok: false; page: string | null; error: string };
export async function photoCheck(input: { base_url: string; checkout: string; settings: CaptureSettings; env?: Record<string, string> }, deps: CaptureDeps = {}): Promise<PhotoCheck> {
  const s = input.settings;
  const pg = (s.session ? s.pages.find((x) => x.session) : null) ?? s.pages[0];
  if (!pg) return { ok: false, page: null, error: say(RUN_WORDS).noPages };
  const base = input.base_url.replace(/\/$/, "");
  let browser: Awaited<ReturnType<LaunchBrowser>>;
  try {
    browser = await (deps.launch ?? launchChrome)();
  } catch (e) {
    return { ok: false, page: pg.key, error: say(RUN_WORDS).noChrome(short(e)) };
  }
  try {
    await browser.page.setViewport(VIEWPORTS.desktop);
    if (pg.session && s.session) {
      const exec = deps.exec ?? shellExec;
      const password = (deps.password ?? (() => randomBytes(18).toString("base64url")))();
      const r = await exec(s.session.password_command.replaceAll("{user}", s.session.user), { cwd: input.checkout, stdin: `${password}\n${password}\n`, timeoutMs: 120_000, env: checkoutEnv(input.env ?? {}) });
      if (r.code !== 0) return { ok: false, page: pg.key, error: say(RUN_WORDS).noUser((r.stderr || r.stdout).trim().split("\n").pop()?.slice(0, 200) || say(RUN_WORDS).code(r.code)) };
      const err = await logIn(browser.page, base, s.session, password, deps.loginWaitMs ?? LOGIN_WAIT_MS, deps.formWaitMs);
      if (err) return { ok: false, page: pg.key, error: err };
    }
    const shot = await shoot(browser.page, base, pg, s);
    return { ok: true, page: pg.key, url: shot.url };
  } catch (e) {
    return { ok: false, page: pg.key, error: short(e) };
  } finally {
    await browser.close().catch(() => {});
  }
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
  let pages: ViewPage[] = input.views?.length ? input.views : input.pages?.length ? settings.pages.filter((x) => input.pages!.includes(x.key)) : settings.pages;
  if (!pages.length) throw new ToolError("INVALID_FILTER", { field: "pages", allowed: settings.pages.map((x) => x.key) });
  const viewports = input.viewports?.length ? input.viewports : VIEWPORT_NAMES;
  const base = (input.base_url ?? baseUrl(settings)).replace(/\/$/, "");
  const commit = input.commit ?? (await gitLine(exec, input.checkout, "rev-parse HEAD"));
  const branch = input.branch ?? (await gitLine(exec, input.checkout, "branch --show-current"));
  const runId = randomUUID();
  const stills: CaptureOutcome[] = [];

  const save = async (pg: CapturePage, vp: ViewportName, r: { png: Buffer; url: string } | { error: string; missing?: boolean; url?: string }) => {
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
      side: input.side ?? null,
    };
    const row =
      "png" in r
        ? await recordStill(db, p.slug, { ...common, height: pngHeight(r.png, v.scale), ok: true, png: r.png, url: r.url })
        : await recordStill(db, p.slug, { ...common, height: null, ok: false, error: r.error, url: r.url ?? null, missing: Boolean(r.missing) });
    stills.push({ page: pg.key, viewport: vp, status: row.status as "ok" | "error", id: row.id, ...(row.error ? { error: row.error } : {}), ...(row.missing ? { missing: true } : {}), ...("error" in r && r.url ? { wrong: true } : {}) });
  };
  const failAll = async (list: CapturePage[], error: string) => {
    for (const vp of viewports) for (const pg of list) await save(pg, vp, { error });
  };

  // Is the test copy up? If not, every page records why and keeps its last good still.
  let up: string | null = null;
  try {
    const r = await doFetch(base + (settings.ready_path ?? "/"), { redirect: "manual", signal: AbortSignal.timeout(10_000) });
    if (r.status >= 500) up = say(RUN_WORDS).copyAnswered(r.status, base);
  } catch {
    up = say(RUN_WORDS).copyDown(base);
  }
  if (up) {
    await failAll(pages, up);
    return finish();
  }

  // PLA-153 (guided test 3): a view the muestra did not mark session but that the app sends to its login page is
  // photographed signed in. Taller forgot session on three panel views and every still was the sign-in form.
  const loginPath = settings.session?.login_path;
  if (loginPath) {
    pages = await Promise.all(
      pages.map(async (pg) => {
        if (pg.session) return pg;
        try {
          const r = await doFetch(base + pg.path, { redirect: "manual", signal: AbortSignal.timeout(10_000) });
          const to = r.status >= 300 && r.status < 400 ? r.headers.get("location") : null;
          return to && new URL(to, base).pathname === loginPath ? { ...pg, session: true } : pg;
        } catch {
          return pg;
        }
      }),
    );
  }

  let browser: Awaited<ReturnType<LaunchBrowser>>;
  try {
    browser = await launch();
  } catch (e) {
    await failAll(pages, say(RUN_WORDS).noChrome(short(e)));
    return finish();
  }
  try {
    // Behind the session: a fresh password on the seed's test user, then the login form. Never stored.
    let sessionError: string | null = null;
    if (pages.some((x) => x.session) && settings.session) {
      const s = settings.session;
      const password = (deps.password ?? (() => randomBytes(18).toString("base64url")))();
      const cmd = s.password_command.replaceAll("{user}", s.user);
      const r = await exec(cmd, { cwd: input.checkout, stdin: `${password}\n${password}\n`, timeoutMs: 120_000, env: checkoutEnv(input.env ?? {}) });
      if (r.code !== 0) sessionError = say(RUN_WORDS).noUser((r.stderr || r.stdout).trim().split("\n").pop()?.slice(0, 200) ?? say(RUN_WORDS).code(r.code));
      else {
        try {
          await browser.page.setViewport(VIEWPORTS.desktop);
          // PLA-I74-7: the project's measured waits, unless a caller (a test) gives its own.
          const waits = deps.loginWaitMs != null && deps.formWaitMs != null ? null : await measuredWaits(db, p.slug);
          sessionError = await logIn(browser.page, base, s, password, deps.loginWaitMs ?? waits!.login_ms, deps.formWaitMs ?? waits!.form_ms);
        } catch (e) {
          sessionError = say(RUN_WORDS).noSignIn(short(e));
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
          await save(pg, vp, await shoot(browser.page, base, pg, settings, Boolean(input.allow_missing)));
        } catch (e) {
          await save(pg, vp, { error: short(e), missing: e instanceof Missing, ...(e instanceof WrongPage ? { url: e.at } : {}) });
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

/** PLA-105: how long an action's target is waited for, and how often it is looked for. */
export const ACTION_WAIT_MS = 8_000;
export const ACTION_POLL_MS = 250;

/** PLA-73: «/panel/novias/» → a[href^="/panel/novias/"]; a CSS selector stays as it is. */
export const followSelector = (follow: string): string => (follow.startsWith("/") ? `a[href^=${JSON.stringify(follow)}]` : follow);

/** PLA-76 (F-22): click a button, link, tab or label by its visible text (exact first), else by a CSS selector, else by
 * a text that contains it. Taller believed it needed a selector; both now work. */
export const clickScript = (click: string): string => `(() => {
  const raw = ${JSON.stringify(click)};
  const want = raw.trim().toLowerCase();
  const all = [...document.querySelectorAll('button, a, [role=button], [role=tab], [role=menuitem], label, summary, input[type=submit], input[type=button]')];
  const text = (e) => (e.innerText || e.textContent || e.value || e.getAttribute && e.getAttribute('aria-label') || '').trim().toLowerCase();
  let el = all.find((e) => text(e) === want) || null;
  if (!el) {
    try {
      el = document.querySelector(raw);
    } catch {
      el = null;
    }
  }
  if (!el && want) el = all.find((e) => text(e).includes(want)) || null;
  if (!el) return 'missing';
  el.click();
  return 'ok';
})()`;

// What the page says, read before the still: the text inside Next's dev overlay (a shadow root on <nextjs-portal>),
// Vite's overlay, and the start of the body.
export type PageText = { overlay: string; body: string };
export const PAGE_TEXT_SCRIPT = `(() => {
  const words = (root) => [...root.children].filter((c) => c.tagName !== 'STYLE' && c.tagName !== 'SCRIPT').map((c) => c.innerText || c.textContent || '').join('\\n');
  const shadow = (sel) => [...document.querySelectorAll(sel)].map((e) => words(e.shadowRoot || e)).join('\\n');
  const overlay = [shadow('nextjs-portal'), shadow('vite-error-overlay')].join('\\n').slice(0, 4000);
  const body = ((document.body && document.body.innerText) || '').slice(0, 4000);
  return { overlay, body };
})()`;

const OVERLAY_HEADS = [/Unhandled Runtime Error/i, /Runtime Error/i, /Build Error/i, /Server Error/i, /Failed to compile/i, /\[plugin:[^\]]+\]/i];
const BODY_HEADS = [/Application error: a (client|server)-side exception has occurred[^\n]*/i, /^\s*Internal Server Error\s*$/im, /^\s*500\s*[|:-]?\s*Internal Server Error/im];

/** PLA-76: the framework error a page shows, as one short line, or null when the page looks like the app. A dev
 * overlay that only holds Next's badge (no error heading) is not an error. */
export function pageError(t: PageText | null): string | null {
  if (!t) return null;
  const line = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, 200);
  for (const re of OVERLAY_HEADS) {
    const m = re.exec(t.overlay);
    if (!m) continue;
    const after = t.overlay.slice(m.index + m[0].length).split("\n").map((x) => x.trim()).find((x) => x && !/^(Call Stack|Next\.js|Source|\d+ of \d+|Close)/i.test(x));
    return line(after ? `${m[0]}: ${after}` : m[0]);
  }
  for (const re of BODY_HEADS) {
    const m = re.exec(t.body);
    if (m) return line(m[0]);
  }
  return null;
}
