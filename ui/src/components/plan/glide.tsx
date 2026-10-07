// When an agent moves a ticket over MCP, its card glides to the new column instead of jumping,
// and glows for a moment. layoutId pairs the old and new card; scope keeps two views of the
// same ticket (the grid and the phone stack) from claiming the same id.
import { motion } from "motion/react";
import type { ReactNode } from "react";
import { useLive } from "@/lib/live";
import { cn } from "@/lib/utils";

const SPRING = { type: "spring", stiffness: 380, damping: 34, mass: 0.8 } as const;

export function Glide({
  slug,
  taskKey,
  scope,
  className,
  children,
}: {
  slug: string;
  taskKey: string;
  scope: string;
  className?: string;
  children: ReactNode;
}) {
  const { isFresh } = useLive();
  const fresh = isFresh(slug, taskKey);
  return (
    <motion.div
      layoutId={`${scope}:${taskKey}`}
      layout="position"
      transition={SPRING}
      data-fresh={fresh || undefined}
      className={cn(
        "rounded-xl transition-shadow duration-700",
        fresh && "shadow-[0_0_0_2px_var(--status-now),0_0_28px_color-mix(in_oklab,var(--status-now)_45%,transparent)]",
        className,
      )}
    >
      {children}
    </motion.div>
  );
}
