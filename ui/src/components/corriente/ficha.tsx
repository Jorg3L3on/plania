// PLA-I65-3/4 (Una sola ficha, PLA-IDEA27 pass 3): a pedido, an idea and an initiative open the same ficha, in place.
// Head: what it is (Pedido tuyo, Idea, Iniciativa), its key (and the idea it was born from), its short name, and
// Recorrido, Nota, Guardar or Restaurar, Descartar and Cerrar, quiet. Then the current (rio.tsx) with the stops as
// HTML tabs over it, one full-width delivery panel for the chosen stop, and «Ahora»: one sentence and one white
// button (amber when it waits on the owner, violet when someone works it, grey when nothing does).
// Everything La idea abierta did (PLA-I61) stays: answers per stop, notes pinned on Artist's frames, Despertar, the
// team note with pictures, the trail, «visto». An initiative adds Construcción (its steps, stage and PR, Aceptar on
// the one that waits) and Publicado (when, and the evidence). Calls: GET …/ideas/:key (PLA-I65-1) and the
// building's writes (acts.ts).
import { createContext, useContext, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Link } from "react-router";
import { api, type Decision, type IdeaAnswerInput, type IdeaBuilt, type IdeaDetail, type IdeaNote, type IdeaStop, type OrgProject, type PedidoStop, type PedidoTrailItem } from "@/lib/api";
import { cardActs, deliveryFor, ETAPA_WORD, type CardAct } from "@/lib/etapas";
import { acceptWords } from "@/lib/evidencia";
import type { CorrienteActs } from "./acts";
import { Images } from "./images";
import { Btn, Key, Label, Opt, ReadError, State, type StateTone } from "./parts";
import { Corriente } from "./rio";
import { CX0, PX, STOP_IDS, STOP_NAMES, SX, VX, W, rioOf, type Chan, type RioModel } from "./rio-geo";
import { busyOf, run, useCerrar } from "./tablero";
import { firstStop, stopLine, whoName } from "./idea";

export type Sel = PedidoStop | "construccion" | "publicado";
const SEL_IDS: Sel[] = [...STOP_IDS, "construccion", "publicado"];
const SEL_NAME: Record<Sel, string> = { buzon: "Buzón", entendido: "Entendido", investigacion: "Investigación", diseno: "Diseño", plan: "Plan", lista: "Lista", construccion: "Construcción", publicado: "Publicado" };
const ANSWERABLE: PedidoStop[] = ["entendido", "investigacion", "diseno", "plan"];
const pct = (x: number) => `${(x / W) * 100}%`;
const hm = (iso: string, timeZone?: string) => new Intl.DateTimeFormat("es-MX", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).format(new Date(iso));
export const dayHm = (iso: string, now: number, timeZone?: string) => {
  const day = (t: number) => new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", timeZone }).format(new Date(t)).replace(".", "");
  return day(Date.parse(iso)) === day(now) ? `hoy ${hm(iso, timeZone)}` : `${day(Date.parse(iso))} ${hm(iso, timeZone)}`;
};
const isOpen = (d: IdeaDetail) => d.status === "Open" && !d.promoted_to && d.kind !== "initiative";
const Md = ({ children }: { children: string }) => (
  <div className="cor-md">
    <Markdown remarkPlugins={[remarkGfm]}>{children}</Markdown>
  </div>
);

/** What it is, in the head: an initiative once built, his own request, or an idea. */
export const kindWord = (d: Pick<IdeaDetail, "pedido" | "kind" | "built">) => (d.built || d.kind === "initiative" ? "Iniciativa" : d.pedido ? "Pedido tuyo" : "Idea");
/** The stop the ficha opens on: the building once it is built, else the newest delivery not seen, else where it is. */
export function selOf(d: Pick<IdeaDetail, "stops" | "stop" | "built">): Sel {
  if (d.built) return d.built.published_at ? "publicado" : "construccion";
  return firstStop(d);
}
/** The recommended option: the one the recommendation names («opción N»), else the first. */
export function recommended(d: Pick<IdeaDetail, "research">): number | null {
  const n = Number(/opci[oó]n\s*(\d+)/i.exec(d.research.recommendation ?? "")?.[1] ?? NaN);
  return d.research.options.some((o) => o.n === n) ? n : (d.research.options[0]?.n ?? null);
}

type Ui = { sel: Sel; sub: "entrega" | "recorrido" | "nota"; frame: number; pins: IdeaNote[]; text: string; asking: boolean; pick: number | null; note: string; answer: string; drop: boolean };
/** PLA-62: «Constrúyelo» said and nobody is turning it into an initiative (no live run on it): stuck, as the list says. */
export const stuckOf = (p: Pick<OrgProject, "paused" | "team">, d: Pick<IdeaDetail, "key" | "state">) =>
  d.state === "valvula" && (p.paused || !p.team.some((m) => m.state === "running" && m.now?.ticket === d.key));
/** When he said «Constrúyelo» (the newest one), from the trail. */
export const orderedAt = (d: Pick<IdeaDetail, "trail">) => [...(d.trail ?? [])].reverse().find((t) => t.kind === "construir")?.at ?? null;

const initialUi = (d: IdeaDetail): Ui => ({ sel: selOf(d), sub: "entrega", frame: 0, pins: [], text: "", asking: false, pick: null, note: "", answer: "", drop: false });
export type FichaLinks = { doc: (id: string) => string; paso: (key: string) => string; entrega: (d: Decision) => string; pedir: string };

// ---- the stops as tabs over the current

type TabInfo = { sel: Sel; who: string; tone: "you" | "live" | "new" | "ok" | ""; gist: string | null; state: "done" | "here" | "todo" };
function tabsOf(d: IdeaDetail, m: RioModel, stuck = false): TabInfo[] {
  const alone = d.kind === "initiative" && !d.stops.some((s) => s.delivered);
  const out: TabInfo[] = d.stops.map((s, i) => {
    const built = !!d.built;
    // Once built the stops are history: who delivered, no «sin ver».
    const line = alone ? { text: "Sin entrega", tone: "" as const } : built ? { text: s.stop === "lista" ? "Tu sí" : s.stop === "buzon" ? "Tú" : whoName(s.by) || "—", tone: "" as const } : s.stop === "lista" && s.state === "here" && d.state === "valvula" ? (stuck ? { text: "Atorada", tone: "you" as const } : { text: "Pasando al tablero", tone: "live" as const }) : s.stop === "lista" && s.state === "here" && d.state === "quieta" ? { text: "Espera tu sí", tone: "you" as const } : s.state === "here" && d.state === "trabajando" ? { text: `${whoName(d.who) || "Alguien"} la trabaja`, tone: "live" as const } : stopLine(s, d);
    return { sel: s.stop, who: line.text, tone: line.tone, gist: d.gist?.[s.stop] ?? null, state: i < m.here ? "done" : i === m.here ? "here" : "todo" };
  });
  const b = d.built;
  const you = m.chans.includes("you");
  out.push({
    sel: "construccion",
    who: !b ? (d.plan_steps.length ? `${d.plan_steps.length} pasos en el plan` : "Todavía no") : b.published_at ? `${b.total} de ${b.total} pasos` : `${b.done} de ${b.total}${you ? " · 1 te espera" : m.front === "live" ? " · Taller construye" : ""}`,
    tone: b && !b.published_at ? (you ? "you" : m.front === "live" ? "live" : "") : "",
    gist: b ? (m.per > 1 ? `Un cauce cada ${m.per} pasos.` : "Un cauce por paso.") : null,
    state: m.here > 6 ? "done" : m.here === 6 ? "here" : "todo",
  });
  out.push({ sel: "publicado", who: b?.published_at ? dayHm(b.published_at, Date.now()) : "Todavía no", tone: b?.published_at ? "ok" : "", gist: null, state: m.here === 7 ? "done" : "todo" });
  return out;
}

const TAB_POS: Record<Sel, { left: number; width: number }> = {
  ...(Object.fromEntries(STOP_IDS.map((s, i) => [s, { left: SX(i) - 12, width: 112 }])) as Record<PedidoStop, { left: number; width: number }>),
  construccion: { left: CX0 - 12, width: 340 },
  publicado: { left: PX - 46, width: 104 },
};

const Rio = ({ d, m, ui, set, stuck = false }: { d: IdeaDetail; m: RioModel; ui: Ui; set: (p: Partial<Ui>) => void; stuck?: boolean }) => {
  const tabs = tabsOf(d, m, stuck);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = SEL_IDS.indexOf(ui.sel);
    const to = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : e.key === "Home" ? 0 : e.key === "End" ? SEL_IDS.length - 1 : null;
    if (to === null) return;
    e.preventDefault();
    const j = (to + SEL_IDS.length) % SEL_IDS.length;
    set({ sel: SEL_IDS[j]!, sub: "entrega", asking: false, text: "" });
    refs.current[j]?.focus();
  };
  const dam = m.dam;
  return (
    <div className="cor-ficha-rio">
      <Corriente m={m} />
      {m.here <= 5 && <i className={`cor-ficha-mk ${m.front === "you" ? "you" : m.front === "live" ? "agent" : "grey"}`} style={{ left: pct(SX(m.here)) }} aria-hidden />}
      <div className={`cor-ficha-dam ${dam}`} style={{ left: pct(VX - 42), width: pct(84) }} aria-hidden>
        <b>Constrúyelo</b>
        <span>{dam === "open" ? (d.kind === "initiative" && !d.stops.some((x) => x.delivered) ? "abierta" : "tu sí") : dam === "wait" ? (d.state === "valvula" ? (stuck ? "atorada" : "pasando…") : "falta tu sí") : "cerrada"}</span>
      </div>
      <div role="tablist" aria-label="Paradas" className="cor-ficha-tabs" onKeyDown={onKey}>
        {tabs.map((t, i) => (
          <button
            key={t.sel}
            ref={(el) => void (refs.current[i] = el)}
            type="button"
            role="tab"
            id={`ficha-tab-${d.key}-${t.sel}`}
            aria-selected={ui.sel === t.sel && ui.sub === "entrega"}
            aria-controls={`ficha-panel-${d.key}`}
            tabIndex={ui.sel === t.sel ? 0 : -1}
            className={`cor-ficha-tab ${t.state}`}
            style={{ left: pct(TAB_POS[t.sel].left), width: pct(TAB_POS[t.sel].width) }}
            onClick={() => set({ sel: t.sel, sub: "entrega", asking: false, text: "" })}
            data-control={`ficha-parada-${t.sel}`}
          >
            <b>{SEL_NAME[t.sel]}</b>
            <span className={`cor-ficha-who ${t.tone === "you" ? "amber" : t.tone === "live" || t.tone === "new" ? "live" : t.tone === "ok" ? "ok" : ""}`}>{t.who}</span>
            {t.gist && t.state !== "todo" && <span className="cor-ficha-gist">{t.gist}</span>}
          </button>
        ))}
      </div>
    </div>
  );
};

// ---- the delivery of the chosen stop

const Eyebrow = ({ children, doc, links }: { children: ReactNode; doc?: { id: string; title: string } | null; links: FichaLinks }) => (
  <div className="cor-ficha-eb">
    <Label tone="violet">{children}</Label>
    {doc && (
      <Link className="cor-btn link small" to={links.doc(doc.id)} data-control="ficha-doc">
        {`Leer el doc «${doc.title}» ›`}
      </Link>
    )}
  </div>
);
const Empty = ({ title, line, children }: { title: string; line: string; children?: ReactNode }) => (
  <div className="cor-ficha-empty" data-stop-empty>
    <Label>Todavía no</Label>
    <b>{title}</b>
    <span className="cor-text">{line}</span>
    {children}
  </div>
);
const WAITS: Record<string, string> = {
  entendido: "El PO lo lee y escribe lo que entendió.",
  investigacion: "Research empieza cuando el PO lo entiende.",
  diseno: "Artist dibuja cuando haya una recomendación.",
  plan: "El PO escribe el plan cuando el diseño esté.",
  lista: "Cuando el plan esté, la corriente llega a la presa y espera tu «Constrúyelo».",
};

const eb = (s: IdeaStop, now: number, timeZone?: string, extra?: string) => [SEL_NAME[s.stop], s.by ? `${whoName(s.by)} entregó` : null, s.at ? dayHm(s.at, now, timeZone) : null, extra].filter(Boolean).join(" · ");

const PlanSteps = ({ titles, chans, links, keys }: { titles: string[]; chans?: Chan[]; links?: FichaLinks; keys?: string[] }) => {
  // Three per column up to four columns; more steps add rows (the panel scrolls inside).
  const cols = Math.min(4, Math.max(1, Math.ceil(titles.length / 3)));
  const rows = Math.max(1, Math.ceil(titles.length / cols));
  return (
    <ol className="cor-ficha-pasos" style={{ gridTemplateRows: `repeat(${rows}, minmax(38px, auto))`, gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` } as CSSProperties} data-pasos={titles.length}>
      {titles.map((t, k) => {
        const c = chans?.[k];
        const [word, tone, cls]: [string, StateTone, string] = c === "done" || c === "fin" ? ["Hecho", "ok", ""] : c === "you" ? ["Te toca", "amber", "cur"] : c === "live" ? ["Construyendo", "live", "liv"] : ["Por hacer", undefined, ""];
        const inner = (
          <>
            {chans && <State tone={tone}>{word}</State>}
            <span className="cor-ficha-paso-t" title={keys?.[k] ? `${keys[k]} · ${t}` : t}>
              <Key>{String(k + 1)}</Key> <b>{t}</b>
            </span>
          </>
        );
        return (
          <li key={k} className={cls}>
            {links && keys ? (
              <Link to={links.paso(keys[k]!)} className="cor-ficha-paso" data-control="ficha-paso">
                {inner}
              </Link>
            ) : (
              <span className="cor-ficha-paso">{inner}</span>
            )}
          </li>
        );
      })}
    </ol>
  );
};

const Delivery = ({ d, m, ui, set, links, now, timeZone, acts, slug }: { d: IdeaDetail; m: RioModel; ui: Ui; set: (p: Partial<Ui>) => void; links: FichaLinks; now: number; timeZone?: string; acts: CorrienteActs; slug: string }) => {
  const b = d.built ?? null;
  if (ui.sel === "construccion") {
    if (!b)
      return (
        <Empty title="Todavía no es una iniciativa" line={d.stop === "lista" ? (d.state === "valvula" ? "Dijiste «Constrúyelo»: el PO está creando la iniciativa. En cuanto exista, la corriente se abre en un cauce por paso." : "Cuando digas «Constrúyelo», el PO crea la iniciativa y la corriente se abre en un cauce por paso.") : "Primero termina de tomar forma. Nadie construye sin tu «Constrúyelo»."} />
      );
    const open = b.prs.filter((p) => p.state === "open").map((p) => `#${p.number}`);
    const merged = b.prs.filter((p) => p.state === "merged").length;
    return (
      <>
        <Eyebrow links={links}>{[`Construcción · ${b.key}`, `${b.done} de ${b.total} hechos`, open.length ? `PR ${open.join(", ")} ${open.length === 1 ? "abierto" : "abiertos"}` : null, merged ? `${merged} ${merged === 1 ? "PR fusionado" : "PRs fusionados"}` : null].filter(Boolean).join(" · ")}</Eyebrow>
        {b.steps.length ? (
          <PlanSteps titles={b.steps.map((s) => s.title)} keys={b.steps.map((s) => s.key)} chans={b.steps.map((s) => (b.published_at ? "fin" : s.status === "Done" || s.status === "Merged" || s.status === "Released" ? "done" : s.etapa === "te_toca" ? "you" : s.etapa && ["construyendo", "en_qa", "en_revision", "devuelto"].includes(s.etapa) ? "live" : "todo"))} links={links} />
        ) : (
          <p className="cor-text">La iniciativa todavía no tiene pasos.</p>
        )}
      </>
    );
  }
  if (ui.sel === "publicado") {
    if (!b?.published_at) return <Empty title="Todavía no se publica" line="Aquí quedará cuándo salió y la evidencia de que funciona." />;
    return (
      <>
        <Eyebrow links={links}>{`Publicado · ${dayHm(b.published_at, now, timeZone)} · ${b.total} ${b.total === 1 ? "paso" : "pasos"}`}</Eyebrow>
        <p className="cor-ficha-quote">{d.short ?? d.title}: ya está publicado.</p>
        <ul className="cor-ficha-rows">
          {b.evidence.map((e, i) => (
            <li key={i}>
              <State tone="ok">Pasa</State>
              <span className="cor-ficha-row-t" title={e.cite}>
                <Key>{e.key}</Key> <b>{e.kind}</b> · {e.cite}
                {e.commit ? ` · ${e.commit.slice(0, 7)}` : ""}
                {e.env ? ` · ${e.env}` : ""}
              </span>
            </li>
          ))}
          {b.prs
            .filter((p) => p.state === "merged")
            .slice(-2)
            .map((p) => (
              <li key={p.number}>
                <State tone="ok">Fusionado</State>
                <a className="cor-ficha-row-t" href={p.url} target="_blank" rel="noreferrer">
                  <b>PR #{p.number}</b> · {b.steps.find((s) => s.key === p.key)?.title ?? p.key}
                </a>
              </li>
            ))}
          {b.evidence.length === 0 && <li className="cor-muted">Sin evidencia registrada en sus pasos.</li>}
        </ul>
      </>
    );
  }
  const s = d.stops.find((x) => x.stop === ui.sel)!;
  if (d.kind === "initiative" && !d.stops.some((x) => x.delivered)) return <Empty title={`Esta iniciativa no nació de una idea`} line="No pasó por Buzón, Entendido, Investigación, Diseño ni Plan: abre Construcción para ver sus pasos." />;
  if (s.stop === "buzon")
    return (
      <>
        <Eyebrow links={links}>{d.pedido ? `Buzón · tú lo pediste${s.at ? ` · ${dayHm(s.at, now, timeZone)}` : ""} · desde Pedir` : `Buzón · idea de ${whoName(d.who) || "el equipo"}`}</Eyebrow>
        <p className="cor-ficha-quote">«{d.text}»</p>
        {d.pictures.length > 0 && <p className="cor-cap">{d.pictures.length === 1 ? "Con una imagen." : `Con ${d.pictures.length} imágenes.`}</p>}
      </>
    );
  if (s.stop === "lista") {
    if (d.stop !== "lista" && !b) return <Empty title="Lista no ha empezado" line={WAITS.lista!} />;
    return (
      <>
        <Eyebrow links={links}>{b ? `Lista · se construyó con tu sí · ${b.key}` : "Lista · esto es lo que se va a construir"}</Eyebrow>
        <p className="cor-ficha-quote">{b ? `Dijiste «Constrúyelo» y el PO la subió al tablero como ${b.key}.` : d.plan_steps.length ? `Todo lo de arriba ya está. ${d.plan_steps.length === 1 ? "Un paso espera" : `${d.plan_steps.length} pasos esperan`} tu sí.` : "Todo lo de arriba ya está. El plan espera tu sí."}</p>
        {d.plan_steps.length > 0 && <PlanSteps titles={d.plan_steps} />}
      </>
    );
  }
  if (!s.delivered)
    return (
      <Empty title={`${SEL_NAME[s.stop]} no ha empezado`} line={s.state === "here" && d.quiet_since ? `Quieta desde ${dayHm(d.quiet_since, now, timeZone)}. Si la despiertas, ${d.stage === "research" ? "Research" : d.stage === "design" ? "Artist" : "el PO"} la toma en su siguiente turno.` : (WAITS[s.stop] ?? "Llega después de la parada anterior.")}>
        {s.state === "here" && d.quiet_since && isOpen(d) && (
          <Btn kind="secondary" disabled={acts.busy === `pedido-${d.key}:despertar`} onClick={() => acts.despertar(slug, d.key)} data-control="ficha-despertar">
            Despertar
          </Btn>
        )}
      </Empty>
    );
  if (s.stop === "entendido") {
    const cells: [string, string | null][] = [
      ["Problema", d.ficha.problema],
      ["Solución", d.ficha.solucion],
      ["Fuera", d.ficha.fuera],
      ["Tamaño", d.ficha.tamano],
      ["Riesgos", d.ficha.riesgos],
    ];
    return (
      <>
        <Eyebrow links={links} doc={s.doc}>
          {eb(s, now, timeZone)}
        </Eyebrow>
        <div className="cor-ficha-split">
          <p className="cor-ficha-quote">{(d.understood_text ?? d.understood) ? (d.understood_text ?? d.understood)!.replace(/^\s*entend[ií]\s*[:：-]\s*/i, "") : "El PO escribió la ficha de la idea."}</p>
          <dl className="cor-ficha-cells">
            {cells.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd className={v ? "" : "cor-muted"}>{v ? <Md>{v}</Md> : "Pendiente"}</dd>
              </div>
            ))}
          </dl>
        </div>
      </>
    );
  }
  if (s.stop === "investigacion") {
    const rec = recommended(d);
    return (
      <>
        <Eyebrow links={links} doc={s.doc}>
          {eb(s, now, timeZone)}
        </Eyebrow>
        {d.research.options.length > 0 ? (
          <div className="cor-ficha-opts" style={{ gridTemplateColumns: `repeat(${Math.min(4, d.research.options.length)}, minmax(0, 1fr))` }}>
            {d.research.options.map((o) => (
              <div key={o.n} className={`cor-ficha-oc ${o.n === rec ? "rec" : ""}`} data-option={o.n}>
                <State tone={o.n === rec ? "live" : undefined}>{o.n === rec ? `Recomienda · opción ${o.n}` : `Opción ${o.n}`}</State>
                <b>{o.title}</b>
                <span>{o.text}</span>
              </div>
            ))}
          </div>
        ) : null}
        {d.research.recommendation && (
          <div className="cor-ficha-rec">
            <Label>Recomienda</Label>
            <Md>{d.research.recommendation}</Md>
          </div>
        )}
        {d.research.unknown.length > 0 && (
          <div className="cor-ficha-rec">
            <Label>Lo que todavía no se sabe</Label>
            <ul className="cor-md">
              {d.research.unknown.map((u) => (
                <li key={u}>{u}</li>
              ))}
            </ul>
          </div>
        )}
      </>
    );
  }
  if (s.stop === "plan")
    return (
      <>
        <Eyebrow links={links} doc={s.doc}>
          {eb(s, now, timeZone, d.plan_steps.length ? `${d.plan_steps.length} pasos${d.ficha.tamano ? ` · ${d.ficha.tamano.replace(/[*_`#.]/g, "").toLowerCase()}` : ""}` : undefined)}
        </Eyebrow>
        {d.plan_steps.length ? <PlanSteps titles={d.plan_steps} /> : <p className="cor-text">El plan no trae una lista de pasos; ábrelo completo.</p>}
      </>
    );
  // Diseño: the frames in a row, the chosen one large with the notes pinned on it.
  if (!d.frames.length)
    return (
      <>
        <Eyebrow links={links} doc={s.doc}>
          {eb(s, now, timeZone)}
        </Eyebrow>
        <p className="cor-text">Artist escribió el doc pero no subió los marcos. Ábrelo completo.</p>
      </>
    );
  const i = Math.min(ui.frame, d.frames.length - 1);
  const f = d.frames[i]!;
  const canPin = isOpen(d) && !s.answer;
  const pins = ui.pins.map((p, n) => ({ ...p, n: n + 1 })).filter((p) => p.frame === f.frame);
  return (
    <>
      <Eyebrow links={links} doc={s.doc}>
        {eb(s, now, timeZone, `${d.frames.length} ${d.frames.length === 1 ? "marco" : "marcos"}`)}
      </Eyebrow>
      <div className="cor-ficha-frames">
        <div
          className="cor-ficha-frame-big"
          role={canPin ? "button" : undefined}
          tabIndex={canPin ? 0 : undefined}
          aria-label={canPin ? `Marco ${f.frame}: toca un punto para dejar una nota ahí` : `Marco ${f.frame}`}
          style={{ aspectRatio: f.width && f.height ? `${f.width} / ${f.height}` : "16 / 10" } as CSSProperties}
          onClick={(e) => {
            if (!canPin) return;
            const r = e.currentTarget.getBoundingClientRect();
            set({ pins: [...ui.pins, { frame: f.frame, x: Math.round(((e.clientX - r.left) / r.width) * 1000) / 10, y: Math.round(((e.clientY - r.top) / r.height) * 1000) / 10, text: "" }] });
          }}
          data-control="ficha-clavar"
        >
          <img src={f.url} alt={`Marco ${f.frame}: ${f.name}`} draggable={false} />
          {pins.map((p) => (
            <i key={p.n} className="cor-pin" style={{ left: `${p.x}%`, top: `${p.y}%` }} aria-hidden>
              {p.n}
            </i>
          ))}
        </div>
        <div className="cor-ficha-thumbs" role="group" aria-label="Marcos">
          {d.frames.map((x, n) => (
            <button key={x.id} type="button" className="cor-ficha-thumb" aria-pressed={n === i} onClick={() => set({ frame: n })} title={`${x.frame} · ${x.name}`} data-control="ficha-marco">
              <img src={x.url} alt="" draggable={false} />
              <span>
                {x.frame} · {x.name}
                {ui.pins.some((p) => p.frame === x.frame) && <small>{` · ${ui.pins.filter((p) => p.frame === x.frame).length}`}</small>}
              </span>
            </button>
          ))}
        </div>
        <div className="cor-ficha-why">
          {ui.pins.length > 0 ? (
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
          ) : (
            <dl>
              <div>
                <dt className="cor-label">{`Qué hace · marco ${f.frame}`}</dt>
                <dd>{f.hace ?? f.name}</dd>
              </div>
              <div>
                <dt className="cor-label">Por qué</dt>
                <dd>{f.porque ?? "—"}</dd>
              </div>
              {canPin && <dd className="cor-cap">Toca un punto del marco para dejar una nota ahí.</dd>}
            </dl>
          )}
        </div>
      </div>
    </>
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
  if (!d.trail.length) return <Empty title="Sin recorrido" line="Lo que pase con esta cosa queda aquí, en orden." />;
  return (
    <ol className="cor-trail" aria-label="Recorrido" data-trail={d.trail.length}>
      {[...d.trail].reverse().map((x, i) => {
        const st = stopOf(x);
        return (
          <li key={i} className={x.who === "jorge" ? "me" : ""}>
            <time className="cor-cap" dateTime={x.at}>
              {dayHm(x.at, now, timeZone)}
            </time>
            <span className="cor-state">{st ? SEL_NAME[st] : ""}</span>
            <span className="cor-ellipsis" style={{ flex: 1 }} title={x.text}>
              <b>{whoName(x.who)}</b> · {x.kind === "pedido" ? `Lo pediste: «${d.text}»` : x.text}
            </span>
            {st && x.kind !== "pedido" && x.kind !== "etapa" && (
              <Btn kind="link" onClick={() => set({ sub: "entrega", sel: st })}>
                Ver
              </Btn>
            )}
          </li>
        );
      })}
    </ol>
  );
};

const Nota = ({ d, ui, set, acts, slug }: { d: IdeaDetail; ui: Ui; set: (p: Partial<Ui>) => void; acts: CorrienteActs; slug: string }) => {
  const [files, setFiles] = useState<File[]>([]);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const busy = acts.busy === `pedido-${d.key}:note`;
  return (
    <form
      className="cor-ficha-nota"
      onSubmit={(e) => {
        e.preventDefault();
        const text = ui.note.trim().length >= 2 ? ui.note.trim() : files.length ? (files.length === 1 ? "Añadí una imagen." : `Añadí ${files.length} imágenes.`) : "";
        if (!text || busy) return;
        acts.notePedido(slug, d.key, text, files);
        setFiles([]);
      }}
    >
      <label className="cor-label violet" htmlFor={`ficha-nota-${d.key}`}>
        Para el equipo · lo leen en su siguiente turno
      </label>
      <textarea id={`ficha-nota-${d.key}`} ref={noteRef} rows={3} className="cor-input" value={ui.note} maxLength={1000} placeholder={d.pedido ? "Añade algo o pega una imagen…" : "Añade algo para el equipo…"} onChange={(e) => set({ note: e.target.value })} />
      <div className="cor-acts" style={{ marginTop: 0 }}>
        {d.pedido && <Images files={files} onChange={setFiles} textarea={noteRef} disabled={busy} />}
        <Btn kind="secondary" type="submit" disabled={(ui.note.trim().length < 2 && !files.length) || busy} data-control="ficha-nota-enviar">
          Añadir
        </Btn>
      </div>
    </form>
  );
};

// ---- «Ahora»: one sentence and one white button

type Tone = "you" | "live" | "calm";
/** PLA-62: the lever the thing's row in the list offered (Pasar a Lista, Hacer primero, Detener, Reenviar): the ficha's
 *  bar carries it too, before its own buttons, so opening a thing never loses what the row could do. */
export const FichaExtra = createContext<ReactNode>(null);

const Bar = ({ tone, label, children, side }: { tone: Tone; label: string; children: ReactNode; side?: ReactNode }) => {
  const extra = useContext(FichaExtra);
  return (
    <div className={`cor-ficha-ahora ${tone}`} data-ahora={tone} role="region" aria-label={`Ahora: ${label}`}>
      <i className="cor-ficha-gl" aria-hidden />
      <div className="cor-ficha-ahora-tx">
        <Label tone={tone === "you" ? "amber" : tone === "live" ? "violet" : undefined}>{label}</Label>
        <p>{children}</p>
      </div>
      {extra}
      {side}
    </div>
  );
};

const said = (s: IdeaStop) => {
  const a = s.answer!;
  if (a.verdict === "ok") return s.stop === "entendido" ? "Le dijiste al PO que así es." : s.stop === "investigacion" ? "Vas con la recomendada." : `Te gustó ${s.stop === "diseno" ? "el diseño" : "el plan"}.`;
  if (a.verdict === "opcion") return `Pediste la opción ${a.option}.`;
  if (a.verdict === "corregir") return "Corregiste al PO.";
  return a.notes.length ? `Pediste cambios con ${a.notes.length} ${a.notes.length === 1 ? "nota" : "notas"}.` : "Pediste cambios.";
};

const InitiativeBar = ({ p, d, b, m, decisions, acts, links }: { p: OrgProject; d: IdeaDetail; b: IdeaBuilt; m: RioModel; decisions: Decision[]; acts: CorrienteActs; links: FichaLinks }) => {
  const cerrar = useCerrar();
  const you = b.steps.find((s) => s.etapa === "te_toca");
  const live = b.steps.find((s) => s.etapa && ["construyendo", "en_qa", "en_revision", "devuelto"].includes(s.etapa));
  if (b.published_at)
    return (
      <Bar tone="calm" label="Nada pendiente" side={<Link className="cor-btn secondary" to={links.pedir} data-control="ficha-ajuste">Pedir un ajuste</Link>}>
        Ya está publicado. <span>Si algo no quedó, pídelo y vuelve a entrar a la corriente.</span>
      </Bar>
    );
  if (b.can_close)
    return (
      <Bar tone="you" label="Te toca" side={<Btn kind="primary" disabled={cerrar.isPending} onClick={() => cerrar.mutate({ slug: p.slug, key: b.key, version: b.version })} data-control="ficha-cerrar-iniciativa">{cerrar.isPending ? "Cerrando…" : "Cerrar iniciativa"}</Btn>}>
        Todos sus pasos están hechos. <span>Cerrarla la pasa a Completas.</span>
      </Bar>
    );
  if (you) {
    const n = b.steps.indexOf(you) + 1;
    const t = [...(p.tablero?.initiatives.flatMap((i) => i.tickets) ?? []), ...(p.tablero?.loose ?? [])].find((x) => x.key === you.key);
    const accept = t ? (cardActs(t, { team: p.team, decisions, orders: p.orders, nextFirst: p.next_first }).find((a) => a.kind === "aceptar") as Extract<CardAct, { kind: "aceptar" }> | undefined) : undefined;
    const dl = deliveryFor(you.key, decisions);
    return (
      <Bar
        tone="you"
        label="Te toca"
        side={
          <>
            {accept && (
              <Btn kind={dl ? "secondary" : "primary"} disabled={busyOf(accept, acts) || !!accept.decision.hold} aria-label={acceptWords(accept.decision).aria} onClick={() => run(p.slug, accept, acts)} data-control="ficha-aceptar">
                Aceptar
              </Btn>
            )}
            {dl ? (
              <Link className="cor-btn primary" to={links.entrega(dl)} data-control="ficha-ver-entrega">
                Ver la entrega
              </Link>
            ) : (
              <Link className={`cor-btn ${accept ? "quiet" : "primary"}`} to={links.paso(you.key)} data-control="ficha-ver-paso">
                Ver el paso
              </Link>
            )}
          </>
        }
      >
        {`El paso ${n}, «${you.title}», espera que lo aceptes.`} <span>{you.pr ? `PR #${you.pr.number}.` : ""}</span>
      </Bar>
    );
  }
  if (live)
    return (
      <Bar tone="live" label="Taller construye" side={<Link className="cor-btn secondary" to={links.paso(live.key)} data-control="ficha-ver-paso">Ver el paso</Link>}>
        {`Va en el paso ${b.steps.indexOf(live) + 1} de ${b.total}, «${live.title}».`} <span>{ETAPA_WORD[live.etapa!]}. Nada te espera.</span>
      </Bar>
    );
  const next = b.steps.find((s) => !["Merged", "Released", "Done"].includes(s.status));
  return (
    <Bar tone="calm" label={m.steps.total ? "En el tablero" : "Sin pasos"} side={next ? <Link className="cor-btn secondary" to={links.paso(next.key)} data-control="ficha-ver-paso">Ver el paso</Link> : undefined}>
      {next ? `Sigue el paso ${b.steps.indexOf(next) + 1}, «${next.title}».` : "La iniciativa no tiene pasos todavía."} <span>{next ? `${ETAPA_WORD[next.etapa ?? "lista"]}. Nadie lo trabaja ahora.` : ""}</span>
    </Bar>
  );
};

const Ahora = ({ p, d, m, ui, set, acts, decisions, links }: { p: OrgProject; d: IdeaDetail; m: RioModel; ui: Ui; set: (x: Partial<Ui>) => void; acts: CorrienteActs; decisions: Decision[]; links: FichaLinks }) => {
  const k = d.key;
  const busy = (a: string) => acts.busy === `pedido-${k}:${a}`;
  const send = (stop: PedidoStop, input: Omit<IdeaAnswerInput, "stop">) => acts.respuesta(p.slug, k, { stop, ...input });
  if (d.built) return <InitiativeBar p={p} d={d} b={d.built} m={m} decisions={decisions} acts={acts} links={links} />;
  if (d.guardada)
    return (
      <Bar tone="calm" label="Guardada" side={isOpen(d) && <Btn kind="primary" disabled={busy("restaurar")} onClick={() => acts.pedido(p.slug, k, "restaurar")} data-control="ficha-restaurar-ahora">Restaurar</Btn>}>
        Está fuera de la corriente. <span>Nadie la trabaja hasta que la restaures.</span>
      </Bar>
    );
  if (d.question && isOpen(d))
    return (
      <Bar
        tone="you"
        label="El PO pregunta"
        side={
          <form
            className="cor-ficha-answer"
            onSubmit={(e) => {
              e.preventDefault();
              if (ui.answer.trim() && !busy("answer")) acts.answerQuestion(p.slug, k, d.question!.id, ui.answer.trim());
            }}
            data-pregunta={d.question.id}
          >
            {d.question_options.slice(0, 3).map((o) => (
              <Btn key={o} kind="secondary" disabled={busy("answer")} onClick={() => acts.answerQuestion(p.slug, k, d.question!.id, o)} title={o}>
                <span className="cor-ellipsis" style={{ maxWidth: 160 }}>
                  {o}
                </span>
              </Btn>
            ))}
            <input className="cor-input" value={ui.answer} maxLength={1000} placeholder="Contesta aquí…" aria-label="Tu respuesta al PO" onChange={(e) => set({ answer: e.target.value })} />
            <Btn kind="primary" type="submit" disabled={!ui.answer.trim() || busy("answer")} data-control="ficha-contestar">
              Contestar
            </Btn>
          </form>
        }
      >
        <span className="cor-ficha-q" title={d.question.text}>
          {d.question.text}
        </span>
      </Bar>
    );
  if (d.stop === "lista" && isOpen(d)) {
    if (d.state === "valvula" && stuckOf(p, d)) {
      const at = orderedAt(d);
      return (
        <Bar tone="you" label="Atorada" side={<Btn kind="primary" disabled={busy("despertar")} onClick={() => acts.despertar(p.slug, k)} data-control="ficha-despertar-valvula">{busy("despertar") ? "Despertando…" : "Despertar al PO"}</Btn>}>
          {at ? `Dijiste «Constrúyelo» a las ${hm(at)}.` : "Dijiste «Constrúyelo»."} <span>Nadie la está subiendo al tablero: despierta al PO para que cree la iniciativa.</span>
        </Bar>
      );
    }
    if (d.state === "valvula")
      return (
        <Bar tone="live" label="Pasando al tablero" side={<Btn kind="primary" disabled data-control="ficha-construir">Pasando al tablero…</Btn>}>
          Dijiste «Constrúyelo». <span>El PO está creando la iniciativa; la presa se abre en cuanto exista.</span>
        </Bar>
      );
    return (
      <Bar tone="you" label="Te toca" side={<Btn kind="primary" disabled={busy("construir")} onClick={() => acts.pedido(p.slug, k, "construir")} data-control="ficha-construir">Constrúyelo</Btn>}>
        Falta tu «Constrúyelo». <span>Se abre la presa: pasa al tablero y Taller empieza por el primer paso.</span>
      </Bar>
    );
  }
  // The chosen stop's answer, while it is open and delivered.
  const s = STOP_IDS.includes(ui.sel as PedidoStop) ? d.stops.find((x) => x.stop === ui.sel)! : null;
  if (s && ANSWERABLE.includes(s.stop) && s.delivered && isOpen(d)) {
    if (s.answer)
      return (
        <Bar tone="calm" label={SEL_NAME[s.stop]} side={s.answer.verdict === "ok" && <Btn kind="secondary" disabled={busy("respuesta")} onClick={() => send(s.stop, { verdict: "deshacer" })} data-control="ficha-deshacer">Deshacer</Btn>}>
          {said(s)} <span>{s.answer.verdict === "ok" ? "Nada se detiene." : `Volvió a ${SEL_NAME[s.stop]}; lo que sigue se rehace.`}</span>
        </Bar>
      );
    if (s.stop === "entendido")
      return (
        <Bar
          tone="you"
          label="Te toca"
          side={
            <form
              className="cor-ficha-answer"
              onSubmit={(e) => {
                e.preventDefault();
                if (ui.text.trim() && !busy("respuesta")) send("entendido", { verdict: "corregir", text: ui.text.trim() });
              }}
            >
              <input className="cor-input" maxLength={1000} value={ui.text} aria-label="Qué entendió mal el PO" placeholder="O corrígelo aquí…" onChange={(e) => set({ text: e.target.value })} />
              {ui.text.trim() ? (
                <Btn kind="primary" type="submit" disabled={busy("respuesta")} data-control="ficha-corregir">
                  Corregir
                </Btn>
              ) : (
                <Btn kind="primary" disabled={busy("respuesta")} onClick={() => send("entendido", { verdict: "ok" })} data-control="ficha-ok">
                  Así es
                </Btn>
              )}
            </form>
          }
        >
          ¿Entendió bien el PO? <span>Si dices «Así es», sigue a Investigación.</span>
        </Bar>
      );
    if (s.stop === "investigacion" && d.research.options.length) {
      const rec = recommended(d) ?? 1;
      const pick = ui.pick ?? rec;
      return (
        <Bar
          tone="you"
          label="Te toca"
          side={
            <>
              <span className="cor-segbox" role="radiogroup" aria-label="Opciones de la investigación">
                {d.research.options.map((o) => (
                  <Opt key={o.n} on={pick === o.n} role="radio" aria-checked={pick === o.n} onClick={() => set({ pick: o.n })} title={o.title} data-option={o.n}>
                    {o.n}
                  </Opt>
                ))}
              </span>
              {pick === rec ? (
                <Btn kind="primary" disabled={busy("respuesta")} onClick={() => send("investigacion", { verdict: "ok" })} data-control="ficha-ok">
                  Va con la recomendada
                </Btn>
              ) : (
                <Btn kind="primary" disabled={busy("respuesta")} onClick={() => send("investigacion", { verdict: "opcion", option: pick })} data-control="ficha-opcion">
                  Pedir la opción {pick}
                </Btn>
              )}
            </>
          }
        >
          {`Research recomienda la opción ${rec}.`} <span>Elige otra y Research la rehace.</span>
        </Bar>
      );
    }
    if (s.stop === "diseno" && d.frames.length) {
      const ready = ui.pins.filter((x) => x.text.trim());
      return (
        <Bar
          tone="you"
          label="Te toca"
          side={
            <>
              <Btn kind="secondary" disabled={busy("respuesta") || ready.length === 0} onClick={() => send("diseno", { verdict: "cambios", notes: ready })} data-control="ficha-notas">
                {ready.length ? `Enviar ${ready.length === 1 ? "la nota" : `${ready.length} notas`} a Artist` : "Pedir cambios"}
              </Btn>
              <Btn kind="primary" disabled={busy("respuesta")} onClick={() => send("diseno", { verdict: "ok" })} data-control="ficha-ok">
                Me gusta
              </Btn>
            </>
          }
        >
          {`Artist dejó ${d.frames.length} ${d.frames.length === 1 ? "marco" : "marcos"}.`} <span>«Me gusta» deja que siga; una nota en un marco la regresa a Artist.</span>
        </Bar>
      );
    }
    return (
      <Bar
        tone="you"
        label="Te toca"
        side={
          ui.asking ? (
            <form
              className="cor-ficha-answer"
              onSubmit={(e) => {
                e.preventDefault();
                if (ui.text.trim() && !busy("respuesta")) send(s.stop, { verdict: "cambios", text: ui.text.trim() });
              }}
            >
              <input className="cor-input" maxLength={1000} value={ui.text} aria-label="Qué cambiarías" placeholder="¿Qué cambiarías?" onChange={(e) => set({ text: e.target.value })} autoFocus />
              <Btn kind="primary" type="submit" disabled={busy("respuesta") || !ui.text.trim()} data-control="ficha-cambios">
                Pedir cambios
              </Btn>
            </form>
          ) : (
            <>
              <Btn kind="secondary" disabled={busy("respuesta")} onClick={() => set({ asking: true })} data-control="ficha-pide-cambios">
                Pedir cambios
              </Btn>
              <Btn kind="primary" disabled={busy("respuesta")} onClick={() => send(s.stop, { verdict: "ok" })} data-control="ficha-ok">
                Me gusta
              </Btn>
            </>
          )
        }
      >
        {s.stop === "plan" ? "El plan está escrito." : `${SEL_NAME[s.stop]} entregó.`} <span>Nada espera tu respuesta: si no dices nada, sigue sola.</span>
      </Bar>
    );
  }
  // Nothing to answer here: what the thing is doing.
  if (d.state === "trabajando") return <Bar tone="live" label={`${whoName(d.who) || "Alguien"} la trabaja`}>{`Va en ${SEL_NAME[d.stop]}.`} <span>Te avisa cuando entregue.</span></Bar>;
  if (d.queued) return <Bar tone="live" label={`En la fila de ${whoName(d.queued)}`}>La toma en su siguiente turno. <span>Nada te espera.</span></Bar>;
  if (d.state === "cola")
    return (
      <Bar tone="calm" label="En la fila del PO" side={isOpen(d) && <Btn kind="secondary" disabled={busy("despertar")} onClick={() => acts.despertar(p.slug, k)} data-control="ficha-despertar-ahora">Despertar al PO</Btn>}>
        Nadie la ha tomado todavía. <span>Está en el buzón.</span>
      </Bar>
    );
  if (d.quiet_since && isOpen(d))
    return (
      <Bar tone="calm" label="Quieta" side={<Btn kind="secondary" disabled={busy("despertar")} onClick={() => acts.despertar(p.slug, k)} data-control="ficha-despertar-ahora">Despertar</Btn>}>
        {`Nadie la trabaja desde ${hm(d.quiet_since)}.`} <span>Si la despiertas, la toma quien tiene {SEL_NAME[d.stop]}.</span>
      </Bar>
    );
  return <Bar tone="calm" label="Nada pendiente">{isOpen(d) ? `Sigue en ${SEL_NAME[d.stop]}.` : d.status === "Open" ? "Ya está en el tablero." : "Esta idea está cerrada."} <span>Nada te espera.</span></Bar>;
};

// ---- the ficha

export const Ficha = ({ p, k, now, timeZone, acts, decisions, links, onClose, extra = null }: { p: OrgProject; k: string; now: number; timeZone?: string; acts: CorrienteActs; decisions: Decision[]; links: FichaLinks; onClose: () => void; extra?: ReactNode }) => {
  const q = useQuery({ queryKey: ["idea", p.slug, k], queryFn: () => api.idea(p.slug, k), refetchInterval: 15_000 });
  const d = q.data;
  const [state, setUi] = useState<Ui | null>(null);
  // The first read decides where it opens; from then on the owner's clicks do.
  const ui = state ?? (d ? initialUi(d) : null);
  const set = (x: Partial<Ui>) => setUi((u) => (u ? { ...u, ...x } : d ? { ...initialUi(d), ...x } : u));
  const told = useRef(new Set<string>());
  // When the PO creates the initiative while it is open, the ficha moves to Construcción.
  const builtKey = d?.built?.key ?? null;
  const prevBuilt = useRef<string | null>(builtKey);
  useEffect(() => {
    if (builtKey && !prevBuilt.current) set({ sel: "construccion", sub: "entrega" });
    prevBuilt.current = builtKey;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [builtKey]);
  // A sent answer or note shows on the next read: clear what was typed then.
  const [trailN, setTrailN] = useState(0);
  useEffect(() => {
    if (!d) return;
    if (d.trail.length > trailN && trailN > 0) setUi((u) => (u ? { ...u, note: "", answer: "", text: "", asking: false, pins: [] } : u));
    setTrailN(d.trail.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d?.trail.length]);
  const s = d && ui && STOP_IDS.includes(ui.sel as PedidoStop) ? d.stops.find((x) => x.stop === ui.sel) : null;
  const shown = !!(ui?.sub === "entrega" && s?.delivered && !s.seen && s.stop !== "buzon" && d?.kind !== "initiative");
  useEffect(() => {
    if (!shown || !d || !s) return;
    const key = `${d.key}:${s.stop}:${s.at}`;
    if (told.current.has(key)) return;
    told.current.add(key);
    acts.visto(p.slug, d.key, s.stop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, s?.stop, d?.key]);
  if (q.isError)
    return (
      <section className="cor-ficha error" data-ficha={k} aria-label="Ficha">
        <ReadError what="la ficha" onRetry={() => void q.refetch()} />
        <Btn kind="quiet" small onClick={onClose} data-control="ficha-cerrar">
          Cerrar ✕
        </Btn>
      </section>
    );
  if (!d || !ui) return <div className="cor-ficha cor-skel" data-ficha={k} aria-busy="true" aria-label="Leyendo la ficha" />;
  const m = rioOf(d);
  const you = m.front === "you";
  const busy = (a: string) => acts.busy === `pedido-${d.key}:${a}`;
  const born = d.built && d.kind !== "initiative" ? d.key : d.built && d.key !== d.built.key ? d.key : null;
  return (
    <section className={`cor-ficha ${you ? "you" : ""}`} data-ficha={d.built?.key ?? d.key} data-sel={ui.sel} aria-label={`${kindWord(d)} ${d.built?.key ?? d.key}: ${d.short ?? d.title}`}>
      <div className="cor-ficha-head">
        <div className="cor-ficha-ids">
          <span className="cor-ficha-line">
            <Label tone={you ? "amber" : "violet"}>{kindWord(d)}</Label>
            <Key>{d.built?.key ?? d.key}</Key>
            {born && (
              <>
                <span className="cor-cap">nació de</span>
                <span className="cor-key muted">{born}</span>
              </>
            )}
            {d.unseen > 0 && !d.built && <span className="cor-cap">{`· ${d.unseen} ${d.unseen === 1 ? "entrega sin ver" : "entregas sin ver"}`}</span>}
          </span>
          <h2 className="cor-ellipsis" title={d.title}>
            {d.short ?? d.summary ?? d.title}
          </h2>
        </div>
        <Btn kind="quiet" small aria-pressed={ui.sub === "recorrido"} onClick={() => set({ sub: ui.sub === "recorrido" ? "entrega" : "recorrido" })} data-control="ficha-recorrido">
          Recorrido
        </Btn>
        {isOpen(d) && (
          <Btn kind="quiet" small aria-pressed={ui.sub === "nota"} onClick={() => set({ sub: ui.sub === "nota" ? "entrega" : "nota" })} data-control="ficha-nota">
            Nota
          </Btn>
        )}
        {isOpen(d) && d.pedido && (
          <>
            {/* Restaurar a saved one is «Ahora»'s button. */}
            {!d.guardada && (
              <Btn kind="quiet" small disabled={busy("guardar") || d.state === "valvula"} onClick={() => acts.pedido(p.slug, d.key, "guardar")} data-control="ficha-guardar">
                Guardar
              </Btn>
            )}
            <Btn kind={ui.drop ? "danger" : "quiet"} small disabled={busy("descartar")} onClick={() => (ui.drop ? (set({ drop: false }), acts.pedido(p.slug, d.key, "descartar"), onClose()) : set({ drop: true }))} onBlur={() => ui.drop && set({ drop: false })} data-control="ficha-descartar">
              {ui.drop ? "¿Seguro? Descartar" : "Descartar"}
            </Btn>
          </>
        )}
        <Btn kind="quiet" small onClick={onClose} aria-label="Cerrar la ficha" data-control="ficha-cerrar">
          Cerrar ✕
        </Btn>
      </div>
      <Rio d={d} m={m} ui={ui} set={set} stuck={stuckOf(p, d)} />
      <div className="cor-ficha-entrega" id={`ficha-panel-${d.key}`} role="tabpanel" aria-labelledby={`ficha-tab-${d.key}-${ui.sel}`} tabIndex={0} data-panel={ui.sub === "entrega" ? ui.sel : ui.sub}>
        {d.question && isOpen(d) && ui.sub === "entrega" && (
          <p className="cor-ficha-ask" data-pregunta-texto>
            <Label tone="amber">El PO pregunta</Label> {d.question.text}
          </p>
        )}
        {ui.sub === "recorrido" ? <Trail d={d} now={now} timeZone={timeZone} set={set} /> : ui.sub === "nota" ? <Nota d={d} ui={ui} set={set} acts={acts} slug={p.slug} /> : <Delivery d={d} m={m} ui={ui} set={set} links={links} now={now} timeZone={timeZone} acts={acts} slug={p.slug} />}
      </div>
      <FichaExtra.Provider value={extra}>
        <Ahora p={p} d={d} m={m} ui={ui} set={set} acts={acts} decisions={decisions} links={links} />
      </FichaExtra.Provider>
    </section>
  );
};
