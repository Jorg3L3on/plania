// PLA-I66-1: which file in a project's repo is its logo. Pure: it gets file paths and bytes and ranks them, so the
// rules are tested without git. A candidate must be named like a logo (logo, mark, icon, apple-touch-icon, the
// project's own slug…) and sit where apps keep them (public/, app/, assets/, static/, also one or two folders down in
// a monorepo). An SVG beats a PNG, a bigger PNG beats a smaller one, an icon drawn on its own background beats a
// bare mark (Compañía shows the app icon), and the framework's own icon file is trusted. favicon.ico is never the
// logo: it is tiny, and new apps ship the framework's.
import path from "node:path";
import { readPng } from "./png.js";
import type { LogoMime, LogoVariant } from "../db/schema.js";

export type RepoFile = { path: string; bytes: Buffer };
export type Candidate = {
  path: string;
  mime: LogoMime;
  width: number | null;
  height: number | null;
  variant: LogoVariant;
  colors: string[];
  score: number;
  bytes: Buffer;
};

export const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const MIN_PNG = 128;
const ROOTS = new Set(["public", "app", "assets", "static", "resources", "images", "img"]);
const SKIP_DIRS = /(^|\/)(node_modules|\.next|dist|build|out|coverage|splash|screenshots?|og|social|fonts?|emoji|flags|vendor|test|tests|__tests__|e2e|fixtures?|docs?)(\/|$)/i;
const SKIP_NAMES = /(maskable|monochrome|mono|splash|badge|shortcut|banner|screenshot|og-image|opengraph|twitter|placeholder|default|example|sample)/i;
const KEY = "(logo|logomark|logotipo|isotipo|isotype|mark|brand|icon|app-icon|appicon|apple-touch-icon|apple-icon|favicon)";
const MOD = "([-_.@](\\d{2,4}(x\\d{2,4})?|\\dx|rounded|round|square|full|color|colour|light|dark|mark|icon|logo|main|primary|app|bg|tile))*";
const NAME_WEIGHT: [RegExp, number][] = [
  [/^(logo|logomark|logotipo|isotipo|isotype|mark)/, 50],
  [/^brand/, 40],
  [/^(icon|app-icon|appicon)/, 45],
  [/^(apple-touch-icon|apple-icon)/, 30],
  [/^favicon/, 25],
];

/** Paths that could be the logo, before reading them (cheap: names and folders only). */
export function looksLikeLogo(p: string, slug: string): boolean {
  const norm = p.replace(/\\/g, "/");
  const ext = path.extname(norm).toLowerCase();
  if (ext !== ".svg" && ext !== ".png") return false;
  if (SKIP_DIRS.test(path.dirname(norm))) return false;
  const parts = norm.split("/");
  const rootAt = parts.findIndex((s) => ROOTS.has(s.toLowerCase()));
  if (rootAt < 0 || rootAt > 2) return false; // app/…, apps/web/public/…, ui/public/…; never deep in the tree
  if (parts.length - rootAt - 1 > 3) return false;
  const base = path.basename(norm, ext).toLowerCase();
  if (SKIP_NAMES.test(base)) return false;
  const s = slug.toLowerCase().replace(/[^a-z0-9-]/g, "");
  const names = [new RegExp(`^${KEY}${MOD}$`), new RegExp(`^${s}${MOD}$`), new RegExp(`^${KEY}[-_]${s}${MOD}$`)];
  return names.some((r) => r.test(base));
}

const HEX = /#([0-9a-f]{6}|[0-9a-f]{3})\b/gi;
const norm6 = (h: string) => (h.length === 4 ? `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}` : h).toLowerCase();
function rgbOf(h: string): [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
/** A colour worth calling the project's: not white, black or a grey. */
function colorful([r, g, b]: [number, number, number]): boolean {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  return max - min > 40 && max > 50 && min < 235;
}
const toHex = (r: number, g: number, b: number) => `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;

/** The SVG is safe to keep and show: no scripts, events, embedded HTML or outside references. */
export function svgIsClean(s: string): boolean {
  return !/<script|<foreignObject|\son[a-z]+\s*=|(?:xlink:)?href\s*=\s*["'](?!#|data:image\/)/i.test(s);
}

function svgSize(s: string): { width: number | null; height: number | null } {
  const vb = s.match(/viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
  if (vb) return { width: Number(vb[1]), height: Number(vb[2]) };
  const w = s.match(/<svg[^>]*\swidth\s*=\s*["']([\d.]+)/i), h = s.match(/<svg[^>]*\sheight\s*=\s*["']([\d.]+)/i);
  return { width: w ? Number(w[1]) : null, height: h ? Number(h[1]) : null };
}

/** Icon or bare mark: an icon paints a shape the size of the whole canvas (its background) outside any mask. */
function svgVariant(s: string, w: number | null, h: number | null): LogoVariant {
  const body = s.replace(/<(mask|clipPath|defs|symbol)\b[\s\S]*?<\/\1>/gi, "");
  for (const m of body.matchAll(/<rect\b([^>]*)>/gi)) {
    const a = m[1]!;
    if (/\smask\s*=|fill\s*=\s*["']none/i.test(a)) continue;
    const rw = a.match(/\swidth\s*=\s*["']([\d.]+%?)/i)?.[1];
    const rh = a.match(/\sheight\s*=\s*["']([\d.]+%?)/i)?.[1];
    const full = (v: string | undefined, d: number | null) => v === "100%" || (v !== undefined && d !== null && Math.abs(Number(v) - d) < 0.5);
    if (full(rw, w) && full(rh, h)) return "icon";
  }
  return "mark";
}

/** PLA-123: the SVG without its own background (rects the size of the canvas, outside masks and defs), so a background
 * the owner picks replaces it instead of framing it. Unchanged when it has none. */
export function stripSvgBackground(s: string): string {
  const { width, height } = svgSize(s);
  const hidden: [number, number][] = [];
  for (const m of s.matchAll(/<(mask|clipPath|defs|symbol)\b[\s\S]*?<\/\1>/gi)) hidden.push([m.index!, m.index! + m[0].length]);
  const full = (v: string | undefined, d: number | null) => v === "100%" || (v !== undefined && d !== null && Math.abs(Number(v) - d) < 0.5);
  return s.replace(/<rect\b([^>]*?)(\/>|>\s*<\/rect>)/gi, (whole, a: string, _end: string, at: number) => {
    if (hidden.some(([x, y]) => at >= x && at < y)) return whole;
    if (/\smask\s*=|fill\s*=\s*["']none/i.test(a)) return whole;
    const rw = a.match(/\swidth\s*=\s*["']([\d.]+%?)/i)?.[1];
    const rh = a.match(/\sheight\s*=\s*["']([\d.]+%?)/i)?.[1];
    const x = Number(a.match(/\sx\s*=\s*["']([-\d.]+)/i)?.[1] ?? 0), y = Number(a.match(/\sy\s*=\s*["']([-\d.]+)/i)?.[1] ?? 0);
    return full(rw, width) && full(rh, height) && Math.abs(x) < 0.5 && Math.abs(y) < 0.5 ? "" : whole;
  });
}

function svgColors(s: string): string[] {
  const out: string[] = [];
  for (const m of s.matchAll(HEX)) {
    const h = norm6(m[0]);
    if (colorful(rgbOf(h)) && !out.includes(h)) out.push(h);
    if (out.length === 2) break;
  }
  return out;
}

/** Two colours from the pixels: the top-left and bottom-right of the colourful ones (how these tiles fade). */
function pngColors(rgba: Uint8Array, w: number, h: number): string[] {
  const sum = [[0, 0, 0, 0], [0, 0, 0, 0]];
  const step = Math.max(1, Math.floor(Math.min(w, h) / 64));
  for (let y = 0; y < h; y += step)
    for (let x = 0; x < w; x += step) {
      const i = (y * w + x) * 4;
      if (rgba[i + 3]! < 200) continue;
      const c: [number, number, number] = [rgba[i]!, rgba[i + 1]!, rgba[i + 2]!];
      if (!colorful(c)) continue;
      const q = x / w + y / h < 1 ? 0 : 1;
      sum[q]![0]! += c[0]; sum[q]![1]! += c[1]; sum[q]![2]! += c[2]; sum[q]![3]! += 1;
    }
  const out = sum.filter((s) => s[3]! > 0).map((s) => toHex(s[0]! / s[3]!, s[1]! / s[3]!, s[2]! / s[3]!));
  return out.length === 1 ? [out[0]!, out[0]!] : out;
}

function pngVariant(rgba: Uint8Array, w: number, h: number): LogoVariant {
  const alpha = (x: number, y: number) => rgba[(Math.min(h - 1, Math.round(y)) * w + Math.min(w - 1, Math.round(x))) * 4 + 3]!;
  // A pre-rounded icon has see-through corners but solid edges halfway along each side.
  const edges = [alpha(w * 0.02, h / 2), alpha(w * 0.98, h / 2), alpha(w / 2, h * 0.02), alpha(w / 2, h * 0.98)];
  return edges.every((a) => a > 200) ? "icon" : "mark";
}

/** One file as a candidate, or null when it cannot be the logo (unsafe, too small, not square, unreadable). */
export function inspect(f: RepoFile, slug: string): Candidate | null {
  if (f.bytes.length === 0 || f.bytes.length > MAX_LOGO_BYTES) return null;
  const ext = path.extname(f.path).toLowerCase();
  const base = path.basename(f.path, ext).toLowerCase();
  let c: Omit<Candidate, "score">;
  if (ext === ".svg") {
    const s = f.bytes.toString("utf8");
    if (!/<svg[\s>]/i.test(s) || !svgIsClean(s)) return null;
    const { width, height } = svgSize(s);
    if (width && height && Math.max(width, height) / Math.min(width, height) > 1.15) return null; // a wordmark
    c = { path: f.path, mime: "image/svg+xml", width, height, variant: svgVariant(s, width, height), colors: svgColors(s), bytes: f.bytes };
  } else {
    const png = readPng(f.bytes);
    if (!png || Math.min(png.width, png.height) < MIN_PNG) return null;
    if (Math.max(png.width, png.height) / Math.min(png.width, png.height) > 1.15) return null;
    const variant = png.rgba ? pngVariant(png.rgba, png.width, png.height) : "icon";
    const colors = png.rgba ? pngColors(png.rgba, png.width, png.height) : [];
    c = { path: f.path, mime: "image/png", width: png.width, height: png.height, variant, colors, bytes: f.bytes };
  }
  const s = slug.toLowerCase();
  let score = base.startsWith(s) || base.endsWith(`-${s}`) ? 50 : NAME_WEIGHT.find(([r]) => r.test(base))?.[1] ?? 20;
  if (/(^|\/)(src\/)?app\/(icon|apple-icon)\d*\.(svg|png)$/.test(f.path)) score += 10; // the framework's own icon file
  if (/\/(brand|logos?)\//i.test(f.path)) score += 10;
  score += c.mime === "image/svg+xml" ? 30 : Math.min(20, ((c.width ?? 0) / 1024) * 20);
  if (c.variant === "icon") score += 15;
  if (/round/.test(base)) score -= 2; // we round the corners ourselves
  return { ...c, score };
}

/** The best candidate (null when none qualifies) and the rest, best first. */
export function detectLogo(files: RepoFile[], slug: string): { best: Candidate | null; candidates: Candidate[] } {
  const candidates = files
    .filter((f) => looksLikeLogo(f.path, slug))
    .map((f) => inspect(f, slug))
    .filter((c): c is Candidate => c !== null)
    .sort((a, b) => b.score - a.score || a.path.length - b.path.length || a.path.localeCompare(b.path));
  return { best: candidates[0] ?? null, candidates };
}
