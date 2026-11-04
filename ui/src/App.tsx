import { useQuery } from "@tanstack/react-query";
import { CloudOffIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router";
import { AppShell } from "@/components/app-shell";
import { PlaniaMark } from "@/components/plania-mark";
import { Button } from "@/components/ui/button";
import { api, isUnauthorized } from "@/lib/api";
import { useOnline } from "@/lib/live";
import { AhoraPage } from "@/pages/ahora";
import { InboxPage } from "@/pages/inbox";
import { LoginPage } from "@/pages/login";
import { MachinePage } from "@/pages/machine";
import { GoalsPage } from "@/components/goals/goals-page";
import { HomePage } from "@/pages/home";
import { ProjectPage } from "@/pages/project";
import { TokensPage } from "@/pages/tokens";
import { EquipoPage } from "@/pages/equipo";

// What the cached app shows when the server can't be reached, e.g. a home-screen launch with no network.
// It retries on its own when the network comes back.
function Unreachable({ retry, retrying }: { retry: () => void; retrying: boolean }) {
  const online = useOnline();
  const wasOffline = useRef(!online);
  useEffect(() => {
    if (!online) wasOffline.current = true;
    else if (wasOffline.current) {
      wasOffline.current = false;
      retry();
    }
  }, [online, retry]);
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 bg-background px-6 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] text-center">
      <PlaniaMark className="size-12" />
      <p className="flex items-center gap-2 font-display text-xl font-bold tracking-tight">
        {!online && <CloudOffIcon className="size-5 text-muted-foreground" aria-hidden />}
        {online ? "No se pudo conectar con Plania" : "Sin conexión"}
      </p>
      <p className="max-w-xs text-sm text-muted-foreground">
        {online ? "El servidor no responde. Revisa que esté encendido." : "Plania vuelve en cuanto haya red."}
      </p>
      <Button variant="outline" onClick={retry} disabled={retrying}>{retrying ? "Reintentando…" : "Reintentar"}</Button>
    </div>
  );
}

// Sends anyone without a valid session to /login, remembering where they were going.
function RequireSession({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const session = useQuery({ queryKey: ["session"], queryFn: api.session, retry: false, staleTime: 60_000 });
  if (session.isPending) return null;
  if (session.isError) {
    if (isUnauthorized(session.error)) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
    return <Unreachable retry={session.refetch} retrying={session.isFetching} />;
  }
  return <>{children}</>;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireSession><AppShell /></RequireSession>}>
        <Route index element={<HomePage />} />
        <Route path="/ahora" element={<AhoraPage />} />
        <Route path="/p/:slug" element={<ProjectPage />} />
        <Route path="/goals" element={<GoalsPage />} />
        <Route path="/inbox" element={<InboxPage />} />
        <Route path="/machine" element={<MachinePage />} />
        <Route path="/equipo" element={<EquipoPage />} />
        <Route path="/tokens" element={<TokensPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
