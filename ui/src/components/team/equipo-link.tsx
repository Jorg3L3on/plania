import { UsersIcon } from "lucide-react";
import { NavLink, useNavigate } from "react-router";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export const EquipoLink = () => (
  <NavLink
    to="/equipo"
    aria-label="Equipo"
    className={({ isActive }) =>
      cn(
        "inline-flex min-h-9 items-center gap-1.5 rounded-full px-2.5 text-[13px] font-medium transition hover:text-foreground sm:px-3",
        isActive ? "bg-foreground text-background" : "text-muted-foreground",
      )
    }
  >
    <UsersIcon className="size-4" aria-hidden />
    <span className="hidden sm:inline">Equipo</span>
  </NavLink>
);

export const EquipoMenuItem = () => {
  const navigate = useNavigate();
  const handleSelect = () => navigate("/equipo");
  return (
    <DropdownMenuItem onSelect={handleSelect}>
      <UsersIcon /> Equipo
    </DropdownMenuItem>
  );
};
