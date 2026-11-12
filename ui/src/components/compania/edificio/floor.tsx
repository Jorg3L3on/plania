// PLA-I39-3: one project is one floor: its plate on the left, its team as windows on the right. The floor's
// colour is one of six fixed hues picked from the slug. PLA-I39-4: the plate (plate.tsx).
import { Fragment, type CSSProperties, type ReactNode } from "react";
import type { Decision, OrgMember, OrgProject } from "@/lib/api";
import { RECIBIRIA, floorHue, hangingFor } from "@/lib/edificio";
import { byRole } from "@/lib/org";
import { Plate } from "./plate";
import { Question, bubblePlace, type QuestionActs } from "./question";
import { Window } from "./window";

export const Floor = ({
  project: p,
  now,
  companyPaused,
  plate,
  onOpen,
  onFijar,
  onPlan,
  decisions,
  acts,
  ask,
  typing,
  children,
}: {
  project: OrgProject;
  now: number;
  companyPaused?: boolean;
  plate?: ReactNode;
  onOpen?: (m: OrgMember, el: HTMLElement) => void;
  onFijar?: (p: OrgProject) => void;
  onPlan?: (p: OrgProject, el: HTMLElement) => void;
  // PLA-I39-5: the decisions hang under their asker's window.
  decisions?: Decision[];
  acts?: QuestionActs;
  // PLA-I39-7: the ask box under the plate, and the PO's line while the owner types in it.
  ask?: ReactNode;
  typing?: boolean;
  children?: ReactNode;
}) => {
  const team = [...p.team].sort(byRole);
  let first = true;
  return (
    <article id={`piso-${p.slug}`} className="edi-floor" data-floor={p.slug} data-light={p.light} style={{ "--c": floorHue(p.slug) } as CSSProperties} aria-label={p.title}>
      <div className="edi-plate">{plate ?? <Plate project={p} onFijar={onFijar} onPlan={onPlan}>{ask}</Plate>}</div>
      <div className="edi-wins">
        {team.map((m, i) => {
          const hanging = decisions && acts ? hangingFor(decisions, p.slug, m.agent) : null;
          const anchor = hanging && first ? `pregunta-${p.slug}` : undefined;
          if (hanging) first = false;
          return (
            <Fragment key={m.agent}>
              <div className="edi-slot" style={{ "--i": i } as CSSProperties}>
                <Window member={m} project={p.title} now={now} companyPaused={companyPaused} onOpen={onOpen} hint={typing && m.role === "product-owner" ? RECIBIRIA : null} />
              </div>
              {hanging && acts && <Question hanging={hanging} role={m.role} anchor={anchor} style={bubblePlace(i, team.length + (children ? 1 : 0))} acts={acts} />}
            </Fragment>
          );
        })}
        {children && (
          <div className="edi-slot" style={{ "--i": team.length } as CSSProperties}>
            {children}
          </div>
        )}
      </div>
    </article>
  );
};
