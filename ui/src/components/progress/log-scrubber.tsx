import { monthsBack } from "@/lib/progress";
import { cn } from "@/lib/utils";

type Props = { today: string; active: string | null; onJump: (month: string) => void };

export const LogScrubber = ({ today, active, onJump }: Props) => {
  const months = monthsBack(today, 12);
  const current = active ?? today.slice(0, 7);
  return (
    <nav aria-label="Meses del último año" className="absolute top-28 right-0 bottom-4 flex w-9 flex-col items-center justify-between">
      <span aria-hidden className="absolute inset-y-0 left-[15px] w-1 rounded-full bg-gradient-to-b from-[#ff7a2e] via-[#a78bfa] to-[#34d399] opacity-40" />
      {months.map((month) => {
        const on = month.key === current;
        return (
          <button
            key={month.key}
            type="button"
            aria-current={on ? "true" : undefined}
            aria-label={month.key}
            onClick={() => onJump(month.key)}
            className={cn(
              "relative z-10 bg-[#0c0e14] px-0.5 text-[9px] font-extrabold",
              on ? "rounded-xl bg-gradient-to-b from-[#ff7a2e] to-[#ff3d6e] px-1.5 py-2 text-white shadow-[0_8px_20px_#ff3d6e88]" : "text-[#52525b]",
            )}
          >
            {on ? (
              <span className="flex flex-col leading-none">
                {month.label}
                <small className="text-[8px] font-black">{month.key.slice(0, 4)}</small>
              </span>
            ) : (
              month.label
            )}
          </button>
        );
      })}
    </nav>
  );
};
