// PLA-I64-2: a thing's thread, small (PLA-IDEA27's hilo, the row size): six idea stops, the «Constrúyelo» valve, one
// segment per step of its construction, Published. One piece, reused by the project's list and (PLA-I65) the ficha.
// Decorative: the row says the same in words (its caps line and «qué toca»).
import { PARADA_NAME, PARADAS, type Hilo as HiloT, type TramoTono } from "@/lib/cosas";

const cls = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(" ");

const Stop = ({ i, h }: { i: number; h: HiloT }) => {
  if (h.idea === null) return <span />;
  if (i < h.idea) return <span><i className="cor-h-d" /></span>;
  if (i > h.idea) return <span><i className="cor-h-r" /></span>;
  const t = h.ideaTono;
  return <span>{t === "toca" ? <i className="cor-h-y" /> : t === "vivo" ? <i className="cor-h-a" /> : t === "quieto" ? <i className="cor-h-r on" /> : <i className="cor-h-d" />}</span>;
};

const SEG: Record<TramoTono, string> = { hecho: "on", vivo: "live", toca: "you", fila: "fila", quieto: "" };

export const Hilo = ({ h, small }: { h: HiloT; small?: boolean }) => {
  const valve = h.valvula;
  const fin = h.publicado;
  const segs = h.tramos.length ? h.tramos.map((t) => (fin ? "fin" : SEG[t.tono])) : valve === "atorada" || valve === "toca" || valve === "pasando" ? ["", "", ""] : [];
  return (
    <span className={cls("cor-hilo", h.idea === null && "born", small && "sm", h.tramos.some((t) => t.tono === "vivo") || valve === "pasando" ? "flow" : null)} aria-hidden data-hilo={h.at}>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <Stop key={i} i={i} h={h} />
      ))}
      <span>{h.idea === null && valve === "abierta" && !h.tramos.length ? null : <i className={cls("cor-h-v", valve === "toca" || valve === "atorada" ? "wait" : valve === "pasando" || valve === "abierta" ? "on" : null)} />}</span>
      <span className="cor-h-c">
        {valve === "atorada" && <i className="cor-h-y" />}
        {segs.length > 0 && (
          <span className="cor-h-sg">
            {segs.map((s, i) => (
              <i key={i} className={s || undefined} />
            ))}
          </span>
        )}
      </span>
      <span>{fin ? <i className="cor-h-e" /> : <i className="cor-h-r" />}</span>
    </span>
  );
};

/** PLA-62: the short names, when the thread is narrow (under 1360 px wide). */
const SHORT: Partial<Record<(typeof PARADAS)[number], string>> = { entendido: "Entend.", investigacion: "Invest.", construccion: "Constr.", publicado: "Public." };

/** The list's header: the nine stops' names over the threads. */
export const HiloHead = () => (
  <span className="cor-hilo head" aria-hidden>
    {PARADAS.map((p) =>
      p === "valvula" ? (
        <span key={p} />
      ) : (
        <span key={p}>
          <span className="l">{PARADA_NAME[p]}</span>
          <span className="s">{SHORT[p] ?? PARADA_NAME[p]}</span>
        </span>
      ),
    )}
  </span>
);
