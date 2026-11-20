// PLA-I66-1: the projects' real logos on the screen. GET /api/company/logos says which projects have one (found in
// their repo, uploaded or chosen); ProjectMark draws it, and a project's colours come from it. Pure, so it is tested
// without a browser; the query that fills it lives in ProjectMark (@/components/plania-mark).

export type LogoRef = {
  v: number;
  file: string;
  mime: "image/svg+xml" | "image/png";
  variant: "icon" | "mark";
  colors: string[];
  source: "repo" | "upload" | "artist";
  path: string | null;
};

let current: Record<string, LogoRef> = {};

/** What the last read said; called by the query when it lands. */
export function setLogos(logos: Record<string, LogoRef>): void {
  current = logos ?? {};
}
export const logoOf = (slug: string): LogoRef | undefined => current[slug];

/** The logo's address; the version in it makes a changed logo a new URL, so caches never show the old one. */
export const logoUrl = (slug: string, ref: LogoRef): string => `/api/company/projects/${encodeURIComponent(slug)}/logo?v=${ref.v}`;

const HEX = /^#[0-9a-f]{6}$/i;
function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function luminance([r, g, b]: [number, number, number]): number {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** A logo colour made readable as text on the dark surfaces: mixed toward white until it is light enough. */
export function readableOnDark(hex: string): string {
  if (!HEX.test(hex)) return hex;
  let c = rgb(hex);
  for (let i = 0; i < 10 && luminance(c) < 0.2; i++) c = c.map((v) => v + (255 - v) * 0.18) as [number, number, number];
  return `#${c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
}

/** The two gradient stops from a logo (one colour twice when it has one), or null when it gave none. */
export function logoGradient(ref: LogoRef | undefined): [string, string] | null {
  const cs = (ref?.colors ?? []).filter((c) => HEX.test(c));
  if (cs.length === 0) return null;
  return [cs[0]!, cs[1] ?? cs[0]!];
}
