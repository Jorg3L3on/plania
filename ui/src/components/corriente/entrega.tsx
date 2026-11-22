// PLA-I62-4: a delivery's review (board B4), El Probador redrawn. The views it touched as tabs (each says nueva,
// cambió, igual), Antes / Después / Comparar (a line to drag, also with the arrow keys), Escritorio / Teléfono,
// Resaltar cambios (the box around what changed), pins on a picture (Señalar algo) that go with Pedir ajuste, a
// question for Taller, and behind Más: Señalar algo, Pruébala en vivo (its own copy), Volver a tomar las fotos.
// Right: the decision (Aceptar, Pedir ajuste), «Se aprueba sola» and why it did not, the evidence (what changes,
// tests, the separate review with its PR, what is published) and the pins. The calls are /ceo's.
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { Link } from "react-router";
import { api, type Decision, type Marca, type OrgProject, type ParVista, type ProbadorQA, type VivoRead } from "@/lib/api";
import { acceptWords, evidenceView, MARK_MAX } from "@/lib/evidencia";
import { firstVista, kindWord, probadorWords, frameOf, sideFor, siAceptas, stateLine, tomandoLine, type Side, type Width } from "@/lib/probador";
import type { CorrienteActs } from "./acts";
import { Ajuste } from "./ajuste";
import { Btn, Key, Label, Opt, ReadError, You } from "./parts";
import { AutoSwitches } from "./pendiente";
import { useProbadorRead, useQaRead } from "./reads";
import { useQuery } from "@tanstack/react-query";
import { words } from "@/lib/i18n";
import { ENTREGA_WORDS } from "@/lib/entrega-words";

const W = probadorWords();

type Pin = Marca & { n: number };

/** PLA-109 (guided test PLA-86, F-37): a full-size photo takes seconds to arrive the first time; until it does the stage
 * says so instead of showing an empty dark box. Keyed by src, so switching views starts over. */
const Still = ({ src, alt }: { src: string; alt: string }) => {
  const [loaded, setLoaded] = useState<string | null>(null);
  const ready = loaded === src;
  return (
    <>
      <img src={src} alt={alt} decoding="async" onLoad={() => setLoaded(src)} data-loaded={ready || undefined} />
      {!ready && (
        <span className="cor-still-loading" role="status">
          {W.cargando}
        </span>
      )}
    </>
  );
};

const Frame = ({ v, width, side, hi, pins = [], onPin }: { v: ParVista; width: Width; side: "antes" | "despues"; hi: boolean; pins?: Pin[]; onPin?: (x: number, y: number) => void }) => {
  const f = frameOf(v, width, side);
  if (f.kind === "nueva")
    return (
      <div className="cor-noshot" data-frame="nueva">
        <b>{words(ENTREGA_WORDS).newScreen}</b>
        <span className="cor-text">{W.nueva}</span>
      </div>
    );
  if (f.kind === "none")
    return (
      <div className="cor-noshot" data-frame={f.error ? "error" : "none"}>
        <b>{f.error ? W.conError : W.sinFoto}</b>
        <span className="cor-text">{f.why}</span>
      </div>
    );
  const box = side === "despues" && hi ? v[width].diff : null;
  return (
    <div
      className="cor-stage-img"
      data-frame="still"
      data-pinning={onPin ? "1" : undefined}
      onClick={
        onPin
          ? (e) => {
              const img = e.currentTarget.querySelector("img")!.getBoundingClientRect();
              onPin(Math.min(1, Math.max(0, (e.clientX - img.left) / img.width)), Math.min(1, Math.max(0, (e.clientY - img.top) / img.height)));
            }
          : undefined
      }
    >
      <div className="cor-stage-fit">
        <Still src={f.src} alt={f.alt} />
        {box && <i className="cor-diffbox" aria-hidden style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.w * 100}%`, height: `${box.h * 100}%` } as CSSProperties} />}
        {pins.map((p) => (
          <i key={p.n} className="cor-pin" style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` } as CSSProperties} aria-hidden>
            {p.n}
          </i>
        ))}
      </div>
    </div>
  );
};

/** The compare line: drag it, or focus its handle and use ← →. */
const Compare = ({ v, width, hi }: { v: ParVista; width: Width; hi: boolean }) => {
  const [line, setLine] = useState(50);
  const box = useRef<HTMLDivElement>(null);
  const drag = (e: ReactPointerEvent) => {
    const b = box.current?.getBoundingClientRect();
    if (!b) return;
    setLine(Math.min(98, Math.max(2, ((e.clientX - b.left) / b.width) * 100)));
  };
  return (
    <div
      ref={box}
      style={{ position: "absolute", inset: 0, "--line": `${line}%` } as CSSProperties}
      onPointerMove={(e) => e.buttons === 1 && drag(e)}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest("button")) (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        drag(e);
      }}
      data-compare={Math.round(line)}
    >
      <Frame v={v} width={width} side="antes" hi={false} />
      <div className="cor-cmp-after">
        <Frame v={v} width={width} side="despues" hi={hi} />
      </div>
      <i className="cor-cmp-line" aria-hidden />
      <button
        type="button"
        className="cor-cmp-handle"
        role="slider"
        aria-label={words(ENTREGA_WORDS).compareLine}
        aria-valuemin={2}
        aria-valuemax={98}
        aria-valuenow={Math.round(line)}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") setLine((x) => Math.max(2, x - 5));
          if (e.key === "ArrowRight") setLine((x) => Math.min(98, x + 5));
        }}
        data-control="linea"
      >
        ‹›
      </button>
      <span className="cor-cap l">{W.antes}</span>
      <span className="cor-cap r">{W.despues}</span>
    </div>
  );
};

export const Entrega = ({ p, d, acts, back }: { p: OrgProject; d: Decision; acts: CorrienteActs; back: string }) => {
  const w = words(ENTREGA_WORDS);
  const read = useProbadorRead(p.slug, d.ref);
  const qa = useQaRead(p.slug, d.ref);
  const r = read.data;
  // PLA-127: an icons change shows on no page; its images are shown as they land in the repo.
  const imgs = useQuery({ queryKey: ["probador-imagenes", p.slug, d.ref], queryFn: () => api.probadorImagenes(p.slug, d.ref!), enabled: !!d.ref, staleTime: 30_000 });
  const files = imgs.data?.files ?? [];
  const imgUrl = (lado: "antes" | "despues", path: string) => `/api/projects/${encodeURIComponent(p.slug)}/probador/${encodeURIComponent(d.ref!)}/imagen?lado=${lado}&path=${encodeURIComponent(path)}`;
  const blind = !!r && r.vistas.length > 0 && r.vistas.every((x) => x.kind === "igual");
  // PLA-79: a held delivery (missing photos, a red check…) looked acceptable: a white «Aceptar» that did nothing. The
  // hold now leads like a blind sample: «Pedir ajuste» first, the reason said as a reason.
  const held = !!d.hold;
  const [key, setKey] = useState<string | null>(null);
  const v = r?.vistas.find((x) => x.key === key) ?? r?.vistas.find((x) => x.key === (r ? firstVista(r) : null)) ?? r?.vistas[0];
  const [side, setSide] = useState<Side | null>(null);
  const shownSide: Side = side ?? sideFor(v);
  const [width, setWidth] = useState<Width>("desktop");
  const [hi, setHi] = useState(true);
  const [pins, setPins] = useState<Marca[]>([]);
  const [pinning, setPinning] = useState(false);
  const [more, setMore] = useState(false);
  const [ajuste, setAjuste] = useState(false);
  const [ask, setAsk] = useState("");
  const [asked, setAsked] = useState<ProbadorQA[]>([]);
  const [asking, setAsking] = useState(false);
  const [live, setLive] = useState(r?.entrega ?? null);
  const [starting, setStarting] = useState(false);
  const [retaking, setRetaking] = useState(false);
  const [vivo, setVivo] = useState<VivoRead | null>(null);
  const [opening, setOpening] = useState(false);
  useEffect(() => setLive(r?.entrega ?? null), [r?.entrega]);
  // PLA-91 (guided test PLA-86, F-14): the copy was live in seconds but the card said «Encendiendo la copia…» until a
  // reload. While it starts, the card asks every 2 s; it stops once the copy is live or failed.
  useEffect(() => {
    if (live?.phase !== "starting") return;
    const t = setInterval(() => {
      void api
        .entregaEstado(p.slug)
        .then((x) => x.entrega && setLive(x.entrega))
        .catch(() => undefined);
    }, 2000);
    return () => clearInterval(t);
  }, [live?.phase, p.slug]);
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!more) return;
    const onDown = (e: MouseEvent) => !menu.current?.contains(e.target as Node) && setMore(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setMore(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [more]);

  const ev = evidenceView(qa.data, d);
  const accept = d.actions.find((a) => a === "fusionar" || a === "aceptar");
  const busy = acts.decisions.busy?.id === d.id;
  const error = acts.decisions.errors[d.id];
  const state = r ? stateLine(r) : null;
  const single = shownSide !== "comparar";
  const slide = !!v && v[width].antes.still !== null && v[width].despues.still !== null;
  const pinsHere: Pin[] = pins.map((m, i) => ({ ...m, n: i + 1 })).filter((m) => v && m.vista === v.key && m.width === width && m.side === shownSide);
  const addPin = (x: number, y: number) => {
    if (!v || !single) return;
    setPins((l) => [...l, { vista: v.key, side: shownSide as "antes" | "despues", width, x, y, note: "" }]);
    setPinning(false);
  };
  const qas = [...(r?.preguntas ?? []), ...asked.filter((a) => !(r?.preguntas ?? []).some((q) => q.id === a.id))];
  const send = async () => {
    const t = ask.trim();
    if (!t || !d.ref) return;
    setAsking(true);
    try {
      const out = await api.preguntar(p.slug, d.ref, t);
      setAsked((x) => [...x, { id: out.id, text: t, at: new Date().toISOString(), answer: null }]);
      setAsk("");
    } catch {
      // nothing was sent; the button stays
    } finally {
      setAsking(false);
    }
  };
  const encender = async () => {
    if (!d.ref) return;
    setStarting(true);
    try {
      setLive((await api.entregaEncender(p.slug, d.ref)).entrega);
    } catch {
      setLive((x) => (x ? { ...x, phase: "failed" } : x));
    } finally {
      setStarting(false);
    }
  };
  // PLA-111 (guided test PLA-86, F-33): «Pruébala en vivo» took two clicks, the first only got the address. The tab
  // opens inside the click (so the browser allows it) and goes to the copy once its address is known; where no tab
  // can open, the link stays on the card as before.
  const abrir = async () => {
    const tab = typeof window !== "undefined" ? window.open("about:blank", "_blank") : null;
    setOpening(true);
    try {
      const got = (await api.vivo(p.slug)).vivo;
      setVivo(got);
      const url = got.url && v ? got.url + v.path : null;
      if (tab) {
        if (url) {
          tab.opener = null;
          tab.location.href = url;
        } else tab.close();
      }
    } catch {
      tab?.close();
      setVivo({ url: null, local_url: null, tailnet: false, signed_in: false, user: null, error: w.liveFailed, hint: null });
    } finally {
      setOpening(false);
    }
  };
  const liveUrl = vivo?.url && v ? vivo.url + v.path : null;
  const pr = (d.links ?? []).find((l) => l.kind === "pr")?.ref ?? ev.pr;

  const stage = () => {
    if (read.isPending) return <div className="cor-skel" style={{ position: "absolute", inset: 0 }} role="status" aria-busy="true" aria-label={w.readingPhotos} />;
    if (read.isError) return <ReadError what={w.thePhotos} onRetry={() => void read.refetch()} />;
    if ((!r || !r.muestra || !v) && files.length > 0)
      return (
        <div className="cor-imgs" data-stage="imagenes">
          <div className="cor-imgs-h">
            <b>{w.imagesTitle(files.length)}</b>
            <span className="cor-text">{w.imagesLead}</span>
          </div>
          <ul>
            {files.map((f) => (
              <li key={f.path} data-estado={f.estado}>
                <code>{f.path}</code>
                <span className="cor-imgs-st">{w.imageState[f.estado]}</span>
                <div className="cor-imgs-pair">
                  <figure>
                    {f.estado !== "nueva" ? <img src={imgUrl("antes", f.path)} alt="" /> : <i />}
                    <figcaption>{W.antes}</figcaption>
                  </figure>
                  <figure>
                    {f.estado !== "borrada" ? <img src={imgUrl("despues", f.path)} alt="" /> : <i />}
                    <figcaption>{W.despues}</figcaption>
                  </figure>
                </div>
              </li>
            ))}
          </ul>
        </div>
      );
    if (!r || !r.muestra || !v)
      return (
        <div className="cor-noshot" data-stage="sin-fotos">
          <b>{r?.state?.state === "tomando" ? w.takingPhotos : w.noPhotos}</b>
          <span className="cor-text">{r?.state?.state === "tomando" ? tomandoLine(r, w.photosSoon) : (state ?? (d.cambio === "no_se_ve" ? w.judgeNoScreen : w.judgeOrAsk))}</span>
        </div>
      );
    if (shownSide === "comparar")
      return slide ? (
        <Compare v={v} width={width} hi={hi} />
      ) : (
        <div className="cor-pair">
          <div>
            <span className="cor-cap l">{W.antes}</span>
            <Frame v={v} width={width} side="antes" hi={false} />
          </div>
          <div>
            <span className="cor-cap l">{W.despues}</span>
            <Frame v={v} width={width} side="despues" hi={hi} />
          </div>
        </div>
      );
    return <Frame v={v} width={width} side={shownSide} hi={hi} pins={pinsHere} onPin={pinning ? addPin : undefined} />;
  };

  return (
    <div className="cor-entrega" data-entrega={d.id}>
      <div className="cor-entrega-main">
        <div className="cor-entrega-head">
          <Link to={back} className="cor-strip-back" data-control="volver-ahora">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M9.5 3.5 5 8l4.5 4.5" />
            </svg>
            {w.back}
          </Link>
          <You />
          {d.ref && <Key>{d.ref}</Key>}
          <h2 className="cor-ellipsis" title={d.title}>
            {d.title}
          </h2>
        </div>
        {r && r.vistas.length > 0 && v && (
          <div className="cor-entrega-bar">
            <div className="cor-tabs" role="tablist" aria-label={w.views}>
              {r.vistas.map((x) => (
                <button key={x.key} type="button" role="tab" aria-selected={x.key === v.key} className="cor-tab" onClick={() => (setKey(x.key), setSide(null))} data-vista={x.key}>
                  {x.label}
                  <em>{kindWord(x.kind)}</em>
                </button>
              ))}
            </div>
            <span className="cor-entrega-modes">
              <span className="cor-segbox" role="group" aria-label={w.side}>
                {(["antes", "despues", "comparar"] as const).map((s) => (
                  <Opt key={s} on={shownSide === s} onClick={() => setSide(s)} data-side={s}>
                    {W[s]}
                  </Opt>
                ))}
              </span>
              <span className="cor-segbox" role="group" aria-label={w.size}>
                {(["desktop", "phone"] as const).map((x) => (
                  <Opt key={x} on={width === x} onClick={() => setWidth(x)} data-width={x}>
                    {W[x]}
                  </Opt>
                ))}
              </span>
            </span>
          </div>
        )}
        {state && r?.muestra && (
          <p className={`cor-cap ${r.state?.state === "fallo" ? "cor-state bad" : ""}`} role="status" data-photo-state={r.state?.state}>
            {state}
          </p>
        )}
        <div className="cor-stage" data-width={width} data-side={shownSide} data-pinning={pinning || undefined}>
          {stage()}
          {pinning && (
            <span className="cor-cap r" role="status">
              {w.tapPoint}
            </span>
          )}
        </div>
        <div className="cor-entrega-foot">
          <Opt on={hi} onClick={() => setHi((x) => !x)} data-control="resaltar">
            {W.resaltar}
          </Opt>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <input className="cor-input" value={ask} maxLength={400} placeholder={w.askPlaceholder} aria-label={w.askLabel} onChange={(e) => setAsk(e.target.value)} disabled={asking || !d.ref} />
            <Btn kind="secondary" type="submit" disabled={asking || !ask.trim() || !d.ref} data-control="preguntar">
              {asking ? w.sending : w.ask}
            </Btn>
          </form>
          <div className="cor-menu" ref={menu}>
            <Btn kind="secondary" aria-haspopup="menu" aria-expanded={more} onClick={() => setMore((x) => !x)} data-control="mas">
              {w.more}
            </Btn>
            {more && (
              <div className="cor-menu-list" role="menu">
                <Btn kind="quiet" role="menuitem" disabled={!single || !v} onClick={() => (setPinning((x) => !x), setMore(false))} data-control="senalar">
                  {pinning ? w.stopPointing : single ? w.point : w.pointPick}
                </Btn>
                {liveUrl ? (
                  <a className="cor-btn quiet" role="menuitem" href={liveUrl} target="_blank" rel="noreferrer" data-control="vivo">
                    {W.vivo} ↗
                  </a>
                ) : live?.phase === "live" ? (
                  <Btn kind="quiet" role="menuitem" onClick={() => (setMore(false), void abrir())} disabled={opening} data-control="abrir-vivo">
                    {opening ? w.entering : W.vivo}
                  </Btn>
                ) : (
                  <Btn kind="quiet" role="menuitem" onClick={() => (setMore(false), void encender())} disabled={starting || !d.ref || live?.phase === "starting"} data-control="encender">
                    {starting || live?.phase === "starting" ? W.encendiendo : `${W.vivo}: ${W.encender.toLowerCase()}`}
                  </Btn>
                )}
                {d.ref && r?.state?.state !== "tomando" && (
                  <Btn
                    kind="quiet"
                    role="menuitem"
                    disabled={retaking}
                    onClick={async () => {
                      setMore(false);
                      setRetaking(true);
                      await api.probadorTomar(p.slug, d.ref!).catch(() => null);
                      void read.refetch();
                    }}
                    data-control="tomar"
                  >
                    {retaking ? w.taking : W.tomar}
                  </Btn>
                )}
              </div>
            )}
          </div>
        </div>
        {/* PLA-91: the copy's state where it can be seen, not only inside «Más». */}
        {!liveUrl && (starting || live?.phase === "starting") && (
          <p className="cor-cap" role="status" data-copia="starting">
            {W.encendiendo}
          </p>
        )}
        {!liveUrl && !starting && live?.phase === "live" && (
          <p className="cor-cap" role="status" data-copia="live">
            {w.copyReady}{" "}
            <button type="button" className="cor-inline" onClick={() => void abrir()} disabled={opening} data-control="abrir-vivo-linea">
              {opening ? w.entering : W.vivo}
            </button>
          </p>
        )}
        {liveUrl && (
          <p className="cor-cap" role="status" data-copia="abierta">
            <a className="cor-inline" href={liveUrl} target="_blank" rel="noreferrer">
              {W.vivo} ↗
            </a>
          </p>
        )}
        {live?.phase === "failed" && (
          <p className="cor-cap" role="status" data-copia="failed">
            <span className="cor-state bad">{w.copyFailed}</span> {live.error ?? ""}
          </p>
        )}
        {vivo && (vivo.error || vivo.hint) && (
          <p className="cor-cap" role="status" data-vivo-note>
            {[vivo.error, vivo.hint].filter(Boolean).join(". ")}
          </p>
        )}
      </div>
      <aside className="cor-entrega-side" aria-label={w.decisionAndEvidence}>
        <section className="cor-decide" data-decide>
          <Label tone="amber">{w.decision}</Label>
          {d.state ? (
            <p className="cor-state ok">{w.decided}</p>
          ) : (
            <>
              <p className="cor-text">{siAceptas(null, null)[0]} {w.changesHint}</p>
              {/* PLA-70: every view came back the same, so the card shows nothing of the change (MIA-I9-1 showed the
                  list for «Ficha de una clienta»). Say so, and make asking for another sample the main move. */}
              {blind && (
                <p className="cor-hold" data-muestra-ciega>
                  {w.blind}
                </p>
              )}
              <div className="cor-acts">
                {accept && (
                  <Btn kind={blind || held ? "secondary" : "primary"} disabled={busy || !!d.hold} title={d.hold ?? acceptWords(d).aria} aria-label={acceptWords(d).aria} onClick={() => acts.decisions.decide(d, { action: accept }, "aceptar")} data-action={accept}>
                    {busy && acts.decisions.busy?.key === "aceptar" ? "…" : w.accept}
                  </Btn>
                )}
                {d.actions.includes("cambios") && (
                  <Btn kind={blind || held ? "primary" : "secondary"} aria-expanded={ajuste} onClick={() => setAjuste((x) => !x)} disabled={busy} data-action="cambios">
                    {w.askChange}
                  </Btn>
                )}
              </div>
              {d.hold && (
                <span className="cor-hold" data-hold>
                  {w.held(`${d.hold.charAt(0).toLowerCase()}${d.hold.slice(1)}`)}
                </span>
              )}
              {ajuste && <Ajuste d={d} acts={acts} marcas={pins} onDone={() => (setAjuste(false), setPins([]))} />}
            </>
          )}
          {error && (
            <p className="cor-state bad" role="alert">
              {error}
            </p>
          )}
        </section>
        <AutoSwitches p={p} acts={acts} compact />
        <section className="cor-ev" aria-label={w.evidence} data-evidencia>
          <Label as="h2">{w.evidence}</Label>
          <dl>
            <div>
              <dt>{w.whatChanges}</dt>
              <dd>{r?.muestra?.frase ?? (d.cambio === "no_se_ve" ? w.nothingOnScreen : d.cambio === "se_comporta" ? w.behaviour : "—")}</dd>
            </div>
            <div>
              <dt>{w.tests}</dt>
              <dd data-ok={ev.tests.ok === null ? undefined : String(ev.tests.ok)}>{ev.loading ? w.readingQa : `${ev.tests.value}${ev.tests.sub ? ` · ${ev.tests.sub}` : ""}`}</dd>
            </div>
            <div>
              <dt>{w.review}</dt>
              <dd>
                {/* AUDIT-6: two verdicts, a line each; a review with one verdict reads as before. */}
                {ev.loading
                  ? "…"
                  : ev.axes.length === 0
                    ? ev.review.value
                    : ev.axes.map((a) => (
                        <div key={a.axis} data-eje={a.axis} data-ok={String(a.ok)}>
                          {a.text}
                          {a.sub ? ` · ${a.sub}` : ""}
                        </div>
                      ))}
                {!ev.loading && ev.walked && (
                  <div data-recorrido={String(ev.walked.ok)}>{ev.walked.text}</div>
                )}
                {pr && (
                  <>
                    {" "}
                    <a className="cor-inline" href={pr} target="_blank" rel="noreferrer" data-control="ver-pr">
                      {w.seePr}
                    </a>
                  </>
                )}
              </dd>
            </div>
            <div>
              <dt>{w.published}</dt>
              <dd>{w.notYet}</dd>
            </div>
          </dl>
        </section>
        {pins.length > 0 && (
          <section aria-label={w.yourMarks} data-marcas-list={pins.length}>
            <Label as="h2">{w.marksCount(pins.length)}</Label>
            <ol className="cor-marcas">
              {pins.map((m, i) => (
                <li key={i}>
                  <b aria-hidden>{i + 1}</b>
                  <input className="cor-input" value={m.note} maxLength={MARK_MAX} placeholder={w.markPlaceholder} aria-label={w.markNote(i + 1)} onChange={(e) => setPins((l) => l.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)))} />
                  <Btn kind="quiet" small aria-label={w.markRemove(i + 1)} onClick={() => setPins((l) => l.filter((_, j) => j !== i))}>
                    ×
                  </Btn>
                </li>
              ))}
            </ol>
          </section>
        )}
        {qas.length > 0 && (
          <section aria-label={w.yourQuestions} data-preguntas={qas.length}>
            <Label as="h2">{w.questions}</Label>
            {qas.map((q) => (
              <div key={q.id} className="cor-qa">
                <span>{q.text}</span>
                <span className="cor-muted">{q.answer ? q.answer.text : w.received}</span>
              </div>
            ))}
          </section>
        )}
      </aside>
    </div>
  );
};

// PLA-82 (F-26): «Volver a tomar las fotos» takes the card off the floor until the new pictures exist, and the open
// card jumped to «Esta entrega ya no espera tu decisión». While its pictures are being taken it says so instead
// (no buttons: nothing to accept until they exist); otherwise the old words stay.
export const EntregaRetomando = ({ p, d, onBack }: { p: OrgProject; d: Decision; onBack: () => void }) => {
  const w = words(ENTREGA_WORDS);
  const read = useProbadorRead(p.slug, d.ref);
  const tomando = read.data?.state?.state === "tomando" || read.isPending;
  return (
    <div className="cor-empty" data-entrega-retomando={tomando ? "tomando" : "fuera"}>
      <p className="cor-text" role="status">
        {tomando ? w.retaking(d.ref ?? null) : w.gone}
      </p>
      <Btn kind="secondary" onClick={onBack}>
        {w.backToList}
      </Btn>
    </div>
  );
};
