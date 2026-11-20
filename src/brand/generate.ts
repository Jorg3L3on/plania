// PLA-I66-4: every icon file of the app, made from the project's original on this machine with sharp. The same
// original always gives the same bytes. Where each file goes follows the checklist (src/brand/check.ts): a file the
// repo already has keeps its path; a missing one goes where the framework expects it (Next.js App Router: app/ for
// what it links by convention, public/icons/ for the manifest's; Vite or a plain site: public/). An image the code
// draws (opengraph-image.tsx) is never replaced.
import { createHash } from "node:crypto";
import sharp from "sharp";
import { reach } from "./check.js";
import type { Framework, Row, RowId } from "./check.js";

export type Original = { bytes: Buffer; mime: "image/svg+xml" | "image/png"; variant: "icon" | "mark"; colors: string[]; bg?: string | null };
export type GenKey = Exclude<RowId, "pl" | "splash" | "man"> | "manifest";
export type GenFile = { key: GenKey; path: string; bytes: Buffer };
export type PlanItem = { key: GenKey; path: string; op: "+" | "~" };
export type Edit = { path: string; what: "manifest_icons" | "manifest_mono" | "layout_svg" | "layout_theme" | "html_links" | "html_manifest" };
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
  };
  return at[key];
}

const ROW_OF: Record<GenKey, RowId> = { ico: "ico", svg: "svg", apple: "apple", a192: "a192", a512: "a512", mask: "mask", mono: "mono", og: "og", manifest: "man" };

/** What a request to Taller would change: the missing or wrong files (faltan), or every file (todo). */
export function planFor(rows: Row[], f: { framework: Framework; root: string }, mode: "faltan" | "todo", svgOriginal: boolean): Plan {
  const items: PlanItem[] = [];
  let kept = 0;
  for (const key of ["ico", "svg", "apple", "a192", "a512", "mask", "mono", "og", "manifest"] as GenKey[]) {
    const row = rows.find((r) => r.id === ROW_OF[key]);
    if (!row) continue;
    if (key === "svg" && !svgOriginal) continue; // a raster original has no SVG to give
    if (key === "og" && row.state === "ok" && row.path && /\.(tsx|ts|jsx|js)$/.test(row.path)) { kept++; continue; } // drawn in code
    if (key === "og" && row.state === "ok" && !row.path?.match(/\.(png|jpe?g)$/)) { kept++; continue; } // declared in metadata
    const need = mode === "todo" || row.state !== "ok";
    if (!need) { kept++; continue; }
    // A missing file is new where the framework expects it; one the repo has (wrong, or redone) is replaced in place.
    items.push({ key, path: placeOf(key, rows, f), op: row.state === "falta" ? "+" : "~" });
  }
  const edits: Edit[] = [];
  const man = rows.find((r) => r.id === "man");
  const touches = (k: GenKey) => items.some((i) => i.key === k);
  if (f.framework === "next-app") {
    const layout = `${f.root}${(rows.find((r) => r.id === "ico")?.path ?? "src/app/").replace(/favicon\.ico$/, "")}layout.tsx`.replace(`${f.root}${f.root}`, f.root);
    if (touches("svg") && placeOf("svg", rows, f).includes("/public/")) edits.push({ path: layout, what: "layout_svg" });
    if (man?.state === "ok" && (touches("a192") || touches("a512") || touches("mask"))) edits.push({ path: man.path!, what: "manifest_icons" });
    if (man?.state === "ok" && touches("mono")) edits.push({ path: man.path!, what: "manifest_mono" });
    if (man?.state !== "ok") edits.push({ path: layout, what: "layout_theme" });
  } else {
    const html = `${f.root}index.html`;
    if (items.some((i) => ["ico", "svg", "apple"].includes(i.key))) edits.push({ path: html, what: "html_links" });
    if (touches("manifest")) edits.push({ path: html, what: "html_manifest" });
    if (man?.state === "ok" && touches("mono")) edits.push({ path: man.path!, what: "manifest_mono" });
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
export function manifestText(f: Framework, name: string, theme: string, at: (k: GenKey) => string, pub: string): string {
  const url = (k: GenKey) => `/${at(k).slice(pub.length + 1)}`;
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

/** The plan's files, made. */
export async function generate(o: Original, plan: Plan, opts: { name: string; theme: string | null; rows: Row[]; root: string }): Promise<GenFile[]> {
  const t = await tile(o);
  const out: GenFile[] = [];
  const f = { framework: plan.framework, root: opts.root };
  for (const it of plan.items) {
    let bytes: Buffer;
    switch (it.key) {
      case "ico": bytes = await ico(t); break;
      case "svg": bytes = o.bytes; break;
      case "apple": bytes = await opaque(t, 180); break;
      case "a192": bytes = await size(t, 192); break;
      case "a512": bytes = await size(t, 512); break;
      case "mask": bytes = await maskable(t); break;
      case "mono": bytes = await monochrome(o, t); break;
      case "og": bytes = await shareImage(t, opts.name, opts.theme); break;
      case "manifest": bytes = Buffer.from(manifestText(plan.framework, opts.name, opts.theme ?? DARK, (k) => placeOf(k, opts.rows, f), `${opts.root}public`)); break;
    }
    out.push({ key: it.key, path: it.path, bytes });
  }
  return out;
}

/** A stable name for a set: the original and the plan decide it. */
export const setId = (o: Original, plan: Plan): string =>
  createHash("sha256").update(o.bytes).update(JSON.stringify(plan.items)).digest("hex").slice(0, 16);

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
