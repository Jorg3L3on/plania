// PLA-I69-4: colour math for the brand's style. OKLCH (Björn Ottosson's OKLab) for scales that keep their hue, and
// WCAG 2.2 contrast. The screen has the same math in ui/src/lib/color.ts (test/i69-estilo checks they agree).
const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const unlin = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
export const HEX = /^#[0-9a-f]{6}$/i;
const rgb = (h: string): [number, number, number] => {
  const n = parseInt(h.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};
const hex = (r: number[]) => "#" + r.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, "0")).join("");

export function toLch(h: string): [number, number, number] {
  const [r, g, b] = rgb(h).map(lin) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(a, bb), ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360];
}

/** An OKLCH colour as hex, the chroma lowered until it fits sRGB. */
export function fromLch(L: number, C: number, H: number): string {
  for (let c = C; c >= 0; c -= 0.005) {
    const a = c * Math.cos((H * Math.PI) / 180), b = c * Math.sin((H * Math.PI) / 180);
    const l_ = L + 0.3963377774 * a + 0.2158037573 * b, m_ = L - 0.1055613458 * a - 0.0638541728 * b, s_ = L - 0.0894841775 * a - 1.291485548 * b;
    const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
    const out = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s].map(unlin);
    if (out.every((v) => v >= -0.001 && v <= 1.001)) return hex(out);
  }
  return hex([L, L, L]);
}

/** oklch(L C H) or oklch(L% C H) as written in CSS, as hex; null when it is not one. */
export function oklchCss(v: string): string | null {
  const m = v.trim().match(/^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)/i);
  if (!m) return null;
  return fromLch(m[2] ? Number(m[1]) / 100 : Number(m[1]), Number(m[3]), Number(m[4]));
}

const lum = (h: string) => {
  const [r, g, b] = rgb(h).map(lin) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export const contrast = (a: string, b: string): number => {
  const x = lum(a), y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
/** White or near-black, whichever reads better on c. */
export const onColor = (c: string): string => (contrast(c, "#ffffff") >= contrast(c, "#111111") ? "#ffffff" : "#111111");

export const STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;
const LS = [0.975, 0.94, 0.88, 0.8, 0.7, 0.6, 0.52, 0.44, 0.36, 0.28, 0.21];
/** Eleven steps of one colour, light to dark, its hue kept and its chroma eased at both ends. */
export function scale(h: string): string[] {
  const [, C, H] = toLch(h);
  return LS.map((L, i) => fromLch(L, C * (i === 0 || i === 10 ? 0.35 : i < 2 || i > 8 ? 0.7 : 1), H));
}
/** How far apart two colours look (OKLab distance; under ~0.06 they read as the same colour). */
export function distance(a: string, b: string): number {
  const [L1, C1, H1] = toLch(a), [L2, C2, H2] = toLch(b);
  const a1 = C1 * Math.cos((H1 * Math.PI) / 180), b1 = C1 * Math.sin((H1 * Math.PI) / 180);
  const a2 = C2 * Math.cos((H2 * Math.PI) / 180), b2 = C2 * Math.sin((H2 * Math.PI) / 180);
  return Math.hypot(L1 - L2, a1 - a2, b1 - b2);
}
