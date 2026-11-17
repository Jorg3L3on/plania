// PLA-I39-7: asking from the floor. One box "Pide algo para <proyecto>" and one button Pedir. No kind picker: the ask route takes kind as optional. While the
// box has text the PO's window says "Recibiría tu pedido" (onTyping). After sending, the plate says where it landed.
// AskView is pure (tests call its handlers); AskBox holds the text and the result.
// The floor shows only a Pedir button; the box opens in the side page, the way Asistente opens. A send closes it and
// the plate keeps the line that says where it landed. PLA-I46-4: Pedir is a secondary button: the floor's one main
// button is its move.
// PLA-I54-1 (Pedidos con recorrido): the side page has a textarea (2000) and two modes in place of «Que empiece ya»:
// Darle forma (the default; an idea in the floor's tube that the PO shapes, no code until «Constrúyelo») and Hacerlo ya
// (the Ready ticket plus the wake). Between the two sits the slot for the pictures (data-slot="imagenes"): F2's ImageDrop
// goes there through the images prop, and onAsk's reply carries the new key to upload them to.
import { useEffect, useRef, useState, type FormEvent, type ReactNode, type RefObject } from "react";
import { uploadPedidoImages, type AskMode, type AskResult, type OrgProject } from "@/lib/api";
import { ImageDrop } from "./image-drop";
import { askedLine } from "@/lib/edificio";
import { SidePage } from "./side";
import { ConsultaHistory, ConsultaThread, pending, useConsultas } from "./consulta";

// PLA-I57-1: consulta, when the request came from an answer («Pedirlo»): the answer travels with it.
export type AskInput = { text: string; mode: AskMode; consulta?: string };
export const ASK_MAX = 2000;
export const MODES: { id: AskMode; name: string; line: string }[] = [
  { id: "forma", name: "Darle forma", line: "Entra al tubo como idea. El PO la entiende, pregunta y la avanza. Nadie escribe código hasta que digas «Constrúyelo»." },
  { id: "ya", name: "Hacerlo ya", line: "Un cambio pequeño y claro. Sube directo al tablero, como hoy." },
  // PLA-I57-1: a question; nothing is created.
  { id: "pregunta", name: "Preguntar", line: "Solo quieres saber algo. El PO lee el código y te contesta aquí. No crea idea ni ticket." },
];

export const AskView = ({
  project: p,
  text,
  setText,
  mode = "forma",
  setMode,
  sending,
  sent,
  error,
  onSubmit,
  disabled,
  autoFocus,
  images,
  textRef,
  fromAnswer,
  pastCount,
  onPast,
}: {
  project: OrgProject;
  text: string;
  setText: (v: string) => void;
  mode?: AskMode;
  setMode?: (v: AskMode) => void;
  sending?: boolean;
  sent?: string | null;
  error?: string | null;
  onSubmit: (input: AskInput) => void;
  disabled?: boolean;
  autoFocus?: boolean;
  // PLA-I54-5: the image picker (ImageDrop), and the text box it listens to for ⌘V.
  images?: ReactNode;
  textRef?: RefObject<HTMLTextAreaElement | null>;
  // PLA-I57-1: the request carries an answer (Pedirlo); how many past questions; open them.
  fromAnswer?: boolean;
  pastCount?: number;
  onPast?: () => void;
}) => {
  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (text.trim().length < 3 || sending || disabled) return;
    onSubmit({ text: text.trim(), mode });
  };
  return (
    <form className="edi-ask" onSubmit={submit} data-ask={p.slug}>
      {fromAnswer && (
        <p className="edi-cq-from" data-from-answer>
          Viene de tu pregunta. <b>La respuesta va adjunta para el PO.</b>
        </p>
      )}
      <label htmlFor={`ask-${p.slug}`} className="edi-sr">
        Pide algo para {p.title}
      </label>
      <textarea
        id={`ask-${p.slug}`}
        ref={textRef}
        className="edi-ask-text"
        rows={4}
        placeholder={mode === "pregunta" ? `Pregunta lo que quieras de ${p.title}…` : `Pide algo para ${p.title}…`}
        value={text}
        maxLength={ASK_MAX}
        disabled={disabled}
        autoFocus={autoFocus}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
        }}
        data-control="pedir-texto"
      />
      {/* PLA-I54-5: the pictures: ImageDrop (paste ⌘V, drag, pick). */}
      <div className="edi-ask-imgs" data-slot="imagenes">
        {images}
      </div>
      <fieldset className="edi-modes" disabled={disabled}>
        <legend className="edi-sr">Cómo lo quieres</legend>
        {MODES.map((m) => (
          <label key={m.id} className="edi-mode" data-mode={m.id} data-new={m.id === "pregunta" ? "" : undefined}>
            <input type="radio" name={`modo-${p.slug}`} value={m.id} checked={mode === m.id} onChange={() => setMode?.(m.id)} data-control={`modo-${m.id}`} />
            <b>{m.name}</b>
            <span>{m.line}</span>
          </label>
        ))}
      </fieldset>
      {onPast && (
        <p className="edi-cq-past">
          <span>{mode === "pregunta" ? "Preguntar no deja nada en el tablero ni en el tubo." : ""}</span>
          <button type="button" className="edi-cq-fold" onClick={onPast} data-control="preguntas-anteriores">
            Preguntas anteriores{pastCount ? ` · ${pastCount}` : ""}
          </button>
        </p>
      )}
      <button type="submit" className="edi-btn edi-btn-primary" disabled={disabled || sending || text.trim().length < 3} data-control="pedir">
        {sending ? "…" : mode === "pregunta" ? "Preguntar" : "Pedir"}
      </button>
      {sent && (
        <p className="edi-sent" role="status" data-sent>
          ✓ {sent}
        </p>
      )}
      {error && <p className="edi-warn">{error}</p>}
    </form>
  );
};

export const AskBox = ({
  project,
  prefill,
  onAsk,
  onTyping,
  disabled,
  wide = true,
  images,
  onPictures,
}: {
  project: OrgProject;
  prefill?: string;
  onAsk: (slug: string, input: AskInput) => Promise<AskResult>;
  onTyping?: (slug: string, typing: boolean) => void;
  disabled?: boolean;
  wide?: boolean;
  images?: ReactNode;
  // PLA-I54-5: called once the request's pictures are stored, so the floor reads their count.
  onPictures?: (slug: string) => void;
}) => {
  const [open, setOpen] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const opener = useRef<HTMLButtonElement>(null);
  const [text, setTextState] = useState(prefill ?? "");
  // PLA-I54-1: Darle forma is the default every time the page opens (not remembered per project).
  const [mode, setMode] = useState<AskMode>("forma");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // PLA-I57-1: what the side page shows (the form, one question's thread, the past questions); the answer a request
  // carries (Pedirlo); the answers already seen, so the bar says «Respuesta lista» once.
  const [view, setView] = useState<"form" | "past" | { id: string }>("form");
  const [fromAnswer, setFromAnswer] = useState<string | null>(null);
  const [seen, setSeen] = useState<Set<string>>(() => new Set());
  const [mine, setMine] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);
  const { list, reload } = useConsultas(project.slug, open || waiting);
  useEffect(() => setWaiting(!!list?.some(pending)), [list]);
  const setText = (v: string) => {
    setTextState(v);
    onTyping?.(project.slug, v.trim().length > 0);
  };
  // The words handed back by Cambiar algo still prefill the box.
  useEffect(() => {
    if (prefill) {
      setText(prefill);
      setOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill]);
  const onSubmit = async (input: AskInput) => {
    setSending(true);
    setError(null);
    try {
      const withAnswer = fromAnswer && input.mode !== "pregunta" ? { ...input, consulta: fromAnswer } : input;
      const r = await onAsk(project.slug, withAnswer);
      // PLA-I57-1: a question keeps the side page open on its thread; it has no key, so no pictures go up.
      if (input.mode === "pregunta" && r.consulta) {
        setFiles([]);
        setText("");
        setMine(r.consulta);
        setView({ id: r.consulta });
        setWaiting(true);
        await reload();
        return;
      }
      // PLA-I54-5: the pictures go up once the request has its key. One that fails does not undo the request.
      let lost: string | null = null;
      if (files.length > 0) {
        const up = await uploadPedidoImages(project.slug, r.key, files);
        if (up.error) lost = typeof up.error.detail.message === "string" ? up.error.detail.message : "inténtalo desde el pedido abierto.";
        onPictures?.(project.slug);
      }
      setFiles([]);
      setSent(askedLine(r, project.title) + (withAnswer.consulta ? " La respuesta va adjunta." : "") + (lost ? ` Pero ${files.length > 1 ? "no todas las imágenes subieron" : "la imagen no subió"}: ${lost}` : ""));
      setText("");
      setMode("forma");
      setFromAnswer(null);
      setOpen(false);
    } catch {
      setError("No se pudo enviar. Si la Mac está dormida, intenta al despertar.");
    } finally {
      setSending(false);
    }
  };
  const ask = (q: string) => void onSubmit({ text: q.slice(0, 2000), mode: "pregunta" });
  const current = typeof view === "object" ? (list?.find((c) => c.id === view.id) ?? null) : null;
  // The question this session asked last: the bar says where it stands until its answer has been seen.
  const last = mine ? (list?.find((c) => c.id === mine) ?? null) : null;
  const chip = last && !open ? (pending(last) ? "El PO lee el código…" : last.answer && !seen.has(last.id) ? "Respuesta lista" : null) : null;
  useEffect(() => {
    if (open && current?.answer && !seen.has(current.id)) setSeen((x) => new Set(x).add(current.id));
  }, [open, current, seen]);
  const po = `PO de ${project.title}`;
  return (
    <div className="edi-ask-open" data-ask-open={project.slug}>
      <button
        ref={opener}
        type="button"
        className="edi-btn"
        disabled={disabled}
        aria-haspopup="dialog"
        onClick={() => {
          setSent(null);
          setView("form");
          setOpen(true);
        }}
        data-control="pedir-abrir"
      >
        Pedir{text.trim() ? " · borrador" : ""}
      </button>
      {chip && (
        <button
          type="button"
          className="edi-cq-chip"
          data-busy={chip !== "Respuesta lista" || undefined}
          onClick={() => {
            setView({ id: last!.id });
            setOpen(true);
          }}
          data-control="consulta-chip"
        >
          <i aria-hidden />
          {chip}
        </button>
      )}
      {sent && (
        <p className="edi-sent" role="status" data-sent>
          ✓ {sent}
        </p>
      )}
      <SidePage
        open={open}
        wide={wide}
        title={view === "form" ? `Pedir para ${project.title}` : view === "past" ? "Preguntas anteriores" : "Tu pregunta"}
        description={view === "form" ? "Lo recibe el PO. Tú decides si le da forma, lo hace ya o solo te contesta." : `Lo que le preguntaste a ${project.title} y lo que contestó el PO.`}
        onClose={() => setOpen(false)}
        returnTo={() => opener.current}
      >
        {view === "past" ? (
          <ConsultaHistory list={list ?? []} onOpen={(id) => setView({ id })} onBack={() => setView("form")} />
        ) : typeof view === "object" && current ? (
          <ConsultaThread
            c={current}
            po={po}
            busy={sending}
            onBack={() => setView("form")}
            onAgain={ask}
            onMore={(q) => ask(`Sobre «${current.text.slice(0, 200)}»: ${q}`)}
            onPedirlo={(fix, m) => {
              setText(fix.slice(0, 2000));
              setMode(m);
              setFromAnswer(current.id);
              setView("form");
            }}
          />
        ) : (
          <AskView
            project={project}
            text={text}
            setText={setText}
            mode={mode}
            setMode={(m) => {
              setMode(m);
              if (m === "pregunta") setFromAnswer(null);
            }}
            sending={sending}
            error={error}
            onSubmit={(i) => void onSubmit(i)}
            disabled={disabled}
            autoFocus
            textRef={textRef}
            fromAnswer={!!fromAnswer && mode !== "pregunta"}
            pastCount={list?.length ?? 0}
            onPast={() => setView("past")}
            images={images ?? <ImageDrop files={files} onChange={setFiles} textarea={textRef} disabled={disabled || sending} />}
          />
        )}
      </SidePage>
    </div>
  );
};
