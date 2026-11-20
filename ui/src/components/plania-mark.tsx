import { useId, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";

import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { logoGradient, logoOf, logoUrl, readableOnDark, setLogos, type LogoRef } from "@/lib/logos";

// A brand mark: a glyph cut from a two-stop gradient, with an optional darker shade cut from
// the same glyph. Ids are scoped per instance so several marks on one page don't share (and
// break) each other's gradient.
// `accent` is the brand hue as the UI uses it for stripes and names: readable as text on the dark card.
type Brand = { from: string; to: string; accent?: string; glyph: ReactNode; shade?: { d: string; opacity: number } };

function BrandMark({ brand, className }: { brand: Brand; className?: string }) {
  const id = useId();
  const gradient = `${id}-g`;
  const mask = `${id}-m`;
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden>
      <defs>
        <linearGradient id={gradient} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={brand.from} />
          <stop offset="1" stopColor={brand.to} />
        </linearGradient>
        <mask id={mask} maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100">
          {brand.glyph}
        </mask>
      </defs>
      <rect width="100" height="100" fill={`url(#${gradient})`} mask={`url(#${mask})`} />
      {brand.shade && <path d={brand.shade.d} fill="#000" opacity={brand.shade.opacity} mask={`url(#${mask})`} />}
    </svg>
  );
}

const stroke = { fill: "none", stroke: "#fff", strokeWidth: 16, strokeLinecap: "round", strokeLinejoin: "round" } as const;

// The Plania mark: a bar and three pills.
const PLANIA: Brand = {
  from: "#5B6CFF",
  to: "#9B3BE0",
  glyph: (
    <>
      <rect x="14" y="12" width="16" height="76" rx="8" fill="#fff" />
      <rect x="36" y="12" width="40" height="14" rx="7" fill="#fff" />
      <rect x="50" y="31" width="38" height="14" rx="7" fill="#fff" />
      <rect x="36" y="50" width="40" height="14" rx="7" fill="#fff" />
    </>
  ),
};

// PLA-I2-3: no project's logo lives in the product. Plania is the one built-in mark; every other project gets a
// monogram in colours derived from its slug, so a new project has a mark without a code change.
const PROJECTS: Record<string, Brand> = {
  // PLA-I51-1: Plania is a project too; its violet accent stays apart from the fallback pairs.
  plania: { ...PLANIA, accent: "#a58bff" },
};

export function PlaniaMark({ className }: { className?: string }) {
  return <BrandMark brand={PLANIA} className={className} />;
}

// PLA-I51-1: the colour pairs a project without a logo takes (Inicio's accents, one per slug, stable).
export const FALLBACK_ACCENTS: [string, string][] = [
  ["#ff5fa2", "#ffb347"],
  ["#3ddc97", "#5ec8ff"],
  ["#ffb347", "#ff6b8a"],
  ["#b094ff", "#5ec8ff"],
  ["#5ec8ff", "#3ddc97"],
  ["#ff6b8a", "#b094ff"],
];
export function fallbackAccent(slug: string): [string, string] {
  let h = 0;
  for (const ch of slug) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return FALLBACK_ACCENTS[h % FALLBACK_ACCENTS.length]!;
}

/** A monogram tile for a project with no logo yet: its first letter in a rounded frame, in its fallback colours. */
function monogram(slug: string, name?: string): Brand {
  const [from, to] = fallbackAccent(slug);
  const letter = (name ?? slug).trim().slice(0, 1).toUpperCase() || "?";
  return {
    from,
    to,
    glyph: (
      <>
        <rect x="8" y="8" width="84" height="84" rx="24" fill="none" stroke="#fff" strokeWidth="9" />
        <text x="50" y="71" textAnchor="middle" fontFamily="Bricolage Grotesque Variable, Geist Variable, sans-serif" fontWeight="800" fontSize="58" fill="#fff">
          {letter}
        </text>
      </>
    ),
  };
}

// PLA-I51-1: the brief's "Entre apps" row (cross-app): two rings, in a neutral grey.
const CROSS: Brand = {
  from: "#c6cbdb",
  to: "#7d86a3",
  glyph: (
    <>
      <circle cx="36" cy="50" r="23" fill="none" stroke="#fff" strokeWidth="13" />
      <circle cx="64" cy="50" r="23" fill="none" stroke="#fff" strokeWidth="13" />
    </>
  ),
};

export function CrossMark({ className }: { className?: string }) {
  return <BrandMark brand={CROSS} className={cn("shrink-0", className)} />;
}

// PLA-I66-1: the projects' real logos, read once for the whole screen (every ProjectMark shares the query).
function useLogos(): Record<string, LogoRef> {
  const q = useQuery({
    queryKey: ["logos"],
    queryFn: () =>
      api.logos().then((r) => {
        setLogos(r.logos);
        return r.logos;
      }),
    staleTime: 60_000,
    refetchInterval: 120_000,
  });
  return q.data ?? {};
}

/**
 * The project's mark: its own logo when Plania has one (found in its repo, uploaded or chosen; PLA-I66-1), else
 * Plania's built-in mark for Plania, else a monogram in its slug's colours (PLA-I2-3: every project has one).
 */
export function ProjectMark({ slug, className, name }: { slug: string; className?: string; fallback?: boolean; name?: string }) {
  const logo = useLogos()[slug];
  if (logo) {
    return (
      <img
        src={logoUrl(slug, logo)}
        alt=""
        aria-hidden
        draggable={false}
        data-logo={logo.source}
        className={cn("shrink-0", logo.variant === "icon" ? "rounded-[22%] object-cover" : "object-contain", className)}
      />
    );
  }
  const brand = PROJECTS[slug] ?? monogram(slug, name);
  return <BrandMark brand={brand} className={cn("shrink-0", className)} />;
}

export const hasProjectMark = (_slug: string) => true;

/** The project's accent taken from its logo, when it has one (made readable on the dark surfaces). */
export const projectBrandAccent = (slug: string): string | undefined => {
  const g = logoGradient(logoOf(slug));
  return g ? readableOnDark(g[0]) : PROJECTS[slug]?.accent;
};

/** The project's two gradient stops (its logo's, else its fallback pair), for bands and stripes. */
export const projectGradient = (slug: string): [string, string] => {
  const g = logoGradient(logoOf(slug));
  if (g) return g;
  const b = PROJECTS[slug];
  return b ? [b.from, b.to] : fallbackAccent(slug);
};
