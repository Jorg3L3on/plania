// PLA-I66-4: every icon file of the app, made from the project's original on this machine with sharp. The same
// original always gives the same bytes. Where each file goes follows the checklist (src/brand/check.ts): a file the
// repo already has keeps its path; a missing one goes where the framework expects it (Next.js App Router: app/ for
// what it links by convention, public/icons/ for the manifest's; Vite or a plain site: public/). An image the code
// draws (opengraph-image.tsx) is never replaced.
import { createHash } from "node:crypto";
import sharp from "sharp";
import { reach, SPLASH_SIZES } from "./check.js";
import type { Framework, Row, RowId } from "./check.js";

export type Original = { bytes: Buffer; mime: "image/svg+xml" | "image/png"; variant: "icon" | "mark"; colors: string[]; bg?: string | null };
export type GenKey = Exclude<RowId, "pl" | "man"> | "manifest";
export type GenFile = { key: GenKey; path: string; bytes: Buffer };
export type PlanItem = { key: GenKey; path: string; op: "+" | "~" };
export type Edit = { path: string; what: "manifest_icons" | "manifest_mono" | "layout_svg" | "layout_theme" | "html_links" | "html_manifest" | "layout_splash" | "html_splash" | "expo_icons" | "capacitor_assets" | "manifest_theme" | "manifest_version" | "push_badge" | "manifest_shortcuts" | "manifest_screenshots" | "layout_test_icon"; value?: string };
export type Plan = { items: PlanItem[]; edits: Edit[]; kept: number; framework: Framework; mode: "faltan" | "todo" };

const DARK = "#0c0c10";
const density = (o: Original) => (o.mime === "image/svg+xml" ? 512 : undefined);
const rgba = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, alpha: 1 };
};

/** Where each key goes in this repo. */
export function placeOf(key: GenKey, rows: Row[], f: { framework: Framework; root: string }): string {
  const existing = rows.find((r) => r.id === (key === "manifest" ? "man" : key));
  if (existing?.path && existing.state !== "falta" && !(key === "og" && /\.(tsx|ts|jsx|js)$/.test(existing.path))) return existing.path;
  const next = f.framework === "next-app";
  const app = rows.find((r) => r.id === "ico")?.path?.match(/^(.*?(?:src\/)?app)\/favicon\.ico$/)?.[1] ?? `${f.root}${next ? "src/app" : ""}`;
  const pub = `${f.root}public`;
  const at: Record<GenKey, string> = {
    ico: next ? `${app}/favicon.ico` : `${pub}/favicon.ico`,
    svg: next ? `${app}/icon.svg` : `${pub}/icon.svg`,
    apple: next ? `${app}/apple-icon.png` : `${pub}/apple-touch-icon.png`,
    a192: `${pub}/icons/icon-192.png`,
    a512: `${pub}/icons/icon-512.png`,
    mask: `${pub}/icons/icon-512-maskable.png`,
    mono: `${pub}/icons/icon-monochrome.png`,
    og: next ? `${app}/opengraph-image.png` : `${pub}/og.png`,
    manifest: next ? `${app}/manifest.ts` : `${pub}/manifest.webmanifest`,
    splash: `${pub}/splash/`,
    ios_app: existing?.path ?? `${f.root}assets/icon.png`,
    and_app: existing?.path ?? `${f.root}assets/adaptive-icon.png`,
    // PLA-I69-3: the extra surfaces.
    badge: `${pub}/icons/badge-96.png`,
    short: `${pub}/icons/shortcut-192.png`,
    shots: `${pub}/screenshots/`,
    test: `${pub}/icons/icon-prueba.png`,
  };
  // PLA-I66-6: Capacitor builds its icons from sources in assets/ (@capacitor/assets): Plania gives those.
  const cap = rows.some((r) => r.checks.some((c) => c.k === "native_capacitor"));
  if (cap && key === "ios_app") return `${f.root}assets/icon-only.png`;
  if (cap && key === "and_app") return `${f.root}assets/icon-foreground.png`;
  return at[key];
}

const ROW_OF: Record<GenKey, RowId> = { ico: "ico", svg: "svg", apple: "apple", a192: "a192", a512: "a512", mask: "mask", mono: "mono", og: "og", manifest: "man", splash: "splash", ios_app: "ios_app", and_app: "and_app", badge: "badge", short: "short", shots: "shots", test: "test" };

/** What a request to Taller would change: the missing or wrong files (faltan), or every file (todo). */
// PLA-122: only, the keys of one surface: every one of them is made (whatever the repo has) and nothing else.
export function planFor(rows: Row[], f: { framework: Framework; root: string }, mode: "faltan" | "todo", svgOriginal: boolean, native = false, only?: GenKey[]): Plan {
  const items: PlanItem[] = [];
  let kept = 0;
  let colorOnly = false;
  // PLA-I69-3: the extra surfaces have rows only when switched on, so they join the plan only then.
  const keys: GenKey[] = ["ico", "svg", "apple", "a192", "a512", "mask", "mono", "og", "manifest", ...(native ? (["splash", "ios_app", "and_app"] as GenKey[]) : []), "badge", "short", "shots", "test"];
  for (const key of keys) {
    const row = rows.find((r) => r.id === ROW_OF[key]);
    if (!row) continue;
    if (only && !only.includes(key)) continue;
    if (key === "svg" && !svgOriginal && !only) continue; // a raster original has no SVG to give (a surface's own icon gets one that wraps it)
    if (key === "og" && row.state === "ok" && row.path && /\.(tsx|ts|jsx|js)$/.test(row.path)) { kept++; continue; } // drawn in code
    if (key === "og" && row.state === "ok" && !row.path?.match(/\.(png|jpe?g)$/)) { kept++; continue; } // declared in metadata
    // PLA-I69-1: a manifest whose only fault is the colour of an older logo gets an edit, not a new file.
    if (key === "manifest" && row.state === "viejo" && mode === "faltan" && !only) { colorOnly = true; continue; }
    const need = !!only || mode === "todo" || row.state !== "ok";
    if (!need) { kept++; continue; }
    // A missing file is new where the framework expects it; one the repo has (wrong, or redone) is replaced in place.
    items.push({ key, path: placeOf(key, rows, f), op: row.state === "falta" ? "+" : "~" });
  }
  const edits: Edit[] = [];
  const man = rows.find((r) => r.id === "man");
  const manHere = man?.state === "ok" || man?.state === "viejo"; // PLA-I69-1: a manifest with an older logo's colour is still there
  const touches = (k: GenKey) => items.some((i) => i.key === k);
  // PLA-124: a file replaced where it already is needs no new link; only a new one does.
  const adds = (k: GenKey) => items.some((i) => i.key === k && i.op === "+");
  if (f.framework === "next-app") {
    const layout = `${f.root}${(rows.find((r) => r.id === "ico")?.path ?? "src/app/").replace(/favicon\.ico$/, "")}layout.tsx`.replace(`${f.root}${f.root}`, f.root);
    if (touches("svg") && placeOf("svg", rows, f).includes("/public/")) edits.push({ path: layout, what: "layout_svg" });
    if (manHere && (adds("a192") || adds("a512") || adds("mask"))) edits.push({ path: man.path!, what: "manifest_icons" });
    if (manHere && adds("mono")) edits.push({ path: man.path!, what: "manifest_mono" });
    if (!manHere && !only) edits.push({ path: layout, what: "layout_theme" }); // PLA-124: a surface plan carries only its own edits
  } else {
    const html = `${f.root}index.html`;
    if (items.some((i) => ["ico", "svg", "apple"].includes(i.key))) edits.push({ path: html, what: "html_links" });
    if (touches("manifest")) edits.push({ path: html, what: "html_manifest" });
    if (manHere && touches("mono")) edits.push({ path: man.path!, what: "manifest_mono" });
  }
  // PLA-I69-1: the colour of the logo, written into the manifest the repo already has.
  if (colorOnly && man?.path) edits.push({ path: man.path, what: "manifest_theme" });
  // Installed apps only notice a new icon when its URL changes (Chrome 144+): a replaced Android icon bumps ?v= in the manifest.
  if (man?.state !== "falta" && man?.path && !touches("manifest") && items.some((i) => ["a192", "a512", "mask", "mono"].includes(i.key) && i.op === "~")) edits.push({ path: man.path, what: "manifest_version" });
  if (touches("badge")) edits.push({ path: f.root || ".", what: "push_badge" });
  if (touches("short") && man?.path) edits.push({ path: man.path, what: "manifest_shortcuts" });
  if (touches("shots") && man?.path) edits.push({ path: man.path, what: "manifest_screenshots" });
  if (touches("test")) edits.push({ path: f.framework === "next-app" ? `${f.root}${(rows.find((r) => r.id === "ico")?.path ?? "src/app/").replace(/favicon\.ico$/, "")}layout.tsx`.replace(`${f.root}${f.root}`, f.root) : `${f.root}index.html`, what: "layout_test_icon" });
  if (touches("splash")) edits.push(f.framework === "next-app" ? { path: `${f.root}${(rows.find((r) => r.id === "ico")?.path ?? "src/app/").replace(/favicon\.ico$/, "")}layout.tsx`.replace(`${f.root}${f.root}`, f.root), what: "layout_splash" } : { path: `${f.root}index.html`, what: "html_splash" });
  if (touches("ios_app") || touches("and_app")) {
    const cap = rows.some((r) => r.checks.some((c) => c.k === "native_capacitor"));
    const expo = rows.some((r) => r.checks.some((c) => c.k === "native_expo"));
    if (expo) edits.push({ path: `${f.root}app.json`, what: "expo_icons" });
    if (cap) edits.push({ path: `${f.root}assets/`, what: "capacitor_assets" });
  }
  return { items, edits: dedupe(edits), kept, framework: f.framework, mode };
}
const dedupe = (e: Edit[]) => e.filter((x, i) => e.findIndex((y) => y.path === x.path && y.what === x.what) === i);

/** The tile every raster icon comes from: the original at 1024, a bare mark set on a background. */
async function tile(o: Original): Promise<Buffer> {
  const N = 1024;
  if (o.variant === "icon") return sharp(o.bytes, { density: density(o) }).resize(N, N, { fit: "cover" }).png().toBuffer();
  const bg = o.bg ?? o.colors[0] ?? DARK;
  const mark = await sharp(o.bytes, { density: density(o) }).resize(Math.round(N * 0.68), Math.round(N * 0.68), { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  // A mark drawn in its own colour on that colour would vanish: a light mark goes on dark, a dark one on white.
  const plate = await plateFor(mark, bg);
  return sharp({ create: { width: N, height: N, channels: 4, background: rgba(plate) } }).composite([{ input: mark, gravity: "center" }]).png().toBuffer();
}

async function plateFor(mark: Buffer, wanted: string): Promise<string> {
  const { data } = await sharp(mark).resize(32, 32).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < data.length; i += 4) if (data[i + 3]! > 128) { r += data[i]!; g += data[i + 1]!; b += data[i + 2]!; n++; }
  if (!n) return wanted;
  const near = (hex: string) => {
    const c = rgba(hex);
    return Math.abs(c.r - r / n) + Math.abs(c.g - g / n) + Math.abs(c.b - b / n) < 90;
  };
  if (!near(wanted)) return wanted;
  return (r + g + b) / n / 3 > 128 ? DARK : "#ffffff";
}

/** The colour of the tile's top-left corner (its background, or the start of its gradient). */
async function cornerOf(png: Buffer): Promise<string> {
  const { data } = await sharp(png).extract({ left: 4, top: 4, width: 1, height: 1 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return `#${[data[0]!, data[1]!, data[2]!].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

const size = (png: Buffer, n: number) => sharp(png).resize(n, n).png({ compressionLevel: 9 }).toBuffer();
const opaque = async (png: Buffer, n: number) => sharp(png).resize(n, n).flatten({ background: await cornerOf(png) }).png({ compressionLevel: 9 }).toBuffer();

/** favicon.ico with PNG entries of 48, 32 and 16 px (in that order: some readers break on ascending). */
export async function ico(png: Buffer): Promise<Buffer> {
  const sizes = [48, 32, 16];
  const imgs = await Promise.all(sizes.map((s) => size(png, s)));
  const head = Buffer.alloc(6 + 16 * sizes.length);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(sizes.length, 4);
  let offset = head.length;
  sizes.forEach((s, i) => {
    const e = 6 + 16 * i;
    head[e] = s;
    head[e + 1] = s;
    head.writeUInt16LE(1, e + 4);
    head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(imgs[i]!.length, e + 8);
    head.writeUInt32LE(offset, e + 12);
    offset += imgs[i]!.length;
  });
  return Buffer.concat([head, ...imgs]);
}

/** The adaptive icon: opaque, the drawing inside 40 % of the width from the centre (shrunk onto its corner colour). */
async function maskable(t: Buffer): Promise<Buffer> {
  const N = 512;
  const base = await opaque(t, N);
  const r = reach(base);
  if (r !== null && r <= 0.38) return base;
  const k = Math.min(0.8, (0.38 / Math.max(r ?? 0.5, 0.01)) * 0.98);
  const inner = await sharp(base).resize(Math.round(N * k), Math.round(N * k)).png().toBuffer();
  return sharp({ create: { width: N, height: N, channels: 4, background: rgba(await cornerOf(base)) } }).composite([{ input: inner, gravity: "center" }]).flatten().png({ compressionLevel: 9 }).toBuffer();
}

/** The monochrome icon: the drawing as a white silhouette (only its alpha counts), on nothing. */
async function monochrome(o: Original, t: Buffer): Promise<Buffer> {
  const N = 512;
  if (o.variant === "mark") {
    const a = await sharp(o.bytes, { density: density(o) }).resize(Math.round(N * 0.7), Math.round(N * 0.7), { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).ensureAlpha().extractChannel(3).toBuffer();
    const fill = await sharp({ create: { width: Math.round(N * 0.7), height: Math.round(N * 0.7), channels: 3, background: { r: 255, g: 255, b: 255 } } }).joinChannel(a).png().toBuffer();
    return sharp({ create: { width: N, height: N, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: fill, gravity: "center" }]).png({ compressionLevel: 9 }).toBuffer();
  }
  // An icon: what differs from its background (read from the corners and blended across) is the drawing.
  const { data } = await sharp(t).resize(N, N).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const at = (x: number, y: number, c: number) => data[(y * N + x) * 4 + c]!;
  const corners = [[2, 2], [N - 3, 2], [2, N - 3], [N - 3, N - 3]].map(([x, y]) => [0, 1, 2].map((c) => at(x!, y!, c)));
  const out = Buffer.alloc(N * N * 4);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const u = x / (N - 1), v = y / (N - 1);
      let d = 0;
      for (let c = 0; c < 3; c++) {
        const bg = (1 - u) * (1 - v) * corners[0]![c]! + u * (1 - v) * corners[1]![c]! + (1 - u) * v * corners[2]![c]! + u * v * corners[3]![c]!;
        d += Math.abs(at(x, y, c) - bg);
      }
      const i = (y * N + x) * 4;
      out[i] = out[i + 1] = out[i + 2] = 255;
      out[i + 3] = d > 90 ? 255 : 0;
    }
  return sharp(out, { raw: { width: N, height: N, channels: 4 } }).png({ compressionLevel: 9 }).toBuffer();
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** The share image: 1200 × 630, the icon and the app's name on its theme colour. */
async function shareImage(t: Buffer, name: string, theme: string | null): Promise<Buffer> {
  const bg = theme && /^#[0-9a-f]{6}$/i.test(theme) ? theme : DARK;
  const c = rgba(bg);
  const light = (c.r * 299 + c.g * 587 + c.b * 114) / 1000 > 140;
  const icon = await sharp(t).resize(280, 280).composite([{ input: Buffer.from(`<svg width="280" height="280"><rect width="280" height="280" rx="62" ry="62"/></svg>`), blend: "dest-in" }]).png().toBuffer();
  const text = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"><text x="470" y="345" font-family="Helvetica, Arial, sans-serif" font-size="${name.length > 14 ? 64 : 84}" font-weight="700" fill="${light ? "#111111" : "#ffffff"}">${esc(name.slice(0, 28))}</text></svg>`,
  );
  return sharp({ create: { width: 1200, height: 630, channels: 4, background: rgba(bg) } })
    .composite([{ input: icon, left: 140, top: 175 }, { input: text, left: 0, top: 0 }])
    .flatten()
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/** A manifest for a project that has none: name, colours, display and the three icons where the plan puts them. */
export function manifestText(f: Framework, name: string, theme: string, at: (k: GenKey) => string, pub: string, version?: string): string {
  const url = (k: GenKey) => `/${at(k).slice(pub.length + 1)}${version ? `?v=${version}` : ""}`;
  const icons = [
    { src: url("a192"), sizes: "192x192", type: "image/png", purpose: "any" },
    { src: url("a512"), sizes: "512x512", type: "image/png", purpose: "any" },
    { src: url("mask"), sizes: "512x512", type: "image/png", purpose: "maskable" },
    { src: url("mono"), sizes: "512x512", type: "image/png", purpose: "monochrome" },
  ];
  const data = { name, short_name: name.slice(0, 12), start_url: "/", display: "standalone", background_color: theme, theme_color: theme, icons };
  if (f !== "next-app") return `${JSON.stringify(data, null, 2)}\n`;
  return `import type { MetadataRoute } from "next";\n\nexport default function manifest(): MetadataRoute.Manifest {\n  return ${JSON.stringify(data, null, 2).replace(/\n/g, "\n  ")};\n}\n`;
}

/** One launch screen: the icon, rounded, in the middle of the theme colour. */
async function splashOf(t: Buffer, w: number, h: number, bg: string): Promise<Buffer> {
  const s = Math.round(Math.min(w, h) * 0.28);
  const r = Math.round(s * 0.2237);
  const icon = await sharp(t).resize(s, s).composite([{ input: Buffer.from(`<svg width="${s}" height="${s}"><rect width="${s}" height="${s}" rx="${r}" ry="${r}"/></svg>`), blend: "dest-in" }]).png().toBuffer();
  return sharp({ create: { width: w, height: h, channels: 4, background: rgba(bg) } }).composite([{ input: icon, gravity: "center" }]).flatten().png({ compressionLevel: 9, palette: true }).toBuffer();
}

/** Android's adaptive foreground: the drawing alone (its background removed), inside the 66 dp of 108 safe zone. */
async function adaptive(o: Original, t: Buffer): Promise<{ fg: Buffer; mono: Buffer; bg: string }> {
  const N = 1024;
  const bg = await cornerOf(t);
  const mono = await monochrome(o, t); // 512, white silhouette on nothing
  let fgFull: Buffer;
  if (o.variant === "mark") fgFull = await sharp(o.bytes, { density: density(o) }).resize(N, N, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  else {
    // The tile's colours where the silhouette is, nothing elsewhere.
    const a = await sharp(mono).resize(N, N).extractChannel(3).toBuffer();
    fgFull = await sharp(await sharp(t).resize(N, N).removeAlpha().toBuffer()).joinChannel(a).png().toBuffer();
  }
  const inner = Math.round(N * 0.6);
  const fg = await sharp({ create: { width: N, height: N, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: await sharp(fgFull).resize(inner, inner).png().toBuffer(), gravity: "center" }]).png({ compressionLevel: 9 }).toBuffer();
  const monoOut = await sharp({ create: { width: N, height: N, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: await sharp(mono).resize(inner, inner).png().toBuffer(), gravity: "center" }]).png({ compressionLevel: 9 }).toBuffer();
  return { fg, mono: monoOut, bg };
}

/** The surface a key belongs to (PLA-122): its files can come from that surface's own icon. */
export type Surface = "iphone" | "android" | "navegador";
export const SURFACE_KEYS: Record<Surface, GenKey[]> = { iphone: ["apple", "ios_app", "splash"], android: ["a192", "a512", "mask", "mono", "and_app"], navegador: ["ico", "svg"] };
export const surfaceOfKey = (k: GenKey): Surface | null => (Object.keys(SURFACE_KEYS) as Surface[]).find((s) => SURFACE_KEYS[s].includes(k)) ?? null;

/** A raster icon as an SVG file (PLA-122): a browser that prefers icon.svg shows the same picture. */
export async function svgWrap(png: Buffer): Promise<Buffer> {
  const small = await sharp(png).resize(256, 256).png({ compressionLevel: 9 }).toBuffer();
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><image width="256" height="256" href="data:image/png;base64,${small.toString("base64")}"/></svg>`);
}

/** The plan's files, made. surfaces: a surface's own icon, for that surface's files (PLA-122). */
export async function generate(main: Original, plan: Plan, opts: { name: string; theme: string | null; rows: Row[]; root: string; version?: string; shots?: { narrow: Buffer[]; wide: Buffer[] } }, surfaces: Partial<Record<Surface, Original>> = {}): Promise<GenFile[]> {
  const tiles = new Map<Original, Buffer>();
  const tileOf = async (x: Original) => tiles.get(x) ?? (tiles.set(x, await tile(x)), tiles.get(x)!);
  const out: GenFile[] = [];
  const f = { framework: plan.framework, root: opts.root };
  for (const it of plan.items) {
    const s = surfaceOfKey(it.key);
    const o = (s && surfaces[s]) || main;
    const t = await tileOf(o);
    if (it.key === "splash") {
      const bg = opts.theme && /^#[0-9a-f]{6}$/i.test(opts.theme) ? opts.theme : await cornerOf(t);
      for (const [w, h] of SPLASH_SIZES) out.push({ key: "splash", path: `${it.path.replace(/\/?$/, "/")}apple-splash-${w}x${h}.png`, bytes: await splashOf(t, w, h, bg) });
      continue;
    }
    // PLA-I69-3: install screenshots from El Probador's stills (narrow for phones, wide for computers).
    if (it.key === "shots") {
      const dir = it.path.replace(/\/?$/, "/");
      for (const [kind, list] of [["narrow", opts.shots?.narrow ?? []], ["wide", opts.shots?.wide ?? []]] as const)
        for (const [i, b] of list.slice(0, 3).entries()) out.push({ key: "shots", path: `${dir}${kind}-${i + 1}.png`, bytes: await screenshotOf(b, kind) });
      continue;
    }
    if (it.key === "and_app") {
      const a = await adaptive(o, t);
      const dir = it.path.replace(/[^/]+$/, "");
      const cap = it.path.endsWith("icon-foreground.png");
      out.push({ key: "and_app", path: it.path, bytes: a.fg });
      out.push({ key: "and_app", path: `${dir}${cap ? "icon-monochrome.png" : "adaptive-monochrome.png"}`, bytes: a.mono });
      if (cap) out.push({ key: "and_app", path: `${dir}icon-background.png`, bytes: await sharp({ create: { width: 1024, height: 1024, channels: 3, background: rgba(a.bg) } }).png().toBuffer() });
      continue;
    }
    let bytes: Buffer;
    switch (it.key) {
      case "ios_app": bytes = await opaque(t, 1024); break;
      case "ico": bytes = await ico(t); break;
      case "svg": bytes = o.mime === "image/svg+xml" ? o.bytes : await svgWrap(t); break;
      case "apple": bytes = await opaque(t, 180); break;
      case "a192": bytes = await size(t, 192); break;
      case "a512": bytes = await size(t, 512); break;
      case "mask": bytes = await maskable(t); break;
      case "mono": bytes = await monochrome(o, t); break;
      case "og": bytes = await shareImage(t, opts.name, opts.theme); break;
      case "badge": bytes = await sharp(await monochrome(o, t)).resize(96, 96).png({ compressionLevel: 9 }).toBuffer(); break;
      case "short": bytes = await size(t, 192); break;
      case "test": bytes = await ribbon(t); break;
      case "manifest": bytes = Buffer.from(manifestText(plan.framework, opts.name, opts.theme ?? DARK, (k) => placeOf(k, opts.rows, f), `${opts.root}public`, opts.version)); break;
    }
    out.push({ key: it.key, path: it.path, bytes });
  }
  return out;
}

/** A stable name for a set: the original and the plan decide it. */
export const setId = (o: Original, plan: Plan, surfaces: Partial<Record<Surface, Original>> = {}): string => {
  const h = createHash("sha256").update(o.bytes).update(JSON.stringify(plan.items));
  for (const s of Object.keys(surfaces).sort() as Surface[]) h.update(s).update(surfaces[s]!.bytes);
  return h.digest("hex").slice(0, 16);
};

// ---------- a ZIP with no dependency (stored, no compression: PNGs are compressed already) ----------
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
export function crc32(b: Buffer): number {
  let c = ~0;
  for (const x of b) c = CRC[(c ^ x) & 255]! ^ (c >>> 8);
  return ~c >>> 0;
}
export function zip(files: { path: string; bytes: Buffer }[]): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.path, "utf8");
    const crc = crc32(f.bytes);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // names in UTF-8
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(0, 10); // time and date: zero, so the same files give the same zip
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(f.bytes.length, 18);
    local.writeUInt32LE(f.bytes.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    parts.push(local, name, f.bytes);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x0800, 8);
    c.writeUInt16LE(0, 10);
    c.writeUInt32LE(0, 12);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(f.bytes.length, 20);
    c.writeUInt32LE(f.bytes.length, 24);
    c.writeUInt16LE(name.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(c, name);
    offset += 30 + name.length + f.bytes.length;
  }
  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, dir, end]);
}

// PLA-I69-3: a test-environment icon: the app icon with an amber corner, so its tab is never taken for production's.
async function ribbon(t: Buffer): Promise<Buffer> {
  const N = 512;
  const corner = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${N}" height="${N}"><path d="M${N * 0.5} ${N} L${N} ${N * 0.5} L${N} ${N} Z" fill="#ffb454"/></svg>`);
  return sharp(await sharp(t).resize(N, N).png().toBuffer()).composite([{ input: corner }]).png({ compressionLevel: 9 }).toBuffer();
}

/** A still made into an install screenshot Chrome accepts: 320 to 3840 px a side, the long side at most 2.3 times
 * the short one (a tall phone page is cut from its top), one shape per form factor. */
export async function screenshotOf(b: Buffer, kind: "narrow" | "wide"): Promise<Buffer> {
  const img = sharp(b);
  const m = await img.metadata();
  const w = m.width ?? 390, h = m.height ?? 844;
  const ratio = kind === "narrow" ? 2.16 : 16 / 10; // 9:19.5-ish for phones, 16:10 for desktops
  const cutW = kind === "narrow" ? w : Math.min(w, Math.round(h * ratio));
  const cutH = kind === "narrow" ? Math.min(h, Math.round(w * ratio)) : Math.min(h, Math.round(cutW / ratio));
  let out = img.extract({ left: 0, top: 0, width: cutW, height: cutH });
  const short = Math.min(cutW, cutH);
  if (short < 320) out = out.resize(kind === "narrow" ? 320 : null, kind === "narrow" ? null : 320);
  return out.png({ compressionLevel: 9 }).toBuffer();
}
