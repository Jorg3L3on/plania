// PLA-I61 (La idea abierta, PLA-IDEA24): one idea in La ficha, the same from Pedido, Ideas, Diseño or Ahora.
// A tube of six stops (who delivered each, when, and whether the owner saw it), a drawer with what the selected stop
// delivered (the PO's reading, Research's recommendation and options, Artist's frames, the plan) and an answer bar
// under it (Me gusta / Pide cambios / another option / Corregir; without an answer the idea keeps going).
// Recorrido tells what happened in sentences; the full doc opens inside the idea and comes back to it; La mesa de
// revisión shows the frames big and takes notes pinned to a spot. A request of the owner's keeps its note box and
// Constrúyelo / Guardar / Descartar. IdeaView is pure (tests call it); IdeaTab holds what is typed and what is open.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { IdeaAnswerInput, IdeaDetail, IdeaFrame, IdeaNote, IdeaStop, PedidoStop, PedidoTrailItem } from "@/lib/api";
import { roleName } from "@/lib/org";
import { ImageDrop } from "./image-drop";
import { PEDIDO_TONE } from "./tubo";
import type { PedidoActs } from "./pedido";

export const STOPS: { id: PedidoStop; name: string; code: string }[] = [
  { id: "buzon", name: "Pedido", code: "TÚ" },
  { id: "entendido", name: "Entendido", code: "PO" },
  { id: "investigacion", name: "Investigación", code: "RE" },
  { id: "diseno", name: "Diseño", code: "AR" },
  { id: "plan", name: "Plan", code: "PO" },
  { id: "lista", name: "Lista", code: "✓" },
];
const ANSWERABLE: PedidoStop[] = ["entendido", "investigacion", "diseno", "plan"];
const stopWord = (s: PedidoStop) => STOPS.find((x) => x.id === s)?.name ?? s;
export const whoName = (who: string | null) => (!who ? "" : who === "jorge" ? "Tú" : who === "product-owner" ? "PO" : who === "plania" ? "Plania" : roleName(who));

const hm = (iso: string, timeZone?: string) => new Intl.DateTimeFormat("es-MX", { hour: "numeric", minute: "2-digit", hour12: false, timeZone }).format(new Date(iso));
export function whenOf(iso: string, now: number, timeZone?: string): string {
  const day = (t: number) => new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", timeZone }).format(new Date(t));
  return day(Date.parse(iso)) === day(now) ? hm(iso, timeZone) : `${day(Date.parse(iso))} ${hm(iso, timeZone)}`;
}
export function agoOf(iso: string, now: number): string {
  const min = Math.max(0, Math.round((now - Date.parse(iso)) / 60000));
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  return h < 48 ? `hace ${h} h` : `hace ${Math.round(h / 24)} días`;
}

// The stop to open: the newest delivery he has not opened, else where the idea is.
export function firstStop(d: Pick<IdeaDetail, "stops" | "stop">): PedidoStop {
  const unseen = [...d.stops].reverse().find((s) => s.delivered && !s.seen && s.stop !== "buzon");
  return unseen?.stop ?? d.stop;
}

// What the stop's line under its port says.
export function stopLine(s: IdeaStop, d: Pick<IdeaDetail, "quiet_since" | "state" | "queued">, timeZone?: string): { text: string; tone: string } {
  if (s.stop === "buzon") return { text: s.at ? hm(s.at, timeZone) : "", tone: "" };
  if (s.state === "here") {
    if (d.state === "trabajando") return { text: `${whoName(s.by) || "Alguien"} la trabaja`, tone: "back" };
    if (d.queued) return { text: `En la fila de ${whoName(d.queued)}`, tone: "back" };
    if (d.state === "espera") return { text: "Te pregunta", tone: "you" };
    if (s.stop === "lista") return { text: "Espera «Constrúyelo»", tone: "you" };
    if (!s.delivered) return { text: d.quiet_since ? `Quieta · ${hm(d.quiet_since, timeZone)}` : "Por hacer", tone: "quiet" };
  }
  if (!s.delivered) return { text: s.state === "todo" ? "Falta" : "—", tone: "" };
  if (s.state === "todo") return { text: "Se rehace", tone: "" };
  if (s.answer?.verdict === "ok") return { text: s.stop === "entendido" ? "Así es" : "Te gustó", tone: "ok" };
  if (s.answer) return { text: "Pediste cambios", tone: "back" };
  if (!s.seen) return { text: `Sin ver · ${s.at ? hm(s.at, timeZone) : ""}`, tone: "new" };
  return { text: `Visto · ${s.at ? hm(s.at, timeZone) : ""}`, tone: "" };
}

export type IdeaActs = PedidoActs & {
  onVisto?: (stop: PedidoStop) => void;
  onRespuesta?: (input: IdeaAnswerInput) => void;
  onDespertar?: () => void;
  onBack?: () => void;
};
export type IdeaUi = {
  stop: PedidoStop;
  sub: "entregas" | "recorrido";
  doc: PedidoStop | null;
  frame: number;
  mesa: boolean;
  pins: IdeaNote[];
  text: string;
  // «Pide cambios…» opened the line to say what to change.
  asking: boolean;
  pick: number | null;
  note: string;
  answer: string;
  confirmDrop: boolean;
};
export const initialUi = (d: Pick<IdeaDetail, "stops" | "stop">): IdeaUi => ({ stop: firstStop(d), sub: "entregas", doc: null, frame: 0, mesa: false, pins: [], text: "", asking: false, pick: null, note: "", answer: "", confirmDrop: false });

export type IdeaViewProps = {
  d: IdeaDetail;
  now: number;
  timeZone?: string;
  acts: IdeaActs;
  // Where it was opened from, for «← …».
  from: string;
  ui: IdeaUi;
  set: (p: Partial<IdeaUi>) => void;
  noteImages?: ReactNode;
  pending?: number;
  noteRef?: RefObject<HTMLTextAreaElement | null>;
};

const open = (d: IdeaDetail) => d.status === "Open" && !d.promoted_to;

function Rail({ d, ui, set, timeZone }: Pick<IdeaViewProps, "d" | "ui" | "set" | "timeZone">) {
  const here = Math.max(0, STOPS.findIndex((s) => s.id === d.stop));
  const centre = (i: number) => `calc((100% - 14px) * ${(i + 0.5) / 6})`;
  return (
    <ol className="ia-rail" aria-label="Paradas de la idea">
      <li className="ia-tube" aria-hidden>
        <i style={{ width: `${(here / 5) * 100}%` }} />
      </li>
      <li className="ia-cap" aria-hidden style={{ left: centre(here), "--sc": PEDIDO_TONE[d.state] } as CSSProperties} />
      {STOPS.map((st) => {
        const s = d.stops.find((x) => x.stop === st.id)!;
        const line = stopLine(s, d, timeZone);
        return (
          <li key={st.id} className="ia-stop" data-state={s.state} data-unseen={s.delivered && !s.seen && st.id !== "buzon" ? "" : undefined} data-sel={ui.sub === "entregas" && ui.stop === st.id ? "" : undefined}>
            <button type="button" onClick={() => set({ stop: st.id, sub: "entregas", doc: null, asking: false, text: "" })} aria-label={`${st.name}: ${line.text}`} aria-pressed={ui.sub === "entregas" && ui.stop === st.id} data-control={`idea-parada-${st.id}`}>
              <span className="ia-port">{st.code}</span>
              <span className="ia-sname">{st.name}</span>
              <span className="ia-sline" data-tone={line.tone}>
                {line.text}
              </span>
            </button>
          </li>
        );
      })}
      <li className="ia-valve" aria-hidden />
    </ol>
  );
}

function Eyebrow({ s, timeZone, children, onDoc }: { s: IdeaStop; timeZone?: string; children?: ReactNode; onDoc?: () => void }) {
  return (
    <p className="ia-eb">
      {[whoName(s.by), s.at ? hm(s.at, timeZone) : null].filter(Boolean).join(" · ")}
      {children}
      {s.doc && onDoc && (
        <button type="button" className="ia-link" onClick={onDoc} data-control="idea-doc">
          Doc completo
        </button>
      )}
    </p>
  );
}

function Frames({ d, ui, set }: Pick<IdeaViewProps, "d" | "ui" | "set">) {
  const f = d.frames[Math.min(ui.frame, d.frames.length - 1)]!;
  const notes = (id: string) => ui.pins.filter((p) => p.frame === id).length;
  return (
    <div className="ia-left">
      <button type="button" className="ia-shot" onClick={() => set({ mesa: true })} aria-label={`Abrir la mesa de revisión en ${f.frame}`} data-control="idea-mesa">
        <img src={f.url} alt={`Marco ${f.frame}: ${f.name}`} />
        <span className="ia-open">Abrir la mesa ⤢</span>
      </button>
      <div className="ia-strip" role="group" aria-label="Marcos">
        {d.frames.map((x, i) => (
          <button key={x.id} type="button" className="ia-th" aria-current={i === ui.frame ? "true" : undefined} data-notes={notes(x.frame) || undefined} title={`${x.frame} · ${x.name}`} onClick={() => set({ frame: i })} data-control="idea-marco">
            <img src={x.url} alt="" loading="lazy" />
            <span>{x.frame}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function Drawer({ d, ui, set, now, timeZone, acts }: IdeaViewProps) {
  const s = d.stops.find((x) => x.stop === ui.stop)!;
  const toDoc = s.doc ? () => set({ doc: s.stop }) : undefined;
  switch (s.stop) {
    case "buzon":
      return (
        <div className="ia-dr">
          <p className="ia-eb">{d.pedido ? `Tú · ${s.at ? whenOf(s.at, now, timeZone) : ""} · desde Pedir` : `${d.key} · idea de ${whoName(d.who)}`}</p>
          <p className="ia-quote">«{d.text}»</p>
          {d.pictures.length > 0 && <p className="ia-p ia-mute">{d.pictures.length === 1 ? "Con una imagen." : `Con ${d.pictures.length} imágenes.`}</p>}
          {d.pedido && <p className="ia-p ia-mute">Lo que añadas abajo le llega al PO y queda en el recorrido.</p>}
        </div>
      );
    case "entendido": {
      if (!s.delivered) return <Empty title="El PO todavía no escribe lo que entendió." d={d} now={now} timeZone={timeZone} acts={acts} />;
      const cells: [string, string | null, string | null][] = [
        ["Problema", d.ficha.problema, null],
        ["Tamaño", d.ficha.tamano, "key"],
        ["Solución", d.ficha.solucion, null],
        ["Riesgos", d.ficha.riesgos, null],
        ["Fuera", d.ficha.fuera, null],
      ];
      return (
        <div className="ia-dr">
          <Eyebrow s={s} timeZone={timeZone} onDoc={toDoc}>
            <span> · lo que entendió</span>
          </Eyebrow>
          {d.understood && <p className="ia-quote">{d.understood.replace(/^\s*entend[ií]\s*[:：-]\s*/i, "")}</p>}
          <div className="ia-cells">
            {cells.map(([k, v, key]) => (
              <div key={k} className="ia-cell" data-key={key ?? undefined}>
                <b>{k}</b>
                <span data-todo={v ? undefined : ""}>{v ? v.replace(/[*_`#]/g, "") : "Pendiente"}</span>
              </div>
            ))}
          </div>
        </div>
      );
    }
    case "investigacion": {
      if (!s.delivered) return <Empty title="Research todavía no entrega." d={d} now={now} timeZone={timeZone} acts={acts} />;
      const picked = ui.pick ?? 1;
      return (
        <div className="ia-dr ia-dr2">
          <div className="ia-col ia-scroll">
            <Eyebrow s={s} timeZone={timeZone} onDoc={toDoc} />
            <div className="ia-rec">
              <span className="ia-eb ia-blue">Recomienda</span>
              <div className="ia-md">
                <Markdown remarkPlugins={[remarkGfm]}>{d.research.recommendation ?? "Sin recomendación escrita."}</Markdown>
              </div>
            </div>
            {d.research.unknown.length > 0 && (
              <>
                <p className="ia-eb">Lo que todavía no se sabe</p>
                <ul className="ia-ul">
                  {d.research.unknown.map((u) => (
                    <li key={u}>{u}</li>
                  ))}
                </ul>
              </>
            )}
          </div>
          <div className="ia-col ia-scroll">
            <p className="ia-eb">{d.research.options.length ? `Las ${d.research.options.length} opciones` : "Opciones"}</p>
            {d.research.options.length === 0 && <p className="ia-p ia-mute">El doc no trae una lista de opciones.</p>}
            <div className="ia-opts" role="radiogroup" aria-label="Opciones de la investigación">
              {d.research.options.map((o) => (
                <label key={o.n} className="ia-opt" data-on={picked === o.n ? "" : undefined}>
                  <input type="radio" name={`ia-opt-${d.key}`} value={o.n} checked={picked === o.n} disabled={!open(d) || !!s.answer} onChange={() => set({ pick: o.n })} />
                  <b>
                    {o.n}. {o.title}
                  </b>
                  {picked === o.n && o.text && <small>{o.text}</small>}
                </label>
              ))}
            </div>
          </div>
        </div>
      );
    }
    case "diseno": {
      if (!s.delivered) return <Empty title="Artist todavía no entrega el diseño." d={d} now={now} timeZone={timeZone} acts={acts} />;
      if (!d.frames.length)
        return (
          <div className="ia-dr">
            <Eyebrow s={s} timeZone={timeZone} onDoc={toDoc} />
            <p className="ia-p">Artist escribió el doc pero no subió los marcos a Plania. Pídele que los suba (attach_frames) o abre el doc completo.</p>
          </div>
        );
      const f = d.frames[Math.min(ui.frame, d.frames.length - 1)]!;
      return (
        <div className="ia-dr ia-dr2">
          <Frames d={d} ui={ui} set={set} />
          <div className="ia-col">
            <Eyebrow s={s} timeZone={timeZone} onDoc={toDoc}>
              <span> · {d.frames.length} marcos</span>
            </Eyebrow>
            <h4 className="ia-h">
              {f.frame} · {f.name} <small>{Math.min(ui.frame, d.frames.length - 1) + 1} de {d.frames.length}</small>
            </h4>
            <dl className="ia-kv">
              {f.hace && (
                <>
                  <dt>Qué hace</dt>
                  <dd>{f.hace}</dd>
                </>
              )}
              {f.porque && (
                <>
                  <dt>Por qué</dt>
                  <dd>{f.porque}</dd>
                </>
              )}
            </dl>
          </div>
        </div>
      );
    }
    case "plan":
      if (!s.delivered) return <Empty title="Nadie arma el plan todavía." d={d} now={now} timeZone={timeZone} acts={acts} />;
      return (
        <div className="ia-dr">
          <Eyebrow s={s} timeZone={timeZone} onDoc={toDoc} />
          {d.plan_steps.length ? (
            <ol className="ia-steps">
              {d.plan_steps.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ol>
          ) : (
            <p className="ia-p ia-mute">El plan no trae una lista de pasos; ábrelo completo.</p>
          )}
        </div>
      );
    default:
      return (
        <div className="ia-dr ia-empty">
          <h4 className="ia-h">{d.promoted_to ? `Ya es ${d.promoted_to} en el tablero.` : "Cuando el plan esté, «Constrúyelo» la sube al tablero como iniciativa."}</h4>
          {!d.promoted_to && d.pedido && <p className="ia-p ia-mute">También puedes pedirlo ya: el PO termina lo que falte y crea la iniciativa.</p>}
        </div>
      );
  }
}

function Empty({ title, d, now, timeZone, acts }: { title: string; d: IdeaDetail; now: number; timeZone?: string; acts: IdeaActs }) {
  return (
    <div className="ia-dr ia-empty">
      {d.quiet_since && (
        <span className="ia-quiet">
          <i aria-hidden />
          Quieta desde las {hm(d.quiet_since, timeZone)}, {agoOf(d.quiet_since, now)}
        </span>
      )}
      <h4 className="ia-h">{title}</h4>
      {d.quiet_since && open(d) && acts.onDespertar && (
        <>
          <p className="ia-p ia-mute">Nadie la trabaja. Si la despiertas, {d.stage === "research" ? "Research" : d.stage === "design" ? "Artist" : "el PO"} la toma en su siguiente turno.</p>
          <div className="ia-btns">
            <button type="button" className="edi-btn edi-btn-primary" disabled={acts.busy === "despertar"} onClick={() => acts.onDespertar!()} data-control="idea-despertar">
              {acts.busy === "despertar" ? "…" : "Despertar"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// The answer bar under a delivery: what he said (with Deshacer for a «me gusta»), or the buttons to say it.
function AnswerBar({ d, ui, set, acts }: Pick<IdeaViewProps, "d" | "ui" | "set" | "acts">) {
  const s = d.stops.find((x) => x.stop === ui.stop)!;
  if (!ANSWERABLE.includes(s.stop) || !s.delivered || !acts.onRespuesta) return null;
  const busy = acts.busy === "respuesta";
  const send = (input: Omit<IdeaAnswerInput, "stop">) => acts.onRespuesta!({ stop: s.stop, ...input });
  if (s.answer) {
    const a = s.answer;
    const said =
      a.verdict === "ok"
        ? s.stop === "entendido"
          ? "Le dijiste al PO que así es."
          : s.stop === "investigacion"
            ? "Vas con la recomendada."
            : `Te gustó ${s.stop === "diseno" ? "el diseño" : "el plan"}.`
        : a.verdict === "opcion"
          ? `Pediste la opción ${a.option}.`
          : a.verdict === "corregir"
            ? "Corregiste al PO."
            : a.notes.length
              ? `Pediste cambios con ${a.notes.length} ${a.notes.length === 1 ? "nota" : "notas"}.`
              : "Pediste cambios.";
    const after = a.verdict === "ok" ? "Nada se detiene." : `Volvió a ${stopWord(s.stop)}; lo que sigue se rehace.`;
    return (
      <div className="ia-vbar" data-done style={{ "--tone": a.verdict === "ok" ? "var(--status-done)" : "var(--status-now)" } as CSSProperties}>
        <p>
          <b>{said}</b> {after}
        </p>
        {a.verdict === "ok" && open(d) && (
          <button type="button" className="ia-link" disabled={busy} onClick={() => send({ verdict: "deshacer" })} data-control="idea-deshacer">
            Deshacer
          </button>
        )}
      </div>
    );
  }
  if (!open(d)) return null;
  if (s.stop === "investigacion") {
    const pick = ui.pick ?? 1;
    return (
      <div className="ia-vbar">
        <p>{pick === 1 ? <><b>¿Vas con la recomendada?</b> O elige otra opción.</> : <><b>Elegiste la opción {pick}.</b> Research la ajusta y lo que sigue se rehace.</>}</p>
        <div className="ia-btns">
          {pick === 1 ? (
            <button type="button" className="edi-btn ia-ok" disabled={busy} onClick={() => send({ verdict: "ok" })} data-control="idea-ok">
              Va con la recomendada
            </button>
          ) : (
            <button type="button" className="edi-btn ia-ask" disabled={busy} onClick={() => send({ verdict: "opcion", option: pick })} data-control="idea-opcion">
              Pedir la opción {pick}
            </button>
          )}
        </div>
      </div>
    );
  }
  if (s.stop === "entendido" || ui.asking) {
    const verdict = s.stop === "entendido" ? "corregir" : "cambios";
    return (
      <form
        className="ia-vbar"
        onSubmit={(e) => {
          e.preventDefault();
          if (ui.text.trim() && !busy) send({ verdict, text: ui.text.trim() });
        }}
      >
        {s.stop === "entendido" && (
          <button type="button" className="edi-btn ia-ok" disabled={busy} onClick={() => send({ verdict: "ok" })} data-control="idea-ok">
            Así es
          </button>
        )}
        <label className="edi-sr" htmlFor={`ia-text-${d.key}`}>
          {s.stop === "entendido" ? "Qué entendió mal el PO" : "Qué cambiarías"}
        </label>
        <input id={`ia-text-${d.key}`} className="ia-input" autoComplete="off" maxLength={1000} placeholder={s.stop === "entendido" ? "No es eso: dile qué entendió mal…" : "¿Qué cambiarías?"} value={ui.text} onChange={(e) => set({ text: e.target.value })} />
        <button type="submit" className="edi-btn ia-ask" disabled={busy || !ui.text.trim()} data-control="idea-cambios">
          {s.stop === "entendido" ? "Corregir" : "Pedir cambios"}
        </button>
      </form>
    );
  }
  return (
    <div className="ia-vbar">
      <p>
        <b>¿Cómo lo ves?</b> {d.stops.findIndex((x) => x.stop === s.stop) < d.stops.findIndex((x) => x.stop === d.stop) ? "Ya siguió adelante; si pides cambios, vuelve aquí y lo que sigue espera." : "Si pides cambios, vuelve a su dueño con tu nota."}
      </p>
      <div className="ia-btns">
        <button type="button" className="edi-btn ia-ok" disabled={busy} onClick={() => send({ verdict: "ok" })} data-control="idea-ok">
          Me gusta, sigue
        </button>
        <button type="button" className="edi-btn ia-ask" disabled={busy} onClick={() => (s.stop === "diseno" && d.frames.length ? set({ mesa: true }) : set({ asking: true }))} data-control="idea-pide-cambios">
          Pide cambios…
        </button>
      </div>
    </div>
  );
}

const SKIP: PedidoTrailItem["kind"][] = [];
function Trail({ d, set, now, timeZone, acts }: Pick<IdeaViewProps, "d" | "set" | "now" | "timeZone" | "acts">) {
  const stopOfItem = (x: PedidoTrailItem): PedidoStop | null => {
    if (x.stop) return x.stop as PedidoStop;
    if (x.kind === "pedido") return "buzon";
    if (x.kind === "entendi") return "entendido";
    if (x.kind === "doc") return ({ Idea: "entendido", Research: "investigacion", Design: "diseno", Plan: "plan" } as Record<string, PedidoStop>)[x.doc?.title ?? ""] ?? null;
    return null;
  };
  return (
    <ol className="ia-trail" aria-label="Recorrido">
      {d.trail
        .filter((x) => !SKIP.includes(x.kind))
        .map((x, i) => {
          const st = stopOfItem(x);
          return (
            <li key={i} data-me={x.who === "jorge" ? "" : undefined} data-faint={x.kind === "etapa" ? "" : undefined}>
              <time dateTime={x.at}>{whenOf(x.at, now, timeZone)}</time>
              <span className="ia-at">{st ? stopWord(st) : ""}</span>
              <span>
                <b>{whoName(x.who)}</b> · {x.kind === "pedido" ? `Lo pediste: «${d.text}»` : x.text}
                {st && x.kind !== "pedido" && x.kind !== "etapa" && (
                  <>
                    {" "}
                    <button type="button" className="ia-link" onClick={() => set({ sub: "entregas", stop: st, doc: null })} data-control="idea-ver-parada">
                      Ver
                    </button>
                  </>
                )}
              </span>
            </li>
          );
        })}
      {d.quiet_since && open(d) && (
        <li data-quiet="">
          <time>—</time>
          <span className="ia-at" />
          <span>
            Desde las {hm(d.quiet_since, timeZone)} nadie la trabaja.{" "}
            {acts.onDespertar && (
              <button type="button" className="ia-link" disabled={acts.busy === "despertar"} onClick={() => acts.onDespertar!()} data-control="idea-despertar">
                Despertar
              </button>
            )}
          </span>
        </li>
      )}
    </ol>
  );
}

function DocInside({ d, ui, set, timeZone }: Pick<IdeaViewProps, "d" | "ui" | "set" | "timeZone">) {
  const s = d.stops.find((x) => x.stop === ui.doc)!;
  return (
    <div className="ia-docv">
      <button type="button" className="edi-fi-back" onClick={() => set({ doc: null })} data-control="idea-doc-volver">
        ← {d.key} · {stopWord(s.stop)}
      </button>
      <header className="edi-fi-head">
        <p className="edi-eyebrow">
          {stopWord(s.stop)} · {[whoName(s.by), s.at ? hm(s.at, timeZone) : null].filter(Boolean).join(" · ")} · v{s.doc?.version}
        </p>
        <h3 className="edi-fi-title">{s.doc?.title}</h3>
      </header>
      <div className="edi-fi-md ia-md">
        <Markdown remarkPlugins={[remarkGfm]}>{s.doc?.markdown ?? ""}</Markdown>
      </div>
    </div>
  );
}

// La mesa de revisión: the frames big, notes pinned to a spot, then «Me gusta» or the notes to Artist.
export function Mesa({ d, ui, set, acts }: Pick<IdeaViewProps, "d" | "ui" | "set" | "acts">) {
  const f: IdeaFrame = d.frames[Math.min(ui.frame, d.frames.length - 1)]!;
  const box = useRef<HTMLDivElement>(null);
  const s = d.stops.find((x) => x.stop === "diseno")!;
  const groups: { g: string; items: number[] }[] = [];
  d.frames.forEach((x, i) => {
    const g = x.group ?? "Marcos";
    const last = groups[groups.length - 1];
    if (!last || last.g !== g) groups.push({ g, items: [i] });
    else last.items.push(i);
  });
  const ready = ui.pins.filter((p) => p.text.trim()).length;
  const step = (n: number) => set({ frame: (ui.frame + n + d.frames.length) % d.frames.length });
  const pinsHere = ui.pins.map((p, n) => ({ ...p, n: n + 1 })).filter((p) => p.frame === f.frame);
  const busy = acts.busy === "respuesta";
  return (
    <div
      className="ia-layer"
      role="dialog"
      aria-modal="true"
      aria-label="Mesa de revisión del diseño"
      onKeyDown={(e) => {
        if (e.key === "Escape") return set({ mesa: false });
        if ((e.target as HTMLElement).matches("textarea, input")) return;
        if (e.key === "ArrowRight") step(1);
        if (e.key === "ArrowLeft") step(-1);
      }}
    >
      <div className="ia-mesa">
        <div className="ia-mh">
          <h3>Mesa de revisión</h3>
          <p className="ia-eb">
            {d.key} · diseño de {whoName(s.by) || "Artist"}
          </p>
          <button type="button" className="ia-x" onClick={() => set({ mesa: false })} aria-label="Cerrar la mesa" data-control="idea-mesa-cerrar" autoFocus>
            ✕
          </button>
        </div>
        <div className="ia-mb">
          <nav className="ia-flist" aria-label="Marcos">
            {groups.map((g) => (
              <div key={g.g} role="group" aria-label={g.g}>
                <p className="ia-fg">{g.g}</p>
                {g.items.map((i) => {
                  const x = d.frames[i]!;
                  const n = ui.pins.filter((p) => p.frame === x.frame).length;
                  return (
                    <button key={x.id} type="button" className="ia-fi" aria-current={i === ui.frame ? "true" : undefined} onClick={() => set({ frame: i })} data-control="idea-mesa-marco">
                      <img src={x.url} alt="" loading="lazy" />
                      <span>
                        <b>
                          {x.frame} · {x.name}
                        </b>
                        {x.hace && <small>{x.hace}</small>}
                      </span>
                      {n > 0 && <em>{n}</em>}
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>
          <div className="ia-center">
            <div className="ia-table">
              <div
                ref={box}
                className="ia-big"
                role="button"
                tabIndex={0}
                aria-label={`Marco ${f.frame}: toca un punto para dejar una nota ahí`}
                style={{ aspectRatio: f.width && f.height ? `${f.width} / ${f.height}` : undefined }}
                onClick={(e) => {
                  if (!open(d) || s.answer) return;
                  const r = e.currentTarget.getBoundingClientRect();
                  const x = Math.round(((e.clientX - r.left) / r.width) * 1000) / 10;
                  const y = Math.round(((e.clientY - r.top) / r.height) * 1000) / 10;
                  set({ pins: [...ui.pins, { frame: f.frame, x, y, text: "" }] });
                }}
                data-control="idea-mesa-clavar"
              >
                <img src={f.url} alt={`Marco ${f.frame}: ${f.name}`} draggable={false} />
                {pinsHere.map((p) => (
                  <span key={p.n} className="ia-pin" style={{ left: `${p.x}%`, top: `${p.y}%` }}>
                    <b>{p.n}</b>
                  </span>
                ))}
              </div>
            </div>
            <div className="ia-cap2">
              <span className="ia-fname">
                {f.frame} · {f.name}
              </span>
              <dl>
                {f.hace && (
                  <>
                    <dt>Qué hace</dt>
                    <dd>{f.hace}</dd>
                  </>
                )}
                {f.porque && (
                  <>
                    <dt>Por qué</dt>
                    <dd>{f.porque}</dd>
                  </>
                )}
              </dl>
              <span className="ia-nav">
                <button type="button" onClick={() => step(-1)} aria-label="Marco anterior" data-control="idea-mesa-anterior">
                  ←
                </button>
                <button type="button" onClick={() => step(1)} aria-label="Marco siguiente" data-control="idea-mesa-siguiente">
                  →
                </button>
              </span>
            </div>
          </div>
          <section className="ia-side" aria-label="Tus notas para Artist">
            <div className="ia-notes">
              <p className="ia-eb">Tus notas para Artist · {ui.pins.length}</p>
              {ui.pins.length === 0 && <p className="ia-p ia-mute">{open(d) && !s.answer ? "Toca un punto del marco para dejar una nota ahí. Le llega a Artist con el marco y el punto exacto." : "Sin notas."}</p>}
              {ui.pins.map((p, i) => {
                const fr = d.frames.find((x) => x.frame === p.frame);
                return (
                  <div key={i} className="ia-note">
                    <i>{i + 1}</i>
                    <small>
                      {p.frame}
                      {fr ? ` · ${fr.name}` : ""}
                    </small>
                    <button type="button" className="ia-del" onClick={() => set({ pins: ui.pins.filter((_, j) => j !== i) })} aria-label={`Quitar la nota ${i + 1}`} data-control="idea-mesa-quitar">
                      ✕
                    </button>
                    <textarea aria-label={`Nota ${i + 1}`} placeholder="¿Qué cambiarías aquí?" maxLength={600} value={p.text} onChange={(e) => set({ pins: ui.pins.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) })} autoFocus={i === ui.pins.length - 1 && !p.text} />
                  </div>
                );
              })}
            </div>
            <div className="ia-mfoot">
              {s.answer ? (
                <p>{s.answer.verdict === "ok" ? "Te gustó el diseño." : "Ya mandaste tus notas a Artist."}</p>
              ) : open(d) && acts.onRespuesta ? (
                <>
                  <p>«Me gusta» deja que la idea siga. Tus notas la regresan a Artist y lo que sigue espera el diseño nuevo.</p>
                  <div className="ia-btns">
                    <button type="button" className="edi-btn ia-ok" disabled={busy} onClick={() => acts.onRespuesta!({ stop: "diseno", verdict: "ok" })} data-control="idea-mesa-ok">
                      Me gusta, sigue
                    </button>
                    <button
                      type="button"
                      className="edi-btn edi-btn-primary"
                      disabled={busy || ready === 0}
                      onClick={() => acts.onRespuesta!({ stop: "diseno", verdict: "cambios", notes: ui.pins.filter((p) => p.text.trim()) })}
                      data-control="idea-mesa-mandar"
                    >
                      {ready ? `Mandar ${ready} ${ready === 1 ? "nota" : "notas"} a Artist` : "Mandar notas a Artist"}
                    </button>
                  </div>
                </>
              ) : null}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

export const IdeaView = (props: IdeaViewProps) => {
  const { d, now, timeZone, acts, from, ui, set, noteImages, pending = 0, noteRef } = props;
  const s = d.stops.find((x) => x.stop === ui.stop) ?? d.stops[0]!;
  const caret = STOPS.findIndex((x) => x.id === s.stop);
  if (ui.doc) return <DocInside d={d} ui={ui} set={set} timeZone={timeZone} />;
  const busy = (k: string) => acts.busy === k;
  return (
    <div className="ia" data-idea={d.key} data-stop={ui.stop} data-state={d.state} style={{ "--sc": PEDIDO_TONE[d.state] } as CSSProperties}>
      <div className="ia-headrow">
        {acts.onBack && (
          <button type="button" className="edi-fi-back" onClick={acts.onBack} data-control="ficha-volver">
            ← {from}
          </button>
        )}
        <span className="ia-crumb">
          <span className="edi-pd-key">{d.key}</span>
          {d.pedido && <span className="edi-pd-chip">Dándole forma</span>}
          {d.unseen > 0 && (
            <span className="ia-unseen">
              {d.unseen} {d.unseen === 1 ? "entrega sin ver" : "entregas sin ver"}
            </span>
          )}
        </span>
        <span className="ia-seg" role="tablist" aria-label="Vista de la idea">
          <button type="button" role="tab" aria-selected={ui.sub === "entregas"} onClick={() => set({ sub: "entregas" })} data-control="idea-entregas">
            Entregas
          </button>
          <button type="button" role="tab" aria-selected={ui.sub === "recorrido"} onClick={() => set({ sub: "recorrido" })} data-control="idea-recorrido">
            Recorrido<small>{d.trail.length}</small>
          </button>
        </span>
      </div>
      <h3 className="ia-title" title={d.summary || d.title}>
        {d.summary || d.title}
      </h3>
      {d.question && open(d) ? (
        <div className="edi-pd-ask ia-ask-po" data-question={d.question.id}>
          <b>El PO pregunta</b>
          <span>{d.question.text}</span>
          {d.question_options.length > 0 && (
            <span className="edi-pd-opts">
              {d.question_options.map((o) => (
                <button key={o} type="button" className="edi-btn" disabled={busy("answer")} onClick={() => acts.onAnswer?.(d.question!.id, o)} data-control="pedido-opcion">
                  {o}
                </button>
              ))}
            </span>
          )}
          <form
            className="edi-pd-row"
            onSubmit={(e) => {
              e.preventDefault();
              if (ui.answer.trim() && !busy("answer")) acts.onAnswer?.(d.question!.id, ui.answer.trim());
            }}
          >
            <label htmlFor={`ia-resp-${d.key}`} className="edi-sr">
              Tu respuesta
            </label>
            <input id={`ia-resp-${d.key}`} type="text" autoComplete="off" placeholder="Contesta aquí…" value={ui.answer} maxLength={1000} onChange={(e) => set({ answer: e.target.value })} />
            <button type="submit" className="edi-btn" disabled={!ui.answer.trim() || busy("answer")} data-control="pedido-contestar">
              {busy("answer") ? "…" : "Contestar"}
            </button>
          </form>
        </div>
      ) : (
        <p className="ia-asked">
          {d.pedido ? (
            <>
              <b>Tú, {whenOf(d.at, now, timeZone)}:</b> «{d.text}»
            </>
          ) : (
            d.title
          )}
        </p>
      )}
      <Rail d={d} ui={ui} set={set} timeZone={timeZone} />
      {ui.sub === "recorrido" ? (
        <div className="ia-drawer ia-drawer-trail">
          <Trail d={d} set={set} now={now} timeZone={timeZone} acts={acts} />
        </div>
      ) : (
        <div className="ia-drawer" style={{ "--caret": `calc((100% - 14px) * ${(caret + 0.5) / 6})` } as CSSProperties}>
          <Drawer {...props} />
          <AnswerBar d={d} ui={ui} set={set} acts={acts} />
        </div>
      )}
      <div className="ia-foot">
        {d.promoted_to ? (
          <div className="edi-pd-acts">
            {acts.onTrack && (
              <button type="button" className="edi-btn" onClick={() => acts.onTrack!(d.promoted_to!)} data-control="pedido-iniciativa">
                Ver {d.promoted_to} en el tablero
              </button>
            )}
          </div>
        ) : d.status !== "Open" ? (
          <p className="ia-p ia-mute">Cerrada.</p>
        ) : (
          <>
            {acts.onNote && (
              <form
                className="edi-pd-row"
                onSubmit={(e) => {
                  e.preventDefault();
                  if ((ui.note.trim().length >= 2 || pending > 0) && !busy("note")) acts.onNote?.(ui.note.trim().length >= 2 ? ui.note.trim() : pending === 1 ? "Añadí una imagen." : `Añadí ${pending} imágenes.`);
                }}
              >
                <label htmlFor={`ia-nota-${d.key}`} className="edi-sr">
                  Añade algo a esta idea
                </label>
                <textarea id={`ia-nota-${d.key}`} ref={noteRef} rows={1} placeholder={d.pedido ? "Añade algo para el equipo o pega una imagen…" : "Añade algo para el equipo…"} value={ui.note} maxLength={1000} onChange={(e) => set({ note: e.target.value })} />
                <button type="submit" className="edi-btn" disabled={(ui.note.trim().length < 2 && pending === 0) || busy("note")} data-control="pedido-nota">
                  {busy("note") ? "…" : "Añadir"}
                </button>
              </form>
            )}
            {d.pedido && (
              <div className="edi-pd-acts">
                {d.guardada ? (
                  <button type="button" className="edi-btn edi-btn-primary" disabled={busy("restaurar")} onClick={() => acts.onRestaurar?.()} data-control="pedido-restaurar">
                    Volver al tubo
                  </button>
                ) : (
                  <>
                    {acts.onConstruir && (
                      <button type="button" className="edi-btn edi-btn-primary" disabled={busy("construir") || d.state === "valvula"} onClick={() => acts.onConstruir!()} data-control="pedido-construir">
                        {d.state === "valvula" ? "Pasando la válvula…" : "Constrúyelo"}
                      </button>
                    )}
                    <button type="button" className="edi-btn" disabled={busy("guardar") || d.state === "valvula"} onClick={() => acts.onGuardar?.()} data-control="pedido-guardar">
                      Guardar
                    </button>
                  </>
                )}
                <button
                  type="button"
                  className="edi-btn edi-pd-drop"
                  data-confirm={ui.confirmDrop ? "" : undefined}
                  disabled={busy("descartar") || d.state === "valvula"}
                  onClick={() => {
                    if (!ui.confirmDrop) return set({ confirmDrop: true });
                    set({ confirmDrop: false });
                    acts.onDescartar?.();
                  }}
                  onBlur={() => set({ confirmDrop: false })}
                  data-control="pedido-descartar"
                >
                  {ui.confirmDrop ? "¿Seguro? Descartar" : "Descartar"}
                </button>
              </div>
            )}
          </>
        )}
        {noteImages && <div className="edi-ask-imgs ia-imgs">{noteImages}</div>}
      </div>
      {ui.mesa && d.frames.length > 0 && <Mesa d={d} ui={ui} set={set} acts={acts} />}
    </div>
  );
};

// What is open and typed, per idea; a new key starts clean. Opening a delivered stop tells Plania it was seen.
export const IdeaTab = (props: { d: IdeaDetail; now: number; timeZone?: string; acts: IdeaActs; from: string }) => {
  const { d } = props;
  const [ui, setUi] = useState<IdeaUi>(() => initialUi(d));
  const set = (p: Partial<IdeaUi>) => setUi((u) => ({ ...u, ...p }));
  const [files, setFiles] = useState<File[]>([]);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const told = useRef(new Set<string>());
  useEffect(() => {
    setUi(initialUi(d));
    setFiles([]);
    told.current = new Set();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.key]);
  // A sent answer, note or reply shows on the next read: clear what was typed then.
  const [trailN, setTrailN] = useState(d.trail.length);
  useEffect(() => {
    if (d.trail.length > trailN) setUi((u) => ({ ...u, note: "", answer: "", text: "", asking: false, pins: [], mesa: false }));
    setTrailN(d.trail.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.trail.length]);
  const s = d.stops.find((x) => x.stop === ui.stop);
  const shown = ui.sub === "entregas" && s?.delivered && !s.seen && s.stop !== "buzon";
  useEffect(() => {
    if (!shown || !props.acts.onVisto) return;
    const k = `${d.key}:${ui.stop}:${s?.at}`;
    if (told.current.has(k)) return;
    told.current.add(k);
    props.acts.onVisto(ui.stop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, ui.stop, d.key]);
  const acts: IdeaActs = {
    ...props.acts,
    onNote: props.acts.onNote
      ? (text) => {
          props.acts.onNote!(text, files);
          setFiles([]);
        }
      : undefined,
  };
  const noteImages = d.pedido && props.acts.onNote ? <ImageDrop files={files} onChange={setFiles} textarea={noteRef} stored={d.pictures.length} disabled={props.acts.busy === "note"} /> : undefined;
  return <IdeaView {...props} acts={acts} ui={ui} set={set} noteImages={noteImages} pending={files.length} noteRef={noteRef} />;
};
