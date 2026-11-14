// PLA-I40-5: the route under the team. The delivery's legs as bars with their name and count, the one we stand on
// in the floor's hue, and that leg's steps by name with one line of state each (lib/edificio.ts). With no plan it
// says so and offers to ask the PO for one.
// PLA-I46-14: each leg has a look (complete, in course, next, postponed, not planned) and one pink light (#ff7ab6,
// never orange: orange is the owner's next move) sits on the leg in course, or on the next one once it is complete.
// When a leg's last step is accepted while the floor is open, the segment fills (300 ms), the leg glows with pink
// sparks (900 ms) and the light passes on (400 ms), once. A load never plays it; reduce-motion shows the end state.
// At 390 the five legs stay in one row with short labels («I1 4/5», «✓», «sigue») and one detail line underneath.
import { memo, useEffect, useLayoutEffect, useState, type CSSProperties } from "react";
import type { OrgProject, OrgRoute, OrgRouteLeg } from "@/lib/api";
import { legLine, routeCount, stepLine, stepMark } from "@/lib/edificio";

export const PLAN_ASK = "Arma el plan del proyecto: los entregables y los pasos de cada uno.";

export type LegLook = "done" | "now" | "next" | "off" | "unplanned" | "planned";
export type PlayPhase = "fill" | "glow" | "pass";
export type Play = { key: string; from: number; phase: PlayPhase };
export const PLAY_MS: Record<PlayPhase, number> = {
  fill: 300,
  glow: 900,
  pass: 400,
};
const AFTER: Record<PlayPhase, PlayPhase | null> = {
  fill: "glow",
  glow: "pass",
  pass: null,
};

const complete = (l: OrgRouteLeg) => l.state === "done" || (l.total > 0 && l.done === l.total);
const pct = (l: OrgRouteLeg) => (l.total ? Math.round((l.done / l.total) * 100) : 0);
export const legCode = (l: OrgRouteLeg, i: number) => l.key.match(/I\d+$/)?.[0] ?? `${i + 1}`;

// The looks and where the light is. While a leg celebrates (fill, glow) the light stays on it; it passes at "pass".
export function legLooks(legs: OrgRouteLeg[], play?: Play | null): { looks: LegLook[]; lit: number } {
  const looks: LegLook[] = legs.map((l) => (complete(l) ? "done" : l.state === "here" ? "now" : l.postponed ? "off" : l.state === "unplanned" ? "unplanned" : "planned"));
  const here = legs.findIndex((l) => l.state === "here");
  if (here >= 0 && looks[here] === "now") return { looks, lit: here };
  const open = (i: number) => looks[i] !== "done" && looks[i] !== "off";
  const from = here >= 0 ? here + 1 : 0;
  let next = legs.findIndex((_, i) => i >= from && open(i));
  if (next < 0) next = legs.findIndex((_, i) => open(i));
  const playing = play && play.phase !== "pass" ? legs.findIndex((l) => l.key === play.key) : -1;
  if (playing >= 0) return { looks, lit: playing };
  if (next >= 0) looks[next] = "next";
  return { looks, lit: next };
}

// The short label at 390: «4/5», «✓», «sigue», «—».
export function legShort(l: OrgRouteLeg, look: LegLook): string {
  if (look === "done") return "✓";
  if (look === "next") return "sigue";
  if (look === "unplanned") return "—";
  return `${l.done}/${l.total}`;
}
const lineOf = (l: OrgRouteLeg, look: LegLook) => (look === "next" ? `sigue · ${legLine(l)}` : look === "done" ? "completo" : legLine(l));

// What the floor saw last, per project, for this page's life. The first sight of a route is a load: it records and
// plays nothing. A leg that was open and is now complete plays once; the next sight records it as complete.
const seen = new Map<string, Map<string, { complete: boolean; pct: number }>>();
export function noteRoute(slug: string, legs: OrgRouteLeg[]): { key: string; from: number } | null {
  const before = seen.get(slug);
  seen.set(slug, new Map(legs.map((l) => [l.key, { complete: complete(l), pct: pct(l) }])));
  if (!before) return null;
  const hit = legs.find((l) => complete(l) && before.get(l.key)?.complete === false);
  return hit ? { key: hit.key, from: before.get(hit.key)!.pct } : null;
}
export const forgetRoutes = () => seen.clear();
const reducedMotion = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const SPARKS = Array.from({ length: 10 }, (_, i) => {
  const a = (i / 10) * Math.PI * 2;
  return {
    "--dx": `${Math.round(Math.cos(a) * (26 + (i % 3) * 10))}px`,
    "--dy": `${Math.round(Math.sin(a) * (16 + (i % 4) * 6))}px`,
  } as CSSProperties;
});

// The legs hold the celebration's state, so they are their own (memo) component and Route stays hook-free.
const Legs = memo(function Legs({ slug, route: r, play: forced }: { slug: string; route: OrgRoute; play?: Play | null }) {
  const [played, setPlay] = useState<Play | null>(null);
  const play = forced ?? played;
  const sig = r.legs.map((l) => `${l.key}:${l.done}/${l.total}:${l.state}`).join("|");
  // Before paint, so the light never flashes on the next leg before the fill starts.
  useLayoutEffect(() => {
    const hit = noteRoute(slug, r.legs);
    if (hit && !reducedMotion()) setPlay({ ...hit, phase: "fill" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, sig]);
  useEffect(() => {
    if (!played) return;
    const t = setTimeout(() => setPlay(AFTER[played.phase] ? { ...played, phase: AFTER[played.phase]! } : null), PLAY_MS[played.phase]);
    return () => clearTimeout(t);
  }, [played]);
  const { looks, lit } = legLooks(r.legs, play);
  const litLeg = lit >= 0 ? r.legs[lit] : undefined;
  return (
    <>
      <ol className="edi-legs" style={{ "--n": r.legs.length } as CSSProperties}>
        {r.legs.map((l, i) => {
          const playing = play?.key === l.key && play.phase !== "pass" ? play.phase : undefined;
          const arriving = play?.phase === "pass" && i === lit && l.key !== play.key;
          return (
            <li
              key={l.key}
              className="edi-leg"
              data-leg={l.state}
              aria-current={i === lit ? "step" : undefined}
              data-look={looks[i]}
              data-lit={i === lit ? "" : undefined}
              data-plan={l.state === "unplanned" ? "none" : undefined}
              data-play={playing}
              data-arrive={arriving ? "" : undefined}
            >
              <span className="edi-legbar" aria-hidden>
                <i
                  style={{
                    width: `${pct(l)}%`,
                    ...(playing === "fill" ? ({ "--from": `${play!.from}%` } as CSSProperties) : {}),
                  }}
                />
              </span>
              <b>
                <small className="edi-legcode">
                  {legCode(l, i)}
                  <span className="edi-legshort"> {legShort(l, looks[i]!)}</span>
                </small>
                <span className="edi-legname">{l.title}</span>
              </b>
              <span className="edi-legline">{lineOf(l, looks[i]!)}</span>
              {playing === "glow" && SPARKS.map((s, k) => <i key={k} className="edi-spark" style={s} aria-hidden />)}
            </li>
          );
        })}
      </ol>
      {litLeg && (
        <p className="edi-legdetail" data-detail-of={legCode(litLeg, lit)}>
          {legCode(litLeg, lit)} · {litLeg.title} · {lineOf(litLeg, looks[lit]!)}
        </p>
      )}
    </>
  );
});

export const Route = ({
  project: p,
  now,
  timeZone,
  onPlan,
  busy,
  play,
}: {
  project: OrgProject;
  now: number;
  timeZone?: string;
  onPlan?: (slug: string, text: string) => void;
  busy?: boolean;
  play?: Play | null;
}) => {
  const r = p.route;
  if (r === undefined) return null;
  if (!r || r.legs.length === 0)
    return (
      <div className="edi-route" data-route="empty">
        <p className="edi-rhead">
          <b>Entrega</b>
          <span>Aún no hay plan</span>
        </p>
        {onPlan && !p.paused && (
          <div>
            <button type="button" className="edi-btn" onClick={() => onPlan(p.slug, PLAN_ASK)} disabled={busy} data-control="planear">
              Que PO lo planee
            </button>
          </div>
        )}
      </div>
    );
  const here = r.legs.find((l) => l.state === "here");
  return (
    <div className="edi-route" data-route={r.legs.length}>
      <p className="edi-rhead">
        <b>Entrega</b>
        <span data-route-count>{routeCount(r)}</span>
      </p>
      <Legs slug={p.slug} route={r} play={play} />
      {here?.steps && here.steps.length > 0 && (
        <ol className="edi-steps" data-steps-of={here.title}>
          {here.steps.map((s) => (
            <li key={s.key} data-step={s.state} data-mark={stepMark(s)}>
              <span className="edi-smark" aria-hidden>
                {stepMark(s) === "done" ? "✓" : ""}
              </span>
              <span className="edi-stext">
                <b>{s.title}</b>
                <span>{stepLine(s, p.team, now, timeZone)}</span>
              </span>
            </li>
          ))}
          {!!here.more_steps && (
            <li data-mark="later">
              <span className="edi-smark" aria-hidden />
              <span className="edi-stext">
                <span>+{here.more_steps} {here.more_steps === 1 ? "paso" : "pasos"} más</span>
              </span>
            </li>
          )}
        </ol>
      )}
    </div>
  );
};
