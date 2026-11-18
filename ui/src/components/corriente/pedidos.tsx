// PLA-I62-5: a project's Pedidos tab (board B2). PLA-I65-5 (Una sola ficha): each request is one row (its short name,
// key, the current in small and what it needs) that opens the one ficha in its place (ficha.tsx), the same as in
// Ideas and Tablero. Requests nobody took offer Reenviar al PO and Cerrar pedido; «Lo último» says what just
// happened; Guardadas (with Restaurar in the ficha) as today. The calls are the building's (acts.ts).
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import type { Decision, OrgPedido, OrgProject, PedidoStop } from "@/lib/api";
import { seatName } from "@/lib/corriente";
import { lastLines, staleAge, whenWord } from "@/lib/edificio";
import type { CorrienteActs } from "./acts";
import type { FichaLinks } from "./ficha";
import { Fila, FilaAbierta } from "./fila";
import { useFicha } from "./listas";
import { Btn, Label } from "./parts";
import { rioOfRow } from "./rio-geo";

export const STOPS: { id: PedidoStop; name: string }[] = [
  { id: "buzon", name: "Buzón" },
  { id: "entendido", name: "Entendido" },
  { id: "investigacion", name: "Investigación" },
  { id: "diseno", name: "Diseño" },
  { id: "plan", name: "Plan" },
  { id: "lista", name: "Lista" },
];
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
  links: { open: (key: string | null) => string; guardadas: string; pedir: string; ficha: FichaLinks };
}) => {
  const all = p.pedidos ?? [];
  const list = guardadas ? all.filter((x) => x.guardada) : all.filter((x) => !x.guardada);
  const [allShown, setAll] = useState(false);
  const stale = p.stale_requests ?? [];
  const last = lastLines(p, decisions, 6);
  const [lastAll, setLastAll] = useState(false);
  const head = pedidosHeadline(all);
  const navigate = useNavigate();
  const go = (to: string) => navigate(to, { replace: true });
  // The short names come with the ideas read (an idea's summary); until it arrives, the title.
  const ficha = useFicha(p.slug);
  const short = (x: OrgPedido) => ficha.data?.ideas.find((i) => i.key === x.key)?.summary?.trim() || x.title;
  const SHOW = 8;
  const shown = allShown || (open && list.findIndex((x) => x.key === open) >= SHOW) ? list : list.slice(0, SHOW);
  // A request opened by its address that is not listed here (another state, or saved) still opens, on top.
  const orphan = open && !list.some((x) => x.key === open) ? open : null;
  const close = () => links.open(null);
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
      <ul className="cor-filas" aria-label={guardadas ? "Pedidos guardados" : "Pedidos"}>
        {orphan && <FilaAbierta key={orphan} p={p} k={orphan} now={now} timeZone={timeZone} acts={acts} decisions={decisions} links={links.ficha} onClose={() => go(close())} />}
        {shown.length === 0 && stale.length === 0 && !orphan && (
          <li className="cor-empty cor-text" data-sin-pedidos>
            {guardadas ? "No hay pedidos guardados." : "Ningún pedido tomando forma. Lo que pidas con «Darle forma» aparece aquí, parada por parada."}
          </li>
        )}
        {shown.map((x) => {
          if (x.key === open) return <FilaAbierta key={x.key} p={p} k={x.key} now={now} timeZone={timeZone} acts={acts} decisions={decisions} links={links.ficha} onClose={() => go(close())} />;
          const st = pedidoState(x, now);
          return (
            <li key={x.key}>
              <Fila name={short(x)} k={x.key} m={rioOfRow(x)} line={st.text} tone={st.tone} open={false} to={links.open(x.key)} />
            </li>
          );
        })}
        {!guardadas &&
          stale.map((r) => (
            <li key={r.key} className="cor-fila stale" data-stale={r.key}>
              <span className="cor-fila-nm">
                <b className="cor-ellipsis">{r.title}</b>
                <span className="cor-key">{r.key}</span>
              </span>
              <span className="cor-state">{`En el buzón · ${staleAge(r.since, now)} sin tomar`}</span>
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
    </div>
  );
};
