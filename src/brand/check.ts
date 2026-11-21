// PLA-I66-2: the icon files a project's repo has, file by file, read from a commit. Pure over a view of the tree (paths
// and a reader), so the rules are tested with fake repos. It knows where each framework expects the files: Next.js
// with the App Router (app/ or src/app/, files linked by convention or by metadata in the layout), and Vite or a plain
// site (public/ plus the links in index.html). A monorepo's app one or two folders down is found too.
// Each row says in the repo, missing or wrong, with the reason; the pixel checks (opaque, safe zone) read the PNGs.
import { createHash } from "node:crypto";
import path from "node:path";
import { readPng } from "./png.js";
import { looksLikeLogo } from "./detect.js";

export type Face = "nav" | "ios" | "and" | "pwa" | "share" | "cia" | "more";
// PLA-128: viejo, a sound file made from an older logo than the one Plania keeps now (set by the read, src/brand/marca.ts).
export type RowState = "ok" | "falta" | "mal" | "viejo";
export type RowId = "ico" | "svg" | "apple" | "splash" | "man" | "a192" | "a512" | "mask" | "mono" | "og" | "pl" | "ios_app" | "and_app" | "badge" | "short" | "shots" | "test";
// PLA-I69-3: «Más caras», the surfaces an app may also use, each behind a switch (settings.marca.extras).
export type Extra = "avisos" | "atajos" | "capturas" | "prueba";
// A check or a note is a code and its values; the screen words them in the install's language (ui/src/lib/marca.ts).
export type Check = { k: string; ok: boolean; v?: Record<string, string | number> };
export type Note = { k: string; v?: Record<string, string | number> };
export type Row = { id: RowId; face: Face; state: RowState; path: string | null; optional?: boolean; size?: string; note?: Note; checks: Check[] };
export type Framework = "next-app" | "vite" | "static";
export type RepoView = { paths: Map<string, number>; read: (p: string) => Promise<Buffer | null> };
export type RepoCheck = { framework: Framework; root: string; rows: Row[] };

// The favicons app generators ship (a project that never changed it has no icon of its own).
// sha256 of the favicon.ico that create-next-app writes.
export const TEMPLATE_ICO = new Set(["c28fdd2a4f31e2dc64f653962286da5c82a4cdfc518b242d32812c624e9a19a4"]);
export const SAFE_ZONE = 0.4;
// PLA-I66-6: the iPhone and iPad portrait launch-screen sizes (the device list pwa-asset-generator ships, MIT).
export const SPLASH_SIZES: [number, number][] = [
  [1320, 2868], [1206, 2622], [1290, 2796], [1179, 2556], [1284, 2778], [1170, 2532], [1125, 2436], [1242, 2688], [828, 1792], [1242, 2208],
  [750, 1334], [640, 1136], [1260, 2736], [2048, 2732], [1668, 2388], [1640, 2360], [1488, 2266], [1536, 2048], [2064, 2752],
];

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const ok = (k: string, v?: Check["v"]): Check => ({ k, ok: true, ...(v ? { v } : {}) });
const no = (k: string, v?: Check["v"]): Check => ({ k, ok: false, ...(v ? { v } : {}) });

/** The sizes inside an .ico file. */
export function icoSizes(b: Buffer): number[] {
  if (b.length < 6 || b.readUInt16LE(0) !== 0 || b.readUInt16LE(2) !== 1) return [];
  const n = b.readUInt16LE(4);
  const out: number[] = [];
  for (let i = 0; i < n && 6 + 16 * i + 16 <= b.length; i++) out.push(b[6 + 16 * i] || 256);
  return [...new Set(out)].sort((a, c) => a - c);
}

/** Every pixel fully opaque (null when the PNG could not be decoded). */
export function opaque(b: Buffer): boolean | null {
  const p = readPng(b);
  if (!p?.rgba) return null;
  for (let i = 3; i < p.rgba.length; i += 4) if (p.rgba[i]! < 255) return false;
  return true;
}

/**
 * How far the drawing reaches from the centre, as a share of the width. The background is read from the four corners
 * and blended across the tile (a flat colour or a gradient); pixels far from it are the drawing.
 */
export function reach(b: Buffer): number | null {
  const p = readPng(b);
  if (!p?.rgba) return null;
  const { width: w, height: h, rgba } = p;
  const at = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    return [rgba[i]!, rgba[i + 1]!, rgba[i + 2]!];
  };
  const k = Math.max(1, Math.floor(w / 64));
  const corner = (cx: number, cy: number) => {
    const s = [0, 0, 0];
    let n = 0;
    for (let y = 0; y < k; y++)
      for (let x = 0; x < k; x++) {
        const c = at(Math.min(w - 1, cx + x), Math.min(h - 1, cy + y));
        s[0]! += c[0]!; s[1]! += c[1]!; s[2]! += c[2]!; n++;
      }
    return s.map((v) => v / n);
  };
  const tl = corner(0, 0), tr = corner(w - k, 0), bl = corner(0, h - k), br = corner(w - k, h - k);
  let max = 0;
  const step = Math.max(1, Math.floor(w / 256));
  for (let y = 0; y < h; y += step)
    for (let x = 0; x < w; x += step) {
      const u = x / (w - 1), v = y / (h - 1);
      const i = (y * w + x) * 4;
      let d = 0;
      for (let ch = 0; ch < 3; ch++) {
        const bg = (1 - u) * (1 - v) * tl[ch]! + u * (1 - v) * tr[ch]! + (1 - u) * v * bl[ch]! + u * v * br[ch]!;
        d += Math.abs(rgba[i + ch]! - bg);
      }
      if (d > 90 && rgba[i + 3]! > 128) max = Math.max(max, Math.hypot(x + 0.5 - w / 2, y + 0.5 - h / 2) / w);
    }
  return max;
}

type Manifest = { file: string; name?: string; shortName?: string; theme?: string; background?: string; display?: string; icons: { src: string; sizes: string; purpose: string }[] };

/** A web manifest from JSON or from Next's manifest.ts (read as text: the keys and the icon objects). */
export function parseManifest(file: string, text: string): Manifest {
  if (/\.(json|webmanifest)$/.test(file)) {
    try {
      const j = JSON.parse(text) as Record<string, unknown>;
      const icons = Array.isArray(j.icons) ? (j.icons as Record<string, unknown>[]) : [];
      return {
        file,
        name: typeof j.name === "string" ? j.name : undefined,
        shortName: typeof j.short_name === "string" ? j.short_name : undefined,
        theme: typeof j.theme_color === "string" ? j.theme_color : undefined,
        background: typeof j.background_color === "string" ? j.background_color : undefined,
        display: typeof j.display === "string" ? j.display : undefined,
        icons: icons.map((i) => ({ src: String(i.src ?? ""), sizes: String(i.sizes ?? ""), purpose: String(i.purpose ?? "any") })),
      };
    } catch {
      return { file, icons: [] };
    }
  }
  // PLA-126: a key with or without quotes (name: …, "name": …), so the manifest.ts Plania writes reads back.
  const K = (k: string) => `(?:\\b${k}|(['"])${k}\\1)`;
  const key = (k: string) => {
    const m = text.match(new RegExp(`${K(k)}\\s*:\\s*(?:(['"\`])([^'"\`]*)\\2|([A-Za-z_$][\\w$.]*))`));
    return m ? (m[3] ?? m[4]) : undefined; // a constant's name stands for a value set in code
  };
  const field = (body: string, k: string) => body.match(new RegExp(`${K(k)}\\s*:\\s*(['"\`])([^'"\`]+)\\2`))?.[3];
  const icons = [...text.matchAll(new RegExp(`\\{[^{}]*?${K("src")}\\s*:\\s*(['"\`])([^'"\`]+)\\2[^{}]*\\}`, "g"))].map((m) => ({
    src: m[3]!,
    sizes: field(m[0], "sizes") ?? "",
    purpose: field(m[0], "purpose") ?? "any",
  }));
  // Shortcut icons live under "shortcuts"; only the top-level icons count.
  const top = text.split(/(?:\bshortcuts|["']shortcuts["'])\s*:/)[0]!;
  return { file, name: key("name"), shortName: key("short_name"), theme: key("theme_color"), background: key("background_color"), display: key("display"), icons: icons.filter((i) => top.includes(i.src)) };
}

/** Where the app lives: the folder holding an app/ folder with a layout (Next) or an index.html (Vite or plain). */
function findRoot(paths: Map<string, number>): { root: string; framework: Framework; appDir: string | null } {
  const skip = /(^|\/)(node_modules|dist|build|out|coverage|test|tests|e2e|fixtures?|docs?|public|examples?)\//;
  const dirs = [...paths.keys()].filter((p) => /^([^/]+\/){0,2}(package\.json|index\.html)$/.test(p) && !skip.test(p)).map((p) => p.replace(/(package\.json|index\.html)$/, ""));
  const roots = [...new Set(["", ...dirs.sort((a, b) => a.length - b.length)])];
  for (const root of roots)
    for (const app of ["src/app", "app"]) if (["layout.tsx", "layout.jsx", "layout.ts", "layout.js"].some((l) => paths.has(`${root}${app}/${l}`))) return { root, framework: "next-app", appDir: `${root}${app}` };
  const vite = (r: string) => ["vite.config.ts", "vite.config.js", "vite.config.mts", "vite.config.mjs"].some((f) => paths.has(`${r}${f}`) || paths.has(f));
  for (const root of roots) if (paths.has(`${root}index.html`)) return { root, framework: vite(root) ? "vite" : "static", appDir: null };
  return { root: "", framework: "static", appDir: null };
}

/** The icon files of the repo, as rows. hasOriginal: Plania keeps an original for the project (the Company row). */
export async function checkRepo(view: RepoView, opts: { hasOriginal: boolean; slug: string; native?: boolean; extras?: Partial<Record<Extra, boolean>> }): Promise<RepoCheck> {
  const { paths } = view;
  const { root, framework, appDir } = findRoot(paths);
  const pub = `${root}public`;
  const has = (p: string | null | undefined): p is string => !!p && paths.has(p);
  const first = (...ps: (string | null)[]) => ps.find((p) => has(p)) ?? null;
  const read = async (p: string | null) => (p && has(p) ? view.read(p) : null);
  const fromPublic = (url: string) => (url.startsWith("http") ? null : `${pub}/${url.replace(/^\.?\//, "").split(/[?#]/)[0]}`);

  const layoutPath = appDir ? first(...["layout.tsx", "layout.jsx", "layout.ts", "layout.js"].map((l) => `${appDir}/${l}`)) : null;
  const layout = (await read(layoutPath))?.toString("utf8") ?? "";
  const htmlPath = first(`${root}index.html`);
  const html = (await read(htmlPath))?.toString("utf8") ?? "";
  const linkHref = (rel: RegExp) => [...html.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]).find((l) => rel.test(l.match(/\brel\s*=\s*["']([^"']+)/i)?.[1] ?? ""))?.match(/\bhref\s*=\s*["']([^"']+)/i)?.[1];
  const rows: Row[] = [];

  // favicon.ico
  {
    const p = first(appDir && `${appDir}/favicon.ico`, `${pub}/favicon.ico`, `${root}favicon.ico`);
    if (!p) rows.push({ id: "ico", face: "nav", state: "falta", path: appDir ? `${appDir}/favicon.ico` : `${pub}/favicon.ico`, checks: [no("exists")] });
    else {
      const b = (await read(p))!;
      const sizes = icoSizes(b);
      const copies = [...paths.keys()].filter((q) => q !== p && q.startsWith(root) && /(^|\/)favicon\.ico$/.test(q));
      const same: string[] = [];
      for (const q of copies) if (sha((await read(q)) ?? Buffer.alloc(0)) === sha(b)) same.push(q);
      const template = TEMPLATE_ICO.has(sha(b));
      const checks = [ok("exists"), sizes.includes(16) && sizes.includes(32) ? ok("ico_sizes", { sizes: sizes.join(", ") }) : no("ico_sizes_missing", { sizes: sizes.join(", ") })];
      if (template) checks.push(no("template"));
      rows.push({
        id: "ico",
        face: "nav",
        state: template || !sizes.includes(32) ? "mal" : "ok",
        path: p,
        size: sizes.join(" · "),
        note: same.length ? { k: "copies", v: { n: same.length + 1, list: [p, ...same].join(", ") } } : undefined,
        checks,
      });
    }
  }

  // icon.svg
  {
    const conv = appDir ? first(`${appDir}/icon.svg`) : null;
    const linked = appDir
      ? [...layout.matchAll(/['"`](\/[^'"`]+\.svg)['"`]/g)].map((m) => fromPublic(m[1]!)).find((q) => has(q) && /icons?\s*:/.test(layout))
      : (() => {
          const href = linkHref(/\bicon\b/i);
          const q = href && /\.svg($|\?)/.test(href) ? fromPublic(href) : null;
          return has(q) ? q : undefined;
        })();
    const p = conv ?? linked ?? null;
    if (p) rows.push({ id: "svg", face: "nav", state: "ok", path: p, checks: [ok("exists"), ok(conv ? "linked_conv" : "linked")] });
    else {
      const loose = [...paths.keys()].filter((q) => q.startsWith(pub + "/") && q.endsWith(".svg") && looksLikeLogo(q, opts.slug)).sort((a, b) => a.length - b.length)[0];
      rows.push({
        id: "svg",
        face: "nav",
        state: "falta",
        path: loose ?? (appDir ? `${appDir}/icon.svg` : `${pub}/icon.svg`),
        note: loose ? { k: "svg_unlinked", v: { path: loose } } : undefined,
        checks: loose ? [ok("exists"), no("linked")] : [no("exists")],
      });
    }
  }

  // apple-touch-icon
  {
    const conv = appDir ? first(`${appDir}/apple-icon.png`) : null;
    const meta = appDir ? layout.match(/apple\s*:\s*[[{]?\s*\{?\s*(?:url\s*:\s*)?['"`]([^'"`]+\.png)/)?.[1] : linkHref(/apple-touch-icon/i);
    const p = conv ?? first(meta ? fromPublic(meta) : null, `${pub}/apple-touch-icon.png`);
    if (!p) rows.push({ id: "apple", face: "ios", state: "falta", path: appDir ? `${appDir}/apple-icon.png` : `${pub}/apple-touch-icon.png`, checks: [no("exists")] });
    else {
      const b = (await read(p))!;
      const png = readPng(b);
      const op = opaque(b);
      const size = png ? `${png.width} × ${png.height}` : "?";
      const sizeOk = png?.width === 180 && png.height === 180;
      const checks = [sizeOk ? ok("size", { want: "180 × 180" }) : no("size", { want: "180 × 180", got: size }), op === false ? no("opaque_ios") : ok("opaque")];
      rows.push({ id: "apple", face: "ios", state: op === false || !png ? "mal" : sizeOk ? "ok" : "mal", path: p, size, checks });
    }
  }

  // iOS launch screens (optional)
  {
    const splash = [...paths.keys()].filter((q) => q.startsWith(pub + "/") && /apple-splash|startup|launch/i.test(q) && q.endsWith(".png"));
    const linked = /startupImage/.test(layout) || /apple-touch-startup-image/i.test(html);
    // PLA-I66-6: with the native switch on, launch screens count, and the set must cover every device size.
    const need = !!opts.native;
    const full = splash.length >= SPLASH_SIZES.length;
    rows.push(
      splash.length && (linked || !html)
        ? { id: "splash", face: "ios", state: need && !full ? "mal" : "ok", optional: !need, path: path.dirname(splash[0]!) + "/", size: `${splash.length}`, checks: [ok("splash_count", { n: splash.length }), linked ? ok("linked") : no("linked"), ...(need ? [full ? ok("splash_full", { n: SPLASH_SIZES.length }) : no("splash_full", { n: SPLASH_SIZES.length })] : [])] }
        : { id: "splash", face: "ios", state: "falta", optional: !need, path: `${pub}/splash/`, checks: [no("exists")] },
    );
  }

  // manifest and its icons
  const manPath = first(...(appDir ? ["ts", "js", "json", "webmanifest"].map((e) => `${appDir}/manifest.${e}`) : []), `${pub}/manifest.webmanifest`, `${pub}/manifest.json`, `${pub}/site.webmanifest`);
  const man = manPath ? parseManifest(manPath, (await read(manPath))!.toString("utf8")) : null;
  {
    if (!man) rows.push({ id: "man", face: "pwa", state: "falta", path: appDir ? `${appDir}/manifest.ts` : `${pub}/manifest.webmanifest`, checks: [no("exists")] });
    else {
      const linked = !!appDir && manPath!.startsWith(appDir) ? true : appDir ? /manifest\s*:/.test(layout) : !!linkHref(/manifest/i);
      const checks = [
        man.name ? ok("man_name") : no("man_name"),
        man.theme && man.background ? ok("man_colors", { theme: man.theme, background: man.background }) : no("man_colors"),
        man.display && /standalone|fullscreen|minimal-ui|window-controls-overlay/.test(man.display) ? ok("man_display", { display: man.display }) : no("man_display"),
        linked ? ok("linked") : no("linked"),
      ];
      rows.push({ id: "man", face: "pwa", state: checks.every((c) => c.ok) ? "ok" : "mal", path: manPath, checks });
    }
  }
  const iconRow = async (id: "a192" | "a512", px: number) => {
    const entry = man?.icons.find((i) => i.sizes.split(/\s+/).includes(`${px}x${px}`) && i.purpose.split(/\s+/).includes("any"));
    const def = `${pub}/icons/icon-${px}.png`;
    if (!entry) return rows.push({ id, face: "and", state: "falta", path: def, checks: [no("in_manifest", { px })] });
    const p = fromPublic(entry.src);
    const b = await read(p);
    const png = b ? readPng(b) : null;
    if (!png) return rows.push({ id, face: "and", state: "mal", path: p ?? def, checks: [ok("in_manifest", { px }), no("png_file")] });
    const right = png.width === px && png.height === px;
    rows.push({ id, face: "and", state: right ? "ok" : "mal", path: p, size: `${png.width} × ${png.height}`, checks: [ok("in_manifest", { px }), right ? ok("size", { want: `${px} × ${px}` }) : no("size", { want: `${px} × ${px}`, got: `${png.width} × ${png.height}` })] });
  };
  await iconRow("a192", 192);
  await iconRow("a512", 512);
  {
    const entry = man?.icons.find((i) => i.purpose.split(/\s+/).includes("maskable"));
    const def = `${pub}/icons/icon-512-maskable.png`;
    if (!entry) rows.push({ id: "mask", face: "and", state: "falta", path: def, checks: [no("mask_entry")] });
    else {
      const p = fromPublic(entry.src);
      const b = await read(p);
      const checks: Check[] = [];
      let bad = false;
      if (entry.purpose.split(/\s+/).includes("any")) {
        checks.push(no("mask_own"));
        bad = true;
      } else checks.push(ok("mask_own"));
      let size: string | undefined;
      let r_: number | null = null;
      if (!b || !readPng(b)) {
        checks.push(no("png_file"));
        bad = true;
      } else {
        const op = opaque(b);
        const r = reach(b);
        r_ = r;
        if (op === false) { checks.push(no("opaque")); bad = true; } else checks.push(ok("opaque"));
        if (r !== null) {
          size = `${Math.round(r * 1000) / 10} %`;
          if (r > SAFE_ZONE) { checks.push(no("safe_zone", { pct: size })); bad = true; } else checks.push(ok("safe_zone", { pct: size }));
        }
      }
      rows.push({ id: "mask", face: "and", state: bad ? "mal" : "ok", path: p, size, note: !bad && r_ !== null && r_ > 0.37 ? { k: "mask_edge" } : undefined, checks });
    }
  }
  {
    const entry = man?.icons.find((i) => i.purpose.split(/\s+/).includes("monochrome"));
    const p = entry ? fromPublic(entry.src) : null;
    rows.push(
      entry && has(p)
        ? { id: "mono", face: "and", state: "ok", optional: true, path: p, checks: [ok("mono_entry")] }
        : { id: "mono", face: "and", state: "falta", optional: true, path: `${pub}/icons/icon-monochrome.png`, checks: [no("mono_entry")] },
    );
  }

  // share image
  {
    const conv = appDir ? first(...["png", "jpg", "jpeg", "tsx", "ts", "jsx", "js"].map((e) => `${appDir}/opengraph-image.${e}`)) : null;
    const metaOg = appDir ? /openGraph\s*:\s*\{[\s\S]*?images\s*:/.test(layout) : /property\s*=\s*["']og:image["']/i.test(html);
    if (conv && /\.(tsx|ts|jsx|js)$/.test(conv)) rows.push({ id: "og", face: "share", state: "ok", path: conv, note: { k: "og_code" }, checks: [ok("exists"), ok("og_code")] });
    else if (conv) {
      const png = readPng((await read(conv))!);
      const right = png ? Math.abs(png.width / png.height - 1.91) < 0.05 && png.width >= 1200 : true;
      rows.push({ id: "og", face: "share", state: right ? "ok" : "mal", path: conv, size: png ? `${png.width} × ${png.height}` : undefined, checks: [ok("exists"), right ? ok("size", { want: "1200 × 630" }) : no("size", { want: "1200 × 630", got: png ? `${png.width} × ${png.height}` : "?" })] });
    } else if (metaOg) rows.push({ id: "og", face: "share", state: "ok", path: layoutPath ?? htmlPath, checks: [ok("og_meta")] });
    else rows.push({ id: "og", face: "share", state: "falta", path: appDir ? `${appDir}/opengraph-image.png` : `${pub}/og.png`, checks: [no("exists")] });
  }

  if (opts.native) rows.push(...(await nativeRows(view, root)));
  // PLA-I69-3: the extra surfaces, only when the owner turned them on.
  const ex = opts.extras ?? {};
  const manText = man ? (await read(man.file))?.toString("utf8") ?? "" : "";
  if (ex.avisos) {
    const p = `${pub}/icons/badge-96.png`;
    const b = has(p) ? await read(p) : null;
    const png = b ? readPng(b) : null;
    const good = !!png && png.width === 96 && png.height === 96 && opaque(b!) === false;
    rows.push(png ? { id: "badge", face: "more", state: good ? "ok" : "mal", path: p, size: `${png.width} × ${png.height}`, checks: [ok("exists"), good ? ok("badge_ok") : no("badge_ok")] } : { id: "badge", face: "more", state: "falta", path: p, checks: [no("exists")] });
  }
  if (ex.atajos) {
    const shortcuts = /\bshortcuts\s*:|"shortcuts"\s*:/.test(manText);
    const block = manText.split(/\bshortcuts\s*:|"shortcuts"\s*:/)[1] ?? "";
    const named = (block.match(/\bname\s*:|"name"\s*:/g) ?? []).length;
    const withIcon = (block.match(/\bicons\s*:|"icons"\s*:/g) ?? []).length;
    const p = `${pub}/icons/shortcut-192.png`;
    if (!shortcuts) rows.push({ id: "short", face: "more", state: "ok", optional: true, path: null, note: { k: "short_none" }, checks: [ok("short_none")] });
    else rows.push(withIcon >= named ? { id: "short", face: "more", state: "ok", path: has(p) ? p : null, checks: [ok("short_icons", { n: named })] } : { id: "short", face: "more", state: "falta", path: p, checks: [no("short_icons", { n: named - withIcon })] });
  }
  if (ex.capturas) {
    const narrow = /form_factor["']?\s*:\s*["']narrow/.test(manText);
    const wide = /form_factor["']?\s*:\s*["']wide/.test(manText);
    rows.push(narrow && wide ? { id: "shots", face: "more", state: "ok", path: `${pub}/screenshots/`, checks: [ok("shots_narrow"), ok("shots_wide")] } : { id: "shots", face: "more", state: "falta", path: `${pub}/screenshots/`, checks: [narrow ? ok("shots_narrow") : no("shots_narrow"), wide ? ok("shots_wide") : no("shots_wide")] });
  }
  if (ex.prueba) {
    const p = `${pub}/icons/icon-prueba.png`;
    rows.push(has(p) ? { id: "test", face: "more", state: "ok", path: p, checks: [ok("exists")] } : { id: "test", face: "more", state: "falta", path: p, checks: [no("exists")] });
  }
  rows.push(
    opts.hasOriginal
      ? { id: "pl", face: "cia", state: "ok", path: null, checks: [ok("pl_kept"), ok("pl_used")] }
      : { id: "pl", face: "cia", state: "falta", path: null, note: { k: "pl_none" }, checks: [no("pl_kept")] },
  );
  return { framework, root, rows };
}

/** The kind of native app the repo holds, if any: Expo (app.json with expo) or Capacitor (capacitor.config). */
export async function nativeKind(view: RepoView, root: string): Promise<{ kind: "expo" | "capacitor" | null; app: Record<string, unknown> | null }> {
  const appJson = view.paths.has(`${root}app.json`) ? (await view.read(`${root}app.json`))?.toString("utf8") ?? "" : "";
  if (appJson) {
    try {
      const j = JSON.parse(appJson) as { expo?: Record<string, unknown> };
      if (j.expo) return { kind: "expo", app: j.expo };
    } catch {
      /* not JSON: not Expo's */
    }
  }
  if (["capacitor.config.ts", "capacitor.config.json", "capacitor.config.js"].some((f) => view.paths.has(`${root}${f}`))) return { kind: "capacitor", app: null };
  return { kind: null, app: null };
}

/** PLA-I66-6: the iOS app icon and the Android adaptive icon, read from Expo's app.json or Capacitor's projects. */
async function nativeRows(view: RepoView, root: string): Promise<Row[]> {
  const { kind, app } = await nativeKind(view, root);
  const rel = (p: unknown) => (typeof p === "string" ? `${root}${p.replace(/^\.\//, "")}` : null);
  const out: Row[] = [];
  const kindCheck: Check = kind ? ok(kind === "expo" ? "native_expo" : "native_capacitor") : no("native_app");
  // iOS: one 1024 px opaque square; the system makes the rest.
  {
    const ios = (app?.ios as Record<string, unknown> | undefined) ?? {};
    const appiconset = `${root}ios/App/App/Assets.xcassets/AppIcon.appiconset/`;
    const p = kind === "expo" ? rel(ios.icon ?? app?.icon) : kind === "capacitor" ? [...view.paths.keys()].find((f) => f.startsWith(appiconset) && f.endsWith(".png")) ?? null : null;
    const b = p && view.paths.has(p) ? await view.read(p) : null;
    const png = b ? readPng(b) : null;
    if (!png) out.push({ id: "ios_app", face: "ios", state: "falta", path: p ?? `${root}assets/icon.png`, note: kind ? undefined : { k: "web_only" }, checks: [kindCheck, no("exists")] });
    else {
      const right = png.width === 1024 && png.height === 1024;
      const op = opaque(b!);
      out.push({ id: "ios_app", face: "ios", state: right && op !== false ? "ok" : "mal", path: p, size: `${png.width} × ${png.height}`, checks: [kindCheck, right ? ok("size", { want: "1024 × 1024" }) : no("size", { want: "1024 × 1024", got: `${png.width} × ${png.height}` }), op === false ? no("opaque") : ok("opaque")] });
    }
  }
  // Android: a foreground over a background, plus a monochrome layer for themed icons.
  {
    const ad = ((app?.android as Record<string, unknown> | undefined)?.adaptiveIcon as Record<string, unknown> | undefined) ?? null;
    const xml = `${root}android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml`;
    if (kind === "expo") {
      const fg = rel(ad?.foregroundImage);
      const has = (q: string | null) => !!q && view.paths.has(q);
      const checks = [kindCheck, has(fg) ? ok("adaptive_fg") : no("adaptive_fg"), ad?.backgroundColor || has(rel(ad?.backgroundImage)) ? ok("adaptive_bg") : no("adaptive_bg"), has(rel(ad?.monochromeImage)) ? ok("adaptive_mono") : no("adaptive_mono")];
      out.push({ id: "and_app", face: "and", state: !has(fg) ? "falta" : checks.every((c) => c.ok) ? "ok" : "mal", path: fg ?? `${root}assets/adaptive-icon.png`, checks });
    } else if (kind === "capacitor" && view.paths.has(xml)) {
      const t = (await view.read(xml))?.toString("utf8") ?? "";
      const checks = [kindCheck, /<foreground/.test(t) ? ok("adaptive_fg") : no("adaptive_fg"), /<background/.test(t) ? ok("adaptive_bg") : no("adaptive_bg"), /<monochrome/.test(t) ? ok("adaptive_mono") : no("adaptive_mono")];
      out.push({ id: "and_app", face: "and", state: checks.every((c) => c.ok) ? "ok" : "mal", path: xml, checks });
    } else out.push({ id: "and_app", face: "and", state: "falta", path: kind === "capacitor" ? xml : `${root}assets/adaptive-icon.png`, note: kind ? undefined : { k: "web_only" }, checks: [kindCheck, no("exists")] });
  }
  return out;
}
