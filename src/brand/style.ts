// PLA-I69-4: the project's visual identity, kept in Plania and brought to the repo by a request to Taller. The owner
// picks it the easy way (a direction, one colour, a font from a list, named options) and an expert sees every value
// and its code. Kept next to the logo in <captures dir>/_marca/<project>/style.json with every version (nothing is
// lost: going back makes a new version). The repo's own style is read from its CSS and layout, never guessed: what
// is not found is left out. Colours of an older logo written by hand in the code are listed for Taller to replace.
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { and, eq, ilike, notInArray } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { projectLogos, projects, tasks, type Project } from "../db/schema.js";
import { capturesDir } from "../captures/store.js";
import { createTask } from "../mcp/writes.js";
import { serviceAgent } from "../runner/events.js";
import { webCtx } from "../mcp/tx.js";
import { bus } from "../events.js";
import { say } from "../words.js";
import { HEX, contrast, distance, oklchCss, onColor, scale, toLch, fromLch } from "./color.js";
import { listTree, readBlob, realGit, type Git, type LogoDeps } from "./logos.js";
import { repoPathOf } from "../runner/worktree.js";
import { startBranchOf } from "../runner/start-branch.js";
import { startCommit } from "./logos.js";
import { LogoError } from "./upload.js";
import { TERMINAL } from "../mcp/lifecycle.js";
// A request that is over: accepted, released, done or dropped.
const CLOSED = ["Merged", "Released", ...TERMINAL] as const;
import { STYLE_WORDS } from "./words.js";

export type Neutral = "frio" | "neutro" | "calido";
export type Style = {
  brand: string; brandTie: "sigue" | "fijo"; accent: string; neutral: Neutral;
  head: string; body: string; mono: string; base: number; ratio: number; wHead: number; lh: number;
  radius: number; pill: boolean; shadow: "plana" | "suave" | "marcada"; border: 0 | 1 | 2; density: "compacto" | "comodo" | "amplio";
  lib: string; stroke: number; fill: boolean; motion: "ninguno" | "calmo" | "normal" | "vivo";
  img: "linea" | "plano" | "degradado"; people: boolean; imgBrand: boolean;
};
type StyleFile = { current: number; versions: { v: number; at: string; style: Style }[] };

/** The fonts the screen offers: open licences (OFL), with ñ, accents and ¿¡. Any other name can still be typed. */
export const FONTS = ["Geist", "Inter", "DM Sans", "Manrope", "Plus Jakarta Sans", "Nunito Sans", "IBM Plex Sans", "Atkinson Hyperlegible", "Outfit", "Sora", "Space Grotesk", "Bricolage Grotesque", "Nunito", "Fraunces", "Playfair Display", "Lora", "Source Serif 4", "Instrument Serif", "JetBrains Mono"];
const SYSTEM = "system-ui";

const fileOf = (slug: string) => {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) throw new Error(`bad project slug ${slug}`);
  return path.join(capturesDir(), "_marca", slug, "style.json");
};
function load(slug: string): StyleFile | null {
  const f = fileOf(slug);
  if (!existsSync(f)) return null;
  try {
    const j = JSON.parse(readFileSync(f, "utf8")) as StyleFile;
    return Array.isArray(j.versions) && j.versions.length ? j : null;
  } catch {
    return null;
  }
}
function save(slug: string, s: StyleFile): void {
  const f = fileOf(slug);
  mkdirSync(path.dirname(f), { recursive: true });
  const tmp = `${f}.${randomUUID()}.tmp`;
  writeFileSync(tmp, JSON.stringify(s, null, 2));
  renameSync(tmp, f);
}
export const styleOf = (slug: string): Style | null => {
  const f = load(slug);
  return f?.versions.find((v) => v.v === f.current)?.style ?? null;
};
export const styleVersions = (slug: string): { v: number; at: string; current: boolean }[] => {
  const f = load(slug);
  return (f?.versions ?? []).map((v) => ({ v: v.v, at: v.at, current: v.v === f!.current })).reverse();
};

// ---------- what a sound style is ----------
const clamp = (n: unknown, lo: number, hi: number, d: number) => (typeof n === "number" && Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d);
const pick = <T extends string>(v: unknown, opts: readonly T[], d: T): T => (opts.includes(v as T) ? (v as T) : d);
const font = (v: unknown, d: string) => (typeof v === "string" && /^[A-Za-z0-9 -]{2,40}$/.test(v.trim()) ? v.trim() : d);
const color = (v: unknown, d: string) => (typeof v === "string" && HEX.test(v.trim()) ? v.trim().toLowerCase() : d);
/** A style made whole and safe from anything the screen sends: unknown keys dropped, every value bounded. */
export function sound(input: Partial<Style>, base: Style): Style {
  return {
    brand: color(input.brand, base.brand),
    brandTie: pick(input.brandTie, ["sigue", "fijo"] as const, base.brandTie),
    accent: color(input.accent, base.accent),
    neutral: pick(input.neutral, ["frio", "neutro", "calido"] as const, base.neutral),
    head: font(input.head, base.head),
    body: font(input.body, base.body),
    mono: font(input.mono, base.mono),
    base: clamp(input.base, 12, 22, base.base),
    ratio: clamp(input.ratio, 1.05, 1.6, base.ratio),
    wHead: clamp(input.wHead, 300, 900, base.wHead),
    lh: clamp(input.lh, 1.1, 2, base.lh),
    radius: clamp(input.radius, 0, 48, base.radius),
    pill: typeof input.pill === "boolean" ? input.pill : base.pill,
    shadow: pick(input.shadow, ["plana", "suave", "marcada"] as const, base.shadow),
    border: pick(String(input.border ?? base.border), ["0", "1", "2"] as const, String(base.border) as "0" | "1" | "2") === "0" ? 0 : String(input.border ?? base.border) === "2" ? 2 : 1,
    density: pick(input.density, ["compacto", "comodo", "amplio"] as const, base.density),
    lib: pick(input.lib, ["Lucide", "Phosphor", "Tabler", "Heroicons", "Material Symbols"] as const, base.lib as "Lucide"),
    stroke: clamp(input.stroke, 1, 3, base.stroke),
    fill: typeof input.fill === "boolean" ? input.fill : base.fill,
    motion: pick(input.motion, ["ninguno", "calmo", "normal", "vivo"] as const, base.motion),
    img: pick(input.img, ["linea", "plano", "degradado"] as const, base.img),
    people: typeof input.people === "boolean" ? input.people : base.people,
    imgBrand: typeof input.imgBrand === "boolean" ? input.imgBrand : base.imgBrand,
  };
}

// ---------- the repo's style, as it is ----------
export type RepoStyle = { brand?: string; accent?: string; head?: string; body?: string; radius?: number; theme?: string; dark?: boolean; shadcn?: boolean; files: string[] };
const TEXT = /\.(css|scss|tsx|ts|jsx|js|mjs|html|vue|svelte)$/;
const SKIP = /(^|\/)(node_modules|dist|build|\.next|out|coverage|public|vendor|\.git)\//;
const cssValue = (v: string): string | undefined => {
  const t = v.trim().replace(/\s*!important$/, "");
  if (HEX.test(t)) return t.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(t)) return `#${t[1]}${t[1]}${t[2]}${t[2]}${t[3]}${t[3]}`.toLowerCase();
  return oklchCss(t) ?? undefined;
};
/** What the repo says about its own style: brand and accent variables, radius, the fonts its layout loads. */
export async function readRepoStyle(view: { paths: Map<string, number>; read: (p: string) => Promise<Buffer | null> }, root: string): Promise<RepoStyle> {
  const out: RepoStyle = { files: [] };
  const css = [...view.paths.keys()].filter((p) => p.startsWith(root) && p.endsWith(".css") && !SKIP.test(p) && (view.paths.get(p) ?? 0) < 300_000).slice(0, 8);
  for (const p of css) {
    const t = (await view.read(p))?.toString("utf8") ?? "";
    // The first declaration that is a colour (a repo often aliases first: --color-primary: var(--primary)).
    const v = (re: RegExp) => { for (const m of t.matchAll(re)) { const c = cssValue(m[1]!); if (c) return c; } return undefined; };
    // PLA-I69-4: shadcn/ui's variables (--primary with --primary-foreground) mean other things by --accent and --muted.
    if (/--primary-foreground\s*:/.test(t)) out.shadcn = true;
    const b = v(/--(?:color-)?(?:brand|primary)\s*:\s*([^;}\n]+)/g);
    const a = out.shadcn ? undefined : v(/--(?:color-)?accent\s*:\s*([^;}\n]+)/g);
    const r = t.match(/--radius(?:-md)?\s*:\s*([\d.]+)(rem|px)/);
    if (b && !out.brand) { out.brand = b; out.files.push(p); }
    else if (out.shadcn && !out.files.includes(p)) out.files.push(p);
    if (/(^|[\s,}])\.dark\b|prefers-color-scheme:\s*dark|\[data-theme=["']?dark/.test(t)) out.dark = true;
    if (a && !out.accent) out.accent = a;
    if (r && out.radius === undefined) out.radius = Math.round(Number(r[1]) * (r[2] === "rem" ? 16 : 1));
    const f = t.match(/--font-(?:sans|body)\s*:\s*["']?([A-Za-z0-9 ]+?)["']?\s*[,;]/);
    if (f && !out.body && !/^var|system|ui-sans/i.test(f[1]!)) out.body = f[1]!.trim();
    const h = t.match(/--font-(?:heading|display)\s*:\s*["']?([A-Za-z0-9 ]+?)["']?\s*[,;]/);
    if (h && !out.head && !/^var|system/i.test(h[1]!)) out.head = h[1]!.trim();
  }
  const layout = [...view.paths.keys()].find((p) => p.startsWith(root) && /(^|\/)(src\/)?app\/layout\.(tsx|jsx|ts|js)$/.test(p));
  if (layout) {
    const t = (await view.read(layout))?.toString("utf8") ?? "";
    const m = t.match(/import\s*\{([^}]+)\}\s*from\s*["']next\/font\/google["']/);
    if (m) {
      const names = m[1]!.split(",").map((x) => x.trim().split(/\s+as\s+/)[0]!.replace(/_/g, " ")).filter(Boolean);
      if (names[0] && !out.body) out.body = names[0];
      if (names[1] && !out.head) out.head = names[1];
      out.files.push(layout);
    }
  }
  return out;
}

/** Colours of an older logo (or the repo's old brand) written by hand in the code, file by file. */
export const oldTargets = (old: string[], keep: string): string[] => [...new Set(old.filter((c) => HEX.test(c) && distance(c, keep) > 0.06).map((c) => c.toLowerCase()))].sort();
/** The same, in one `git grep` over the commit (a real repo: one process instead of one per file). */
export async function oldColorsGrep(git: Git, repo: string, sha: string, root: string, targets: string[]): Promise<{ path: string; n: number; colors: string[] }[]> {
  if (!targets.length) return [];
  const r = await git(repo, ["grep", "-I", "-i", "-o", "-F", ...targets.flatMap((c) => ["-e", c]), sha, "--", root || "."]);
  const by = new Map<string, { n: number; colors: Set<string> }>();
  for (const line of r.stdout.toString("utf8").split("\n")) {
    const m = line.match(/^[0-9a-f]{40}:(.+):(#[0-9a-fA-F]{6})$/);
    if (!m || !TEXT.test(m[1]!) || SKIP.test(m[1]!) || /brand\.css$|tokens\.json$/.test(m[1]!)) continue;
    const e = by.get(m[1]!) ?? { n: 0, colors: new Set<string>() };
    e.n++;
    e.colors.add(m[2]!.toLowerCase());
    by.set(m[1]!, e);
  }
  return [...by].map(([path, e]) => ({ path, n: e.n, colors: [...e.colors] })).sort((a, b) => b.n - a.n).slice(0, 30);
}
export async function oldColors(view: { paths: Map<string, number>; read: (p: string) => Promise<Buffer | null> }, root: string, old: string[], keep: string): Promise<{ path: string; n: number; colors: string[] }[]> {
  const targets = oldTargets(old, keep);
  if (!targets.length) return [];
  const out: { path: string; n: number; colors: string[] }[] = [];
  let scanned = 0;
  for (const [p, size] of view.paths) {
    if (!p.startsWith(root) || !TEXT.test(p) || SKIP.test(p) || size > 300_000 || /brand\.css$|tokens\.json$/.test(p)) continue;
    if (++scanned > 600) break;
    const t = (await view.read(p))?.toString("utf8").toLowerCase() ?? "";
    let n = 0;
    const seen: string[] = [];
    for (const c of targets) {
      const k = t.split(c).length - 1;
      if (k) { n += k; seen.push(c); }
    }
    if (n) out.push({ path: p, n, colors: seen });
  }
  return out.sort((a, b) => b.n - a.n).slice(0, 30);
}

// ---------- derived values ----------
export type Tokens = { light: Record<string, string>; dark: Record<string, string>; scale: string[]; chart: string[]; sizes: { base: number; h1: number; h2: number; h3: number; small: number }; radius: number; button: number; spacing: string; duration: number; ease: string; shadow: string };
export function tokens(s: Style): Tokens {
  const sc = scale(s.brand);
  const [, , bh] = toLch(s.brand);
  const nh = s.neutral === "frio" ? 255 : s.neutral === "calido" ? 65 : bh;
  const nc = s.neutral === "neutro" ? 0.004 : 0.013;
  const N = (L: number) => fromLch(L, nc, nh);
  const darkBg = N(0.17);
  const darkBrand = contrast(s.brand, darkBg) >= 3 ? s.brand : sc[3]!;
  // A field's border must reach 3:1 against its surface (WCAG 1.4.11); a hover is a step darker (lighter on dark).
  const [bL, bC] = toLch(s.brand);
  const [dL, dC, dH] = toLch(darkBrand);
  const light = { background: N(0.985), card: "#ffffff", foreground: N(0.21), muted: N(0.5), border: N(0.91), input: N(0.6), brand: s.brand, "brand-hover": fromLch(Math.max(0.15, bL - 0.07), bC, bh), "on-brand": onColor(s.brand), tint: sc[1]!, "on-tint": sc[8]!, accent: s.accent, "on-accent": onColor(s.accent), success: "#15803d", warning: "#b45309", danger: "#b91c1c" };
  const dark = { background: darkBg, card: N(0.215), foreground: N(0.96), muted: N(0.72), border: N(0.3), input: N(0.52), brand: darkBrand, "brand-hover": fromLch(Math.min(0.95, dL + 0.07), dC, dH), "on-brand": onColor(darkBrand), tint: sc[9]!, "on-tint": sc[1]!, accent: s.accent, "on-accent": onColor(s.accent), success: "#4ade80", warning: "#fbbf24", danger: "#f87171" };
  const chart = [0, 1, 2, 3, 4].map((i) => fromLch([0.52, 0.72, 0.62, 0.82, 0.45][i]!, 0.13, (bh + i * 72) % 360));
  const sizes = { base: s.base, h1: Math.round(s.base * s.ratio ** 3), h2: Math.round(s.base * s.ratio ** 2), h3: Math.round(s.base * s.ratio), small: Math.round(s.base / s.ratio) };
  const duration = { ninguno: 0, calmo: 320, normal: 200, vivo: 140 }[s.motion];
  return {
    light, dark, scale: sc, chart, sizes, radius: s.radius, button: s.pill ? 999 : s.radius,
    spacing: s.density === "compacto" ? "0.22rem" : s.density === "amplio" ? "0.3rem" : "0.25rem",
    duration, ease: s.motion === "vivo" ? "cubic-bezier(.34,1.56,.64,1)" : "cubic-bezier(.2,.8,.2,1)",
    shadow: s.shadow === "plana" ? "none" : s.shadow === "marcada" ? "0 8px 24px rgb(0 0 0 / .18)" : "0 1px 2px rgb(0 0 0 / .06), 0 4px 12px rgb(0 0 0 / .07)",
  };
}
const STEP = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
/** How the repo wires its CSS: next/font gives each family a variable (the family name itself is hashed), and
 * shadcn/ui owns --primary, --accent and --muted with its own meanings. */
export type CssOpts = { next?: boolean; shadcn?: boolean };
export const fontVar = (f: string) => `--font-${f.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
/** brand.css: Tailwind 4 @theme for the utilities, and the same values as variables for light and dark. */
export function brandCss(s: Style, o: CssOpts = {}): string {
  const t = tokens(s);
  const ff = (f: string) => (f === SYSTEM ? "system-ui" : o.next ? `var(${fontVar(f)})` : `"${f}"`);
  const vars = (x: Record<string, string>) => Object.entries(x).map(([k, v]) => `  --${k}: ${v};`).join("\n");
  const side = (x: Record<string, string>): Record<string, string> =>
    o.shadcn
      ? {
          primary: x.brand!, "primary-hover": x["brand-hover"]!, "primary-foreground": x["on-brand"]!, ring: x.brand!, accent: x.tint!, "accent-foreground": x["on-tint"]!,
          background: x.background!, foreground: x.foreground!, card: x.card!, "card-foreground": x.foreground!, popover: x.card!, "popover-foreground": x.foreground!,
          border: x.border!, input: x.input!, "muted-foreground": x.muted!, destructive: x.danger!,
          "sidebar-primary": x.brand!, "sidebar-primary-foreground": x["on-brand"]!, "sidebar-ring": x.brand!, "sidebar-accent": x.tint!, "sidebar-accent-foreground": x["on-tint"]!,
          brand: x.brand!, "brand-accent": x.accent!, "on-brand-accent": x["on-accent"]!, success: x.success!, warning: x.warning!,
        }
      : x;
  return `/* The brand's style, kept by Plania (Marca → Estilo). Change it there; this file is remade from it. */
@theme {
${t.scale.map((c, i) => `  --color-brand-${STEP[i]}: ${c};`).join("\n")}
  --color-brand: var(--brand);
  --color-${o.shadcn ? "brand-accent: var(--brand-accent)" : "accent: var(--accent)"};
${t.chart.map((c, i) => `  --color-chart-${i + 1}: ${c};`).join("\n")}
  --font-heading: ${ff(s.head)}, ui-sans-serif, system-ui, sans-serif;
  --font-sans: ${ff(s.body)}, ui-sans-serif, system-ui, sans-serif;
  --font-mono: ${ff(s.mono)}, ui-monospace, monospace;
  --text-base: ${s.base / 16}rem;
  --radius-md: ${t.radius}px;
  --spacing: ${t.spacing};
  --ease-brand: ${t.ease};
  --default-transition-duration: ${t.duration}ms;
}

:root {
${vars(side(t.light))}
  --radius: ${t.radius}px;
  --radius-button: ${t.button}px;
  --shadow-card: ${t.shadow};
  --heading-weight: ${s.wHead};
  --line-height: ${s.lh};
  --icon-stroke: ${s.stroke};
}

.dark {
${vars(side(t.dark))}
}

svg.lucide { stroke-width: var(--icon-stroke); }

@layer base {
  h1, h2, h3, h4 { font-family: var(--font-heading); font-weight: var(--heading-weight); }
}

@media (prefers-reduced-motion: reduce) {
  * { animation: none !important; transition: none !important; }
}
`;
}
/** The same values in the W3C design-token format (2025.10). */
export function tokensJson(s: Style): string {
  const t = tokens(s);
  const c = (v: string) => ({ $type: "color", $value: v });
  return `${JSON.stringify(
    {
      color: { brand: c(s.brand), accent: c(s.accent), ...Object.fromEntries(t.scale.map((v, i) => [`brand-${[50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950][i]}`, c(v)])), light: Object.fromEntries(Object.entries(t.light).map(([k, v]) => [k, c(v)])), dark: Object.fromEntries(Object.entries(t.dark).map(([k, v]) => [k, c(v)])) },
      font: { heading: { $type: "fontFamily", $value: [s.head, "sans-serif"] }, body: { $type: "fontFamily", $value: [s.body, "sans-serif"] }, mono: { $type: "fontFamily", $value: [s.mono, "monospace"] } },
      dimension: { radius: { $type: "dimension", $value: { value: t.radius, unit: "px" } }, "text-base": { $type: "dimension", $value: { value: s.base, unit: "px" } } },
      duration: { base: { $type: "duration", $value: { value: t.duration, unit: "ms" } } },
    },
    null,
    2,
  )}\n`;
}

// ---------- the read for the screen ----------
export type StyleChange = { part: "color" | "letra" | "forma" | "espacio" | "iconos" | "mov"; from: string; to: string };
/** What differs from the repo (only what the repo says; an unknown value differs only when the owner set one). */
export function changesOf(s: Style, repo: RepoStyle, logo: { theme: string | null }): StyleChange[] {
  const out: StyleChange[] = [];
  const repoBrand = repo.brand ?? repo.theme;
  if (!repoBrand || distance(repoBrand, s.brand) > 0.02 || (repo.accent && distance(repo.accent, s.accent) > 0.02)) out.push({ part: "color", from: repoBrand ?? "—", to: s.brand });
  if ((repo.body ?? SYSTEM) !== s.body || (repo.head ?? repo.body ?? SYSTEM) !== s.head) out.push({ part: "letra", from: repo.head ?? repo.body ?? SYSTEM, to: s.head === s.body ? s.head : `${s.head} + ${s.body}` });
  if ((repo.radius ?? -1) !== s.radius) out.push({ part: "forma", from: repo.radius === undefined ? "—" : `${repo.radius} px`, to: `${s.radius} px` });
  void logo;
  return out;
}

const REQ = /<!-- plania:marca-estilo set=([0-9a-f]{16}) -->/;
export type StyleRead = {
  style: Style | null;
  base: Style;
  repo: RepoStyle;
  changes: StyleChange[];
  old: { path: string; n: number; colors: string[] }[];
  versions: number;
  pedido: { key: string; status: string } | null;
  framework: "next-app" | "vite" | "static";
  root: string;
  css: string;
  json: string;
  logo: { theme: string | null; colors: string[] };
  cssOpts: CssOpts;
};

/** Where the style starts before the owner touches it: the repo's values, then the logo's colours, then defaults. */
export function startStyle(repo: RepoStyle, logo: { colors: string[]; theme: string | null } | null): Style {
  const brand = repo.brand ?? logo?.theme ?? logo?.colors.find((c) => HEX.test(c)) ?? "#4f46e5";
  const accent = repo.accent ?? logo?.colors.find((c) => HEX.test(c) && distance(c, brand) > 0.1) ?? fromLch(0.8, 0.13, (toLch(brand)[2] + 180) % 360);
  return {
    brand, brandTie: repo.brand ? "fijo" : "sigue", accent, neutral: "neutro",
    head: repo.head ?? repo.body ?? SYSTEM, body: repo.body ?? SYSTEM, mono: "JetBrains Mono", base: 16, ratio: 1.2, wHead: 700, lh: 1.5,
    radius: repo.radius ?? 8, pill: false, shadow: "suave", border: 1, density: "comodo", lib: "Lucide", stroke: 2, fill: false, motion: "normal",
    img: "plano", people: false, imgBrand: true,
  };
}

type RepoView = { paths: Map<string, number>; read: (p: string) => Promise<Buffer | null> };
type Part = { sha: string | null; repo: RepoStyle; framework: StyleRead["framework"]; root: string; view: RepoView | null; path: string; git: Git };
// The repo's side, per commit: reading it again only when the start branch moves (or after a minute, to notice that).
const parts = new Map<string, { at: number; part: Part }>();
const olds = new Map<string, StyleRead["old"]>();
export const forgetStyle = (slug?: string): void => {
  if (!slug) { parts.clear(); olds.clear(); return; }
  parts.delete(slug);
  for (const k of olds.keys()) if (k.startsWith(`${slug}|`)) olds.delete(k);
};
async function partOf(p: Project, deps: LogoDeps, hasOriginal: boolean): Promise<Part> {
  const now = (deps.now ?? Date.now)();
  const had = parts.get(p.slug);
  if (had && now - had.at < 60_000 && !deps.fresh) return had.part;
  const git = deps.git ?? realGit;
  const path_ = repoPathOf(p.slug, p.settings, deps.env);
  const c = await startCommit(git, path_, startBranchOf(p.settings)).catch(() => null);
  if (had && c && had.part.sha === c.sha && !deps.fresh) {
    had.at = now;
    return had.part;
  }
  let part: Part = { sha: null, repo: { files: [] }, framework: "static", root: "", view: null, path: path_, git };
  if (c) {
    const tree = await listTree(git, path_, c.sha);
    const view: RepoView = { paths: tree, read: (f) => readBlob(git, path_, c.sha, f) };
    const { checkRepo } = await import("./check.js");
    const ck = await checkRepo(view, { hasOriginal, slug: p.slug });
    const repo = await readRepoStyle(view, ck.root);
    const man = ck.rows.find((r) => r.id === "man")?.checks.find((x) => x.k === "man_colors")?.v?.theme;
    if (typeof man === "string" && HEX.test(man)) repo.theme = man.toLowerCase();
    part = { sha: c.sha, repo, framework: ck.framework, root: ck.root, view, path: path_, git };
  }
  parts.set(p.slug, { at: now, part });
  return part;
}
async function repoView(p: Project, deps: LogoDeps): Promise<RepoView | null> {
  return (await partOf(p, deps, false)).view;
}

export async function styleRead(db: Db, slug: string, deps: LogoDeps = {}): Promise<StyleRead | null> {
  const [p] = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
  if (!p) return null;
  const logos = await db.select().from(projectLogos).where(eq(projectLogos.projectId, p.id));
  const active = logos.find((l) => l.active) ?? null;
  const { logoTheme } = await import("./theme.js");
  const theme = logoTheme(active);
  const current = styleOf(slug);
  const part = await partOf(p, deps, !!active);
  const repo = part.repo;
  const keep = current?.brand ?? theme ?? repo.brand ?? "#000000";
  const targets = current ? oldTargets([...logos.filter((l) => !l.active).flatMap((l) => l.colors), ...(repo.brand && distance(repo.brand, current.brand) > 0.06 ? [repo.brand] : [])], keep) : [];
  const okey = `${slug}|${part.sha}|${targets.join(",")}`;
  let old = olds.get(okey);
  if (!old) {
    old = !part.view || !part.sha || !targets.length ? [] : deps.git ? await oldColors(part.view, part.root, targets, keep) : await oldColorsGrep(part.git, part.path, part.sha, part.root, targets);
    olds.set(okey, old);
  }
  const c = { read: { repo, old, framework: part.framework, root: part.root } };
  const base = current ?? startStyle(c.read.repo, active ? { colors: active.colors, theme } : null);
  const cssOpts: CssOpts = { next: c.read.framework === "next-app", shadcn: !!c.read.repo.shadcn };
  // A brand that follows the logo takes the logo's colour as it changes.
  const eff = base.brandTie === "sigue" && theme ? { ...base, brand: theme } : base;
  const [open] = await db
    .select({ key: tasks.key, status: tasks.status })
    .from(tasks)
    .where(and(eq(tasks.projectId, p.id), ilike(tasks.scope, "%<!-- plania:marca-estilo set=%"), notInArray(tasks.status, [...CLOSED])))
    .limit(1);
  return {
    style: current,
    base: eff,
    ...c.read,
    changes: current ? changesOf(eff, c.read.repo, { theme }) : [],
    versions: load(slug)?.versions.length ?? 0,
    pedido: open ?? null,
    css: brandCss(eff, cssOpts),
    json: tokensJson(eff),
    logo: { theme, colors: active?.colors ?? [] },
    cssOpts,
  };
}

/** The owner's change: a new version, made whole and safe. */
export async function saveStyle(db: Db, slug: string, patch: Partial<Style>): Promise<StyleRead | null> {
  const r = await styleRead(db, slug);
  if (!r) return null;
  const next = sound(patch, r.base);
  const f = load(slug) ?? { current: 0, versions: [] };
  const last = f.versions.find((v) => v.v === f.current)?.style;
  if (last && JSON.stringify(last) === JSON.stringify(next)) return r;
  const v = Math.max(0, ...f.versions.map((x) => x.v)) + 1;
  f.versions.push({ v, at: new Date().toISOString(), style: next });
  if (f.versions.length > 60) f.versions = f.versions.slice(-60);
  f.current = v;
  save(slug, f);
  bus.publish({ type: "project", project: slug });
  return styleRead(db, slug);
}

/** Back to an earlier version: it becomes a new one (nothing is lost). */
export async function goBackStyle(db: Db, slug: string, v: number): Promise<StyleRead | null> {
  const f = load(slug);
  const old = f?.versions.find((x) => x.v === v)?.style;
  if (!f || !old) throw new LogoError("LOGO_NOT_FOUND", 404, "version not found");
  return saveStyle(db, slug, old);
}

/** Where brand.css goes: next to the global stylesheet (app/ for Next.js, src/ for Vite). */
export function stylePaths(r: Pick<StyleRead, "framework" | "root">, tree?: Set<string>): { css: string; json: string; globals: string | null; layout: string | null } {
  const app = tree && [...tree].find((p) => p.startsWith(r.root) && /(^|\/)src\/app\/layout\.(tsx|jsx)$/.test(p)) ? `${r.root}src/app` : tree && [...tree].find((p) => p.startsWith(r.root) && /(^|\/)app\/layout\.(tsx|jsx)$/.test(p)) ? `${r.root}app` : `${r.root}src/app`;
  const css = r.framework === "next-app" ? `${app}/brand.css` : `${r.root}src/brand.css`;
  const globals = tree ? ([...tree].find((p) => p.startsWith(r.root) && /globals\.css$|(^|\/)src\/(index|app|main)\.css$/.test(p)) ?? null) : null;
  const layout = r.framework === "next-app" ? `${app}/layout.tsx` : null;
  return { css, json: `${r.root}brand/tokens.json`, globals, layout };
}

/** The request: Plania writes brand.css and tokens.json; Taller places them, links them, loads the fonts and
 * replaces the old colours written by hand. One style request at a time. */
export async function requestStyle(db: Db, project: Project, deps: LogoDeps = {}): Promise<{ key: string; dir: string }> {
  const [open] = await db
    .select({ key: tasks.key })
    .from(tasks)
    .where(and(eq(tasks.projectId, project.id), ilike(tasks.scope, "%<!-- plania:marca-estilo set=%"), notInArray(tasks.status, [...CLOSED])))
    .limit(1);
  const w = say(STYLE_WORDS);
  if (open) throw new LogoError("LOGO_PEDIDO_OPEN", 409, w.errors.open(open.key));
  const r = await styleRead(db, project.slug, deps);
  if (!r?.style) throw new LogoError("LOGO_NONE", 409, w.errors.none);
  const view = await repoView(project, deps);
  const paths = stylePaths(r, view ? new Set(view.paths.keys()) : undefined);
  const id = createHash("sha256").update(r.css).update(r.json).digest("hex").slice(0, 16);
  const dir = path.join(capturesDir(), "_marca", project.slug, "estilo", id);
  for (const [p, body] of [[paths.css, r.css], [paths.json, r.json]] as const) {
    const target = path.join(dir, p);
    if (!target.startsWith(dir + path.sep)) throw new Error(`a path outside the set: ${p}`);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, body);
  }
  const s = r.base;
  const fonts = [...new Set([s.head, s.body, s.mono].filter((f) => f !== SYSTEM))];
  const lines = [
    `<!-- plania:marca-estilo set=${id} -->`,
    w.lead(dir),
    "",
    `## ${w.files}`,
    `- \`${paths.css}\` (${w.add})`,
    `- \`${paths.json}\` (${w.add})`,
    "",
    `## ${w.code}`,
    `- ${paths.globals ? `\`${paths.globals}\`` : w.globalsUnknown}: ${w.importCss(paths.css)}`,
    ...(paths.layout ? [`- \`${paths.layout}\`: ${w.fontsNext(fonts.map((f) => [f, fontVar(f)] as [string, string]))}`] : [`- ${w.fontsOther(fonts)}`]),
    ...(r.cssOpts.shadcn ? [`- ${w.shadcn(paths.globals ?? w.globalsUnknown)}`] : []),
    `- ${w.darkClass}`,
    ...(r.repo.theme && distance(r.repo.theme, s.brand) > 0.02 ? [`- ${w.manifest(s.brand)}`] : []),
    ...(r.old.length ? ["", `## ${w.oldTitle}`, ...r.old.map((o) => `- \`${o.path}\`: ${o.colors.join(", ")} (${o.n})`)] : []),
    ...(s.lib !== "Lucide" ? ["", w.libLater(s.lib)] : []),
    "",
    w.rules,
  ];
  const taller = await serviceAgent(db, "taller", project);
  const made = (await createTask(
    db,
    {
      project: project.slug,
      ...(taller ? { owner_agent: taller.slug } : {}),
      title: w.title,
      summary: w.summary,
      scope: lines.join("\n"),
      checks: [w.checkFiles, w.checkFonts, w.checkOld, w.checkBuild],
      status: "Ready",
      work_type: "code",
      priority: "P2",
    } as never,
    { ...webCtx, tool: "screen.marca.estilo" },
  )) as { key: string };
  forgetStyle(project.slug);
  return { key: made.key, dir };
}
export const STYLE_MARKER = REQ;

/** PLA-I69-6: every version with its values, newest first, for Marca → Historial. */
export const styleHistory = (slug: string): { v: number; at: string; current: boolean; style: Style }[] => {
  const f = load(slug);
  return (f?.versions ?? []).map((v) => ({ ...v, current: v.v === f!.current })).reverse();
};
