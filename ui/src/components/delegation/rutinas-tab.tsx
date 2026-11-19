import { useQuery } from "@tanstack/react-query";
import type { RoutineRun, RoutineStatus } from "@/components/delegation/types";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { ago } from "@/lib/time";
import { cn } from "@/lib/utils";
import { words } from "@/lib/i18n";
import { DELEGATION } from "@/lib/delegation-words";

const CHIP: Record<RoutineStatus, { label: "routineOk" | "routineFail" | "routineSkipped"; className: string }> = {
  ok: { label: "routineOk", className: "bg-status-done/15 text-ink-done" },
  fail: { label: "routineFail", className: "bg-status-blocked/15 text-ink-blocked" },
  skipped: { label: "routineSkipped", className: "bg-muted text-muted-foreground" },
};

const StatusChip = ({ status }: { status: RoutineStatus }) => {
  const chip = CHIP[status];
  return (
    <span className={cn("inline-flex min-h-6 items-center rounded-full px-2 text-[11px] font-semibold", chip.className)}>
      {words(DELEGATION)[chip.label]}
    </span>
  );
};

const RunRow = ({ run, name }: { run: RoutineRun; name: string }) => (
  <li className="grid gap-1.5 px-4 py-3">
    <span className="flex flex-wrap items-center gap-2">
      <span className="min-w-0 font-medium break-words">{run.routine}</span>
      <StatusChip status={run.status} />
    </span>
    {run.summary ? <p className="text-sm break-words text-muted-foreground">{run.summary}</p> : null}
    <p className="text-xs text-muted-foreground">
      {name}
      {run.task_key ? <span className="font-mono"> · {run.task_key}</span> : null}
      {" · "}
      {ago(run.started_at)}
    </p>
  </li>
);

type RutinasTabProps = {
  names: Map<string, string>;
};

export const RutinasTab = ({ names }: RutinasTabProps) => {
  const runs = useQuery({ queryKey: ["routines"], queryFn: () => api.routines(), staleTime: 15_000 });
  const w = words(DELEGATION);

  if (runs.isPending) {
    return (
      <div className="grid gap-2" aria-hidden>
        <Skeleton className="h-16 rounded-2xl" />
        <Skeleton className="h-16 rounded-2xl" />
      </div>
    );
  }

  if (runs.isError || !runs.data) {
    return <p className="text-sm text-muted-foreground">{w.routinesFailed}</p>;
  }

  if (runs.data.runs.length === 0) {
    return <p className="text-sm text-muted-foreground">{w.noRoutines}</p>;
  }

  return (
    <section className="overflow-hidden rounded-2xl border bg-card" aria-label={w.routines}>
      <ul className="divide-y">
        {runs.data.runs.map((run) => (
          <RunRow key={run.id} run={run} name={names.get(run.agent) ?? run.agent} />
        ))}
      </ul>
    </section>
  );
};
