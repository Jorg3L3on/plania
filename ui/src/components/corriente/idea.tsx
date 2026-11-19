// PLA-I62-7, PLA-I61: an idea's stops and the words each stop says. PLA-I65-3: the idea itself now opens in the one
// ficha (ficha.tsx), the same from Pedidos, Ideas and Tablero; this file keeps the words and the stand-alone address
// (ver=idea), which shows that ficha with Cerrar back to the list.
import type { ReactNode } from "react";
import type { Decision, IdeaDetail, IdeaStop, OrgProject, PedidoStop } from "@/lib/api";
import { seatName } from "@/lib/corriente";
import type { CorrienteActs } from "./acts";
import { Ficha, type FichaLinks } from "./ficha";

export const STOPS: { id: PedidoStop; name: string }[] = [
  { id: "buzon", name: "Buzón" },
  { id: "entendido", name: "Entendido" },
  { id: "investigacion", name: "Investigación" },
  { id: "diseno", name: "Diseño" },
  { id: "plan", name: "Plan" },
  { id: "lista", name: "Lista" },
];
export const whoName = (who: string | null) => (!who ? "" : who === "owner" ? "Tú" : seatName(who));

/** The stop to open: the newest delivery he has not seen, else where the idea is. */
export function firstStop(d: Pick<IdeaDetail, "stops" | "stop">): PedidoStop {
  const unseen = [...d.stops].reverse().find((s) => s.delivered && !s.seen && s.stop !== "buzon");
  return unseen?.stop ?? d.stop;
}

/** The line under a stop, in the kit's words. */
export function stopLine(s: IdeaStop, d: Pick<IdeaDetail, "quiet_since" | "state" | "queued">): { text: string; tone: "you" | "live" | "new" | "ok" | "" } {
  const who = whoName(s.by);
  if (s.stop === "buzon") return { text: `Tú${s.at ? "" : ""}`, tone: "" };
  if (s.state === "here") {
    if (d.state === "trabajando") return { text: `${who || "Alguien"} la trabaja`, tone: "live" };
    if (d.queued) return { text: `En la fila de ${whoName(d.queued)}`, tone: "live" };
    if (d.state === "espera") return { text: "Te pregunta", tone: "you" };
    if (s.stop === "lista") return { text: "Espera «Constrúyelo»", tone: "you" };
    if (!s.delivered) return { text: d.quiet_since ? "Quieta" : "Por hacer", tone: "" };
  }
  if (!s.delivered) return { text: s.state === "todo" ? "Todavía no" : "—", tone: "" };
  if (s.state === "todo") return { text: "Se rehace", tone: "" };
  if (s.answer?.verdict === "ok") return { text: `${who} · ${s.stop === "entendido" ? "así es" : "te gustó"}`, tone: "ok" };
  if (s.answer) return { text: `${who} · pediste cambios`, tone: "live" };
  if (!s.seen) return { text: `${who} · sin ver`, tone: "new" };
  return { text: `${who} · visto`, tone: "" };
}

/** The address ver=idea:<key> (and ver=iniciativa:<key>): the ficha alone, Cerrar goes back to the list. */
export const Idea = ({ p, k, now, timeZone, acts, decisions, links, onClose, extra }: { p: OrgProject; k: string; now: number; timeZone?: string; acts: CorrienteActs; decisions: Decision[]; links: FichaLinks; onClose: () => void; extra?: ReactNode }) => (
  <div className="cor-idea" data-idea={k}>
    <Ficha p={p} k={k} now={now} timeZone={timeZone} acts={acts} decisions={decisions} links={links} onClose={onClose} extra={extra} />
  </div>
);
