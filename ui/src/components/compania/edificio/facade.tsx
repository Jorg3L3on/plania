// PLA-I47-5: El edificio, zoomed out (Design frame 9). Tu oficina on top (the roof: what waits on the owner, Brief de
// hoy), then one row per running project in the tower's order (floorOrder): its name and goal, the delivery's legs as
// bars, its team as small windows, Ahora's word and sentence, what comes next, and the move when it is the owner's
// (the same button as Ahora's). Paused projects sit under the street. A row opens its floor. Hook-free.
import type { CSSProperties, ReactNode } from "react";
import type { Decision, OrgProject } from "@/lib/api";
import { floorHue, floorOrder, nowLine, plateStatus, windowState } from "@/lib/edificio";
import { byRole } from "@/lib/org";
import { ActButton, type MoveCtx } from "./now";
import { legLooks } from "./route";
import { Glass } from "./window";

const Row = ({ p, now, decisions, companyPaused, timeZone, ctx, onPiso }: { p: OrgProject; now: number; decisions: Decision[]; companyPaused?: boolean; timeZone?: string; ctx: MoveCtx; onPiso?: (slug: string) => void }) => {
  const line = nowLine(p, decisions, now, { companyPaused, timeZone });
  const legs = p.route?.legs ?? [];
  const { looks } = legLooks(legs);
  const next = plateStatus(p);
  return (
    <li className="edi-fa-row" data-fa-row={p.slug} data-now={line.state} style={{ "--c": floorHue(p.slug) } as CSSProperties}>
      <button type="button" className="edi-fa-open" onClick={() => onPiso?.(p.slug)} aria-label={`Abrir el piso de ${p.title}`} data-control="fa-abrir">
        <span className="edi-fa-id">
          <span className="edi-bullet" aria-hidden>
            {p.title.charAt(0).toUpperCase()}
          </span>
          <span className="edi-fa-names">
            <b className="edi-fa-name">{p.title}</b>
            <small title={p.rumbo?.goal ?? undefined}>{p.rumbo?.goal ?? "Sin meta"}</small>
          </span>
        </span>
        <span className="edi-fa-route" aria-hidden>
          <span className="edi-fa-bars">
            {legs.map((l, i) => (
              <i key={l.key} data-look={looks[i]}>
                <u style={{ width: `${l.total ? Math.round((l.done / l.total) * 100) : 0}%` }} />
              </i>
            ))}
          </span>
          {next && <small>{next}</small>}
        </span>
        <span className="edi-fa-team" aria-hidden>
          {[...p.team].sort(byRole).map((m) => (
            <span key={m.agent} className="edi-win" data-state={windowState(m, companyPaused)}>
              <Glass role={m.role} state={windowState(m, companyPaused)} />
            </span>
          ))}
        </span>
        <span className="edi-fa-now">
          <span className="edi-pill" data-pill={line.state}>
            {line.word}
          </span>
          <span className="edi-fa-say">{line.say}</span>
        </span>
      </button>
      {line.move && (
        <span className="edi-fa-move" data-fa-move={p.slug}>
          <ActButton project={p} action={line.move.accion} move where="edificio" ctx={ctx} />
        </span>
      )}
    </li>
  );
};

export const Facade = ({
  projects,
  decisions,
  now,
  companyPaused,
  timeZone,
  ctx,
  roof,
  onPiso,
  onResume,
}: {
  projects: OrgProject[];
  decisions: Decision[];
  now: number;
  companyPaused?: boolean;
  timeZone?: string;
  ctx: MoveCtx;
  // Tu oficina: the roof and Brief de hoy, drawn by Building.
  roof?: ReactNode;
  onPiso?: (slug: string) => void;
  onResume?: (slug: string) => void;
}) => {
  const { floors, basement } = floorOrder(projects, decisions);
  return (
    <section className="edi-facade" aria-label="El edificio completo" data-facade={floors.length}>
      {roof && <div className="edi-fa-roof">{roof}</div>}
      <ol className="edi-fa-list">
        {floors.map((p) => (
          <Row key={p.slug} p={p} now={now} decisions={decisions} companyPaused={companyPaused} timeZone={timeZone} ctx={ctx} onPiso={onPiso} />
        ))}
      </ol>
      {basement.length > 0 && (
        <div className="edi-fa-under" data-fa-under={basement.length}>
          <p className="edi-eyebrow">Bajo la calle · en pausa</p>
          <div className="edi-fa-off">
            {basement.map((p) => (
              <span key={p.slug} className="edi-fa-offitem" style={{ "--c": floorHue(p.slug) } as CSSProperties}>
                <button type="button" onClick={() => onPiso?.(p.slug)} data-fa-off={p.slug}>
                  <span className="edi-bullet" aria-hidden>
                    {p.title.charAt(0).toUpperCase()}
                  </span>
                  {p.title}
                </button>
                {onResume && (
                  <button type="button" className="edi-mini" onClick={() => onResume(p.slug)} data-control="fa-reanudar">
                    Reanudar
                  </button>
                )}
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  );
};
