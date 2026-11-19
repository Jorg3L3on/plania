// PLA-I62-5: Pedir (board A3), the building's ask side page as a page. For which project, the request (2000
// characters, pictures by ⌘V, drag or picker), how (Darle forma, Hacerlo ya, Preguntar, each saying where it
// lands), Pedir (⌘↵). Beside it what happens next in the chosen mode, the project's past questions, and a question's
// thread once asked (what the PO read, its short answer, why, where it saw it, «Pedirlo» with its fix).
// The calls are the building's: POST /company/projects/:slug/ask, the pictures after (uploadPedidoImages), and
// GET /company/projects/:slug/consultas (read again every few seconds while one is being answered).
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { api, uploadPedidoImages, type AskResult, type ConsultaView, type OrgProject } from "@/lib/api";
import { ASK_MAX, modesOf, type AskInput, type AskMode } from "@/lib/corriente";
import { askedLine } from "@/lib/edificio";
import { words } from "@/lib/i18n";
import { PEDIR } from "@/lib/pedir-words";
import { Images } from "./images";
import { Btn, Label, Logo } from "./parts";

// PLA-I2-10: the ask modes in the screen's language (fixed for the page load).
const MODES = modesOf();

// PLA-I2-10: the words live in lib/pedir-words.ts.
const pendingQ = (c: ConsultaView) => c.state === "cola" || c.state === "leyendo";

const Thread = ({ c, po, onPedirlo, onMore, busy }: { c: ConsultaView; po: string; onPedirlo: (fix: string, m: AskMode) => void; onMore: (q: string) => void; busy: boolean }) => {
  const [trail, setTrail] = useState(false);
  const [more, setMore] = useState("");
  const w = words(PEDIR);
  const a = c.answer;
  const reading = pendingQ(c);
  return (
    <section className="cor-thread" data-consulta={c.id} data-state={c.state} aria-live="polite">
      <p className="cor-thread-me">{c.text}</p>
      <p className="cor-cap">
        {po} ·{" "}
        {c.state === "cola" ? (c.held ? w.queued(c.held) : w.arrived) : c.state === "leyendo" ? w.reading : c.state === "sin_respuesta" ? w.noAnswer : w.read(a?.branch ?? null)}
      </p>
      {a && c.trail.length > 0 && (
        <Btn kind="link" onClick={() => setTrail((x) => !x)} data-control="consulta-rastro">
          {trail ? w.hideTrail : w.showTrail(c.trail.length)}
        </Btn>
      )}
      {(reading || trail) && c.trail.length > 0 && (
        <ol className="cor-thread-trail">
          {c.trail.slice(-6).map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ol>
      )}
      {c.state === "sin_respuesta" && (
        <Btn kind="secondary" disabled={busy} onClick={() => onMore(c.text)} data-control="consulta-otra-vez">
          {w.askAgain}
        </Btn>
      )}
      {a && (
        <>
          <p className="cor-thread-short">{a.short}</p>
          {a.why.length > 0 && (
            <p className="cor-text">
              <span className="cor-label">{w.why}</span> {a.why.join(" ")}
            </p>
          )}
          {a.sources.length > 0 && (
            <p className="cor-cap">
              {w.whereSeen} {a.sources.map((s) => `${s.path}${s.line ? `:${s.line}` : ""}${s.missing ? w.missing : ""}`).join(" · ")}
            </p>
          )}
          <p className="cor-cap">{a.sure === "seen" ? w.seen : w.guessed} · {w.notLive}</p>
          {a.fix && (
            <div className="cor-acts">
              <Btn kind="secondary" onClick={() => onPedirlo(a.fix!, "ya")} data-control="pedirlo-ya">
                {w.pedirloYa}
              </Btn>
              <Btn kind="quiet" onClick={() => onPedirlo(a.fix!, "forma")} data-control="pedirlo-forma">
                {w.pedirloForma}
              </Btn>
            </div>
          )}
          <form
            className="cor-ajuste-row"
            onSubmit={(e) => {
              e.preventDefault();
              if (more.trim().length < 3 || busy) return;
              onMore(w.about(c.text.slice(0, 200), more.trim()));
              setMore("");
            }}
          >
            <input className="cor-input" value={more} maxLength={400} placeholder={w.askMorePlaceholder} aria-label={w.askMore} onChange={(e) => setMore(e.target.value)} />
            <Btn kind="secondary" type="submit" disabled={busy || more.trim().length < 3}>
              {w.ask}
            </Btn>
          </form>
        </>
      )}
    </section>
  );
};

export const Pedir = ({
  projects,
  initial,
  initialText,
  initialQuestion,
  disabled,
  onAsk,
  onPictures,
  asistenteTo,
  pedidosTo,
}: {
  projects: OrgProject[];
  initial: string | null;
  /** Words handed over from elsewhere (Máquinas' «Algo falló»). */
  initialText?: string | null;
  /** PLA-67: the question to open (from the bar's «Ver la respuesta»). */
  initialQuestion?: string | null;
  disabled?: boolean;
  onAsk: (slug: string, input: AskInput) => Promise<AskResult>;
  onPictures: () => void;
  asistenteTo: string;
  pedidosTo: (slug: string) => string;
}) => {
  const w = words(PEDIR);
  const live = projects.filter((p) => !p.paused && p.light !== "paused");
  const [slug, setSlug] = useState(initial && live.some((p) => p.slug === initial) ? initial : (live[0]?.slug ?? ""));
  const p = live.find((x) => x.slug === slug) ?? null;
  const [text, setText] = useState(initialText ?? "");
  const [mode, setMode] = useState<AskMode>("forma");
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<{ text: string; key: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fromAnswer, setFromAnswer] = useState<string | null>(null);
  const [openQ, setOpenQ] = useState<string | null>(initialQuestion ?? null);
  const area = useRef<HTMLTextAreaElement>(null);
  const consultas = useQuery({
    queryKey: ["consultas", slug],
    queryFn: () => api.consultas(slug),
    enabled: !!slug,
    refetchInterval: (q) => (q.state.data?.consultas.some(pendingQ) ? 3000 : false),
  });
  const list = consultas.data?.consultas ?? [];
  const current = openQ ? (list.find((c) => c.id === openQ) ?? null) : null;
  // A new project closes the open question; the first render keeps the one the link asked for (PLA-67).
  const shownSlug = useRef(slug);
  useEffect(() => {
    if (shownSlug.current === slug) return;
    shownSlug.current = slug;
    setOpenQ(null);
    setFromAnswer(null);
  }, [slug]);

  const submit = async (input: AskInput) => {
    if (!p || !input.text.trim() || sending) return;
    setSending(true);
    setError(null);
    try {
      const withAnswer = fromAnswer && input.mode !== "pregunta" ? { ...input, consulta: fromAnswer } : input;
      const r = await onAsk(p.slug, withAnswer);
      if (input.mode === "pregunta" && r.consulta) {
        setText("");
        setFiles([]);
        setOpenQ(r.consulta);
        void consultas.refetch();
        return;
      }
      let lost: string | null = null;
      if (files.length && r.key) {
        const up = await uploadPedidoImages(p.slug, r.key, files);
        if (up.error) lost = typeof up.error.detail.message === "string" ? up.error.detail.message : w.tryFromRequest;
        onPictures();
      }
      setSent({ text: askedLine(r, p.title) + (withAnswer.consulta ? w.answerAttached : "") + (lost ? w.picturesLost(files.length, lost) : ""), key: input.mode === "forma" ? r.key : null });
      setText("");
      setFiles([]);
      setMode("forma");
      setFromAnswer(null);
    } catch {
      setError(w.sendFailed);
    } finally {
      setSending(false);
    }
  };
  const can = !!p && !!text.trim() && !sending && !disabled;
  return (
    <div className="cor-pedirpage" data-pedir-page={slug}>
      <form
        className="cor-pedir-form"
        onSubmit={(e) => {
          e.preventDefault();
          void submit({ text: text.trim().slice(0, ASK_MAX), mode });
        }}
      >
        <div>
          <Label>{w.pedir}</Label>
          <h1 className="cor-pedir-h">{w.heading}</h1>
        </div>
        <div>
          <Label as="p" id="pedir-para">
            {w.para}
          </Label>
          <div className="cor-seg" role="radiogroup" aria-labelledby="pedir-para" data-projects>
            {live.map((x) => (
              <button key={x.slug} type="button" role="radio" aria-checked={x.slug === slug} className="cor-opt" onClick={() => setSlug(x.slug)} data-project={x.slug}>
                <Logo slug={x.slug} title={x.title} size="sm" />
                {x.title}
              </button>
            ))}
          </div>
        </div>
        <div className="cor-pedir-box">
          <label className="cor-label" htmlFor="pedir-texto">
            {w.yourRequest}
          </label>
          <textarea
            id="pedir-texto"
            ref={area}
            className="cor-pedir-area"
            value={text}
            maxLength={ASK_MAX}
            placeholder={p ? w.placeholderFor(p.title) : w.placeholder}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                if (can) void submit({ text: text.trim().slice(0, ASK_MAX), mode });
              }
            }}
            disabled={disabled}
            data-pedir-area
          />
          {mode !== "pregunta" ? (
            <Images files={files} onChange={setFiles} textarea={area} count={`${text.length} / ${ASK_MAX}`} disabled={disabled || sending} />
          ) : (
            <div className="cor-images">
              <span className="cor-images-hint">{w.noPictures}</span>
              <span className="cor-cap">{`${text.length} / ${ASK_MAX}`}</span>
            </div>
          )}
        </div>
        {fromAnswer && mode !== "pregunta" && <p className="cor-cap">{w.carriesAnswer}</p>}
        <div>
          <Label as="p" id="pedir-como">
            {w.how}
          </Label>
          <div className="cor-modes" role="radiogroup" aria-labelledby="pedir-como">
            {MODES.map((m) => (
              <button key={m.id} type="button" role="radio" aria-checked={mode === m.id} className="cor-mode" onClick={() => (setMode(m.id), m.id === "pregunta" && setFromAnswer(null))} data-mode={m.id}>
                <span className="cor-mode-name">
                  <i aria-hidden />
                  {m.name}
                </span>
                <span className="cor-text">{m.line}</span>
                <span className="cor-cap">→ {w.where[m.id].toUpperCase()}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="cor-acts">
          <Btn kind="primary" type="submit" disabled={!can} data-pedir-send>
            {sending ? w.sending : mode === "pregunta" ? w.ask : w.pedir}
          </Btn>
          <span className="cor-cap">⌘ ↵</span>
          <span className="cor-text" role="status" aria-live="polite" data-pedir-said={error ? "error" : sent ? "ok" : undefined}>
            {error ? (
              <span className="cor-state bad">{error}</span>
            ) : sent ? (
              <>
                ✓ {sent.text}{" "}
                {sent.key && p && (
                  <Link to={pedidosTo(p.slug)} className="cor-inline">
                    {w.seeInPedidos}
                  </Link>
                )}
              </>
            ) : p ? (
              w.receivedBy(p.title)
            ) : (
              w.noProjects
            )}
          </span>
        </div>
      </form>
      <aside className="cor-pedir-side">
        {current && p ? (
          <>
            <div className="cor-side-head">
              <Label as="h2">{w.yourQuestion(p.title)}</Label>
              <Btn kind="link" onClick={() => setOpenQ(null)}>
                {w.back}
              </Btn>
            </div>
            <Thread
              c={current}
              po={w.poOf(p.title)}
              busy={sending}
              onMore={(q) => void submit({ text: q.slice(0, ASK_MAX), mode: "pregunta" })}
              onPedirlo={(fix, m) => {
                setText(fix.slice(0, ASK_MAX));
                setMode(m);
                setFromAnswer(current.id);
                setOpenQ(null);
                area.current?.focus();
              }}
            />
          </>
        ) : (
          <>
            <section aria-label={w.whatNext}>
              <Label as="h2">{w.whatNextOf(MODES.find((m) => m.id === mode)!.name)}</Label>
              <ol className="cor-next">
                {w.next[mode].map(([b, t], i) => (
                  <li key={i}>
                    <span className="cor-key">{i + 1}</span>
                    <span>
                      <b>{b}</b> {t}
                    </span>
                  </li>
                ))}
              </ol>
            </section>
            <section aria-label={w.past} data-anteriores={list.length}>
              <Label as="h2">{w.pastOf(p?.title ?? "")}</Label>
              {list.length ? (
                <ul className="cor-brief">
                  {list.slice(0, 4).map((c) => (
                    <li key={c.id}>
                      <button type="button" className="cor-row" style={{ border: 0, padding: 0, minHeight: 44 }} onClick={() => setOpenQ(c.id)} data-consulta-open={c.id}>
                        <span className="cor-ellipsis" style={{ flex: 1 }}>
                          {c.text}
                        </span>
                        <span className={`cor-state ${pendingQ(c) ? "live" : ""}`}>{c.state === "cola" ? w.stateQueued : c.state === "leyendo" ? w.stateReading : c.answer ? w.stateAnswered : w.stateNoAnswer}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : consultas.isPending ? (
                <p className="cor-text" style={{ padding: "10px 0" }} data-anteriores-cargando>
                  {w.loadingPast}
                </p>
              ) : (
                <p className="cor-text" style={{ padding: "10px 0" }}>
                  {w.noPast}
                </p>
              )}
            </section>
            <p className="cor-text">{w.whichProject}</p>
            <Link className="cor-btn link" to={asistenteTo} style={{ alignSelf: "flex-start" }}>
              {w.tellAsistente}
            </Link>
          </>
        )}
      </aside>
    </div>
  );
};
