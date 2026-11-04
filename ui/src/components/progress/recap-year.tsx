import { ProjectChip, recapKicker } from "@/components/progress/recap-bits";
import { monthName, projectColor } from "@/lib/progress";
import type { ProgressSummary } from "@/lib/types";

type Props = { data: ProgressSummary };

const monthMarks = (dates: string[]): { index: number; label: string }[] => {
  const marks: { index: number; label: string }[] = [];
  let last = "";
  dates.forEach((date, index) => {
    const label = monthName(date);
    if (label && label !== last) {
      marks.push({ index: Math.floor(index / 7), label });
      last = label;
    }
  });
  if (marks.length <= 7) return marks;
  const step = Math.ceil(marks.length / 7);
  return marks.filter((_, i) => i % step === 0);
};

export const RecapYear = ({ data }: Props) => {
  const year = data.year;
  const max = data.heatmap.reduce((m, cell) => Math.max(m, cell.count), 0);
  const marks = monthMarks(data.heatmap.map((cell) => cell.date));
  return (
    <section
      id="anio"
      className="relative overflow-hidden rounded-[30px] border border-white/10 bg-gradient-to-b from-[#0f0a1f] to-[#07070b] px-4 py-5"
      aria-label={`Tu año en Plania ${year.year}`}
    >
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(70%_50%_at_50%_0%,#7c3aed44,transparent_70%)]" />
      <div className="relative">
        <p className={`${recapKicker} text-[#c4b5fd]`}>Tu año en Plania · {year.year}</p>
        <h2 className="mt-1 font-display text-[44px] leading-[0.95] font-black tracking-tight">
          <span className="bg-gradient-to-r from-white via-[#ffd2b8] to-[#ff8a5c] bg-clip-text text-transparent">{year.finished}</span>
          <span className="mt-1 block text-[28px]">cosas terminadas</span>
        </h2>
        <p className="mt-2 text-[13px] text-[#a1a1aa]">
          {year.active_days} días activos · {year.initiatives} iniciativas · {year.prs} PRs
        </p>
        <div
          className="mt-4 grid grid-flow-col grid-rows-7 gap-[2px]"
          style={{ gridTemplateColumns: "repeat(53, minmax(0, 1fr))" }}
          role="img"
          aria-label={`${year.active_days} días con cierres en los últimos 12 meses`}
        >
          {data.heatmap.map((cell) => {
            const color = cell.slug ? projectColor(cell.slug) : "#ffffff";
            const opacity = cell.count === 0 || max === 0 ? 0.08 : 0.35 + 0.65 * (cell.count / max);
            return (
              <span
                key={cell.date}
                title={cell.count ? `${cell.date}: ${cell.count}` : cell.date}
                className="block aspect-square rounded-[1.5px]"
                style={{
                  background: cell.count ? color : "#ffffff",
                  opacity,
                  boxShadow: cell.count && cell.count / max > 0.85 ? `0 0 4px ${color}` : undefined,
                }}
              />
            );
          })}
        </div>
        <div className="relative mt-1.5 h-3 text-[9px] font-bold text-[#71717a]">
          {marks.map((mark) => (
            <span key={`${mark.index}-${mark.label}`} className="absolute" style={{ left: `${(mark.index / 53) * 100}%` }}>
              {mark.label}
            </span>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {year.by_project.map((project) => (
            <ProjectChip key={project.slug} slug={project.slug}>
              {project.title}
            </ProjectChip>
          ))}
        </div>
      </div>
    </section>
  );
};
