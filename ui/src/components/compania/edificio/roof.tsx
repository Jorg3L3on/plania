// PLA-I39-3: the roof, "Tu oficina". Te toca with the number and one chip per waiting decision (a chip jumps to its
// floor, or opens its row when nobody on that floor asked it), deliveries this week and tokens this week.
import type { Decision, OrgPlumbing, OrgProject } from "@/lib/api";
import { tokens } from "@/lib/compania";
import { roofChips } from "@/lib/edificio";
import { teToca } from "@/lib/v2";
import { Glass } from "./window";
import { RoofQuestion, type QuestionActs } from "./question";

const short = (s: string, n = 48) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

export const Roof = ({
  decisions,
  projects,
  plumbing,
  onChip,
  open,
  acts,
}: {
  decisions: Decision[];
  projects: OrgProject[];
  plumbing: OrgPlumbing;
  onChip?: (d: Decision, onTeam: boolean) => void;
  open?: string | null;
  acts?: QuestionActs;
}) => {
  const { waiting } = teToca(decisions);
  const chips = roofChips(decisions, projects);
  const titles = new Map(projects.map((p) => [p.slug, p.title]));
  const opened = open ? (chips.find((c) => c.decision.id === open && !c.onTeam)?.decision ?? null) : null;
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
              return onTeam || !onChip ? (
                <a key={d.id} className="edi-chip" data-chip={d.id} data-on-team={onTeam ? "1" : "0"} href={d.project ? `#piso-${d.project}` : "#"}>
                  {label}
                </a>
              ) : (
                <button key={d.id} type="button" className="edi-chip" data-chip={d.id} data-on-team="0" aria-expanded={open === d.id} onClick={() => onChip(d, onTeam)}>
                  {label}
                </button>
              );
            })}
          </div>
          <p className="edi-stat" data-stat>
            {delivered === 1 ? "1 entrega" : `${delivered} entregas`} esta semana · {tokens(plumbing.spend)} tokens esta semana
          </p>
          {opened && acts && <RoofQuestion d={opened} title={opened.project ? (titles.get(opened.project) ?? opened.project) : "Compañía"} acts={acts} />}
        </div>
      </div>
      <span className="edi-antenna" aria-hidden />
    </div>
  );
};
