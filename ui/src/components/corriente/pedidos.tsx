// PLA-I62-5: a project's Pedidos tab (board B2), the building's tube redrawn. One lane per request along its six
// stops (Buzón, Entendido, Investigación, Diseño, Plan, Lista): a violet dot where it passed, a white haloed dot where
// someone works it now, an amber rhombus where it waits on the owner (a question, or Lista waiting for «Constrúyelo»).
// Requests nobody took offer Reenviar al PO and Cerrar pedido; «Lo último» says what just happened. The open request
// shows what each stop left, its question with an answer box, and the one «Constrúyelo»; Guardar para después and
// Guardadas (with Restaurar) as today. The calls are the building's (components/corriente/acts.ts).
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { api, type Decision, type IdeaDetail, type OrgPedido, type OrgProject, type PedidoStop } from "@/lib/api";
import { seatName } from "@/lib/corriente";
import { lastLines, staleAge, whenWord } from "@/lib/edificio";
import type { CorrienteActs } from "./acts";
import { Agent, Btn, Dot, Label, You } from "./parts";

export const STOPS: { id: PedidoStop; name: string }[] = [
  { id: "buzon", name: "Buzón" },
  { id: "entendido", name: "Entendido" },
  { id: "investigacion", name: "Investigación" },
  { id: "diseno", name: "Diseño" },
  { id: "plan", name: "Plan" },
  { id: "lista", name: "Lista" },
];
const stopIndex = (s: PedidoStop) => STOPS.findIndex((x) => x.id === s);
const stopName = (s: PedidoStop) => STOPS.find((x) => x.id === s)?.name ?? s;

/** Waits on the owner: a question for him, or Lista waiting for «Constrúyelo». */
export const waitsOnYou = (x: Pick<OrgPedido, "state" | "stop" | "guardada">) => !x.guardada && (x.state === "espera" || (x.stop === "lista" && x.state === "quieta"));

/** The line under a request's title, in the kit's words. */
export function pedidoState(x: Pick<OrgPedido, "state" | "stop" | "who" | "guardada" | "at">, now: number): { text: string; tone: "amber" | "live" | undefined } {
  if (x.guardada) return { text: "Guardada · nadie la trabaja", tone: undefined };
  if (x.state === "espera") return { text: `Te espera · ${x.stop === "entendido" ? "confirma lo entendido" : "contesta su pregunta"}`, tone: "amber" };
  if (x.stop === "lista" && x.state === "quieta") return { text: "Te espera · lista para construir", tone: "amber" };
  if (x.state === "trabajando") return { text: `${x.who === "product-owner" ? "El PO" : seatName(x.who)} la trabaja`, tone: "live" };
  if (x.state === "valvula") return { text: "Pasando a tablero: el PO crea la iniciativa", tone: "live" };
  if (x.state === "cola") return { text: `En el buzón · ${staleAge(x.at, now)} sin tomar`, tone: undefined };
  return { text: `Quieta en ${stopName(x.stop)}`, tone: undefined };
}

export function pedidosHeadline(list: OrgPedido[]): { now: string; you: string | null } {
  const live = list.filter((x) => !x.guardada);
  const NUM = ["Ningún", "Un", "Dos", "Tres", "Cuatro", "Cinco", "Seis", "Siete", "Ocho", "Nueve", "Diez"];
  const NUMF = ["Ninguno", "Uno", "Dos", "Tres", "Cuatro", "Cinco", "Seis", "Siete", "Ocho", "Nueve", "Diez"];
  const n = live.length;
  const you = live.filter(waitsOnYou).length;
  const now = n === 0 ? "Ningún pedido tomando forma." : `${n <= 10 ? NUM[n] : n} ${n === 1 ? "pedido tomando forma." : "pedidos tomando forma."}`;
  return { now, you: you ? `${you <= 10 ? NUMF[you] : you} te ${you === 1 ? "espera" : "esperan"}.`.replace(/^Uno te/, "Uno te") : null };
}

const Journey = ({ x }: { x: OrgPedido }) => {
  const at = stopIndex(x.stop);
  return (
    <span className="cor-journey" aria-hidden>
      {STOPS.map((s, i) => (
        <span key={s.id} className={`cor-jstop ${i < at ? "past" : i === at ? "here" : "later"}`}>
          {i === at ? waitsOnYou(x) ? <You small /> : x.state === "trabajando" || x.state === "valvula" ? <Agent small /> : <Dot grey={x.state === "cola" || x.guardada} /> : i < at ? <Dot /> : <i className="cor-ring" />}
        </span>
      ))}
    </span>
  );
};

const Opened = ({ p, k, acts, ideaTo, onClose }: { p: OrgProject; k: string; acts: CorrienteActs; ideaTo: (key: string) => string; onClose: () => void }) => {
  const q = useQuery({ queryKey: ["idea", p.slug, k], queryFn: () => api.idea(p.slug, k), refetchInterval: 15_000 });
  const d: IdeaDetail | undefined = q.data;
  const [answer, setAnswer] = useState("");
  const [drop, setDrop] = useState(false);
  const busy = (a: string) => acts.busy === `pedido-${k}:${a}`;
  if (q.isPending) return <div className="cor-skel cor-opened" aria-busy="true" aria-label="Leyendo el pedido" style={{ height: 200 }} />;
  if (q.isError || !d)
    return (
      <section className="cor-card cor-opened cor-empty">
        <p className="cor-text">No se pudo leer el pedido.</p>
        <Btn kind="secondary" onClick={() => void q.refetch()}>
          Reintentar
        </Btn>
      </section>
    );
  const st = pedidoState(d, Date.now());
  const lista = d.stop === "lista";
  const doc = (stop: PedidoStop) => d.stops.find((s) => s.stop === stop);
  const cells: [string, string | null, PedidoStop][] = [
    ["Entendido", d.understood, "entendido"],
    ["Investigación", d.research.recommendation ?? (doc("investigacion")?.doc ? doc("investigacion")!.doc!.title : null), "investigacion"],
    ["Diseño", d.frames.length ? `${d.frames.length} ${d.frames.length === 1 ? "marco" : "marcos"} de Artist` : doc("diseno")?.doc ? doc("diseno")!.doc!.title : null, "diseno"],
    ["Plan", d.plan_steps.length ? `${d.plan_steps.length} pasos${d.ficha.tamano ? ` · ${d.ficha.tamano}` : ""}` : null, "plan"],
  ];
  return (
    <section className={`cor-card cor-opened ${waitsOnYou(d) ? "you" : ""}`} aria-label="Pedido abierto" data-opened={k}>
      <div className="cor-opened-main">
        <Label tone={st.tone === "amber" ? "amber" : st.tone === "live" ? "violet" : undefined}>{`Pedido abierto · ${st.text}`}</Label>
        <h2 className="cor-h3">{d.title}</h2>
        <p className="cor-text cor-clamp2" title={d.text}>
          «{d.text}»
        </p>
        {d.question ? (
          <form
            className="cor-ajuste-row"
            onSubmit={(e) => {
              e.preventDefault();
              if (answer.trim().length < 1) return;
              acts.answerQuestion(p.slug, k, d.question!.id, answer.trim());
              setAnswer("");
            }}
            data-pregunta={d.question.id}
          >
            <span className="cor-text" style={{ flexBasis: "100%" }}>
              <span className="cor-label amber">El PO pregunta</span> {d.question.text}
            </span>
            {d.question_options.map((o) => (
              <Btn key={o} kind="secondary" disabled={busy("answer")} onClick={() => acts.answerQuestion(p.slug, k, d.question!.id, o)}>
                {o}
              </Btn>
            ))}
            <input className="cor-input" value={answer} maxLength={2000} placeholder="Tu respuesta" aria-label="Tu respuesta al PO" onChange={(e) => setAnswer(e.target.value)} />
            <Btn kind="secondary" type="submit" disabled={busy("answer") || !answer.trim()} data-control="responder-po">
              Responder
            </Btn>
          </form>
        ) : (
          <div className="cor-stops-grid">
            {cells.map(([name, val, stop]) => (
              <div key={name}>
                <span className="cor-stops-name">{name}</span>
                <span className="cor-ellipsis cor-stops-val" title={val ?? undefined}>
                  {val ?? <span className="cor-muted">Pendiente</span>}
                </span>
                {val && (
                  <Link className="cor-btn link" to={ideaTo(k)} aria-label={`Leer ${name} en la idea`} data-leer={stop}>
                    {stop === "diseno" ? "Ver" : "Leer"}
                  </Link>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="cor-opened-side">
        <Label>Si lo construyes</Label>
        <p className="cor-text">{d.promoted_to ? `Ya es ${d.promoted_to} en el tablero.` : "Pasa al tablero como iniciativa y Taller empieza por el primer paso. Nadie construye sin tu «Constrúyelo»."}</p>
        {!d.promoted_to && !d.guardada && (
          <Btn kind={lista ? "primary" : "secondary"} onClick={() => acts.pedido(p.slug, k, "construir")} disabled={busy("construir") || d.state === "valvula"} data-control="construyelo">
            {d.state === "valvula" ? "Pasando al tablero…" : "Constrúyelo"}
          </Btn>
        )}
        <div className="cor-acts">
          <Link className="cor-btn secondary" to={ideaTo(k)} data-control="abrir-idea">
            Abrir la idea
          </Link>
          {d.guardada ? (
            <Btn kind="quiet" onClick={() => acts.pedido(p.slug, k, "restaurar")} disabled={busy("restaurar")} data-control="restaurar">
              Restaurar
            </Btn>
          ) : (
            <Btn kind="quiet" onClick={() => acts.pedido(p.slug, k, "guardar")} disabled={busy("guardar")} data-control="guardar">
              Guardar para después
            </Btn>
          )}
          {drop ? (
            <Btn kind="danger" onClick={() => (acts.pedido(p.slug, k, "descartar"), onClose())} data-control="descartar-si">
              Sí, descartar
            </Btn>
          ) : (
            <Btn kind="quiet" onClick={() => setDrop(true)} data-control="descartar">
              Descartar
            </Btn>
          )}
        </div>
      </div>
    </section>
  );
};

export const Pedidos = ({
  p,
  decisions,
  now,
  timeZone,
  open,
  guardadas,
  acts,
  links,
}: {
  p: OrgProject;
  decisions: Decision[];
  now: number;
  timeZone?: string;
  open: string | null;
  guardadas: boolean;
  acts: CorrienteActs;
  links: { open: (key: string | null) => string; guardadas: string; pedir: string; idea: (key: string) => string };
}) => {
  const all = p.pedidos ?? [];
  const list = guardadas ? all.filter((x) => x.guardada) : all.filter((x) => !x.guardada);
  const [allShown, setAll] = useState(false);
  const stale = p.stale_requests ?? [];
  const last = lastLines(p, decisions, 6);
  const [lastAll, setLastAll] = useState(false);
  const head = pedidosHeadline(all);
  const SHOW = open ? 3 : 6;
  const shown = allShown ? list : list.slice(0, SHOW);
  return (
    <div className="cor-pedidos" data-pedidos={list.length}>
      <div className="cor-pedidos-head">
        <h2 className="cor-h3">
          {guardadas ? `Guardadas · ${list.length}` : head.now} {!guardadas && head.you && <span className="cor-amber">{head.you}</span>}
        </h2>
        <span className="cor-acts" style={{ marginTop: 0 }}>
          {list.length > SHOW && (
            <Btn kind="quiet" onClick={() => setAll((x) => !x)} data-control="ver-todos">
              {allShown ? "Ver menos" : `Ver los ${list.length}`}
            </Btn>
          )}
          <Link className="cor-btn quiet" to={guardadas ? links.open(null) : links.guardadas} data-control="guardadas">
            {guardadas ? "Volver a los pedidos" : `Guardadas${all.some((x) => x.guardada) ? ` · ${all.filter((x) => x.guardada).length}` : ""}`}
          </Link>
          <Link className="cor-btn secondary" to={links.pedir} data-control="pedir-nuevo">
            Pedir algo nuevo
          </Link>
        </span>
      </div>
      <div className="cor-ptable" aria-label="Pedidos por parada" role="group">
        <div className="cor-prow-head" aria-hidden>
          <span className="cor-label">Pedido</span>
          {STOPS.map((s) => (
            <span key={s.id} className="cor-label">
              {s.name}
            </span>
          ))}
        </div>
        <ul className="cor-prows" data-scroll={allShown || undefined}>
          {shown.length === 0 && stale.length === 0 && (
            <li className="cor-empty cor-text" data-sin-pedidos>
              {guardadas ? "No hay pedidos guardados." : "Ningún pedido tomando forma. Lo que pidas con «Darle forma» aparece aquí, parada por parada."}
            </li>
          )}
          {shown.map((x) => {
            const st = pedidoState(x, now);
            return (
              <li key={x.key}>
                <Link to={links.open(x.key === open ? null : x.key)} className="cor-plane" aria-current={x.key === open ? "true" : undefined} data-pedido={x.key}>
                  <span className="cor-plane-name">
                    <b className="cor-ellipsis">{x.title}</b>
                    <span className={`cor-state ${st.tone ?? ""}`}>{st.text}</span>
                    <span className="sr-only">{`, parada ${stopName(x.stop)}`}</span>
                  </span>
                  <Journey x={x} />
                </Link>
              </li>
            );
          })}
          {!guardadas &&
            stale.map((r) => (
              <li key={r.key} className="cor-plane stale" data-stale={r.key}>
                <span className="cor-plane-name">
                  <b className="cor-ellipsis">{r.title}</b>
                  <span className="cor-state">{`En el buzón · ${staleAge(r.since, now)} sin tomar`}</span>
                </span>
                <span className="cor-stale-acts">
                  <Btn kind="secondary" onClick={() => acts.resend(p.slug, r.key)} disabled={acts.busy === `${p.slug}:request`} data-control="reenviar">
                    Reenviar al PO
                  </Btn>
                  <Btn kind="quiet" onClick={() => acts.closeRequest(p.slug, r.key)} disabled={acts.busy === `${p.slug}:request`} data-control="cerrar-pedido">
                    Cerrar pedido
                  </Btn>
                </span>
              </li>
            ))}
        </ul>
      </div>
      {last[0] && !guardadas && (
        <div className="cor-last" data-last>
          <Label>Lo último</Label>
          <ul>
            {(lastAll ? last : last.slice(0, 1)).map((l) => (
              <li key={l.id}>
                <time className="cor-cap" dateTime={l.at}>
                  {whenWord(l.at, now, timeZone)}
                </time>
                <span className="cor-ellipsis">{l.text}</span>
              </li>
            ))}
          </ul>
          {last.length > 1 && (
            <Btn kind="link" onClick={() => setLastAll((x) => !x)} data-control="ver-todo">
              {lastAll ? "Ver menos" : "Ver todo"}
            </Btn>
          )}
        </div>
      )}
      {open && <Opened key={open} p={p} k={open} acts={acts} ideaTo={links.idea} onClose={() => undefined} />}
    </div>
  );
};
