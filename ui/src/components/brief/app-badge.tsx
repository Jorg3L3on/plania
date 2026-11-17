// PLA-I42-2: an app's dot and badge in its slot color (theme vars --brief-c0…c5, other = muted; no hex).
// The class names are written out so Tailwind sees them.
import { cn } from "@/lib/utils";
import type { BriefApp, Slot } from "@/lib/brief";

export const SLOT_BG: Record<Slot, string> = {
  c0: "bg-brief-c0",
  c1: "bg-brief-c1",
  c2: "bg-brief-c2",
  c3: "bg-brief-c3",
  c4: "bg-brief-c4",
  c5: "bg-brief-c5",
  other: "bg-brief-other",
};

export function AppDot({ slot, className }: { slot: Slot; className?: string }) {
  return <span aria-hidden className={cn("inline-block size-2 shrink-0 rounded-full", SLOT_BG[slot], className)} />;
}

export function AppBadge({ app }: { app: BriefApp | undefined }) {
  if (!app) return null;
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-xs font-medium" data-brief-app={app.id}>
      <AppDot slot={app.color} />
      {app.name}
    </span>
  );
}
