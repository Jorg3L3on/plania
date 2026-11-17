// PLA-I55-1 (El ventanal): el índice. The floor's narrow column beside the ventanal: everything the floor has, one line
// each, so nothing needs room of its own until it is opened.
//   Equipo       every teammate as a small window (lit while working, orange while asking) with one line
//   Iniciativas  one line per open initiative (and Sueltos): its count and a bead per step in its stage colour;
//                the completed ones as chips
//   Ideas        the tube in small: a dot per idea taking shape at its stop (the shelf, Guardadas, is in the Pedido tab)
// A click opens that thing in the ventanal (the page's ?f= address); what is open shows pressed. Hook-free and
// presentational, like the floor. Its sections are night panels in both themes (dark), so the stage colours are the
// night ones, as on the board.
import type { CSSProperties, ReactNode } from "react";
import type { OrgMember, OrgProject } from "@/lib/api";
import { closedPct, OPEN_STATIONS, toneOf, trackLine, trackPct, type StageTone, type Track } from "@/lib/etapas";
import type { FichaRef } from "@/lib/ficha";
import { roleName } from "@/lib/org";
import { TONE_VAR } from "@/components/plan/stage-board";
import { Figure } from "./figure";
import { PEDIDO_TONE, STOPS } from "./tubo";

export type SeatView = { data: Record<string, string | undefined>; state: string; label: string; line: string };

// More steps than this and the beads would be slivers: the line shows a bar instead.
const BEADS_MAX = 28;
// The completed initiatives shown as chips; the rest fold behind «+ n más».
const DONE_MAX = 3;

// PLA-I56-2: a landed step that is not closed yet (merged or released, not Done) is «shipped»: the done colour at
// half strength, so a full row of solid beads always means every step is Done.
export type BeadTone = StageTone | "shipped";
const beadVar = (tone: BeadTone) => TONE_VAR[tone === "shipped" ? "done" : tone];

// A bead per step: the closed ones first, then the shipped ones, then the open ones from the nearest to done (Te toca)
// back to Por hacer.
export function beadsOf(tr: Track): BeadTone[] {
  const open = [...OPEN_STATIONS].reverse().flatMap((s) => tr.cells[s.id as keyof Track["cells"]].map((t) => toneOf(t.etapa)));
  const landed = Math.max(0, tr.total - open.length);
  const closed = Math.min(tr.closed, landed);
  return [...Array.from({ length: closed }, () => "done" as BeadTone), ...Array.from({ length: landed - closed }, () => "shipped" as BeadTone), ...open];
}

const one = (n: number, a: string, b: string) => `${n} ${n === 1 ? a : b}`;

export const Indice = ({
  project: p,
  team,
  tracks,
  foco,
  seat,
  onMember,
  onTrack,
  onIdeas,
  empty,
  children,
}: {
  project: OrgProject;
  team: OrgMember[];
  tracks: Track[];
  // What the ventanal shows (null: its home tab).
  foco: FichaRef | null;
  seat: (m: OrgMember) => SeatView;
  onMember?: (m: OrgMember, el: HTMLElement) => void;
  // key null is Sueltos.
  onTrack?: (key: string | null, el: HTMLElement) => void;
  onIdeas?: (el: HTMLElement) => void;
  // What Iniciativas says with no track (the floor: «Aún no hay plan» and Que PO lo planee).
  empty?: ReactNode;
  // The «+ Sumar» window.
  children?: ReactNode;
}) => {
  const seats = team.map((m) => ({ m, v: seat(m) }));
  const working = seats.filter((x) => x.v.state === "work" || x.v.state === "back").length;
  const asking = seats.filter((x) => x.v.state === "ask").length;
  const teamLine = [working ? one(working, "trabaja", "trabajan") : null, asking ? one(asking, "te pregunta", "te preguntan") : null].filter(Boolean).join(" · ") || "nadie trabaja ahora";

  const done = p.tablero?.done_initiatives ?? [];
  const open = tracks.filter((t) => t.key).length;
  const iniLine = [one(open, "abierta", "abiertas"), done.length ? one(done.length, "completa", "completas") : null].filter(Boolean).join(" · ");
  const onTrackOf = (key: string | null) => (foco?.kind === "leg" ? foco.key === key : foco?.kind === "sueltos" ? key === null : false);

  const pedidos = p.pedidos;
  const live = (pedidos ?? []).filter((x) => !x.guardada);
  const waits = live.filter((x) => x.state === "espera").length;
  const ideasOn = !!foco && ((foco.kind === "tab" && foco.tab === "pedido") || foco.kind === "pedido" || foco.kind === "guardadas");
  // Dots sit at their stop; several at one stop spread a little so each one shows.
  const dots = STOPS.flatMap((s, i) => {
    const at = live.filter((x) => x.stop === s.id);
    return at.map((x, j) => ({ x, left: ((i + 0.5) / STOPS.length) * 100 + (j - (at.length - 1) / 2) * 4 }));
  });

  return (
    <nav className="edi-idx" data-indice aria-label={`${p.title} de un vistazo`}>
      <section className="dark edi-ix" data-ix="equipo" aria-label="Equipo">
        <header className="edi-ix-head">
          <h3 className="sb-eyebrow">Equipo</h3>
          <small>{teamLine}</small>
        </header>
        <div className="edi-ix-team" data-team={team.length}>
          {seats.map(({ m, v }) => (
            <button
              key={m.agent}
              type="button"
              className="edi-ix-mate"
              {...v.data}
              aria-label={v.label}
              aria-pressed={foco?.kind === "member" && foco.agent === m.agent}
              onClick={(e) => onMember?.(m, e.currentTarget)}
              disabled={!onMember}
              title={`${roleName(m.role)}: ${v.line}`}
              data-control="indice-equipo"
            >
              <span className="edi-seat" data-state={v.state} aria-hidden>
                <span className="edi-seat-glass">
                  <Figure role={m.role} />
                </span>
              </span>
              <b>{roleName(m.role)}</b>
              <small>{v.line}</small>
            </button>
          ))}
          {children}
        </div>
      </section>

      <section className="dark edi-ix" data-ix="iniciativas" aria-label="Iniciativas">
        <header className="edi-ix-head">
          <h3 className="sb-eyebrow">Iniciativas</h3>
          {tracks.length > 0 && <small>{iniLine}</small>}
        </header>
        {tracks.length === 0 && empty}
        {tracks.map((tr) => {
          const beads = beadsOf(tr);
          const toca = tr.cells.toca.length;
          const body = (
            <>
              {/* The short code (I2): the floor already says whose it is; the full key is in the title. */}
              <span className="edi-ix-code">{tr.key ? tr.key.replace(/^[A-Z0-9]+-/, "") : "·"}</span>
              <span className="edi-ix-name">{tr.title}</span>
              <span className="edi-ix-ct" data-toca={toca || undefined} data-cerrar={tr.canClose || undefined}>
                {trackLine(tr).replace(" · sin iniciativa", "")}
                {toca > 0 && ` · te toca ${toca}`}
              </span>
              {tr.total === 0 ? (
                <span className="edi-ix-beads" data-beads="none" aria-hidden />
              ) : beads.length > BEADS_MAX ? (
                <span className="edi-ix-beads" data-beads="bar" aria-hidden>
                  <i style={{ flex: `0 0 ${closedPct(tr)}%`, "--bc": TONE_VAR.done } as CSSProperties} />
                  {trackPct(tr) > closedPct(tr) && <i data-tone="shipped" style={{ flex: `0 0 ${trackPct(tr) - closedPct(tr)}%`, "--bc": TONE_VAR.done } as CSSProperties} />}
                </span>
              ) : (
                <span className="edi-ix-beads" data-beads={beads.length} aria-hidden>
                  {beads.map((tone, i) => (
                    <i key={i} data-tone={tone} style={{ "--bc": beadVar(tone) } as CSSProperties} />
                  ))}
                </span>
              )}
            </>
          );
          return onTrack ? (
            <button key={tr.key ?? "sueltos"} type="button" className="edi-ix-ini" aria-pressed={onTrackOf(tr.key)} onClick={(e) => onTrack(tr.key, e.currentTarget)} data-track={tr.key ?? "sueltos"} data-control="indice-iniciativa" title={tr.key ? `${tr.key} · ${tr.title}` : tr.title}>
              {body}
            </button>
          ) : (
            <div key={tr.key ?? "sueltos"} className="edi-ix-ini" data-track={tr.key ?? "sueltos"}>
              {body}
            </div>
          );
        })}
        {done.length > 0 && (
          <div className="edi-ix-done" data-folded={done.length}>
            {done.slice(0, DONE_MAX).map((f) =>
              onTrack ? (
                <button key={f.key} type="button" className="sb-fc" aria-pressed={onTrackOf(f.key)} onClick={(e) => onTrack(f.key, e.currentTarget)} data-control="indice-completa" title={f.title}>
                  <b>✓ {f.key}</b>
                  {f.title}
                </button>
              ) : (
                <span key={f.key} className="sb-fc" title={f.title}>
                  <b>✓ {f.key}</b>
                  {f.title}
                </span>
              ),
            )}
            {done.length > DONE_MAX && (
              <details className="sb-more sb-folded-more">
                <summary data-control="indice-completas-mas">+ {done.length - DONE_MAX} más</summary>
                <div className="sb-more-list">
                  {done.slice(DONE_MAX).map((f) =>
                    onTrack ? (
                      <button key={f.key} type="button" className="sb-fc" onClick={(e) => onTrack(f.key, e.currentTarget)} data-control="indice-completa" title={f.title}>
                        <b>✓ {f.key}</b>
                        {f.title}
                      </button>
                    ) : (
                      <span key={f.key} className="sb-fc" title={f.title}>
                        <b>✓ {f.key}</b>
                        {f.title}
                      </span>
                    ),
                  )}
                </div>
              </details>
            )}
          </div>
        )}
      </section>

      {/* PLA-I54-1: the owner's ideas taking shape (an older server sends none). */}
      {pedidos && (
        <section className="dark edi-ix" data-ix="ideas" aria-label="Ideas tomando forma">
          <button type="button" className="edi-ix-ideas" aria-pressed={ideasOn} onClick={(e) => onIdeas?.(e.currentTarget)} disabled={!onIdeas} data-control="indice-ideas" data-live={live.length}>
            <b>{live.length > 0 ? `Ideas tomando forma · ${live.length}` : "Ideas: nada tomando forma"}</b>
            {waits > 0 && <span className="edi-ix-ct" data-toca={waits}>{one(waits, "te espera", "te esperan")}</span>}
            <span className="edi-ix-tube" aria-hidden>
              {dots.map(({ x, left }) => (
                <i key={x.key} data-state={x.state} style={{ left: `${left}%`, "--sc": PEDIDO_TONE[x.state] } as CSSProperties} />
              ))}
            </span>
          </button>
        </section>
      )}
    </nav>
  );
};
