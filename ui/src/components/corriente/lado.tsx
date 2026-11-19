// PLA-I3-5 (board «Un paso abierto»): a step of a row's thread opens in a panel beside the list, 480 px on the right,
// from under the project's bar to above the Pedir bar. The list behind stays usable (no scrim). Head: the key, «PASO n
// DE m», previous and next (inert at the ends), the full step and Cerrar; the initiative's steps as a strip; the state;
// the title; the summary; «Qué espera»; the initiative and the priority; «Abrir el paso». ←/→ move while focus is in
// the panel; Esc closes it and focus goes back to the step's button in its row. Words in lib/lado.ts.
// On a phone (639 px and under) there is no panel: the step's click goes to the step. PLA-I3-7: there an initiative's
// card shows its steps as one control that opens a sheet of them (tramos.tsx).
import { useEffect, useLayoutEffect, useRef, type KeyboardEvent } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { api, type Etapa } from "@/lib/api";
import type { Tramo } from "@/lib/cosas";
import { ladoMove, ladoOf, ladoWords, prioridadWord } from "@/lib/lado";
import { tramoTip } from "@/lib/tramo";
import { Label } from "./parts";

// PLA-I2-10: the panel's words in the screen's language (fixed for the page's life).
const LW = ladoWords();

const cls = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(" ");

/** PLA-I3-5: the panel is drawn only above this width; under it a step's click goes to the step. */
export const LADO_MIN_PX = 640;
export const ladoFits = () => typeof window === "undefined" || !window.matchMedia || !window.matchMedia(`(max-width: ${LADO_MIN_PX - 1}px)`).matches;

/** The step's button in its row (the list's thread), if the row shows. */
const rowButton = (k: string) => document.querySelector<HTMLButtonElement>(`.cor-todo-list [data-pasos] button[data-paso="${CSS.escape(k)}"]`);

export type LadoLinks = { full: (k: string) => string; iniciativa: (k: string) => string };

const Arrow = ({ d }: { d: string }) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={d} />
  </svg>
);

export const PasoLado = ({
  slug,
  k,
  tramos,
  etapa,
  iniciativa,
  links,
  onMove,
  onClose,
  now,
}: {
  slug: string;
  k: string;
  /** The row's steps (an initiative's, or the loose step alone). */
  tramos: Tramo[];
  etapa: Etapa | null;
  iniciativa: { key: string; title: string } | null;
  links: LadoLinks;
  onMove: (k: string) => void;
  onClose: () => void;
  now?: number;
}) => {
  const ref = useRef<HTMLElement>(null);
  const open = useRef(k);
  open.current = k;
  // The summary and the priority are not in the list's read: the step's own read (the one the Paso view uses, so the
  // cache is shared).
  const q = useQuery({ queryKey: ["task", slug, k], queryFn: () => api.task(slug, k), staleTime: 30_000 });
  const l = ladoOf(k, tramos, etapa, now);
  // Focus comes into the panel when it opens (so ←/→ and Esc work at once).
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, []);
  // When it closes (Esc, Cerrar, Back) with focus inside, focus goes back to the open step's button in its row.
  useLayoutEffect(() => {
    const root = ref.current;
    return () => {
      const had = !!root && (root.contains(document.activeElement) || document.activeElement === document.body);
      const key = open.current;
      // Not when the panel is still there (React's dev double mount, or another step opened in its place).
      if (had) window.requestAnimationFrame(() => !document.querySelector("[data-lado]") && rowButton(key)?.focus());
    };
  }, []);
  const onKey = (e: KeyboardEvent<HTMLElement>) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    if (!l) return;
    const t = e.target as HTMLElement;
    if (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName)) return;
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    // The page's own keys never see an arrow pressed here.
    e.preventDefault();
    e.stopPropagation();
    const to = ladoMove(e.key, l);
    if (to) onMove(to);
  };
  const t = q.data;
  return (
    <aside ref={ref} className="cor-lado" tabIndex={-1} aria-label={l ? `${l.key}: ${l.title}` : k} onKeyDown={onKey} data-lado={k}>
      <div className="cor-lado-head">
        <span className="cor-key">{k}</span>
        {l && <span className="cor-label">{l.pos}</span>}
        <span className="cor-lado-nav">
          <button type="button" className="cor-lado-ic" aria-label={LW.prev} aria-disabled={!l?.prev} onClick={() => l?.prev && onMove(l.prev)} data-control="lado-prev">
            <Arrow d="M9.5 3.5 5 8l4.5 4.5" />
          </button>
          <button type="button" className="cor-lado-ic" aria-label={LW.next} aria-disabled={!l?.next} onClick={() => l?.next && onMove(l.next)} data-control="lado-next">
            <Arrow d="M6.5 3.5 11 8l-4.5 4.5" />
          </button>
          <Link to={links.full(k)} className="cor-lado-ic" aria-label={LW.full} title={LW.full} data-control="lado-full">
            <Arrow d="M6 3.5h6.5V10M12.5 3.5 4 12" />
          </Link>
          <button type="button" className="cor-lado-ic" aria-label={LW.close} onClick={onClose} data-control="lado-close">
            <Arrow d="M4 4l8 8M12 4l-8 8" />
          </button>
        </span>
      </div>
      <div className="cor-lado-body">
        {tramos.length > 1 && (
          <div className="cor-lado-strip" role="group" aria-label={LW.strip}>
            {tramos.map((s, i) => (
              <button key={s.key} type="button" className={cls("cor-lado-sg", s.tono, s.key === k && "open")} aria-current={s.key === k ? "step" : undefined} aria-label={tramoTip(s, i, tramos.length, now).aria} onClick={() => s.key !== k && onMove(s.key)} data-lado-paso={s.key}>
                <i aria-hidden />
              </button>
            ))}
          </div>
        )}
        {l ? (
          <>
            <p className="cor-lado-st" data-lado-st>
              <i className={cls("cor-lado-sq", l.tono)} aria-hidden />
              <span className="cor-lado-word">{l.word}</span>
              {l.who && <span className="cor-muted">{l.who}</span>}
            </p>
            <h2 className="cor-h2 cor-lado-t">{l.title}</h2>
          </>
        ) : (
          <h2 className="cor-h2 cor-lado-t">{t?.title ?? k}</h2>
        )}
        {q.isError ? (
          <p className="cor-text cor-muted">{LW.readFailed}</p>
        ) : !t ? (
          <div className="cor-skel" style={{ height: 44 }} role="status" aria-busy="true" aria-label={LW.reading} />
        ) : (
          t.summary && <p className="cor-text cor-lado-sum">{t.summary}</p>
        )}
        {l && (
          <section className="cor-lado-espera" aria-label={LW.espera}>
            <Label as="h3" tone={l.tono === "toca" ? "amber" : undefined}>
              {LW.espera}
            </Label>
            <p className="cor-text">{l.espera}</p>
          </section>
        )}
        <dl className="cor-lado-dl">
          <div>
            <dt className="cor-label">{LW.iniciativa}</dt>
            <dd>
              {iniciativa ? (
                <Link to={links.iniciativa(iniciativa.key)} className="cor-lado-ini" data-control="lado-iniciativa">
                  <span className="cor-key">{iniciativa.key}</span>
                  <span className="cor-ellipsis">{iniciativa.title}</span>
                </Link>
              ) : (
                <span className="cor-muted">{LW.suelto}</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="cor-label">{LW.prioridad}</dt>
            <dd>{t ? prioridadWord(t.priority) : "…"}</dd>
          </div>
        </dl>
        <div className="cor-lado-abrir">
          <Link to={links.full(k)} className="cor-btn secondary" data-control="lado-abrir">
            {LW.abrir}
          </Link>
          <span className="cor-cap">{LW.abrirCap}</span>
        </div>
      </div>
      <p className="cor-lado-foot cor-cap" aria-hidden>
        {LW.keys}
      </p>
    </aside>
  );
};
