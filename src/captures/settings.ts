// PLA-I46-6: how Plania reaches a project's running app to take stills of it. Stored in Plania
// (projects.settings.capture), never in the app repo. Secrets never: the test user's password is
// not stored anywhere; session.password_command sets a fresh one on the seed's test user for each run.
import { z } from "zod";

// The two widths every page is taken at (Jorge, 13 Nov 2026): desktop 1280, phone 390.
export const VIEWPORTS = {
  desktop: { width: 1280, height: 800, mobile: false, scale: 1 },
  phone: { width: 390, height: 844, mobile: true, scale: 2 },
} as const;
export type ViewportName = keyof typeof VIEWPORTS;
export const VIEWPORT_NAMES = Object.keys(VIEWPORTS) as ViewportName[];

// A test account only: a reserved test domain (RFC 2606 / 6761), so a real person's address never fits.
const TEST_USER = /^[a-z0-9._%+-]+@([a-z0-9-]+\.)*(example\.(com|org|net)|[a-z0-9-]+\.(test|example|invalid|localhost))$/i;
const PATH = /^\/[^\s]*$/;
const PAGE_KEY = /^[a-z0-9][a-z0-9-]{0,39}$/;

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
    // How the test copy starts on the Mac (Encenderla, a later ticket). {port} is replaced.
    start_command: z.string().min(1).max(300),
    port: z.number().int().min(1024).max(65535),
    // The path that answers once the app is up (default /).
    ready_path: z.string().regex(PATH).max(300).optional(),
    pages: z.array(page).min(1).max(12),
    session: session.optional(),
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
