// PLA-I39-8: the clock. A bar docked at the bottom over the last hours up to now (GET /api/company/history), with a
// mark per delivery, question, answer and order. Dragging back lights each window as that teammate really worked;
// the sky follows the hour. "Ver qué pasó" plays from the first event to now and stops there; "Volver a ahora"
// restores the live view. The arrow keys jump between events. Past only: the bar ends at now. With reduced motion
// nothing autoplays: "Ver qué pasó" jumps to the first event instead. ClockBar is pure; the page holds the time.
import type { KeyboardEvent } from "react";
import type { OrgHistory } from "@/lib/api";
import { RANGE, clampTime, marksOf, stepEvent, timeAt, valueAt, type Mark } from "@/lib/edificio";

const KIND_WORD: Record<Mark["kind"], string> = { delivered: "Entrega", asked: "Pregunta", answered: "Respuesta", ordered: "Pedido" };

export const clockText = (t: number, timeZone?: string) => new Intl.DateTimeFormat("es-MX", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone }).format(new Date(t));

export const ClockBar = ({
  history,
  at,
  playing,
  timeZone,
  onAt,
  onPlay,
  onNow,
}: {
  history: OrgHistory;
  // null: now (the live view).
  at: number | null;
  playing?: boolean;
  timeZone?: string;
  onAt: (t: number) => void;
  onPlay: () => void;
  onNow: () => void;
}) => {
  const marks = marksOf(history);
  const to = Date.parse(history.to);
  const t = at ?? to;
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const next = stepEvent(marks, t, e.key === "ArrowRight" ? 1 : -1);
    e.preventDefault();
    if (next == null) {
      if (e.key === "ArrowRight") onNow();
      return;
    }
    onAt(next);
  };
  const ticks = [0, 0.25, 0.5, 0.75].map((f) => Date.parse(history.from) + f * (to - Date.parse(history.from)));
  return (
    <div className="edi-clock" role="group" aria-label="Reloj de la compañía" data-clock data-at={at == null ? "now" : "past"}>
      <button type="button" className="edi-play" onClick={onPlay} disabled={playing} data-control="ver-que-paso">
        <span aria-hidden>▶</span>
        <span className="edi-play-label">{playing ? "Mirando…" : "Ver qué pasó"}</span>
      </button>
      <div className="edi-ruler">
        <div className="edi-rbar" aria-hidden />
        <div aria-hidden>
          {marks.map((m, i) => (
            <span key={i} className="edi-mark" data-mark={m.kind} style={{ left: `${m.pct}%` }} title={`${KIND_WORD[m.kind]}: ${m.title}`} />
          ))}
        </div>
        <div aria-hidden>
          {ticks.map((x, i) => (
            <span key={i} className="edi-tick" style={{ left: `${(i / 4) * 100}%` }}>
              {clockText(x, timeZone)}
            </span>
          ))}
          <span className="edi-tick edi-tick-now" style={{ left: "100%" }}>
            ahora
          </span>
        </div>
        <input
          className="edi-scrub"
          type="range"
          min={0}
          max={RANGE}
          step={1}
          value={valueAt(t, history)}
          aria-label="Moverse en el tiempo"
          aria-valuetext={at == null ? "ahora" : clockText(t, timeZone)}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (v >= RANGE) onNow();
            else onAt(clampTime(timeAt(v, history), history));
          }}
          onKeyDown={onKey}
          data-control="reloj"
        />
      </div>
      {at != null && (
        <button type="button" className="edi-btn edi-btn-primary edi-back" onClick={onNow} data-control="volver-a-ahora">
          Volver a ahora
        </button>
      )}
    </div>
  );
};
