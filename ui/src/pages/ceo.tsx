import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { HouseIcon } from "lucide-react";
import { Link } from "react-router";
import { AssignSheet, Brief, Goals, Kpis, Queue, Ritmo, Team, type AssignTarget } from "@/components/dashboard/ceo-v2";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { claudeOnly } from "@/lib/ceo-team";
import { greeting } from "@/lib/greeting";

const dayLabel = (today: string, timeZone: string) => {
  const [year, month, day] = today.split("-").map(Number);
  const date = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1, 18, 0, 0));
  return new Intl.DateTimeFormat("es-MX", { weekday: "long", day: "numeric", month: "short", timeZone }).format(date);
};

const CeoSkeleton = () => (
  <div className="mx-auto grid w-full max-w-6xl gap-4" aria-hidden>
    <Skeleton className="h-10 w-64" />
    <Skeleton className="h-28" />
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
      <Skeleton className="h-72" />
      <Skeleton className="h-72" />
    </div>
  </div>
);

// PLA-I28: canvas A on the phone (one column in this DOM order), B on the Mac (two columns from 1024 px).
export const CeoPage = () => {
  const dash = useQuery({ queryKey: ["dashboard"], queryFn: api.dashboard, staleTime: 15_000 });
  const [assign, setAssign] = useState<AssignTarget | null>(null);

  if (dash.isPending) return <CeoSkeleton />;
  if (dash.isError || !dash.data) {
    return (
      <div className="grid justify-items-start gap-3">
        <p className="text-sm text-muted-foreground">No se pudo cargar el tablero.</p>
        <button
          type="button"
          onClick={() => void dash.refetch()}
          className="inline-flex min-h-11 items-center rounded-full px-4 text-sm ring-1 ring-foreground/15 hover:bg-muted"
        >
          Reintentar
        </button>
      </div>
    );
  }

  const data = claudeOnly(dash.data);
  const { hello, subtitle } = greeting(data.timezone);
  return (
    <div className="mx-auto grid w-full max-w-6xl gap-4">
      <header className="grid gap-1">
        <div className="flex items-start justify-between gap-3">
          <h1 className="font-display text-4xl leading-[0.95] font-extrabold tracking-[-0.03em] sm:text-5xl">
            {hello}, {data.name}
          </h1>
          <Link
            to="/"
            className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            <HouseIcon className="size-4" aria-hidden />
            Inicio
          </Link>
        </div>
        <p className="text-sm text-muted-foreground">
          {dayLabel(data.today, data.timezone).replace(/^./, (letter) => letter.toUpperCase())} · {subtitle}
        </p>
      </header>
      <div className="hidden sm:block">
        <Kpis data={data} />
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="lg:col-start-1 lg:row-start-1">
          <Brief lines={data.brief} />
        </div>
        <div className="lg:col-start-1 lg:row-start-2">
          <Queue items={data.queue} onAssign={(item) => setAssign({ kind: "initiative", item })} />
        </div>
        <div className="lg:col-start-2 lg:row-span-2 lg:row-start-1">
          <Team agents={data.team.agents} onAssign={(agent) => setAssign({ kind: "agent", agent })} />
        </div>
        <div className="lg:col-start-2 lg:row-start-3">
          <Goals goals={data.goals} />
        </div>
        <div className="lg:col-start-1 lg:row-start-3">
          <Ritmo data={data} />
        </div>
      </div>
      <AssignSheet target={assign} data={data} onClose={() => setAssign(null)} />
    </div>
  );
};
