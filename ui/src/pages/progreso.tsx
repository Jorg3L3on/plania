import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useSearchParams } from "react-router";
import { LogList } from "@/components/progress/log-list";
import { RecapEmpty } from "@/components/progress/recap-empty";
import { RecapHero } from "@/components/progress/recap-hero";
import { RecapRhythm } from "@/components/progress/recap-rhythm";
import { RecapStreak } from "@/components/progress/recap-streak";
import { RecapWin } from "@/components/progress/recap-win";
import { RecapYear } from "@/components/progress/recap-year";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { monthSpan, parseRange } from "@/lib/progress";
import type { ProgressLog, ProgressRange, ProgressSummary } from "@/lib/types";
import { cn } from "@/lib/utils";

const RANGES: { id: ProgressRange; label: string }[] = [
  { id: "day", label: "Hoy" },
  { id: "week", label: "Semana" },
  { id: "year", label: "Año" },
];

const isEmpty = (data: ProgressSummary): boolean =>
  data.finished === 0 && data.year.finished === 0 && data.streak.current === 0;

const setParam = (params: URLSearchParams, key: string, value: string) => {
  const copy = new URLSearchParams(params);
  if (value) copy.set(key, value);
  else copy.delete(key);
  return copy;
};

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
    document.getElementById("bitacora")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const data = summary.data;
  const empty = data ? isEmpty(data) : false;

  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,440px)_minmax(0,1fr)] lg:items-start lg:gap-10">
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
        {data && empty && <RecapEmpty />}
        {data && !empty && (
          <>
            <RecapHero data={data} />
            <RecapStreak streak={data.streak} />
            {data.biggest_win && <RecapWin win={data.biggest_win} />}
            <RecapRhythm data={data} />
            <RecapYear data={data} />
            <button
              type="button"
              onClick={handleSeeAll}
              className="flex h-[54px] items-center justify-center rounded-[18px] bg-gradient-to-r from-[#ff7a2e] to-[#ff3d6e] text-[15.5px] font-black text-white shadow-[0_14px_34px_-10px_#ff4d4daa] lg:hidden"
            >
              Ver todo lo que hice ›
            </button>
          </>
        )}
      </div>
      {data && !empty && <Bitacora summary={data} />}
    </div>
  );
};

const Bitacora = ({ summary }: { summary: ProgressSummary }) => {
  const [params, setParams] = useSearchParams();
  const month = params.get("mes");
  const project = params.get("proyecto") ?? "";
  const type = params.get("tipo") ?? "";
  const q = params.get("q") ?? "";
  const span = month && /^\d{4}-\d{2}$/.test(month) ? monthSpan(month) : { from: summary.from, to: summary.to };
  const log = useQuery({
    queryKey: ["progress", "log", span.from, span.to, project, type, q],
    queryFn: () => api.progressLog({ from: span.from, to: span.to, project: project || undefined, type: type || undefined, q: q || undefined }),
  });
  const [stamp, setStamp] = useState(`${span.from}|${span.to}|${project}|${type}|${q}`);
  const [older, setOlder] = useState<ProgressLog["days"]>([]);
  const [cursor, setCursor] = useState<string | null | undefined>(undefined);
  const [loadingMore, setLoadingMore] = useState(false);
  const key = `${span.from}|${span.to}|${project}|${type}|${q}`;
  if (stamp !== key) {
    setStamp(key);
    setOlder([]);
    setCursor(undefined);
  }

  const handleMore = async () => {
    const next = cursor === undefined ? log.data?.next_cursor : cursor;
    if (!next || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await api.progressLog({
        from: span.from,
        to: span.to,
        project: project || undefined,
        type: type || undefined,
        q: q || undefined,
        cursor: next,
      });
      setOlder((prev) => [...prev, ...page.days]);
      setCursor(page.next_cursor);
    } finally {
      setLoadingMore(false);
    }
  };

  const view = log.data
    ? { ...log.data, days: [...log.data.days, ...older], next_cursor: cursor === undefined ? log.data.next_cursor : cursor }
    : null;
  const projects = summary.year.by_project.filter((item) => item.count > 0);

  return (
    <div className="mx-auto mt-8 w-full max-w-[720px] lg:mt-0">
      {log.isPending && <Skeleton className="h-80 rounded-[26px]" />}
      {log.isError && (
        <div className="rounded-[26px] border border-white/10 px-5 py-8 text-center">
          <p className="font-display text-lg font-bold">No se pudo cargar la bitácora</p>
          <Button variant="outline" className="mt-3" onClick={() => log.refetch()}>Reintentar</Button>
        </div>
      )}
      {view && (
        <LogList
          log={view}
          projects={projects}
          today={summary.today}
          project={project}
          type={type}
          q={q}
          month={month}
          loadingMore={loadingMore}
          onProject={(slug) => setParams(setParam(params, "proyecto", slug), { replace: true })}
          onType={(next) => setParams(setParam(params, "tipo", next), { replace: true })}
          onSearch={(next) => setParams(setParam(params, "q", next.slice(0, 80)), { replace: true })}
          onMonth={(next) => setParams(setParam(params, "mes", next ?? ""), { replace: true })}
          onMore={handleMore}
          onClear={() => {
            const copy = new URLSearchParams(params);
            copy.delete("q");
            copy.delete("tipo");
            copy.delete("proyecto");
            setParams(copy, { replace: true });
          }}
        />
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
