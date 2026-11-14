// PLA-I39-4: the plate at the left of a floor. PLA-I46-4: compact. The project's name (one line, ellipsis, full
// text in title; it opens the plan in the side page with onPlan); the real goal (the goal sentence, or «Sin meta ·
// Fijar meta» only when the project has none); one status line in plain words (lib/edificio.ts plateStatus: where
// the delivery stands, what is postponed on purpose); then what the floor passes in: Pedir (a secondary button that
// opens the side page) and Lo último in one line with «Ver todo». No tokens and no action buttons here: what is the
// owner's to do is the floor's move (Ahora, Tú and the phone bar).
import type { ReactNode } from "react";
import { Link } from "react-router";
import type { OrgProject } from "@/lib/api";
import { plateStatus } from "@/lib/edificio";
import { rumboText } from "@/lib/v2";

export const deliverableOf = (p: OrgProject): string | null => p.plan?.initiative.title ?? p.next?.title ?? null;

export const Plate = ({
  project: p,
  onFijar,
  onPlan,
  children,
}: {
  project: OrgProject;
  onFijar?: (p: OrgProject) => void;
  onPlan?: (p: OrgProject, el: HTMLElement) => void;
  // Kept for callers that still pass them: the plate draws no action of its own any more.
  onPublish?: (p: OrgProject) => void;
  onReveal?: (p: OrgProject) => void;
  noSteps?: boolean;
  children?: ReactNode;
}) => {
  const rumbo = rumboText(p);
  const status = plateStatus(p);
  const problem = p.light_reason && p.light !== "needs_jorge" && p.light !== "ok" ? p.light_reason : null;
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
      {rumbo.goal ? (
        <p className="edi-goal" data-rumbo="set" data-goal title={rumbo.goal}>
          {rumbo.goal}
        </p>
      ) : (
        <p className="edi-dest" data-rumbo="missing">
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
      {/* A problem the light names (a failed run, a block) is the status line, with its link; what is the owner's
          to do is not repeated here (needs_jorge is the floor's move). */}
      {problem ? (
        <p className="edi-reason" data-light-reason data-status>
          {problem.text}
          {problem.action && !problem.action.href.startsWith("#") && (
            <Link to={problem.action.href} className="edi-mini" data-light-action>
              {problem.action.label} →
            </Link>
          )}
        </p>
      ) : (
        status && (
          <p className="edi-count" data-status>
            {status}
          </p>
        )
      )}
      {children}
    </>
  );
};
