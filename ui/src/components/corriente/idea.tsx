// PLA-I62-7: an idea open (board C2), La idea abierta (PLA-I61) redrawn. Its six stops on a rail, each saying where it
// stands; the open stop's delivery on the left (what the PO understood, Research's recommendation, Artist's frames
// with numbered notes pinned on the frame, the plan's steps) and ONE decision card on the right (Así es / Corregir,
// Va con la recomendada / Pedir la opción N, Me gusta / Enviar notas a Artist, Me gusta / Pide cambios), with
// Deshacer after a «me gusta». The PO's question takes the card while it waits. Recorrido is the trail. Constrúyelo;
// Guardar, Restaurar and Descartar behind Más; a note (and pictures) for the team; Despertar on a quiet stop.
// Opening a delivery he had not seen tells the server (visto). Calls: GET …/ideas/:key and the building's writes.
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Link } from "react-router";
import { api, type IdeaAnswerInput, type IdeaDetail, type IdeaNote, type IdeaStop, type OrgProject, type PedidoStop, type PedidoTrailItem } from "@/lib/api";
import { seatName } from "@/lib/corriente";
import type { CorrienteActs } from "./acts";
import { Images } from "./images";
import { Btn, Key, Label, Opt, ReadError } from "./parts";

export const STOPS: { id: PedidoStop; name: string }[] = [
  { id: "buzon", name: "Buzón" },
  { id: "entendido", name: "Entendido" },
  { id: "investigacion", name: "Investigación" },
  { id: "diseno", name: "Diseño" },
  { id: "plan", name: "Plan" },
  { id: "lista", name: "Lista" },
];
const ANSWERABLE: PedidoStop[] = ["entendido", "investigacion", "diseno", "plan"];
const stopWord = (s: PedidoStop) => STOPS.find((x) => x.id === s)?.name ?? s;
export const whoName = (who: string | null) => (!who ? "" : who === "jorge" ? "Tú" : seatName(who));
const hm = (iso: string, timeZone?: string) => new Intl.DateTimeFormat("es-MX", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).format(new Date(iso));
const dayHm = (iso: string, now: number, timeZone?: string) => {
  const day = (t: number) => new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", timeZone }).format(new Date(t)).replace(".", "");
  return day(Date.parse(iso)) === day(now) ? hm(iso, timeZone) : `${day(Date.parse(iso))} ${hm(iso, timeZone)}`;
};
const isOpen = (d: IdeaDetail) => d.status === "Open" && !d.promoted_to;

/** The stop to open: the newest delivery he has not seen, else where the idea is. */
export function firstStop(d: Pick<IdeaDetail, "stops" | "stop">): PedidoStop {
  const unseen = [...d.stops].reverse().find((s) => s.delivered && !s.seen && s.stop !== "buzon");
  return unseen?.stop ?? d.stop;
}

/** The line under a stop, in the kit's words. */
export function stopLine(s: IdeaStop, d: Pick<IdeaDetail, "quiet_since" | "state" | "queued">): { text: string; tone: "you" | "live" | "new" | "ok" | "" } {
  const who = whoName(s.by);
  if (s.stop === "buzon") return { text: `Tú${s.at ? "" : ""}`, tone: "" };
  if (s.state === "here") {
    if (d.state === "trabajando") return { text: `${who || "Alguien"} la trabaja`, tone: "live" };
    if (d.queued) return { text: `En la fila de ${whoName(d.queued)}`, tone: "live" };
    if (d.state === "espera") return { text: "Te pregunta", tone: "you" };
    if (s.stop === "lista") return { text: "Espera «Constrúyelo»", tone: "you" };
    if (!s.delivered) return { text: d.quiet_since ? "Quieta" : "Por hacer", tone: "" };
  }
  if (!s.delivered) return { text: s.state === "todo" ? "Todavía no" : "—", tone: "" };
  if (s.state === "todo") return { text: "Se rehace", tone: "" };
  if (s.answer?.verdict === "ok") return { text: `${who} · ${s.stop === "entendido" ? "así es" : "te gustó"}`, tone: "ok" };
  if (s.answer) return { text: `${who} · pediste cambios`, tone: "live" };
  if (!s.seen) return { text: `${who} · sin ver`, tone: "new" };
  return { text: `${who} · visto`, tone: "" };
}

type Ui = { stop: PedidoStop; sub: "entregas" | "recorrido"; frame: number; pins: IdeaNote[]; text: string; asking: boolean; pick: number | null; note: string; answer: string; drop: boolean; more: boolean };
const initialUi = (d: Pick<IdeaDetail, "stops" | "stop">): Ui => ({ stop: firstStop(d), sub: "entregas", frame: 0, pins: [], text: "", asking: false, pick: null, note: "", answer: "", drop: false, more: false });

type Links = { back: string; doc: (id: string) => string; track: (key: string) => string };

const Delivery = ({ d, s, ui, set, links, now, timeZone, onDespertar, busy }: { d: IdeaDetail; s: IdeaStop; ui: Ui; set: (p: Partial<Ui>) => void; links: Links; now: number; timeZone?: string; onDespertar: () => void; busy: boolean }) => {
  const eyebrow = (extra?: string) => (
    <div className="cor-idea-eb">
      <Label>{[stopWord(s.stop), s.by ? `${whoName(s.by)} entregó` : null, s.at ? dayHm(s.at, now, timeZone) : null, extra].filter(Boolean).join(" · ")}</Label>
      {s.doc && (
        <Link className="cor-btn quiet small" to={links.doc(s.doc.id)} data-control="idea-doc">
          Leer el doc
        </Link>
      )}
    </div>
  );
  if (s.stop === "buzon")
    return (
      <div className="cor-idea-stop">
        <Label>{d.pedido ? `Tú · ${s.at ? dayHm(s.at, now, timeZone) : ""} · desde Pedir` : `Idea de ${whoName(d.who)}`}</Label>
        <p className="cor-idea-quote">«{d.text}»</p>
        {d.pictures.length > 0 && <p className="cor-cap">{d.pictures.length === 1 ? "Con una imagen." : `Con ${d.pictures.length} imágenes.`}</p>}
      </div>
    );
  if (s.stop === "lista")
    return (
      <div className="cor-idea-stop">
        <p className="cor-h3">{d.promoted_to ? `Ya es ${d.promoted_to} en el tablero.` : "Cuando el plan esté, «Constrúyelo» la sube al tablero como iniciativa."}</p>
        {!d.promoted_to && d.pedido && <p className="cor-text">También puedes pedirlo ya: el PO termina lo que falte y crea la iniciativa.</p>}
      </div>
    );
  if (!s.delivered)
    return (
      <div className="cor-idea-stop cor-empty" data-stop-empty={s.stop}>
        <p className="cor-h3">{s.stop === "entendido" ? "El PO todavía no escribe lo que entendió." : s.stop === "investigacion" ? "Research todavía no entrega." : s.stop === "diseno" ? "Artist todavía no entrega el diseño." : "Nadie arma el plan todavía."}</p>
        {d.quiet_since && isOpen(d) && (
          <>
            <p className="cor-text">{`Quieta desde las ${hm(d.quiet_since, timeZone)}. Si la despiertas, ${d.stage === "research" ? "Research" : d.stage === "design" ? "Artist" : "el PO"} la toma en su siguiente turno.`}</p>
            <Btn kind="secondary" disabled={busy} onClick={onDespertar} data-control="idea-despertar">
              Despertar
            </Btn>
          </>
        )}
      </div>
    );
  if (s.stop === "entendido") {
    const cells: [string, string | null][] = [
      ["Problema", d.ficha.problema],
      ["Tamaño", d.ficha.tamano],
      ["Solución", d.ficha.solucion],
      ["Riesgos", d.ficha.riesgos],
      ["Fuera", d.ficha.fuera],
    ];
    return (
      <div className="cor-idea-stop">
        {eyebrow("lo que entendió")}
        {d.understood && <p className="cor-idea-quote">{d.understood.replace(/^\s*entend[ií]\s*[:：-]\s*/i, "")}</p>}
        <dl className="cor-ev cor-idea-cells">
          {cells.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd className={v ? "" : "cor-muted"}>{v ? v.replace(/[*_`#]/g, "") : "Pendiente"}</dd>
            </div>
          ))}
        </dl>
      </div>
    );
  }
  if (s.stop === "investigacion")
    return (
      <div className="cor-idea-stop cor-scroll" tabIndex={0} role="region" aria-label="Investigación">
        {eyebrow()}
        <Label tone="violet">Recomienda</Label>
        <div className="cor-md">
          <Markdown remarkPlugins={[remarkGfm]}>{d.research.recommendation ?? "Sin recomendación escrita."}</Markdown>
        </div>
        {d.research.unknown.length > 0 && (
          <>
            <Label>Lo que todavía no se sabe</Label>
            <ul className="cor-md">
              {d.research.unknown.map((u) => (
                <li key={u}>{u}</li>
              ))}
            </ul>
          </>
        )}
      </div>
    );
  if (s.stop === "plan")
    return (
      <div className="cor-idea-stop">
        {eyebrow()}
        {d.plan_steps.length ? (
          <ol className="cor-plan-steps">
            {d.plan_steps.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ol>
        ) : (
          <p className="cor-text">El plan no trae una lista de pasos; ábrelo completo.</p>
        )}
      </div>
    );
  // Diseño: the frames, the big one with the notes pinned on it.
  if (!d.frames.length)
    return (
      <div className="cor-idea-stop">
        {eyebrow()}
        <p className="cor-text">Artist escribió el doc pero no subió los marcos. Ábrelo completo.</p>
      </div>
    );
  const i = Math.min(ui.frame, d.frames.length - 1);
  const f = d.frames[i]!;
  const canPin = isOpen(d) && !s.answer;
  const pins = ui.pins.map((p, n) => ({ ...p, n: n + 1 })).filter((p) => p.frame === f.frame);
  return (
    <div className="cor-idea-stop">
      {eyebrow(`marco ${i + 1} de ${d.frames.length}`)}
      <div className="cor-frames">
        <div className="cor-frames-list" role="group" aria-label="Marcos">
          {d.frames.map((x, n) => (
            <button key={x.id} type="button" className="cor-opt" aria-pressed={n === i} onClick={() => set({ frame: n })} title={`${x.frame} · ${x.name}`} data-control="idea-marco">
              {x.frame}
              {ui.pins.some((p) => p.frame === x.frame) && <small>{ui.pins.filter((p) => p.frame === x.frame).length}</small>}
            </button>
          ))}
        </div>
        <div className="cor-frame-col">
          <div
            className="cor-frame-big"
            role={canPin ? "button" : undefined}
            tabIndex={canPin ? 0 : undefined}
            aria-label={canPin ? `Marco ${f.frame}: toca un punto para dejar una nota ahí` : `Marco ${f.frame}`}
            style={{ aspectRatio: f.width && f.height ? `${f.width} / ${f.height}` : undefined } as CSSProperties}
            onClick={(e) => {
              if (!canPin) return;
              const r = e.currentTarget.getBoundingClientRect();
              set({ pins: [...ui.pins, { frame: f.frame, x: Math.round(((e.clientX - r.left) / r.width) * 1000) / 10, y: Math.round(((e.clientY - r.top) / r.height) * 1000) / 10, text: "" }] });
            }}
            data-control="idea-clavar"
          >
            <img src={f.url} alt={`Marco ${f.frame}: ${f.name}`} draggable={false} />
            {pins.map((p) => (
              <i key={p.n} className="cor-pin" style={{ left: `${p.x}%`, top: `${p.y}%` }} aria-hidden>
                {p.n}
              </i>
            ))}
          </div>
          <dl className="cor-idea-why">
            <div>
              <dt className="cor-label">Qué hace</dt>
              <dd>{f.hace ?? f.name}</dd>
            </div>
            <div>
              <dt className="cor-label">Por qué</dt>
              <dd>{f.porque ?? "—"}</dd>
            </div>
          </dl>
        </div>
      </div>
    </div>
  );
};

/** The one decision card for the open stop (or what he answered, with Deshacer). */
const Decide = ({ d, s, ui, set, send, busy, onConstruir }: { d: IdeaDetail; s: IdeaStop; ui: Ui; set: (p: Partial<Ui>) => void; send: (i: Omit<IdeaAnswerInput, "stop">) => void; busy: boolean; onConstruir: () => void }) => {
  if (s.stop === "lista" && isOpen(d) && !d.guardada)
    return (
      <section className="cor-decide" data-decide="lista">
        <Label tone="amber">Lista para construir</Label>
        <p className="cor-text">Pasa al tablero como iniciativa y Taller empieza por el primer paso. Nadie construye sin tu «Constrúyelo».</p>
        <Btn kind="primary" disabled={busy || d.state === "valvula"} onClick={onConstruir} data-control="idea-construir">
          {d.state === "valvula" ? "Pasando al tablero…" : "Constrúyelo"}
        </Btn>
      </section>
    );
  if (!ANSWERABLE.includes(s.stop) || !s.delivered) return null;
  if (s.answer) {
    const a = s.answer;
    const said =
      a.verdict === "ok"
        ? s.stop === "entendido"
          ? "Le dijiste al PO que así es."
          : s.stop === "investigacion"
            ? "Vas con la recomendada."
            : `Te gustó ${s.stop === "diseno" ? "el diseño" : "el plan"}.`
        : a.verdict === "opcion"
          ? `Pediste la opción ${a.option}.`
          : a.verdict === "corregir"
            ? "Corregiste al PO."
            : a.notes.length
              ? `Pediste cambios con ${a.notes.length} ${a.notes.length === 1 ? "nota" : "notas"}.`
              : "Pediste cambios.";
    return (
      <section className="cor-card cor-said" data-said={a.verdict}>
        <p className="cor-text">
          <b>{said}</b> {a.verdict === "ok" ? "Nada se detiene." : `Volvió a ${stopWord(s.stop)}; lo que sigue se rehace.`}
        </p>
        {a.verdict === "ok" && isOpen(d) && (
          <Btn kind="link" disabled={busy} onClick={() => send({ verdict: "deshacer" })} data-control="idea-deshacer">
            Deshacer
          </Btn>
        )}
      </section>
    );
  }
  if (!isOpen(d)) return null;
  if (s.stop === "investigacion") {
    const pick = ui.pick ?? 1;
    return (
      <section className="cor-decide" data-decide="investigacion">
        <Label tone="amber">Investigación · tu respuesta</Label>
        <p className="cor-h3">{d.research.options.length ? `Las ${d.research.options.length} opciones` : "¿Vas con la recomendada?"}</p>
        <div className="cor-opts" role="radiogroup" aria-label="Opciones de la investigación">
          {d.research.options.map((o) => (
            <button key={o.n} type="button" role="radio" aria-checked={pick === o.n} className="cor-opt" onClick={() => set({ pick: o.n })} title={o.text} data-option={o.n}>
              {o.n}. {o.title}
              {o.n === 1 && <small>recomendada</small>}
            </button>
          ))}
        </div>
        {pick === 1 ? (
          <Btn kind="primary" disabled={busy} onClick={() => send({ verdict: "ok" })} data-control="idea-ok">
            Va con la recomendada
          </Btn>
        ) : (
          <Btn kind="primary" disabled={busy} onClick={() => send({ verdict: "opcion", option: pick })} data-control="idea-opcion">
            Pedir la opción {pick}
          </Btn>
        )}
      </section>
    );
  }
  if (s.stop === "diseno" && d.frames.length) {
    const ready = ui.pins.filter((p) => p.text.trim()).length;
    return (
      <section className="cor-decide" data-decide="diseno">
        <Label tone="amber">Diseño sin ver · tu respuesta</Label>
        <p className="cor-h3">¿Cómo ves el diseño?</p>
        <p className="cor-text">«Me gusta» deja que la idea siga. Tus notas la regresan a Artist. Toca un punto del marco para dejar una nota ahí.</p>
        {ui.pins.length > 0 && (
          <ol className="cor-marcas">
            {ui.pins.map((p, n) => (
              <li key={n}>
                <b aria-hidden>{n + 1}</b>
                <input className="cor-input" value={p.text} maxLength={600} placeholder="¿Qué cambiarías aquí?" aria-label={`Nota ${n + 1}, marco ${p.frame}`} onChange={(e) => set({ pins: ui.pins.map((x, j) => (j === n ? { ...x, text: e.target.value } : x)) })} />
                <Btn kind="quiet" small aria-label={`Quitar la nota ${n + 1}`} onClick={() => set({ pins: ui.pins.filter((_, j) => j !== n) })}>
                  ×
                </Btn>
              </li>
            ))}
          </ol>
        )}
        <div className="cor-acts">
          <Btn kind="primary" disabled={busy} onClick={() => send({ verdict: "ok" })} data-control="idea-ok">
            Me gusta
          </Btn>
          <Btn kind="secondary" disabled={busy || ready === 0} onClick={() => send({ verdict: "cambios", notes: ui.pins.filter((p) => p.text.trim()) })} data-control="idea-notas">
            Enviar notas a Artist
          </Btn>
        </div>
      </section>
    );
  }
  const entendido = s.stop === "entendido";
  return (
    <section className="cor-decide" data-decide={s.stop}>
      <Label tone="amber">{`${stopWord(s.stop)} · tu respuesta`}</Label>
      <p className="cor-h3">{entendido ? "¿Lo entendió bien el PO?" : "¿Cómo lo ves?"}</p>
      <div className="cor-acts">
        <Btn kind="primary" disabled={busy} onClick={() => send({ verdict: "ok" })} data-control="idea-ok">
          {entendido ? "Así es" : "Me gusta, sigue"}
        </Btn>
        {!entendido && !ui.asking && (
          <Btn kind="secondary" disabled={busy} onClick={() => set({ asking: true })} data-control="idea-pide-cambios">
            Pide cambios
          </Btn>
        )}
      </div>
      {(entendido || ui.asking) && (
        <form
          className="cor-ajuste-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (ui.text.trim() && !busy) send({ verdict: entendido ? "corregir" : "cambios", text: ui.text.trim() });
          }}
        >
          <input className="cor-input" maxLength={1000} value={ui.text} aria-label={entendido ? "Qué entendió mal el PO" : "Qué cambiarías"} placeholder={entendido ? "No es eso: dile qué entendió mal…" : "¿Qué cambiarías?"} onChange={(e) => set({ text: e.target.value })} />
          <Btn kind="secondary" type="submit" disabled={busy || !ui.text.trim()} data-control="idea-cambios">
            {entendido ? "Corregir" : "Pedir cambios"}
          </Btn>
        </form>
      )}
    </section>
  );
};

const Trail = ({ d, now, timeZone, set }: { d: IdeaDetail; now: number; timeZone?: string; set: (p: Partial<Ui>) => void }) => {
  const stopOf = (x: PedidoTrailItem): PedidoStop | null => {
    if (x.stop) return x.stop as PedidoStop;
    if (x.kind === "pedido") return "buzon";
    if (x.kind === "entendi") return "entendido";
    if (x.kind === "doc") return ({ Idea: "entendido", Research: "investigacion", Design: "diseno", Plan: "plan" } as Record<string, PedidoStop>)[x.doc?.title ?? ""] ?? null;
    return null;
  };
  return (
    <ol className="cor-trail" aria-label="Recorrido" data-trail={d.trail.length} tabIndex={0}>
      {[...d.trail].reverse().map((x, i) => {
        const st = stopOf(x);
        return (
          <li key={i} className={x.who === "jorge" ? "me" : ""}>
            <time className="cor-cap" dateTime={x.at}>
              {dayHm(x.at, now, timeZone)}
            </time>
            <span className="cor-state">{st ? stopWord(st) : ""}</span>
            <span className="cor-ellipsis" style={{ flex: 1 }} title={x.text}>
              <b>{whoName(x.who)}</b> · {x.kind === "pedido" ? `Lo pediste: «${d.text}»` : x.text}
            </span>
            {st && x.kind !== "pedido" && x.kind !== "etapa" && (
              <Btn kind="link" onClick={() => set({ sub: "entregas", stop: st })}>
                Ver
              </Btn>
            )}
          </li>
        );
      })}
    </ol>
  );
};

export const Idea = ({ p, k, now, timeZone, acts, links }: { p: OrgProject; k: string; now: number; timeZone?: string; acts: CorrienteActs; links: Links }) => {
  const q = useQuery({ queryKey: ["idea", p.slug, k], queryFn: () => api.idea(p.slug, k), refetchInterval: 15_000 });
  const d = q.data;
  const [ui, setUi] = useState<Ui | null>(null);
  const set = (x: Partial<Ui>) => setUi((u) => (u ? { ...u, ...x } : u));
  const [files, setFiles] = useState<File[]>([]);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const told = useRef(new Set<string>());
  useEffect(() => {
    if (d && (!ui || ui.stop === undefined)) setUi(initialUi(d));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d?.key]);
  // A sent answer or note shows on the next read: clear what was typed then.
  const [trailN, setTrailN] = useState(0);
  useEffect(() => {
    if (!d) return;
    if (d.trail.length > trailN && trailN > 0) setUi((u) => (u ? { ...u, note: "", answer: "", text: "", asking: false, pins: [] } : u));
    setTrailN(d.trail.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d?.trail.length]);
  const s = d && ui ? (d.stops.find((x) => x.stop === ui.stop) ?? d.stops[0]!) : null;
  const shown = !!(ui?.sub === "entregas" && s?.delivered && !s.seen && s.stop !== "buzon");
  useEffect(() => {
    if (!shown || !d || !s) return;
    const key = `${d.key}:${s.stop}:${s.at}`;
    if (told.current.has(key)) return;
    told.current.add(key);
    acts.visto(p.slug, d.key, s.stop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, s?.stop, d?.key]);
  if (q.isError) return <ReadError what="la idea" onRetry={() => void q.refetch()} />;
  if (!d || !ui || !s) return <div className="cor-skel" style={{ height: 400 }} aria-busy="true" aria-label="Leyendo la idea" />;
  const busy = (a: string) => acts.busy === `pedido-${k}:${a}`;
  const send = (input: Omit<IdeaAnswerInput, "stop">) => acts.respuesta(p.slug, k, { stop: s.stop, ...input });
  const unseen = d.unseen;
  return (
    <div className="cor-idea" data-idea={d.key} data-stop={ui.stop}>
      <div className="cor-idea-head">
        <Link to={links.back} className="cor-strip-back" data-control="volver-ideas">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M9.5 3.5 5 8l4.5 4.5" />
          </svg>
          Ideas
        </Link>
        <h2 className="cor-ellipsis" title={d.summary || d.title}>
          {d.summary || d.title}
        </h2>
        <span className="cor-cap">{`${d.key}${unseen ? ` · ${unseen} ${unseen === 1 ? "entrega sin ver" : "entregas sin ver"}` : ""}${d.guardada ? " · guardada" : ""}`.toUpperCase()}</span>
        <span className="cor-segbox" role="group" aria-label="Vista de la idea" style={{ marginLeft: "auto" }}>
          <Opt on={ui.sub === "entregas"} onClick={() => set({ sub: "entregas" })} data-control="idea-entregas">
            Entregas
          </Opt>
          <Opt on={ui.sub === "recorrido"} onClick={() => set({ sub: "recorrido" })} data-control="idea-recorrido">
            Recorrido
          </Opt>
        </span>
        {d.promoted_to ? (
          <Link className="cor-btn secondary" to={links.track(d.promoted_to)} data-control="idea-iniciativa">
            Ver {d.promoted_to}
          </Link>
        ) : (
          isOpen(d) &&
          d.pedido &&
          !d.guardada &&
          s.stop !== "lista" && (
            <Btn kind="secondary" disabled={busy("construir") || d.state === "valvula"} onClick={() => acts.pedido(p.slug, k, "construir")} data-control="idea-construir">
              {d.state === "valvula" ? "Pasando…" : "Constrúyelo"}
            </Btn>
          )
        )}
        {isOpen(d) && d.pedido && (
          <div className="cor-menu">
            <Btn kind="quiet" aria-haspopup="menu" aria-expanded={ui.more} onClick={() => set({ more: !ui.more, drop: false })} data-control="idea-mas">
              ··· Más
            </Btn>
            {ui.more && (
              <div className="cor-menu-list down" role="menu">
                {d.guardada ? (
                  <Btn kind="quiet" role="menuitem" disabled={busy("restaurar")} onClick={() => (set({ more: false }), acts.pedido(p.slug, k, "restaurar"))} data-control="idea-restaurar">
                    Restaurar
                  </Btn>
                ) : (
                  <Btn kind="quiet" role="menuitem" disabled={busy("guardar") || d.state === "valvula"} onClick={() => (set({ more: false }), acts.pedido(p.slug, k, "guardar"))} data-control="idea-guardar">
                    Guardar para después
                  </Btn>
                )}
                <Btn kind={ui.drop ? "danger" : "quiet"} role="menuitem" disabled={busy("descartar")} onClick={() => (ui.drop ? (set({ more: false, drop: false }), acts.pedido(p.slug, k, "descartar")) : set({ drop: true }))} data-control="idea-descartar">
                  {ui.drop ? "¿Seguro? Descartar" : "Descartar"}
                </Btn>
              </div>
            )}
          </div>
        )}
      </div>
      <ol className="cor-rail" aria-label="Paradas de la idea">
        {STOPS.map((st) => {
          const x = d.stops.find((y) => y.stop === st.id)!;
          const line = stopLine(x, d);
          return (
            <li key={st.id}>
              <button type="button" className={`cor-railstop ${x.state}`} aria-pressed={ui.sub === "entregas" && ui.stop === st.id} onClick={() => set({ stop: st.id, sub: "entregas", asking: false, text: "" })} data-control={`idea-parada-${st.id}`}>
                <i className={`cor-railmark ${line.tone}`} aria-hidden />
                <b>{st.name}</b>
                <span className={`cor-state ${line.tone === "you" ? "amber" : line.tone === "live" || line.tone === "new" ? "live" : line.tone === "ok" ? "" : ""}`}>{line.text}</span>
              </button>
            </li>
          );
        })}
      </ol>
      {ui.sub === "recorrido" ? (
        <Trail d={d} now={now} timeZone={timeZone} set={set} />
      ) : (
        <div className="cor-idea-body">
          <Delivery d={d} s={s} ui={ui} set={set} links={links} now={now} timeZone={timeZone} onDespertar={() => acts.despertar(p.slug, k)} busy={busy("despertar")} />
          <div className="cor-idea-side">
            {d.question && isOpen(d) ? (
              <section className="cor-decide" data-pregunta={d.question.id}>
                <Label tone="amber">El PO pregunta</Label>
                <p className="cor-h3">{d.question.text}</p>
                {d.question_options.length > 0 && (
                  <div className="cor-opts">
                    {d.question_options.map((o) => (
                      <Btn key={o} kind="secondary" disabled={busy("answer")} onClick={() => acts.answerQuestion(p.slug, k, d.question!.id, o)}>
                        {o}
                      </Btn>
                    ))}
                  </div>
                )}
                <form
                  className="cor-ajuste-row"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (ui.answer.trim() && !busy("answer")) acts.answerQuestion(p.slug, k, d.question!.id, ui.answer.trim());
                  }}
                >
                  <input className="cor-input" value={ui.answer} maxLength={1000} placeholder="Contesta aquí…" aria-label="Tu respuesta al PO" onChange={(e) => set({ answer: e.target.value })} />
                  <Btn kind="primary" type="submit" disabled={!ui.answer.trim() || busy("answer")} data-control="idea-contestar">
                    Contestar
                  </Btn>
                </form>
              </section>
            ) : (
              <Decide d={d} s={s} ui={ui} set={set} send={send} busy={busy("respuesta") || busy("construir")} onConstruir={() => acts.pedido(p.slug, k, "construir")} />
            )}
            {/* The last answer elsewhere, so a «me gusta» can be undone from here too. */}
            {d.stops
              .filter((x) => x.stop !== s.stop && x.answer?.verdict === "ok")
              .slice(-1)
              .map((x) => (
                <section key={x.stop} className="cor-card cor-said">
                  <p className="cor-text">
                    <b>{`Te gustó ${x.stop === "entendido" ? "lo entendido" : x.stop === "investigacion" ? "la investigación" : x.stop === "diseno" ? "el diseño" : "el plan"}.`}</b> Nada se detiene.
                  </p>
                  {isOpen(d) && (
                    <Btn kind="link" disabled={busy("respuesta")} onClick={() => acts.respuesta(p.slug, k, { stop: x.stop, verdict: "deshacer" })} data-control="idea-deshacer-otra">
                      Deshacer
                    </Btn>
                  )}
                </section>
              ))}
          </div>
        </div>
      )}
      {isOpen(d) && (
        <form
          className="cor-idea-note"
          onSubmit={(e) => {
            e.preventDefault();
            const text = ui.note.trim().length >= 2 ? ui.note.trim() : files.length ? (files.length === 1 ? "Añadí una imagen." : `Añadí ${files.length} imágenes.`) : "";
            if (!text || busy("note")) return;
            acts.notePedido(p.slug, k, text, files);
            setFiles([]);
          }}
        >
          <label className="cor-label" htmlFor={`idea-nota-${k}`}>
            Para el equipo
          </label>
          <textarea id={`idea-nota-${k}`} ref={noteRef} rows={1} className="cor-input" value={ui.note} maxLength={1000} placeholder={d.pedido ? "Añade algo o pega una imagen…" : "Añade algo para el equipo…"} onChange={(e) => set({ note: e.target.value })} />
          {d.pedido && <Images files={files} onChange={setFiles} textarea={noteRef} disabled={busy("note")} />}
          <Btn kind="secondary" type="submit" disabled={(ui.note.trim().length < 2 && !files.length) || busy("note")} data-control="idea-nota">
            Añadir
          </Btn>
        </form>
      )}
    </div>
  );
};


