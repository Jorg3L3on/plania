// PLA-I52-1: la muestra. What Taller hands over with a delivery so Plania can show it to the owner (El Probador,
// PLA-IDEA18): one sentence for the owner, the views the change touched (path and state) and three steps to try it.
// A delivery whose diff touches the screen, on a project Plania can photograph (settings.capture), cannot finish
// without one: MUESTRA_REQUIRED. Nobody is asked to approve what they cannot see.
import { z } from "zod";
import type { GitFn } from "../runner/worktree.js";

const PATH = /^\/[^\s]*$/;
const KEY = /^[a-z0-9][a-z0-9-]{0,39}$/;

// One thing to do on the page before the still, so a state (a form open, a row switched off) can be shown.
const accion = z.union([
  z.object({ click: z.string().trim().min(1).max(80) }).strict(), // the visible text of what to click
  z.object({ fill: z.string().min(1).max(200), value: z.string().max(200) }).strict(), // a CSS selector and its value
]);

const vista = z
  .object({
    key: z.string().regex(KEY, "lowercase letters, digits and dashes"),
    label: z.string().trim().min(1).max(60), // Spanish, shown on the card
    path: z.string().regex(PATH, "a path that starts with /").max(300),
    estado: z.string().trim().min(1).max(80).optional(), // the state shown, in words: «con una sucursal apagada»
    session: z.boolean().optional(), // behind the test user's login
    follow: z.string().min(1).max(200).optional(), // as in settings.capture.pages: go to the first matching href
    acciones: z.array(accion).max(6).optional(),
  })
  .strict();

export const muestraSchema = z
  .object({
    frase: z.string().trim().min(1).max(160), // what changes for the people who use the app, in one sentence
    vistas: z.array(vista).min(1).max(6),
    pasos: z.array(z.string().trim().min(1).max(140)).length(3), // three ways to try it, in plain words
  })
  .strict()
  .superRefine((m, ctx) => {
    const keys = new Set<string>();
    m.vistas.forEach((v, i) => {
      if (keys.has(v.key)) ctx.addIssue({ code: "custom", path: ["vistas", i, "key"], message: "duplicate view key" });
      keys.add(v.key);
    });
  });

export type Muestra = z.infer<typeof muestraSchema>;
export type MuestraVista = Muestra["vistas"][number];

// What counts as touching the screen when settings.capture.ui_globs does not say. Tests never count.
export const DEFAULT_UI_GLOBS = ["src/app/**", "src/components/**", "src/pages/**", "app/**", "components/**", "pages/**", "ui/src/**", "**/*.css", "**/*.tsx", "**/*.jsx", "**/*.vue", "**/*.svelte"];
const NOT_UI = [/(^|\/)(test|tests|__tests__|e2e)\//, /\.(test|spec)\.[cm]?[jt]sx?$/, /\.stories\.[jt]sx?$/];

// ** spans folders, * stays inside one segment.
export function globToRegex(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === "*" && glob[i + 1] === "*") {
      re += glob[i + 2] === "/" ? "(?:.*/)?" : ".*";
      i += glob[i + 2] === "/" ? 2 : 1;
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

export function uiFiles(files: string[], globs: readonly string[] = DEFAULT_UI_GLOBS): string[] {
  const res = globs.map(globToRegex);
  return files.filter((f) => !NOT_UI.some((n) => n.test(f)) && res.some((r) => r.test(f)));
}

// The files a branch changes against its base, read from the project's repo on this Mac. It fetches both first
// (best effort) and reads origin's refs, falling back to local ones. null when it cannot tell.
export async function changedFiles(git: GitFn, repo: string, base: string, branch: string): Promise<string[] | null> {
  await git(["fetch", "--quiet", "origin", base, branch], repo).catch(() => null);
  for (const [b, h] of [
    [`origin/${base}`, `origin/${branch}`],
    [base, branch],
    [`origin/${base}`, branch],
  ] as const) {
    const r = await git(["diff", "--name-only", `${b}...${h}`], repo).catch(() => null);
    if (r && r.code === 0) return r.stdout.split("\n").map((l) => l.trim()).filter(Boolean);
  }
  return null;
}

// PLA-I52-7: the kind of change, from the files it touches. se_ve: the screen; se_comporta: what the app does with
// no screen of its own (mail, exports, jobs); no_se_ve: everything else (data, refactors, dependencies).
export type Cambio = "se_ve" | "se_comporta" | "no_se_ve";
const BEHAVIOR = /(^|[/._-])(mail|mailer|email|correo|aviso|notif|export|exportar|excel|xlsx|csv|pdf|webhook|cron|job|jobs|sms|whatsapp)([/._-]|s?\.|$)/i;
export function cambioOf(files: string[], globs: readonly string[] = DEFAULT_UI_GLOBS): Cambio {
  if (uiFiles(files, globs).length) return "se_ve";
  if (files.some((f) => !NOT_UI.some((n) => n.test(f)) && BEHAVIOR.test(f))) return "se_comporta";
  return "no_se_ve";
}

export function parseMuestra(v: unknown): { ok: true; muestra: Muestra } | { ok: false; field: string; hint: string } {
  const r = muestraSchema.safeParse(v);
  if (r.success) return { ok: true, muestra: r.data };
  const issue = r.error.issues[0]!;
  return { ok: false, field: ["muestra", ...issue.path].join("."), hint: issue.message };
}

export const MUESTRA_HINT =
  "this delivery changes the screen: pass muestra {frase (one sentence for the owner), vistas [{key, label, path, estado?, session?, acciones?}] (the views it touched), pasos [three ways to try it]} so Plania can photograph it before asking the owner";
