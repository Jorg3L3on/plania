import { useQueryClient } from "@tanstack/react-query";
import { LogOutIcon } from "lucide-react";
import { Link, Outlet, useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ThemeToggle } from "@/components/theme-toggle";
import { api } from "@/lib/api";
import { LiveProvider, useLive } from "@/lib/live";
import { cn } from "@/lib/utils";

function LiveIndicator() {
  const { connected } = useLive();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
          <span className={cn("size-2 rounded-full", connected ? "bg-emerald-500" : "bg-zinc-400")}>
            {connected && <span className="block size-2 animate-ping rounded-full bg-emerald-500/60" />}
          </span>
          {connected ? "En vivo" : "Reconectando"}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {connected ? "Los cambios de los agentes aparecen al instante." : "Sin conexión en vivo; reintentando."}
      </TooltipContent>
    </Tooltip>
  );
}

export function AppShell() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  async function logout() {
    await api.logout();
    queryClient.clear();
    navigate("/login", { replace: true });
  }

  return (
    <LiveProvider>
      <div className="min-h-svh bg-background">
        <header className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur">
          <div className="mx-auto flex h-14 max-w-4xl items-center justify-between px-4">
            <Link to="/" className="font-semibold tracking-tight">Plania</Link>
            <div className="flex items-center gap-2">
              <LiveIndicator />
              <ThemeToggle />
              <Button variant="ghost" size="icon" aria-label="Salir" onClick={logout}>
                <LogOutIcon />
              </Button>
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-4xl px-4 py-8">
          <Outlet />
        </main>
      </div>
    </LiveProvider>
  );
}
