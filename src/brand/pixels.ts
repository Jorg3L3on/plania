// PLA-I66-3: the three tests every logo goes through before it becomes the original (an upload now, Artist's marks in
// PLA-I66-5), on its pixels at 128 × 128:
//   small    it reads at 16 px: strokes thinner than a pixel at 16 px vanish (a morphological opening removes them;
//            more than a fifth of the drawing lost fails)
//   circle   it fits Android's crop: the drawing stays within 40 % of the width from the centre
//   contrast 3 : 1 between the drawing and its background (WCAG 1.4.11 for graphics)
// The drawing is told from the background by comparing the tile with the background alone; a tile with no background
// is judged on Compañía's dark surface.
export type Rgba = { width: number; height: number; data: Uint8Array };
export type PixelTest = { ok: boolean; v: number };
export type PixelTests = { small: PixelTest; circle: PixelTest; contrast: PixelTest };

export const SIZE = 128;
export const DARK: [number, number, number] = [12, 12, 16];
const LOST_MAX = 0.2;
const REACH_MAX = 0.4;
const CONTRAST_MIN = 3;

function lum(r: number, g: number, b: number): number {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** Erode or dilate with an octagon about 4 px across (square and cross steps in turn). */
function morph(m: Uint8Array, n: number, erode: boolean): Uint8Array {
  let cur = m;
  for (const kind of ["sq", "x", "sq", "x"]) {
    const out = new Uint8Array(n * n);
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        let v = erode ? 1 : 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            if (kind === "x" && dx && dy) continue;
            const xx = x + dx, yy = y + dy;
            const s = xx < 0 || yy < 0 || xx >= n || yy >= n ? 0 : cur[yy * n + xx]!;
            if (erode ? !s : s) v = erode ? 0 : 1;
          }
        out[y * n + x] = v;
      }
    cur = out;
  }
  return cur;
}

/**
 * The tests on a tile and, when it has one, its background alone (both SIZE × SIZE RGBA). Without a background the
 * drawing is what is not see-through, judged against the dark surface.
 */
export function pixelTests(tile: Rgba, bg: Rgba | null): PixelTests {
  const n = SIZE;
  if (tile.width !== n || tile.height !== n || (bg && (bg.width !== n || bg.height !== n))) throw new Error("pixel tests need 128 × 128 images");
  const t = tile.data;
  const m = new Uint8Array(n * n);
  let gR = 0, gG = 0, gB = 0, gN = 0, bR = 0, bG = 0, bB = 0, bN = 0, maxR = 0;
  for (let i = 0; i < n * n; i++) {
    const k = i * 4;
    let ink: boolean;
    if (bg) {
      const b = bg.data;
      ink = Math.abs(t[k]! - b[k]!) + Math.abs(t[k + 1]! - b[k + 1]!) + Math.abs(t[k + 2]! - b[k + 2]!) > 60;
    } else ink = t[k + 3]! > 128;
    if (ink) {
      m[i] = 1;
      gR += t[k]!; gG += t[k + 1]!; gB += t[k + 2]!; gN++;
      const x = i % n, y = (i / n) | 0;
      maxR = Math.max(maxR, Math.hypot(x + 0.5 - n / 2, y + 0.5 - n / 2) / n);
    } else if (bg) {
      bR += bg.data[k]!; bG += bg.data[k + 1]!; bB += bg.data[k + 2]!; bN++;
    }
  }
  if (!gN) return { small: { ok: false, v: 1 }, circle: { ok: true, v: 0 }, contrast: { ok: false, v: 1 } };
  const opened = morph(morph(m, n, true), n, false);
  let lost = 0;
  for (let i = 0; i < n * n; i++) if (m[i] && !opened[i]) lost++;
  const lostF = lost / gN;
  const lg = lum(gR / gN, gG / gN, gB / gN);
  const lb = bg && bN ? lum(bR / bN, bG / bN, bB / bN) : lum(...DARK);
  const contrast = (Math.max(lg, lb) + 0.05) / (Math.min(lg, lb) + 0.05);
  return {
    small: { ok: lostF <= LOST_MAX, v: Math.round(lostF * 100) / 100 },
    circle: { ok: maxR <= REACH_MAX, v: Math.round(maxR * 1000) / 1000 },
    contrast: { ok: contrast >= CONTRAST_MIN, v: Math.round(contrast * 10) / 10 },
  };
}

/** The colours of a picture worth offering as a background: the most common colourful ones, then dark and light. */
export function palette(img: Rgba, max = 3): string[] {
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  const d = img.data;
  for (let i = 0; i < d.length; i += 16) {
    if (d[i + 3]! < 200) continue;
    const r = d[i]!, g = d[i + 1]!, b = d[i + 2]!;
    const hi = Math.max(r, g, b), lo = Math.min(r, g, b);
    if (hi - lo < 40 || hi < 50 || lo > 235) continue;
    const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
    const e = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    e.n++; e.r += r; e.g += g; e.b += b;
    buckets.set(key, e);
  }
  const hex = (v: number) => Math.round(v).toString(16).padStart(2, "0");
  return [...buckets.values()]
    .sort((a, b) => b.n - a.n)
    .slice(0, max)
    .map((e) => `#${hex(e.r / e.n)}${hex(e.g / e.n)}${hex(e.b / e.n)}`);
}
