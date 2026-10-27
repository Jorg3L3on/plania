import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ApiError, api } from "@/lib/api";
import { GATE_ENROLL_STEP } from "@/lib/inbox";

// Enrolment lives on the Bandeja ("Te toca"). The secret is shown once, as text, and is not kept on screen after that.
export function GatePanel() {
  const queryClient = useQueryClient();
  const gate = useQuery({ queryKey: ["gate"], queryFn: api.gate, staleTime: 15_000 });
  const [password, setPassword] = useState("");
  const [once, setOnce] = useState<{ secret_base32: string; otpauth_uri: string } | null>(null);

  const enroll = useMutation({
    mutationFn: () => api.enrollGate(password),
    onSuccess: (out) => {
      setOnce(out);
      setPassword("");
      toast("Secreto generado. Cópialo ahora: no se vuelve a mostrar.");
      void queryClient.invalidateQueries({ queryKey: ["gate"] });
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 401) toast.error("La contraseña no coincide.");
      else toast.error("No se pudo guardar el secreto en el llavero.");
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (password) enroll.mutate();
  }

  return (
    <section id="compuertas" className="grid gap-3">
      <h2 className="text-sm font-medium text-orange-600 dark:text-orange-400">Compuertas</h2>
      <Card>
        <CardContent className="grid gap-3">
          <p className="text-sm text-muted-foreground">{GATE_ENROLL_STEP}</p>
          {gate.data?.enrolled && !once && <p className="text-sm">El código ya está enrolado. Para cambiarlo, escribe la contraseña otra vez: el secreto anterior deja de valer.</p>}
          <form onSubmit={submit} className="flex flex-wrap gap-2">
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Contraseña actual de Plania"
              aria-label="Contraseña actual de Plania"
              autoComplete="current-password"
              className="max-w-sm"
            />
            <Button type="submit" size="sm" disabled={!password || enroll.isPending}>
              {gate.data?.enrolled ? "Enrolar de nuevo" : "Enrolar"}
            </Button>
          </form>
          {once && (
            <div className="grid gap-2 text-sm">
              <p>Copia estos dos textos a tu app autenticadora. No se vuelven a mostrar.</p>
              <p className="font-medium">Secreto en base32</p>
              <code className="block overflow-x-auto rounded-lg bg-muted px-3 py-2 font-mono text-xs break-all">{once.secret_base32}</code>
              <p className="font-medium">URI otpauth</p>
              <code className="block overflow-x-auto rounded-lg bg-muted px-3 py-2 font-mono text-xs break-all">{once.otpauth_uri}</code>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
