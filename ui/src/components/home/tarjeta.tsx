// The two cards that share Inicio's last row, La máquina and Metas, read the same way: a green kicker for a title (an
// icon and the name, as La máquina's always was) that is only a title, and the way to the module at the foot in the
// same green, «Ver la máquina» or «Ver metas». One look for both, so neither card outranks the other.
import { ArrowRightIcon, type LucideIcon } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { Kicker } from "@/components/plan/visuals";
import { motionTokens } from "@/components/arc/lib/motion-tokens";
import { Cifra } from "./cifra";

/** The card's title: green, small capitals, its icon. A heading, never a link. */
export function TituloTarjeta({ id, icon: Icon, children }: { id: string; icon: LucideIcon; children: ReactNode }) {
  return (
    <h2 id={id} className="m-0">
      <Kicker className="text-ink-done">
        <Icon className="size-3.5" aria-hidden />
        {children}
      </Kicker>
    </h2>
  );
}

/**
 * The way to the card's module, at its foot, in the title's green. The arrow nudges 2px on hover (mouse only). An
 * optional amber count sits before the arrow (La máquina's warnings), fading and scaling in from 0.9 when it appears;
 * `etiqueta` then names the count for screen readers.
 */
export function EnlaceVer({ to, children, cuenta = 0, etiqueta }: { to: string; children: ReactNode; cuenta?: number; etiqueta?: string }) {
  const reducido = useReducedMotion() ?? false;
  return (
    <Link
      to={to}
      aria-label={etiqueta}
      className="group inline-flex min-h-11 w-fit items-center gap-1.5 rounded-sm text-[13px] font-semibold text-ink-done focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:min-h-8 [@media(hover:hover)_and_(pointer:fine)]:hover:underline"
    >
      {children}
      <AnimatePresence initial={false}>
        {cuenta > 0 ? (
          <motion.span
            key="cuenta"
            aria-hidden
            className="inline-grid h-[18px] min-w-[18px] place-items-center rounded-full bg-status-now px-1.5 text-[11px] leading-none font-bold text-[#1b1300] tabular-nums"
            initial={{ opacity: 0, scale: reducido ? 1 : 0.9 }}
            animate={{ opacity: 1, scale: 1, transition: { duration: motionTokens.duration.standard, ease: [...motionTokens.ease.enter] } }}
            exit={{ opacity: 0, scale: reducido ? 1 : 0.9, transition: { duration: motionTokens.duration.exit } }}
          >
            <Cifra value={cuenta} />
          </motion.span>
        ) : null}
      </AnimatePresence>
      <ArrowRightIcon className="size-3.5 transition-transform duration-150 ease-out motion-reduce:transition-none [@media(hover:hover)_and_(pointer:fine)]:group-hover:translate-x-0.5" aria-hidden />
    </Link>
  );
}
