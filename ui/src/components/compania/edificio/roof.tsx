// PLA-I39-3: the roof, "Tu oficina". PLA-I46-3: Te toca with the number and one chip per floor whose move waits,
// saying the move's texto word for word (lib/edificio.ts roofChips); a chip jumps to its floor, or opens its row in
// place when nobody on that floor asked it. Then a decision no floor can show. Deliveries this week; no tokens on the
// building (PLA-I46-4: they live in Máquina).
import type { Decision, OrgPlumbing, OrgProject } from "@/lib/api";
import { roofChips } from "@/lib/edificio";
import { Glass } from "./window";
import { RoofQuestion, type QuestionActs } from "./question";

const short = (s: string, n = 64) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

export const Roof = ({
  decisions,
  projects,
  onChip,
  open,
  acts,
}: {
  decisions: Decision[];
  projects: OrgProject[];
  // Kept for callers that still pass it; the roof shows no tokens.
  plumbing?: OrgPlumbing;
  onChip?: (d: Decision, onTeam: boolean) => void;
  open?: string | null;
  acts?: QuestionActs;
}) => {
  const chips = roofChips(decisions, projects);
  const waiting = chips.length;
  const opened = open ? (chips.find((c) => c.decision?.id === open && !c.onTeam)?.decision ?? null) : null;
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
            {chips.length === 0 && <span className="edi-muted">Nada pendiente.</span>}
            {chips.map((c) => {
              const where = c.project?.title ?? c.decision?.project ?? "Compañía";
              const label = `${where}: ${c.move ? c.move.texto : short(c.decision!.title)}`;
              const d = c.decision;
              return c.onTeam || !onChip || !d ? (
                <a key={c.key} className="edi-chip" data-chip={c.key} data-chip-move={c.move ? "1" : undefined} data-on-team={c.onTeam ? "1" : "0"} href={c.project ? `#piso-${c.project.slug}` : "#"}>
                  {label}
                </a>
              ) : (
                <button key={c.key} type="button" className="edi-chip" data-chip={c.key} data-chip-move={c.move ? "1" : undefined} data-on-team="0" aria-expanded={open === d.id} onClick={() => onChip(d, c.onTeam)}>
                  {label}
                </button>
              );
            })}
          </div>
          <p className="edi-stat" data-stat>
            {delivered === 1 ? "1 entrega" : `${delivered} entregas`} esta semana
          </p>
          {opened && acts && <RoofQuestion d={opened} title={opened.project ? (projects.find((p) => p.slug === opened.project)?.title ?? opened.project) : "Compañía"} acts={acts} />}
        </div>
      </div>
      <span className="edi-antenna" aria-hidden />
    </div>
  );
};
