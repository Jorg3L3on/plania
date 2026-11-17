// PLA-I39-3: one project is one floor; its colour is one of six fixed hues picked from the slug.
// PLA-I47-2 (Compañía v6): the floor is sized to the window, never to its content.
// PLA-I53-3 (Design doc of PLA-I53): top to bottom, the Encabezado (head.tsx, one line), the Ahora slot (today the
// floor's Ahora band, now.tsx; F4 puts the one true Ahora line here), the stage board (components/plan/stage-board.tsx,
// the only part that grows, scrolling inside itself) and Pedir as a bar. The board takes the place of the Entrega strip
// and La fila: the teammates' windows are its stations (PO over Por hacer, Taller, QA), the others sit in its corner
// with Sumar, their questions hang under the stations, and each card carries what La fila let the owner do (Detener,
// Hacer primero, Aceptar, Quitar). A card, a track or a Hecho stack opens in La ficha.
// PLA-I55-1 (El ventanal): the Trabajo level stops stacking those bands. It is two columns over Pedir: el ventanal
// (La ficha, drawn by the page with this floor's parts: the Ahora band and the questions as its first tab, one
// initiative's own stage board, the tube) and an index (indice.tsx: the team, one line per initiative, the ideas).
// A click in the index opens that thing in the ventanal.
import type { CSSProperties, ReactNode } from "react";
import type { Decision, OrgMember, OrgOrder, OrgProject, ProjectTicket, Tablero } from "@/lib/api";
import { BACK_WORD, RECIBIRIA, caption, floorHue, hangingFor, nowLine, returnedOf, windowLabel, windowState } from "@/lib/edificio";
import { ahoraView, litOf, seatOf } from "@/lib/ahora-piso";
import { actAria, actBusyKey, actLabel, boardOf, cardActs, OPEN_ORDER, STATIONS, type CardAct } from "@/lib/etapas";
import type { FichaRef } from "@/lib/ficha";
import { deliveryOf } from "@/lib/evidencia";
import { byRole } from "@/lib/org";
import { StageBoard, type StationHeadProps } from "@/components/plan/stage-board";
import { AhoraLine } from "@/components/plan/ahora-line";
import { Figure } from "./figure";
import { After, Last } from "./after";
import { Head } from "./head";
import { Now, type NowActs } from "./now";
import { Question, type QuestionActs } from "./question";
import { Tubo, type TuboActs } from "./tubo";
import { Indice, type SeatView } from "./indice";
import { Timbre } from "./equipo";

// PLA-I55-1: what the floor hands the page for the ventanal. home is the first tab (Te toca while something waits on
// the owner, else Ahora); board is the open initiative's (or Sueltos') own stage board; tubo is the tube in full.
// PLA-I61-6: who left the newest unseen delivery, and what it is.
const MIRAR_WHO: Record<string, string> = { entendido: "El PO", investigacion: "Research", diseno: "Artist", plan: "El PO" };
const MIRAR_WHAT: Record<string, string> = { entendido: "escribió lo que entendió", investigacion: "terminó la investigación", diseno: "dejó el diseño", plan: "armó el plan" };

export type VentanalParts = {
  home: { word: string; tone: "you" | "now"; count: number; body: ReactNode };
  board?: ReactNode;
  tubo?: ReactNode;
};

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
        <button key={a.kind} type="button" className="sb-mini" data-act={a.kind} disabled={acts.busy === actBusyKey(a)} onClick={run!} title={a.kind === "aceptar" ? actAria(a, title) : undefined} aria-label={actAria(a, title)} data-control={`tablero-${a.kind}`}>
          {acts.busy === actBusyKey(a) ? "…" : actLabel(a)}
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
  ventanal,
  foco = null,
  onFoco,
  nivel = "trabajo",
  lift,
  maquinas,
  tubo,
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
  // PLA-I55-1: el ventanal. The page draws La ficha from this floor's parts; foco is what the address names (null:
  // the home tab); onFoco opens something the index names that has no call of its own (the Pedido tab).
  ventanal?: (parts: VentanalParts) => ReactNode;
  foco?: FichaRef | null;
  onFoco?: (r: FichaRef, el: HTMLElement) => void;
  // PLA-I48-4: the floor's two levels. lift is the switch in the Encabezado; maquinas draws the Máquinas level with
  // the Pedir bar (which lives in whichever level is shown). The inactive level is inert: no focus, no clicks.
  nivel?: "trabajo" | "maquinas";
  lift?: ReactNode;
  maquinas?: (ask: ReactNode) => ReactNode;
  // PLA-I54-1: the tube's calls (a capsule opens in La ficha's Pedido tab; Guardadas opens the shelf).
  tubo?: TuboActs;
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
  const slug = p.slug;
  const bacts = board ?? {};

  // The seats: PO, Taller and QA stand over their stations; everyone else sits in the board's corner.
  const atStation = new Map<string, OrgMember>();
  for (const s of STATIONS) {
    const m = s.role ? team.find((x) => x.role === s.role) : undefined;
    if (m) atStation.set(s.id, m);
  }
  // PLA-I53-4: who works now is the Ahora line's (lib/ahora-piso.ts): the line, each seat's window and caption, and
  // the seat stations' light read the same obras, so they cannot disagree. A seat being fixed is violet («back»).
  // An older server sends no ahora: then the band, the seats and their light read as before (PLA-I46-10: a delivery
  // sent back makes its maker's seat violet until it comes back). PLA-I39-7: the PO's seat says «Recibiría tu
  // pedido» while the owner types in Pedir.
  const fresh = !!p.ahora;
  const ahora = ahoraView(p, now, { companyPaused, timeZone });
  const lit = litOf(ahora.obras);
  const seat = (m: OrgMember) => (fresh ? seatOf(m, ahora.obras) : undefined);
  const back = fresh || line.move ? null : returnedOf(slug, decisions ?? []);
  const isBack = (m: OrgMember) => !!back && windowState(m, companyPaused) !== "off" && (back.agent ? back.agent === m.agent : m.role === "taller");
  const hintOf = (m: OrgMember) => (typing && m.role === "product-owner" ? RECIBIRIA : null);
  const seatState = (m: OrgMember) => (hintOf(m) ? "ghost" : isBack(m) ? "back" : windowState(m, companyPaused, seat(m)));
  const seatLabel = (m: OrgMember) => (isBack(m) && !hintOf(m) ? `${caption(m, now, { companyPaused, timeZone }).who} de ${p.title}, devuelto: arreglando` : windowLabel(m, p.title, now, companyPaused, seat(m)));
  const seatData = (m: OrgMember) => ({ "data-state": seatState(m), "data-agent": m.agent, "data-role": m.role, "data-holding": line.holder === m.agent ? "1" : undefined });
  const station = (s: (typeof STATIONS)[number]): StationHeadProps | null => {
    const m = atStation.get(s.id);
    if (!m) return null;
    const hint = hintOf(m);
    const c = caption(m, now, { companyPaused, timeZone, seat: seat(m) });
    const doing = hint ?? (isBack(m) ? BACK_WORD : c.sub ? `${c.doing} · ${c.sub}` : c.doing);
    return { onClick: onOpen ? (el) => onOpen(m, el) : undefined, label: hint ? `${seatLabel(m)}. ${hint}` : seatLabel(m), figure: <Figure role={m.role} />, line: doing, data: seatData(m), lit: fresh ? (lit[s.id] ?? null) : undefined };
  };

  // Questions: under the asker's station, the oldest per asker (Question lists the rest).
  const hanging = decisions && acts ? team.map((m) => ({ m, h: hangingFor(decisions, slug, m.agent, inAhora) })).filter((x) => x.h) : [];
  // PLA-40: one Aceptar per delivery. A delivery that hangs as a card on this floor (or sits in Ahora's evidence card)
  // is accepted there; Ahora points to the hanging card and the board's ticket card does not repeat the button.
  const hungIds = new Set(hanging.flatMap(({ h }) => [h!.decision.id, ...h!.more.map((x) => x.id)]));
  const pointTo = o?.kind === "decision" && o.id && hungIds.has(o.id) ? o.id : null;
  const shownHere = (d: Decision) => hungIds.has(d.id) || d.id === dv?.id;
  const below = hanging.length > 0 && acts ? (
    <>
      {hanging.map(({ m, h }, i) => (
        <Question key={m.agent} hanging={h!} role={m.role} anchor={i === 0 ? `pregunta-${slug}` : undefined} acts={acts} />
      ))}
    </>
  ) : undefined;

  const orders = (p.orders ?? []).filter((x) => !x.key && x.stage !== "cancelada" && (x.state === "en_curso" || OPEN_ORDER.has(x.state)));
  const extra = orders.length
    ? { por: orders.filter((x) => x.state !== "en_curso").map((x) => <OrderCard key={x.id} slug={slug} o={x} acts={bacts} />), taller: orders.filter((x) => x.state === "en_curso").map((x) => <OrderCard key={x.id} slug={slug} o={x} acts={bacts} />) }
    : undefined;
  const tablero = p.tablero ?? NO_BOARD;
  // The index lists what the board listed as tracks (Sueltos too while an order of the owner's is not a ticket yet).
  const tracks = boardOf(tablero, { sueltos: orders.length > 0 }).tracks;

  // The first tab of the ventanal: the Ahora band with no height cap (a delivery's evidence shows whole), then the
  // questions that used to hang under the board.
  const mine = hungIds.size + (dv && !hungIds.has(dv.id) ? 1 : 0);
  const yours = !!line.move || mine > 0;
  // PLA-I61-6: Para mirar: requests whose newest delivery he has not opened, each one a click from its view.
  const toLook = (p.pedidos ?? []).filter((x) => !x.guardada && (x.unseen ?? 0) > 0);
  const paraMirar = toLook.length ? (
    <section className="edi-mirar" aria-label="Para mirar">
      <p className="edi-eyebrow">Para mirar · {toLook.reduce((n, x) => n + (x.unseen ?? 0), 0)}</p>
      <ul>
        {toLook.slice(0, 3).map((x) => (
          <li key={x.key}>
            <span>
              <b>{MIRAR_WHO[x.unseen_stop ?? "entendido"]}</b> {MIRAR_WHAT[x.unseen_stop ?? "entendido"]} de «{x.title}»
              {(x.unseen ?? 0) > 1 && <small> · {x.unseen} entregas sin ver</small>}
            </span>
            {tubo?.onOpen && (
              <button type="button" className="edi-btn" onClick={(e) => tubo.onOpen!(slug, x.key, e.currentTarget)} data-control="ahora-mirar">
                Mirar
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  ) : null;
  const home = (
    <div className="edi-home" data-home={yours ? "you" : "now"}>
      {paraMirar}
      {/* PLA-I53-4: the Ahora slot: the one Ahora line (the server's ahora), with the band's actions under it. */}
      <div className="edi-ahora-slot" data-slot="ahora">
        <Now
          project={p}
          line={line}
          now={now}
          decisions={decisions}
          acts={nowActs}
          qacts={acts}
          onFijar={onFijar}
          onPublish={onPublish}
          side={ventana}
          anchor={dv && hanging.length === 0 ? `pregunta-${slug}` : undefined}
          head={fresh ? <AhoraLine view={ahora} /> : undefined}
          pointTo={pointTo}
          state={!fresh ? undefined : ahora.working ? (ahora.obras[0]?.etapa === "devuelto" ? "back" : "work") : ahora.quiet?.kind === "owner" ? "you" : ahora.quiet?.kind === "paused" ? "off" : ahora.quiet?.kind === "blocked" ? "stuck" : "idle"}
        />
      </div>
      {below && <div className="edi-home-q">{below}</div>}
    </div>
  );

  // One initiative's own board (or Sueltos'), while the address names it: the same stations, cards and calls, with
  // only that track, so its cards have room.
  const ini = foco?.kind === "leg" ? tablero.initiatives.find((i) => i.key === foco.key) : undefined;
  const sub: Tablero | null = ini ? { ...tablero, initiatives: [ini], loose: [], loose_done: 0, done_initiatives: undefined } : foco?.kind === "sueltos" ? { ...tablero, initiatives: [], done_initiatives: undefined } : null;
  const oneBoard = sub ? (
    <StageBoard
      tablero={sub}
      now={now}
      selected={bacts.selected}
      onTicket={bacts.onTicket ? (t, el) => bacts.onTicket!(slug, t, el) : undefined}
      // The Hecho stack: the done steps are listed right under this board.
      onDone={(_key, el) => el.closest(".edi-fi-s")?.querySelector('[data-fi-sec="hechos"]')?.scrollIntoView({ block: "start" })}
      station={station}
      actsFor={(t) => {
        const list = cardActs(t, { team, decisions: decisions ?? [], orders: p.orders, nextFirst: p.next_first }).filter((x) => x.kind !== "aceptar" || !shownHere(x.decision));
        return list.length ? <ActButtons slug={slug} acts={bacts} list={list} title={t.title} /> : null;
      }}
      extra={ini ? undefined : extra}
      label={`Tablero de etapas de ${ini ? ini.title : "Sueltos"}`}
      className="dark sb-one"
    />
  ) : undefined;

  const parts: VentanalParts = {
    home: { word: yours ? "Te toca" : "Ahora", tone: yours ? "you" : "now", count: mine, body: home },
    board: oneBoard,
    // PLA-I54-1: the tube of the owner's ideas taking shape (an older server sends none).
    tubo: p.pedidos ? <Tubo slug={slug} title={p.title} pedidos={p.pedidos} acts={tubo} /> : undefined,
  };
  const down = !!maquinas && nivel === "maquinas";
  // On the Máquinas level La ficha is a side column there, so this level keeps only its home (never the ficha twice).
  // Without a page drawing La ficha (whose Resumen carries them), Lo último and Solo tú stay on the floor, under Ahora.
  const vent =
    ventanal && !down ? (
      ventanal(parts)
    ) : ventanal ? (
      home
    ) : (
      <>
        {home}
        <div className="edi-fcol">
          <Last project={p} decisions={decisions ?? []} now={now} timeZone={timeZone} acts={nowActs} qacts={acts} />
          <After project={p} decisions={decisions ?? []} now={now} timeZone={timeZone} acts={nowActs} qacts={acts} solo={solo} hideAuto={!!dv} />
        </div>
      </>
    );

  // PLA-I58-1: what each teammate's window says, in El timbre and La sala.
  const seatView = (m: OrgMember): SeatView => {
    const hint = hintOf(m);
    const c = caption(m, now, { companyPaused, timeZone, seat: seat(m) });
    return { data: seatData(m), state: seatState(m), label: hint ? `${seatLabel(m)}. ${hint}` : seatLabel(m), line: hint ?? (isBack(m) ? BACK_WORD : c.sub ? `${c.doing} · ${c.sub}` : c.doing) };
  };
  const timbre = team.length > 0 || children ? <Timbre key={slug} title={p.title} team={team} seat={seatView} onMember={onOpen} onMotores={onFoco ? (el) => onFoco({ kind: "tab", tab: "motores" }, el) : undefined}>
      {children}
    </Timbre> : null;

  const trabajo = (
    <div className="edi-fbody" data-ventanal={foco && !down ? foco.kind : "home"}>
      <div className="edi-ventanal" data-vent={ventanal && !down ? "ficha" : "home"}>
        {vent}
      </div>
      <Indice
        project={p}
        tracks={tracks}
        foco={down ? null : foco}
        onTrack={bacts.onTrack ? (key, el) => bacts.onTrack!(slug, key, el) : undefined}
        onIdeas={onFoco ? (el) => onFoco({ kind: "tab", tab: "pedido" }, el) : undefined}
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
      />
      {ask && !down && <div className="edi-askbar">{ask}</div>}
    </div>
  );
  return (
    <article id={`piso-${p.slug}`} tabIndex={-1} className="edi-floor" data-floor={slug} data-nivel={maquinas ? nivel : undefined} data-light={p.light} data-move={line.move ? line.move.verbo : undefined} style={{ "--c": floorHue(slug) } as CSSProperties} aria-label={p.title}>
      <Head project={p} line={line} onFijar={onFijar} onPlan={onPlan} extra={resume} lift={lift} equipo={timbre} />
      {maquinas ? (
        <div className="edi-levels" data-nivel={nivel}>
          <div className="edi-level" data-level="trabajo" inert={down} aria-hidden={down || undefined}>
            {trabajo}
          </div>
          <div className="edi-level" data-level="maquinas" data-side={down && foco && ventanal ? "1" : undefined} inert={!down} aria-hidden={!down || undefined}>
            {maquinas(down ? ask : null)}
            {/* PLA-I55-1: down here La ficha stays a side column, only while the address names something. */}
            {down && foco && ventanal && <div className="edi-maq-side">{ventanal(parts)}</div>}
          </div>
        </div>
      ) : (
        trabajo
      )}
    </article>
  );
};
