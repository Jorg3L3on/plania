import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { motionTokens } from "@/components/arc/lib/motion-tokens";

// A count on Inicio that moves only when it changes. Inicio opens many times a day, so nothing plays on load: the new
// value rolls in from below in 200ms and the old one leaves upward, quicker. The grid cell keeps both in one place
// while they swap. Reduced motion: a plain crossfade.
export function Cifra({ value, className }: { value: number | string; className?: string }) {
  const reducido = useReducedMotion() ?? false;
  return (
    <span className={`inline-grid tabular-nums ${className ?? ""}`}>
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={String(value)}
          className="col-start-1 row-start-1"
          initial={reducido ? { opacity: 0 } : { opacity: 0, y: "40%", filter: `blur(${motionTokens.blur.subtle}px)` }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)", transitionEnd: { filter: "none" } }}
          exit={reducido ? { opacity: 0, transition: { duration: 0.1 } } : { opacity: 0, y: "-40%", transition: { duration: motionTokens.duration.exit, ease: [...motionTokens.ease.standard] } }}
          transition={{ duration: motionTokens.duration.standard, ease: [...motionTokens.ease.enter] }}
        >
          {value}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
