// PLA-I39-3: one project is one floor; its colour is one of six fixed hues picked from the slug.
// PLA-I47-2 (Compañía v6): the floor is sized to the window, never to its content.
// PLA-I53-3 (Design doc of PLA-I53): top to bottom, the Encabezado (head.tsx, one line), the Ahora slot (today the
// floor's Ahora band, now.tsx; F4 puts the one true Ahora line here), the stage board (components/plan/stage-board.tsx,
// the only part that grows, scrolling inside itself) and Pedir as a bar. The board takes the place of the Entrega strip
// and La fila: the teammates' windows are its stations (PO over Por hacer, Taller, QA), the others sit in its corner
// with Sumar, their questions hang under the stations, and each card carries what La fila let the owner do (Detener,
// Hacer primero, Aceptar, Quitar). A card, a track or a Hecho stack opens in La ficha.
import type { CSSProperties, ReactNode } from "react";
import type { Decision, OrgMember, OrgOrder, OrgProject, ProjectTicket, Tablero } from "@/lib/api";
import { BACK_WORD, RECIBIRIA, caption, floorHue, hangingFor, nowLine, returnedOf, windowLabel, windowState } from "@/lib/edificio";
import { ACT_LABEL, actBusyKey, cardActs, OPEN_ORDER, STATIONS, type CardAct } from "@/lib/etapas";
import { deliveryOf } from "@/lib/evidencia";
import { byRole, roleName } from "@/lib/org";
import { StageBoard, type StationHeadProps } from "@/components/plan/stage-board";
import { After, Last } from "./after";
import { Figure } from "./figure";
import { Head } from "./head";
import { Now, type NowActs } from "./now";
import { Question, type QuestionActs } from "./question";

// The calls a card makes, the same routes La fila used (pickNext, stop a run, the delivery's own accept, cancel an
// order), and what opens in La ficha.
export type BoardActs = {
  onPickNext?: (slug: string, key: string) => void;
  onStop?: (runId: string) => void;
  onAccept?: (d: Decision, action: "fusionar" | "aceptar") => void;
  onCancel?: (slug: string, key: string) => void;
  onTicket?: (slug: string, t: ProjectTicket, el: HTMLElement) => void;
  // A track's label, its Hecho stack, or a completed initiative: key null is Sueltos.
  onTrack?: (slug: string, key: string | null, el: HTMLElement) => void;
  selected?: string | null;
  busy?: string | null;
};

// What a click on a card's action calls; null when the page passed no handler for it.
export function boardRun(slug: string, a: CardAct, acts: BoardActs): (() => void) | null {
  if (a.kind === "primero") return acts.onPickNext ? () => acts.onPickNext!(slug, a.key) : null;
  if (a.kind === "quitar") return acts.onCancel ? () => acts.onCancel!(slug, a.key) : null;
  if (a.kind === "detener") return acts.onStop ? () => acts.onStop!(a.runId) : null;
  return acts.onAccept ? () => acts.onAccept!(a.decision, a.action) : null;
}

const ActButtons = ({ slug, acts, list, title }: { slug: string; acts: BoardActs; list: CardAct[]; title: string }) => {
  const runs = list.map((a) => ({ a, run: boardRun(slug, a, acts) })).filter((x) => x.run);
  if (runs.length === 0) return null;
  return (
    <>
      {runs.map(({ a, run }) => (
        <button key={a.kind} type="button" className="sb-mini" data-act={a.kind} disabled={acts.busy === actBusyKey(a)} onClick={run!} aria-label={`${ACT_LABEL[a.kind]}: ${title}`} data-control={`tablero-${a.kind}`}>
          {acts.busy === actBusyKey(a) ? "…" : ACT_LABEL[a.kind]}
        </button>
      ))}
    </>
  );
};

// The owner's orders that are not a ticket yet: a card of their own in Sueltos (Por hacer, or Taller while a run works
// on one), with Detener when that run is live.
function orderLine(o: OrgOrder): string {
  if (o.state === "en_curso") return o.who ? `Tu pedido · ${o.who} trabaja en él` : "Tu pedido · en curso";
  if (o.state === "sin_tomar") return "Tu pedido · nadie lo ha tomado";
  if (o.state === "entendida") return o.who ? `Tu pedido · ${o.who} lo entendió` : "Tu pedido · entendido";
  return "Tu pedido · enviado";
}
const OrderCard = ({ slug, o, acts }: { slug: string; o: OrgOrder; acts: BoardActs }) => {
  const live = o.state === "en_curso";
  const runId = live && o.run?.status === "running" ? o.run.id : null;
  return (
    <div className="sb-card" data-card={`o-${o.id}`} data-etapa="pedido" data-live={runId ? "" : undefined} style={{ "--sc": live ? "var(--status-now)" : "var(--status-jorge)" } as CSSProperties}>
      <div className="sb-card-main" title={o.title}>
        <span className="sb-st">
          <i aria-hidden />
          {orderLine(o)}
        </span>
        <span className="sb-tt">{o.title}</span>
      </div>
      {runId && (
        <span className="sb-acts">
          <ActButtons slug={slug} acts={acts} list={[{ kind: "detener", runId }]} title={o.title} />
        </span>
      )}
    </div>
  );
};

// What Que PO lo planee asks the PO (the order the Entrega strip used to send).
export const PLAN_ASK = "Arma el plan del proyecto: los entregables y los pasos de cada uno.";

// An older server sends no stages: the board still stands (stations, seats, questions) with no tracks.
const NO_BOARD: Tablero = { initiatives: [], loose: [], loose_done: 0 };

// Where a question's notch points: the centre of its asker's station, or the corner for a teammate with none.
const LABEL_COL = 150;
const notchAt = (station: number | null): CSSProperties =>
  ({ "--nx-wide": station === null ? `${LABEL_COL / 2}px` : `calc(${LABEL_COL}px + (100% - ${LABEL_COL}px) * ${(station + 0.5) / STATIONS.length})` }) as CSSProperties;

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
  board,
  ficha,
  nivel = "trabajo",
  lift,
  maquinas,
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
  // PLA-I39-5: the decisions hang under their asker's window (here: its station).
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
  // PLA-I53-3: the stage board's calls (Detener, Hacer primero, Aceptar, Quitar, and what opens in La ficha).
  board?: BoardActs;
  // PLA-I47-4: La ficha is on screen (it carries Lo último and Solo tú).
  ficha?: boolean;
  // PLA-I48-4: the floor's two levels. lift is the switch in the Encabezado; maquinas draws the Máquinas level with
  // the Pedir bar (which lives in whichever level is shown). The inactive level is inert: no focus, no clicks.
  nivel?: "trabajo" | "maquinas";
  lift?: ReactNode;
  maquinas?: (ask: ReactNode) => ReactNode;
  // The «+ Sumar» window.
  children?: ReactNode;
}) => {
  const team = [...p.team].sort(byRole);
  const line = nowLine(p, decisions ?? [], now, { companyPaused, timeZone });
  // PLA-I46-11: a leg's plan that is the move shows in Ahora (plan.tsx), not under the PO's window.
  const o = line.move?.origen;
  // PLA-I46-10: so does a delivery to accept: its evidence card is in Ahora, so it does not hang under Taller.
  const dv = deliveryOf(line.move, decisions ?? []);
  const inAhora = o?.kind === "decision" && (decisions?.find((d) => d.id === o.id)?.plan?.leg || dv) ? o.id : null;
  const down = !!maquinas && nivel === "maquinas";
  const slug = p.slug;
  const bacts = board ?? {};

  // The seats: PO, Taller and QA stand over their stations; everyone else sits in the board's corner.
  const atStation = new Map<string, OrgMember>();
  for (const s of STATIONS) {
    const m = s.role ? team.find((x) => x.role === s.role) : undefined;
    if (m) atStation.set(s.id, m);
  }
  const seated = new Set([...atStation.values()].map((m) => m.agent));
  const others = team.filter((m) => !seated.has(m.agent));
  // PLA-I46-10: a delivery sent back: its maker's seat is violet until it comes back. PLA-I39-7: the PO's seat says
  // «Recibiría tu pedido» while the owner types in Pedir. Otherwise a seat says what the seats' read says (caption).
  const back = line.move ? null : returnedOf(slug, decisions ?? []);
  const isBack = (m: OrgMember) => !!back && windowState(m, companyPaused) !== "off" && (back.agent ? back.agent === m.agent : m.role === "taller");
  const hintOf = (m: OrgMember) => (typing && m.role === "product-owner" ? RECIBIRIA : null);
  const seatState = (m: OrgMember) => (hintOf(m) ? "ghost" : isBack(m) ? "back" : windowState(m, companyPaused));
  const seatLabel = (m: OrgMember) => (isBack(m) && !hintOf(m) ? `${caption(m, now, { companyPaused, timeZone }).who} de ${p.title}, devuelto: arreglando` : windowLabel(m, p.title, now, companyPaused));
  const seatData = (m: OrgMember) => ({ "data-state": seatState(m), "data-agent": m.agent, "data-role": m.role, "data-holding": line.holder === m.agent ? "1" : undefined });
  const station = (s: (typeof STATIONS)[number]): StationHeadProps | null => {
    const m = atStation.get(s.id);
    if (!m) return null;
    const hint = hintOf(m);
    const c = caption(m, now, { companyPaused, timeZone });
    const doing = hint ?? (isBack(m) ? BACK_WORD : c.sub ? `${c.doing} · ${c.sub}` : c.doing);
    return { onClick: onOpen ? (el) => onOpen(m, el) : undefined, label: hint ? `${seatLabel(m)}. ${hint}` : seatLabel(m), figure: <Figure role={m.role} />, line: doing, data: seatData(m) };
  };

  // Questions: under the asker's station, the oldest per asker (Question lists the rest).
  const hanging = decisions && acts ? team.map((m) => ({ m, h: hangingFor(decisions, slug, m.agent, inAhora) })).filter((x) => x.h) : [];
  const below = hanging.length > 0 && acts ? (
    <>
      {hanging.map(({ m, h }, i) => {
        const at = STATIONS.findIndex((s) => atStation.get(s.id)?.agent === m.agent);
        return <Question key={m.agent} hanging={h!} role={m.role} anchor={i === 0 ? `pregunta-${slug}` : undefined} style={notchAt(at < 0 ? null : at)} acts={acts} />;
      })}
    </>
  ) : undefined;

  const corner = (
    <div className="edi-corner" data-team={team.length}>
      <span className="sb-eyebrow">Iniciativa</span>
      {(others.length > 0 || children) && (
        <div className="edi-corner-team">
          {others.map((m) => (
            <button key={m.agent} type="button" className="edi-seat" {...seatData(m)} aria-label={seatLabel(m)} onClick={(e) => onOpen?.(m, e.currentTarget)} disabled={!onOpen} title={`${roleName(m.role)}: ${caption(m, now, { companyPaused, timeZone }).doing}`}>
              <span className="edi-seat-glass" aria-hidden>
                <Figure role={m.role} />
              </span>
            </button>
          ))}
          {children}
        </div>
      )}
    </div>
  );

  const orders = (p.orders ?? []).filter((x) => !x.key && x.stage !== "cancelada" && (x.state === "en_curso" || OPEN_ORDER.has(x.state)));
  const extra = orders.length
    ? { por: orders.filter((x) => x.state !== "en_curso").map((x) => <OrderCard key={x.id} slug={slug} o={x} acts={bacts} />), taller: orders.filter((x) => x.state === "en_curso").map((x) => <OrderCard key={x.id} slug={slug} o={x} acts={bacts} />) }
    : undefined;

  const trabajo = (
    <div className="edi-fbody">
      <div className="edi-stage">
        {/* PLA-I53-3: the Ahora slot. F4 replaces this band with the one Ahora line (fed by the server's ahora). */}
        <div className="edi-ahora-slot" data-slot="ahora">
          <Now project={p} line={line} now={now} decisions={decisions} acts={nowActs} qacts={acts} onFijar={onFijar} onPublish={onPublish} side={ventana} anchor={dv && hanging.length === 0 ? `pregunta-${slug}` : undefined} />
        </div>
        {(
          <StageBoard
            tablero={p.tablero ?? NO_BOARD}
            now={now}
            selected={bacts.selected}
            onTicket={bacts.onTicket ? (t, el) => bacts.onTicket!(slug, t, el) : undefined}
            onTrack={bacts.onTrack ? (key, el) => bacts.onTrack!(slug, key, el) : undefined}
            onDone={bacts.onTrack ? (key, el) => bacts.onTrack!(slug, key, el) : undefined}
            onFolded={bacts.onTrack ? (key, el) => bacts.onTrack!(slug, key, el) : undefined}
            station={station}
            corner={corner}
            below={below}
            actsFor={(t) => {
              const list = cardActs(t, { team, decisions: decisions ?? [], orders: p.orders, nextFirst: p.next_first });
              return list.length ? <ActButtons slug={slug} acts={bacts} list={list} title={t.title} /> : null;
            }}
            extra={extra}
            // PLA-I53-6: the completed initiatives fold into one line under the board.
            folded={p.tablero?.done_initiatives}
            empty={
              <div className="edi-board-empty" data-board="empty">
                <p>{p.route && p.route.legs.length > 0 ? "No hay iniciativas abiertas ni trabajo suelto en este piso." : "Aún no hay plan: ninguna iniciativa abierta ni trabajo suelto."}</p>
                {nowActs?.onPlan && !p.paused && !(p.route && p.route.legs.length > 0) && (
                  <button type="button" className="edi-btn" onClick={() => nowActs.onPlan!(slug, PLAN_ASK)} disabled={nowActs.busy === `${slug}:plan`} data-control="planear">
                    Que PO lo planee
                  </button>
                )}
              </div>
            }
            label={`Tablero de etapas de ${p.title}`}
            className="dark"
          />
        )}
        {ask && !down && <div className="edi-askbar">{ask}</div>}
      </div>
      {/* PLA-I47-4: with La ficha, Lo último and Solo tú live in its Resumen; without it they stay on the floor. */}
      {!ficha && (
        <div className="edi-fcol">
          <Last project={p} decisions={decisions ?? []} now={now} timeZone={timeZone} acts={nowActs} qacts={acts} />
          <After project={p} decisions={decisions ?? []} now={now} timeZone={timeZone} acts={nowActs} qacts={acts} solo={solo} hideAuto={!!dv} />
        </div>
      )}
    </div>
  );
  return (
    <article id={`piso-${p.slug}`} tabIndex={-1} className="edi-floor" data-floor={slug} data-nivel={maquinas ? nivel : undefined} data-light={p.light} data-move={line.move ? line.move.verbo : undefined} data-ficha={ficha ? "1" : undefined} style={{ "--c": floorHue(slug) } as CSSProperties} aria-label={p.title}>
      <Head project={p} line={line} onFijar={onFijar} onPlan={onPlan} extra={resume} lift={lift} />
      {maquinas ? (
        <div className="edi-levels" data-nivel={nivel}>
          <div className="edi-level" data-level="trabajo" inert={down} aria-hidden={down || undefined}>
            {trabajo}
          </div>
          <div className="edi-level" data-level="maquinas" inert={!down} aria-hidden={!down || undefined}>
            {maquinas(down ? ask : null)}
          </div>
        </div>
      ) : (
        trabajo
      )}
    </article>
  );
};
