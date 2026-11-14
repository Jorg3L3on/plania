// PLA-I39-7: asking from the floor. One box "Pide algo para <proyecto>", one button Pedir and a switch "Que empiece
// ya" (now: true wakes the PO; it does not reorder). No kind picker: the ask route takes kind as optional. While the
// box has text the PO's window says "Recibiría tu pedido" (onTyping). After sending, the plate says where it landed.
// AskView is pure (tests call its handlers); AskBox holds the text and the result.
// The floor shows only a Pedir button; the box opens in the side page, the way Asistente opens. A send closes it and
// the plate keeps the line that says where it landed.
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { AskResult, OrgProject } from "@/lib/api";
import { askedLine } from "@/lib/edificio";
import { SidePage } from "./side";

export type AskInput = { text: string; now: boolean };

export const AskView = ({
  project: p,
  text,
  setText,
  now,
  setNow,
  sending,
  sent,
  error,
  onSubmit,
  disabled,
  autoFocus,
}: {
  project: OrgProject;
  text: string;
  setText: (v: string) => void;
  now: boolean;
  setNow: (v: boolean) => void;
  sending?: boolean;
  sent?: string | null;
  error?: string | null;
  onSubmit: (input: AskInput) => void;
  disabled?: boolean;
  autoFocus?: boolean;
}) => {
  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (text.trim().length < 3 || sending || disabled) return;
    onSubmit({ text: text.trim(), now });
  };
  return (
    <form className="edi-ask" onSubmit={submit} data-ask={p.slug}>
      <label htmlFor={`ask-${p.slug}`} className="edi-sr">
        Pide algo para {p.title}
      </label>
      <span className="edi-ask-row">
        <input
          id={`ask-${p.slug}`}
          type="text"
          autoComplete="off"
          placeholder={`Pide algo para ${p.title}…`}
          value={text}
          maxLength={500}
          disabled={disabled}
          autoFocus={autoFocus}
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" className="edi-btn edi-btn-primary" disabled={disabled || sending || text.trim().length < 3} data-control="pedir">
          {sending ? "…" : "Pedir"}
        </button>
      </span>
      <label className="edi-now">
        <input type="checkbox" checked={now} disabled={disabled} onChange={(e) => setNow(e.target.checked)} data-control="que-empiece-ya" />
        Que empiece ya
      </label>
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
}: {
  project: OrgProject;
  prefill?: string;
  onAsk: (slug: string, input: AskInput) => Promise<AskResult>;
  onTyping?: (slug: string, typing: boolean) => void;
  disabled?: boolean;
  wide?: boolean;
}) => {
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const [text, setTextState] = useState(prefill ?? "");
  const [now, setNow] = useState(false);
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
      setNow(false);
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
        className="edi-btn edi-btn-primary"
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
        description="Lo recibe el PO y lo vuelve trabajo."
        onClose={() => setOpen(false)}
        returnTo={() => opener.current}
      >
        <AskView project={project} text={text} setText={setText} now={now} setNow={setNow} sending={sending} error={error} onSubmit={(i) => void onSubmit(i)} disabled={disabled} autoFocus />
      </SidePage>
    </div>
  );
};
