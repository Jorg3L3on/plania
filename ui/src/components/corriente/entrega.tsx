// PLA-I62-4: a delivery's review (board B4), El Probador redrawn. The views it touched as tabs (each says nueva,
// cambió, igual), Antes / Después / Comparar (a line to drag, also with the arrow keys), Escritorio / Teléfono,
// Resaltar cambios (the box around what changed), pins on a picture (Señalar algo) that go with Pedir ajuste, a
// question for Taller, and behind Más: Señalar algo, Pruébala en vivo (its own copy), Volver a tomar las fotos.
// Right: the decision (Aceptar, Pedir ajuste), «Se aprueba sola» and why it did not, the evidence (what changes,
// tests, the separate review with its PR, what is published) and the pins. The calls are /ceo's.
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { Link } from "react-router";
import { api, type Decision, type Marca, type OrgProject, type ParVista, type ProbadorQA, type VivoRead } from "@/lib/api";
import { acceptWords, evidenceView } from "@/lib/evidencia";
import { KIND_WORD, PROBADOR_WORDS as W, firstVista, frameOf, sideFor, siAceptas, stateLine, type Side, type Width } from "@/lib/probador";
import type { CorrienteActs } from "./acts";
import { Ajuste } from "./ajuste";
import { Btn, Key, Label, Opt, ReadError, You } from "./parts";
import { AutoSwitches } from "./pendiente";
import { useProbadorRead, useQaRead } from "./reads";

type Pin = Marca & { n: number };

const Frame = ({ v, width, side, hi, pins = [], onPin }: { v: ParVista; width: Width; side: "antes" | "despues"; hi: boolean; pins?: Pin[]; onPin?: (x: number, y: number) => void }) => {
  const f = frameOf(v, width, side);
  if (f.kind === "nueva")
    return (
      <div className="cor-noshot" data-frame="nueva">
        <b>Pantalla nueva</b>
        <span className="cor-text">{W.nueva}</span>
      </div>
    );
  if (f.kind === "none")
    return (
      <div className="cor-noshot" data-frame="none">
        <b>{W.sinFoto}</b>
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
      <div style={{ position: "relative", width: "100%" }}>
        <img src={f.src} alt={f.alt} decoding="async" />
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
        aria-label="Línea entre antes y después"
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
  const read = useProbadorRead(p.slug, d.ref);
  const qa = useQaRead(p.slug, d.ref);
  const r = read.data;
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
  const abrir = async () => {
    setOpening(true);
    try {
      setVivo((await api.vivo(p.slug)).vivo);
    } catch {
      setVivo({ url: null, local_url: null, tailnet: false, signed_in: false, user: null, error: "No se pudo abrir la copia en vivo", hint: null });
    } finally {
      setOpening(false);
    }
  };
  const liveUrl = vivo?.url && v ? vivo.url + v.path : null;
  const pr = (d.links ?? []).find((l) => l.kind === "pr")?.ref ?? ev.pr;

  const stage = () => {
    if (read.isPending) return <div className="cor-skel" style={{ position: "absolute", inset: 0 }} aria-busy="true" aria-label="Leyendo las fotos" />;
    if (read.isError) return <ReadError what="las fotos de la entrega" onRetry={() => void read.refetch()} />;
    if (!r || !r.muestra || !v)
      return (
        <div className="cor-noshot" data-stage="sin-fotos">
          <b>{r?.state?.state === "tomando" ? "Tomando las fotos de la entrega…" : "Esta entrega no tiene fotos"}</b>
          <span className="cor-text">{r?.state?.state === "tomando" ? "Aparecen aquí en cuanto estén." : (state ?? (d.cambio === "no_se_ve" ? "Nada cambia en pantalla: juzga con las pruebas y la revisión." : "Juzga con las pruebas y la revisión, o pide a Taller que la muestre."))}</span>
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
            Ahora
          </Link>
          <You />
          {d.ref && <Key>{d.ref}</Key>}
          <h2 className="cor-ellipsis" title={d.title}>
            {d.title}
          </h2>
        </div>
        {r && r.vistas.length > 0 && v && (
          <div className="cor-entrega-bar">
            <div className="cor-tabs" role="tablist" aria-label="Vistas de la entrega">
              {r.vistas.map((x) => (
                <button key={x.key} type="button" role="tab" aria-selected={x.key === v.key} className="cor-tab" onClick={() => (setKey(x.key), setSide(null))} data-vista={x.key}>
                  {x.label}
                  <em>{KIND_WORD[x.kind]}</em>
                </button>
              ))}
            </div>
            <span style={{ display: "flex", gap: 10 }}>
              <span className="cor-segbox" role="group" aria-label="Lado">
                {(["antes", "despues", "comparar"] as const).map((s) => (
                  <Opt key={s} on={shownSide === s} onClick={() => setSide(s)} data-side={s}>
                    {W[s]}
                  </Opt>
                ))}
              </span>
              <span className="cor-segbox" role="group" aria-label="Tamaño">
                {(["desktop", "phone"] as const).map((w) => (
                  <Opt key={w} on={width === w} onClick={() => setWidth(w)} data-width={w}>
                    {W[w]}
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
              Toca el punto que quieres cambiar
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
            <input className="cor-input" value={ask} maxLength={400} placeholder="Pregúntale a Taller sobre esta entrega" aria-label="Pregunta para Taller" onChange={(e) => setAsk(e.target.value)} disabled={asking || !d.ref} />
            <Btn kind="secondary" type="submit" disabled={asking || !ask.trim() || !d.ref} data-control="preguntar">
              {asking ? "Enviando…" : "Preguntar"}
            </Btn>
          </form>
          <div className="cor-menu" ref={menu}>
            <Btn kind="secondary" aria-haspopup="menu" aria-expanded={more} onClick={() => setMore((x) => !x)} data-control="mas">
              Más ▾
            </Btn>
            {more && (
              <div className="cor-menu-list" role="menu">
                <Btn kind="quiet" role="menuitem" disabled={!single || !v} onClick={() => (setPinning((x) => !x), setMore(false))} data-control="senalar">
                  {pinning ? "Dejar de señalar" : single ? "Señalar algo" : "Señalar algo (elige Antes o Después)"}
                </Btn>
                {liveUrl ? (
                  <a className="cor-btn quiet" role="menuitem" href={liveUrl} target="_blank" rel="noreferrer" data-control="vivo">
                    {W.vivo} ↗
                  </a>
                ) : live?.phase === "live" ? (
                  <Btn kind="quiet" role="menuitem" onClick={() => (setMore(false), void abrir())} disabled={opening} data-control="abrir-vivo">
                    {opening ? "Entrando…" : W.vivo}
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
                    {retaking ? "Tomando…" : W.tomar}
                  </Btn>
                )}
              </div>
            )}
          </div>
        </div>
        {vivo && (vivo.error || vivo.hint) && (
          <p className="cor-cap" role="status" data-vivo-note>
            {[vivo.error, vivo.hint].filter(Boolean).join(". ")}
          </p>
        )}
      </div>
      <aside className="cor-entrega-side" aria-label="Tu decisión y la evidencia">
        <section className="cor-decide" data-decide>
          <Label tone="amber">Tu decisión</Label>
          {d.state ? (
            <p className="cor-state ok">✓ Ya decidiste sobre esta entrega.</p>
          ) : (
            <>
              <p className="cor-text">{siAceptas(null, null)[0]} Pedir ajuste la devuelve a Taller con tus marcas.</p>
              <div className="cor-acts">
                {accept && (
                  <Btn kind="primary" disabled={busy || !!d.hold} title={d.hold ?? acceptWords(d).aria} aria-label={acceptWords(d).aria} onClick={() => acts.decisions.decide(d, { action: accept }, "aceptar")} data-action={accept}>
                    {busy && acts.decisions.busy?.key === "aceptar" ? "…" : "Aceptar"}
                  </Btn>
                )}
                {d.actions.includes("cambios") && (
                  <Btn kind="secondary" aria-expanded={ajuste} onClick={() => setAjuste((x) => !x)} disabled={busy} data-action="cambios">
                    Pedir ajuste
                  </Btn>
                )}
              </div>
              {d.hold && (
                <span className="cor-hold" data-hold>
                  {d.hold}
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
        <section className="cor-ev" aria-label="Evidencia" data-evidencia>
          <Label as="h2">Evidencia</Label>
          <dl>
            <div>
              <dt>Qué cambia</dt>
              <dd>{r?.muestra?.frase ?? (d.cambio === "no_se_ve" ? "Nada cambia en pantalla" : d.cambio === "se_comporta" ? "Cambia lo que hace la app" : "—")}</dd>
            </div>
            <div>
              <dt>Pruebas</dt>
              <dd data-ok={ev.tests.ok === null ? undefined : String(ev.tests.ok)}>{ev.loading ? "Leyendo lo que vio QA…" : `${ev.tests.value}${ev.tests.sub ? ` · ${ev.tests.sub}` : ""}`}</dd>
            </div>
            <div>
              <dt>Revisión</dt>
              <dd>
                {ev.loading ? "…" : ev.review.value}
                {pr && (
                  <>
                    {" "}
                    <a className="cor-inline" href={pr} target="_blank" rel="noreferrer" data-control="ver-pr">
                      Ver el PR
                    </a>
                  </>
                )}
              </dd>
            </div>
            <div>
              <dt>Publicado</dt>
              <dd>Aún no tiene este cambio.</dd>
            </div>
          </dl>
        </section>
        {pins.length > 0 && (
          <section aria-label="Tus marcas" data-marcas-list={pins.length}>
            <Label as="h2">{`Tus marcas · ${pins.length}`}</Label>
            <ol className="cor-marcas">
              {pins.map((m, i) => (
                <li key={i}>
                  <b aria-hidden>{i + 1}</b>
                  <input className="cor-input" value={m.note} maxLength={300} placeholder="Qué quieres que cambie" aria-label={`Nota de la marca ${i + 1}`} onChange={(e) => setPins((l) => l.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)))} />
                  <Btn kind="quiet" small aria-label={`Quitar la marca ${i + 1}`} onClick={() => setPins((l) => l.filter((_, j) => j !== i))}>
                    ×
                  </Btn>
                </li>
              ))}
            </ol>
          </section>
        )}
        {qas.length > 0 && (
          <section aria-label="Tus preguntas a Taller" data-preguntas={qas.length}>
            <Label as="h2">Preguntas a Taller</Label>
            {qas.map((q) => (
              <div key={q.id} className="cor-qa">
                <span>{q.text}</span>
                <span className="cor-muted">{q.answer ? q.answer.text : "Taller la recibió. Te responde aquí."}</span>
              </div>
            ))}
          </section>
        )}
      </aside>
    </div>
  );
};
