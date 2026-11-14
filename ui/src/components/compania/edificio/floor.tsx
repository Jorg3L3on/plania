// PLA-I39-3: one project is one floor; its colour is one of six fixed hues picked from the slug.
// PLA-I47-2 (Compañía v6, Design frames 2-6): the floor is sized to the window, never to its content. Top to bottom:
// Encabezado (head.tsx, one line), Entrega as one row (route.tsx, legs only), then two columns: on the left Ahora (the
// only part that grows), Equipo as a row of small windows and Pedir as a bar; on the right the column that scrolls
// inside itself (the leg's steps and Lo último until La fila and La ficha take them). The plate column and the «Tú»
// window are gone: the owner's move is Ahora's (and the phone bar's).
import { Fragment, type CSSProperties, type ReactNode } from "react";
import type { Decision, OrgMember, OrgProject } from "@/lib/api";
import { RECIBIRIA, floorHue, hangingFor, nowLine, returnedOf } from "@/lib/edificio";
import { deliveryOf } from "@/lib/evidencia";
import { byRole } from "@/lib/org";
import { After, Last } from "./after";
import { Fila, type FilaActs } from "./fila";
import { Head } from "./head";
import { Now, type NowActs } from "./now";
import { Question, bubblePlace, type QuestionActs } from "./question";
import { Route, Steps } from "./route";
import { Window } from "./window";

export const Floor = ({
  project: p,
  now,
  companyPaused,
  resume,
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
  ventana,
  fila,
  onLeg,
  ficha,
  children,
}: {
  project: OrgProject;
  now: number;
  companyPaused?: boolean;
  // A paused floor's Reanudar, in the Encabezado.
  resume?: ReactNode;
  onOpen?: (m: OrgMember, el: HTMLElement) => void;
  onFijar?: (p: OrgProject) => void;
  onPlan?: (p: OrgProject, el: HTMLElement) => void;
  // PLA-23: "Publicar".
  onPublish?: (p: OrgProject) => void;
  // PLA-I39-5: the decisions hang under their asker's window.
  decisions?: Decision[];
  acts?: QuestionActs;
  // PLA-I39-7: the ask bar, and the PO's line while the owner types in it.
  ask?: ReactNode;
  typing?: boolean;
  // PLA-I40-4: Ahora's clock zone and its calls.
  timeZone?: string;
  nowActs?: NowActs;
  // PLA-I40-7: what goes under Solo tú (the project's switch).
  solo?: ReactNode;
  // PLA-I46-7: the Ventana a la app, mounted beside Ahora's text.
  ventana?: ReactNode;
  // PLA-I47-3: La fila's calls; with them the right column is La fila, then Lo último and Solo tú.
  fila?: FilaActs;
  // PLA-I47-4: a leg opens in La ficha.
  onLeg?: (key: string, el: HTMLElement) => void;
  // PLA-I47-4: La ficha is on screen (it carries Lo último and Solo tú).
  ficha?: boolean;
  // The «+ Sumar» window.
  children?: ReactNode;
}) => {
  const team = [...p.team].sort(byRole);
  let first = true;
  const line = nowLine(p, decisions ?? [], now, { companyPaused, timeZone });
  // PLA-I46-11: a leg's plan that is the move shows in Ahora (plan.tsx), not under the PO's window.
  const o = line.move?.origen;
  // PLA-I46-10: so does a delivery to accept: its evidence card is in Ahora, so it does not hang under Taller.
  const dv = deliveryOf(line.move, decisions ?? []);
  const inAhora = o?.kind === "decision" && (decisions?.find((d) => d.id === o.id)?.plan?.leg || dv) ? o.id : null;
  // PLA-I46-10: a delivery sent back: its maker's window is violet until it comes back.
  const back = line.move ? null : returnedOf(p.slug, decisions ?? []);
  const isBack = (m: OrgMember) => !!back && (back.agent ? back.agent === m.agent : m.role === "taller");
  const slots = team.length + (children ? 1 : 0);
  const bubbles = !!(decisions && acts && team.some((m) => hangingFor(decisions, p.slug, m.agent, inAhora)));
  return (
    <article id={`piso-${p.slug}`} tabIndex={-1} className="edi-floor" data-floor={p.slug} data-light={p.light} data-move={line.move ? line.move.verbo : undefined} style={{ "--c": floorHue(p.slug) } as CSSProperties} aria-label={p.title}>
      <Head project={p} line={line} onFijar={onFijar} onPlan={onPlan} extra={resume} />
      <Route project={p} now={now} timeZone={timeZone} onPlan={nowActs?.onPlan} busy={nowActs?.busy === `${p.slug}:plan`} steps={false} onLeg={onLeg} />
      <div className="edi-fbody">
        <div className="edi-stage">
          <Now project={p} line={line} now={now} decisions={decisions} acts={nowActs} qacts={acts} onFijar={onFijar} onPublish={onPublish} side={ventana} anchor={dv && !bubbles ? `pregunta-${p.slug}` : undefined} />
          <div className="edi-wins edi-team" style={{ "--n": Math.max(team.length, 3), "--add": children ? "46px" : "0px" } as CSSProperties} data-team={team.length}>
            {team.map((m, i) => {
              const hanging = decisions && acts ? hangingFor(decisions, p.slug, m.agent, inAhora) : null;
              const anchor = hanging && first ? `pregunta-${p.slug}` : undefined;
              if (hanging) first = false;
              return (
                <Fragment key={m.agent}>
                  <div className="edi-slot" style={{ "--i": i } as CSSProperties} data-holding={line.holder === m.agent ? "1" : undefined}>
                    <Window
                      member={m}
                      project={p.title}
                      now={now}
                      companyPaused={companyPaused}
                      timeZone={timeZone}
                      onOpen={onOpen}
                      back={isBack(m)}
                      hint={typing && m.role === "product-owner" ? RECIBIRIA : null}
                    />
                    {line.holder === m.agent && <span className="edi-mark" aria-hidden />}
                  </div>
                  {hanging && acts && <Question hanging={hanging} role={m.role} anchor={anchor} style={bubblePlace(i, slots)} acts={acts} />}
                </Fragment>
              );
            })}
            {children && (
              <div className="edi-slot" style={{ "--i": team.length } as CSSProperties}>
                {children}
              </div>
            )}
          </div>
          {ask && <div className="edi-askbar">{ask}</div>}
        </div>
        <div className="edi-fcol" data-col="fila">
          {fila ? <Fila project={p} decisions={decisions ?? []} now={now} timeZone={timeZone} acts={fila} /> : <Steps project={p} now={now} timeZone={timeZone} />}
          {/* PLA-I47-4: with La ficha, Lo último and Solo tú live in its Resumen. */}
          {!ficha && (
            <>
              <Last project={p} decisions={decisions ?? []} now={now} timeZone={timeZone} acts={nowActs} qacts={acts} />
              <After project={p} decisions={decisions ?? []} now={now} timeZone={timeZone} acts={nowActs} qacts={acts} solo={solo} hideAuto={!!dv} />
            </>
          )}
        </div>
      </div>
    </article>
  );
};
