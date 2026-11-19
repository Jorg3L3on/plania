// PLA-I53-3: el tablero de etapas (Design doc of PLA-I53). One shared board for a project's work: the stations are
// the columns (Por hacer · Taller · QA · Revisión · Te toca · Hecho), each open initiative is a track (a row) plus
// Sueltos, and each ticket is a card standing at the station of whoever has it. The stage comes from the server
// (etapa, src/api/etapa.ts); lib/etapas.ts places it. Hook-free and presentational: the page passes the read and
// the calls. The floor (/ceo?piso=) draws it now; the project page (/p/<slug>, F5) is meant to reuse it as is.
//   station   the header cell of a column: its arched window lights in the stage colour while someone works there
//             and tints the column; a page can pass what opens from it (the floor: the teammate in La ficha)
//   corner    the top-left cell (the floor puts the teammates who have no station there, and Sumar)
//   below     a full-width row under the stations (the floor hangs its teammates' questions there)
//   tagsFor   extra tags on a card (the zone tag, PLA-I53-6, is drawn by the card itself from t.zonas)
//   actsFor   small buttons beside a card (the floor: Detener, Hacer primero, Aceptar, Quitar)
//   folded    completed initiatives, one line of chips under the board
import type { CSSProperties, ReactNode } from "react";
import type { ProjectTicket, Tablero } from "@/lib/api";
import { ZonaTags } from "@/components/plan/zona-tags";
import { words } from "@/lib/i18n";
import { PLAN } from "@/lib/plan-words";
import { boardOf, ciTone, ciWord, closedPct, openStationsOf, stationLine, stationsOf, toneOf, trackLine, trackPct, whoLine, wordOf, type Station, type StationId, type StageTone, type Track } from "@/lib/etapas";

// The stage colours, from the app's status tokens. «pending» text uses the idle grey so it can be read on the card.
export const TONE_VAR: Record<StageTone, string> = {
  pending: "var(--status-idle)",
  ready: "var(--status-ready)",
  blocked: "var(--status-blocked)",
  now: "var(--status-now)",
  review: "var(--status-review)",
  owner: "var(--status-owner)",
  done: "var(--status-done)",
};
// More than this many cards in one cell fold behind «+ n más» (a native disclosure, no state).
const CELL_MAX = 3;
// The folded line shows the newest completed initiatives; the rest fold behind «+ n más» so the line stays one line.
const FOLDED_MAX = 4;

// What a page puts on a station: what opens from it, its accessible name, the figure in its window, the line under its
// name when it is not lit (the floor: the teammate's own caption), and data attributes.
// lit (PLA-I53-4): the page's own light for the station, from the same source as its Ahora line; null is unlit,
// undefined leaves it to the cards.
export type StationHeadProps = { onClick?: (el: HTMLElement) => void; label?: string; figure?: ReactNode; line?: string | null; data?: Record<string, string | undefined>; lit?: StageTone | null };
export type StageBoardProps = {
  tablero: Tablero;
  now: number;
  // The open card (its border shows it).
  selected?: string | null;
  onTicket?: (t: ProjectTicket, el: HTMLElement) => void;
  // A track's label or its Hecho stack: key null is Sueltos.
  onTrack?: (key: string | null, el: HTMLElement) => void;
  onDone?: (key: string | null, el: HTMLElement) => void;
  station?: (s: Station) => StationHeadProps | null;
  corner?: ReactNode;
  below?: ReactNode;
  tagsFor?: (t: ProjectTicket) => ReactNode;
  actsFor?: (t: ProjectTicket) => ReactNode;
  // Cards that are not tickets yet (the owner's orders nobody turned into one), drawn first in Sueltos.
  extra?: Partial<Record<Exclude<StationId, "hecho">, ReactNode[]>>;
  folded?: { key: string; title: string }[];
  // What the board says when it has no track (the floor: «Aún no hay plan» and Que PO lo planee).
  empty?: ReactNode;
  onFolded?: (key: string, el: HTMLElement) => void;
  label?: string;
  // Extra classes on the board («dark» on the floor's night panel, so the status colours are the night ones).
  className?: string;
};

const DOOR = (
  <svg className="sb-door" viewBox="0 0 40 36" aria-hidden focusable="false">
    <path d="M11 20l6 6 12-14" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const FIG = (
  <svg className="sb-fig" viewBox="0 0 40 36" aria-hidden focusable="false">
    <circle cx="20" cy="13" r="7.5" />
    <path d="M4 36c0-9 7-14 16-14s16 5 16 14z" />
  </svg>
);

const StationCell = ({ s, tone: cards, head }: { s: Station; tone: StageTone | undefined; head: StationHeadProps | null }) => {
  const tone = head?.lit === undefined ? cards : (head.lit ?? undefined);
  const lit = !!tone;
  const style = { "--lc": tone ? TONE_VAR[tone] : "transparent" } as CSSProperties;
  const body = (
    <>
      <span className="sb-win" aria-hidden>
        {s.id === "hecho" ? DOOR : (head?.figure ?? FIG)}
      </span>
      <span className="sb-sname">{s.name}</span>
      <span className="sb-sverb" data-doing title={!lit && head?.line ? head.line : undefined}>
        {!lit && head?.line ? head.line : stationLine(s, lit)}
      </span>
    </>
  );
  const data = { "data-station": s.id, "data-lit": lit ? tone : undefined, ...(head?.data ?? {}) };
  return head?.onClick ? (
    <button type="button" className="sb-cell sb-station" style={style} {...data} aria-label={head.label} onClick={(e) => head.onClick!(e.currentTarget)} data-control="tablero-estacion">
      {body}
    </button>
  ) : (
    <div className="sb-cell sb-station" style={style} {...data} role={head?.label ? "group" : undefined} aria-label={head?.label}>
      {body}
    </div>
  );
};

const Card = ({ t, now, selected, onTicket, tagsFor, actsFor }: { t: ProjectTicket; now: number; selected: boolean; onTicket?: StageBoardProps["onTicket"]; tagsFor?: StageBoardProps["tagsFor"]; actsFor?: StageBoardProps["actsFor"] }) => {
  const e = t.etapa;
  const who = whoLine(e, now);
  const ci = ciWord(e.ci);
  const acts = actsFor?.(t);
  const word = wordOf(e);
  return (
    <div className="sb-card" data-card={t.key} data-etapa={e.etapa} data-live={e.live ? "" : undefined} style={{ "--sc": TONE_VAR[toneOf(e)] } as CSSProperties}>
      <button
        type="button"
        className="sb-card-main"
        aria-current={selected ? "true" : undefined}
        title={e.reason ? `${t.title} · ${e.reason}` : t.title}
        onClick={(ev) => onTicket?.(t, ev.currentTarget)}
        data-control="tablero-tarjeta"
      >
        <span className="sb-st" data-word>
          <i aria-hidden />
          {word}
        </span>
        <span className="sb-tt">{t.title}</span>
        <span className="sb-mt">
          <span className="sb-key">{t.key}</span>
          {who && <span data-who>{who}</span>}
          <ZonaTags zonas={t.zonas} />
          {tagsFor?.(t)}
          {ci && (
            <span className="sb-tag" data-ci={ciTone(e.ci) ?? undefined}>
              {ci}
            </span>
          )}
        </span>
      </button>
      {acts && <span className="sb-acts">{acts}</span>}
    </div>
  );
};

const Cell = ({ items, lit, last }: { items: ReactNode[]; lit: StageTone | undefined; last?: boolean }) => {
  const shown = items.length > CELL_MAX ? items.slice(0, CELL_MAX - 1) : items;
  const rest = items.length > CELL_MAX ? items.slice(CELL_MAX - 1) : [];
  const w = words(PLAN);
  return (
    <div className="sb-cell sb-r" data-empty={items.length === 0 ? "" : undefined} data-last={last ? "" : undefined} data-lit={lit} style={{ "--lc": lit ? TONE_VAR[lit] : "transparent" } as CSSProperties}>
      {shown}
      {rest.length > 0 && (
        <details className="sb-more">
          <summary data-control="tablero-mas">{w.plusMore(rest.length)}</summary>
          <div className="sb-more-list">{rest}</div>
        </details>
      )}
    </div>
  );
};

const TrackLabel = ({ tr, onTrack }: { tr: Track; onTrack?: StageBoardProps["onTrack"] }) => {
  const body = (
    <>
      {tr.key && <span className="sb-tcode">{tr.key}</span>}
      <span className="sb-tname">{tr.title}</span>
      <span className="sb-tsub">{trackLine(tr)}</span>
      {/* PLA-I56-2: solid for closed steps, half strength for landed ones not closed yet. */}
      <span className="sb-bar" aria-hidden>
        <i style={{ width: `${closedPct(tr)}%` }} />
        {trackPct(tr) > closedPct(tr) && <i data-shipped="" style={{ width: `${trackPct(tr) - closedPct(tr)}%` }} />}
      </span>
    </>
  );
  return onTrack ? (
    <button type="button" className="sb-cell sb-track" onClick={(e) => onTrack(tr.key, e.currentTarget)} data-track={tr.key ?? "sueltos"} data-control="tablero-iniciativa" title={tr.title}>
      {body}
    </button>
  ) : (
    <div className="sb-cell sb-track" data-track={tr.key ?? "sueltos"}>
      {body}
    </div>
  );
};

export const StageBoard = ({ tablero, now, selected, onTicket, onTrack, onDone, station, corner, below, tagsFor, actsFor, extra, folded, onFolded, label, className, empty }: StageBoardProps) => {
  const w = words(PLAN);
  const b = boardOf(tablero, { sueltos: !!extra && Object.values(extra).some((x) => x && x.length > 0) });
  const chip = (f: { key: string; title: string }) =>
    onFolded ? (
      <button key={f.key} type="button" className="sb-fc" onClick={(e) => onFolded(f.key, e.currentTarget)} data-control="tablero-completa" title={f.title}>
        <b>✓ {f.key}</b>
        {f.title}
      </button>
    ) : (
      <span key={f.key} className="sb-fc" title={f.title}>
        <b>✓ {f.key}</b>
        {f.title}
      </span>
    );
  return (
    <section className={className ? `${className} sb` : "sb"} aria-label={label ?? w.board} data-tracks={b.tracks.length}>
      <div className="sb-scroll">
        <div className="sb-grid">
          <div className="sb-cell sb-corner">{corner ?? <span className="sb-eyebrow">{w.initiative}</span>}</div>
          {stationsOf().map((s) => (
            <StationCell key={s.id} s={s} tone={b.lit[s.id]} head={station?.(s) ?? null} />
          ))}
          {below && <div className="sb-below">{below}</div>}
          {b.tracks.length === 0 && <div className="sb-empty">{empty ?? <p>{w.boardEmpty}</p>}</div>}
          {b.tracks.map((tr) => (
            <div key={tr.key ?? "sueltos"} className="sb-row" data-row={tr.key ?? "sueltos"}>
              <TrackLabel tr={tr} onTrack={onTrack} />
              {openStationsOf().map((s) => {
                const id = s.id as Exclude<StationId, "hecho">;
                const cards = tr.cells[id].map((t) => <Card key={t.key} t={t} now={now} selected={selected === t.key} onTicket={onTicket} tagsFor={tagsFor} actsFor={actsFor} />);
                const items = !tr.key && extra?.[id] ? [...extra[id]!, ...cards] : cards;
                return <Cell key={s.id} items={items} lit={b.lit[s.id]} />;
              })}
              <div className="sb-cell sb-r" data-last="" data-empty={tr.hecho.count ? undefined : ""}>
                {tr.hecho.count > 0 && (
                  <button type="button" className="sb-stack" onClick={(e) => onDone?.(tr.key, e.currentTarget)} data-control="tablero-hecho" aria-label={w.doneAria(tr.hecho.count, tr.title)}>
                    <b>
                      ✓ {w.doneN(tr.hecho.count)}
                    </b>
                    {tr.hecho.last && <span>{tr.hecho.last}</span>}
                  </button>
                )}
              </div>
            </div>
          ))}
          {folded && folded.length > 0 && (
            <div className="sb-folded" data-folded={folded.length}>
              <span>
                {w.folded(folded.length)}
              </span>
              {folded.slice(0, FOLDED_MAX).map(chip)}
              {folded.length > FOLDED_MAX && (
                <details className="sb-more sb-folded-more">
                  <summary data-control="tablero-completas-mas">{w.plusMore(folded.length - FOLDED_MAX)}</summary>
                  <div className="sb-more-list">{folded.slice(FOLDED_MAX).map(chip)}</div>
                </details>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
};
