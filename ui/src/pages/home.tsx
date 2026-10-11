// Inicio, the sala de control: one sentence on what is going on, four numbers, then three mesas
// (Te toca, En vuelo, La Mac) and the projects as a rail. Everything on it is read to act or to go
// somewhere; the data comes from the same three queries the other screens use.
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { useEffect, useMemo, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { EnVuelo, LaMac, Proyectos, Pulso, Titular, type PulseItem } from "@/components/home/parts";
import { TeToca } from "@/components/home/te-toca";
import { api } from "@/lib/api";
import { flightsOf, headlineOf, liveServersOf, nextUpOf, readyCount, tileOf } from "@/lib/home";

// Re-render now and then so "desde hace 42 min" keeps moving without a refetch.
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
  // Te toca counts only what needs a decision; things left on the Mac live in the Máquina.
  const inbox = useMemo(() => {
    const d = inboxQuery.data;
    if (!d) return { data: undefined };
    const items = d.items.filter((i) => i.kind !== "footprint");
    const by_project: Record<string, number> = {};
    for (const i of items) by_project[i.project] = (by_project[i.project] ?? 0) + 1;
    return { data: { items, count: items.length, by_project } };
  }, [inboxQuery.data]);
  const machine = useQuery({ queryKey: ["machine"], queryFn: api.machine, staleTime: 15_000 });
  const nowMs = useNow();

  const model = useMemo(() => {
    const list = projects.data ?? [];
    const items = machine.data?.items ?? [];
    const box = inbox.data ?? { items: [], count: 0, by_project: {} };
    const flights = flightsOf(list, items);
    const tiles = list.map((p) => tileOf(p, box.by_project[p.slug] ?? 0, nowMs)).sort((a, b) => a.rank - b.rank || a.slug.localeCompare(b.slug));
    return {
      flights,
      nextUp: nextUpOf(list),
      headline: headlineOf({ projects: list, flights, inbox: box, totals: machine.data?.totals ?? null, nowMs }),
      servers: liveServersOf(items, nowMs),
      ready: readyCount(list),
      tiles,
    };
  }, [projects.data, inbox.data, machine.data, nowMs]);

  const nothingToDecide = inbox.data?.count === 0;
  const names = (slug: string) => projects.data?.find((p) => p.slug === slug)?.title ?? slug;
  const pulse: PulseItem[] = [
    { n: model.flights.length, label: "en vuelo", tone: "now", target: "en-vuelo" },
    { n: inbox.data?.count ?? 0, label: inbox.data?.count === 1 ? "te espera" : "te esperan", tone: "jorge", target: "te-toca" },
    { n: machine.data?.totals.servers ?? 0, label: machine.data?.totals.servers === 1 ? "servidor" : "servidores", tone: "done", target: "la-mac" },
    { n: model.ready, label: model.ready === 1 ? "listo para tomar" : "listos para tomar", tone: "ready", target: "en-vuelo" },
  ];

  if (projects.isError) return <p className="text-sm text-destructive">No se pudieron cargar los proyectos.</p>;
  if (!projects.data) {
    return (
      <div className="grid gap-6">
        <Skeleton className="h-28 w-2/3 rounded-2xl" />
        <div className="grid gap-5 xl:grid-cols-12">
          <Skeleton className="h-72 rounded-[22px] xl:col-span-5" />
          <Skeleton className="h-72 rounded-[22px] xl:col-span-4" />
          <Skeleton className="h-72 rounded-[22px] xl:col-span-3" />
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-6 sm:gap-7">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-5">
        <Titular headline={model.headline} nowMs={nowMs} />
        <Pulso items={pulse} />
      </header>

      {/* The three mesas: Te toca is the widest, La Mac the narrowest; they stack on a phone. */}
      <div className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-12 xl:gap-5">
        {(!inbox.data || inbox.data.count > 0) && (
          <div className="min-w-0 animate-rise md:col-span-2 xl:col-span-5" style={{ animationDelay: "140ms" }}>
            {inbox.data ? <TeToca inbox={inbox.data} names={names} /> : <Skeleton className="h-72 rounded-[22px]" />}
          </div>
        )}
        <div className={cn("min-w-0 animate-rise", nothingToDecide ? "xl:col-span-8" : "xl:col-span-4")} style={{ animationDelay: "210ms" }}>
          <EnVuelo flights={model.flights} nextUp={model.nextUp} nowMs={nowMs} />
        </div>
        <div className={cn("min-w-0 animate-rise", nothingToDecide ? "xl:col-span-4" : "xl:col-span-3")} style={{ animationDelay: "280ms" }}>
          {machine.data ? <LaMac machine={machine.data} servers={model.servers} names={names} nowMs={nowMs} /> : <Skeleton className="h-72 rounded-[22px]" />}
        </div>
      </div>

      <Proyectos tiles={model.tiles} />
    </div>
  );
}
