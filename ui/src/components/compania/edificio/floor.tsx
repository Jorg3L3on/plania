// PLA-I39-3: one project is one floor: its plate on the left, its team as windows on the right. The floor's
// colour is one of six fixed hues picked from the slug. PLA-I39-4: the plate (plate.tsx), with Pedir and Lo último
// under it. On the right: the route (Entrega) first, then the Ahora band and the team, then Solo tú.
import { Fragment, type CSSProperties, type ReactNode } from "react";
import type { Decision, OrgMember, OrgProject } from "@/lib/api";
import { RECIBIRIA, floorHue, hangingFor, nowLine, ownerCaption } from "@/lib/edificio";
import { byRole } from "@/lib/org";
import { After, Last } from "./after";
import { Figure } from "./figure";
import { ActButton, Now, type NowActs } from "./now";
import { Plate } from "./plate";
import { Question, bubblePlace, type QuestionActs } from "./question";
import { Route } from "./route";
import { Window } from "./window";

export const Floor = ({
  project: p,
  now,
  companyPaused,
  plate,
  onOpen,
  onFijar,
  onPlan,
  onPublish,
  decisions,
  acts,
  ask,
  typing,
  timeZone,
  nowActs,
  solo,
  children,
}: {
  project: OrgProject;
  now: number;
  companyPaused?: boolean;
  plate?: ReactNode;
  onOpen?: (m: OrgMember, el: HTMLElement) => void;
  onFijar?: (p: OrgProject) => void;
  onPlan?: (p: OrgProject, el: HTMLElement) => void;
  // PLA-23: the plate's "Publicar".
  onPublish?: (p: OrgProject) => void;
  // PLA-I39-5: the decisions hang under their asker's window.
  decisions?: Decision[];
  acts?: QuestionActs;
  // PLA-I39-7: the ask box under the plate, and the PO's line while the owner types in it.
  ask?: ReactNode;
  typing?: boolean;
  // PLA-I40-4: the band's clock zone and its calls.
  timeZone?: string;
  nowActs?: NowActs;
  // PLA-I40-7: what goes under Solo tú (the project's switch).
  solo?: ReactNode;
  children?: ReactNode;
}) => {
  const team = [...p.team].sort(byRole);
  let first = true;
  // PLA-I40-4: what is happening now, who holds the work (a mark sits under them), and the owner as one more figure.
  const line = nowLine(p, decisions ?? [], now, { companyPaused, timeZone });
  const you = ownerCaption(line);
  const slots = team.length + 1 + (children ? 1 : 0);
  return (
    <article id={`piso-${p.slug}`} className="edi-floor" data-floor={p.slug} data-light={p.light} data-move={line.move ? line.move.verbo : undefined} style={{ "--c": floorHue(p.slug) } as CSSProperties} aria-label={p.title}>
      <div className="edi-plate">
        {plate ?? (
          <Plate project={p} onFijar={onFijar} onPlan={onPlan} onPublish={onPublish} noSteps={p.route !== undefined}>
            {ask}
            <Last project={p} decisions={decisions ?? []} now={now} timeZone={timeZone} acts={nowActs} qacts={acts} />
          </Plate>
        )}
      </div>
      <div className="edi-wins">
        <Now project={p} line={line} now={now} decisions={decisions} acts={nowActs} qacts={acts} onFijar={onFijar} onPublish={onPublish} />
        {team.map((m, i) => {
          const hanging = decisions && acts ? hangingFor(decisions, p.slug, m.agent) : null;
          const anchor = hanging && first ? `pregunta-${p.slug}` : undefined;
          if (hanging) first = false;
          return (
            <Fragment key={m.agent}>
              <div className="edi-slot" style={{ "--i": i } as CSSProperties} data-holding={line.holder === m.agent ? "1" : undefined}>
                {line.holder === m.agent && <span className="edi-mark" aria-hidden />}
                <Window
                  member={m}
                  project={p.title}
                  now={now}
                  companyPaused={companyPaused}
                  timeZone={timeZone}
                  onOpen={onOpen}
                  hint={typing && m.role === "product-owner" ? RECIBIRIA : null}
                />
              </div>
              {hanging && acts && <Question hanging={hanging} role={m.role} anchor={anchor} style={bubblePlace(i, slots)} acts={acts} />}
            </Fragment>
          );
        })}
        <div className="edi-slot" style={{ "--i": team.length } as CSSProperties} data-owner data-holding={line.holder === "owner" ? "1" : undefined}>
          {line.holder === "owner" && <span className="edi-mark" aria-hidden />}
          <div className="edi-win edi-you" data-state={companyPaused ? "off" : you.lit ? "you" : "idle"} role="group" aria-label={`Tú, en ${p.title}: ${you.doing}`}>
            <span className="edi-glass">
              <Figure role="owner" />
            </span>
            <span className="edi-who">
              <b>Tú</b>
              <i>decides</i>
            </span>
            <span className="edi-do" data-doing>
              {you.doing}
            </span>
            {/* PLA-I46-3: the same button as Ahora's, still (only Ahora breathes); hidden at 390 where the bar has it. */}
            {line.move && <ActButton project={p} action={line.move.accion} move where="tu" className="edi-tu-go" ctx={{ decisions, acts: nowActs, qacts: acts, onFijar, onPublish }} />}
          </div>
        </div>
        {children && (
          <div className="edi-slot" style={{ "--i": team.length + 1 } as CSSProperties}>
            {children}
          </div>
        )}
        <Route project={p} now={now} timeZone={timeZone} onPlan={nowActs?.onPlan} busy={nowActs?.busy === `${p.slug}:plan`} />
        <After project={p} decisions={decisions ?? []} now={now} timeZone={timeZone} acts={nowActs} qacts={acts} solo={solo} />
      </div>
    </article>
  );
};
