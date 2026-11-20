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
// PLA-I67-4: the seat's references (threads, the side panel, the card, paste and drop).
import { REFERENCE_UI_WORDS } from "@/lib/references-words";
import { deliveryRefs, refRoom, type Reference } from "@/lib/references";
import { refsApi } from "@/lib/references-api";
import { REF_ROW, RefCard, RefPanel, RefThreads, refsHeight, useRefDrop, useRefUpload } from "./oficio-refs";

export type OficioLinks = { back: string; seat: (agent: string) => string; motor: string; ver: (d: { key: string; kind: string }) => string };

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

const Drawing = ({ o, seat, pick, onPick, now, timeZone, onShelf, links, refs }: { o: Oficio; seat: string; pick: string | null; onPick: (k: string) => void; now: number; timeZone?: string; onShelf: () => void; links: OficioLinks; refs?: RefsInDrawing }) => {
  const w = words(OFICIO_WORDS);
  const [ref, { w: W, h: H }] = useSize<HTMLDivElement>();
  // PLA-I67-4: the references take up to a third of the rows' room, under the skills.
  const refList = refs?.list ?? [];
  const refN = refRoom(Math.floor((H - 40) / REF_ROW), refList.length);
  const refPx = refsHeight(refN, 0);
  const rows: Row[] = rowsOf(o.skills, Math.floor((H - 40 - (refPx ? refPx + 6 : 0)) / ROW));
  const maxUsed = Math.max(0, ...o.skills.map((s) => s.deliveries_used));
  const x0 = LABEL_W + 12;
  const hubX = Math.round(x0 + Math.min(220, Math.max(120, W * 0.16)));
  const refTop = 8 + rows.length * ROW + 6 + (o.skills.some((s) => s.on) ? 0 : 76);
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
          </ul>
          {onCount === 0 && (
            <div className="ofi-empty-skills" style={{ top: 8 + rows.length * ROW + 10 }} data-empty="skills">
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

const Shelf = ({ o, seat, onClose }: { o: Oficio; seat: string; onClose: () => void }) => {
  const w = words(OFICIO_WORDS);
  const client = useQueryClient();
  const carried = o.skills.filter((s) => s.on).map((s) => s.slug);
  const save = useMutation({
    mutationFn: (list: string[]) => api.setSeatPacks(o.project, o.agent, list),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["oficio", o.project, o.agent] });
      void client.invalidateQueries({ queryKey: ["company"] });
    },
  });
  const factory = o.skills.filter((s) => s.source === "kit");
  const docs = o.skills.filter((s) => s.source === "doc");
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
                <Switch on={s.on} label={sw.name} disabled={save.isPending} onChange={(on) => save.mutate(shelfNext(carried, s.slug, on))} data-control={`estante-${s.slug}`} />
                <span className="cor-cap ofi-shelf-line">{sw.line}</span>
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
      <p className="cor-cap ofi-shelf-hint">
        {w.onCount(numWord(carried.length, undefined, true), carried.length)} {w.focusHint} {carried.length > 6 ? w.tooMany : ""}
      </p>
      <p className="cor-cap" role="status">
        {save.isPending ? w.saving : err ? <span className="cor-state bad">{err}</span> : save.isSuccess ? w.savedNext : o.own ? w.ownKit : w.defaultKit}
      </p>
      <div className="ofi-shelf-scroll">
        {group(w.groupFactory(factory.length), factory)}
        {group(w.groupDocs(docs.length), docs)}
      </div>
    </section>
  );
};

const NextRun = ({ o, onShelf }: { o: Oficio; onShelf: () => void }) => {
  const w = words(OFICIO_WORDS);
  const on = o.skills.filter((s) => s.on);
  return (
    <section className="cor-card ofi-side-card" aria-label={w.nextRun} data-next-run>
      <Label as="h3">{w.nextRun}</Label>
      <ul className="ofi-next">
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
      <Btn kind="secondary" onClick={onShelf} data-control="abrir-estanteria">
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
  const [shelf, setShelf] = useState(false);
  // PLA-I67-4: the side panel may show the references ("refs") or one reference's card (its id).
  const [refSide, setRefSide] = useState<string | null>(null);
  const refsQ = useQuery({ queryKey: ["refs", p.slug, agent], queryFn: () => refsApi.list(p.slug, agent), refetchInterval: 30_000 });
  const refRunsQ = useQuery({ queryKey: ["refs", p.slug, agent, "runs"], queryFn: () => refsApi.runs(p.slug, agent), refetchInterval: 30_000 });
  const upload = useRefUpload(p.slug, agent, (r) => setRefSide(r.id));
  const drop = useRefDrop((f) => {
    setShelf(false);
    setRefSide("refs");
    upload.mutate(f);
  });
  const openShelf = (on: boolean) => {
    setShelf(on);
    if (on) setRefSide(null);
  };
  useEffect(() => {
    setPick(null);
    setShelf(false);
    setRefSide(null);
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
        <Btn kind="link" onClick={() => openShelf(!shelf)} aria-expanded={shelf} data-control="estanteria">
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
          </h2>
          <div className="ofi-body">
            <Drawing
              o={o}
              seat={seat}
              pick={chosen}
              onPick={setPick}
              now={now}
              timeZone={timeZone}
              onShelf={() => openShelf(true)}
              links={links}
              refs={{
                list: refsQ.data ?? [],
                pick: refSide,
                onPick: (id) => {
                  setShelf(false);
                  setRefSide(id);
                },
                onMore: () => {
                  setShelf(false);
                  setRefSide("refs");
                },
                line: (key) => {
                  const r = deliveryRefs(refRunsQ.data ?? []).get(key);
                  return r ? words(REFERENCE_UI_WORDS).runLine(r.carried, r.opened) : "";
                },
              }}
            />
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
              </dl>
              {shelf ? (
                <Shelf o={o} seat={seat} onClose={() => setShelf(false)} />
              ) : refSide === "refs" ? (
                <RefPanel slug={p.slug} agent={agent} seat={seat} refs={refsQ.data ?? []} upload={upload} onOpen={setRefSide} onClose={() => setRefSide(null)} />
              ) : refSide && refsQ.data?.some((r) => r.id === refSide) ? (
                <RefCard key={refSide} slug={p.slug} agent={agent} seat={seat} r={refsQ.data.find((r) => r.id === refSide)!} now={now} timeZone={timeZone} onClose={() => setRefSide(null)} />
              ) : (
                <>
                  <NextRun o={o} onShelf={() => openShelf(true)} />
                  <Btn kind="secondary" className="ofi-ref-add" onClick={() => setRefSide("refs")} data-control="agregar-referencia">
                    {words(REFERENCE_UI_WORDS).add}
                  </Btn>
                </>
              )}
            </aside>
          </div>
        </>
      )}
    </div>
  );
};
