import { ProjectChip, recapGlass, recapKicker } from "@/components/progress/recap-bits";
import { projectColor, rhythmTitle } from "@/lib/progress";
import type { ProgressProjectCount, ProgressSummary } from "@/lib/types";

type Bar = { key: string; label: string; total: number; by_project: ProgressProjectCount[] };

const barsOf = (data: ProgressSummary): Bar[] => {
  if (data.range === "day") {
    return data.hours.map((hour) => ({
      key: String(hour.hour),
      label: String(hour.hour).padStart(2, "0"),
      total: hour.total,
      by_project: hour.by_project,
    }));
  }
  if (data.range === "year") {
    return data.year.months.map((month) => ({
      key: month.month,
      label: month.label,
      total: month.total,
      by_project: month.by_project,
    }));
  }
  return data.buckets.map((day) => ({
    key: day.date,
    label: day.label,
    total: day.total,
    by_project: day.by_project,
  }));
};

export const RecapRhythm = ({ data }: { data: ProgressSummary }) => {
  const bars = barsOf(data);
  const peak = bars.reduce<Bar | undefined>((best, bar) => (!best || bar.total > best.total ? bar : best), undefined);
  const max = Math.max(peak?.total ?? 0, 1);
  const showLabel = (label: string) => {
    if (data.range !== "day") return true;
    return label === "00" || label === "06" || label === "12" || label === "18" || label === "23";
  };
  return (
    <section className={`${recapGlass} px-4 py-4`} aria-label={rhythmTitle(data.range)}>
      <div className="mb-3 flex items-center justify-between">
        <p className={recapKicker}>{rhythmTitle(data.range)}</p>
        <span className="text-[12px] font-bold text-[#ff8a5c]">por proyecto</span>
      </div>
      <div className="relative flex h-36 items-end gap-1.5 pt-6">
        {peak && peak.total > 0 && (
          <span
            className="absolute top-0 z-10 -translate-x-1/2 rounded-full bg-white px-1.5 py-0.5 text-[10px] font-black whitespace-nowrap text-black"
            style={{ left: `${((bars.indexOf(peak) + 0.5) / bars.length) * 100}%` }}
          >
            {peak.total === 1 ? "1 cosa" : `${peak.total} cosas`}
          </span>
        )}
        {bars.map((bar) => {
          const height = bar.total === 0 ? 4 : Math.max(12, Math.round((bar.total / max) * 100));
          const isPeak = peak && bar.key === peak.key && bar.total > 0;
          return (
            <div key={bar.key} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1">
              <div
                className="flex w-full flex-col justify-end overflow-hidden rounded-t-md"
                style={{ height }}
                title={`${bar.label}: ${bar.total}`}
              >
                {bar.total === 0 ? (
                  <div className="h-full rounded-t-md bg-white/10" />
                ) : (
                  bar.by_project
                    .filter((project) => project.count > 0)
                    .map((project) => (
                      <div
                        key={project.slug}
                        style={{ flex: project.count, background: projectColor(project.slug), minHeight: 3 }}
                      />
                    ))
                )}
              </div>
              <span className={isPeak ? "text-[10px] font-extrabold text-white" : "text-[10px] font-bold text-[#71717a]"}>
                {showLabel(bar.label) ? bar.label : "\u00a0"}
              </span>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {data.by_project.map((project) => (
          <ProjectChip key={project.slug} slug={project.slug}>
            {project.title} {project.count}
          </ProjectChip>
        ))}
      </div>
    </section>
  );
};
