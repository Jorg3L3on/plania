import { useQuery, useQueryClient } from "@tanstack/react-query";
import { InboxIcon, KeyRoundIcon, LogOutIcon } from "lucide-react";
import { Link, NavLink, Outlet, useNavigate } from "react-router";
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
          <span className={cn("size-2 rounded-full", connected ? "bg-status-done" : "bg-status-idle")}>
            {connected && <span className="block size-2 animate-ping rounded-full bg-status-done/60" />}
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

// The inbox link carries how many things wait for Jorge; live changes refresh it.
function InboxLink() {
  const inbox = useQuery({ queryKey: ["inbox"], queryFn: () => api.inbox(), staleTime: 15_000 });
  const n = inbox.data?.count ?? 0;
  return (
    <NavLink
      to="/inbox"
      className={({ isActive }) =>
        cn(
          "inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition hover:text-foreground",
          isActive ? "bg-foreground text-background" : "text-muted-foreground",
        )
      }
    >
      <InboxIcon className="size-4" aria-hidden />
      Bandeja
      {n > 0 && (
        <span className="rounded-full bg-orange-500 px-1.5 text-[11px] font-semibold text-white" aria-label={`${n} pendientes`}>{n}</span>
      )}
    </NavLink>
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
      <div className="relative isolate min-h-svh overflow-x-clip bg-background">
        {/* Two slow, blurred colour fields give the ground some depth. Decorative only. */}
        <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
          <div className="absolute -top-44 -left-36 size-[620px] animate-orb-drift rounded-full bg-[radial-gradient(closest-side,var(--orb-1),transparent)]" />
          <div className="absolute top-32 -right-52 size-[700px] animate-orb-drift rounded-full bg-[radial-gradient(closest-side,var(--orb-2),transparent)] [animation-delay:-4s]" />
        </div>
        <header className="sticky top-0 z-10 border-b bg-background/70 backdrop-blur-md">
          <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-10">
            <Link to="/" className="font-display text-lg font-extrabold tracking-tight">Plania</Link>
            <div className="flex items-center gap-2">
              <InboxLink />
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link to="/tokens" aria-label="Tokens de agentes" className="inline-flex size-9 items-center justify-center rounded-full text-muted-foreground hover:text-foreground">
                    <KeyRoundIcon className="size-4" />
                  </Link>
                </TooltipTrigger>
                <TooltipContent>Tokens de agentes</TooltipContent>
              </Tooltip>
              <LiveIndicator />
              <ThemeToggle />
              <Button variant="ghost" size="icon" aria-label="Salir" onClick={logout}>
                <LogOutIcon />
              </Button>
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-8 sm:px-10">
          <Outlet />
        </main>
      </div>
    </LiveProvider>
  );
}
