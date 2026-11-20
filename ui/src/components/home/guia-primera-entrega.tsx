import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckIcon } from "lucide-react";
import { toast } from "sonner";
import { Link, useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { api } from "@/lib/api";
import { aReanudar, falloWords, ofreceEjemplo, pasosDe, pedidoSugerido, primeraEntregaWords, type GuiaRead, type Paso } from "@/lib/primera-entrega";
import { cn } from "@/lib/utils";

// PLA-I2-16: the guide to a first delivery, at the top of Inicio until the owner accepts one. Each step comes from
// GET /api/guia and ticks itself; words and rules in lib/primera-entrega.ts. F6: Reanudar resumes the company and the
// first project in one press.

function PasoRow({ paso, n, children, onAccion, busy }: { paso: Paso; n: number; children?: React.ReactNode; onAccion?: () => void; busy?: boolean }) {
  const ahora = paso.estado === "ahora";
  const WORDS = primeraEntregaWords().guia;
  return (
    <li className={cn("flex gap-3 px-4 py-3", paso.estado === "luego" && "opacity-60")} data-paso={paso.id} data-estado={paso.estado}>
      <span
        className={cn(
          "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
          paso.estado === "hecho" ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : ahora ? "bg-primary text-primary-foreground" : "bg-foreground/10",
        )}
        aria-label={paso.estado === "hecho" ? WORDS.listo : undefined}
      >
        {paso.estado === "hecho" ? <CheckIcon className="size-3.5" /> : n}
      </span>
      <div className="grid min-w-0 flex-1 gap-1">
        <p className="font-medium">{paso.titulo}</p>
        <p className="text-sm text-muted-foreground">{paso.texto}</p>
        {ahora ? (
          <div className="flex flex-wrap gap-2 pt-1">
            {paso.accion && onAccion ? (
              <Button size="sm" disabled={busy} onClick={onAccion} data-control={`guia-${paso.accion}`}>
                {busy ? primeraEntregaWords().reanudar.reanudando : paso.boton}
              </Button>
            ) : (
              <Button asChild size="sm">
                <Link to={paso.href}>{paso.boton}</Link>
              </Button>
            )}
            {children}
          </div>
        ) : null}
      </div>
    </li>
  );
}

export function GuiaPrimeraEntrega() {
  const client = useQueryClient();
  const navigate = useNavigate();
  const guia = useQuery({ queryKey: ["guia"], queryFn: api.guia, refetchInterval: 15_000, retry: false });
  const ejemplo = useMutation({
    mutationFn: api.guiaEjemplo,
    onSuccess: async (r) => {
      await client.invalidateQueries({ queryKey: ["guia"] });
      navigate(`/ceo?proyecto=${encodeURIComponent(r.slug)}`);
    },
  });
  const pedir = useMutation({
    mutationFn: (slug: string) => api.askProject(slug, { text: pedidoSugerido(), mode: "ya" }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["guia"] }),
  });

  // F6: one press resumes the first project and the company (the project first: a failure in between runs nothing).
  const reanudar = useMutation({
    mutationFn: async (what: ReturnType<typeof aReanudar>) => {
      if (what.project) await api.setProjectPaused(what.project, false);
      if (what.company) await api.setCompanyPaused(false);
    },
    onError: () => toast.error(primeraEntregaWords().reanudar.fallo),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ["guia"] });
      void client.invalidateQueries({ queryKey: ["company"] });
    },
  });

  const r: GuiaRead | undefined = guia.data;
  if (!r || !r.visible) return null;
  const pasos = pasosDe(r);
  const WORDS = primeraEntregaWords().guia;
  // PLA-I2-10: the server words the failure in Spanish; the screen words it again in its own language.
  const fallo = r.fallo ? (falloWords(r.fallo.summary) ?? r.fallo) : null;

  return (
    <Card className="gap-0 p-0" data-guia="primera-entrega">
      <div className="grid gap-1 px-4 pt-4 pb-3">
        <p className="font-display text-lg font-extrabold tracking-tight">{WORDS.titulo}</p>
        <p className="text-sm text-muted-foreground">{WORDS.intro}</p>
      </div>
      {fallo ? (
        <div className="mx-4 mb-3 grid gap-1 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm" data-guia-fallo>
          <p className="font-medium">{WORDS.falloTitulo}</p>
          <p>{fallo.por}.</p>
          <p className="text-muted-foreground">{fallo.arregla}</p>
        </div>
      ) : null}
      <ol className="divide-y border-t">
        {pasos.map((p, i) => (
          <PasoRow key={p.id} paso={p} n={i + 1} onAccion={p.accion === "reanudar" ? () => reanudar.mutate(aReanudar(r)) : undefined} busy={reanudar.isPending}>
            {p.id === "proyecto" && ofreceEjemplo(r) ? (
              <Button size="sm" variant="outline" disabled={ejemplo.isPending} onClick={() => ejemplo.mutate()} title={WORDS.ejemploTexto}>
                {WORDS.ejemplo}
              </Button>
            ) : null}
            {p.id === "pedido" && r.proyecto ? (
              <Button size="sm" variant="outline" disabled={pedir.isPending} onClick={() => pedir.mutate(r.proyecto!.slug)}>
                {WORDS.pedirSugerido}
              </Button>
            ) : null}
          </PasoRow>
        ))}
      </ol>
      <p className="border-t px-4 py-3 text-xs text-muted-foreground">
        {ofreceEjemplo(r) ? `${WORDS.ejemploTexto} ` : null}
        <Link to="/ceo?hoja=pausar" className="underline underline-offset-2">
          {WORDS.pausa}
        </Link>
      </p>
    </Card>
  );
}
