// PLA-I62-7, PLA-I61: an idea's stops and the words each stop says. PLA-I65-3: the idea itself now opens in the one
// ficha (ficha.tsx), the same from Pedidos, Ideas and Tablero; this file keeps the words and the stand-alone address
// (ver=idea), which shows that ficha with Cerrar back to the list.
import type { ReactNode } from "react";
import type { Decision, IdeaDetail, IdeaStop, OrgProject, PedidoStop } from "@/lib/api";
import { seatName } from "@/lib/corriente";
import { words } from "@/lib/i18n";
import { IDEA_WORDS } from "@/lib/idea-words";
import type { CorrienteActs } from "./acts";
import { Ficha, type FichaLinks } from "./ficha";

const STOP_IDS: PedidoStop[] = ["buzon", "entendido", "investigacion", "diseno", "plan", "lista"];
/** The stops in order, each named in the screen's language when read. */
export const STOPS: { readonly id: PedidoStop; readonly name: string }[] = STOP_IDS.map((id) => ({
  id,
  get name() {
    return words(IDEA_WORDS).stops[id];
  },
}));
export const whoName = (who: string | null) => (!who ? "" : who === "owner" ? words(IDEA_WORDS).you : seatName(who));

/** The stop to open: the newest delivery he has not seen, else where the idea is. */
export function firstStop(d: Pick<IdeaDetail, "stops" | "stop">): PedidoStop {
  const unseen = [...d.stops].reverse().find((s) => s.delivered && !s.seen && s.stop !== "buzon");
  return unseen?.stop ?? d.stop;
}

/** The line under a stop, in the kit's words. */
export function stopLine(s: IdeaStop, d: Pick<IdeaDetail, "quiet_since" | "state" | "queued">): { text: string; tone: "you" | "live" | "new" | "ok" | "" } {
  const w = words(IDEA_WORDS);
  const who = whoName(s.by);
  if (s.stop === "buzon") return { text: w.you, tone: "" };
  if (s.state === "here") {
    if (d.state === "trabajando") return { text: w.works(who), tone: "live" };
    if (d.queued) return { text: w.inQueue(whoName(d.queued)), tone: "live" };
    if (d.state === "espera") return { text: w.asksYou, tone: "you" };
    if (s.stop === "lista") return { text: w.waitsBuild, tone: "you" };
    if (!s.delivered) return { text: d.quiet_since ? w.quiet : w.todo, tone: "" };
  }
  if (!s.delivered) return { text: s.state === "todo" ? w.notYet : "—", tone: "" };
  if (s.state === "todo") return { text: w.redone, tone: "" };
  if (s.answer?.verdict === "ok") return { text: w.ok(who, s.stop === "entendido"), tone: "ok" };
  if (s.answer) return { text: w.changes(who), tone: "live" };
  if (!s.seen) return { text: w.unseen(who), tone: "new" };
  return { text: w.seen(who), tone: "" };
}

/** The address ver=idea:<key> (and ver=iniciativa:<key>): the ficha alone, Cerrar goes back to the list. */
export const Idea = ({ p, k, now, timeZone, acts, decisions, links, onClose, extra }: { p: OrgProject; k: string; now: number; timeZone?: string; acts: CorrienteActs; decisions: Decision[]; links: FichaLinks; onClose: () => void; extra?: ReactNode }) => (
  <div className="cor-idea" data-idea={k}>
    <Ficha p={p} k={k} now={now} timeZone={timeZone} acts={acts} decisions={decisions} links={links} onClose={onClose} extra={extra} />
  </div>
);
