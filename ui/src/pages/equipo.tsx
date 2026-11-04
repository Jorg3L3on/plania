import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AgentSheet } from "@/components/team/agent-sheet";
import { OrgChart } from "@/components/team/org-chart";
import { STATUS_DOT } from "@/components/team/types";
import { Kicker } from "@/components/plan/visuals";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

const countOf = (agents: { status: string }[], status: string) => agents.filter((agent) => agent.status === status).length;

const LEGEND = [
  { status: "alive", one: "activo", many: "activos" },
  { status: "idle", one: "en espera", many: "en espera" },
  { status: "stuck", one: "atascado", many: "atascados" },
] as const;

export const EquipoPage = () => {
  const team = useQuery({ queryKey: ["team"], queryFn: api.team, staleTime: 15_000 });
  const [slug, setSlug] = useState<string | null>(null);
  const handleOpen = (next: string) => setSlug(next);
  const handleOpenChange = (open: boolean) => {
    if (!open) setSlug(null);
  };

  if (team.isPending) {
    return (
      <div className="grid gap-4" aria-hidden>
        <Skeleton className="h-8 w-40" />
        <Skeleton className="mx-auto h-16 w-full max-w-xs" />
        <div className="grid gap-3 md:grid-cols-3">
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
      </div>
    );
  }

  if (team.isError || !team.data) {
    return <p className="text-sm text-muted-foreground">No se pudo cargar el equipo.</p>;
  }

  const agents = team.data.agents;
  const selected = agents.find((agent) => agent.slug === slug) ?? null;
  const reportsTo = selected?.reports_to ? agents.find((agent) => agent.slug === selected.reports_to) ?? null : null;
  const legend = LEGEND.map((item) => ({ ...item, n: countOf(agents, item.status) }));

  return (
    <div className="grid gap-6">
      <header className="grid gap-2">
        <Kicker className="text-muted-foreground">Compañía</Kicker>
        <h1 className="font-display text-4xl leading-[0.95] font-extrabold tracking-[-0.03em] sm:text-5xl">Equipo</h1>
        <p className="max-w-xl text-sm text-muted-foreground">Quién está, a quién reporta y qué tiene a su nombre.</p>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {legend.map((item) => (
            <li key={item.status} className="inline-flex items-center gap-1.5">
              <span className={cn("size-2 rounded-full", STATUS_DOT[item.status])} aria-hidden />
              <span>
                {item.n} {item.n === 1 ? item.one : item.many}
              </span>
            </li>
          ))}
        </ul>
      </header>
      {agents.length === 0 ? (
        <p className="text-sm text-muted-foreground">Todavía no hay nadie en el organigrama.</p>
      ) : (
        <OrgChart agents={agents} onOpen={handleOpen} />
      )}
      <AgentSheet agent={selected} reportsTo={reportsTo} open={selected !== null} onOpenChange={handleOpenChange} />
    </div>
  );
};
