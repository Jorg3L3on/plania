import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { motionTokens } from "@/components/arc/lib/motion-tokens";
import { GuiaWizard } from "@/components/home/guia-wizard";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { api } from "@/lib/api";
import { falloWords, pasosDe, primeraEntregaWords, tarjetaDe, type GuiaRead } from "@/lib/primera-entrega";
import { cn } from "@/lib/utils";

// PLA-I2-16: the guide to a first delivery, at the top of Inicio until the owner accepts one. Each step comes from
// GET /api/guia and ticks itself; words and rules in lib/primera-entrega.ts. A short card: how far along in the
// wizard's three steps, the step that is next and one button that opens the wizard (guia-wizard.tsx). Once the three
// are done the card leaves Inicio: the team's plan and delivery reach the owner through the Bandeja like any other.

export function GuiaPrimeraEntrega() {
  const guia = useQuery({ queryKey: ["guia"], queryFn: api.guia, refetchInterval: 15_000, retry: false });
  const [abierto, setAbierto] = useState(false);
  const reducido = useReducedMotion() ?? false;

  const r: GuiaRead | undefined = guia.data;
  if (!r || !r.visible) return null;
  const pasos = pasosDe(r);
  const t = tarjetaDe(pasos);
  const w = primeraEntregaWords();
  // PLA-I2-10: the server words the failure in Spanish; the screen words it again in its own language.
  const fallo = r.fallo ? (falloWords(r.fallo.summary) ?? r.fallo) : null;
  // Plan and delivery: the owner acts only once the team left something to look at; until then the card says so.
  const esperaAlEquipo = t.actual?.id === "plan" ? r.plan !== "espera" : t.actual?.id === "entrega" ? r.entrega !== "espera" : false;

  // The card shows while the wizard has a step left. Sending the first task ends it: the card fades and folds away
  // (200ms) so the page moves up into its place, while the wizard (kept mounted outside it) closes with its own motion.
  return (
    <>
      <AnimatePresence initial={false}>
        {t.enAsistente ? (
          <motion.div
            key="guia"
            className="min-w-0"
            exit={reducido ? { opacity: 0, transition: { duration: 0.1 } } : { opacity: 0, height: 0, scale: 0.98, transition: { duration: 0.2, ease: [...motionTokens.ease.standard] } }}
          >
            <Card className="gap-0 p-0" data-guia="primera-entrega" data-paso-actual={t.actual?.id ?? "listo"}>
              <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center">
                <div className="grid min-w-0 flex-1 gap-2">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <p className="font-display text-lg font-extrabold tracking-tight">{w.guia.titulo}</p>
                    <p className="text-xs text-muted-foreground" data-guia-progreso>
                      {w.tarjeta.progreso(t.hechos, t.total)}
                    </p>
                  </div>
                  {/* One segment per wizard step: done, now, later. Each fill grows from the left when its step is reached
                      and changes colour when it is done; a transition, so it only moves when the guide changes, never on load. */}
                  <div className="flex gap-1" aria-hidden>
                    {t.segmentos.map((s, i) => {
                      const lleno = s.hecho || i + 1 === t.n;
                      return (
                        <span key={s.id} className="relative h-1.5 flex-1 overflow-hidden rounded-sm bg-foreground/10" data-segmento={s.id}>
                          <span
                            className={cn(
                              "absolute inset-0 origin-left transition-[scale,translate,background-color] duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none",
                              lleno ? "scale-x-100" : "scale-x-0",
                              s.hecho ? "bg-emerald-500" : "bg-primary",
                            )}
                          />
                        </span>
                      );
                    })}
                  </div>
                  {t.actual ? (
                    <p className="text-sm">
                      {t.n ? <span className="text-muted-foreground">{w.tarjeta.paso(t.n, t.total)} · </span> : null}
                      <span className="font-medium">{t.actual.titulo}</span>
                      <span className="text-muted-foreground"> — {esperaAlEquipo ? w.tarjeta.esperando : t.actual.texto}</span>
                    </p>
                  ) : null}
                  {t.maquinaPendiente ? (
                    <p className="text-xs text-muted-foreground" data-guia-maquina>
                      {w.tarjeta.maquina}{" "}
                      <Link to="/machine/falta" className="underline underline-offset-2 hover:text-foreground">
                        {w.tarjeta.verMaquina}
                      </Link>
                    </p>
                  ) : null}
                </div>
                {t.actual ? (
                  t.enAsistente ? (
                    <Button className="shrink-0 transition-[background-color,scale,translate] active:scale-[0.97] motion-reduce:transition-none max-sm:w-full" onClick={() => setAbierto(true)} data-control="guia-continuar-tarjeta">
                      {t.hechos === 0 ? w.tarjeta.empezar : w.tarjeta.continuar}
                    </Button>
                  ) : (
                    <Button asChild className="shrink-0 max-sm:w-full" variant={esperaAlEquipo ? "outline" : "default"}>
                      <Link to={t.actual.href}>{t.actual.boton}</Link>
                    </Button>
                  )
                ) : null}
              </div>
              {fallo ? (
                <div className="mx-4 mb-3 grid gap-1 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm" data-guia-fallo>
                  <p className="font-medium">{w.guia.falloTitulo}</p>
                  <p>{fallo.por}.</p>
                  <p className="text-muted-foreground">{fallo.arregla}</p>
                </div>
              ) : null}
              <p className="border-t px-4 py-2.5 text-xs text-muted-foreground">
                <Link to="/ceo?hoja=pausar" className="underline underline-offset-2">
                  {w.guia.pausa}
                </Link>
              </p>
            </Card>
          </motion.div>
        ) : null}
      </AnimatePresence>
      <GuiaWizard r={r} open={abierto} onOpenChange={setAbierto} />
    </>
  );
}
