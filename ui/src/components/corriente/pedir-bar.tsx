// PLA-I62-2: the Pedir bar at the foot of La corriente: the project, the words, the three modes and Pedir (the stream's
// one white button). It sends through the route /ceo's ask box uses (POST /api/company/projects/:slug/ask). A question
// (Preguntar) is answered on the Pedir page, where the thread lives; pictures are added there too.
import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import type { AskResult, OrgProject } from "@/lib/api";
import { ASK_MAX, modesOf, type AskInput, type AskMode } from "@/lib/corriente";
import { askedLine } from "@/lib/edificio";
import { words } from "@/lib/i18n";
import { PEDIR } from "@/lib/pedir-words";
import { Btn, Label, Opt } from "./parts";

// PLA-I2-10: the ask modes in the screen's language (fixed for the page load).
const MODES = modesOf();

// PLA-67: «Ver la respuesta» opens the question just asked, not the Pedir page in general.
const withQuestion = (to: string, id: string | undefined): string => (id ? `${to}${to.includes("?") ? "&" : "?"}pregunta=${encodeURIComponent(id)}` : to);

export const PedirBar = ({
  projects,
  initial,
  disabled,
  onAsk,
  pedirTo,
  fixed,
  primary = true,
}: {
  projects: OrgProject[];
  /** PLA-I64-5: the bar at the foot of one project: no project picker, «Pedir a <proyecto>». */
  fixed?: OrgProject;
  /** Pedir is white unless something on the screen waits on the owner (one white button per screen). */
  primary?: boolean;
  initial?: string | null;
  disabled?: boolean;
  onAsk: (slug: string, input: AskInput) => Promise<AskResult>;
  /** The Pedir page for this project (pictures, past questions, the answer to a question). */
  pedirTo: (slug: string) => string;
}) => {
  const w = words(PEDIR);
  const live = fixed ? [fixed] : projects.filter((p) => !p.paused && p.light !== "paused");
  const held = !!fixed && fixed.paused;
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
      setSaid(mode === "pregunta" ? { text: w.askedPo(project.title), to: withQuestion(pedirTo(project.slug), r.consulta) } : { text: askedLine(r, project.title), to: null });
      setText("");
      setMode("forma");
    } catch {
      setError(w.sendFailed);
    } finally {
      setSending(false);
    }
  };
  const line = MODES.find((m) => m.id === mode)?.line ?? "";
  return (
    <form className="cor-pedir" onSubmit={(e) => void submit(e)} aria-label={w.pedir} data-pedir-bar>
      <Label as="span" className="cor-pedir-label">
        {fixed ? w.pedirA(fixed.title) : w.pedir}
      </Label>
      {!fixed && (
        <>
          <label className="sr-only" htmlFor="cor-pedir-p">
            {w.project}
          </label>
          <select id="cor-pedir-p" className="cor-select" value={slug} onChange={(e) => setSlug(e.target.value)} disabled={disabled || !live.length}>
            {live.map((p) => (
              <option key={p.slug} value={p.slug}>
                {p.title}
              </option>
            ))}
          </select>
        </>
      )}
      <label className="sr-only" htmlFor="cor-pedir-t">
        {w.whatYouAsk}
      </label>
      <input
        id="cor-pedir-t"
        className="cor-input cor-pedir-text"
        value={text}
        maxLength={ASK_MAX}
        placeholder={held ? w.pausedPlaceholder : w.placeholder}
        onChange={(e) => setText(e.target.value)}
        disabled={disabled || held || !project}
        aria-describedby="cor-pedir-line"
        data-pedir-text
      />
      <span className="cor-seg" role="group" aria-label={w.howShort}>
        {MODES.map((m) => (
          <Opt key={m.id} on={mode === m.id} onClick={() => setMode(m.id)} title={m.line} data-mode={m.id} disabled={held}>
            {m.name}
          </Opt>
        ))}
      </span>
      <Btn kind={primary ? "primary" : "secondary"} type="submit" disabled={disabled || held || !project || !text.trim() || sending} data-pedir-send>
        {sending ? w.sending : mode === "pregunta" ? w.ask : w.pedir}
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
                    {w.seeAnswer}
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
