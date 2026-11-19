// PLA-I62-2: the Pedir bar at the foot of La corriente: the project, the words, the three modes and Pedir (the stream's
// one white button). It sends through the route /ceo's ask box uses (POST /api/company/projects/:slug/ask). A question
// (Preguntar) is answered on the Pedir page, where the thread lives; pictures are added there too.
// PLA-I3-6 «Un solo Pedir»: the bar is the only Pedir in a project. One 56 px container: the modes as a segmented
// choice, the input (its placeholder is the mode's line), the picture button and «Lo pedido» (both open the Pedir
// page), a key hint and the send button. `/` focuses the input, Enter sends, Shift+Tab from the input cycles the mode.
// The confirmation shows inside the container and clears on the next keystroke. Paused: one sentence and «Lo pedido».
// Words and keys: @/lib/corriente.
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Link } from "react-router";
import type { AskResult, OrgProject } from "@/lib/api";
import { ASK_MAX, MODES, PEDIR_ERROR, PEDIR_PAST, PEDIR_PICTURE, nextMode, pedirHeld, pedirKeyHint, pedirPlaceholder, pedirSendLabel, slashFocuses, type AskInput, type AskMode } from "@/lib/corriente";
import { askedLine } from "@/lib/edificio";
import { Btn, Opt } from "./parts";

// PLA-67: «Ver la respuesta» opens the question just asked, not the Pedir page in general.
const withQuestion = (to: string, id: string | undefined): string => (id ? `${to}${to.includes("?") ? "&" : "?"}pregunta=${encodeURIComponent(id)}` : to);

const Icon = ({ children }: { children: React.ReactNode }) => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {children}
  </svg>
);
const Picture = () => (
  <Icon>
    <rect x="2.5" y="3.5" width="13" height="11" rx="2" />
    <circle cx="6.5" cy="7.5" r="1.3" />
    <path d="m3 13 4-4 3 3 2-2 3.5 3.5" />
  </Icon>
);
const Clock = () => (
  <Icon>
    <circle cx="9" cy="9" r="6.5" />
    <path d="M9 5.5V9l2.5 1.5" />
  </Icon>
);
const Check = () => (
  <svg className="cor-pedir-check" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="m3.5 8.5 3 3 6-7" />
  </svg>
);

/** The two links to the Pedir page: the picture button (icon only) and «Lo pedido». */
const PedirLinks = ({ to, picture = true }: { to: string; picture?: boolean }) => (
  <>
    {picture && (
      <Link to={to} className="cor-pedir-icon" aria-label={PEDIR_PICTURE} title={PEDIR_PICTURE} data-pedir-picture>
        <Picture />
      </Link>
    )}
    <Link to={to} className="cor-pedir-past" data-pedir-past>
      <Clock />
      {PEDIR_PAST}
    </Link>
  </>
);

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
  /** PLA-I64-5: the bar at the foot of one project: no project picker. */
  fixed?: OrgProject;
  /** Pedir is white unless something on the screen waits on the owner (one white button per screen). */
  primary?: boolean;
  initial?: string | null;
  disabled?: boolean;
  onAsk: (slug: string, input: AskInput) => Promise<AskResult>;
  /** The Pedir page for this project (pictures, past questions, the answer to a question). */
  pedirTo: (slug: string) => string;
}) => {
  const live = fixed ? [fixed] : projects.filter((p) => !p.paused && p.light !== "paused");
  const held = !!fixed && fixed.paused;
  const [slug, setSlug] = useState<string>(initial && live.some((p) => p.slug === initial) ? initial : (live[0]?.slug ?? ""));
  const [text, setText] = useState("");
  const [mode, setMode] = useState<AskMode>("forma");
  const [sending, setSending] = useState(false);
  const [focused, setFocused] = useState(false);
  const [said, setSaid] = useState<{ text: string; to: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const project = live.find((p) => p.slug === slug) ?? null;
  const off = disabled || !project;

  // `/` moves focus to the input when no field has focus and no sheet is open.
  useEffect(() => {
    if (held) return;
    const onKey = (e: KeyboardEvent) => {
      const a = document.activeElement;
      const active = a instanceof HTMLElement && a !== document.body ? { tag: a.tagName, editable: a.isContentEditable } : null;
      if (!slashFocuses({ key: e.key, meta: e.metaKey, ctrl: e.ctrlKey, alt: e.altKey }, active, !!document.querySelector("[role=dialog]"))) return;
      if (!input.current || input.current.disabled) return;
      e.preventDefault();
      input.current.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [held]);

  if (held && fixed)
    return (
      <div className="cor-pedir" aria-label={`Pedir a ${fixed.title}`} data-pedir-bar data-held>
        <div className="cor-pedir-shell held">
          <p className="cor-pedir-held">{pedirHeld(fixed.title)}</p>
          <PedirLinks to={pedirTo(fixed.slug)} picture={false} />
        </div>
      </div>
    );

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!project || !text.trim() || sending) return;
    setSending(true);
    setError(null);
    try {
      const r = await onAsk(project.slug, { text: text.trim().slice(0, ASK_MAX), mode });
      setSaid(mode === "pregunta" ? { text: `Se lo preguntaste al PO de ${project.title}. Lee el código y contesta.`, to: withQuestion(pedirTo(project.slug), r.consulta) } : { text: askedLine(r, project.title), to: null });
      setText("");
      setMode("forma");
    } catch {
      setError(PEDIR_ERROR);
    } finally {
      setSending(false);
    }
  };
  // Shift+Tab from the input cycles the mode (only from the input: tabbing elsewhere is untouched).
  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Tab" && e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      setMode(nextMode);
    }
  };
  // The confirmation (or the error) sits where the placeholder was, until the next keystroke.
  const shown = !text && (error || said) ? true : false;
  const line = MODES.find((m) => m.id === mode)?.line ?? "";
  return (
    <form className="cor-pedir" onSubmit={(e) => void submit(e)} aria-label={fixed ? `Pedir a ${fixed.title}` : "Pedir"} data-pedir-bar>
      <div className={`cor-pedir-shell ${focused ? "focused" : ""}`}>
        {!fixed && (
          <>
            <label className="sr-only" htmlFor="cor-pedir-p">
              Proyecto
            </label>
            <select id="cor-pedir-p" className="cor-select cor-pedir-pick" value={slug} onChange={(e) => setSlug(e.target.value)} disabled={disabled || !live.length}>
              {live.map((p) => (
                <option key={p.slug} value={p.slug}>
                  {p.title}
                </option>
              ))}
            </select>
          </>
        )}
        <span className="cor-pedir-modes" role="group" aria-label="Cómo">
          {MODES.map((m) => (
            <Opt key={m.id} on={mode === m.id} onClick={() => setMode(m.id)} title={m.line} data-mode={m.id}>
              {m.name}
            </Opt>
          ))}
        </span>
        <span className="cor-pedir-field">
          <label className="sr-only" htmlFor="cor-pedir-t">
            Lo que pides
          </label>
          <input
            ref={input}
            id="cor-pedir-t"
            className="cor-pedir-text"
            value={text}
            maxLength={ASK_MAX}
            placeholder={shown ? "" : pedirPlaceholder(mode)}
            onChange={(e) => {
              setText(e.target.value);
              setSaid(null);
              setError(null);
            }}
            onKeyDown={onKeyDown}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            disabled={off}
            aria-describedby="cor-pedir-line"
            data-pedir-text
          />
          <span className="cor-pedir-said" role="status" aria-live="polite" data-pedir-said={!shown ? undefined : error ? "error" : "ok"}>
            {shown &&
              (error ? (
                <span className="bad">{error}</span>
              ) : (
                said && (
                  <>
                    <Check />
                    <span className="cor-ellipsis">{said.text}</span>
                    {said.to && (
                      <Link to={said.to} className="cor-inline">
                        Ver la respuesta
                      </Link>
                    )}
                  </>
                )
              ))}
          </span>
        </span>
        <PedirLinks to={pedirTo(project?.slug ?? slug)} />
        <kbd className="cor-pedir-key" aria-hidden data-pedir-key>
          {pedirKeyHint(focused)}
        </kbd>
        <Btn kind={primary ? "primary" : "secondary"} type="submit" disabled={off || !text.trim() || sending} data-pedir-send>
          {pedirSendLabel(mode, sending)}
        </Btn>
      </div>
      <span id="cor-pedir-line" className="sr-only">
        {line}
      </span>
    </form>
  );
};
