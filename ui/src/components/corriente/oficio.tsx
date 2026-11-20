// PLA-I67-1: «Oficio», one agent's page, opened from Equipo (?t=equipo&ver=oficio:<agent>; Esc and «‹ Equipo» go
// back). Sketch PLA-IDEA31 frames 1, 2, 8, 10, 11, drawn from what Plania already stores
// (GET …/team/:agent/oficio): what the seat carries enters on the left as threads (its seat, then each skill,
// thicker the more it used it; a switched-off one stays as a dashed stub), they meet at the hub, and its deliveries
// leave along the line to the right, oldest first (filled: first time; open: sent back; amber: waits for you). One
// readout for the picked delivery. The side panel says what its next run carries, or opens La estantería, whose
// switches save the seat's list (PUT …/packs with own). Lessons and references are later steps: nothing of them is
// drawn, and the page reads whole without them. Fits one screen: the drawing takes the room left and cuts rows.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, api, type OrgProject } from "@/lib/api";
import { seatName } from "@/lib/corriente";
import { words } from "@/lib/i18n";
import { EQUIPO_WORDS } from "@/lib/equipo-words";
import { OFICIO_WORDS } from "@/lib/oficio-words";
import { carriedLine, dayLabel, dotsX, firstPick, headline, labelEvery, numWord, rowsOf, shelfNext, skillWords, threadWidth, type Oficio, type OficioDelivery, type Row } from "@/lib/oficio";
import { Agent, Btn, Label, ReadError, Switch } from "./parts";
import { NewSkillPanel, PuestoPanel, SkillPanel } from "./oficio-skill";
// PLA-I67-6: «Probar» and «Traer de un enlace».
import { ImportPanel, TrialCompare, TrialPanel } from "./oficio-trial";
import { IMPORT_WORDS } from "@/lib/oficio-trial-words";
import { SKILL_CARD_WORDS, PUESTO_WORDS } from "@/lib/oficio-skill-words";
import { BudgetBar, HistoryPanel, LessonsPanel, ProposalCard, Reading, TeachBar } from "./oficio-lessons";
import { LESSON_WORDS } from "@/lib/oficio-lesson-words";
import { lessonCap, lessonRoom, lessonRowsOf, returnArc, waitingLine, type LessonView, type LessonsRead } from "@/lib/oficio-lessons";
// PLA-I67-4: the seat's references (threads, the side panel, the card, paste and drop).
import { REFERENCE_UI_WORDS } from "@/lib/references-words";
import { deliveryRefs, refRoom, type Reference } from "@/lib/references";
import { refsApi } from "@/lib/references-api";
import { REF_ROW, RefCard, RefPanel, RefThreads, refsHeight, useRefDrop, useRefUpload } from "./oficio-refs";

export type OficioLinks = { back: string; seat: (agent: string) => string; motor: string; ver: (d: { key: string; kind: string }) => string };

type Side = { kind: "next" } | { kind: "shelf" } | { kind: "skill"; slug: string } | { kind: "new" } | { kind: "puesto" } | { kind: "lessons" } | { kind: "historia" } | { kind: "refs" } | { kind: "ref"; id: string } | { kind: "trial"; slug: string; show: string | null } | { kind: "import" };

const ROW = 30;
const LABEL_W = 268;
const CARD_H = 186;

function useSize<T extends HTMLElement>(): [React.RefObject<T | null>, { w: number; h: number }] {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size];
}

// Every dot's date when there is room, else every other one; the newest always, so the one before it gives way.
const showDay = (i: number, n: number, every: number) => i === n - 1 || (i % every === 0 && !(every > 1 && i === n - 2));

const Mark = ({ d, x, y, on }: { d: OficioDelivery; x: number; y: number; on: boolean }) => (
  <g data-mark={d.outcome}>
    {on && <circle cx={x} cy={y} r={11} className="ofi-pick" />}
    {d.outcome === "primera" && <circle cx={x} cy={y} r={5.5} className="ofi-dot-first" />}
    {d.outcome === "devuelta" && <circle cx={x} cy={y} r={5.5} className="ofi-dot-back" />}
    {d.outcome === "espera" && <rect x={x - 5} y={y - 5} width={10} height={10} transform={`rotate(45 ${x} ${y})`} className="ofi-dot-waits" />}
    {d.outcome === "trabajando" && <circle cx={x} cy={y} r={6} className="ofi-dot-live" />}
    {(d.outcome === "en_curso" || d.outcome === "descartada") && <circle cx={x} cy={y} r={4} className="ofi-dot-open" />}
  </g>
);

type RefsInDrawing = { list: Reference[]; pick: string | null; onPick: (id: string) => void; onMore: () => void; line: (key: string) => string };

const Drawing = ({ o, seat, pick, onPick, now, timeZone, onShelf, links, lessons = [], refs }: { o: Oficio; seat: string; pick: string | null; onPick: (k: string) => void; now: number; timeZone?: string; onShelf: () => void; links: OficioLinks; lessons?: LessonView[]; refs?: RefsInDrawing }) => {
  const w = words(OFICIO_WORDS);
  const wl = words(LESSON_WORDS);
  const [ref, { w: W, h: H }] = useSize<HTMLDivElement>();
  // PLA-I67-3/4: under the skills come the lessons (every proposal, then active ones, up to half the room), then the
  // references, which take up to a third of the room or whatever the skills and lessons leave free.
  const allRows = Math.floor((H - 40) / ROW);
  const emptyPx = o.skills.some((s) => s.on) ? 0 : 76;
  const refList = refs?.list ?? [];
  const lessonWant = lessonRoom(lessons, allRows - 1);
  const freeRefs = Math.floor((H - 40 - (rowsOf(o.skills, 999).length + lessonWant) * ROW - 6 - 22 - emptyPx) / REF_ROW);
  const refN = refList.length ? Math.min(refList.length, Math.max(refRoom(Math.floor((H - 40) / REF_ROW), refList.length), freeRefs)) : 0;
  const refPx = refsHeight(refN, 0);
  const maxRows = Math.floor((H - 40 - (refPx ? refPx + 6 : 0)) / ROW);
  const room = lessonRoom(lessons, maxRows - 1);
  const rows: Row[] = rowsOf(o.skills, maxRows - room);
  const lessonRows = lessonRowsOf(lessons, Math.min(room, maxRows - rows.length));
  const maxUsed = Math.max(0, ...o.skills.map((s) => s.deliveries_used));
  const x0 = LABEL_W + 12;
  const hubX = Math.round(x0 + Math.min(220, Math.max(120, W * 0.16)));
  const refTop = 8 + (rows.length + lessonRows.length) * ROW + 6 + emptyPx;
  const rowsMid = refPx ? (8 + refTop + refPx) / 2 : 8 + (rows.length * ROW) / 2;
  const hubY = Math.round(Math.min(Math.max(rowsMid, CARD_H + 56), Math.max(CARD_H + 56, H - 70)));
  const lineX0 = hubX + 46;
  const lineX1 = W - 44;
  const dots = dotsX(o.deliveries, lineX0, lineX1);
  const every = labelEvery(dots.length, lineX1 - lineX0);
  const picked = o.deliveries.find((d) => d.key === pick) ?? null;
  const onCount = o.skills.filter((s) => s.on).length;
  const thread = (y: number) => {
    const a = x0 + 28;
    const mid = (a + hubX) / 2;
    return `M ${x0} ${y} L ${a} ${y} C ${mid} ${y}, ${mid} ${hubY}, ${hubX} ${hubY}`;
  };
  return (
    <div className="ofi-draw" ref={ref} aria-label={w.drawing(seat)} role="group">
      {W > 0 && (
        <>
          <svg className="ofi-svg" width={W} height={H} aria-hidden>
            {rows.map((r, i) => {
              const y = 8 + i * ROW + ROW / 2;
              if (r.kind === "off") return <path key={r.skill.slug} d={`M ${x0} ${y} L ${x0 + 70} ${y} M ${x0 + 74} ${y - 5} L ${x0 + 74} ${y + 5}`} className="ofi-thread-off" />;
              const width = r.kind === "post" ? 2.2 : threadWidth(r.skill.deliveries_used, maxUsed);
              return <path key={r.kind === "post" ? "post" : r.skill.slug} d={thread(y)} className={r.kind === "post" ? "ofi-thread-post" : "ofi-thread"} style={{ strokeWidth: width }} />;
            })}
            <line x1={hubX} y1={hubY} x2={lineX1 + 24} y2={hubY} className="ofi-line" />
            <circle cx={hubX} cy={hubY} r={16} className="ofi-hub-halo" />
            <circle cx={hubX} cy={hubY} r={7} className="ofi-hub" />
            {!o.live && <circle cx={lineX1 + 24} cy={hubY} r={4} className="ofi-dot-open" />}
            {dots.map(({ d, x }) => (
              <Mark key={d.key} d={d} x={x} y={hubY} on={d.key === pick} />
            ))}
            {lessonRows.map((l, j) => {
              const y = 8 + (rows.length + j) * ROW + ROW / 2;
              if (l.state === "active") return <path key={l.id} d={thread(y)} className="ofi-thread-lesson" />;
              // A proposal stops at the amber stop; a dashed arc comes back to it from the delivery it was learned from.
              const stopX = x0 + 64;
              const from = dots.find(({ d }) => d.key === l.task_key);
              return (
                <g key={l.id} data-stop={l.id}>
                  <path d={`M ${x0} ${y} L ${stopX - 9} ${y}`} className="ofi-thread-waits" />
                  {from && <path d={returnArc({ x: from.x, y: hubY }, { x: stopX, y }, Math.max(12, Math.min(34, H - 30 - Math.max(hubY, y))))} className="ofi-arc" data-arc={l.id} />}
                  <rect x={stopX - 7} y={y - 7} width={14} height={14} transform={`rotate(45 ${stopX} ${y})`} className="ofi-stop" />
                </g>
              );
            })}
          </svg>
          {refs && refN > 0 && <RefThreads refs={refList} room={refN} top={refTop} W={W} H={H} thread={thread} pick={refs.pick} onPick={refs.onPick} onMore={refs.onMore} seat={seat} />}
          <ul className="ofi-rows" aria-label={w.groupSkills}>
            {rows.map((r, i) => {
              const top = 8 + i * ROW;
              if (r.kind === "post")
                return (
                  <li key="post" className="ofi-row post" style={{ top }}>
                    <i className="ofi-bullet post" aria-hidden />
                    <span className="ofi-row-name">{w.thePost}</span>
                  </li>
                );
              const sw = skillWords(r.skill);
              return (
                <li key={r.skill.slug} className={`ofi-row ${r.kind}`} style={{ top }} data-skill={r.skill.slug} title={sw.line}>
                  <i className={`ofi-bullet ${r.kind}`} aria-hidden />
                  <span className="ofi-row-name">{sw.name}</span>
                  {r.kind === "off" ? (
                    <span className="cor-cap">{w.off}</span>
                  ) : (
                    <span className="cor-cap" aria-label={w.usedInLong(r.skill.deliveries_used, r.skill.deliveries_carried)} data-use={`${r.skill.deliveries_used}/${r.skill.deliveries_carried}`}>
                      {w.usedIn(r.skill.deliveries_used, r.skill.deliveries_carried)}
                    </span>
                  )}
                </li>
              );
            })}
            {lessonRows.map((l, j) => (
              <li key={l.id} className={`ofi-row lesson ${l.state === "proposed" ? "waits" : ""}`} style={{ top: 8 + (rows.length + j) * ROW }} data-lesson={l.id} title={l.text}>
                <i className={`ofi-bullet lesson ${l.state === "proposed" ? "waits" : ""}`} aria-hidden />
                <span className="ofi-row-name">{l.text}</span>
                <span className={`cor-cap ${lessonCap(l).tone === "amber" ? "ofi-cap-amber" : ""}`}>{lessonCap(l).text}</span>
              </li>
            ))}
          </ul>
          {onCount === 0 && (
            <div className="ofi-empty-skills" style={{ top: 8 + (rows.length + lessonRows.length) * ROW + 10 }} data-empty="skills">
              <p className="cor-text">{w.noSkills}</p>
              <Btn kind="link" onClick={onShelf} data-control="abrir-estanteria">
                {w.openShelf}
              </Btn>
            </div>
          )}
          <span className="cor-label ofi-hub-label" style={{ left: hubX + 22, top: hubY - 30 }}>
            {w.hub} · {numWord(onCount)}
          </span>
          {!o.live && (
            <span className="cor-label ofi-end-label" style={{ left: lineX1 + 24, top: hubY - 30 }}>
              {w.free}
            </span>
          )}
          {dots.map(({ d, x }, i) => (
            <button
              key={d.key}
              type="button"
              className="ofi-dot-btn"
              style={{ left: x - 22, top: hubY - 22 }}
              aria-pressed={d.key === pick}
              aria-label={w.delivery(d.title, w.outcome[d.outcome] ?? d.outcome)}
              onClick={() => onPick(d.key)}
              data-delivery={d.key}
            >
              {showDay(i, dots.length, every) && <span className="ofi-day">{dayLabel(d.at, now, timeZone)}</span>}
            </button>
          ))}
          {o.deliveries.length === 0 ? (
            <div className="ofi-card ofi-empty-deliv" style={{ left: lineX0 - 6, bottom: H - hubY + 40, width: Math.max(220, Math.min(440, W - lineX0 - 30)) }} data-empty="deliveries">
              <p className="cor-text">{w.noDeliveries}</p>
            </div>
          ) : (
            picked && <Readout d={picked} o={o} now={now} timeZone={timeZone} links={links} refLine={refs?.line(picked.key)} style={{ left: lineX0 - 6, bottom: H - hubY + 40, maxHeight: hubY - 40, width: Math.max(260, Math.min(460, W - lineX0 - 20)) }} />
          )}
          <p className="ofi-legend cor-cap" aria-hidden>
            <span><i className="ofi-key first" /> {w.legendFirst}</span>
            <span><i className="ofi-key back" /> {w.legendBack}</span>
            <span><i className="ofi-key waits" /> {w.legendWaits}</span>
            <span><i className="ofi-key width" /> {w.legendWidth}</span>
          </p>
        </>
      )}
    </div>
  );
};

const Readout = ({ d, o, now, timeZone, links, style, refLine }: { d: OficioDelivery; o: Oficio; now: number; timeZone?: string; links: OficioLinks; style: React.CSSProperties; refLine?: string }) => {
  const w = words(OFICIO_WORDS);
  const status =
    d.outcome === "primera" ? w.landedFirst : d.outcome === "espera" ? w.waitsForYou : d.outcome === "trabajando" ? w.stillWorking : d.outcome === "descartada" ? w.dropped : w.stillOpen;
  return (
    <section className="ofi-card ofi-readout" style={style} aria-live="polite" data-readout={d.key}>
      <Label as="p" className={d.outcome === "espera" ? "amber" : undefined}>
        {w.readLabel} · {dayLabel(d.at, now, timeZone)} · <b>{w.outcome[d.outcome] ?? d.outcome}</b>
      </Label>
      <h3 className="ofi-readout-title">
        <Link to={links.ver(d)} className="cor-inline" data-control="abrir-entrega">
          {d.title}
        </Link>
      </h3>
      {d.sent_back > 0 && d.words ? (
        <>
          <p className="cor-cap">{w.sentBackTimes(d.sent_back)}</p>
          <blockquote className="ofi-quote">{w.quote(d.words)}</blockquote>
        </>
      ) : (
        <p className="cor-text">{status}</p>
      )}
      <p className="cor-cap">
        {carriedLine(d, o.skills)} {w.runs(d.runs)} {refLine}
      </p>
    </section>
  );
};

const Shelf = ({ o, seat, onClose, onOpen, onNew, onImport }: { o: Oficio; seat: string; onClose: () => void; onOpen: (slug: string) => void; onNew: () => void; onImport: () => void }) => {
  const w = words(OFICIO_WORDS);
  const ws = words(SKILL_CARD_WORDS);
  const client = useQueryClient();
  // PLA-I67-2: the seat's own list holds the factory skills only; an owner skill switches its own state.
  const carried = o.skills.filter((s) => s.on && !s.owner).map((s) => s.slug);
  const onCount = o.skills.filter((s) => s.on).length;
  const puesto = useQuery({ queryKey: ["puesto", o.project, o.agent], queryFn: () => api.puesto(o.project, o.agent) });
  const own = useMutation({
    mutationFn: ({ slug, on }: { slug: string; on: boolean }) => api.setSkillOn(o.project, o.agent, slug, on),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["oficio", o.project, o.agent] });
      void client.invalidateQueries({ queryKey: ["skill", o.project, o.agent] });
    },
  });
  const restore = useMutation({
    mutationFn: (slug: string) => api.restoreSkill(o.project, o.agent, slug),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["oficio", o.project, o.agent] });
      void client.invalidateQueries({ queryKey: ["puesto", o.project, o.agent] });
    },
  });
  const save = useMutation({
    mutationFn: (list: string[]) => api.setSeatPacks(o.project, o.agent, list),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["oficio", o.project, o.agent] });
      void client.invalidateQueries({ queryKey: ["company"] });
    },
  });
  const factory = o.skills.filter((s) => s.source === "kit");
  const docs = o.skills.filter((s) => s.source === "doc");
  const mine = o.skills.filter((s) => s.source === "owner");
  const err = save.error instanceof ApiError ? (save.error.code === "TOO_MANY_PACKS" ? w.tooManyCode : w.saveFailed(save.error.code)) : save.isError ? words(EQUIPO_WORDS).notNow : null;
  const group = (label: string, list: typeof o.skills) =>
    list.length > 0 && (
      <>
        <Label as="p" className="ofi-shelf-group">
          {label}
        </Label>
        <ul className="ofi-shelf-list">
          {list.map((s) => {
            const sw = skillWords(s);
            return (
              <li key={s.slug} data-shelf={s.slug}>
                <Switch
                  on={s.on}
                  label={sw.name}
                  disabled={save.isPending || own.isPending}
                  onChange={(on) => (s.owner ? own.mutate({ slug: s.slug, on }) : save.mutate(shelfNext(carried, s.slug, on)))}
                  data-control={`estante-${s.slug}`}
                />
                <button type="button" className="ofi-shelf-open cor-cap" onClick={() => onOpen(s.slug)} aria-label={ws.openCard(sw.name)} data-control={`ver-${s.slug}`}>
                  <span className="ofi-shelf-line">{sw.line}</span>
                  <span aria-hidden>›</span>
                </button>
              </li>
            );
          })}
        </ul>
      </>
    );
  return (
    <section className="cor-card ofi-side-card ofi-shelf" aria-label={w.shelfOf(seat)} data-shelf-open>
      <div className="ofi-side-head">
        <Label as="h3">{w.shelfOf(seat)}</Label>
        <Btn kind="quiet" small onClick={onClose} aria-label={w.close} data-control="cerrar-estanteria">
          ×
        </Btn>
      </div>
      <Btn kind="secondary" className="ofi-wide" onClick={onNew} data-control="nueva-habilidad">
        {ws.newSkill}
      </Btn>
      <Btn kind="quiet" className="ofi-wide" onClick={onImport} data-control="traer-de-enlace">
        {words(IMPORT_WORDS).open}
      </Btn>
      <p className="cor-cap ofi-shelf-hint">
        {w.onCount(numWord(onCount, undefined, true), onCount)} {w.focusHint} {onCount > 6 ? w.tooMany : ""}
      </p>
      <p className="cor-cap" role="status">
        {save.isPending ? w.saving : err ? <span className="cor-state bad">{err}</span> : save.isSuccess ? w.savedNext : o.own ? w.ownKit : w.defaultKit}
      </p>
      <div className="ofi-shelf-scroll">
        {group(ws.groupYours(mine.length), mine)}
        {group(w.groupFactory(factory.length), factory)}
        {group(w.groupDocs(docs.length), docs)}
        {!!puesto.data?.archived.length && (
          <>
            <Label as="p" className="ofi-shelf-group">
              {ws.groupRemoved}
            </Label>
            <ul className="ofi-shelf-list">
              {puesto.data.archived.map((a) => (
                <li key={a.slug} className="ofi-shelf-removed" data-removed={a.slug}>
                  <span className="cor-muted">{a.name}</span>
                  <Btn kind="link" disabled={restore.isPending} onClick={() => restore.mutate(a.slug)} aria-label={ws.restoreOf(a.name)} data-control={`recuperar-${a.slug}`}>
                    {ws.restore}
                  </Btn>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
};

const NextRun = ({ o, onShelf, l }: { o: Oficio; onShelf: () => void; l?: LessonsRead }) => {
  const w = words(OFICIO_WORDS);
  const on = o.skills.filter((s) => s.on);
  return (
    <section className="cor-card ofi-side-card" aria-label={w.nextRun} data-next-run>
      <Label as="h3">{w.nextRun}</Label>
      <ul className="ofi-next" tabIndex={0} aria-label={w.nextRun}>
        <li>
          <span>{w.nextRunPost}</span>
        </li>
        {on.map((s) => (
          <li key={s.slug}>
            <span>{skillWords(s).name}</span>
            <span className="cor-cap">{s.version.split("@")[1]}</span>
          </li>
        ))}
        {on.length === 0 && <li className="cor-muted">{w.nextRunNone}</li>}
      </ul>
      <p className="cor-cap">{w.useRate(o.runs.total, o.runs.used_any)}</p>
      <BudgetBar b={l?.budget} />
      <Btn kind="secondary" className="ofi-next-shelf" onClick={onShelf} data-control="abrir-estanteria">
        {w.openShelf}
      </Btn>
    </section>
  );
};

export const OficioPage = ({ p, agent, now, timeZone, links }: { p: OrgProject; agent: string; now: number; timeZone?: string; links: OficioLinks }) => {
  const w = words(OFICIO_WORDS);
  const q = useQuery({ queryKey: ["oficio", p.slug, agent], queryFn: () => api.oficio(p.slug, agent), refetchInterval: 30_000 });
  const member = p.team.find((m) => m.agent === agent) ?? null;
  const seat = seatName(member?.role ?? q.data?.role ?? agent);
  const [pick, setPick] = useState<string | null>(null);
  // PLA-I67-2: the side column shows one thing: the next run, the shelf, a skill's card, the new skill form, the
  // puesto, the lessons, the history, or (PLA-I67-4) the references and one reference's card.
  const [side, setSide] = useState<Side>({ kind: "next" });
  // PLA-I67-6: the tried skill's card (its name, its newest version and the hashes of its versions).
  const trialSlug = side.kind === "trial" ? side.slug : null;
  const trialCard = useQuery({ queryKey: ["skill", p.slug, agent, trialSlug], queryFn: () => api.skillCard(p.slug, agent, trialSlug!), enabled: !!trialSlug });
  // PLA-I67-3: its lessons, and whether a correction is being read.
  const lq = useQuery({ queryKey: ["lessons", p.slug, agent], queryFn: () => api.lessons(p.slug, agent), refetchInterval: 30_000 });
  const lessonList = lq.data?.lessons ?? [];
  const waiting = lessonList.filter((l) => l.state === "proposed");
  const shelf = side.kind === "shelf";
  const setShelf = (open: boolean) => setSide(open ? { kind: "shelf" } : { kind: "next" });
  // PLA-I67-4: the seat's references, which runs carried and opened them, and paste or drop anywhere on the page.
  const refsQ = useQuery({ queryKey: ["refs", p.slug, agent], queryFn: () => refsApi.list(p.slug, agent), refetchInterval: 30_000 });
  const refRunsQ = useQuery({ queryKey: ["refs", p.slug, agent, "runs"], queryFn: () => refsApi.runs(p.slug, agent), refetchInterval: 30_000 });
  const upload = useRefUpload(p.slug, agent, (r) => setSide({ kind: "ref", id: r.id }));
  const drop = useRefDrop((f) => {
    setSide({ kind: "refs" });
    upload.mutate(f);
  });
  const refPick = side.kind === "ref" ? side.id : null;
  useEffect(() => {
    setPick(null);
    setSide({ kind: "next" });
  }, [agent]);
  const o = q.data;
  const chosen = o ? (o.deliveries.some((d) => d.key === pick) ? pick : firstPick(o.deliveries)) : null;
  const head = o ? headline(o, seat) : null;
  return (
    <div className="cor-oficio" data-oficio={agent} {...drop.handlers}>
      {drop.over && (
        <div className="ofi-drop-over" aria-hidden>
          <p>{words(REFERENCE_UI_WORDS).dropHere(seat)}</p>
        </div>
      )}
      <div className="ofi-top">
        <Link to={links.back} className="cor-strip-back" data-control="volver-equipo">
          ‹ {w.back}
        </Link>
        <nav className="ofi-seats" aria-label={w.seats}>
          {p.team.map((m) => (
            <Link key={m.agent} to={links.seat(m.agent)} className="ofi-seat" aria-current={m.agent === agent ? "page" : undefined} data-seat={m.agent}>
              {m.state === "running" ? <Agent small /> : <i className="ofi-seat-dot" aria-hidden />}
              {seatName(m.role)}
            </Link>
          ))}
        </nav>
        <Btn kind="link" onClick={() => setShelf(side.kind !== "shelf")} aria-expanded={side.kind === "shelf"} data-control="estanteria">
          {w.shelf}
        </Btn>
        <Link to={links.motor} className="cor-btn link" data-control="motor">
          {w.motor}
        </Link>
      </div>
      {q.isError ? (
        q.error instanceof ApiError && q.error.code === "AGENT_NOT_FOUND" ? (
          <div className="cor-empty">
            <p className="cor-text">{w.notOnTeam}</p>
          </div>
        ) : (
          <ReadError what={w.readError} onRetry={() => void q.refetch()} />
        )
      ) : !o ? (
        <p className="cor-text cor-muted" role="status" aria-busy="true">
          {w.loading}
        </p>
      ) : (
        <>
          <h2 className="ofi-head">
            {head!.lead} <span className="cor-muted">{head!.rest}</span>
            {waitingLine(lessonList) && <span className="ofi-head-waits"> {waitingLine(lessonList)}</span>}
          </h2>
          <div className="ofi-body">
            {side.kind === "trial" && side.show ? (
              <TrialCompare o={o} id={side.show} card={trialCard.data} onClose={() => setSide({ kind: "trial", slug: side.slug, show: null })} />
            ) : (
            <Drawing
              o={o}
              seat={seat}
              pick={chosen}
              onPick={setPick}
              now={now}
              timeZone={timeZone}
              onShelf={() => setShelf(true)}
              links={links}
              lessons={lessonList}
              refs={{
                list: refsQ.data ?? [],
                pick: refPick,
                onPick: (id) => setSide({ kind: "ref", id }),
                onMore: () => setSide({ kind: "refs" }),
                line: (key) => {
                  const r = deliveryRefs(refRunsQ.data ?? []).get(key);
                  return r ? words(REFERENCE_UI_WORDS).runLine(r.carried, r.opened) : "";
                },
              }}
            />
            )}
            <aside className="ofi-side">
              <dl className="ofi-stats">
                <div>
                  <dt className="cor-label">{w.firstTime}</dt>
                  <dd>
                    {o.counts.first_time} <span className="cor-cap">{w.of(o.counts.closed)}</span>
                  </dd>
                </div>
                <div>
                  <dt className="cor-label">{w.lastFive}</dt>
                  <dd>
                    {o.counts.last_five_first} <span className="cor-cap">{w.of(o.counts.last_five)}</span>
                  </dd>
                </div>
                {/* PLA-I67-5: the owner's confirmed repeats across its lessons. */}
                <div>
                  <dt className="cor-label">{words(LESSON_WORDS).repeatsStat}</dt>
                  <dd data-repeats>{lessonList.reduce((n, l) => n + (l.repeats?.confirmed ?? 0), 0)}</dd>
                </div>
              </dl>
              {side.kind === "shelf" ? (
                <Shelf o={o} seat={seat} onClose={() => setShelf(false)} onOpen={(slug) => setSide({ kind: "skill", slug })} onNew={() => setSide({ kind: "new" })} onImport={() => setSide({ kind: "import" })} />
              ) : side.kind === "skill" ? (
                <SkillPanel o={o} seat={seat} slug={side.slug} onClose={() => setShelf(true)} onOpen={(slug) => setSide({ kind: "skill", slug })} onTry={(slug) => setSide({ kind: "trial", slug, show: null })} />
              ) : side.kind === "trial" ? (
                <TrialPanel
                  o={o}
                  slug={side.slug}
                  name={trialCard.data?.name ?? side.slug}
                  n={trialCard.data?.n ?? 1}
                  now={now}
                  timeZone={timeZone}
                  onClose={() => setSide({ kind: "skill", slug: side.slug })}
                  onShow={(id) => setSide({ kind: "trial", slug: side.slug, show: id })}
                />
              ) : side.kind === "import" ? (
                <ImportPanel o={o} seat={seat} onClose={() => setShelf(true)} onOpen={(slug) => setSide({ kind: "skill", slug })} />
              ) : side.kind === "new" ? (
                <NewSkillPanel o={o} seat={seat} onClose={() => setShelf(true)} onOpen={(slug) => setSide({ kind: "skill", slug })} />
              ) : side.kind === "puesto" ? (
                <PuestoPanel o={o} seat={seat} motorLink={links.motor} onClose={() => setSide({ kind: "next" })} />
              ) : side.kind === "historia" ? (
                <HistoryPanel l={lq.data} now={now} timeZone={timeZone} onClose={() => setSide({ kind: "next" })} />
              ) : side.kind === "refs" ? (
                <RefPanel slug={p.slug} agent={agent} seat={seat} refs={refsQ.data ?? []} upload={upload} onOpen={(id) => setSide({ kind: "ref", id })} onClose={() => setSide({ kind: "next" })} />
              ) : side.kind === "ref" && refsQ.data?.some((r) => r.id === side.id) ? (
                <RefCard key={side.id} slug={p.slug} agent={agent} seat={seat} r={refsQ.data.find((r) => r.id === side.id)!} now={now} timeZone={timeZone} onClose={() => setSide({ kind: "next" })} />
              ) : side.kind === "lessons" ? (
                <LessonsPanel o={o} l={lq.data} onClose={() => setSide({ kind: "next" })} />
              ) : (
                <>
                  <Reading l={lq.data} />
                  {waiting[0] ? (
                    <>
                      <ProposalCard key={waiting[0].id} o={o} seat={seat} lesson={waiting[0]} />
                    </>
                  ) : (
                    <NextRun o={o} l={lq.data} onShelf={() => setShelf(true)} />
                  )}
                  {/* PLA-I67-2/3/5: the seat, its lessons and its changes, under whichever card shows. */}
                  <div className="ofi-actions ofi-side-links">
                    <Btn kind="link" onClick={() => setSide({ kind: "puesto" })} data-control="abrir-puesto">
                      {words(PUESTO_WORDS).open}
                    </Btn>
                    <Btn kind="link" onClick={() => setSide({ kind: "lessons" })} data-control="abrir-lecciones">
                      {words(LESSON_WORDS).open(lessonList.filter((l) => l.state === "active").length)}
                    </Btn>
                    <Btn kind="link" onClick={() => setSide({ kind: "refs" })} data-control="agregar-referencia">
                      {words(REFERENCE_UI_WORDS).add}
                    </Btn>
                    <Btn kind="link" onClick={() => setSide({ kind: "historia" })} data-control="abrir-cambios">
                      {words(LESSON_WORDS).openHistory}
                    </Btn>
                  </div>
                </>
              )}
            </aside>
          </div>
          <TeachBar o={o} seat={seat} onSkill={() => setSide({ kind: "new" })} />
        </>
      )}
    </div>
  );
};
