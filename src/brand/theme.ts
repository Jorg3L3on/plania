// PLA-I69-1: the app's colour follows the logo. For a logo the owner chose (upload, an Artist mark, a version gone
// back to), the theme colour of the manifest and the share image's background come from that logo: the background it
// was set on, or its main colour. A logo Plania only found in the repo leaves the repo's own colour alone.
export type ThemeSource = { chosen: boolean; colors: string[]; adjust?: { bg?: string | null } | null };

const HEX = /^#[0-9a-f]{6}$/i;

export function logoTheme(l: ThemeSource | null | undefined): string | null {
  if (!l || !l.chosen) return null;
  const bg = l.adjust?.bg;
  if (bg && HEX.test(bg)) return bg.toLowerCase();
  const c = l.colors.find((x) => HEX.test(x));
  return c ? c.toLowerCase() : null;
}

export const sameColor = (a: string | null | undefined, b: string | null | undefined): boolean =>
  !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
