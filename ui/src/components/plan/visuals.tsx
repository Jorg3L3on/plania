// Small visual vocabulary shared by the project page and the index (direction A, "Noche"):
// three glyphs (check = done, pulsing dot = now, hollow circle = pending), flow arrows and a progress ring.
import { CheckIcon } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import type { LaneState, StationTone } from "@/lib/lanes";
import { cn } from "@/lib/utils";

// Literal class names per tone so Tailwind generates every one of them.
export const TONE_BG: Record<StationTone, string> = {
  done: "bg-status-done",
  now: "bg-status-now",
  review: "bg-status-review",
  blocked: "bg-status-blocked",
  ready: "bg-status-ready",
  pending: "bg-status-pending",
};

export const TONE_TEXT: Record<StationTone, string> = {
  done: "text-status-done",
  now: "text-status-now",
  review: "text-status-review",
  blocked: "text-status-blocked",
  ready: "text-status-ready",
  pending: "text-muted-foreground",
};

const TONE_VAR: Record<StationTone, string> = {
  done: "var(--status-done)",
  now: "var(--status-now)",
  review: "var(--status-review)",
  blocked: "var(--status-blocked)",
  ready: "var(--status-ready)",
  pending: "var(--status-pending)",
};
export const toneVar = (tone: StationTone) => TONE_VAR[tone];

// Spanish words for statuses on the redesigned screen; the side panel keeps the stored values.
const WORD: Record<string, string> = {
  Backlog: "pendiente",
  Ready: "listo",
  "In progress": "en curso",
  "In review": "en revisión",
  Blocked: "bloqueado",
  Done: "hecho",
  "Won't do": "descartado",
  Planning: "planeando",
  Active: "activa",
  Shipping: "saliendo",
  "On hold": "en pausa",
};
export const statusWord = (status: string) => WORD[status] ?? status.toLowerCase();

export const LANE_STATE: Record<LaneState, { word: string; tone: StationTone }> = {
  moving: { word: "en marcha", tone: "now" },
  blocked: { word: "bloqueada", tone: "blocked" },
  waiting: { word: "esperando", tone: "pending" },
  paused: { word: "en pausa", tone: "pending" },
};

/** Short label for a station: "F1" from "F1 · Migración…", else the first words of the title. */
export function shortLabel(title: string): string {
  const head = title.split(/\s+[·:—-]\s+/)[0] ?? title;
  if (head.length <= 18) return head;
  return title.split(/\s+/).slice(0, 2).join(" ");
}

/** The one dot that says where a lane is. Only "now" pulses, and only when asked. */
export function Glyph({ tone, size = 18, pulse = false, className }: { tone: StationTone; size?: number; pulse?: boolean; className?: string }) {
  const style: CSSProperties = { width: size, height: size };
  if (tone === "done") {
    return (
      <span aria-hidden style={style} className={cn("inline-flex shrink-0 items-center justify-center rounded-full bg-status-done", className)}>
        <CheckIcon className="text-background" strokeWidth={4} style={{ width: size * 0.6, height: size * 0.6 }} />
      </span>
    );
  }
  if (tone === "pending") {
    return <span aria-hidden style={style} className={cn("inline-block shrink-0 rounded-full border-2 border-status-pending", className)} />;
  }
  if (tone === "ready") {
    return <span aria-hidden style={style} className={cn("inline-block shrink-0 rounded-full border-2 border-status-ready", className)} />;
  }
  return (
    <span
      aria-hidden
      style={style}
      className={cn("inline-block shrink-0 rounded-full", TONE_BG[tone], pulse && "animate-station-pulse", className)}
    />
  );
}

/** Arrow between columns. Moving lanes get marching dashes; still lanes a dotted, quiet arrow. */
export function FlowArrow({ tone, moving, className }: { tone: StationTone; moving: boolean; className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 44 44"
      className={cn("size-11 shrink-0", className)}
      fill="none"
      stroke={moving ? toneVar(tone) : "var(--status-pending)"}
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 22 H33" className={moving ? "flow-dash" : undefined} strokeDasharray={moving ? undefined : "3 6"} />
      <path d="M27 14 L36 22 L27 30" />
    </svg>
  );
}

/** Down arrow for the stacked phone layout. */
export function FlowArrowDown({ tone, moving }: { tone: StationTone; moving: boolean }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 44 36"
      className="mx-auto h-9 w-11"
      fill="none"
      stroke={moving ? toneVar(tone) : "var(--status-pending)"}
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M22 3 V26" className={moving ? "flow-dash" : undefined} strokeDasharray={moving ? undefined : "3 6"} />
      <path d="M14 20 L22 29 L30 20" />
    </svg>
  );
}

const RING_R = 28;
const RING_C = 2 * Math.PI * RING_R;

export function ProgressRing({ closed, total, size = 72 }: { closed: number; total: number; size?: number }) {
  const ratio = total === 0 ? 0 : closed / total;
  return (
    <svg viewBox="0 0 72 72" width={size} height={size} className="shrink-0 -rotate-90" role="img" aria-label={`${closed} de ${total} tickets cerrados`}>
      <circle cx="36" cy="36" r={RING_R} fill="none" stroke="currentColor" strokeWidth="7" className="text-foreground/10" />
      {total > 0 && (
        <circle
          cx="36"
          cy="36"
          r={RING_R}
          fill="none"
          stroke="var(--status-done)"
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={RING_C}
          strokeDashoffset={RING_C * (1 - ratio)}
          className="animate-ring-fill"
          style={{ "--ring-length": `${RING_C}px` } as CSSProperties}
        />
      )}
    </svg>
  );
}

/** Uppercase column or section label with an optional glyph. */
export function Kicker({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("inline-flex items-center gap-2 text-[11px] font-bold tracking-[0.14em] uppercase", className)}>{children}</span>;
}

/** Staggered entrance: index → animation delay. Runs once on mount, never on live refetches. */
export const rise = (i: number): CSSProperties => ({ animationDelay: `${Math.min(i, 12) * 70}ms` });

// One accent per project, stable by slug, for the stripe and kicker.
const ACCENTS: [string, string][] = [
  ["#ff5fa2", "#ffb347"],
  ["#3ddc97", "#5ec8ff"],
  ["#ffb347", "#ff6b8a"],
  ["#b094ff", "#5ec8ff"],
  ["#5ec8ff", "#3ddc97"],
  ["#ff6b8a", "#b094ff"],
];
export function projectAccent(slug: string): [string, string] {
  let h = 0;
  for (const ch of slug) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return ACCENTS[h % ACCENTS.length]!;
}
