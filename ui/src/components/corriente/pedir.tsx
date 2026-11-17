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
import { ASK_MAX, MODES, type AskInput, type AskMode } from "@/lib/corriente";
import { askedLine } from "@/lib/edificio";
import { Images } from "./images";
import { Btn, Label, Logo } from "./parts";

const NEXT: Record<AskMode, [string, string][]> = {
  forma: [
    ["Entra como idea.", "La ves en Pedidos, en Buzón."],
    ["El PO la trabaja.", "La entiende, te pregunta si le falta algo y la avanza: Entendido, Investigación, Diseño, Plan, Lista."],
    ["Tú dices «Constrúyelo».", "Hasta entonces nadie escribe código."],
  ],
  ya: [
    ["Sube directo al tablero.", "Como un paso listo para Taller."],
    ["El equipo empieza.", "El PO lo despierta si hay lugar."],
    ["Te llega como entrega.", "La aceptas o pides ajuste."],
  ],
  pregunta: [
    ["El PO lee el código.", "Ves lo que va leyendo."],
    ["Te contesta aquí.", "Corto, con el porqué y dónde lo vio."],
    ["No crea nada.", "Si hay algo que arreglar, «Pedirlo» lo vuelve pedido."],
  ],
};
const WHERE: Record<AskMode, string> = { forma: "Entra a Pedidos, en Buzón", ya: "Paso en el tablero", pregunta: "Respuesta aquí, nada se crea" };
const pendingQ = (c: ConsultaView) => c.state === "cola" || c.state === "leyendo";

const Thread = ({ c, po, onPedirlo, onMore, busy }: { c: ConsultaView; po: string; onPedirlo: (fix: string, m: AskMode) => void; onMore: (q: string) => void; busy: boolean }) => {
  const [trail, setTrail] = useState(false);
  const [more, setMore] = useState("");
  const a = c.answer;
  const reading = pendingQ(c);
  return (
    <section className="cor-thread" data-consulta={c.id} data-state={c.state} aria-live="polite">
      <p className="cor-thread-me">{c.text}</p>
      <p className="cor-cap">
        {po} ·{" "}
        {c.state === "cola" ? "le llegó tu pregunta; empieza en cuanto termine lo que corre" : c.state === "leyendo" ? "lee el código…" : c.state === "sin_respuesta" ? "su corrida terminó sin contestar" : `leyó ${a?.branch ?? "el código"}`}
      </p>
      {a && c.trail.length > 0 && (
        <Btn kind="link" onClick={() => setTrail((x) => !x)} data-control="consulta-rastro">
          {trail ? "Ocultar lo que leyó" : `Ver lo que leyó · ${c.trail.length} pasos`}
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
          Preguntar otra vez
        </Btn>
      )}
      {a && (
        <>
          <p className="cor-thread-short">{a.short}</p>
          {a.why.length > 0 && (
            <p className="cor-text">
              <span className="cor-label">Por qué</span> {a.why.join(" ")}
            </p>
          )}
          {a.sources.length > 0 && (
            <p className="cor-cap">
              DÓNDE LO VIO {a.sources.map((s) => `${s.path}${s.line ? `:${s.line}` : ""}${s.missing ? " (no existe)" : ""}`).join(" · ")}
            </p>
          )}
          <p className="cor-cap">{a.sure === "seen" ? "Lo vio en el código" : "Lo supone"} · no lo probó en vivo</p>
          {a.fix && (
            <div className="cor-acts">
              <Btn kind="secondary" onClick={() => onPedirlo(a.fix!, "ya")} data-control="pedirlo-ya">
                Pedirlo · Hacerlo ya
              </Btn>
              <Btn kind="quiet" onClick={() => onPedirlo(a.fix!, "forma")} data-control="pedirlo-forma">
                Pedirlo · Darle forma
              </Btn>
            </div>
          )}
          <form
            className="cor-ajuste-row"
            onSubmit={(e) => {
              e.preventDefault();
              if (more.trim().length < 3 || busy) return;
              onMore(`Sobre «${c.text.slice(0, 200)}»: ${more.trim()}`);
              setMore("");
            }}
          >
            <input className="cor-input" value={more} maxLength={400} placeholder="Pregúntale algo más…" aria-label="Pregúntale algo más" onChange={(e) => setMore(e.target.value)} />
            <Btn kind="secondary" type="submit" disabled={busy || more.trim().length < 3}>
              Preguntar
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
  disabled,
  onAsk,
  onPictures,
  asistenteTo,
  pedidosTo,
}: {
  projects: OrgProject[];
  initial: string | null;
  disabled?: boolean;
  onAsk: (slug: string, input: AskInput) => Promise<AskResult>;
  onPictures: () => void;
  asistenteTo: string;
  pedidosTo: (slug: string) => string;
}) => {
  const live = projects.filter((p) => !p.paused && p.light !== "paused");
  const [slug, setSlug] = useState(initial && live.some((p) => p.slug === initial) ? initial : (live[0]?.slug ?? ""));
  const p = live.find((x) => x.slug === slug) ?? null;
  const [text, setText] = useState("");
  const [mode, setMode] = useState<AskMode>("forma");
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<{ text: string; key: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fromAnswer, setFromAnswer] = useState<string | null>(null);
  const [openQ, setOpenQ] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const consultas = useQuery({
    queryKey: ["consultas", slug],
    queryFn: () => api.consultas(slug),
    enabled: !!slug,
    refetchInterval: (q) => (q.state.data?.consultas.some(pendingQ) ? 3000 : false),
  });
  const list = consultas.data?.consultas ?? [];
  const current = openQ ? (list.find((c) => c.id === openQ) ?? null) : null;
  useEffect(() => {
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
        if (up.error) lost = typeof up.error.detail.message === "string" ? up.error.detail.message : "inténtalo desde el pedido abierto.";
        onPictures();
      }
      setSent({ text: askedLine(r, p.title) + (withAnswer.consulta ? " La respuesta va adjunta." : "") + (lost ? ` Pero ${files.length > 1 ? "no todas las imágenes subieron" : "la imagen no subió"}: ${lost}` : ""), key: input.mode === "forma" ? r.key : null });
      setText("");
      setFiles([]);
      setMode("forma");
      setFromAnswer(null);
    } catch {
      setError("No se pudo enviar. Si la Mac está dormida, intenta al despertar.");
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
          <Label>Pedir</Label>
          <h1 className="cor-pedir-h">¿Qué necesitas?</h1>
        </div>
        <div>
          <Label as="p" id="pedir-para">
            Para
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
            Tu pedido
          </label>
          <textarea
            id="pedir-texto"
            ref={area}
            className="cor-pedir-area"
            value={text}
            maxLength={ASK_MAX}
            placeholder={p ? `Pide algo para ${p.title}…` : "Pide algo…"}
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
              <span className="cor-images-hint">Una pregunta no lleva imágenes.</span>
              <span className="cor-cap">{`${text.length} / ${ASK_MAX}`}</span>
            </div>
          )}
        </div>
        {fromAnswer && mode !== "pregunta" && <p className="cor-cap">Lleva adjunta la respuesta del PO.</p>}
        <div>
          <Label as="p" id="pedir-como">
            Cómo lo quieres
          </Label>
          <div className="cor-modes" role="radiogroup" aria-labelledby="pedir-como">
            {MODES.map((m) => (
              <button key={m.id} type="button" role="radio" aria-checked={mode === m.id} className="cor-mode" onClick={() => (setMode(m.id), m.id === "pregunta" && setFromAnswer(null))} data-mode={m.id}>
                <span className="cor-mode-name">
                  <i aria-hidden />
                  {m.name}
                </span>
                <span className="cor-text">{m.line}</span>
                <span className="cor-cap">→ {WHERE[m.id].toUpperCase()}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="cor-acts">
          <Btn kind="primary" type="submit" disabled={!can} data-pedir-send>
            {sending ? "Enviando…" : mode === "pregunta" ? "Preguntar" : "Pedir"}
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
                    Ver en Pedidos
                  </Link>
                )}
              </>
            ) : p ? (
              `Lo recibe el PO de ${p.title}.`
            ) : (
              "No hay proyectos encendidos."
            )}
          </span>
        </div>
      </form>
      <aside className="cor-pedir-side">
        {current && p ? (
          <>
            <div className="cor-side-head">
              <Label as="h2">Tu pregunta · {p.title}</Label>
              <Btn kind="link" onClick={() => setOpenQ(null)}>
                Volver
              </Btn>
            </div>
            <Thread
              c={current}
              po={`PO de ${p.title}`}
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
            <section aria-label="Qué pasa después">
              <Label as="h2">{`Qué pasa después · ${MODES.find((m) => m.id === mode)!.name}`}</Label>
              <ol className="cor-next">
                {NEXT[mode].map(([b, t], i) => (
                  <li key={i}>
                    <span className="cor-key">{i + 1}</span>
                    <span>
                      <b>{b}</b> {t}
                    </span>
                  </li>
                ))}
              </ol>
            </section>
            <section aria-label="Preguntas anteriores" data-anteriores={list.length}>
              <Label as="h2">{`Preguntas anteriores · ${p?.title ?? ""}`}</Label>
              {list.length ? (
                <ul className="cor-brief">
                  {list.slice(0, 4).map((c) => (
                    <li key={c.id}>
                      <button type="button" className="cor-row" style={{ border: 0, padding: 0, minHeight: 44 }} onClick={() => setOpenQ(c.id)} data-consulta-open={c.id}>
                        <span className="cor-ellipsis" style={{ flex: 1 }}>
                          {c.text}
                        </span>
                        <span className={`cor-state ${pendingQ(c) ? "live" : ""}`}>{pendingQ(c) ? "Leyendo" : c.answer ? "Contestada" : "Sin respuesta"}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="cor-text" style={{ padding: "10px 0" }}>
                  Aún no le has preguntado nada a este proyecto. Lo que preguntes queda aquí con su respuesta y lo que el PO leyó.
                </p>
              )}
            </section>
            <p className="cor-text">¿No sabes de qué proyecto es? Asistente lo reparte.</p>
            <Link className="cor-btn link" to={asistenteTo} style={{ alignSelf: "flex-start" }}>
              Decírselo a Asistente
            </Link>
          </>
        )}
      </aside>
    </div>
  );
};
