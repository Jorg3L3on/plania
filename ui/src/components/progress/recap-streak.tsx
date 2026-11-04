import { recapGlass, recapKicker } from "@/components/progress/recap-bits";
import type { ProgressSummary } from "@/lib/types";
import { cn } from "@/lib/utils";

type Props = { streak: ProgressSummary["streak"] };

const copyOf = (streak: ProgressSummary["streak"]): { title: string; line: string } => {
  if (streak.current <= 0) return { title: "Sin racha", line: "Un día con algo cerrado la empieza." };
  const title = streak.current === 1 ? "1 día" : `${streak.current} días seguidos`;
  const line = streak.is_best ? "Tu mejor racha del año. ¡No la rompas!" : `Tu mejor del año: ${streak.best_year} días.`;
  return { title, line };
};

export const RecapStreak = ({ streak }: Props) => {
  const copy = copyOf(streak);
  const lit = streak.current > 0;
  return (
    <section className={`${recapGlass} px-4 py-4`}>
      <div className="flex items-center gap-3.5">
        <svg viewBox="0 0 64 76" className={cn("h-[76px] w-16 shrink-0", lit && "drop-shadow-[0_0_18px_#ff6a1aaa]")} aria-hidden>
          <defs>
            <linearGradient id="streak-flame" x1="0" y1="1" x2="0" y2="0">
              <stop offset="0" stopColor={lit ? "#ff3d5a" : "#3f3f46"} />
              <stop offset="0.6" stopColor={lit ? "#ff8a1a" : "#52525b"} />
              <stop offset="1" stopColor={lit ? "#ffd166" : "#71717a"} />
            </linearGradient>
          </defs>
          <path d="M32 2C36 20 58 28 58 50a26 26 0 0 1-52 0C6 36 16 30 18 18c6 6 8 12 8 18C30 26 34 16 32 2z" fill="url(#streak-flame)" />
          <path d="M32 40c4 8 12 10 12 20a12 12 0 0 1-24 0c0-6 4-8 6-14 2 4 4 4 6-6z" fill="#fff4" />
        </svg>
        <div>
          <p className={recapKicker}>Racha</p>
          <h2 className="font-display text-[30px] leading-none font-black tracking-tight">{copy.title}</h2>
          <p className="mt-1 mb-2 text-[13px] text-[#a1a1aa]">{copy.line}</p>
          <div className="flex gap-1.5" aria-label="Esta semana">
            {streak.week.map((day) => (
              <span
                key={day.date}
                aria-label={`${day.label} ${day.date}${day.active ? ", activo" : ""}`}
                className={cn(
                  "flex size-[30px] items-center justify-center rounded-[9px] text-[11px] font-black",
                  day.active
                    ? "bg-gradient-to-br from-[#ff8a3d] to-[#ff3d5a] shadow-[0_6px_14px_-6px_#ff5a2a]"
                    : "border border-dashed border-white/20 bg-white/5 text-[#555]",
                )}
              >
                {day.label}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};
