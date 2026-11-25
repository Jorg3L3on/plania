// PLA-I30-2: the nav is Inicio (the logo) · Compañía · Bandeja · Progreso · Máquina (PLA-I63-5: Brief moved into Compañía). On the machine the four sit in
// the header; on a phone they move to a bottom tab bar, so the header never overflows at 390 px.
// Presentational: the counts come in as props (test/compania-ui.test.ts renders it).
import { BuildingIcon, CpuIcon, FlameIcon, InboxIcon } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Link, NavLink } from "react-router";
import { motionTokens } from "@/components/arc/lib/motion-tokens";
import { Cifra } from "@/components/home/cifra";
import { PlaniaMark } from "@/components/plania-mark";
import { navItems } from "@/lib/compania";
import { words } from "@/lib/i18n";
import { SHELL } from "@/lib/shell-words";
import { cn } from "@/lib/utils";

const ICON: Record<string, typeof InboxIcon> = { "/ceo": BuildingIcon, "/inbox": InboxIcon, "/progreso": FlameIcon, "/machine": CpuIcon };

export type NavCounts = { inbox: number; chores: number };

// The counts watched all day. A new count rolls in (Cifra, 200ms); the badge grows in from 0.9 in 150ms when the first
// one arrives and leaves in 120ms when the last one goes. Once, never a loop: a ping on a page open all day wears.
const Badge = ({ to, counts }: { to: string; counts: NavCounts }) => {
  const w = words(SHELL);
  const reducido = useReducedMotion() ?? false;
  const bandeja = to === "/inbox";
  const n = bandeja ? counts.inbox : to === "/machine" ? counts.chores : 0;
  return (
    <AnimatePresence initial={false}>
      {n > 0 ? (
        <motion.span
          key="badge"
          className={cn(
            "inline-flex overflow-hidden rounded-full px-1.5 text-[11px] tabular-nums",
            bandeja ? "bg-orange-500 font-semibold text-white" : "bg-muted font-medium text-muted-foreground",
          )}
          aria-label={bandeja ? w.inboxWaiting(n) : w.choresWaiting(n)}
          initial={reducido ? { opacity: 0 } : { opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1, transition: { duration: 0.15, ease: [...motionTokens.ease.enter] } }}
          exit={{ opacity: 0, scale: reducido ? 1 : 0.9, transition: { duration: 0.12, ease: [...motionTokens.ease.standard] } }}
          data-badge={bandeja ? "bandeja" : "limpieza"}
        >
          <Cifra value={n} />
        </motion.span>
      ) : null}
    </AnimatePresence>
  );
};

export const Logo = () => (
  <Link to="/" aria-label={words(SHELL).home} className="flex min-h-9 shrink-0 items-center gap-2 font-display text-lg font-extrabold tracking-tight" data-nav="logo">
    <PlaniaMark className="size-6" />
    Plania
  </Link>
);

// The machine header's five links. Hidden on phones, where TabBar takes over.
export const HeaderNav = ({ counts }: { counts: NavCounts }) => (
  <nav aria-label={words(SHELL).navMain} className="hidden items-center gap-1 sm:flex" data-nav="header">
    {navItems().map(({ to, label }) => {
      const Icon = ICON[to]!;
      return (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) =>
            cn(
              "inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition hover:text-foreground",
              isActive ? "bg-foreground text-background" : "text-muted-foreground",
            )
          }
        >
          <Icon className="size-4" aria-hidden />
          {label}
          <Badge to={to} counts={counts} />
        </NavLink>
      );
    })}
  </nav>
);

// The phone's bottom tab bar: five destinations, no "Más".
export const TabBar = ({ counts }: { counts: NavCounts }) => (
  <nav
    aria-label={words(SHELL).navMain}
    data-nav="tabs"
    className="fixed inset-x-0 bottom-0 z-20 border-t bg-background/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-md sm:hidden"
  >
    <ul className="grid grid-cols-4">
      {navItems().map(({ to, label }) => {
        const Icon = ICON[to]!;
        return (
          <li key={to}>
            <NavLink
              to={to}
              className={({ isActive }) =>
                cn("flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium", isActive ? "text-foreground" : "text-muted-foreground")
              }
            >
              <span className="relative">
                <Icon className="size-5" aria-hidden />
                <span className="absolute -top-1.5 left-3.5">
                  <Badge to={to} counts={counts} />
                </span>
              </span>
              {label}
            </NavLink>
          </li>
        );
      })}
    </ul>
  </nav>
);
