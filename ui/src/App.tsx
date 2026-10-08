import { useQuery } from "@tanstack/react-query";
import { Navigate, Route, Routes, useLocation } from "react-router";
import { AppShell } from "@/components/app-shell";
import { api, isUnauthorized } from "@/lib/api";
import { InboxPage } from "@/pages/inbox";
import { LoginPage } from "@/pages/login";
import { ProjectPage } from "@/pages/project";
import { ProjectsPage } from "@/pages/projects";
import { TokensPage } from "@/pages/tokens";

// Sends anyone without a valid session to /login, remembering where they were going.
function RequireSession({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const session = useQuery({ queryKey: ["session"], queryFn: api.session, retry: false, staleTime: 60_000 });
  if (session.isPending) return null;
  if (session.isError) {
    if (isUnauthorized(session.error)) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
    return <p className="p-8 text-sm text-destructive">No se pudo conectar con Plania.</p>;
  }
  return <>{children}</>;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireSession><AppShell /></RequireSession>}>
        <Route index element={<ProjectsPage />} />
        <Route path="/p/:slug" element={<ProjectPage />} />
        <Route path="/inbox" element={<InboxPage />} />
        <Route path="/tokens" element={<TokensPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
