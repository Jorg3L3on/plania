import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PlaniaMark } from "@/components/plania-mark";
import { api, isUnauthorized } from "@/lib/api";

export function LoginPage() {
  const [password, setPassword] = useState("");
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const from = (location.state as { from?: string } | null)?.from ?? "/";

  const login = useMutation({
    mutationFn: () => api.login(password),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["session"] });
      navigate(from, { replace: true });
    },
  });

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
          <CardDescription>Entra para ver tus proyectos.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="password">Contraseña</Label>
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
                  {isUnauthorized(login.error) ? "Contraseña incorrecta." : "No se pudo entrar. Intenta de nuevo."}
                </p>
              )}
            </div>
            <Button type="submit" disabled={!password || login.isPending}>
              {login.isPending ? "Entrando…" : "Entrar"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
