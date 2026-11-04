import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { RutinasTab } from "@/components/delegation/rutinas-tab";
import { AgentSheet } from "@/components/team/agent-sheet";
import { OrgChart } from "@/components/team/org-chart";
import { STATUS_DOT } from "@/components/team/types";
import { Kicker } from "@/components/plan/visuals";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

type EquipoTab = "org" | "rutinas";

const TABS: { id: EquipoTab; label: string }[] = [
  { id: "org", label: "Organigrama" },
  { id: "rutinas", label: "Rutinas" },
];

const countOf = (agents: { status: string }[], status: string) => agents.filter((agent) => agent.status === status).length;

const LEGEND = [
  { status: "alive", one: "activo", many: "activos" },
  { status: "idle", one: "en espera", many: "en espera" },
  { status: "stuck", one: "atascado", many: "atascados" },
] as const;

export const EquipoPage = () => {
  const team = useQuery({ queryKey: ["team"], queryFn: api.team, staleTime: 15_000 });
  const [slug, setSlug] = useState<string | null>(null);
  const [tab, setTab] = useState<EquipoTab>("org");
  const handleOpen = (next: string) => setSlug(next);
  const handleOpenChange = (open: boolean) => {
    if (!open) setSlug(null);
  };
  const handleTab = (next: EquipoTab) => setTab(next);

  if (team.isPending) {
    return (
      <div className="grid gap-4" aria-hidden>
        <Skeleton className="h-8 w-40" />
        <Skeleton className="mx-auto h-16 w-full max-w-xl" />
        <Skeleton className="mx-auto h-16 w-full max-w-xl" />
        <div className="mx-auto grid w-full max-w-xl grid-cols-2 gap-2">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
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
  const names = new Map(agents.map((agent) => [agent.slug, agent.name]));

  return (
    <div className="grid gap-6">
      <header className="grid gap-2">
        <Kicker className="text-muted-foreground">Compañía</Kicker>
        <h1 className="font-display text-4xl leading-[0.95] font-extrabold tracking-[-0.03em] sm:text-5xl">Equipo</h1>
        <p className="max-w-xl text-sm text-muted-foreground">
          Plania como compañía. Cada ficha es un bot. El latido marca quién se despierta solo.
        </p>
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
        <div role="tablist" aria-label="Vistas del equipo" className="flex flex-wrap gap-1">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={`equipo-tab-${item.id}`}
              aria-selected={tab === item.id}
              aria-controls={`equipo-panel-${item.id}`}
              tabIndex={0}
              onClick={() => handleTab(item.id)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                handleTab(item.id);
              }}
              className={cn(
                "min-h-11 flex-1 rounded-full px-3 text-sm font-medium sm:flex-none",
                tab === item.id ? "bg-foreground text-background" : "bg-muted text-muted-foreground",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      </header>
      <div role="tabpanel" id={`equipo-panel-${tab}`} aria-labelledby={`equipo-tab-${tab}`}>
        {tab === "rutinas" ? (
          <RutinasTab names={names} />
        ) : agents.length === 0 ? (
          <p className="text-sm text-muted-foreground">Todavía no hay nadie en el organigrama.</p>
        ) : (
          <OrgChart agents={agents} onOpen={handleOpen} />
        )}
      </div>
      <AgentSheet agent={selected} reportsTo={reportsTo} open={tab === "org" && selected !== null} onOpenChange={handleOpenChange} />
    </div>
  );
};
