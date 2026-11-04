import { FlagIcon } from "lucide-react";
import { NavLink } from "react-router";
import { cn } from "@/lib/utils";

export function GoalsLink() {
  return (
    <NavLink
      to="/goals"
      aria-label="Metas"
      className={({ isActive }) =>
        cn(
          "hidden min-h-9 items-center gap-1.5 rounded-full px-2.5 text-[13px] font-medium transition hover:text-foreground sm:inline-flex sm:px-3",
          isActive ? "bg-foreground text-background" : "text-muted-foreground",
        )
      }
    >
      <FlagIcon className="size-4" aria-hidden />
      <span className="hidden sm:inline">Metas</span>
    </NavLink>
  );
}
