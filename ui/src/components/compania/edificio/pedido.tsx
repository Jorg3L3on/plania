// PLA-I54-3 (Pedidos con recorrido): La ficha's «Pedido» tab. A capsule in the tube opens here: its key, mode and
// stop, the line that says who has it, the PO's open question with an answer box (the screen's answer route),
// Recorrido (the idea's events, docs and questions) and Ficha de la idea (Problema, Tamaño, Solución, Riesgos, Fuera,
// «Pendiente» where empty), a note box (the PO reads it on its next run), Guardar / Volver al tubo, and Descartar
// (two clicks). PLA-I54-4: «Constrúyelo» (the primary button, from any stop; while the PO promotes it the button
// says «Pasando la válvula…»), and a promoted request points to its initiative on the board. The pictures' slots (the trail's thumbnails, the note box's picker) are
// marked data-slot for F5.
// PedidoView is pure (tests call its handlers); PedidoTab holds what is typed and which sub-tab is open.
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import type { OrgPedido, PedidoDetail, PedidoTrailItem } from "@/lib/api";
import { ImageDrop, Thumbs } from "./image-drop";
import { roleName } from "@/lib/org";
import { PEDIDO_TONE, pedidoWord, stopName } from "./tubo";

export type PedidoActs = {
  onAnswer?: (questionId: string, text: string) => void;
  // PLA-I54-5: files are the note box's pictures, stored after the note so they hang under it in the trail.
  onNote?: (text: string, files?: File[]) => void;
  onGuardar?: () => void;
  onRestaurar?: () => void;
  onDescartar?: () => void;
  // PLA-I54-4.
  onConstruir?: () => void;
  onDoc?: (id: string) => void;
  // A promoted request: its initiative on the board, opened in La ficha.
  onTrack?: (key: string) => void;
  // The key of the action running ("answer", "note", "guardar", "restaurar", "descartar", "construir").
  busy?: string | null;
};
// PLA-I54-5: what F5 mounts in the note box (ImageDrop) and in a trail item (thumbnails).
export type PedidoSlots = { noteImages?: ReactNode; trailImages?: (item: PedidoTrailItem, i: number) => ReactNode };

const PITCH: { id: keyof PedidoDetail["ficha"]; name: string }[] = [
  { id: "problema", name: "Problema" },
  { id: "tamano", name: "Tamaño" },
  { id: "solucion", name: "Solución" },
  { id: "riesgos", name: "Riesgos" },
  { id: "fuera", name: "Fuera" },
];

export const whoWord = (who: string) => (who === "jorge" ? "Tú" : who === "product-owner" ? "PO" : who === "plania" ? "Plania" : roleName(who));

// The line under the title: who has it and what it waits on, in plain words.
export function pedidoLine(x: Pick<OrgPedido, "state" | "stop" | "who" | "guardada">): string {
  if (x.guardada) return "Guardada. Nadie la trabaja.";
  if (x.state === "espera") return "El PO no sigue hasta que contestes.";
  if (x.state === "valvula") return "Pasando la válvula: el PO termina lo que falta y crea la iniciativa.";
  if (x.state === "trabajando") return `${x.who === "product-owner" ? "El PO" : roleName(x.who)} la trabaja ahora.`;
  if (x.state === "cola") return "En el buzón. El PO la abre en su turno.";
  if (x.stop === "lista") return "Tiene forma. No sube al tablero hasta que digas «Constrúyelo».";
  return `Quieta en ${stopName(x.stop)}.`;
}

const timeOf = (iso: string, now: number, timeZone?: string) => {
  const d = new Date(iso);
  const day = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", timeZone }).format(d);
  const today = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", timeZone }).format(new Date(now));
  const hm = new Intl.DateTimeFormat("es-MX", { hour: "numeric", minute: "2-digit", hour12: false, timeZone }).format(d);
  return day === today ? hm : `${day} ${hm}`;
};

export type PedidoViewProps = {
  d: PedidoDetail;
  now: number;
  timeZone?: string;
  acts: PedidoActs;
  slots?: PedidoSlots;
  sub: "recorrido" | "ficha";
  setSub: (s: "recorrido" | "ficha") => void;
  answer: string;
  setAnswer: (s: string) => void;
  note: string;
  setNote: (s: string) => void;
  confirmDrop: boolean;
  setConfirmDrop: (b: boolean) => void;
  // PLA-I54-5: pictures chosen in the note box (they can go alone), and the box they are pasted into.
  pending?: number;
  noteRef?: RefObject<HTMLTextAreaElement | null>;
};

// PLA-I54-5: each picture hangs under the owner's trail item it was sent with: the last one of his at or before the
// picture's time (pictures go up right after the request or the note), else the first item.
export function picturesByItem(trail: readonly PedidoTrailItem[], pictures: PedidoDetail["pictures"]): Map<number, PedidoDetail["pictures"]> {
  const out = new Map<number, PedidoDetail["pictures"]>();
  for (const pic of pictures) {
    let at = 0;
    trail.forEach((e, i) => {
      if (e.who === "jorge" && Date.parse(e.at) <= Date.parse(pic.at) && Date.parse(e.at) >= Date.parse(trail[at]!.at)) at = i;
    });
    out.set(at, [...(out.get(at) ?? []), pic]);
  }
  return out;
}
export const imageNote = (n: number) => (n === 1 ? "Añadí una imagen." : `Añadí ${n} imágenes.`);

export const PedidoView = ({ d, now, timeZone, acts, slots = {}, sub, setSub, answer, setAnswer, note, setNote, confirmDrop, setConfirmDrop, pending = 0, noteRef }: PedidoViewProps) => {
  const up = !!d.promoted_to;
  const closed = d.status !== "Open";
  const where = up ? "En el tablero" : closed ? "Descartada" : d.guardada ? "Guardada" : stopName(d.stop);
  const sendAnswer = (text: string) => {
    if (!d.question || !text.trim() || acts.busy === "answer") return;
    acts.onAnswer?.(d.question.id, text.trim());
  };
  const busy = (k: string) => acts.busy === k;
  return (
    <div className="edi-pd" data-pedido={d.key} data-state={d.state} style={{ "--sc": PEDIDO_TONE[d.state] } as React.CSSProperties}>
      <div className="edi-pd-kv">
        <span className="edi-pd-key">{d.key}</span>
        <span className="edi-pd-chip">Dándole forma</span>
        <span className="edi-pd-chip" data-where>
          {where}
        </span>
        {!up && !closed && (
          <span className="edi-pd-state">
            <i aria-hidden />
            {pedidoWord(d)}
          </span>
        )}
      </div>
      <h3 className="edi-pd-title">{d.title}</h3>
      <p className="edi-pd-line">{up ? `Ya pasó la válvula: es ${d.promoted_to}. Su avance sigue en el tablero.` : closed ? "Descartada. No vuelve al tubo." : pedidoLine(d)}</p>
      {d.question && !up && !closed && (
        <div className="edi-pd-ask" data-question={d.question.id}>
          <b>El PO pregunta</b>
          <span>{d.question.text}</span>
          {d.question_options.length > 0 && (
            <span className="edi-pd-opts">
              {d.question_options.map((o) => (
                <button key={o} type="button" className="edi-btn" disabled={busy("answer")} onClick={() => sendAnswer(o)} data-control="pedido-opcion">
                  {o}
                </button>
              ))}
            </span>
          )}
          <form
            className="edi-pd-row"
            onSubmit={(e) => {
              e.preventDefault();
              sendAnswer(answer);
            }}
          >
            <label htmlFor={`pd-resp-${d.key}`} className="edi-sr">
              Tu respuesta
            </label>
            <input id={`pd-resp-${d.key}`} type="text" autoComplete="off" placeholder="Contesta aquí…" value={answer} maxLength={1000} onChange={(e) => setAnswer(e.target.value)} />
            <button type="submit" className="edi-btn" disabled={!answer.trim() || busy("answer")} data-control="pedido-contestar">
              {busy("answer") ? "…" : "Contestar"}
            </button>
          </form>
        </div>
      )}
      <div className="edi-pd-tabs" role="tablist" aria-label="Pedido">
        {(
          [
            ["recorrido", "Recorrido"],
            ["ficha", "Ficha de la idea"],
          ] as const
        ).map(([id, word]) => (
          <button key={id} type="button" role="tab" id={`pd-tab-${id}`} aria-selected={sub === id} aria-controls="pd-panel" onClick={() => setSub(id)} data-control={`pedido-${id}`}>
            {word}
          </button>
        ))}
      </div>
      <div className="edi-pd-scroll" id="pd-panel" role="tabpanel" aria-labelledby={`pd-tab-${sub}`} tabIndex={0}>
        {sub === "recorrido" ? (
          <ol className="edi-pd-trail" data-trail={d.trail.length}>
            {d.trail.map((e, i) => (
              <li key={i} data-kind={e.kind} data-me={e.who === "jorge" ? "" : undefined}>
                <time dateTime={e.at}>{timeOf(e.at, now, timeZone)}</time>
                <i aria-hidden />
                <div>
                  <b>{whoWord(e.who)}</b> · {e.kind === "pedido" ? <>Lo pediste: «{d.text}»</> : e.text}
                  {e.doc && (
                    <>
                      <br />
                      {acts.onDoc ? (
                        <button type="button" className="edi-pd-doc" onClick={() => acts.onDoc!(e.doc!.id)} data-control="pedido-doc">
                          {e.doc.title}
                        </button>
                      ) : (
                        <span className="edi-pd-doc">{e.doc.title}</span>
                      )}
                    </>
                  )}
                  {/* PLA-I54-5: this item's pictures. */}
                  <span className="edi-pd-thumbs" data-slot="imagenes-recorrido">
                    {slots.trailImages?.(e, i)}
                  </span>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <>
            <dl className="edi-pd-pitch">
              {PITCH.map((x) => (
                <div key={x.id}>
                  <dt>{x.name}</dt>
                  {d.ficha[x.id] ? <dd>{d.ficha[x.id]}</dd> : <dd data-todo>Pendiente</dd>}
                </div>
              ))}
            </dl>
            <p className="edi-pd-sub">La llena el equipo parada por parada. Lo que añadas abajo le llega al PO.</p>
          </>
        )}
      </div>
      <div className="edi-pd-foot">
        {up && acts.onTrack && (
          <div className="edi-pd-acts">
            <button type="button" className="edi-btn" onClick={() => acts.onTrack!(d.promoted_to!)} data-control="pedido-iniciativa">
              Ver {d.promoted_to} en el tablero
            </button>
          </div>
        )}
        {up || closed ? null : (
          <>
            <form
              className="edi-pd-row"
              onSubmit={(e) => {
                e.preventDefault();
                if ((note.trim().length >= 2 || pending > 0) && !busy("note")) acts.onNote?.(note.trim().length >= 2 ? note.trim() : imageNote(pending));
              }}
            >
              <label htmlFor={`pd-nota-${d.key}`} className="edi-sr">
                Añade algo a esta idea
              </label>
              <textarea id={`pd-nota-${d.key}`} ref={noteRef} rows={1} placeholder="Añade algo o pega una imagen…" value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />
              <button type="submit" className="edi-btn" disabled={(note.trim().length < 2 && pending === 0) || busy("note")} data-control="pedido-nota">
                {busy("note") ? "…" : "Añadir"}
              </button>
            </form>
            {/* PLA-I54-5: the note box's picker. */}
            <div className="edi-ask-imgs" data-slot="imagenes-nota">
              {slots.noteImages}
            </div>
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
                data-confirm={confirmDrop ? "" : undefined}
                disabled={busy("descartar") || d.state === "valvula"}
                onClick={() => {
                  if (!confirmDrop) return setConfirmDrop(true);
                  setConfirmDrop(false);
                  acts.onDescartar?.();
                }}
                onBlur={() => setConfirmDrop(false)}
                data-control="pedido-descartar"
              >
                {confirmDrop ? "¿Seguro? Descartar" : "Descartar"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

// The state of what is typed, per open request. A new key starts clean.
export const PedidoTab = (props: { d: PedidoDetail; now: number; timeZone?: string; acts: PedidoActs; slots?: PedidoSlots }) => {
  const [sub, setSub] = useState<"recorrido" | "ficha">("recorrido");
  const [answer, setAnswer] = useState("");
  const [note, setNote] = useState("");
  const [confirmDrop, setConfirmDrop] = useState(false);
  const [trailN, setTrailN] = useState(props.d.trail.length);
  // PLA-I54-5: the note box's pictures. They go up after the note, so they hang under it in the trail.
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  useEffect(() => {
    setAnswer("");
    setNote("");
    setConfirmDrop(false);
    setFiles([]);
  }, [props.d.key]);
  // What was sent shows in the trail on the next read: clear the box then.
  useEffect(() => {
    if (props.d.trail.length > trailN) {
      setNote("");
      setAnswer("");
    }
    setTrailN(props.d.trail.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.d.trail.length]);
  const d = props.d;
  const byItem = picturesByItem(d.trail, d.pictures ?? []);
  const acts: PedidoActs = {
    ...props.acts,
    onNote: props.acts.onNote
      ? (text) => {
          props.acts.onNote!(text, files);
          setFiles([]);
        }
      : undefined,
  };
  const slots: PedidoSlots = {
    trailImages: (_e, i) => (byItem.get(i)?.length ? <Thumbs images={byItem.get(i)!} /> : null),
    noteImages: props.acts.onNote ? <ImageDrop files={files} onChange={setFiles} textarea={noteRef} stored={(d.pictures ?? []).length} disabled={props.acts.busy === "note"} /> : undefined,
    ...props.slots,
  };
  return <PedidoView {...props} acts={acts} slots={slots} pending={files.length} noteRef={noteRef} sub={sub} setSub={setSub} answer={answer} setAnswer={setAnswer} note={note} setNote={setNote} confirmDrop={confirmDrop} setConfirmDrop={setConfirmDrop} />;
};
