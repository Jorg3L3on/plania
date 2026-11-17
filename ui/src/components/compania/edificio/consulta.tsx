// PLA-I57-1: Preguntar en Pedir. What the side page shows once a question is sent: the thread (the question, what the PO
// reads while it works, its answer) and the past questions. The answer's fix goes back to Pedir with «Pedirlo».
// Pure views; AskBox (ask.tsx) holds the state and polls api.consultas while a question waits.
import { useEffect, useRef, useState } from "react";
import { api, type ConsultaView } from "@/lib/api";

export const pending = (c: ConsultaView) => c.state === "cola" || c.state === "leyendo";

// Polls the project's questions while on is true (the side page is open or one is waiting), every few seconds.
export function useConsultas(slug: string, on: boolean, everyMs = 3000): { list: ConsultaView[] | null; reload: () => Promise<void> } {
  const [list, setList] = useState<ConsultaView[] | null>(null);
  const alive = useRef(true);
  const reload = async () => {
    try {
      const r = await api.consultas(slug);
      if (alive.current) setList(r.consultas);
    } catch {
      // The Mac may be asleep; keep what we have.
    }
  };
  useEffect(() => {
    alive.current = true;
    void reload();
    return () => {
      alive.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => void reload(), everyMs);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, slug, everyMs]);
  return { list, reload };
}

const clock = (iso: string) => new Date(iso).toLocaleString("es-MX", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: false });
const took = (from: string | null, to: string | null) => {
  if (!from || !to) return null;
  const s = Math.max(0, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
};

export const ConsultaThread = ({
  c,
  po,
  onBack,
  onPedirlo,
  onAgain,
  onMore,
  busy,
}: {
  c: ConsultaView;
  po: string;
  onBack: () => void;
  onPedirlo: (fix: string, mode: "ya" | "forma") => void;
  onAgain: (text: string) => void;
  onMore: (text: string) => void;
  busy?: boolean;
}) => {
  const [showTrail, setShowTrail] = useState(false);
  const [more, setMore] = useState("");
  const a = c.answer;
  const reading = pending(c);
  return (
    <div className="edi-ask edi-cq" data-consulta={c.id} data-state={c.state}>
      <button type="button" className="edi-cq-back" onClick={onBack} data-control="consulta-volver">
        ‹ Pedir
      </button>
      <div className="edi-cq-me">
        <span>{c.text}</span>
        <small>Tú · {clock(c.asked_at)} · Preguntar</small>
      </div>
      <section className="edi-cq-po" aria-live="polite">
        <header className="edi-cq-head">
          <span className="edi-cq-win" data-reading={reading || undefined} aria-hidden />
          <div>
            <b>{po}</b>
            <small>
              {c.state === "cola"
                ? "Le llegó tu pregunta; empieza en cuanto termine lo que corre."
                : c.state === "leyendo"
                  ? "Lee el código. Puedes cerrar esto; la barra Pedir te avisa."
                  : c.state === "sin_respuesta"
                    ? "Su corrida terminó sin contestar."
                    : `Leyó ${a?.branch ?? "el código"}${a?.commit ? ` · ${a.commit}` : ""}`}
            </small>
          </div>
          <span className="edi-cq-tm">{reading ? "leyendo…" : a ? took(c.started_at ?? c.asked_at, c.answered_at) : ""}</span>
        </header>
        {a && c.trail.length > 0 && (
          <button type="button" className="edi-cq-fold" onClick={() => setShowTrail((x) => !x)} data-control="consulta-rastro">
            {showTrail ? "Ocultar lo que leyó" : `Ver lo que leyó · ${c.trail.length} pasos`}
          </button>
        )}
        {(reading || showTrail) && c.trail.length > 0 && (
          <ol className="edi-cq-trail">
            {c.trail.map((t, i) => (
              <li key={i} data-now={reading && i === c.trail.length - 1 ? "" : undefined}>
                {t}
              </li>
            ))}
          </ol>
        )}
        {c.state === "sin_respuesta" && (
          <button type="button" className="edi-btn" disabled={busy} onClick={() => onAgain(c.text)} data-control="consulta-otra-vez">
            Preguntar otra vez
          </button>
        )}
        {a && (
          <>
            <p className="edi-cq-short">{a.short}</p>
            {a.why.length > 0 && (
              <>
                <span className="edi-cq-lbl">Por qué</span>
                <ol className="edi-cq-why">
                  {a.why.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ol>
              </>
            )}
            {a.sources.length > 0 && (
              <>
                <span className="edi-cq-lbl">Dónde lo vio</span>
                <div className="edi-cq-srcs">
                  {a.sources.map((s, i) => (
                    <span key={i} className="edi-cq-src" data-missing={s.missing || undefined}>
                      {s.path}
                      {s.line ? `:${s.line}` : ""}
                      {s.missing ? " · no existe" : ""}
                    </span>
                  ))}
                </div>
              </>
            )}
            <p className="edi-cq-sure">
              <b data-sure={a.sure}>{a.sure === "seen" ? "✓ Lo vio en el código" : "Lo supone"}</b>
              <span>No lo probó en vivo</span>
            </p>
          </>
        )}
      </section>
      {a?.fix && (
        <section className="edi-cq-fix" data-section="consulta-arreglo">
          <span className="edi-cq-lbl">Si quieres arreglarlo</span>
          <p>{a.fix}</p>
          <div className="edi-cq-row">
            <button type="button" className="edi-btn edi-btn-primary" onClick={() => onPedirlo(a.fix!, "ya")} data-control="pedirlo-ya">
              Pedirlo · Hacerlo ya
            </button>
            <button type="button" className="edi-btn" onClick={() => onPedirlo(a.fix!, "forma")} data-control="pedirlo-forma">
              Pedirlo · Darle forma
            </button>
          </div>
        </section>
      )}
      {a && (
        <form
          className="edi-cq-more"
          onSubmit={(e) => {
            e.preventDefault();
            if (more.trim().length < 3 || busy) return;
            onMore(more.trim());
            setMore("");
          }}
        >
          <label htmlFor={`mas-${c.id}`} className="edi-sr">
            Pregúntale algo más
          </label>
          <input id={`mas-${c.id}`} type="text" maxLength={1500} placeholder="Pregúntale algo más…" value={more} onChange={(e) => setMore(e.target.value)} data-control="consulta-mas" />
          <button type="submit" className="edi-btn" disabled={busy || more.trim().length < 3}>
            Preguntar
          </button>
        </form>
      )}
      <p className="edi-cq-nothing">No creó idea ni ticket. Queda en Preguntas anteriores.</p>
    </div>
  );
};

export const ConsultaHistory = ({ list, onOpen, onBack }: { list: ConsultaView[]; onOpen: (id: string) => void; onBack: () => void }) => (
  <div className="edi-ask edi-cq" data-consultas>
    <button type="button" className="edi-cq-back" onClick={onBack}>
      ‹ Pedir
    </button>
    {list.length === 0 ? (
      <p className="edi-cq-nothing">Aún no le has preguntado nada a este proyecto.</p>
    ) : (
      <div className="edi-cq-hist">
        {list.map((c) => (
          <button key={c.id} type="button" className="edi-cq-hq" onClick={() => onOpen(c.id)} data-control="consulta-abrir">
            <b>{c.text}</b>
            <span>{c.answer ? c.answer.short : c.state === "sin_respuesta" ? "Sin respuesta." : "El PO lo está leyendo…"}</span>
            <small>{clock(c.asked_at)}</small>
          </button>
        ))}
      </div>
    )}
  </div>
);
