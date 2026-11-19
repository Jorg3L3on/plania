// PLA-I62-3: inside a project the stream shrinks to a bar on top (board B1). PLA-I64-7: the doors (Archivo, Equipo,
// Máquinas) replace the seven work tabs. PLA-I3-2 (boards «En marcha», «En pausa»): the strip and the project's bar
// are one 56 px bar: back to Corriente; the project's mark and name as a switcher whose menu holds every project with
// its mini stream (a tick per stage: lit when work waits there, white where an agent works, amber where something
// waits on the owner); the doors Todo, Archivo, Equipo, Máquinas, Ajustes with their small counts; the project's
// state («En marcha» with Pausar, or «En pausa» alone); and Pedir (secondary, phase 6 moves it). Reanudar lives under
// the sentence (todo.tsx) and Borrar in Ajustes. Words: @/lib/barra.
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Link } from "react-router";
import { DOORS, TAB_NAME, type Tab } from "@/lib/corriente";
import { COLUMNS, type Lane } from "@/lib/corriente-stream";
import { SWITCHER_MENU, TE_ESPERA, archivoCount, barState, switcherLabel, todoCount } from "@/lib/barra";
import { useFicha } from "./listas";
import { Logo } from "./parts";

const Chevron = ({ d }: { d: string }) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={d} />
  </svg>
);

/** Archivo's count beside its door, from the ficha's counts. */
const ArchivoCount = ({ slug }: { slug: string }) => {
  const f = useFicha(slug);
  if (!f.data) return null;
  return <span className="n">{archivoCount(f.data.counts.docs, f.data.counts.prs)}</span>;
};

/** One project in the switcher's menu: its mark and name, and its mini stream. */
const LaneItem = ({ l, i, current, to, onPick }: { l: Lane; i: number; current: boolean; to: string; onPick: () => void }) => (
  <li role="none">
    <Link
      role="menuitem"
      to={to}
      onClick={onPick}
      className={`cor-chip ${l.pace !== "live" ? "quiet" : ""}`}
      aria-current={current ? "page" : undefined}
      aria-label={l.you.length > 0 ? `${l.title}${TE_ESPERA}` : l.title}
      data-chip={l.slug}
      style={{ "--cor-speed": `${6 + (i % 3) * 2}s`, "--cor-delay": `-${i * 1.7}s` } as CSSProperties}
    >
      <span className="cor-chip-name">
        <Logo slug={l.slug} title={l.title} size="sm" />
        <span className="cor-ellipsis">{l.title}</span>
        {l.you.length > 0 && <span className="sr-only">{TE_ESPERA}</span>}
      </span>
      <span className={`cor-mini ${l.pace === "off" ? "off" : ""}`} aria-hidden>
        {COLUMNS.map((c) => (
          <span key={c} className={`t ${l.you.some((y) => y.col === c) ? "yo" : l.agents.some((a) => a.col === c) ? "ag" : l.cells[c].length ? "on" : ""}`} />
        ))}
      </span>
    </Link>
  </li>
);

/** The project's name as a button; its menu lists the projects in the order ↑/↓ walks them. */
export const Switcher = ({ slug, title, lanes, href, initialOpen = false }: { slug: string; title: string; lanes: Lane[]; href: (slug: string) => string; initialOpen?: boolean }) => {
  const [open, setOpen] = useState(initialOpen);
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    // Esc closes the menu before the page's Esc steps out of the project (capture, so the page never sees it).
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      setOpen(false);
      button.current?.focus();
    };
    const onDown = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [open]);
  // A new project closes the menu.
  useEffect(() => setOpen(false), [slug]);
  return (
    <div className="cor-switch" ref={box}>
      <h1 className="cor-switch-h">
        <button ref={button} type="button" className="cor-switch-btn" aria-haspopup="menu" aria-expanded={open} aria-label={switcherLabel(title)} onClick={() => setOpen((o) => !o)} data-control="cambiar-proyecto">
          <Logo slug={slug} title={title} size="md" />
          <span className="cor-ellipsis">{title}</span>
          <Chevron d="M4.5 6.5 8 10l3.5-3.5" />
        </button>
      </h1>
      {open && (
        <ul className="cor-switch-menu" role="menu" aria-label={SWITCHER_MENU} data-switcher>
          {lanes.map((l, i) => (
            <LaneItem key={l.slug} l={l} i={i} current={l.slug === slug} to={href(l.slug)} onPick={() => setOpen(false)} />
          ))}
        </ul>
      )}
    </div>
  );
};

export const BAR_DOORS = ["todo", ...DOORS] as const;

/** PLA-I3-2: the project view's one bar. */
export const ProjectBar = ({
  slug,
  title,
  lanes,
  tab,
  href,
  projectHref,
  back,
  pedirTo,
  team,
  open,
  paused,
  pauseHref,
  switcherOpen,
}: {
  slug: string;
  title: string;
  /** Every project, as the stream draws them (the switcher's menu). */
  lanes: Lane[];
  tab: Tab;
  href: (t: Tab) => string;
  /** Where a project in the switcher opens (the same door). */
  projectHref: (slug: string) => string;
  /** La corriente. */
  back: string;
  pedirTo: string;
  /** Equipo's word: «4 LIBRES», «2 TRABAJANDO», «EN PAUSA». */
  team?: string;
  /** Todo's count: the project's open things. */
  open?: number;
  paused: boolean;
  /** Pausar's sheet (shown only while running). */
  pauseHref: string;
  /** Tests: draw the switcher's menu open. */
  switcherOpen?: boolean;
}) => {
  const on = (t: Tab) => tab === t || (t === "equipo" && tab === "motores") || (t === "todo" && tab === "hecho");
  const state = barState(paused);
  const todo = open === undefined ? null : todoCount(open);
  return (
    <header className="cor-topbar" data-bar={slug}>
      <Link to={back} className="cor-strip-back" data-control="corriente">
        <Chevron d="M9.5 3.5 5 8l4.5 4.5" />
        Corriente
      </Link>
      <Switcher slug={slug} title={title} lanes={lanes} href={projectHref} initialOpen={switcherOpen} />
      <nav className="cor-doors" aria-label={`Puertas de ${title}`}>
        {BAR_DOORS.map((t) => (
          <Link key={t} to={href(t)} className="cor-door" aria-current={on(t) ? "page" : undefined} data-door={t} data-tab={t}>
            {TAB_NAME[t]}
            {t === "todo" && todo && <span className="n">{todo}</span>}
            {t === "archivo" && <ArchivoCount slug={slug} />}
            {t === "equipo" && team && <span className="n">{team}</span>}
          </Link>
        ))}
      </nav>
      <div className="cor-topbar-end">
        <span className={`cor-topbar-state ${paused ? "off" : "on"}`} data-estado={paused ? "pausa" : "marcha"}>
          <i aria-hidden />
          {state.label}
        </span>
        {state.pausar && (
          <Link className="cor-btn secondary small" to={pauseHref} data-control="pausar">
            {state.pausar}
          </Link>
        )}
        <Link to={pedirTo} className="cor-btn secondary small" data-pedir>
          Pedir
        </Link>
      </div>
    </header>
  );
};
