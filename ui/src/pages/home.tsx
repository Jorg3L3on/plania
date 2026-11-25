// Inicio: la ciudad of open initiatives, with the headline in its sky and whatever waits on the owner
// decided from a tower's ficha; under it, what the machine runs and the projects as a rail. The data
// comes from the same three queries the other screens use. Which sections show follows the first-delivery guide
// (lib/inicio-secciones.ts): while it runs the page is the guide and what already holds something.
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { motionTokens } from "@/components/arc/lib/motion-tokens";
import { Skeleton } from "@/components/ui/skeleton";
import { GoalsHome } from "@/components/goals/goals-board";
import { Ciudad } from "@/components/home/ciudad";
import { Hoy } from "@/components/home/hoy";
import { GuiaPrimeraEntrega } from "@/components/home/guia-primera-entrega";
import { LaMaquina, Proximo } from "@/components/home/parts";
import { proximoOf } from "@/lib/due";
import { api } from "@/lib/api";
import { cityOf, looseInbox, waitingOf, workingCity } from "@/lib/city";
import { envLine, flightsOf, headlineOf, liveServersOf, tileOf } from "@/lib/home";
import { HOME_PAGE } from "@/lib/home-words";
import { words } from "@/lib/i18n";
import { listedProjects } from "@/lib/proyectos-visibles";
import { etapaDe, maquinaEnUso, seccionesDe } from "@/lib/inicio-secciones";
import { cn } from "@/lib/utils";

/**
 * A section the guide's stage brings or takes away. On the page's first paint it is just there (its own entrance
 * runs); when it comes later, because the stage changed, it fades up 8px in 240ms, and it leaves in 150ms, height
 * folding with it so what is under it closes the gap instead of jumping. Reduced motion: the fade only.
 */
function Seccion({ show, id, children, className }: { show: boolean; id: string; children: ReactNode; className?: string }) {
  const reducido = useReducedMotion() ?? false;
  return (
    <AnimatePresence initial={false}>
      {show ? (
        <motion.div
          key={id}
          className={cn("min-w-0", className)}
          data-seccion={id}
          initial={reducido ? { opacity: 0 } : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0, height: "auto", transition: { duration: 0.24, ease: [...motionTokens.ease.enter] } }}
          exit={reducido ? { opacity: 0, transition: { duration: 0.1 } } : { opacity: 0, height: 0, transition: { duration: 0.15, ease: [...motionTokens.ease.standard] } }}
        >
          {children}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

// Re-render now and then so "hace 42 min" keeps moving without a refetch.
function useNow(everyMs = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}

export function HomePage() {
  const w = words(HOME_PAGE);
  const projects = useQuery({ queryKey: ["projects"], queryFn: api.projects });
  const inboxQuery = useQuery({ queryKey: ["inbox"], queryFn: () => api.inbox(), staleTime: 15_000 });
  // The city counts decisiones and pasos; Limpieza (things left on the machine) lives in the Máquina.
  const decisions = useMemo(() => (inboxQuery.data?.items ?? []).filter((i) => i.group !== "limpieza"), [inboxQuery.data]);
  const machine = useQuery({ queryKey: ["machine"], queryFn: api.machine, staleTime: 15_000 });
  const nowMs = useNow();
  // The guide and the goals, from the caches the card and the goals block already fill: no extra request.
  const guia = useQuery({ queryKey: ["guia"], queryFn: api.guia, refetchInterval: 15_000, retry: false });
  const goals = useQuery({ queryKey: ["goals"], queryFn: () => api.goals() });

  const model = useMemo(() => {
    // F7: the home project stays off Inicio while it holds no work.
    const list = listedProjects(projects.data ?? []);
    const items = machine.data?.items ?? [];
    const flights = flightsOf(list, items);
    const all = cityOf(list, decisions);
    // The headline and the tiles count every open initiative waiting on the owner, shown or not.
    const waiting = waitingOf(all, decisions);
    // The sky shows only what is En curso or En revisión; decisions on hidden towers go to the loose pile.
    const districts = workingCity(all);
    return {
      districts,
      loose: looseInbox(districts, decisions),
      envLines: Object.fromEntries(list.map((p) => [p.slug, envLine(p.envs, nowMs)])),
      headline: headlineOf({ projects: list, flights, inbox: waiting, totals: machine.data?.totals ?? null, nowMs }),
      servers: liveServersOf(items, nowMs),
      proximo: proximoOf(list),
      tiles: list.map((p) => tileOf(p, waiting.by_project[p.slug] ?? 0, nowMs)).sort((a, b) => a.rank - b.rank || a.slug.localeCompare(b.slug)),
    };
  }, [projects.data, decisions, machine.data, nowMs]);

  const listed = useMemo(() => listedProjects(projects.data ?? []), [projects.data]);
  const etapa = etapaDe(guia.data);
  const ver = seccionesDe({
    etapa,
    proyectos: listed.length,
    metas: goals.data ? goals.data.goals.filter((g) => g.project === null).length : null,
    maquinaEnUso: maquinaEnUso(machine.data, model.servers.length),
  });

  const names = (slug: string) => projects.data?.find((p) => p.slug === slug)?.title ?? slug;

  if (projects.isError) return <p className="text-sm text-destructive">{w.failed}</p>;
  // Wait for the guide too (it fails fast, retry off), so a new owner never sees the full page fold into the guide.
  if (!projects.data || guia.isPending) {
    return (
      <div className="grid gap-6" aria-busy="true">
        <Skeleton className="h-[380px] rounded-[22px] md:h-[560px] md:rounded-[26px]" />
        <Skeleton className="h-80 rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-6 sm:gap-7">
      {/* PLA-I2-16: the guide to a first delivery, until one is accepted. */}
      <GuiaPrimeraEntrega />

      {/* Pedir is no longer a field here: the palette (⌘K, or the header's button) asks from every screen. ADR 0008. */}
      {/* 2.12: what changed since "Visto", and what waits on the owner, above the city. */}
      <Hoy names={names} />

      <Ciudad districts={model.districts} loose={model.loose} headline={model.headline} envLines={model.envLines} nowMs={nowMs} />

      <Proximo lines={model.proximo} names={names} nowMs={nowMs} />

      {/* La máquina holds the projects: its own figures stay small, the projects are most of it. */}
      {/* One row from xl: La máquina takes the room (its project tiles need it), Metas a 320px column beside it that
          stays in view. Below xl they stack and Metas is one line under the projects. Either alone takes the row. */}
      {ver.maquina || ver.metas ? (
        <div className={cn("grid items-start gap-5", ver.maquina && ver.metas && "xl:grid-cols-[minmax(0,1fr)_320px]")} data-fila-maquina-metas>
          {ver.maquina ? <LaMaquina machine={machine.data} servers={model.servers} tiles={model.tiles} cifras={ver.cifrasMaquina} nowMs={nowMs} /> : null}
          <Seccion show={ver.metas} id="metas" className="xl:sticky xl:top-[calc(var(--header-h)+1.25rem)]">
            <GoalsHome />
          </Seccion>
        </div>
      ) : null}
    </div>
  );
}
