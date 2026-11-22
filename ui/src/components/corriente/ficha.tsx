// PLA-I65-3/4 (Una sola ficha, PLA-IDEA27 pass 3): a pedido, an idea and an initiative open the same ficha, in place.
// Head: what it is (Pedido tuyo, Idea, Iniciativa), its key (and the idea it was born from), its short name, and
// Recorrido, Nota, Guardar or Restaurar, Descartar and Cerrar, quiet. Then the current (rio.tsx) with the stops as
// HTML tabs over it, one full-width delivery panel for the chosen stop, and «Ahora»: one sentence and one white
// button (amber when it waits on the owner, violet when someone works it, grey when nothing does).
// Everything La idea abierta did (PLA-I61) stays: answers per stop, notes pinned on Artist's frames, Despertar, the
// team note with pictures, the trail, «visto». An initiative adds Construcción (its steps, stage and PR, Aceptar on
// the one that waits) and Publicado (when, and the evidence). Calls: GET …/ideas/:key (PLA-I65-1) and the
// building's writes (acts.ts).
import { createPortal } from "react-dom";
import { createContext, useContext, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Link } from "react-router";
import { api, type Decision, type IdeaAnswerInput, type IdeaBuilt, type IdeaDetail, type IdeaNote, type IdeaStop, type OrgProject, type PedidoStop, type PedidoTrailItem } from "@/lib/api";
import { cardActs, deliveryFor, etapaWord, type CardAct } from "@/lib/etapas";
import { acceptWords } from "@/lib/evidencia";
import type { CorrienteActs } from "./acts";
import { Decisiones, forwardOf } from "./decisiones";
import { Images } from "./images";
import { useRevision } from "./revision";
import { buildWarning } from "@/lib/revision";
import { Btn, Key, Label, Opt, ReadError, State, type StateTone } from "./parts";
import { Corriente } from "./rio";
import { CX0, PX, STOP_IDS, STOP_NAMES, SX, VX, W, rioOf, type Chan, type RioModel } from "./rio-geo";
import { busyOf, run, useCerrar } from "./tablero";
import { DeployBar, DeployLog } from "./deploy-card";
import { firstStop, stopLine, whoName } from "./idea";
import { LOCALE } from "@/lib/locale";
import { FICHA_WORDS } from "@/lib/ficha-words";
import { ideaName } from "@/lib/nombre";
import { stopBar } from "@/lib/ficha";
import { CRONO_WORDS, cronoView, type CronoBar, type Cronometro as CronoData } from "@/lib/cronometro";
import { informeView, type RunReport } from "@/lib/informe";
import { words } from "@/lib/i18n";

export type Sel = PedidoStop | "construccion" | "publicado";
const SEL_IDS: Sel[] = [...STOP_IDS, "construccion", "publicado"];
/** The ficha's words in the screen's language (PLA-I2-10). */
const say = () => words(FICHA_WORDS);
const selName = (x: Sel): string => say().sel[x];
const ANSWERABLE: PedidoStop[] = ["entendido", "investigacion", "diseno", "plan"];
const pct = (x: number) => `${(x / W) * 100}%`;
const hm = (iso: string, timeZone?: string) => new Intl.DateTimeFormat(LOCALE, { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).format(new Date(iso));
export const dayHm = (iso: string, now: number, timeZone?: string) => {
  const day = (t: number) => new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "short", timeZone }).format(new Date(t)).replace(".", "");
  return day(Date.parse(iso)) === day(now) ? say().today(hm(iso, timeZone)) : `${day(Date.parse(iso))} ${hm(iso, timeZone)}`;
};
const isOpen = (d: IdeaDetail) => d.status === "Open" && !d.promoted_to && d.kind !== "initiative";
const Md = ({ children }: { children: string }) => (
  <div className="cor-md">
    <Markdown remarkPlugins={[remarkGfm]}>{children}</Markdown>
  </div>
);

/** What it is, in the head: an initiative once built, his own request, or an idea. */
export const kindWord = (d: Pick<IdeaDetail, "pedido" | "kind" | "built">) => (d.built || d.kind === "initiative" ? say().kindInitiative : d.pedido ? say().kindPedido : say().kindIdea);
/** The stop the ficha opens on: the building once it is built, else the newest delivery not seen, else where it is. */
export function selOf(d: Pick<IdeaDetail, "stops" | "stop" | "built">): Sel {
  if (d.built) return d.built.published_at || d.built.deploy?.state === "error" ? "publicado" : "construccion";
  return firstStop(d);
}
/** The recommended option: the one the recommendation names («opción N»), else the first. */
export function recommended(d: Pick<IdeaDetail, "research">): number | null {
  // AUDIT-8: Research's own data names it; a doc written by hand is read as before.
  if (d.research.recommended && d.research.options.some((o) => o.n === d.research.recommended)) return d.research.recommended;
  const n = Number(/opci[oó]n\s*(\d+)/i.exec(d.research.recommendation ?? "")?.[1] ?? NaN);
  return d.research.options.some((o) => o.n === n) ? n : (d.research.options[0]?.n ?? null);
}

// dec: the option he has marked on each of the PO's decisions (by its number) before sending; why: his words for a change.
type Ui = { sel: Sel; sub: "entrega" | "recorrido" | "nota"; frame: number; pins: IdeaNote[]; text: string; asking: boolean; pick: number | null; note: string; answer: string; drop: boolean; dec: Record<number, number>; why: Record<number, string>; grande: boolean };
/** PLA-62: «Constrúyelo» said and nobody is turning it into an initiative (no live run on it): stuck, as the list says. */
export const stuckOf = (p: Pick<OrgProject, "paused" | "team">, d: Pick<IdeaDetail, "key" | "state">) =>
  d.state === "valvula" && (p.paused || !p.team.some((m) => m.state === "running" && m.now?.ticket === d.key));
/** When he said «Constrúyelo» (the newest one), from the trail. */
export const orderedAt = (d: Pick<IdeaDetail, "trail">) => [...(d.trail ?? [])].reverse().find((t) => t.kind === "construir")?.at ?? null;

// PLA-90: the lightbox takes the focus when it opens, and only then. An inline ref callback is a new function on every
// render, so React called it on each keystroke and pulled the focus out of the pin's note field.
const focusOnOpen = (el: HTMLElement | null) => {
  if (el && !el.contains(document.activeElement)) el.focus();
};
// PLA-90: the Diseño preview box (CSS .cor-ficha-frame-big); the frame is fitted inside it whole, so a pin's
// percentages are of the frame itself, not of the letterbox around it.
const PREVIEW_W = 220;
const PREVIEW_H = 124;
export const fitIn = (w: number | null, h: number | null, boxW: number, boxH: number): { width: number; height: number } => {
  const fw = w && w > 0 ? w : 16;
  const fh = h && h > 0 ? h : 10;
  const k = Math.min(boxW / fw, boxH / fh);
  return { width: Math.round(fw * k), height: Math.round(fh * k) };
};
/** PLA-114 (guided test PLA-86, F-10): a phone frame (563×1562) fitted whole into 220×124 was a 45 px strip. A frame
 * much taller than the box fills the box's width at its own height and the box scrolls; pins keep their place, since
 * they are fractions of the whole frame. Anything else is fitted whole, as before. */
export const previewOf = (w: number | null, h: number | null, boxW: number, boxH: number): { size: { width: number; height: number }; tall: boolean } => {
  const fw = w && w > 0 ? w : 16;
  const fh = h && h > 0 ? h : 10;
  if (fh / fw > (boxH / boxW) * 2) return { size: { width: boxW, height: Math.round((boxW * fh) / fw) }, tall: true };
  return { size: fitIn(w, h, boxW, boxH), tall: false };
};
const initialUi = (d: IdeaDetail): Ui => ({ sel: selOf(d), sub: "entrega", frame: 0, pins: [], text: "", asking: false, pick: null, note: "", answer: "", drop: false, dec: {}, why: {}, grande: false });
export type FichaLinks = { doc: (id: string) => string; paso: (key: string) => string; entrega: (d: Decision) => string; pedir: string };

// ---- the stops as tabs over the current

/** About what the bar's two lines hold beside the answer buttons. */
export const QUESTION_FITS = 110;

type TabInfo = { sel: Sel; who: string; tone: "you" | "live" | "new" | "ok" | ""; gist: string | null; state: "done" | "here" | "todo" | "none" };
function tabsOf(d: IdeaDetail, m: RioModel, stuck = false): TabInfo[] {
  const w = say();
  const alone = d.kind === "initiative" && !d.stops.some((s) => s.delivered);
  const out: TabInfo[] = d.stops.map((s, i) => {
    const built = !!d.built;
    // Once built the stops are history: who delivered, no «sin ver».
    // PLA-63: an initiative that never was an idea has no idea stops: empty, as its row in the list draws them.
    const line = alone ? { text: "", tone: "" as const } : built ? { text: s.stop === "lista" ? w.yourYes : s.stop === "buzon" ? w.you : whoName(s.by) || "—", tone: "" as const } : s.stop === "lista" && s.state === "here" && d.state === "valvula" ? (stuck ? { text: w.stuck, tone: "you" as const } : { text: w.passing, tone: "live" as const }) : s.stop === "lista" && s.state === "here" && d.state === "quieta" ? { text: w.waitsYourYes, tone: "you" as const } : s.state === "here" && d.state === "trabajando" ? { text: w.someoneWorks(whoName(d.who)), tone: "live" as const } : stopLine(s, d);
    return { sel: s.stop, who: line.text, tone: line.tone, gist: d.gist?.[s.stop] ?? null, state: alone ? "none" : i < m.here ? "done" : i === m.here ? "here" : "todo" };
  });
  const b = d.built;
  const you = m.chans.includes("you");
  out.push({
    sel: "construccion",
    who: !b ? (d.plan_steps.length ? w.planSteps(d.plan_steps.length) : w.notYet) : b.published_at ? w.allSteps(b.total) : `${w.stepsDone(b.done, b.total)}${you ? w.oneWaits : m.front === "live" ? w.tallerBuilds : ""}`,
    tone: b && !b.published_at ? (you ? "you" : m.front === "live" ? "live" : "") : "",
    gist: b ? (m.per > 1 ? w.channelEvery(m.per) : w.channelPerStep) : null,
    state: m.here > 6 ? "done" : m.here === 6 ? "here" : "todo",
  });
  out.push({ sel: "publicado", who: b?.published_at ? dayHm(b.published_at, Date.now()) : b?.deploy?.state === "error" ? w.deploy.tab : w.notYet, tone: b?.published_at ? "ok" : b?.deploy?.state === "error" ? "you" : "", gist: null, state: m.here === 7 ? "done" : "todo" });
  return out;
}

const TAB_POS: Record<Sel, { left: number; width: number }> = {
  ...(Object.fromEntries(STOP_IDS.map((s, i) => [s, { left: SX(i) - 12, width: 112 }])) as Record<PedidoStop, { left: number; width: number }>),
  construccion: { left: CX0 - 12, width: 340 },
  publicado: { left: PX - 46, width: 104 },
};

const Rio = ({ d, m, ui, set, stuck = false }: { d: IdeaDetail; m: RioModel; ui: Ui; set: (p: Partial<Ui>) => void; stuck?: boolean }) => {
  const w = say();
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
        <b>{w.buildIt}</b>
        <span>{dam === "open" ? (d.kind === "initiative" && !d.stops.some((x) => x.delivered) ? w.damOpen : w.damYourYes) : dam === "wait" ? (d.state === "valvula" ? (stuck ? w.damStuck : w.damPassing) : w.damNeedsYes) : w.damClosed}</span>
      </div>
      <div role="tablist" aria-label={w.stops} className="cor-ficha-tabs" onKeyDown={onKey}>
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
            <b>{selName(t.sel)}</b>
            <span className={`cor-ficha-who ${t.tone === "you" ? "amber" : t.tone === "live" || t.tone === "new" ? "live" : t.tone === "ok" ? "ok" : ""}`}>{t.who}</span>
            {t.gist && t.state !== "todo" && t.state !== "none" && <span className="cor-ficha-gist">{t.gist}</span>}
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
        {say().readDoc(doc.title)}
      </Link>
    )}
  </div>
);
const Empty = ({ title, line, children }: { title: string; line: string; children?: ReactNode }) => (
  <div className="cor-ficha-empty" data-stop-empty>
    <Label>{say().notYet}</Label>
    <b>{title}</b>
    <span className="cor-text">{line}</span>
    {children}
  </div>
);
const eb = (s: IdeaStop, now: number, timeZone?: string, extra?: string) => [selName(s.stop), s.by ? say().delivered(whoName(s.by)) : null, s.at ? dayHm(s.at, now, timeZone) : null, extra].filter(Boolean).join(" · ");

const PlanSteps = ({ titles, chans, links, keys }: { titles: string[]; chans?: Chan[]; links?: FichaLinks; keys?: string[] }) => {
  // Three per column up to four columns; more steps add rows (the panel scrolls inside).
  const w = say();
  const cols = Math.min(4, Math.max(1, Math.ceil(titles.length / 3)));
  const rows = Math.max(1, Math.ceil(titles.length / cols));
  return (
    <ol className="cor-ficha-pasos" style={{ gridTemplateRows: `repeat(${rows}, minmax(38px, auto))`, gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` } as CSSProperties} data-pasos={titles.length}>
      {titles.map((t, k) => {
        const c = chans?.[k];
        const [word, tone, cls]: [string, StateTone, string] = c === "done" || c === "fin" ? [w.stepDone, "ok", ""] : c === "you" ? [w.stepYou, "amber", "cur"] : c === "live" ? [w.stepLive, "live", "liv"] : [w.stepTodo, undefined, ""];
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

// PLA-I73-1: where the time went, one bar for the whole initiative and one per step, in the fixed order of the pieces.
const CronoBars = ({ bars, big }: { bars: CronoBar[]; big?: boolean }) => (
  <div className={`cor-crono-bar${big ? " is-big" : ""}`} role="img" aria-label={bars.map((b) => `${b.label} ${b.text}`).join(", ")}>
    {bars.map((b) => (
      <span key={b.tramo} className={`cor-crono-${b.tramo}`} style={{ flexGrow: b.ms }} title={`${b.label}: ${b.text}`} />
    ))}
  </div>
);
const Cronometro = ({ c }: { c: CronoData | undefined }) => {
  const v = cronoView(c);
  if (!v) return null;
  const cw = words(CRONO_WORDS);
  return (
    <section className="cor-crono" aria-label={cw.title}>
      <h4 className="cor-crono-h">
        {cw.title} · {v.headline}
      </h4>
      {v.before ? <p className="cor-crono-before">{v.before}</p> : null}
      <CronoBars bars={v.total} big />
      <ul className="cor-crono-legend">
        {v.total.map((b) => (
          <li key={b.tramo}>
            <i className={`cor-crono-${b.tramo}`} />
            {b.label} <b>{b.text}</b>
          </li>
        ))}
      </ul>
      <ol className="cor-crono-steps">
        {v.steps.map((s) => (
          <li key={s.key}>
            <span className="cor-crono-name">{s.title}</span>
            <CronoBars bars={s.bars} />
            <span className="cor-crono-ms">{s.text}</span>
          </li>
        ))}
      </ol>
    </section>
  );
};

// PLA-I74-1: the run report under the stopwatch: what rescued it (Plania's fixes, his extra clicks, turns Plania freed),
// time per stop, the longest stretch with nobody's turn and the tokens per agent.
export const Informe = ({ r }: { r: RunReport | undefined }) => {
  const v = informeView(r);
  if (!v) return null;
  return (
    <section className="cor-informe" aria-label={v.title}>
      <h4 className="cor-crono-h">{v.title}</h4>
      <ul className="cor-informe-lines">
        <li>
          <b>{v.fixes}</b>
          {v.fixItems.length ? <span className="cor-informe-sub">{v.fixItems.join(" · ")}</span> : null}
        </li>
        <li>
          <b>{v.clicks}</b>
          {v.extra.length ? <span className="cor-informe-sub">{v.extra.map((e) => `${e.label} ×${e.n}`).join(" · ")}</span> : null}
          {v.estimated ? <span className="cor-informe-sub">{v.estimated}</span> : null}
        </li>
        <li>
          <b>{v.heals}</b>
        </li>
        <li>
          <b>{v.gap}</b>
        </li>
      </ul>
      <div className="cor-informe-cols">
        <div>
          <h5 className="cor-informe-h">{v.stopsTitle}</h5>
          <dl className="cor-informe-dl">
            {v.stops.map((s) => (
              <div key={s.label}>
                <dt>{s.label}</dt>
                <dd>{s.text}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div>
          <h5 className="cor-informe-h">{v.tokensTitle}</h5>
          {v.tokens.length ? (
            <dl className="cor-informe-dl">
              {v.tokens.map((t) => (
                <div key={t.agent}>
                  <dt>{whoName(t.agent) || t.agent}</dt>
                  <dd>{t.text}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="cor-crono-before">{v.noTokens}</p>
          )}
        </div>
      </div>
    </section>
  );
};

const Delivery = ({ d, m, ui, set, links, now, timeZone, acts, slug }: { d: IdeaDetail; m: RioModel; ui: Ui; set: (p: Partial<Ui>) => void; links: FichaLinks; now: number; timeZone?: string; acts: CorrienteActs; slug: string }) => {
  const w = say();
  const b = d.built ?? null;
  if (ui.sel === "construccion") {
    if (!b)
      return (
        <Empty title={w.notInitiative} line={d.stop === "lista" ? (d.state === "valvula" ? w.notInitiativeOrdered : w.notInitiativeLista) : w.notInitiativeYet} />
      );
    const open = b.prs.filter((p) => p.state === "open").map((p) => `#${p.number}`);
    const merged = b.prs.filter((p) => p.state === "merged").length;
    return (
      <>
        <Eyebrow links={links}>{[`${selName("construccion")} · ${b.key}`, w.builtDone(b.done, b.total), open.length ? w.prsOpen(open.join(", "), open.length) : null, merged ? w.prsMerged(merged) : null].filter(Boolean).join(" · ")}</Eyebrow>
        {b.steps.length ? (
          <PlanSteps titles={b.steps.map((s) => s.title)} keys={b.steps.map((s) => s.key)} chans={b.steps.map((s) => (b.published_at ? "fin" : s.status === "Done" || s.status === "Merged" || s.status === "Released" ? "done" : s.etapa === "te_toca" ? "you" : s.etapa && ["construyendo", "en_qa", "en_revision", "devuelto"].includes(s.etapa) ? "live" : "todo"))} links={links} />
        ) : (
          <p className="cor-text">{w.noSteps}</p>
        )}
        <Cronometro c={b.tiempo} />
        <Informe r={b.informe} />
      </>
    );
  }
  if (ui.sel === "publicado") {
    // PLA-I74-8: a failed production build shows the host's log here.
    if (!b?.published_at && b?.deploy?.state === "error") return <DeployLog d={b.deploy} />;
    if (!b?.published_at) return <Empty title={w.notReleased} line={w.notReleasedLine} />;
    return (
      <>
        <Eyebrow links={links}>{w.releasedEyebrow(dayHm(b.published_at, now, timeZone), b.total)}</Eyebrow>
        <p className="cor-ficha-quote">{w.releasedQuote(d.short ?? d.title)}</p>
        <ul className="cor-ficha-rows">
          {b.evidence.map((e, i) => (
            <li key={i}>
              <State tone="ok">{w.passes}</State>
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
                <State tone="ok">{w.merged}</State>
                <a className="cor-ficha-row-t" href={p.url} target="_blank" rel="noreferrer">
                  <b>PR #{p.number}</b> · {b.steps.find((s) => s.key === p.key)?.title ?? p.key}
                </a>
              </li>
            ))}
          {b.evidence.length === 0 && <li className="cor-muted">{w.noEvidence}</li>}
        </ul>
        <Informe r={b.informe} />
      </>
    );
  }
  const s = d.stops.find((x) => x.stop === ui.sel)!;
  if (d.kind === "initiative" && !d.stops.some((x) => x.delivered)) return <Empty title={w.notFromIdea} line={w.notFromIdeaLine} />;
  if (s.stop === "buzon")
    return (
      <>
        <Eyebrow links={links}>{d.pedido ? w.buzonMine(s.at ? dayHm(s.at, now, timeZone) : null) : w.buzonIdea(whoName(d.who))}</Eyebrow>
        <p className="cor-ficha-quote">{w.quoted(d.text)}</p>
        {d.pictures.length > 0 && <p className="cor-cap">{w.pictures(d.pictures.length)}</p>}
      </>
    );
  if (s.stop === "lista") {
    if (d.stop !== "lista" && !b) return <Empty title={w.notStarted(selName("lista"))} line={w.waits.lista!} />;
    return (
      <>
        <Eyebrow links={links}>{b ? w.listaBuilt(b.key) : d.state === "valvula" ? w.listaOrdered : w.listaWhat}</Eyebrow>
        {/* PLA-82 (F-16): after «Constrúyelo» the steps no longer wait for his yes; they are on their way to the board. */}
        <p className="cor-ficha-quote">{b ? w.listaBuiltQuote(b.key) : d.state === "valvula" ? w.listaOrderedQuote(d.plan_steps.length) : d.plan_steps.length ? w.listaStepsQuote(d.plan_steps.length) : w.listaPlanQuote}</p>
        {d.plan_steps.length > 0 && <PlanSteps titles={d.plan_steps} />}
      </>
    );
  }
  // PLA-67: the stop it is at, with nobody stuck, is being worked on: it did not «not start».
  if (!s.delivered && s.state === "here" && !d.quiet_since)
    return <Empty title={w.inProgress(selName(s.stop))} line={w.workingNow(d.stage)} />;
  if (!s.delivered)
    return (
      <Empty title={w.notStarted(selName(s.stop))} line={s.state === "here" && d.quiet_since ? w.quietSince(dayHm(d.quiet_since, now, timeZone), d.stage) : (w.waits[s.stop] ?? w.afterPrevious)}>
        {s.state === "here" && d.quiet_since && isOpen(d) && (
          <Btn kind="secondary" disabled={acts.busy === `pedido-${d.key}:despertar`} onClick={() => acts.despertar(slug, d.key)} data-control="ficha-despertar">
            {w.wake}
          </Btn>
        )}
      </Empty>
    );
  if (s.stop === "entendido") {
    // PLA-82 (F-10): only what the PO wrote. «Pendiente» on four fields this stop never fills read as missing work.
    // PLA-112 (F-5): from the PO's own doc, so Research's recommendation does not show as the PO's «Solución».
    const po = d.ficha_po ?? d.ficha;
    const cells = (
      [
        [w.cells.problema, po.problema],
        [w.cells.solucion, po.solucion],
        [w.cells.fuera, po.fuera],
        [w.cells.tamano, po.tamano],
        [w.cells.riesgos, po.riesgos],
      ] as [string, string | null][]
    ).filter(([, v]) => !!v?.trim());
    return (
      <>
        <Eyebrow links={links} doc={s.doc}>
          {eb(s, now, timeZone)}
        </Eyebrow>
        <div className="cor-ficha-split" style={cells.length ? undefined : { gridTemplateColumns: "minmax(0, 1fr)" }}>
          <p className="cor-ficha-quote">{(d.understood_text ?? d.understood) ? (d.understood_text ?? d.understood)!.replace(/^\s*entend[ií]\s*[:：-]\s*/i, "") : w.poWroteCard}</p>
          {cells.length > 0 && (
            <dl className="cor-ficha-cells">
              {cells.map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>
                    <Md>{v!}</Md>
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>
        {/* AUDIT-8: the PO's open decisions, each with its recommended option in force until he marks another. */}
        {(d.decisions?.length ?? 0) > 0 && (
          <Decisiones
            decisions={d.decisions!}
            dec={ui.dec}
            why={ui.why}
            open={isOpen(d)}
            busy={acts.busy === `pedido-${d.key}:decision`}
            forward={forwardOf(d.stage)}
            onMark={(n, option) => set({ dec: { ...ui.dec, [n]: option } })}
            onWhy={(n, text) => set({ why: { ...ui.why, [n]: text } })}
            onSend={(input) => acts.decision(slug, d.key, input)}
          />
        )}
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
                <State tone={o.n === rec ? "live" : undefined}>{o.n === rec ? w.recommendsOption(o.n) : w.option(o.n)}</State>
                <b>{o.title}</b>
                <span>{o.text}</span>
              </div>
            ))}
          </div>
        ) : null}
        {d.research.recommendation && (
          <div className="cor-ficha-rec">
            <Label>{w.recommends}</Label>
            <Md>{d.research.recommendation}</Md>
          </div>
        )}
        {d.research.unknown.length > 0 && (
          <div className="cor-ficha-rec">
            <Label>{w.unknown}</Label>
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
          {eb(s, now, timeZone, d.plan_steps.length ? `${w.stepsCount(d.plan_steps.length)}${d.ficha.tamano ? ` · ${d.ficha.tamano.replace(/[*_\x60#.]/g, "").toLowerCase()}` : ""}` : undefined)}
        </Eyebrow>
        {d.plan?.steps.length ? (
          // AUDIT-8: a plan delivered as data says what done means and what to try for each step.
          <ol className="cor-plan-steps" data-plan="pasos">
            {d.plan.steps.map((x, i) => (
              <li key={i}>
                {x.title}
                <span>{w.doneWhen(x.done_when)}</span>
                <span>{w.tryIt(x.try_it)}</span>
              </li>
            ))}
          </ol>
        ) : d.plan_steps.length ? (
          <PlanSteps titles={d.plan_steps} />
        ) : (
          <p className="cor-text">{w.planNoList}</p>
        )}
      </>
    );
  // Diseño: the frames in a row, the chosen one large with the notes pinned on it.
  if (!d.frames.length)
    return (
      <>
        <Eyebrow links={links} doc={s.doc}>
          {eb(s, now, timeZone)}
        </Eyebrow>
        <p className="cor-text">{w.noFrames}</p>
      </>
    );
  const i = Math.min(ui.frame, d.frames.length - 1);
  const f = d.frames[i]!;
  const canPin = isOpen(d) && !s.answer;
  const pins = ui.pins.map((p, n) => ({ ...p, n: n + 1 })).filter((p) => p.frame === f.frame);
  const pinAt = (e: { clientX: number; clientY: number; currentTarget: Element }) => {
    if (!canPin) return;
    const r = e.currentTarget.getBoundingClientRect();
    set({ pins: [...ui.pins, { frame: f.frame, x: Math.round(((e.clientX - r.left) / r.width) * 1000) / 10, y: Math.round(((e.clientY - r.top) / r.height) * 1000) / 10, text: "" }] });
  };
  const pinMarks = pins.map((p) => (
    <i key={p.n} className="cor-pin" style={{ left: `${p.x}%`, top: `${p.y}%` }} aria-hidden>
      {p.n}
    </i>
  ));
  const go = (n: number) => set({ frame: (n + d.frames.length) % d.frames.length });
  return (
    <>
      {/* PLA-72 (F-14): the frame in the ficha is 124 px tall, too small to judge a design; Ampliar opens it large,
          one click deep, with the same pins and arrows between frames. */}
      {ui.grande &&
        createPortal(
        <div className="cor-portal">
        <div
          className="cor-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={w.frameNamed(f.frame, f.name)}
          tabIndex={-1}
          ref={focusOnOpen}
          onKeyDown={(e) => {
            if (e.key === "Escape") set({ grande: false });
            if (e.key === "ArrowRight") go(i + 1);
            if (e.key === "ArrowLeft") go(i - 1);
          }}
          data-lightbox
        >
          <div className="cor-lightbox-bar">
            <b>
              {f.frame} · {f.name}
            </b>
            <span className="cor-cap">{w.frameOf(i + 1, d.frames.length, canPin)}</span>
            <Btn kind="quiet" small aria-label={w.prevFrame} onClick={() => go(i - 1)}>
              ‹
            </Btn>
            <Btn kind="quiet" small aria-label={w.nextFrame} onClick={() => go(i + 1)}>
              ›
            </Btn>
            <Btn kind="secondary" small onClick={() => set({ grande: false })} data-control="ficha-cerrar-grande">
              {w.close}
            </Btn>
          </div>
          <div className="cor-lightbox-stage">
            <div className="cor-lightbox-frame" style={{ aspectRatio: `${f.width || 16} / ${f.height || 10}`, width: `min(100%, calc((100svh - 96px) * ${f.width || 16} / ${f.height || 10}))` } as CSSProperties} onClick={pinAt} data-control="ficha-clavar-grande">
              <img src={f.url} alt={w.frameNamed(f.frame, f.name)} draggable={false} />
              {pinMarks}
            </div>
          </div>
          {/* PLA-90 (PLA-86 F-11): a pin placed here is written here, not after closing the lightbox. */}
          {pins.length > 0 && (
            <ol className="cor-marcas cor-lightbox-notes" aria-label={w.notesOnFrame(f.frame)}>
              {pins.map((p) => (
                <li key={p.n}>
                  <b aria-hidden>{p.n}</b>
                  <input
                    className="cor-input"
                    value={p.text}
                    maxLength={600}
                    placeholder={w.pinPlaceholder}
                    aria-label={w.pinLabel(p.n, p.frame)}
                    autoFocus={p.n === ui.pins.length && !p.text}
                    onKeyDown={(e) => e.stopPropagation()}
                    onChange={(e) => set({ pins: ui.pins.map((x, j) => (j === p.n - 1 ? { ...x, text: e.target.value } : x)) })}
                  />
                  <Btn kind="quiet" small aria-label={w.removePin(p.n)} onClick={() => set({ pins: ui.pins.filter((_, j) => j !== p.n - 1) })}>
                    ×
                  </Btn>
                </li>
              ))}
            </ol>
          )}
        </div>
        </div>,
          document.body,
        )}
      <Eyebrow links={links} doc={s.doc}>
        {eb(s, now, timeZone, w.frames(d.frames.length))}
      </Eyebrow>
      <div className="cor-ficha-frames">
        <div className="cor-ficha-frame-big" data-tall={previewOf(f.width, f.height, PREVIEW_W, PREVIEW_H).tall || undefined}>
          <div
            className="cor-ficha-frame-fit"
            role={canPin ? "button" : undefined}
            tabIndex={canPin ? 0 : undefined}
            aria-label={canPin ? w.frameTap(f.frame) : w.frame(f.frame)}
            style={previewOf(f.width, f.height, PREVIEW_W, PREVIEW_H).size}
            onClick={pinAt}
            data-control="ficha-clavar"
          >
            <img src={f.url} alt={w.frameNamed(f.frame, f.name)} draggable={false} />
            {pinMarks}
          </div>
          <button
            type="button"
            className="cor-ficha-ampliar"
            onClick={(e) => {
              e.stopPropagation();
              set({ grande: true });
            }}
            data-control="ficha-ampliar"
          >
            {w.enlarge}
          </button>
        </div>
        <div className="cor-ficha-thumbs" role="group" aria-label={w.framesLabel}>
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
                  <input className="cor-input" value={p.text} maxLength={600} placeholder={w.pinPlaceholder} aria-label={w.pinLabel(n + 1, p.frame)} onChange={(e) => set({ pins: ui.pins.map((x, j) => (j === n ? { ...x, text: e.target.value } : x)) })} />
                  <Btn kind="quiet" small aria-label={w.removePin(n + 1)} onClick={() => set({ pins: ui.pins.filter((_, j) => j !== n) })}>
                    ×
                  </Btn>
                </li>
              ))}
            </ol>
          ) : (
            <dl>
              <div>
                <dt className="cor-label">{w.whatItDoes(f.frame)}</dt>
                <dd>{f.hace ?? f.name}</dd>
              </div>
              <div>
                <dt className="cor-label">{w.why}</dt>
                <dd>{f.porque ?? "—"}</dd>
              </div>
              {canPin && <dd className="cor-cap">{w.tapHint}</dd>}
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
  const w = say();
  if (!d.trail.length) return <Empty title={w.noTrail} line={w.noTrailLine} />;
  return (
    <ol className="cor-trail" aria-label={w.trail} data-trail={d.trail.length}>
      {[...d.trail].reverse().map((x, i) => {
        const st = stopOf(x);
        return (
          <li key={i} className={x.who === "owner" ? "me" : ""}>
            <time className="cor-cap" dateTime={x.at}>
              {dayHm(x.at, now, timeZone)}
            </time>
            <span className="cor-state">{st ? selName(st) : ""}</span>
            <span className="cor-ellipsis" style={{ flex: 1 }} title={x.text}>
              <b>{whoName(x.who)}</b> · {x.kind === "pedido" ? w.youAsked(d.text) : x.text}
            </span>
            {st && x.kind !== "pedido" && x.kind !== "etapa" && (
              <Btn kind="link" onClick={() => set({ sub: "entrega", sel: st })}>
                {w.see}
              </Btn>
            )}
          </li>
        );
      })}
    </ol>
  );
};

const Nota = ({ d, ui, set, acts, slug }: { d: IdeaDetail; ui: Ui; set: (p: Partial<Ui>) => void; acts: CorrienteActs; slug: string }) => {
  const w = say();
  const [files, setFiles] = useState<File[]>([]);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const busy = acts.busy === `pedido-${d.key}:note`;
  // PLA-148 (F-5): after «Añadir» the box empties; say it went (unless the send failed).
  const [sent, setSent] = useState(false);
  const wasBusy = useRef(false);
  useEffect(() => {
    if (wasBusy.current && !busy && !acts.failed[`pedido-${d.key}:note`]) setSent(true);
    wasBusy.current = busy;
  }, [busy, acts.failed, d.key]);
  return (
    <form
      className="cor-ficha-nota"
      onSubmit={(e) => {
        e.preventDefault();
        const text = ui.note.trim().length >= 2 ? ui.note.trim() : files.length ? w.addedPictures(files.length) : "";
        if (!text || busy) return;
        acts.notePedido(slug, d.key, text, files);
        setFiles([]);
      }}
    >
      <label className="cor-label violet" htmlFor={`ficha-nota-${d.key}`}>
        {w.forTeam}
      </label>
      <textarea id={`ficha-nota-${d.key}`} ref={noteRef} rows={3} className="cor-input" value={ui.note} maxLength={1000} placeholder={d.pedido ? w.notePedido : w.noteIdea} onChange={(e) => (set({ note: e.target.value }), setSent(false))} />
      <div className="cor-acts" style={{ marginTop: 0 }}>
        {d.pedido && <Images files={files} onChange={setFiles} textarea={noteRef} disabled={busy} />}
        <Btn kind="secondary" type="submit" disabled={(ui.note.trim().length < 2 && !files.length) || busy} data-control="ficha-nota-enviar">
          {w.add}
        </Btn>
        <span className="cor-cap" role="status" data-nota-enviada={sent || undefined}>
          {sent ? w.noteSent : ""}
        </span>
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
    <div className={`cor-ficha-ahora ${tone}`} data-ahora={tone} role="region" aria-label={say().now(label)}>
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
  const w = say();
  if (a.verdict === "ok") return s.stop === "entendido" ? w.saidOkEntendido : s.stop === "investigacion" ? w.saidOkInvestigacion : w.saidOkLiked(s.stop);
  if (a.verdict === "opcion") return w.saidOption(a.option);
  if (a.verdict === "corregir") return w.saidCorrected;
  return w.saidChanges(a.notes.length);
};

const InitiativeBar = ({ p, d, b, m, decisions, acts, links }: { p: OrgProject; d: IdeaDetail; b: IdeaBuilt; m: RioModel; decisions: Decision[]; acts: CorrienteActs; links: FichaLinks }) => {
  const w = say();
  const cerrar = useCerrar();
  const you = b.steps.find((s) => s.etapa === "te_toca");
  const live = b.steps.find((s) => s.etapa && ["construyendo", "en_qa", "en_revision", "devuelto"].includes(s.etapa));
  if (b.published_at)
    return (
      <Bar tone="calm" label={w.nothingPending} side={<Link className="cor-btn secondary" to={links.pedir} data-control="ficha-ajuste">{w.askTweak}</Link>}>
        {w.released} <span>{w.releasedLine}</span>
      </Bar>
    );
  // PLA-I74-8: a production deploy that failed, builds or waits for its live answer says so before anything else.
  if (b.deploy) return <DeployBar slug={p.slug} b={{ ...b, deploy: b.deploy }} paso={links.paso} />;
  if (b.can_close)
    return (
      <Bar tone="you" label={w.yourTurn} side={<Btn kind="primary" disabled={cerrar.isPending} onClick={() => cerrar.mutate({ slug: p.slug, key: b.key, version: b.version })} data-control="ficha-cerrar-iniciativa">{cerrar.isPending ? w.closing : w.closeInitiative}</Btn>}>
        {w.allDone} <span>{w.allDoneLine}</span>
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
        label={w.yourTurn}
        side={
          <>
            {/* PLA-93: a delivery is accepted on its card, after its before/after; here it is only opened. */}
            {accept && !dl && (
              <Btn kind="primary" disabled={busyOf(accept, acts) || !!accept.decision.hold} aria-label={acceptWords(accept.decision).aria} onClick={() => run(p.slug, accept, acts)} data-control="ficha-aceptar">
                {w.accept}
              </Btn>
            )}
            {dl ? (
              <Link className="cor-btn primary" to={links.entrega(dl)} data-control="ficha-ver-entrega">
                {w.seeDelivery}
              </Link>
            ) : (
              <Link className={`cor-btn ${accept ? "quiet" : "primary"}`} to={links.paso(you.key)} data-control="ficha-ver-paso">
                {w.seeStep}
              </Link>
            )}
          </>
        }
      >
        {w.stepWaits(n, you.title)} <span>{you.pr ? `PR #${you.pr.number}.` : ""}</span>
      </Bar>
    );
  }
  if (live)
    return (
      <Bar tone="live" label={w.tallerBuildsLabel} side={<Link className="cor-btn secondary" to={links.paso(live.key)} data-control="ficha-ver-paso">{w.seeStep}</Link>}>
        {w.onStep(b.steps.indexOf(live) + 1, b.total, live.title)} <span>{w.stageNothingWaits(etapaWord(live.etapa!))}</span>
      </Bar>
    );
  const next = b.steps.find((s) => !["Merged", "Released", "Done"].includes(s.status));
  return (
    <Bar tone="calm" label={m.steps.total ? w.onBoard : w.noStepsLabel} side={next ? <Link className="cor-btn secondary" to={links.paso(next.key)} data-control="ficha-ver-paso">{w.seeStep}</Link> : undefined}>
      {next ? w.nextStep(b.steps.indexOf(next) + 1, next.title) : w.noStepsYet} <span>{next ? w.stageNobody(etapaWord(next.etapa ?? "lista")) : ""}</span>
    </Bar>
  );
};

const Ahora = ({ p, d, m, ui, set, acts, decisions, links }: { p: OrgProject; d: IdeaDetail; m: RioModel; ui: Ui; set: (x: Partial<Ui>) => void; acts: CorrienteActs; decisions: Decision[]; links: FichaLinks }) => {
  const w = say();
  // PLA-I74-6: «Constrúyelo» warns when the project's last check-up is red, more than a day old, or missing.
  const revision = useRevision(p.slug).data;
  const k = d.key;
  const busy = (a: string) => acts.busy === `pedido-${k}:${a}`;
  const send = (stop: PedidoStop, input: Omit<IdeaAnswerInput, "stop">) => acts.respuesta(p.slug, k, { stop, ...input });
  if (d.built) return <InitiativeBar p={p} d={d} b={d.built} m={m} decisions={decisions} acts={acts} links={links} />;
  if (d.guardada)
    return (
      <Bar tone="calm" label={w.saved} side={isOpen(d) && <Btn kind="primary" disabled={busy("restaurar")} onClick={() => acts.pedido(p.slug, k, "restaurar")} data-control="ficha-restaurar-ahora">{w.restore}</Btn>}>
        {w.outOfCurrent} <span>{w.outOfCurrentLine}</span>
      </Bar>
    );
  if (d.question && isOpen(d))
    return (
      <Bar
        tone="you"
        label={w.poAsks}
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
            <input className="cor-input" value={ui.answer} maxLength={1000} placeholder={w.answerHere} aria-label={w.answerLabel} onChange={(e) => set({ answer: e.target.value })} />
            <Btn kind="primary" type="submit" disabled={!ui.answer.trim() || busy("answer")} data-control="ficha-contestar">
              {w.answer}
            </Btn>
          </form>
        }
      >
        <span className="cor-ficha-q" title={d.question.text}>
          {d.question.text}
        </span>
      </Bar>
    );
  // PLA-68: an earlier stop the owner opened (Diseño, to pin notes) keeps its own answer bar; Lista keeps «Constrúyelo».
  const opened = ui.sel !== "lista" && STOP_IDS.includes(ui.sel as PedidoStop) ? d.stops.find((x) => x.stop === ui.sel) : null;
  const answering = !!opened && ANSWERABLE.includes(opened.stop) && opened.delivered && d.state !== "valvula";
  if (d.stop === "lista" && isOpen(d) && !answering) {
    if (d.state === "valvula" && stuckOf(p, d)) {
      const at = orderedAt(d);
      return (
        <Bar tone="you" label={w.stuck} side={<Btn kind="primary" disabled={busy("despertar")} onClick={() => acts.despertar(p.slug, k)} data-control="ficha-despertar-valvula">{busy("despertar") ? w.waking : w.wakePo}</Btn>}>
          {at ? w.orderedAt(hm(at)) : w.ordered} <span>{w.stuckLine}</span>
        </Bar>
      );
    }
    if (d.state === "valvula")
      return (
        <Bar tone="live" label={w.passing} side={<Btn kind="primary" disabled data-control="ficha-construir">{w.passingButton}</Btn>}>
          {w.ordered} <span>{w.passingLine}</span>
        </Bar>
      );
    return (
      <Bar tone="you" label={w.yourTurn} side={<Btn kind="primary" disabled={busy("construir")} onClick={() => acts.pedido(p.slug, k, "construir")} data-control="ficha-construir">{w.buildIt}</Btn>}>
        {w.needsBuild} <span>{w.needsBuildLine}</span>
        {buildWarning(revision, Date.now()) && (
          <span className="cor-build-warn" role="note" data-aviso-revision>
            {buildWarning(revision, Date.now())}
          </span>
        )}
      </Bar>
    );
  }
  // The chosen stop's answer, while it is open and delivered.
  const s = STOP_IDS.includes(ui.sel as PedidoStop) ? d.stops.find((x) => x.stop === ui.sel)! : null;
  if (s && ANSWERABLE.includes(s.stop) && s.delivered && isOpen(d)) {
    // PLA-148 (F-3): these stops go on by themselves; their bar invites a look and does not say «Te toca».
    const bar: { tone: Tone; label: string } = stopBar(s.stop) === "review" ? { tone: "calm", label: w.toReview } : { tone: "you", label: w.yourTurn };
    if (s.answer)
      return (
        <Bar tone="calm" label={selName(s.stop)} side={s.answer.verdict === "ok" && <Btn kind="secondary" disabled={busy("respuesta")} onClick={() => send(s.stop, { verdict: "deshacer" })} data-control="ficha-deshacer">{w.undo}</Btn>}>
          {said(s)} <span>{s.answer.verdict === "ok" ? w.nothingStops : w.backTo(selName(s.stop))}</span>
        </Bar>
      );
    if (s.stop === "entendido")
      return (
        <Bar
          tone={bar.tone}
          label={bar.label}
          side={
            <form
              className="cor-ficha-answer"
              onSubmit={(e) => {
                e.preventDefault();
                if (ui.text.trim() && !busy("respuesta")) send("entendido", { verdict: "corregir", text: ui.text.trim() });
              }}
            >
              <input className="cor-input" maxLength={1000} value={ui.text} aria-label={w.wrongLabel} placeholder={w.correctHere} onChange={(e) => set({ text: e.target.value })} />
              {ui.text.trim() ? (
                <Btn kind="primary" type="submit" disabled={busy("respuesta")} data-control="ficha-corregir">
                  {w.correct}
                </Btn>
              ) : (
                <Btn kind="primary" disabled={busy("respuesta")} onClick={() => send("entendido", { verdict: "ok" })} data-control="ficha-ok">
                  {w.thatsRight}
                </Btn>
              )}
            </form>
          }
        >
          {w.rightQ}{" "}
          <span>{d.stop === "entendido" || d.stop === "buzon" ? w.rightNext : w.rightAlready(selName(d.stop))}</span>
        </Bar>
      );
    if (s.stop === "investigacion" && d.research.options.length) {
      const rec = recommended(d) ?? 1;
      const pick = ui.pick ?? rec;
      return (
        <Bar
          tone={bar.tone}
          label={bar.label}
          side={
            <form
              className="cor-ficha-answer"
              onSubmit={(e) => {
                e.preventDefault();
                // PLA-148 (F-5): his own words, like Entendido's correction: a note Research reads when it redoes it
                // (with the option he picked, when it is not the recommended one).
                const text = ui.text.trim();
                if (!text || busy("respuesta")) return;
                send("investigacion", pick === rec ? { verdict: "cambios", text } : { verdict: "opcion", option: pick, text });
              }}
            >
              <span className="cor-segbox" role="radiogroup" aria-label={w.optionsLabel}>
                {d.research.options.map((o) => (
                  <Opt key={o.n} on={pick === o.n} role="radio" aria-checked={pick === o.n} onClick={() => set({ pick: o.n })} title={o.title} data-option={o.n}>
                    {o.n}
                  </Opt>
                ))}
              </span>
              <input className="cor-input" maxLength={1000} value={ui.text} aria-label={w.researchWrongLabel} placeholder={w.researchCorrectHere} onChange={(e) => set({ text: e.target.value })} />
              {ui.text.trim() ? (
                <Btn kind="primary" type="submit" disabled={busy("respuesta")} data-control="ficha-corregir">
                  {w.correct}
                </Btn>
              ) : pick === rec ? (
                <Btn kind="primary" disabled={busy("respuesta")} onClick={() => send("investigacion", { verdict: "ok" })} data-control="ficha-ok">
                  {w.goRecommended}
                </Btn>
              ) : (
                <Btn kind="primary" disabled={busy("respuesta")} onClick={() => send("investigacion", { verdict: "opcion", option: pick })} data-control="ficha-opcion">
                  {w.askOption(pick)}
                </Btn>
              )}
            </form>
          }
        >
          {w.researchRecommends(rec)} <span>{w.pickAnother}</span>
        </Bar>
      );
    }
    if (s.stop === "diseno" && d.frames.length) {
      const ready = ui.pins.filter((x) => x.text.trim());
      return (
        <Bar
          tone={bar.tone}
          label={bar.label}
          side={
            <>
              <Btn kind="secondary" disabled={busy("respuesta") || ready.length === 0} onClick={() => send("diseno", { verdict: "cambios", notes: ready })} data-control="ficha-notas">
                {ready.length ? w.sendNotes(ready.length) : w.askChanges}
              </Btn>
              <Btn kind="primary" disabled={busy("respuesta")} onClick={() => send("diseno", { verdict: "ok" })} data-control="ficha-ok">
                {w.like}
              </Btn>
            </>
          }
        >
          {w.artistLeft(d.frames.length)} <span>{w.likeLine}</span>
        </Bar>
      );
    }
    return (
      <Bar
        tone={bar.tone}
        label={bar.label}
        side={
          ui.asking ? (
            <form
              className="cor-ficha-answer"
              onSubmit={(e) => {
                e.preventDefault();
                if (ui.text.trim() && !busy("respuesta")) send(s.stop, { verdict: "cambios", text: ui.text.trim() });
              }}
            >
              <input className="cor-input" maxLength={1000} value={ui.text} aria-label={w.changeLabel} placeholder={w.changeQ} onChange={(e) => set({ text: e.target.value })} autoFocus />
              <Btn kind="primary" type="submit" disabled={busy("respuesta") || !ui.text.trim()} data-control="ficha-cambios">
                {w.askChanges}
              </Btn>
            </form>
          ) : (
            <>
              <Btn kind="secondary" disabled={busy("respuesta")} onClick={() => set({ asking: true })} data-control="ficha-pide-cambios">
                {w.askChanges}
              </Btn>
              <Btn kind="primary" disabled={busy("respuesta")} onClick={() => send(s.stop, { verdict: "ok" })} data-control="ficha-ok">
                {w.like}
              </Btn>
            </>
          )
        }
      >
        {s.stop === "plan" ? w.planWritten : w.selDelivered(selName(s.stop))} <span>{w.noAnswerNeeded}</span>
      </Bar>
    );
  }
  // Nothing to answer here: what the thing is doing.
  if (d.state === "trabajando") return <Bar tone="live" label={w.someoneWorks(whoName(d.who))}>{w.onSel(selName(d.stop))} <span>{w.tellsYou}</span></Bar>;
  if (d.queued) return <Bar tone="live" label={w.inQueue(whoName(d.queued))}>{w.takesNextTurn} <span>{w.nothingWaits}</span></Bar>;
  if (d.state === "cola")
    return (
      <Bar tone="calm" label={w.poQueue} side={isOpen(d) && <Btn kind="secondary" disabled={busy("despertar")} onClick={() => acts.despertar(p.slug, k)} data-control="ficha-despertar-ahora">{w.wakePo}</Btn>}>
        {w.nobodyTook} <span>{w.inInbox}</span>
      </Bar>
    );
  if (d.quiet_since && isOpen(d))
    return (
      <Bar tone="calm" label={w.quiet} side={<Btn kind="secondary" disabled={busy("despertar")} onClick={() => acts.despertar(p.slug, k)} data-control="ficha-despertar-ahora">{w.wake}</Btn>}>
        {w.nobodySince(hm(d.quiet_since))} <span>{w.wakeTakes(selName(d.stop))}</span>
      </Bar>
    );
  return <Bar tone="calm" label={w.nothingPending}>{isOpen(d) ? w.stillOn(selName(d.stop)) : d.status === "Open" ? w.onBoardAlready : w.ideaClosed} <span>{w.nothingWaits}</span></Bar>;
};

// ---- the ficha

export const Ficha = ({ p, k, now, timeZone, acts, decisions, links, onClose, extra = null }: { p: OrgProject; k: string; now: number; timeZone?: string; acts: CorrienteActs; decisions: Decision[]; links: FichaLinks; onClose: () => void; extra?: ReactNode }) => {
  const w = say();
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
    if (d.trail.length > trailN && trailN > 0) setUi((u) => (u ? { ...u, note: "", answer: "", text: "", asking: false, pins: [], dec: {}, why: {} } : u));
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
      <section className="cor-ficha error" data-ficha={k} aria-label={w.ficha}>
        <ReadError what={w.theFicha} onRetry={() => void q.refetch()} />
        <Btn kind="quiet" small onClick={onClose} data-control="ficha-cerrar">
          {w.close}
        </Btn>
      </section>
    );
  if (!d || !ui) return <div className="cor-ficha cor-skel" data-ficha={k} role="status" aria-busy="true" aria-label={w.reading} />;
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
                <span className="cor-cap">{w.bornFrom}</span>
                <span className="cor-key muted">{born}</span>
              </>
            )}
            {d.unseen > 0 && !d.built && <span className="cor-cap">{w.unseen(d.unseen)}</span>}
          </span>
          {/* PLA-63, PLA-148 (F-6): a request's title is the start of the owner's text: the header shows its first
              sentence as the name, the whole text on hover (and in Entendido). */}
          <h2 className="cor-ellipsis" title={d.title}>
            {ideaName(d.summary || d.title) || d.title}
          </h2>
        </div>
        <Btn kind="quiet" small aria-pressed={ui.sub === "recorrido"} onClick={() => set({ sub: ui.sub === "recorrido" ? "entrega" : "recorrido" })} data-control="ficha-recorrido">
          {w.trail}
        </Btn>
        {isOpen(d) && (
          <Btn kind="quiet" small aria-pressed={ui.sub === "nota"} onClick={() => set({ sub: ui.sub === "nota" ? "entrega" : "nota" })} data-control="ficha-nota">
            {w.note}
          </Btn>
        )}
        {isOpen(d) && d.pedido && (
          <>
            {/* Restaurar a saved one is «Ahora»'s button. */}
            {!d.guardada && (
              <Btn kind="quiet" small disabled={busy("guardar") || d.state === "valvula"} onClick={() => acts.pedido(p.slug, d.key, "guardar")} data-control="ficha-guardar">
                {w.save}
              </Btn>
            )}
            <Btn kind={ui.drop ? "danger" : "quiet"} small disabled={busy("descartar")} onClick={() => (ui.drop ? (set({ drop: false }), acts.pedido(p.slug, d.key, "descartar"), onClose()) : set({ drop: true }))} onBlur={() => ui.drop && set({ drop: false })} data-control="ficha-descartar">
              {ui.drop ? w.discardSure : w.discard}
            </Btn>
          </>
        )}
        <Btn kind="quiet" small onClick={onClose} aria-label={w.closeFicha} data-control="ficha-cerrar">
          {w.close}
        </Btn>
      </div>
      <Rio d={d} m={m} ui={ui} set={set} stuck={stuckOf(p, d)} />
      <div className="cor-ficha-entrega" id={`ficha-panel-${d.key}`} role="tabpanel" aria-labelledby={`ficha-tab-${d.key}-${ui.sel}`} tabIndex={0} data-panel={ui.sub === "entrega" ? ui.sel : ui.sub}>
        {/* PLA-63: the bar below asks it (two lines); the panel repeats it only when it is too long for the bar. */}
        {d.question && isOpen(d) && ui.sub === "entrega" && d.question.text.length > QUESTION_FITS && (
          <p className="cor-ficha-ask" data-pregunta-texto>
            <Label tone="amber">{w.poAsks}</Label> {d.question.text}
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
