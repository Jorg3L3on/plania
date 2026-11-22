// PLA-I52-1: la muestra. What Taller hands over with a delivery so Plania can show it to the owner (El Probador,
// PLA-IDEA18): one sentence for the owner, the views the change touched (path and state) and three steps to try it.
// A delivery whose diff touches the screen, on a project Plania can photograph (settings.capture), cannot finish
// without one: MUESTRA_REQUIRED. Nobody is asked to approve what they cannot see.
import { z } from "zod";
import type { GitFn } from "../runner/worktree.js";
import { LANDING, LANDING_HINT } from "./settings.js";

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
    // PLA-I74-10: the path the photo must be on (default: path; with a follow path, anything under it). A photo taken
    // on another URL is marked wrong and holds «Aceptar» back.
    url: z.string().regex(LANDING, LANDING_HINT).max(300).optional(),
  })
  .strict();

export const muestraSchema = z
  .object({
    frase: z.string().trim().min(1).max(160), // what changes for the people who use the app, in one sentence
    vistas: z.array(vista).min(1).max(6),
    pasos: z.array(z.string().trim().min(1).max(140)).length(3), // three ways to try it, in plain words
    // PLA-78: the fake rows the views need (an appointment today, a client with a stage…), as SQL. Plania loads them
    // into both throwaway copies' databases (<db>_entrega and <db>_prueba, never the app's own) in one transaction
    // before the pictures, so the card shows the feature with data instead of its empty state. Times relative to
    // now() keep «today» true whenever the pictures are taken.
    datos: z.string().trim().min(1).max(20_000).optional(),
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

// The files a branch changes against its base, read from the project's repo on this machine. It fetches both first
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

// PLA-158 (F-28): a selector the browser cannot read (Playwright's a:has-text("Ana")) was only found when the views
// were photographed, 21 minutes later. Node has no DOM to parse CSS, so this is a conservative check: it refuses the
// Playwright and jQuery forms document.querySelector never accepts, and brackets or quotes left open. A path (follow
// "/panel/x/") and a click by visible text stay allowed; in text mode a quote counts only inside [ ].
const NOT_CSS: [RegExp, string][] = [
  [/:has-text\(/i, ":has-text( is Playwright's, not CSS"],
  [/:text(-is|-matches)?\(/i, ":text( is Playwright's, not CSS"],
  [/:contains\(/i, ":contains( is jQuery's, not CSS"],
  [/:visible\b/i, ":visible is Playwright's or jQuery's, not CSS"],
  [/:nth-match\(/i, ":nth-match( is Playwright's, not CSS"],
  [/>>/, ">> chains Playwright locators, not CSS"],
  [/^\s*(text|xpath|css|id|data-testid|role)=/i, "a Playwright engine prefix (text=, xpath=…) is not CSS"],
];

export function selectorProblem(value: string, mode: "selector" | "text"): string | null {
  for (const [re, why] of NOT_CSS) if (re.test(value)) return why;
  const stack: string[] = [];
  let quote: string | null = null;
  for (let i = 0; i < value.length; i++) {
    const c = value[i]!;
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === "\\") i++;
    else if ((c === '"' || c === "'") && (mode === "selector" || stack.at(-1) === "[")) quote = c;
    else if (c === "[" || c === "(") stack.push(c);
    else if (c === "]" || c === ")") {
      if (stack.pop() !== (c === "]" ? "[" : "(")) return `an unmatched ${c}`;
    }
  }
  if (quote) return `a quote ${quote} left open`;
  if (stack.length) return `a ${stack.at(-1)} left open`;
  return null;
}

/** The first follow, click or fill in the muestra that document.querySelector could not read, with why. */
export function muestraSelectorIssue(m: Muestra): { field: string; value: string; hint: string } | null {
  for (const [i, v] of m.vistas.entries()) {
    if (v.follow && !v.follow.startsWith("/")) {
      const why = selectorProblem(v.follow, "selector");
      if (why) return { field: `muestra.vistas.${i}.follow`, value: v.follow, hint: `${why}: follow takes a path that starts with / (the link's href prefix) or a plain CSS selector` };
    }
    for (const [j, a] of (v.acciones ?? []).entries()) {
      const [what, value, mode] = "click" in a ? (["click", a.click, "text"] as const) : (["fill", a.fill, "selector"] as const);
      const why = selectorProblem(value, mode);
      if (why) return { field: `muestra.vistas.${i}.acciones.${j}.${what}`, value, hint: `${why}: ${what === "click" ? "click takes the visible text of what to click or a plain CSS selector" : "fill takes a plain CSS selector"}` };
    }
  }
  return null;
}

export const MUESTRA_HINT =
  "this delivery changes the screen: pass muestra {frase (one sentence for the owner), vistas [{key, label, path, estado?, session?, acciones?}] (the views it touched), pasos [three ways to try it], datos? (SQL with the fake rows the views need)} so Plania can photograph it before asking the owner";
