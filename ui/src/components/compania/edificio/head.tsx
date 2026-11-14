// PLA-I47-2: the floor's Encabezado, one line (Design frame 2). The project's initial and name (it opens the plan
// in the side page, later Resumen in La ficha), the goal (one line, full text in title; «Sin meta · Fijar meta» when
// there is none), the state pill (Ahora's word), the delivery date with its pace, and the plate's one status line
// (or the problem the light names, with its link). What is the owner's to do stays Ahora's move.
import type { ReactNode } from "react";
import { Link } from "react-router";
import type { OrgProject } from "@/lib/api";
import { plateStatus, type NowLine } from "@/lib/edificio";
import { rumboText } from "@/lib/v2";

const TONE: Record<NowLine["state"], string> = { you: "you", work: "work", rest: "idle", stuck: "bad", done: "ok", off: "idle", idle: "idle", back: "back" };

export const TONE_OF = TONE;

export const Head = ({
  project: p,
  line,
  onFijar,
  onPlan,
  extra,
}: {
  project: OrgProject;
  line: NowLine;
  onFijar?: (p: OrgProject) => void;
  onPlan?: (p: OrgProject, el: HTMLElement) => void;
  // A paused floor's Reanudar.
  extra?: ReactNode;
}) => {
  const rumbo = rumboText(p);
  const status = plateStatus(p);
  const problem = p.light_reason && p.light !== "needs_jorge" && p.light !== "ok" ? p.light_reason : null;
  return (
    <header className="edi-fhead">
      <h2 className="edi-fname">
        <span className="edi-bullet" aria-hidden>
          {p.title.charAt(0).toUpperCase()}
        </span>
        {onPlan ? (
          <button type="button" className="edi-nm" title={p.title} onClick={(e) => onPlan(p, e.currentTarget)} data-control="plan">
            {p.title}
          </button>
        ) : (
          <Link to={`/p/${encodeURIComponent(p.slug)}`} className="edi-nm" title={p.title} data-control="abrir">
            {p.title}
          </Link>
        )}
      </h2>
      {rumbo.goal ? (
        <p className="edi-goal" data-rumbo="set" data-goal title={rumbo.goal}>
          {rumbo.goal}
        </p>
      ) : (
        <p className="edi-dest edi-goal" data-rumbo="missing">
          <span className="edi-warn">Sin meta</span>
          {onFijar && (
            <>
              {" · "}
              <button type="button" className="edi-mini" onClick={() => onFijar(p)} data-control="fijar">
                Fijar meta
              </button>
            </>
          )}
        </p>
      )}
      <div className="edi-fmeta">
        <span className="edi-pill" data-tone={TONE[line.state]} data-pill={line.state}>
          <i aria-hidden />
          {line.word}
        </span>
        {rumbo.date && (
          <span className="edi-fdate" data-fdate>
            Entrega <b>{rumbo.date}</b>
            {rumbo.forecast && <> · {rumbo.forecast.text}</>}
          </span>
        )}
        {extra}
      </div>
      {problem ? (
        <p className="edi-fstatus edi-reason" data-light-reason data-status title={problem.text}>
          {problem.text}
          {problem.action && !problem.action.href.startsWith("#") && (
            <Link to={problem.action.href} className="edi-mini" data-light-action>
              {problem.action.label} →
            </Link>
          )}
        </p>
      ) : (
        status &&
        !p.route?.legs.length && (
          <p className="edi-fstatus edi-count" data-status title={status}>
            {status}
          </p>
        )
      )}
    </header>
  );
};
