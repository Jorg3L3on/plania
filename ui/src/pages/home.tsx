// Inicio: la ciudad of open initiatives, with the headline in its sky and whatever waits on Jorge
// decided from a tower's ficha; under it, what the Mac runs and the projects as a rail. The data
// comes from the same three queries the other screens use.
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Ciudad } from "@/components/home/ciudad";
import { LaMac, Proyectos } from "@/components/home/parts";
import { api } from "@/lib/api";
import { cityOf, looseInbox, waitingOf, workingCity } from "@/lib/city";
import { envLine, flightsOf, headlineOf, liveServersOf, tileOf } from "@/lib/home";

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
  const projects = useQuery({ queryKey: ["projects"], queryFn: api.projects });
  const inboxQuery = useQuery({ queryKey: ["inbox"], queryFn: () => api.inbox(), staleTime: 15_000 });
  // The city counts decisiones and pasos; Limpieza (things left on the Mac) lives in the Máquina.
  const decisions = useMemo(() => (inboxQuery.data?.items ?? []).filter((i) => i.group !== "limpieza"), [inboxQuery.data]);
  const machine = useQuery({ queryKey: ["machine"], queryFn: api.machine, staleTime: 15_000 });
  const nowMs = useNow();

  const model = useMemo(() => {
    const list = projects.data ?? [];
    const items = machine.data?.items ?? [];
    const flights = flightsOf(list, items);
    const all = cityOf(list, decisions);
    // The headline and the tiles count every open initiative waiting on Jorge, shown or not.
    const waiting = waitingOf(all, decisions);
    // The sky shows only what is En curso or En revisión; decisions on hidden towers go to the loose pile.
    const districts = workingCity(all);
    return {
      districts,
      loose: looseInbox(districts, decisions),
      envLines: Object.fromEntries(list.map((p) => [p.slug, envLine(p.envs, nowMs)])),
      headline: headlineOf({ projects: list, flights, inbox: waiting, totals: machine.data?.totals ?? null, nowMs }),
      servers: liveServersOf(items, nowMs),
      tiles: list.map((p) => tileOf(p, waiting.by_project[p.slug] ?? 0, nowMs)).sort((a, b) => a.rank - b.rank || a.slug.localeCompare(b.slug)),
    };
  }, [projects.data, decisions, machine.data, nowMs]);

  const names = (slug: string) => projects.data?.find((p) => p.slug === slug)?.title ?? slug;

  if (projects.isError) return <p className="text-sm text-destructive">No se pudieron cargar los proyectos.</p>;
  if (!projects.data) {
    return (
      <div className="grid gap-6">
        <Skeleton className="h-[560px] rounded-[26px]" />
        <div className="grid gap-5 xl:grid-cols-[300px_minmax(0,1fr)]">
          <Skeleton className="h-72 rounded-[22px]" />
          <Skeleton className="h-72 rounded-[22px]" />
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-6 sm:gap-7">
      <Ciudad districts={model.districts} loose={model.loose} headline={model.headline} envLines={model.envLines} names={names} nowMs={nowMs} />

      {/* Under the city, as before: La Mac beside the projects; they stack below xl. */}
      <div className="grid items-start gap-5 xl:grid-cols-[300px_minmax(0,1fr)]">
        <div className="min-w-0 animate-rise" style={{ animationDelay: "280ms" }}>
          {machine.data ? <LaMac machine={machine.data} servers={model.servers} names={names} nowMs={nowMs} /> : <Skeleton className="h-72 rounded-[22px]" />}
        </div>
        <Proyectos tiles={model.tiles} />
      </div>
    </div>
  );
}
