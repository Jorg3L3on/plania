import { useQuery } from "@tanstack/react-query";
import { HouseIcon } from "lucide-react";
import { Link } from "react-router";
import { CeoWaits, GoalBars, StatRow, StuckWork, TeamNow, TokenWeek, WeekWins } from "@/components/dashboard/cards";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";

const dayLabel = (today: string, timeZone: string) => {
  const [year, month, day] = today.split("-").map(Number);
  const date = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1, 18, 0, 0));
  return new Intl.DateTimeFormat("es-MX", { weekday: "long", day: "numeric", month: "short", timeZone }).format(date);
};

const CeoSkeleton = () => (
  <div className="grid gap-4" aria-hidden>
    <Skeleton className="h-8 w-48" />
    <Skeleton className="h-24" />
    <div className="grid gap-3 min-[380px]:grid-cols-2">
      <Skeleton className="h-28" />
      <Skeleton className="h-28" />
    </div>
    <Skeleton className="h-36" />
    <Skeleton className="h-48" />
  </div>
);

export const CeoPage = () => {
  const dash = useQuery({ queryKey: ["dashboard"], queryFn: api.dashboard, staleTime: 15_000 });

  if (dash.isPending) return <CeoSkeleton />;
  if (dash.isError || !dash.data) {
    return <p className="text-sm text-muted-foreground">No se pudo cargar el tablero.</p>;
  }

  const data = dash.data;
  return (
    <div className="mx-auto grid w-full max-w-3xl gap-4">
      <header className="grid gap-1">
        <div className="flex items-start justify-between gap-3">
          <h1 className="font-display text-4xl leading-[0.95] font-extrabold tracking-[-0.03em] sm:text-5xl">
            Buenos días, {data.name}
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
          {dayLabel(data.today, data.timezone).replace(/^./, (letter) => letter.toUpperCase())} · la compañía mientras dormías
        </p>
      </header>
      <TokenWeek usage={data.usage} />
      <StatRow data={data} />
      <GoalBars goals={data.goals} />
      <TeamNow agents={data.team.agents} />
      <CeoWaits waits={data.waits} />
      <StuckWork stuck={data.stuck} />
      <WeekWins shipped={data.shipped} />
    </div>
  );
};
