// PLA-I62-3: inside a project the stream shrinks to a bar on top (board B1). PLA-I64-7: the doors (Equipo,
// Máquinas) replace the seven work tabs. PLA-I3-2 (boards «En marcha», «En pausa»): the strip and the project's bar
// are one 56 px bar: back to Corriente; the project's mark and name as a switcher whose menu holds every project with
// its mini stream (a tick per stage: lit when work waits there, white where an agent works, amber where something
// waits on the owner); the doors Todo, Equipo, Máquinas, Ajustes with their small counts; the project's
// state («En marcha» with Pausar, or «En pausa» alone). PLA-I3-6: no Pedir here; the bar at the foot is the only one.
// Reanudar lives under the sentence (todo.tsx) and Borrar in Ajustes. Words: @/lib/barra.
// PLA-I3-7: on a phone (corriente.css) back, the switcher and the state share the first row and the doors scroll
// sideways on a row of their own.
import { doorState, findings } from "@/lib/camino";
import { useCamino } from "./camino-query";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Link } from "react-router";
import { DOORS, tabName, type Tab } from "@/lib/corriente";
import { STRIP } from "@/lib/corriente-parts-words";
import { COLUMNS, type Lane } from "@/lib/corriente-stream";
import { barState, peerTitle, switcherMenu, teEspera, todoCount } from "@/lib/barra";
import { words } from "@/lib/i18n";
import { Logo } from "./parts";
import { MarcaCount } from "./marca";
import { marcaWords } from "@/lib/marca";

const Chevron = ({ d }: { d: string }) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={d} />
  </svg>
);

/** PLA-I68-2: Camino's dot and its word: «N POR RESOLVER» or «LISTO». */
const CaminoCount = ({ slug }: { slug: string }) => {
  const q = useCamino(slug);
  if (!q.data) return null;
  const s = doorState(findings(q.data, new Date()));
  return (
    <span className={`n cam-door-n ${s.dot}`} data-camino-count={s.n}>
      <i className={`cam-dot ${s.dot}`} aria-hidden />
      {s.text}
    </span>
  );
};

/** PLA-129: the project's name is a link to its home (Todo), not a switcher; the strip above switches projects (on a
 *  phone, back to Corriente). The logo beside it opens Marca (PLA-I66-2). */
export const ProjectName = ({ slug, title, todoTo, logoTo }: { slug: string; title: string; todoTo: string; logoTo?: string }) => (
  <div className="cor-switch">
    <h1 className="cor-switch-h">
      {logoTo && (
        <Link to={logoTo} className="cor-switch-logo" aria-label={marcaWords().title(title)} data-control="abrir-marca">
          <Logo slug={slug} title={title} size="md" />
        </Link>
      )}
      <Link to={todoTo} className="cor-switch-btn" data-control="abrir-todo">
        {!logoTo && <Logo slug={slug} title={title} size="md" />}
        <span className="cor-ellipsis">{title}</span>
      </Link>
    </h1>
  </div>
);

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
}: {
  slug: string;
  title: string;
  /** Every project, as the stream draws them (the strip above).  */
  lanes: Lane[];
  tab: Tab;
  href: (t: Tab) => string;
  /** Where a project in the strip opens (the same door). */
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
      <ProjectName slug={slug} title={title} todoTo={href("todo")} logoTo={href("marca")} />
      <nav className="cor-doors" aria-label={w.doorsOf(title)}>
        {BAR_DOORS.map((t) => (
          <Link key={t} to={href(t)} className="cor-door" aria-current={on(t) ? "page" : undefined} data-door={t} data-tab={t}>
            {tabName(t)}
            {t === "todo" && todo && <span className="n">{todo}</span>}
            {t === "equipo" && team && <span className="n">{team}</span>}
            {t === "marca" && <MarcaCount slug={slug} />}
            {t === "camino" && <CaminoCount slug={slug} />}
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
