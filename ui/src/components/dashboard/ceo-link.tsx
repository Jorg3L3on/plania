import { LayoutDashboardIcon } from "lucide-react";
import { NavLink } from "react-router";
import { cn } from "@/lib/utils";

export const CeoLink = () => (
  <NavLink
    to="/ceo"
    aria-label="CEO"
    className={({ isActive }) =>
      cn(
        "inline-flex min-h-9 items-center gap-1.5 rounded-full px-2.5 text-[13px] font-medium transition hover:text-foreground sm:px-3",
        isActive ? "bg-foreground text-background" : "text-muted-foreground",
      )
    }
  >
    <LayoutDashboardIcon className="size-4" aria-hidden />
    <span className="hidden sm:inline">CEO</span>
  </NavLink>
);
