import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { RecapEmpty } from "@/components/progress/recap-empty";
import { RecapHero } from "@/components/progress/recap-hero";
import { RecapRhythm } from "@/components/progress/recap-rhythm";
import { RecapStreak } from "@/components/progress/recap-streak";
import { RecapWin } from "@/components/progress/recap-win";
import { RecapYear } from "@/components/progress/recap-year";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { parseRange } from "@/lib/progress";
import type { ProgressRange, ProgressSummary } from "@/lib/types";
import { cn } from "@/lib/utils";

const RANGES: { id: ProgressRange; label: string }[] = [
  { id: "day", label: "Hoy" },
  { id: "week", label: "Semana" },
  { id: "year", label: "Año" },
];

const isEmpty = (data: ProgressSummary): boolean =>
  data.finished === 0 && data.year.finished === 0 && data.streak.current === 0;

export const ProgresoPage = () => {
  const [params, setParams] = useSearchParams();
  const range = parseRange(params.get("range"));
  const date = params.get("date") ?? undefined;
  const summary = useQuery({
    queryKey: ["progress", "summary", range, date ?? ""],
    queryFn: () => api.progressSummary(range, date),
  });

  const handleRange = (next: ProgressRange) => {
    const copy = new URLSearchParams(params);
    if (next === "week") copy.delete("range");
    else copy.set("range", next);
    setParams(copy, { replace: true });
  };

  const handleSeeAll = () => {
    handleRange("year");
    document.getElementById("anio")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="mx-auto flex w-full max-w-[440px] flex-col gap-3.5 lg:mx-0">
      <RangeSwitch range={range} onChange={handleRange} />
      {summary.isPending && <RecapSkeleton />}
      {summary.isError && (
        <div className="rounded-[26px] border border-white/10 px-5 py-8 text-center">
          <p className="font-display text-lg font-bold">No se pudo cargar tu progreso</p>
          <Button variant="outline" className="mt-3" onClick={() => summary.refetch()}>
            Reintentar
          </Button>
        </div>
      )}
      {summary.data && isEmpty(summary.data) && <RecapEmpty />}
      {summary.data && !isEmpty(summary.data) && (
        <>
          <RecapHero data={summary.data} />
          <RecapStreak streak={summary.data.streak} />
          {summary.data.biggest_win && <RecapWin win={summary.data.biggest_win} />}
          <RecapRhythm data={summary.data} />
          <RecapYear data={summary.data} />
          <button
            type="button"
            onClick={handleSeeAll}
            className="flex h-[54px] items-center justify-center rounded-[18px] bg-gradient-to-r from-[#ff7a2e] to-[#ff3d6e] text-[15.5px] font-black text-white shadow-[0_14px_34px_-10px_#ff4d4daa]"
          >
            Ver todo lo que hice ›
          </button>
        </>
      )}
    </div>
  );
};

const RangeSwitch = ({ range, onChange }: { range: ProgressRange; onChange: (range: ProgressRange) => void }) => (
  <div role="tablist" aria-label="Periodo" className="grid grid-cols-3 rounded-[14px] border border-white/10 bg-white/5 p-[3px]">
    {RANGES.map((item) => {
      const on = item.id === range;
      return (
        <button
          key={item.id}
          type="button"
          role="tab"
          aria-selected={on}
          onClick={() => onChange(item.id)}
          className={cn(
            "rounded-[11px] py-2 text-[13px] font-bold",
            on ? "bg-white text-black shadow-[0_4px_14px_#0008]" : "text-[#8e8e98]",
          )}
        >
          {item.label}
        </button>
      );
    })}
  </div>
);

const RecapSkeleton = () => (
  <div className="flex flex-col gap-3.5" aria-hidden>
    <Skeleton className="h-72 rounded-[32px]" />
    <Skeleton className="h-28 rounded-[26px]" />
    <Skeleton className="h-64 rounded-[26px]" />
  </div>
);
