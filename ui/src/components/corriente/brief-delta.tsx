// PLA-I63-2: the delta (PLA-IDEA26, sketch 2). One stream per project, drawn as an SVG curve into «Tú»; its lights are
// buttons (44px tall): a spark is a new idea, a violet light with its key is what follows, an amber rhombus with its
// verb is what waits on the owner, and a blocker is a dam that cuts the stream (dotted after it). What is settled leaves by
// the green river of Resuelto, whose lights can be picked too. Particles run along each stream and stop at a dam; the
// picked light pulses to Tú. Only transform and offset-path move; nothing moves with prefers-reduced-motion.
import { useEffect, useRef, useState } from "react";
import { CrossMark } from "@/components/plania-mark";
import { CROSS } from "@/lib/brief";
import { outPath, tail, type Delta, type Light } from "@/lib/brief-delta";
import { words } from "@/lib/i18n";
import { BRIEF_DELTA_WORDS } from "@/lib/brief-delta-words";
import { Logo } from "./parts";

/** The main area's size, measured (1440 × 650 until it is). */
export function useStage(): [React.RefObject<HTMLDivElement | null>, { w: number; h: number }] {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 1440, h: 650 });
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => {
      const r = e!.contentRect;
      if (r.width > 0 && r.height > 0) setSize((s) => (Math.abs(s.w - r.width) < 1 && Math.abs(s.h - r.height) < 1 ? s : { w: Math.round(r.width), h: Math.round(r.height) }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size];
}

function LightButton({ l, sel, settled, onPick, arrive, flow }: { l: Light; sel: boolean; settled?: boolean; onPick: (id: string) => void; arrive?: boolean; flow?: boolean }) {
  const w = words(BRIEF_DELTA_WORDS);
  const label = `${settled ? w.settled : w.kind[l.kind]}: ${l.title}`;
  const off = settled ? 8 : l.kind === "idea" ? 14 : l.kind === "next" ? 12 : 16;
  return (
    <button
      type="button"
      className={`cor-bf-lt${flow ? " flow" : ""}${sel ? " sel" : ""}${settled ? " done" : ""}${arrive ? " arrive" : ""}`}
      style={flow ? undefined : { left: l.x - off, top: l.y }}
      aria-label={label}
      title={label}
      aria-pressed={sel}
      onClick={() => onPick(l.id)}
      data-light={l.id}
      data-kind={settled ? "done" : l.kind}
    >
      {settled ? (
        <span className="cor-bf-gone" aria-hidden />
      ) : l.kind === "idea" ? (
        <span className="cor-bf-spark" aria-hidden />
      ) : l.kind === "next" ? (
        <>
          <span className="cor-bf-dot" aria-hidden />
          {l.label === "key" && <span className="cor-bf-key" aria-hidden>{l.key}</span>}
        </>
      ) : (
        <>
          <span className="cor-you" aria-hidden />
          {l.label === "tag" && (
            <span className="cor-bf-tag" aria-hidden>
              <b>{l.verb}</b>
              <span className={l.kind === "block" ? "r" : undefined}>{l.sub}</span>
            </span>
          )}
        </>
      )}
    </button>
  );
}

export type DeltaProps = {
  delta: Delta;
  selected: string | null;
  onPick: (id: string) => void;
  /** Whether the light in hand is open (Tú links to the card). */
  inHand: boolean;
  /** The light that just settled (it drops into the river). */
  arrived?: string | null;
  /** Show "sin brief" under every stream (no brief yet). */
  quiet?: boolean;
  stageRef?: React.Ref<HTMLDivElement>;
};

export function BriefDelta({ delta, selected, onPick, inHand, arrived, quiet, stageRef }: DeltaProps) {
  const g = delta.geo;
  const c = delta.counts;
  const out = outPath(g);
  const sel = delta.streams.flatMap((s) => s.lights).find((l) => l.id === selected);
  const selStream = sel ? delta.streams.find((s) => s.lights.includes(sel)) : undefined;
  const free = c.toca === 0;
  const w = words(BRIEF_DELTA_WORDS);
  return (
    <div className={`cor-bf-delta${g.scroll ? " scroll" : ""}`} ref={stageRef} role="group" aria-label={w.label} data-brief="delta">
      <div className="cor-bf-stage" style={{ width: g.w, height: g.h }}>
        <svg className="cor-bf-svg" width={g.w} height={g.h} viewBox={`0 0 ${g.w} ${g.h}`} aria-hidden>
          <defs>
            <linearGradient id="cor-bf-gv" gradientUnits="userSpaceOnUse" x1={g.x0} y1="0" x2={g.gx} y2="0">
              <stop offset="0" stopColor="#8b5cf6" stopOpacity=".22" />
              <stop offset="1" stopColor="#c4b5fd" stopOpacity=".9" />
            </linearGradient>
            <linearGradient id="cor-bf-go" gradientUnits="userSpaceOnUse" x1={g.gx} y1="0" x2={g.w} y2="0">
              <stop offset="0" stopColor="#c4b5fd" stopOpacity=".8" />
              <stop offset=".35" stopColor="#6ee7a0" stopOpacity=".75" />
              <stop offset="1" stopColor="#6ee7a0" stopOpacity=".25" />
            </linearGradient>
          </defs>
          <g className="cor-bf-glow" fill="none" strokeLinecap="round">
            {delta.streams.map((s) =>
              s.dam !== null ? (
                <g key={s.slug} data-stream={s.slug} data-dam="">
                  <path d={`M ${g.x0} ${s.y} L ${s.dam} ${s.y}`} stroke="url(#cor-bf-gv)" strokeWidth={s.width} />
                  <path d={`M ${s.dam} ${s.y} ${tail(g, s.y)}`} stroke="rgba(255,255,255,.16)" strokeWidth="1" strokeDasharray="2 7" />
                </g>
              ) : (
                <path key={s.slug} data-stream={s.slug} d={`M ${g.x0} ${s.y} ${tail(g, s.y)}`} stroke="url(#cor-bf-gv)" strokeWidth={s.width} opacity={s.open ? 1 : 0.45} />
              ),
            )}
            {delta.streams.map((s) => (
              <circle key={`src-${s.slug}`} cx={g.x0} cy={s.y} r="2.5" fill="#7c6ad6" stroke="none" />
            ))}
            <path d={`M ${g.gx + 13} ${g.gy} L ${g.card} ${g.gy}`} stroke={inHand ? "#ede9fe" : "rgba(255,255,255,.14)"} strokeWidth={inHand ? 2 : 1} data-brief="tu-link" />
          </g>
          <g className="cor-bf-gout" fill="none" strokeLinecap="round">
            <path d={out} stroke="url(#cor-bf-go)" strokeWidth={c.done ? Math.min(9, 1.5 + c.done * 0.55) : 1} opacity={c.done ? 1 : 0.35} />
          </g>
        </svg>

        {/* Particles: up to three per stream, stopping at a dam; up to four on the river. */}
        <div className="cor-bf-pts" aria-hidden>
          {delta.streams.flatMap((s, i) => {
            const d = s.dam !== null ? `M ${g.x0} ${s.y} L ${s.dam - 8} ${s.y}` : `M ${g.x0} ${s.y} ${tail(g, s.y)}`;
            return Array.from({ length: Math.min(3, s.open) }, (_, k) => (
              <span key={`${s.slug}-${k}`} className="cor-bf-pt" style={{ offsetPath: `path('${d}')`, animationDuration: `${(s.dam !== null ? 4 : 6) + i * 0.7 + k * 1.3}s`, animationDelay: `-${(i * 1.7 + k * 2.3) % 6}s` }} />
            ));
          })}
          {Array.from({ length: Math.min(4, c.done) }, (_, k) => (
            <span key={`o-${k}`} className="cor-bf-pt o" style={{ offsetPath: `path('${out}')`, animationDuration: `${6 + k * 1.6}s`, animationDelay: `-${k * 1.9}s` }} />
          ))}
          {sel && selStream && inHand && !(selStream.dam !== null && sel.x < selStream.dam) && (
            <span key={`hp-${sel.id}`} className="cor-bf-hp" style={{ offsetPath: `path('M ${sel.x} ${sel.y} ${sel.x < g.xc ? tail(g, sel.y) : `L ${g.gx} ${g.gy}`} L ${g.card} ${g.gy}')` }} />
          )}
        </div>

        <span className="cor-bf-band" style={{ left: g.x0 + 16, top: g.y0 - 42 }}>
          {w.bands.ideas}<b>{c.ideas}</b>
        </span>
        <span className="cor-bf-band" style={{ left: g.x0 + 106, top: g.y0 - 42 }}>
          {w.bands.next}<b>{c.next}</b>
        </span>
        <span className={`cor-bf-band${c.toca ? " a" : ""}`} style={{ left: g.x0 + 214, top: g.y0 - 42 }}>
          {w.bands.toca}<b>{c.toca}</b>
        </span>

        {delta.streams.map((s) => (
          <button
            key={s.slug}
            type="button"
            className={`cor-bf-who${selStream?.slug === s.slug ? " cur" : ""}`}
            style={{ top: s.y }}
            aria-label={`${s.name}: ${quiet ? w.noBrief : s.sub}`}
            onClick={() => {
              const first = [...s.lights].sort((a, b) => (a.kind === "block" ? -1 : b.kind === "block" ? 1 : a.kind === "toca" ? -1 : b.kind === "toca" ? 1 : 0))[0];
              if (first) onPick(first.id);
            }}
            disabled={!s.lights.length}
            data-who={s.slug}
          >
            {s.slug === CROSS ? <CrossMark className="cor-logo" /> : <Logo slug={s.slug} title={s.name} />}
            <span className="cor-bf-who-t">
              <span className="cor-bf-nm">{s.name}</span>
              <span className={`cor-bf-sub${s.amber && !quiet ? " a" : ""}`}>{quiet ? w.noBrief : s.sub}</span>
            </span>
          </button>
        ))}

        {delta.streams.map((s) => s.dam !== null && <span key={`dam-${s.slug}`} className="cor-bf-dam" style={{ left: s.dam, top: s.y }} aria-hidden data-dam={s.slug} />)}

        {delta.streams.flatMap((s) => s.lights.map((l) => <LightButton key={l.id} l={l} sel={l.id === selected} onPick={onPick} />))}

        {delta.streams.map(
          (s) =>
            s.more && (
              <button key={`more-${s.slug}`} type="button" className="cor-bf-more" style={{ left: s.more.x - 6, top: s.y }} onClick={() => onPick(s.more!.first)} aria-label={w.more(s.more.n, s.name)} data-more={s.slug}>
                +{s.more.n}
              </button>
            ),
        )}

        <span className={`cor-bf-tu${free ? " free" : ""}`} style={{ left: g.gx, top: g.gy }} aria-hidden data-brief="tu" />
        <span className={`cor-bf-gl${free ? " free" : ""}`} style={{ left: g.gx, top: g.gy - 34 }}>
          {w.bands.you}
        </span>

        <span className="cor-bf-band g" style={{ left: g.riverX, top: g.oy - 7 }} data-brief="resuelto">
          {w.bands.settled}<b>
            {c.done} / {c.total}
          </b>
        </span>
        {delta.riverMore > 0 && (
          <span className="cor-bf-band g" style={{ left: g.riverX + 156, top: g.oy - 7 }}>
            +{delta.riverMore}
          </span>
        )}
        {delta.river.map((l) => (
          <LightButton key={l.id} l={l} sel={l.id === selected} settled onPick={onPick} arrive={l.id === arrived} />
        ))}
      </div>
    </div>
  );
}

// ---- I63-4: the phone (under 640px). No curves: one list per project with the same lights in a row, the card under
// the stream of the chosen light, and Resuelto as a row at the end. The page scrolls, as the rest of Compañía there.
export function BriefPhone({ delta, selected, onPick, card }: { delta: Delta; selected: string | null; onPick: (id: string) => void; card: React.ReactNode }) {
  const c = delta.counts;
  const inRiver = delta.river.some((l) => l.id === selected);
  const w = words(BRIEF_DELTA_WORDS);
  return (
    <div className="cor-bf-phone" data-brief="delta" role="group" aria-label={w.label}>
      <p className="cor-bf-phone-bands">
        <span>
          {w.bands.ideas}<b>{c.ideas}</b>
        </span>
        <span>
          {w.bands.next}<b>{c.next}</b>
        </span>
        <span className={c.toca ? "a" : undefined}>
          {w.bands.toca}<b>{c.toca}</b>
        </span>
      </p>
      {delta.streams.map((s) => {
        const mine = s.lights.some((l) => l.id === selected);
        return (
          <section key={s.slug} className="cor-bf-pstream" aria-label={`${s.name}: ${s.sub}`} data-stream={s.slug}>
            <div className="cor-bf-phead">
              {s.slug === CROSS ? <CrossMark className="cor-logo" /> : <Logo slug={s.slug} title={s.name} />}
              <span className="cor-bf-who-t">
                <span className="cor-bf-nm">{s.name}</span>
                <span className={`cor-bf-sub${s.amber ? " a" : ""}`}>{s.sub}</span>
              </span>
            </div>
            {s.lights.length > 0 && (
              <div className={`cor-bf-prow${s.dam !== null ? " dam" : ""}`}>
                {s.lights.map((l) => (
                  <LightButton key={l.id} l={l} sel={l.id === selected} onPick={onPick} flow />
                ))}
                {s.more && (
                  <button type="button" className="cor-bf-more flow" onClick={() => onPick(s.more!.first)} aria-label={w.more(s.more.n, s.name)} data-more={s.slug}>
                    +{s.more.n}
                  </button>
                )}
              </div>
            )}
            {mine && <div className="cor-bf-pcard">{card}</div>}
          </section>
        );
      })}
      <section className="cor-bf-pstream river" aria-label={w.river(c.done, c.total)} data-stream="resuelto">
        <p className="cor-bf-band g flow" data-brief="resuelto">
          {w.bands.settled}<b>
            {c.done} / {c.total}
          </b>
          {delta.riverMore > 0 && <span> · +{delta.riverMore}</span>}
        </p>
        {delta.river.length > 0 && (
          <div className="cor-bf-prow">
            {delta.river.map((l) => (
              <LightButton key={l.id} l={l} sel={l.id === selected} settled onPick={onPick} flow />
            ))}
          </div>
        )}
        {(inRiver || !selected) && <div className="cor-bf-pcard">{card}</div>}
      </section>
    </div>
  );
}
