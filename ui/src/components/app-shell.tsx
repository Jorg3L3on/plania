import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BellIcon, CloudOffIcon, EllipsisIcon, KeyRoundIcon, LogOutIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Outlet, useNavigate } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { HeaderNav, Logo, TabBar } from "@/components/main-nav";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ThemeChoices } from "@/components/theme-toggle";
import { api } from "@/lib/api";
import { disablePush, enablePush, PushError, pushHint, pushStatus, type PushStatus } from "@/lib/push";
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

// 2.12: "Avisarme cuando me toque" — web push for this device. The tap itself asks for permission
// (iOS only prompts for a gesture); the item keeps the menu open so the switch shows the result.
function PushSwitch() {
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void pushStatus().then(setStatus).catch(() => setStatus({ state: "unsupported", reason: "browser" }));
  }, []);
  const on = status?.state === "on";
  const usable = status?.state === "on" || status?.state === "off";
  async function toggle() {
    if (!usable || busy) return;
    setBusy(true);
    try {
      const next = on ? await disablePush() : await enablePush();
      setStatus(next);
      if (next.state === "on") toast("Te avisaremos en este dispositivo");
      else if (!on && next.state !== "off") toast.error(pushHint(next) ?? "No se activaron los avisos.");
    } catch (e) {
      toast.error(e instanceof PushError ? e.message : "No se pudieron cambiar los avisos.");
    } finally {
      setBusy(false);
    }
  }
  const hint = status ? pushHint(status) : null;
  return (
    <DropdownMenuItem
      onSelect={(e) => {
        e.preventDefault();
        void toggle();
      }}
      disabled={!usable || busy}
      className="flex-wrap"
    >
      <BellIcon />
      <span className="flex-1">Avisarme cuando me toque</span>
      <Switch checked={on} tabIndex={-1} aria-hidden className="pointer-events-none" />
      {hint && <span className="basis-full pl-6 text-xs text-muted-foreground">{hint}</span>}
    </DropdownMenuItem>
  );
}

// PLA-I30-2: everything that is not one of the four destinations lives in this menu, on every width:
// agent tokens (the old key icon), push, theme and logout.
function MoreMenu({ onLogout }: { onLogout: () => void }) {
  const navigate = useNavigate();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Más">
          <EllipsisIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-64">
        <DropdownMenuItem onSelect={() => navigate("/tokens")}>
          <KeyRoundIcon /> Tokens de agentes
        </DropdownMenuItem>
        <PushSwitch />
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

export function AppShell() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  // The Bandeja badge and Máquina's quiet Limpieza count; live changes refresh them.
  const inbox = useQuery({ queryKey: ["inbox"], queryFn: () => api.inbox(), staleTime: 15_000 });
  const counts = { inbox: inbox.data?.count ?? 0, chores: inbox.data?.chores ?? 0 };

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
            <Logo />
            <div className="flex min-w-0 items-center gap-1 sm:gap-2">
              <HeaderNav counts={counts} />
              <LiveIndicator />
              <MoreMenu onLogout={logout} />
            </div>
          </div>
          <OfflineBanner />
        </header>
        <main className="mx-auto max-w-[1480px] gutter pt-5 tiny:pt-2 pb-[calc(4.5rem+env(safe-area-inset-bottom))] sm:pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          <Outlet />
        </main>
        <TabBar counts={counts} />
      </div>
    </LiveProvider>
  );
}
