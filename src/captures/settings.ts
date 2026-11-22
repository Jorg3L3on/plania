// PLA-I46-6: how Plania reaches a project's running app to take stills of it. Stored in Plania
// (projects.settings.capture), never in the app repo. Secrets never: the test user's password is
// not stored anywhere; session.password_command sets a fresh one on the seed's test user for each run.
import { z } from "zod";

// The two widths every page is taken at (the owner, 13 Nov 2026): desktop 1280, phone 390.
export const VIEWPORTS = {
  // PLA-110 (guided test PLA-86, F-28): the bar is 1440×800, the size the owner reads Plania and the apps at.
  desktop: { width: 1440, height: 800, mobile: false, scale: 1 },
  phone: { width: 390, height: 844, mobile: true, scale: 2 },
} as const;
export type ViewportName = keyof typeof VIEWPORTS;
export const VIEWPORT_NAMES = Object.keys(VIEWPORTS) as ViewportName[];

// A test account only: a reserved test domain (RFC 2606 / 6761), so a real person's address never fits.
const TEST_USER = /^[a-z0-9._%+-]+@([a-z0-9-]+\.)*(example\.(com|org|net)|[a-z0-9-]+\.(test|example|invalid|localhost))$/i;
const PATH = /^\/[^\s]*$/;
// PLA-I48-3: the same rule for code that acts on a stored user (Cómo probarla's password).
export const isTestUser = (user: string): boolean => TEST_USER.test(user);
const PAGE_KEY = /^[a-z0-9][a-z0-9-]{0,39}$/;

// PLA-I74-10: the URL a page must land on. A follow click once landed on another page and the photo was shown as the
// delivery. A path that starts with /, no query; a segment «:name» matches any one segment, a final «*» any rest.
export const LANDING = /^\/[^\s?#]*$/;
export const LANDING_HINT = "a path that starts with / (no query): :name matches one segment, a final * matches the rest";

/** The path a page's photo must be on: its url, else its path (without the query), else, with a follow that is a path,
 * anything under that prefix. A follow by CSS selector declares nothing unless url says it: null (no check). */
export function landingOf(pg: { path: string; follow?: string; url?: string }): string | null {
  if (pg.url) return pg.url;
  if (pg.follow) return pg.follow.startsWith("/") ? `${pg.follow.replace(/\*$/, "")}*` : null;
  return pg.path.split(/[?#]/)[0] || "/";
}

const trim = (p: string) => (p.length > 1 ? p.replace(/\/+$/, "") : p);
/** Whether the page the browser is on (a full URL or a path) is the declared one. */
export function landsOn(pattern: string, at: string): boolean {
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(at, "http://x").pathname);
  } catch {
    return false;
  }
  const star = pattern.endsWith("*");
  const want = trim(star ? pattern.slice(0, -1) : pattern).split("/");
  const got = trim(pathname).split("/");
  if (star) {
    // «/panel/novias/*» is /panel/novias/<anything>; a final «/» before * still needs something after it.
    const open = pattern.endsWith("/*");
    if (got.length < want.length + (open ? 1 : 0)) return false;
    return want.every((seg, i) => (seg.startsWith(":") ? !!got[i] : i === want.length - 1 && !open ? got[i]!.startsWith(seg) : seg === got[i]));
  }
  return got.length === want.length && want.every((seg, i) => (seg.startsWith(":") ? !!got[i] : seg === got[i]));
}

const page = z
  .object({
    // Stable id of the page across runs (the latest read groups by it). Lowercase, digits and dashes.
    key: z.string().regex(PAGE_KEY, "lowercase letters, digits and dashes"),
    path: z.string().regex(PATH, "a path that starts with /").max(300),
    label: z.string().trim().min(1).max(60), // Spanish, shown on the floor
    session: z.boolean().optional(), // behind the login: log in with the test user first
    // Open path, then go to the href of the first element matching this CSS selector (e.g. the first ficha in a list).
    follow: z.string().min(1).max(200).optional(),
    full_page: z.boolean().optional(), // the whole scroll height instead of the first screen
    // PLA-I74-10: the path the photo must be taken on (landingOf has the default).
    url: z.string().regex(LANDING, LANDING_HINT).max(300).optional(),
  })
  .strict();

const session = z
  .object({
    login_path: z.string().regex(PATH).max(300),
    user: z.string().max(120).regex(TEST_USER, "a test address on a reserved domain (example.com, .test), never a real account"),
    // The login form's input names.
    user_field: z.string().min(1).max(60),
    password_field: z.string().min(1).max(60),
    // Run in the checkout before logging in; {user} is replaced. Plania writes a fresh random password
    // to its stdin twice (new + repeat), so no password is kept in Plania or in the repo.
    password_command: z.string().min(1).max(300),
    // After submitting, the page must reach a path starting with this (default: anything but login_path).
    after_login_prefix: z.string().regex(PATH).max(300).optional(),
  })
  .strict();

export const captureSettingsSchema = z
  .object({
    // How the test copy starts on the machine (Encenderla, src/captures/prueba.ts). {port} is replaced; the port
    // is the first free one from this one up, so two floors and a runner's dev server never clash.
    start_command: z.string().min(1).max(300),
    port: z.number().int().min(1024).max(65535),
    // PLA-I46-8: run once in the test copy when its dependencies are missing or the lockfile changed.
    // Default: npm ci / pnpm install --frozen-lockfile / yarn install --frozen-lockfile, from the lockfile there.
    install_command: z.string().min(1).max(300).optional(),
    // The path that answers once the app is up (default /).
    ready_path: z.string().regex(PATH).max(300).optional(),
    pages: z.array(page).min(1).max(12),
    session: session.optional(),
    // PLA-I52-1: the repo paths that count as touching the screen (a delivery there needs a muestra).
    // Default: src/captures/muestra.ts DEFAULT_UI_GLOBS. ** spans folders, * stays inside one.
    ui_globs: z.array(z.string().min(1).max(120)).min(1).max(30).optional(),
    // PLA-75: a delivery whose branch changes the database runs on its own copy of the app's database with the
    // branch's migrations applied (<db>_entrega), never on the app's own database. env_var names the URL in the app's
    // env file; migrate_command runs in the delivery's copy with that variable pointing at the copy.
    database: z
      .object({
        env_var: z.string().regex(/^[A-Z_][A-Z0-9_]*$/).max(60).default("DATABASE_URL"),
        migrate_command: z.string().min(1).max(300),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((s, ctx) => {
    const keys = new Set<string>();
    s.pages.forEach((p, i) => {
      if (keys.has(p.key)) ctx.addIssue({ code: "custom", path: ["pages", i, "key"], message: "duplicate page key" });
      keys.add(p.key);
      if (p.session && !s.session) ctx.addIssue({ code: "custom", path: ["pages", i, "session"], message: "a page behind a session needs settings.capture.session" });
    });
  });

export type CaptureSettings = z.infer<typeof captureSettingsSchema>;
export type CapturePage = CaptureSettings["pages"][number];

// Returns the parsed settings or a message naming the first bad field.
export function parseCaptureSettings(v: unknown): { ok: true; settings: CaptureSettings } | { ok: false; field: string; hint: string } {
  const r = captureSettingsSchema.safeParse(v);
  if (r.success) return { ok: true, settings: r.data };
  const issue = r.error.issues[0]!;
  return { ok: false, field: ["settings", "capture", ...issue.path].join("."), hint: issue.message };
}

export function baseUrl(s: Pick<CaptureSettings, "port">): string {
  return `http://localhost:${s.port}`;
}
