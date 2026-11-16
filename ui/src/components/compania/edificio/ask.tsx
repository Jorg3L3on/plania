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
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { AskMode, AskResult, OrgProject } from "@/lib/api";
import { askedLine } from "@/lib/edificio";
import { SidePage } from "./side";

export type AskInput = { text: string; mode: AskMode };
export const ASK_MAX = 2000;
export const MODES: { id: AskMode; name: string; line: string }[] = [
  { id: "forma", name: "Darle forma", line: "Entra al tubo como idea. El PO la entiende, pregunta y la avanza. Nadie escribe código hasta que digas «Constrúyelo»." },
  { id: "ya", name: "Hacerlo ya", line: "Un cambio pequeño y claro. Sube directo al tablero, como hoy." },
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
  // PLA-I54-5: the image picker (ImageDrop), wired by the page.
  images?: ReactNode;
}) => {
  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (text.trim().length < 3 || sending || disabled) return;
    onSubmit({ text: text.trim(), mode });
  };
  return (
    <form className="edi-ask" onSubmit={submit} data-ask={p.slug}>
      <label htmlFor={`ask-${p.slug}`} className="edi-sr">
        Pide algo para {p.title}
      </label>
      <textarea
        id={`ask-${p.slug}`}
        className="edi-ask-text"
        rows={4}
        placeholder={`Pide algo para ${p.title}…`}
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
      {/* PLA-I54-1: the pictures' slot. Empty until F5 passes ImageDrop (paste ⌘V, drag, pick). */}
      <div className="edi-ask-imgs" data-slot="imagenes">
        {images}
      </div>
      <fieldset className="edi-modes" disabled={disabled}>
        <legend className="edi-sr">Cómo lo quieres</legend>
        {MODES.map((m) => (
          <label key={m.id} className="edi-mode" data-mode={m.id}>
            <input type="radio" name={`modo-${p.slug}`} value={m.id} checked={mode === m.id} onChange={() => setMode?.(m.id)} data-control={`modo-${m.id}`} />
            <b>{m.name}</b>
            <span>{m.line}</span>
          </label>
        ))}
      </fieldset>
      <button type="submit" className="edi-btn edi-btn-primary" disabled={disabled || sending || text.trim().length < 3} data-control="pedir">
        {sending ? "…" : "Pedir"}
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
}: {
  project: OrgProject;
  prefill?: string;
  onAsk: (slug: string, input: AskInput) => Promise<AskResult>;
  onTyping?: (slug: string, typing: boolean) => void;
  disabled?: boolean;
  wide?: boolean;
  images?: ReactNode;
}) => {
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const [text, setTextState] = useState(prefill ?? "");
  // PLA-I54-1: Darle forma is the default every time the page opens (not remembered per project).
  const [mode, setMode] = useState<AskMode>("forma");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
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
      const r = await onAsk(project.slug, input);
      setSent(askedLine(r, project.title));
      setText("");
      setMode("forma");
      setOpen(false);
    } catch {
      setError("No se pudo enviar. Si la Mac está dormida, intenta al despertar.");
    } finally {
      setSending(false);
    }
  };
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
          setOpen(true);
        }}
        data-control="pedir-abrir"
      >
        Pedir{text.trim() ? " · borrador" : ""}
      </button>
      {sent && (
        <p className="edi-sent" role="status" data-sent>
          ✓ {sent}
        </p>
      )}
      <SidePage
        open={open}
        wide={wide}
        title={`Pedir para ${project.title}`}
        description="Lo recibe el PO. Tú decides si le da forma o lo hace ya."
        onClose={() => setOpen(false)}
        returnTo={() => opener.current}
      >
        <AskView project={project} text={text} setText={setText} mode={mode} setMode={setMode} sending={sending} error={error} onSubmit={(i) => void onSubmit(i)} disabled={disabled} autoFocus images={images} />
      </SidePage>
    </div>
  );
};
