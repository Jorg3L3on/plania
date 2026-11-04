import { useState } from "react";
import { projectColor } from "@/lib/progress";
import { cn } from "@/lib/utils";

export const recapGlass =
  "rounded-[26px] border border-white/10 bg-gradient-to-b from-white/[0.07] to-white/[0.03] shadow-[inset_0_1px_0_rgb(255_255_255/0.08)]";

export const recapKicker = "text-[11px] font-extrabold tracking-[0.18em] text-[#8e8e98] uppercase";

type ChipProps = { slug: string; children: React.ReactNode; className?: string };

export const ProjectChip = ({ slug, children, className }: ChipProps) => {
  const color = projectColor(slug);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-extrabold",
        className,
      )}
      style={{
        color,
        backgroundColor: `color-mix(in srgb, ${color} 16%, transparent)`,
        borderColor: `color-mix(in srgb, ${color} 32%, transparent)`,
      }}
    >
      <span className="size-1.5 rounded-full" style={{ background: color, boxShadow: `0 0 8px ${color}` }} aria-hidden />
      {children}
    </span>
  );
};

type ShotProps = { src: string | null; label: string; tone: "before" | "after"; alt: string };

// A missing or broken link drops the frame. The card around it stays put.
export const Shot = ({ src, label, tone, alt }: ShotProps) => {
  const [hidden, setHidden] = useState(!src);
  const handleError = () => setHidden(true);
  if (hidden || !src) return null;
  const badge = tone === "before" ? "bg-[#7f1d1d] text-[#fecaca]" : "bg-[#064e3b] text-[#a7f3d0]";
  return (
    <div
      className={cn(
        "relative min-h-40 flex-1 overflow-hidden rounded-2xl border border-white/10",
        tone === "before" ? "bg-[radial-gradient(90%_80%_at_50%_0%,#451a1a,#0a0a0d)]" : "bg-[radial-gradient(90%_80%_at_50%_0%,#064e3b,#0a0a0d)]",
      )}
    >
      <span className={cn("absolute top-2 left-2 z-10 rounded-md px-1.5 py-0.5 text-[9px] font-black tracking-[0.14em]", badge)}>{label}</span>
      <img src={src} alt={alt} loading="lazy" decoding="async" onError={handleError} className="h-52 w-full object-cover object-top" />
    </div>
  );
};
