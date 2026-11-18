// PLA-I62-3: inside a project the stream shrinks to a strip on top (board B1): back to Corriente, one chip per project
// with its mini stream (a tick per stage: lit when work waits there, white where an agent works, amber where something
// waits on the owner), the open one marked, and Pedir (secondary). Under it, one row: the project's logo and name,
// PLA-I64-7: the doors (Archivo, Equipo, Máquinas) and Pausar or Reanudar; the seven work tabs are retired.
import type { CSSProperties } from "react";
import { Link } from "react-router";
import { DOORS, TAB_NAME, type Tab } from "@/lib/corriente";
import { COLUMNS, type Lane } from "@/lib/corriente-stream";
import { useFicha } from "./listas";
import { Logo } from "./parts";

export const Strip = ({ lanes, open, href, back, pedirTo }: { lanes: Lane[]; open: string; href: (slug: string) => string; back: string; pedirTo: string }) => (
  <nav className="cor-strip" aria-label="La corriente, en tira" data-strip>
    <Link to={back} className="cor-strip-back" data-control="corriente">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M9.5 3.5 5 8l4.5 4.5" />
      </svg>
      Corriente
    </Link>
    <div className="cor-chips" style={{ "--n": Math.max(lanes.length, 1) } as CSSProperties}>
      {lanes.map((l, i) => (
        <Link key={l.slug} to={href(l.slug)} className={`cor-chip ${l.pace !== "live" ? "quiet" : ""}`} aria-current={l.slug === open ? "page" : undefined} data-chip={l.slug} style={{ "--cor-speed": `${6 + (i % 3) * 2}s`, "--cor-delay": `-${i * 1.7}s` } as CSSProperties}>
          <span className="cor-chip-name">
            <Logo slug={l.slug} title={l.title} size="sm" />
            <span className="cor-ellipsis">{l.title}</span>
            {l.you.length > 0 && <span className="sr-only">, te espera</span>}
          </span>
          <span className={`cor-mini ${l.pace === "off" ? "off" : ""}`} aria-hidden>
            {COLUMNS.map((c) => (
              <span key={c} className={`t ${l.you.some((y) => y.col === c) ? "yo" : l.agents.some((a) => a.col === c) ? "ag" : l.cells[c].length ? "on" : ""}`} />
            ))}
          </span>
        </Link>
      ))}
    </div>
    <Link to={pedirTo} className="cor-btn secondary" data-pedir>
      Pedir
    </Link>
  </nav>
);

export type BarMeta = { text: string; missing: boolean; href: string };

/** Archivo's count beside its door («24 DOCS · 38 PRS»), from the ficha's counts. */
const ArchivoCount = ({ slug }: { slug: string }) => {
  const f = useFicha(slug);
  if (!f.data) return null;
  const { docs, prs } = f.data.counts;
  return <span className="n">{docs + prs === 0 ? "VACÍO" : `${docs} ${docs === 1 ? "DOC" : "DOCS"} · ${prs} ${prs === 1 ? "PR" : "PRS"}`}</span>;
};

/** PLA-I64-7: the project's bar. Its name, its goal (or, behind a door, the way back to the list), then the doors
 *  Archivo, Equipo (Motores opens from there) and Máquinas, and Pausar or Reanudar. */
export const ProjectBar = ({
  slug,
  title,
  tab,
  href,
  meta,
  back,
  team,
  paused,
  pauseHref,
}: {
  slug: string;
  title: string;
  tab: Tab;
  href: (t: Tab) => string;
  meta?: BarMeta;
  back?: { href: string; label: string };
  /** Equipo's word: «4 LIBRES», «2 TRABAJANDO», «EN PAUSA». */
  team?: string;
  paused: boolean;
  pauseHref: string;
}) => {
  const on = (t: Tab) => tab === t || (t === "equipo" && tab === "motores");
  return (
    <div className="cor-pbar" data-pbar={slug}>
      <h1 className="cor-pname">
        <Logo slug={slug} title={title} size="md" />
        {title}
      </h1>
      {back && (
        <Link to={back.href} className="cor-btn link cor-pbar-back" data-control="volver-todo">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M9.5 3.5 5 8l4.5 4.5" />
          </svg>
          {back.label}
        </Link>
      )}
      {meta && (
        <div className="cor-pmeta" data-pmeta>
          <span className="cor-label">Meta</span>
          <span className="cor-ellipsis cor-pmeta-tx">{meta.text}</span>
          <Link to={meta.href} className="cor-btn link" data-control="fijar">
            {meta.missing ? "Fijar meta" : "Cambiar meta"}
          </Link>
        </div>
      )}
      <nav className="cor-doors" aria-label={`Puertas de ${title}`}>
        {DOORS.map((t) => (
          <Link key={t} to={href(t)} className="cor-door" aria-current={on(t) ? "page" : undefined} data-door={t} data-tab={t}>
            {TAB_NAME[t]}
            {t === "archivo" && <ArchivoCount slug={slug} />}
            {t === "equipo" && team && <span className="n">{team}</span>}
          </Link>
        ))}
        {paused ? (
          <Link className="cor-btn secondary" to={pauseHref} data-control="reanudar">
            {`Reanudar ${title}`}
          </Link>
        ) : (
          <Link className="cor-door" to={pauseHref} data-control="pausar">
            Pausar
          </Link>
        )}
      </nav>
    </div>
  );
};
