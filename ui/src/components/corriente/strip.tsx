// PLA-I62-3: inside a project the stream shrinks to a bar on top (board B1). PLA-I64-7: the doors (Archivo, Equipo,
// Máquinas) replace the seven work tabs. PLA-I3-2 (boards «En marcha», «En pausa»): the strip and the project's bar
// are one 56 px bar: back to Corriente; the project's mark and name as a switcher whose menu holds every project with
// its mini stream (a tick per stage: lit when work waits there, white where an agent works, amber where something
// waits on the owner); the doors Todo, Archivo, Equipo, Máquinas, Ajustes with their small counts; the project's
// state («En marcha» with Pausar, or «En pausa» alone). PLA-I3-6: no Pedir here; the bar at the foot is the only one.
// Reanudar lives under the sentence (todo.tsx) and Borrar in Ajustes. Words: @/lib/barra.
// PLA-I3-7: on a phone (corriente.css) back, the switcher and the state share the first row and the doors scroll
// sideways on a row of their own.
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Link } from "react-router";
import { DOORS, tabName, type Tab } from "@/lib/corriente";
import { STRIP } from "@/lib/corriente-parts-words";
import { COLUMNS, type Lane } from "@/lib/corriente-stream";
import { archivoCount, barState, peerTitle, switcherLabel, switcherMenu, teEspera, todoCount } from "@/lib/barra";
import { words } from "@/lib/i18n";
import { useFicha } from "./listas";
import { Logo } from "./parts";
import { MarcaCount } from "./marca";
import { marcaWords } from "@/lib/marca";

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
      aria-label={l.you.length > 0 ? `${l.title}${teEspera()}` : l.title}
      data-chip={l.slug}
      style={{ "--cor-speed": `${6 + (i % 3) * 2}s`, "--cor-delay": `-${i * 1.7}s` } as CSSProperties}
    >
      <span className="cor-chip-name">
        <Logo slug={l.slug} title={l.title} size="sm" />
        <span className="cor-ellipsis">{l.title}</span>
        {l.you.length > 0 && <span className="sr-only">{teEspera()}</span>}
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
export const Switcher = ({ slug, title, lanes, href, initialOpen = false, logoTo }: { slug: string; title: string; lanes: Lane[]; href: (slug: string) => string; initialOpen?: boolean; logoTo?: string }) => {
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
        {/* PLA-I66-2: the logo opens the project's Marca door; the name keeps the project switcher. */}
        {logoTo && (
          <Link to={logoTo} className="cor-switch-logo" aria-label={marcaWords().title(title)} data-control="abrir-marca">
            <Logo slug={slug} title={title} size="md" />
          </Link>
        )}
        <button ref={button} type="button" className="cor-switch-btn" aria-haspopup="menu" aria-expanded={open} aria-label={switcherLabel(title)} onClick={() => setOpen((o) => !o)} data-control="cambiar-proyecto">
          {!logoTo && <Logo slug={slug} title={title} size="md" />}
          <span className="cor-ellipsis">{title}</span>
          <Chevron d="M4.5 6.5 8 10l3.5-3.5" />
        </button>
      </h1>
      {open && (
        <ul className="cor-switch-menu" role="menu" aria-label={switcherMenu()} data-switcher>
          {lanes.map((l, i) => (
            <LaneItem key={l.slug} l={l} i={i} current={l.slug === slug} to={href(l.slug)} onPick={() => setOpen(false)} />
          ))}
        </ul>
      )}
    </div>
  );
};

/** PLA-I3-2: the strip on top, as it was: back to Corriente and one chip per project (its mark, its name and its
 *  mini stream), the open one marked. A chip opens that project on the same door. Chips keep a set width, so one
 *  project is not a bar-wide box. A phone hides the strip and keeps back and the switcher in the bar. */
export const Strip = ({ slug, lanes, href, back }: { slug: string; lanes: Lane[]; href: (slug: string) => string; back: string }) => (
  <nav className="cor-strip" aria-label={switcherMenu()} data-strip>
    <Link to={back} className="cor-strip-back" data-control="corriente">
      <Chevron d="M9.5 3.5 5 8l4.5 4.5" />
      {words(STRIP).corriente}
    </Link>
    <div className="cor-chips">
      {lanes.map((l, i) => (
        <Link
          key={l.slug}
          to={href(l.slug)}
          className={`cor-chip ${l.pace !== "live" ? "quiet" : ""}`}
          aria-current={l.slug === slug ? "page" : undefined}
          aria-label={peerTitle(l.title, l.you.length > 0)}
          data-chip={l.slug}
          style={{ "--cor-speed": `${6 + (i % 3) * 2}s`, "--cor-delay": `-${i * 1.7}s` } as CSSProperties}
        >
          <span className="cor-chip-name">
            <Logo slug={l.slug} title={l.title} size="sm" />
            <span className="cor-ellipsis">{l.title}</span>
          </span>
          <span className={`cor-mini ${l.pace === "off" ? "off" : ""}`} aria-hidden>
            {COLUMNS.map((c) => (
              <span key={c} className={`t ${l.you.some((y) => y.col === c) ? "yo" : l.agents.some((a) => a.col === c) ? "ag" : l.cells[c].length ? "on" : ""}`} />
            ))}
          </span>
        </Link>
      ))}
    </div>
  </nav>
);

export const BAR_DOORS =["todo", ...DOORS] as const;

/** PLA-I3-2: the project view's one bar. */
export const ProjectBar = ({
  slug,
  title,
  lanes,
  tab,
  href,
  projectHref,
  back,
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
  const w = words(STRIP);
  const on = (t: Tab) => tab === t || (t === "equipo" && tab === "motores") || (t === "todo" && tab === "hecho");
  const state = barState(paused);
  const todo = open === undefined ? null : todoCount(open);
  return (
    <>
    <Strip slug={slug} lanes={lanes} href={projectHref} back={back} />
    <header className="cor-topbar" data-bar={slug}>
      {/* The strip above carries the way back; a phone has no strip and keeps it here. */}
      <Link to={back} className="cor-strip-back" data-control="corriente-tel">
        <Chevron d="M9.5 3.5 5 8l4.5 4.5" />
        {/* PLA-I3-7: a phone shows the chevron alone; the word stays the link's name. */}
        <span className="cor-strip-back-t">{w.corriente}</span>
      </Link>
      <Switcher slug={slug} title={title} lanes={lanes} href={projectHref} initialOpen={switcherOpen} logoTo={href("marca")} />
      <nav className="cor-doors" aria-label={w.doorsOf(title)}>
        {BAR_DOORS.map((t) => (
          <Link key={t} to={href(t)} className="cor-door" aria-current={on(t) ? "page" : undefined} data-door={t} data-tab={t}>
            {tabName(t)}
            {t === "todo" && todo && <span className="n">{todo}</span>}
            {t === "archivo" && <ArchivoCount slug={slug} />}
            {t === "equipo" && team && <span className="n">{team}</span>}
            {t === "marca" && <MarcaCount slug={slug} />}
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
      </div>
    </header>
    </>
  );
};
