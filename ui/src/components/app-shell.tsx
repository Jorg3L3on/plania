import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CloudOffIcon, EllipsisIcon, InboxIcon, KeyRoundIcon, LogOutIcon } from "lucide-react";
import { Link, NavLink, Outlet, useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PlaniaMark } from "@/components/plania-mark";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ThemeChoices, ThemeToggle } from "@/components/theme-toggle";
import { api } from "@/lib/api";
import { LiveProvider, useLive } from "@/lib/live";
import { cn } from "@/lib/utils";

// On a phone only the dot shows; the label stays for screen readers.
function LiveIndicator() {
  const { connected, online } = useLive();
  const label = !online ? "Sin conexión" : connected ? "En vivo" : "Reconectando";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="flex min-h-9 items-center gap-1.5 px-1 text-xs text-muted-foreground" role="status">
          <span className={cn("size-2 rounded-full", connected && online ? "bg-status-done" : "bg-status-idle")}>
            {connected && online && <span className="block size-2 animate-ping rounded-full bg-status-done/60" />}
          </span>
          <span className="sr-only sm:not-sr-only">{label}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {!online
          ? "El dispositivo no tiene red."
          : connected ? "Los cambios de los agentes aparecen al instante." : "Sin conexión en vivo; reintentando."}
      </TooltipContent>
    </Tooltip>
  );
}

// Shown under the header while the device has no network; the cached app still opens.
function OfflineBanner() {
  const { online } = useLive();
  if (online) return null;
  return (
    <div className="flex items-center justify-center gap-2 border-b bg-status-idle/15 px-4 py-1.5 text-xs text-muted-foreground" role="status">
      <CloudOffIcon className="size-3.5" aria-hidden />
      Sin conexión: los datos pueden estar desactualizados.
    </div>
  );
}

// Phones get one menu for what the desktop header shows as separate icons.
function PhoneMenu({ onLogout }: { onLogout: () => void }) {
  const navigate = useNavigate();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Más" className="sm:hidden">
          <EllipsisIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        <DropdownMenuItem onSelect={() => navigate("/tokens")}>
          <KeyRoundIcon /> Tokens de agentes
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Tema</DropdownMenuLabel>
        <ThemeChoices />
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onLogout}>
          <LogOutIcon /> Salir
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
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
        {/* In a home-screen app the page runs under the status bar and beside the notch: pad for both. */}
        <header className="sticky top-0 z-10 border-b bg-background/70 pt-[env(safe-area-inset-top)] backdrop-blur-md">
          <div className="mx-auto flex h-12 max-w-[1480px] items-center justify-between gap-2 gutter">
            <Link to="/" className="flex min-h-9 items-center gap-2 font-display text-lg font-extrabold tracking-tight">
              <PlaniaMark className="size-6" />
              Plania
            </Link>
            <div className="flex items-center gap-1 sm:gap-2">
              <InboxLink />
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link to="/tokens" aria-label="Tokens de agentes" className="hidden size-9 items-center justify-center rounded-full text-muted-foreground hover:text-foreground sm:inline-flex">
                    <KeyRoundIcon className="size-4" />
                  </Link>
                </TooltipTrigger>
                <TooltipContent>Tokens de agentes</TooltipContent>
              </Tooltip>
              <LiveIndicator />
              <div className="hidden sm:contents">
                <ThemeToggle />
                <Button variant="ghost" size="icon" aria-label="Salir" onClick={logout}>
                  <LogOutIcon />
                </Button>
              </div>
              <PhoneMenu onLogout={logout} />
            </div>
          </div>
          <OfflineBanner />
        </header>
        <main className="mx-auto max-w-[1480px] gutter pt-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          <Outlet />
        </main>
      </div>
    </LiveProvider>
  );
}
