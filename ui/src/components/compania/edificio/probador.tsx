// PLA-I52-4: El Probador. Nobody approves what they cannot see: a delivery's card leads with its pictures.
// ProbadorStrip sits in Ahora's card (one still per view, marked nueva or cambió; a click opens the layer on that
// view). ProbadorViewer sits in the «Al frente» layer: the views as tabs, Antes / Después / Comparar (a line to
// drag), Escritorio / Teléfono, Resaltar cambios (the box around what changed), Pruébala en vivo (the delivery's own
// copy), the three steps and what accepting does. Pure parts in lib/probador.ts.
import { memo, useState, type CSSProperties } from "react";
import { api, type Decision, type OrgProject, type ParVista, type ProbadorRead, type VivoRead } from "@/lib/api";
import { KIND_WORD, PROBADOR_WORDS as W, firstVista, frameOf, sideFor, siAceptas, stateLine, type Side, type Width } from "@/lib/probador";
import { openLayer, setView, viewOf } from "./evidence-store";

const Frame = ({ v, width, side, hi }: { v: ParVista; width: Width; side: "antes" | "despues"; hi: boolean }) => {
  const f = frameOf(v, width, side);
  if (f.kind === "nueva")
    return (
      <div className="edi-pbnone" data-frame="nueva">
        <b>{KIND_WORD.nueva}</b>
        <span>{W.nueva}</span>
      </div>
    );
  if (f.kind === "none")
    return (
      <div className="edi-pbnone" data-frame="none">
        <b>{W.sinFoto}</b>
        <span>{f.why}</span>
      </div>
    );
  const box = side === "despues" && hi ? v[width].diff : null;
  return (
    <div className="edi-pbimg" data-frame="still">
      <img src={f.src} alt={f.alt} decoding="async" />
      {box && <i className="edi-pbbox" aria-hidden style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.w * 100}%`, height: `${box.h * 100}%` } as CSSProperties} />}
    </div>
  );
};

export const ProbadorStrip = memo(function ProbadorStrip({ p, d, read }: { p: OrgProject; d: Decision; read: ProbadorRead }) {
  const line = stateLine(read);
  return (
    <div className="edi-evt edi-pbstrip" data-ev="probador">
      {read.muestra && <p className="edi-pbfrase">{read.muestra.frase}</p>}
      {line && <p className="edi-pbstate">{line}</p>}
      <div className="edi-pbthumbs">
        {read.vistas.map((v) => {
          const f = frameOf(v, "desktop", "despues");
          return (
            <button
              key={v.key}
              type="button"
              className="edi-pbthumb"
              data-vista={v.key}
              onClick={(e) => {
                setView(d.id, v.key);
                openLayer(p.slug, d.id, e.currentTarget);
              }}
            >
              <span className="edi-pbthumbimg">{f.kind === "still" ? <img src={f.src} alt="" loading="lazy" decoding="async" /> : <span>{W.sinFoto}</span>}</span>
              <span className="edi-pbcap">
                <em className="edi-pbk" data-kind={v.kind}>
                  {KIND_WORD[v.kind]}
                </em>
                <span>{v.label}</span>
                <span className="sr-only">, {W.abrir}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
});

export const ProbadorViewer = memo(function ProbadorViewer({ p, d, read }: { p: OrgProject; d: Decision; read: ProbadorRead }) {
  const start = viewOf(d.id) ?? firstVista(read);
  const [key, setKey] = useState<string | null>(start);
  const v = read.vistas.find((x) => x.key === key) ?? read.vistas[0];
  const [side, setSide] = useState<Side>(sideFor(v));
  // On a phone the viewer opens on the phone's own pictures.
  const [width, setWidth] = useState<Width>(() => (typeof window !== "undefined" && window.matchMedia?.("(width < 40rem)").matches ? "phone" : "desktop"));
  const [hi, setHi] = useState(true);
  const [line, setLine] = useState(50);
  const [seen, setSeen] = useState<number[]>([]);
  const [live, setLive] = useState(read.entrega);
  const [starting, setStarting] = useState(false);
  const [retaking, setRetaking] = useState(false);
  const [vivo, setVivo] = useState<VivoRead | null>(null);
  const [opening, setOpening] = useState(false);
  const [pass, setPass] = useState<string | null>(null);
  if (!v) return null;
  const state = stateLine(read);
  // The line to drag only when both sides have a picture at this width; otherwise side by side.
  const slide = width === "desktop" && v.desktop.antes.still !== null && v.desktop.despues.still !== null;
  const pick = (k: string) => {
    const nv = read.vistas.find((x) => x.key === k);
    setKey(k);
    setView(d.id, k);
    setSide(sideFor(nv));
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
  // PLA-I52-5: the live copy opens through Plania's proxy, signed in; on the tailnet when the Mac has Tailscale.
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
  const liveUrl = vivo?.url ? vivo.url + v.path : null;
  const liveOn = live?.phase === "live";
  const id = (s: string) => `pb-${d.id}-${s}`;
  const viewer = (
    <section className="edi-pb" data-probador={d.id} aria-label="El Probador">
      {read.muestra && <p className="edi-pbfrase">{read.muestra.frase}</p>}
      {state && (
        <p className="edi-pbstate" role="status">
          {state}
        </p>
      )}
      <div className="edi-pbbar">
        <div className="edi-pbtabs" role="tablist" aria-label="Vistas de la entrega">
          {read.vistas.map((x) => (
            <button key={x.key} type="button" role="tab" id={id(`tab-${x.key}`)} aria-selected={x.key === v.key} aria-controls={id("stage")} className="edi-pbtab" onClick={() => pick(x.key)} data-vista={x.key}>
              {x.label}
              <em className="edi-pbk" data-kind={x.kind}>
                {KIND_WORD[x.kind]}
              </em>
            </button>
          ))}
        </div>
        <div className="edi-pbsegs">
          <div className="edi-pbseg" role="group" aria-label="Lado">
            {(["antes", "despues", "comparar"] as const).map((s) => (
              <button key={s} type="button" aria-pressed={side === s} onClick={() => setSide(s)} data-side={s}>
                {W[s]}
              </button>
            ))}
          </div>
          <div className="edi-pbseg" role="group" aria-label="Tamaño">
            {(["desktop", "phone"] as const).map((w) => (
              <button key={w} type="button" aria-pressed={width === w} onClick={() => setWidth(w)} data-width={w}>
                {W[w]}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="edi-pbstage" id={id("stage")} role="tabpanel" aria-labelledby={id(`tab-${v.key}`)} data-width={width} data-side={side}>
        {side === "comparar" ? (
          slide ? (
            <div className="edi-pbcmp" style={{ "--line": `${line}%` } as CSSProperties}>
              <Frame v={v} width={width} side="antes" hi={false} />
              <div className="edi-pbafter">
                <Frame v={v} width={width} side="despues" hi={hi} />
              </div>
              <i className="edi-pbline" aria-hidden />
              <span className="edi-pbl" aria-hidden>
                {W.antes}
              </span>
              <span className="edi-pbr" aria-hidden>
                {W.despues}
              </span>
            </div>
          ) : (
            <div className="edi-pbpair">
              <figure>
                <figcaption>{W.antes}</figcaption>
                <Frame v={v} width={width} side="antes" hi={false} />
              </figure>
              <figure>
                <figcaption>{W.despues}</figcaption>
                <Frame v={v} width={width} side="despues" hi={hi} />
              </figure>
            </div>
          )
        ) : (
          <Frame v={v} width={width} side={side} hi={hi} />
        )}
      </div>
      <div className="edi-pbfoot">
        <span className="edi-pbpath">
          <code>{v.path}</code>
          {v.estado ? ` · ${v.estado}` : ""}
        </span>
        {side === "comparar" && slide && (
          <label className="edi-pbrange">
            Línea
            <input type="range" min={2} max={98} value={line} onChange={(e) => setLine(Number(e.target.value))} aria-label="Línea entre antes y después" />
          </label>
        )}
        <button type="button" role="switch" className="edi-sw" aria-checked={hi} onClick={() => setHi((x) => !x)} data-control="resaltar">
          <i aria-hidden />
          {W.resaltar}
        </button>
        {liveUrl ? (
          <a className="edi-btn edi-pblive" href={liveUrl} target="_blank" rel="noreferrer" data-control="vivo">
            {W.vivo} ↗
          </a>
        ) : liveOn ? (
          <button type="button" className="edi-btn edi-pblive" onClick={abrir} disabled={opening} data-control="abrir-vivo">
            {opening ? "Entrando…" : W.vivo}
          </button>
        ) : (
          <button type="button" className="edi-btn" onClick={encender} disabled={starting || !d.ref || live?.phase === "starting"} data-control="encender">
            {starting || live?.phase === "starting" ? W.encendiendo : W.encender}
          </button>
        )}
        {d.ref && read.state?.state !== "tomando" && (
          <button
            type="button"
            className="edi-vlink"
            disabled={retaking}
            onClick={async () => {
              setRetaking(true);
              await api.probadorTomar(p.slug, d.ref!).catch(() => null);
            }}
            data-control="tomar"
          >
            {retaking ? "Tomando…" : W.tomar}
          </button>
        )}
      </div>
      {vivo && (vivo.error || vivo.hint || !vivo.signed_in) && (
        <div className="edi-pbvivo" role="status" data-vivo-note>
          {vivo.error && <span>{vivo.error}.</span>}
          {!vivo.signed_in && vivo.user && (
            <span>
              Entra como <code>{vivo.user}</code>{" "}
              <button
                type="button"
                className="edi-vlink"
                data-control="contrasena"
                onClick={async () => {
                  const r = await api.contrasena(p.slug).catch(() => null);
                  if (r) {
                    setPass(r.password);
                    await navigator.clipboard?.writeText(r.password).catch(() => null);
                  }
                }}
              >
                Copiar contraseña
              </button>
              {pass && <code className="edi-pbpass">{pass}</code>}
            </span>
          )}
          {vivo.hint && <span>{vivo.hint}</span>}
        </div>
      )}
    </section>
  );
  return (
    <>
      {viewer}
      {read.muestra && (
        <div className="edi-pbrow edi-pbside">
          <div className="edi-evt" data-ev="pasos">
            <p className="edi-peye">
              {W.pasos} · {seen.length} de {read.muestra.pasos.length}
            </p>
            <ol className="edi-pbsteps">
              {read.muestra.pasos.map((t, i) => (
                <li key={i}>
                  <button type="button" aria-pressed={seen.includes(i)} onClick={() => setSeen((x) => (x.includes(i) ? x.filter((n) => n !== i) : [...x, i]))} data-paso={i + 1}>
                    <i aria-hidden>{seen.includes(i) ? "✓" : i + 1}</i>
                    {t}
                  </button>
                </li>
              ))}
            </ol>
          </div>
          <div className="edi-evt edi-pbsi" data-ev="si-aceptas">
            <p className="edi-peye">{W.siAceptas}</p>
            {siAceptas(null, null).map((t) => (
              <span key={t}>{t}</span>
            ))}
          </div>
        </div>
      )}
    </>
  );
});
