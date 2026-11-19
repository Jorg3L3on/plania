import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PlaniaMark } from "@/components/plania-mark";
import { ApiError, api, isUnauthorized } from "@/lib/api";
import { words } from "@/lib/i18n";
import { LOGIN } from "@/lib/login-words";
import { waitText } from "@/lib/primer-arranque";

export function LoginPage() {
  const w = words(LOGIN);
  const [password, setPassword] = useState("");
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const from = (location.state as { from?: string } | null)?.from ?? "/";
  // PLA-I2-2: no owner yet means the first-start screen, not a password nobody has.
  const firstStart = useQuery({ queryKey: ["first-start"], queryFn: () => api.firstStart(), retry: false });

  const login = useMutation({
    mutationFn: () => api.login(password),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["session"] });
      navigate(from, { replace: true });
    },
  });

  if (firstStart.data?.open) return <Navigate to="/primer-arranque" replace />;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (password) login.mutate();
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-muted/40 px-4 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <PlaniaMark className="mb-2 size-10" />
          <CardTitle className="font-display text-xl font-extrabold tracking-tight">Plania</CardTitle>
          <CardDescription>{w.lead}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="password">{w.password}</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-invalid={login.isError || undefined}
              />
              {login.isError && (
                <p className="text-sm text-destructive">
                  {isUnauthorized(login.error)
                    ? w.wrong
                    : login.error instanceof ApiError && login.error.status === 429
                      ? waitText(login.error.detail.retry_after)
                      : w.failed}
                </p>
              )}
            </div>
            <Button type="submit" disabled={!password || login.isPending}>
              {login.isPending ? w.submitting : w.submit}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
