// PLA-I65-5: one thing closed, the same row in Pedidos and Ideas: its short name, its key, the current in small and
// what it needs now. A click opens the ficha in its place (the address keeps the tab: ver=pedido or ver=idea), and
// only one is open at a time; Cerrar folds it back.
import { useEffect, useRef, type ReactNode } from "react";
import { Link } from "react-router";
import type { Decision, OrgProject } from "@/lib/api";
import type { CorrienteActs } from "./acts";
import { Ficha, type FichaLinks } from "./ficha";
import { Key, State, type StateTone } from "./parts";
import { Corriente } from "./rio";
import { rioLabel, type RioModel } from "./rio-geo";

export const Fila = ({ name, k, m, line, tone, open, to, extra }: { name: string; k: string; m: RioModel; line: string; tone?: StateTone; open: boolean; to: string; extra?: ReactNode }) => (
  <Link to={to} replace className="cor-fila" aria-expanded={open} data-fila={k}>
    <span className="cor-fila-nm">
      <b className="cor-ellipsis">{name}</b>
      <Key>{k}</Key>
    </span>
    <span className="cor-fila-rio" aria-hidden>
      <Corriente m={m} size="fila" />
    </span>
    <span className="sr-only">{rioLabel(m)}</span>
    <State tone={tone}>{line}</State>
    {extra}
    <span className="cor-fila-go" aria-hidden>
      Abrir ›
    </span>
  </Link>
);

/** The ficha opened in the list, in the row's place; it scrolls itself into view when it opens. */
export const FilaAbierta = ({ p, k, now, timeZone, acts, decisions, links, onClose }: { p: OrgProject; k: string; now: number; timeZone?: string; acts: CorrienteActs; decisions: Decision[]; links: FichaLinks; onClose: () => void }) => {
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView?.({ block: "nearest" });
  }, [k]);
  return (
    <li ref={ref} className="cor-fila-open" data-abierta={k}>
      <Ficha p={p} k={k} now={now} timeZone={timeZone} acts={acts} decisions={decisions} links={links} onClose={onClose} />
    </li>
  );
};
