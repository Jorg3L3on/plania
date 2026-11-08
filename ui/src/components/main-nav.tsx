// PLA-I30-2: the nav is Inicio (the logo) · Compañía · Bandeja · Progreso · Máquina. On the Mac the four sit in
// the header; on a phone they move to a bottom tab bar, so the header never overflows at 390 px.
// Presentational: the counts come in as props (test/compania-ui.test.ts renders it).
import { BuildingIcon, CpuIcon, FlameIcon, InboxIcon } from "lucide-react";
import { Link, NavLink } from "react-router";
import { PlaniaMark } from "@/components/plania-mark";
import { NAV } from "@/lib/compania";
import { cn } from "@/lib/utils";

const ICON: Record<string, typeof InboxIcon> = { "/ceo": BuildingIcon, "/inbox": InboxIcon, "/progreso": FlameIcon, "/machine": CpuIcon };

export type NavCounts = { inbox: number; chores: number };

const Badge = ({ to, counts }: { to: string; counts: NavCounts }) => {
  if (to === "/inbox" && counts.inbox > 0)
    return (
      <span className="rounded-full bg-orange-500 px-1.5 text-[11px] font-semibold text-white tabular-nums" aria-label={`${counts.inbox} pendientes`}>
        {counts.inbox}
      </span>
    );
  if (to === "/machine" && counts.chores > 0)
    return (
      <span className="rounded-full bg-muted px-1.5 text-[11px] font-medium text-muted-foreground tabular-nums" aria-label={`${counts.chores} por limpiar`}>
        {counts.chores}
      </span>
    );
  return null;
};

export const Logo = () => (
  <Link to="/" aria-label="Inicio" className="flex min-h-9 shrink-0 items-center gap-2 font-display text-lg font-extrabold tracking-tight" data-nav="logo">
    <PlaniaMark className="size-6" />
    Plania
  </Link>
);

// The Mac header's four links. Hidden on phones, where TabBar takes over.
export const HeaderNav = ({ counts }: { counts: NavCounts }) => (
  <nav aria-label="Principal" className="hidden items-center gap-1 sm:flex" data-nav="header">
    {NAV.map(({ to, label }) => {
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

// The phone's bottom tab bar: four destinations, no "Más".
export const TabBar = ({ counts }: { counts: NavCounts }) => (
  <nav
    aria-label="Principal"
    data-nav="tabs"
    className="fixed inset-x-0 bottom-0 z-20 border-t bg-background/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-md sm:hidden"
  >
    <ul className="grid grid-cols-4">
      {NAV.map(({ to, label }) => {
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
