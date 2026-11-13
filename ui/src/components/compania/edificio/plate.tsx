// PLA-I39-4: the plate at the left of a floor. The project's name (one line, ellipsis, full text in title); the
// current deliverable (the active plan's title, else what is next; two lines at most); steps done of total as a
// strip; goal and date with the forecast, or "Sin meta: Fijar" (the goal dialog); the light's reason with its
// action; tokens used this week. PLA-I39-6: the name opens the plan in the side page (onPlan).
// PLA-23: the reason's action acts on this floor: "Publicar" opens the publish sheet (onPublish); "Ver la pregunta"
// brings the floor's question into view and marks it (onReveal), so the click always does something. The goal line
// says what is missing (a goal, or only its date), and the tokens line shows last week next to this week.
import type { ReactNode } from "react";
import { Link } from "react-router";
import type { OrgProject } from "@/lib/api";
import { tokens } from "@/lib/compania";
import { rumboText } from "@/lib/v2";
import { revealQuestion } from "./publish";

const MAX_SEGS = 24;

export const deliverableOf = (p: OrgProject): string | null => p.plan?.initiative.title ?? p.next?.title ?? null;

export const Plate = ({
  project: p,
  onFijar,
  onPlan,
  onPublish,
  onReveal = (x) => revealQuestion(x.slug),
  children,
}: {
  project: OrgProject;
  onFijar?: (p: OrgProject) => void;
  onPlan?: (p: OrgProject, el: HTMLElement) => void;
  onPublish?: (p: OrgProject) => void;
  onReveal?: (p: OrgProject) => void;
  children?: ReactNode;
}) => {
  const deliverable = deliverableOf(p);
  const rumbo = rumboText(p);
  const done = p.plan?.done ?? 0;
  const total = p.plan?.total ?? 0;
  const segs = Math.min(total, MAX_SEGS);
  const lit = total > 0 ? Math.round((done / total) * segs) : 0;
  const reason = p.light_reason;
  const href = reason?.action?.href ?? "";
  // PLA-I39-5: Te toca left the page; its pointer goes to the question on this floor (an older server still sends it).
  const toQuestion = href === "#te-toca" || href.startsWith("#pregunta");
  const usage = p.usage ?? { used: 0 };
  return (
    <>
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
      <p className="edi-deliv" data-deliverable title={deliverable ?? undefined}>
        {deliverable ?? "Sin entregable todavía"}
      </p>
      {total > 0 ? (
        <>
          <div className="edi-segs" role="img" aria-label={`${done} de ${total} pasos hechos`} data-segs={segs}>
            {Array.from({ length: segs }, (_, i) => (
              <i key={i} className={i < lit ? "edi-seg edi-seg-done" : "edi-seg"} />
            ))}
          </div>
          <p className="edi-count" data-steps>
            {done} de {total} pasos hechos
          </p>
        </>
      ) : (
        <p className="edi-count" data-steps>
          Aún no hay pasos
        </p>
      )}
      {rumbo.missing ? (
        <p className="edi-dest" data-rumbo="missing" title={rumbo.goal ? rumbo.goal : undefined}>
          {rumbo.goal ? "Meta sin fecha" : "Sin meta"}
          {onFijar ? ": " : ""}
          {onFijar && (
            <button type="button" className="edi-mini" onClick={() => onFijar(p)} data-control="fijar">
              {rumbo.goal ? "Poner fecha" : "Fijar meta"}
            </button>
          )}
        </p>
      ) : (
        <p className="edi-dest" data-rumbo="set">
          Meta: <b>{rumbo.goal}</b> · {rumbo.date}
          {rumbo.forecast && <span className={rumbo.forecast.tone === "ok" ? "edi-muted" : "edi-warn"}> · {rumbo.forecast.text}</span>}
          {onFijar && (
            <>
              {" "}
              <button type="button" className="edi-mini" onClick={() => onFijar(p)} data-control="fijar">
                Cambiar
              </button>
            </>
          )}
        </p>
      )}
      {reason && (
        <p className="edi-reason" data-light-reason>
          {reason.text}
          {reason.action &&
            (href === "#publicar" ? (
              onPublish ? (
                <button type="button" className="edi-mini edi-mini-strong" onClick={() => onPublish(p)} data-light-action data-control="publicar">
                  Publicar
                </button>
              ) : (
                <Link to="/inbox" className="edi-mini" data-light-action>
                  Publicar en Bandeja →
                </Link>
              )
            ) : toQuestion ? (
              <button type="button" className="edi-mini" onClick={() => onReveal(p)} data-light-action data-control="ver-pregunta">
                Ver la pregunta
              </button>
            ) : href.startsWith("#") || href.startsWith("/ceo") ? (
              <a href={href} className="edi-mini" data-light-action>
                {reason.action.label}
              </a>
            ) : (
              <Link to={reason.action.href} className="edi-mini" data-light-action>
                {reason.action.label} →
              </Link>
            ))}
        </p>
      )}
      <p className="edi-count" data-usage>
        {tokens(usage.used)} tokens esta semana
        {usage.last_week != null && <span className="edi-muted"> · {tokens(usage.last_week)} la pasada</span>}
      </p>
      {children}
    </>
  );
};
