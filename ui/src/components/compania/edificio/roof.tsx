// PLA-I39-3: the roof, "Tu oficina". Te toca with the number and one chip per waiting decision (a chip jumps to its
// floor, or opens its row when nobody on that floor asked it), deliveries this week and tokens this week.
import type { Decision, OrgPlumbing, OrgProject } from "@/lib/api";
import { tokens } from "@/lib/compania";
import { roofChips } from "@/lib/edificio";
import { teToca } from "@/lib/v2";
import { Glass } from "./window";

const short = (s: string, n = 48) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

export const Roof = ({
  decisions,
  projects,
  plumbing,
  onChip,
}: {
  decisions: Decision[];
  projects: OrgProject[];
  plumbing: OrgPlumbing;
  onChip?: (d: Decision, onTeam: boolean) => void;
}) => {
  const { waiting } = teToca(decisions);
  const chips = roofChips(decisions, projects);
  const titles = new Map(projects.map((p) => [p.slug, p.title]));
  const delivered = projects.reduce((n, p) => n + p.this_week.done, 0);
  return (
    <div className="edi-rooftop">
      <div className="edi-pent" data-roof>
        <Glass role="jorge" state={waiting > 0 ? "ask" : "idle"} />
        <div className="edi-penttxt">
          <p className="edi-eyebrow">Tu oficina</p>
          <div className="edi-toca" data-te-toca={waiting}>
            <span className="edi-toca-n">
              Te toca <b className="num">{waiting}</b>
            </span>
            {chips.length === 0 && <span className="edi-muted">Nada te espera.</span>}
            {chips.map(({ decision: d, onTeam }) => {
              const label = `${d.project ? `${titles.get(d.project) ?? d.project}: ` : ""}${short(d.title)}`;
              return onChip ? (
                <button key={d.id} type="button" className="edi-chip" data-chip={d.id} data-on-team={onTeam ? "1" : "0"} onClick={() => onChip(d, onTeam)}>
                  {label}
                </button>
              ) : (
                <a key={d.id} className="edi-chip" data-chip={d.id} href={d.project ? `#piso-${d.project}` : "#te-toca"}>
                  {label}
                </a>
              );
            })}
          </div>
          <p className="edi-stat" data-stat>
            {delivered === 1 ? "1 entrega" : `${delivered} entregas`} esta semana · {tokens(plumbing.spend)} tokens esta semana
          </p>
        </div>
      </div>
      <span className="edi-antenna" aria-hidden />
    </div>
  );
};
