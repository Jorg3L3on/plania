// PLA-I62-2: the Pedir bar at the foot of La corriente: the project, the words, the three modes and Pedir (the stream's
// one white button). It sends through the route /ceo's ask box uses (POST /api/company/projects/:slug/ask). A question
// (Preguntar) is answered on the Pedir page, where the thread lives; pictures are added there too.
// PLA-I3-6 «Un solo Pedir»: the bar is the only Pedir in a project. One 56 px container: the modes as a segmented
// choice, the input (its placeholder is the mode's line), the picture button and «Lo pedido» (both open the Pedir
// page), a key hint and the send button. `/` focuses the input, Enter sends, Shift+Tab from the input cycles the mode.
// The confirmation shows inside the container and clears on the next keystroke. Paused: one sentence and «Lo pedido».
// PLA-I3-7: on a phone (corriente.css) the bar is the mode as one chip, the input and a 44 px send button with an
// arrow; the chip's menu holds the three modes, the picture button and «Lo pedido». Above 639 px nothing changes.
// Words and keys: @/lib/corriente.
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Link } from "react-router";
import type { AskResult, OrgProject } from "@/lib/api";
import { ASK_MAX, modesOf, nextMode, pedirChipAria, pedirError, pedirHeld, pedirKeyHint, pedirMenu, pedirPast, pedirPicture, pedirPlaceholder, pedirSendLabel, slashFocuses, type AskInput, type AskMode } from "@/lib/corriente";
import { askedLine } from "@/lib/edificio";
import { words } from "@/lib/i18n";
import { PEDIR } from "@/lib/pedir-words";
import { Btn, Opt } from "./parts";

// PLA-I2-10: the ask modes in the screen's language (fixed for the page load).
const MODES = modesOf();

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

const Chevron = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M4.5 6.5 8 10l3.5-3.5" />
  </svg>
);
const Send = () => (
  <svg className="cor-pedir-send-i" width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M9 14.5v-11M4.5 8 9 3.5 13.5 8" />
  </svg>
);

/** PLA-I3-7: the mode as one chip (a phone's bar). Its menu: the three modes, then the picture button and «Lo
 *  pedido». ↑/↓ move in it; Esc closes it before the page sees the key; a pick closes it and focus goes back to the chip. */
const ModoChip = ({ mode, onMode, to }: { mode: AskMode; onMode: (m: AskMode) => void; to: string }) => {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  const chip = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    box.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      setOpen(false);
      chip.current?.focus();
    };
    const onDown = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [open]);
  const onMenuKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Tab") return setOpen(false);
    const items = [...(box.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    const n = items.length;
    const j = e.key === "ArrowDown" ? (i + 1) % n : e.key === "ArrowUp" ? (i - 1 + n) % n : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : null;
    if (j === null || !n) return;
    e.preventDefault();
    items[j]?.focus();
  };
  const pick = (m: AskMode) => {
    onMode(m);
    setOpen(false);
    chip.current?.focus();
  };
  return (
    <span className="cor-pedir-chip-box" ref={box}>
      <button ref={chip} type="button" className="cor-pedir-chip" aria-haspopup="menu" aria-expanded={open} aria-label={pedirChipAria(mode)} onClick={() => setOpen((o) => !o)} data-pedir-chip={mode}>
        <span className="cor-ellipsis">{MODES.find((m) => m.id === mode)?.name}</span>
        <Chevron />
      </button>
      {open && (
        <div className="cor-pedir-menu" role="menu" aria-label={pedirMenu()} onKeyDown={onMenuKey} data-pedir-menu>
          {MODES.map((m) => (
            <button key={m.id} type="button" role="menuitemradio" aria-checked={mode === m.id} tabIndex={-1} className="cor-pedir-mi" onClick={() => pick(m.id)} data-menu-mode={m.id}>
              <b>{m.name}</b>
              <small>{m.line}</small>
            </button>
          ))}
          <span className="cor-pedir-menu-sep" role="separator" />
          <Link to={to} role="menuitem" tabIndex={-1} className="cor-pedir-mi row" data-menu-picture>
            <Picture />
            {pedirPicture()}
          </Link>
          <Link to={to} role="menuitem" tabIndex={-1} className="cor-pedir-mi row" data-menu-past>
            <Clock />
            {pedirPast()}
          </Link>
        </div>
      )}
    </span>
  );
};

/** The two links to the Pedir page: the picture button (icon only) and «Lo pedido». */
const PedirLinks = ({ to, picture = true }: { to: string; picture?: boolean }) => (
  <>
    {picture && (
      <Link to={to} className="cor-pedir-icon" aria-label={pedirPicture()} title={pedirPicture()} data-pedir-picture>
        <Picture />
      </Link>
    )}
    <Link to={to} className="cor-pedir-past" data-pedir-past>
      <Clock />
      {pedirPast()}
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
  const w = words(PEDIR);
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
      setSaid(mode === "pregunta" ? { text: w.askedPo(project.title), to: withQuestion(pedirTo(project.slug), r.consulta) } : { text: askedLine(r, project.title), to: null });
      setText("");
      setMode("forma");
    } catch {
      setError(pedirError());
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
    <form className="cor-pedir" onSubmit={(e) => void submit(e)} aria-label={fixed ? w.pedirA(fixed.title) : w.pedir} data-pedir-bar>
      <div className={`cor-pedir-shell ${focused ? "focused" : ""}`}>
        {!fixed && (
          <>
            <label className="sr-only" htmlFor="cor-pedir-p">
              {w.project}
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
        <span className="cor-pedir-modes" role="group" aria-label={w.howShort}>
          {MODES.map((m) => (
            <Opt key={m.id} on={mode === m.id} onClick={() => setMode(m.id)} title={m.line} data-mode={m.id}>
              {m.name}
            </Opt>
          ))}
        </span>
        <ModoChip mode={mode} onMode={setMode} to={pedirTo(project?.slug ?? slug)} />
        <span className="cor-pedir-field">
          <label className="sr-only" htmlFor="cor-pedir-t">
            {w.whatYouAsk}
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
                        {w.seeAnswer}
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
        {/* PLA-I3-7: a phone shows the arrow alone; the label names it. */}
        <Btn kind={primary ? "primary" : "secondary"} type="submit" disabled={off || !text.trim() || sending} aria-label={pedirSendLabel(mode, sending)} data-pedir-send>
          <span className="cor-pedir-send-t">{pedirSendLabel(mode, sending)}</span>
          <Send />
        </Btn>
      </div>
      <span id="cor-pedir-line" className="sr-only">
        {line}
      </span>
    </form>
  );
};
