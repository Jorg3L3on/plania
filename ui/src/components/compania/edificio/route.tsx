// PLA-I40-5: the route under the team. The delivery's legs as bars with their name and count, the one we stand on
// in the floor's hue, and that leg's steps by name with one line of state each (lib/edificio.ts). With no plan it
// says so and offers to ask the PO for one. Presentational.
import type { CSSProperties } from "react";
import type { OrgProject } from "@/lib/api";
import { legLine, routeCount, stepLine, stepMark } from "@/lib/edificio";

export const PLAN_ASK = "Arma el plan del proyecto: los entregables y los pasos de cada uno.";

export const Route = ({ project: p, now, timeZone, onPlan, busy }: { project: OrgProject; now: number; timeZone?: string; onPlan?: (slug: string, text: string) => void; busy?: boolean }) => {
  const r = p.route;
  if (r === undefined) return null;
  if (!r || r.legs.length === 0)
    return (
      <div className="edi-route" data-route="empty">
        <p className="edi-rhead">
          <b>Entrega</b>
          <span>Aún no hay plan</span>
        </p>
        {onPlan && !p.paused && (
          <div>
            <button type="button" className="edi-btn" onClick={() => onPlan(p.slug, PLAN_ASK)} disabled={busy} data-control="planear">
              Que PO lo planee
            </button>
          </div>
        )}
      </div>
    );
  const here = r.legs.find((l) => l.state === "here");
  return (
    <div className="edi-route" data-route={r.legs.length}>
      <p className="edi-rhead">
        <b>Entrega</b>
        <span data-route-count>{routeCount(r)}</span>
      </p>
      <ol className="edi-legs" style={{ "--n": r.legs.length } as CSSProperties}>
        {r.legs.map((l) => (
          <li key={l.key} className="edi-leg" data-leg={l.state} aria-current={l.state === "here" ? "step" : undefined}>
            <span className="edi-legbar" aria-hidden>
              <i style={{ width: `${l.total ? Math.round((l.done / l.total) * 100) : 0}%` }} />
            </span>
            <b>{l.title}</b>
            <span>{legLine(l)}</span>
          </li>
        ))}
      </ol>
      {here?.steps && here.steps.length > 0 && (
        <ol className="edi-steps" data-steps-of={here.title}>
          {here.steps.map((s) => (
            <li key={s.key} data-step={s.state} data-mark={stepMark(s)}>
              <span className="edi-smark" aria-hidden>
                {stepMark(s) === "done" ? "✓" : ""}
              </span>
              <span className="edi-stext">
                <b>{s.title}</b>
                <span>{stepLine(s, p.team, now, timeZone)}</span>
              </span>
            </li>
          ))}
          {!!here.more_steps && (
            <li data-mark="later">
              <span className="edi-smark" aria-hidden />
              <span className="edi-stext">
                <span>+{here.more_steps} pasos más</span>
              </span>
            </li>
          )}
        </ol>
      )}
    </div>
  );
};
