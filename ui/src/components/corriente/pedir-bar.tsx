// PLA-I62-2: the Pedir bar at the foot of La corriente: the project, the words, the three modes and Pedir (the stream's
// one white button). It sends through the route /ceo's ask box uses (POST /api/company/projects/:slug/ask). A question
// (Preguntar) is answered on the Pedir page, where the thread lives; pictures are added there too.
import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import type { AskResult, OrgProject } from "@/lib/api";
import { ASK_MAX, MODES, type AskInput, type AskMode } from "@/lib/corriente";
import { askedLine } from "@/lib/edificio";
import { Btn, Label, Opt } from "./parts";

export const PedirBar = ({
  projects,
  initial,
  disabled,
  onAsk,
  pedirTo,
}: {
  projects: OrgProject[];
  initial?: string | null;
  disabled?: boolean;
  onAsk: (slug: string, input: AskInput) => Promise<AskResult>;
  /** The Pedir page for this project (pictures, past questions, the answer to a question). */
  pedirTo: (slug: string) => string;
}) => {
  const live = projects.filter((p) => !p.paused && p.light !== "paused");
  const [slug, setSlug] = useState<string>(initial && live.some((p) => p.slug === initial) ? initial : (live[0]?.slug ?? ""));
  const [text, setText] = useState("");
  const [mode, setMode] = useState<AskMode>("forma");
  const [sending, setSending] = useState(false);
  const [said, setSaid] = useState<{ text: string; to: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const project = live.find((p) => p.slug === slug) ?? null;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!project || !text.trim() || sending) return;
    setSending(true);
    setError(null);
    try {
      const r = await onAsk(project.slug, { text: text.trim().slice(0, ASK_MAX), mode });
      setSaid(mode === "pregunta" ? { text: `Se lo preguntaste al PO de ${project.title}. Lee el código y contesta.`, to: pedirTo(project.slug) } : { text: askedLine(r, project.title), to: null });
      setText("");
      setMode("forma");
    } catch {
      setError("No se pudo enviar. Si la Mac está dormida, intenta al despertar.");
    } finally {
      setSending(false);
    }
  };
  const line = MODES.find((m) => m.id === mode)?.line ?? "";
  return (
    <form className="cor-pedir" onSubmit={(e) => void submit(e)} aria-label="Pedir" data-pedir-bar>
      <Label as="span" className="cor-pedir-label">
        Pedir
      </Label>
      <label className="sr-only" htmlFor="cor-pedir-p">
        Proyecto
      </label>
      <select id="cor-pedir-p" className="cor-select" value={slug} onChange={(e) => setSlug(e.target.value)} disabled={disabled || !live.length}>
        {live.map((p) => (
          <option key={p.slug} value={p.slug}>
            {p.title}
          </option>
        ))}
      </select>
      <label className="sr-only" htmlFor="cor-pedir-t">
        Lo que pides
      </label>
      <input
        id="cor-pedir-t"
        className="cor-input cor-pedir-text"
        value={text}
        maxLength={ASK_MAX}
        placeholder="Pide algo…"
        onChange={(e) => setText(e.target.value)}
        disabled={disabled || !project}
        aria-describedby="cor-pedir-line"
        data-pedir-text
      />
      <span className="cor-seg" role="group" aria-label="Cómo">
        {MODES.map((m) => (
          <Opt key={m.id} on={mode === m.id} onClick={() => setMode(m.id)} title={m.line} data-mode={m.id}>
            {m.name}
          </Opt>
        ))}
      </span>
      <Btn kind="primary" type="submit" disabled={disabled || !project || !text.trim() || sending} data-pedir-send>
        {sending ? "Enviando…" : "Pedir"}
      </Btn>
      <span id="cor-pedir-line" className="sr-only">
        {line}
      </span>
      <p className="cor-pedir-said" role="status" aria-live="polite" data-pedir-said={error ? "error" : said && !text ? "ok" : undefined}>
        {error ? (
          <span className="cor-state bad">{error}</span>
        ) : (
          said &&
          !text && (
            <>
              ✓ {said.text}
              {said.to && (
                <>
                  {" "}
                  <Link to={said.to} className="cor-inline">
                    Ver la respuesta
                  </Link>
                </>
              )}
            </>
          )
        )}
      </p>
    </form>
  );
};
