import { deltaText, cosasCaption } from "@/lib/progress";
import type { ProgressSummary } from "@/lib/types";

type Props = { data: ProgressSummary };

const RING = [
  { key: "bugs" as const, r: 62, color: "#34d399", track: "#34d39933" },
  { key: "prs" as const, r: 46, color: "#f472b6", track: "#f472b633" },
  { key: "initiatives" as const, r: 30, color: "#a78bfa", track: "#a78bfa33" },
];

const Ring = ({ r, value, max, color, track }: { r: number; value: number; max: number; color: string; track: string }) => {
  const circ = 2 * Math.PI * r;
  const frac = max > 0 ? Math.min(1, value / max) : 0;
  return (
    <>
      <circle cx="85" cy="85" r={r} fill="none" stroke={track} strokeWidth="11" />
      <circle
        cx="85"
        cy="85"
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="11"
        strokeLinecap="round"
        strokeDasharray={`${frac * circ} ${circ}`}
        style={{ filter: `drop-shadow(0 0 6px ${color})` }}
      />
    </>
  );
};

export const RecapHero = ({ data }: Props) => {
  const delta = deltaText(data.delta_pct, data.range);
  const max = Math.max(data.bugs, data.prs, data.initiatives, 1);
  const digits = String(data.finished).length;
  return (
    <section className="relative overflow-hidden rounded-[32px] border border-white/10 bg-[#0b0b10] px-5 pt-5 pb-4" aria-label={data.label}>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_70%_at_100%_0%,#ff5b2e55,transparent_60%),radial-gradient(50%_60%_at_0%_100%,#7c3aed55,transparent_60%),radial-gradient(40%_40%_at_70%_80%,#ec489933,transparent_70%)]"
      />
      <div className="relative">
        <p className="text-[12px] font-extrabold tracking-[0.14em] text-[#ffd2b8]">{data.label}</p>
        <svg viewBox="0 0 170 170" className="absolute top-1 right-0 size-[128px] overflow-visible" aria-hidden>
          <g fill="none" transform="rotate(-90 85 85)">
            {RING.map((ring) => (
              <Ring key={ring.key} r={ring.r} value={data[ring.key]} max={max} color={ring.color} track={ring.track} />
            ))}
          </g>
          <text x="85" y="80" textAnchor="middle" fill="#fff" fontSize="11" fontWeight="800">
            META
          </text>
          <text x="85" y="98" textAnchor="middle" fill="#fff" fontSize="16" fontWeight="900">
            {data.finished > 0 ? "✓" : "·"}
          </text>
        </svg>
        <p
          className="mt-3 bg-gradient-to-r from-white via-[#ffd2b8] to-[#ff8a5c] bg-clip-text font-display leading-[0.82] font-black tracking-[-0.06em] text-transparent"
          style={{ fontSize: digits >= 4 ? 76 : 108 }}
        >
          {data.finished}
        </p>
        <p className="max-w-[210px] text-[20px] leading-tight font-bold tracking-tight">{cosasCaption(data.finished, data.projects_touched)}</p>
        {delta && (
          <p className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-2.5 py-1.5 text-[12px] font-extrabold">
            <span className={delta.up ? "text-[#4ade80]" : "text-[#fb7185]"}>{delta.text}</span>
          </p>
        )}
        <div className="mt-4 grid grid-cols-3 gap-2">
          <Kpi n={data.bugs} label="Bugs arreglados" mark="🐞" />
          <Kpi n={data.prs} label="PRs fusionados" mark="🔀" />
          <Kpi n={data.initiatives} label="Iniciativas" mark="🏁" />
        </div>
      </div>
    </section>
  );
};

const Kpi = ({ n, label, mark }: { n: number; label: string; mark: string }) => (
  <div className="rounded-[18px] border border-white/10 bg-black/40 px-3 py-2.5">
    <span className="float-right text-base" aria-hidden>
      {mark}
    </span>
    <b className="block font-display text-[28px] leading-none font-black tracking-tight">{n}</b>
    <span className="mt-1 block text-[11px] font-semibold text-[#c4c4cc]">{label}</span>
  </div>
);
