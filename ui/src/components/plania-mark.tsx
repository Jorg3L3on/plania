import { useId, type ReactNode } from "react";

import { cn } from "@/lib/utils";

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

// Each project's own mark, by slug (from the logo export: the bare mark, not the app-icon tile).
const PROJECTS: Record<string, Brand> = {
  // An F drawn as a film strip, with sprocket holes punched along it.
  filmia: {
    from: "#FF6A3D",
    accent: "#FF6A3D",
    to: "#C4237F",
    glyph: (
      <>
        <g {...stroke}>
          <path d="M22 18V84" />
          <path d="M22 18H80" />
          <path d="M22 50H64" />
        </g>
        <g fill="#000">
          <rect x="18" y="30" width="8" height="6" rx="1.5" />
          <rect x="18" y="39" width="8" height="6" rx="1.5" />
          <rect x="18" y="62" width="8" height="6" rx="1.5" />
          <rect x="18" y="71" width="8" height="6" rx="1.5" />
          <rect x="40" y="14" width="6" height="8" rx="1.5" />
          <rect x="52" y="14" width="6" height="8" rx="1.5" />
          <rect x="64" y="14" width="6" height="8" rx="1.5" />
        </g>
      </>
    ),
    shade: { d: "M14 34L30 18V54L14 70Z", opacity: 0.16 },
  },
  // A roof over an M.
  micasa: {
    from: "#2563EB",
    accent: "#7B8CFF",
    to: "#8B3FD9",
    glyph: (
      <>
        <path d="M10 44L50 12L90 44" {...stroke} />
        <path d="M22 90V56L50 78L78 56V90" {...stroke} />
      </>
    ),
  },
  // A W of three people, arms up.
  workia: {
    from: "#19C8A0",
    accent: "#19C8A0",
    to: "#0B7FA6",
    glyph: (
      <>
        <path d="M14 30L30 84L50 52L70 84L86 30" {...stroke} />
        <circle cx="14" cy="12" r="8" fill="#fff" />
        <circle cx="86" cy="12" r="8" fill="#fff" />
        <circle cx="50" cy="32" r="8" fill="#fff" />
      </>
    ),
    shade: { d: "M6 40L22 24L38 78L24 90Z", opacity: 0.14 },
  },
  // A receipt with a Z cut through it.
  zigzag: {
    from: "#FFB224",
    accent: "#FFB224",
    to: "#E8482E",
    glyph: (
      <>
        <path
          d="M22 10L30 16L38 10L46 16L54 10L62 16L70 10L78 16V84L70 90L62 84L54 90L46 84L38 90L30 84L22 90Z"
          fill="#fff"
          stroke="#fff"
          strokeWidth="4"
          strokeLinejoin="round"
        />
        <path d="M34 36H66L34 64H66" fill="none" stroke="#000" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
      </>
    ),
  },
};

export function PlaniaMark({ className }: { className?: string }) {
  return <BrandMark brand={PLANIA} className={className} />;
}

/** The project's logo, or nothing for a project without one. */
export function ProjectMark({ slug, className }: { slug: string; className?: string }) {
  const brand = PROJECTS[slug];
  return brand ? <BrandMark brand={brand} className={cn("shrink-0", className)} /> : null;
}

export const hasProjectMark = (slug: string) => slug in PROJECTS;

/** The project's accent taken from its logo, when it has one. */
export const projectBrandAccent = (slug: string): string | undefined => PROJECTS[slug]?.accent;
