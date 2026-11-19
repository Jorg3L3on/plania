// PLA-I64-2: a thing's thread, small (PLA-IDEA27's hilo, the row size): six idea stops, the «Constrúyelo» valve, one
// segment per step of its construction, Published. One piece, reused by the project's list and (PLA-I65) the ficha.
// Decorative: the row says the same in words (its caps line and «qué toca»).
// PLA-I3-4: given onOpen, the construction segments are buttons in a toolbar (one tab stop per row, ←/→ inside it,
// ↑/↓ to the same step of the row above or below), each with a tooltip that names the step. The rest of the thread
// (idea stops, valve, end dot) stays decorative. Without onOpen (small threads, Hecho rows, the ghost row) all of it is.
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { PARADAS, paradaName, paradaShort, type Hilo as HiloT, type Tramo, type TramoTono } from "@/lib/cosas";
import { firstOpen, rovingNext, tramoTip, tramoWords } from "@/lib/tramo";

const cls = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(" ");

const Stop = ({ i, h }: { i: number; h: HiloT }) => {
  if (h.idea === null) return <span aria-hidden />;
  if (i < h.idea) return <span aria-hidden><i className="cor-h-d" /></span>;
  if (i > h.idea) return <span aria-hidden><i className="cor-h-r" /></span>;
  const t = h.ideaTono;
  return <span aria-hidden>{t === "toca" ? <i className="cor-h-y" /> : t === "vivo" ? <i className="cor-h-a" /> : t === "quieto" ? <i className="cor-h-r on" /> : <i className="cor-h-d" />}</span>;
};

const SEG: Record<TramoTono, string> = { hecho: "on", vivo: "live", toca: "you", fila: "fila", quieto: "" };

/** PLA-I3-4: the tooltip waits this long before the first step shows it; once one shows, its neighbours show at once. */
export const TIP_DELAY_MS = 50;
/** How long after a tooltip hides the next one still shows at once (moving to the next row's steps). */
const TIP_WARM_MS = 300;
let warmUntil = 0;

type Tip = { i: number; el: HTMLElement };

const TramoTooltip = ({ t, i, n, el }: { t: Tramo; i: number; n: number; el: HTMLElement }) => {
  const ref = useRef<HTMLDivElement>(null);
  const tip = tramoTip(t, i, n);
  // Above the step; below it when the window has no room above (the list's first row). Fixed on <body>, so the list's
  // scroll box never clips it; kept inside the window sideways.
  useLayoutEffect(() => {
    const box = ref.current;
    if (!box) return;
    const r = el.getBoundingClientRect();
    const bar = el.firstElementChild?.getBoundingClientRect() ?? r;
    const w = box.offsetWidth;
    const hgt = box.offsetHeight;
    const left = Math.min(window.innerWidth - 8 - w, Math.max(8, r.left + r.width / 2 - w / 2));
    const above = bar.top - 10 - hgt >= 8;
    box.style.left = `${left}px`;
    box.style.top = `${above ? bar.top - 10 - hgt : bar.bottom + 10}px`;
    box.dataset.place = above ? "above" : "below";
    box.style.visibility = "visible";
  });
  return createPortal(
    <div ref={ref} className={cls("cor-tip", t.tono)} aria-hidden data-tip={t.key} style={{ visibility: "hidden" }}>
      <span className="cor-tip-top">
        <span className="cor-tip-key">{tip.key}</span>
        <span className="cor-tip-pos">{tip.pos}</span>
      </span>
      <b className="cor-tip-t">{tip.title}</b>
      <span className="cor-tip-st">
        <i aria-hidden />
        {tip.state}
      </span>
      <span className="cor-tip-hint">{tip.hint}</span>
    </div>,
    document.body,
  );
};

/** The construction segments as buttons. */
const Pasos = ({ tramos, fin, label, onOpen, openKey }: { tramos: Tramo[]; fin: boolean; label: string; onOpen: (key: string) => void; openKey?: string | null }) => {
  const [active, setActive] = useState(() => firstOpen(tramos));
  const [tip, setTip] = useState<Tip | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const hovering = useRef(false);
  const n = tramos.length;
  const at = Math.min(active, n - 1);
  const show = (i: number, el: HTMLElement, wait: boolean) => {
    window.clearTimeout(timer.current);
    if (!wait || Date.now() < warmUntil || tip) setTip({ i, el });
    else timer.current = window.setTimeout(() => setTip({ i, el }), TIP_DELAY_MS);
  };
  const hide = () => {
    window.clearTimeout(timer.current);
    if (tip) warmUntil = Date.now() + TIP_WARM_MS;
    setTip(null);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);
  // A scroll moves the step away from its tooltip: hide it.
  useEffect(() => {
    if (!tip) return;
    const off = () => hide();
    window.addEventListener("scroll", off, true);
    return () => window.removeEventListener("scroll", off, true);
  });
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    if (e.key === "Escape") return hide();
    const bar = e.currentTarget.parentElement;
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      // The same step (or the last one) of the next or previous row with steps, in the list's order.
      const scope = bar?.closest(".cor-todo-list") ?? document;
      const bars = [...scope.querySelectorAll<HTMLElement>("[data-pasos]")];
      const next = bars[bars.indexOf(bar as HTMLElement) + (e.key === "ArrowDown" ? 1 : -1)];
      if (!next) return;
      e.preventDefault();
      const bs = next.querySelectorAll<HTMLButtonElement>("button");
      bs[Math.min(i, bs.length - 1)]?.focus();
      return;
    }
    const j = rovingNext(e.key, i, n);
    if (j === null) return;
    e.preventDefault();
    bar?.querySelectorAll<HTMLButtonElement>("button")[j]?.focus();
  };
  return (
    <span
      className="cor-h-sg pasos"
      role="toolbar"
      aria-label={label}
      data-pasos={n}
      onPointerEnter={() => (hovering.current = true)}
      onPointerLeave={() => {
        hovering.current = false;
        hide();
      }}
    >
      {tramos.map((t, i) => {
        const tt = tramoTip(t, i, n);
        return (
          <button
            key={t.key}
            type="button"
            className={cls("cor-paso", tip?.i === i && "on", openKey === t.key && "open")}
            tabIndex={i === at ? 0 : -1}
            aria-pressed={openKey === undefined ? undefined : openKey === t.key}
            aria-label={tt.aria}
            data-paso={t.key}
            data-tono={t.tono}
            onClick={() => onOpen(t.key)}
            onPointerEnter={(e) => show(i, e.currentTarget, true)}
            onFocus={(e) => {
              setActive(i);
              show(i, e.currentTarget, true);
            }}
            onBlur={() => {
              if (!hovering.current) hide();
            }}
            onKeyDown={(e) => onKey(e, i)}
          >
            <i className={(fin ? "fin" : SEG[t.tono]) || undefined} />
          </button>
        );
      })}
      {tip && tramos[tip.i] && <TramoTooltip t={tramos[tip.i]!} i={tip.i} n={n} el={tip.el} />}
    </span>
  );
};

/** PLA-I3-5: openKey is the step open in the panel beside the list (its button is pressed and ringed); undefined
 *  where steps do not open a panel (no aria-pressed at all). */
export const Hilo = ({ h, small, onOpen, label = tramoWords().steps, openKey }: { h: HiloT; small?: boolean; onOpen?: (key: string) => void; label?: string; openKey?: string | null }) => {
  const valve = h.valvula;
  const fin = h.publicado;
  const segs = h.tramos.length ? h.tramos.map((t) => (fin ? "fin" : SEG[t.tono])) : valve === "atorada" || valve === "toca" || valve === "pasando" ? ["", "", ""] : [];
  const live = !small && !!onOpen && h.tramos.length > 0;
  return (
    <span className={cls("cor-hilo", h.idea === null && "born", small && "sm", live && "act", h.tramos.some((t) => t.tono === "vivo") || valve === "pasando" ? "flow" : null)} aria-hidden={live ? undefined : true} data-hilo={h.at}>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <Stop key={i} i={i} h={h} />
      ))}
      <span aria-hidden>{h.idea === null && valve === "abierta" && !h.tramos.length ? null : <i className={cls("cor-h-v", valve === "toca" || valve === "atorada" ? "wait" : valve === "pasando" || valve === "abierta" ? "on" : null)} />}</span>
      <span className="cor-h-c">
        {valve === "atorada" && <i className="cor-h-y" aria-hidden />}
        {live ? (
          <Pasos tramos={h.tramos} fin={fin} label={label} onOpen={onOpen!} openKey={openKey} />
        ) : (
          segs.length > 0 && (
            <span className="cor-h-sg">
              {segs.map((s, i) => (
                <i key={i} className={s || undefined} />
              ))}
            </span>
          )
        )}
      </span>
      <span aria-hidden>{fin ? <i className="cor-h-e" /> : <i className="cor-h-r" />}</span>
    </span>
  );
};

// PLA-62: the short names. PLA-I3-3: the idea stops and Publicado are ~46 px wide at any width, so they always show
// paradaShort() (lib/cosas.ts); construction has the room and spells its full name.
/** PLA-109 (guided test PLA-86, F-41): in a narrow pane each stop is ~25 px and even the short names ran into each
 * other («BUZÓNENTEND.INVEST.»); there the header shows three letters, switched by the header's own width. */
export const TINY = (p: (typeof PARADAS)[number]): string => paradaName(p).normalize("NFD").replace(/[\u0300-\u036f]/g, "").slice(0, 3);

/** The list's header: the nine stops' names over the threads. */
export const HiloHead = () => (
  <span className="cor-hilo-wrap" aria-hidden>
    <span className="cor-hilo head">
      {PARADAS.map((p) =>
        p === "valvula" ? (
          <span key={p} />
        ) : (
          <span key={p} title={paradaName(p)}>
            <span className="l">{paradaName(p)}</span>
            <span className="s">{paradaShort(p)}</span>
            <span className="t">{TINY(p)}</span>
          </span>
        ),
      )}
    </span>
  </span>
);
