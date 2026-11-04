import { ProjectChip, Shot } from "@/components/progress/recap-bits";
import { formatDayLong } from "@/lib/progress";
import type { ProgressWin } from "@/lib/types";

type Props = { win: ProgressWin };

export const RecapWin = ({ win }: Props) => {
  const prs = win.prs.slice(0, 4).map((pr) => `#${pr.number}`).join(" · ");
  const tickets = win.tickets === 1 ? "1 ticket" : `${win.tickets} tickets`;
  const beforeAlt = `Antes: ${win.title}`;
  const afterAlt = `Después: ${win.title}`;
  return (
    <article className="overflow-hidden rounded-[26px] border border-white/10 bg-[#0d0f14]">
      <div className="relative bg-[radial-gradient(80%_90%_at_50%_0%,#064e3b,#05070a_70%)] px-4 pt-4 pb-3">
        <p className="text-[10px] font-black tracking-[0.18em] text-[#a7f3d0]">🏆 MAYOR LOGRO</p>
        {(win.images.before || win.images.after) && (
          <div className="mt-3 flex gap-2">
            <Shot src={win.images.before} label="ANTES" tone="before" alt={beforeAlt} />
            <Shot src={win.images.after} label="DESPUÉS" tone="after" alt={afterAlt} />
          </div>
        )}
      </div>
      <div className="px-4 pt-3.5 pb-4">
        <ProjectChip slug={win.project}>{win.project_title}</ProjectChip>
        <h2 className="mt-2 font-display text-[21px] leading-tight font-extrabold tracking-tight">{win.title}</h2>
        {win.change && <p className="mt-1.5 text-[13.5px] leading-snug text-[#a1a1aa]">{win.change}</p>}
        <div className="mt-3 flex flex-wrap gap-2">
          {prs && <Meta>{prs}</Meta>}
          <Meta>{tickets}</Meta>
          <Meta>{formatDayLong(win.day)}</Meta>
        </div>
      </div>
    </article>
  );
};

const Meta = ({ children }: { children: React.ReactNode }) => (
  <span className="rounded-[9px] bg-white/5 px-2 py-1 text-[11.5px] font-bold text-[#d4d4d8]">{children}</span>
);
