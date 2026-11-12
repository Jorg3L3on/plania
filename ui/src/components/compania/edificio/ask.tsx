// PLA-I39-7: asking from the floor. One box "Pide algo para <proyecto>", one button Pedir and a switch "Que empiece
// ya" (now: true wakes the PO; it does not reorder). No kind picker: the ask route takes kind as optional. While the
// box has text the PO's window says "Recibiría tu pedido" (onTyping). After sending, the plate says where it landed.
// AskView is pure (tests call its handlers); AskBox holds the text and the result.
import { useEffect, useState, type FormEvent } from "react";
import type { AskResult, OrgProject } from "@/lib/api";
import { askedLine } from "@/lib/edificio";

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
}: {
  project: OrgProject;
  prefill?: string;
  onAsk: (slug: string, input: AskInput) => Promise<AskResult>;
  onTyping?: (slug: string, typing: boolean) => void;
  disabled?: boolean;
}) => {
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
    if (prefill) setText(prefill);
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
    } catch {
      setError("No se pudo enviar. Si la Mac está dormida, intenta al despertar.");
    } finally {
      setSending(false);
    }
  };
  return <AskView project={project} text={text} setText={setText} now={now} setNow={setNow} sending={sending} sent={sent} error={error} onSubmit={(i) => void onSubmit(i)} disabled={disabled} />;
};
