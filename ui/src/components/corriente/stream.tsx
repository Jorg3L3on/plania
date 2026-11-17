// PLA-I62-2: La corriente, Compañía's first screen (board A1). What happens now and the three totals, then one lane
// per project across seven stages with the light flowing through it: a violet dot per piece of work waiting in its
// stage (a count when there are many), a white haloed dot for an agent working (its seat, its paso and what it does),
// an amber rhombus where something waits on the owner. A paused lane is dark with Reanudar; a lane where nobody works
// says why. The Pedir bar sits at the bottom with the page's one white button.
import { Fragment, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router";
import type { Decision } from "@/lib/api";
import { thousands } from "@/lib/corriente";
import { COLUMNS, COLUMN_NAME, type Column, type Lane, type Totals } from "@/lib/corriente-stream";
import { Agent, Btn, Dot, Label, Logo, You } from "./parts";

export type StreamLinks = {
  project: (slug: string) => string;
  agent: (slug: string, agent: string) => string;
  you: (slug: string, d: Decision) => string;
  /** An action of the server's "why nobody works" (a path, or a #hash this screen handles). */
  reason: (slug: string, href: string) => string;
};

const MAX_DOTS = 3;
// Each lane breathes at its own speed so the stream never moves in lockstep.
const SPEEDS = [7, 9, 6, 5.5, 8, 6.5, 10, 7.5];

const Cell = ({ lane, col, links, revisionCount }: { lane: Lane; col: Column; links: StreamLinks; revisionCount: number }) => {
  const work = lane.cells[col];
  const agents = lane.agents.filter((a) => a.col === col);
  const you = lane.you.filter((y) => y.col === col);
  // The work an agent is on is drawn as the agent, not as a dot too.
  const busy = new Set(agents.map((a) => a.key));
  const dots = work.filter((w) => !busy.has(w.key));
  const showDots = agents.length === 0 && you.length === 0 ? dots : dots.slice(0, 2);
  return (
    <div className="cor-cell" data-col={col} data-n={work.length}>
      {showDots.length > MAX_DOTS ? (
        <span className="cor-cell-n" aria-label={`${showDots.length} en ${COLUMN_NAME[col]}`}>
          <Dot />
          {showDots.length}
        </span>
      ) : (
        showDots.map((w) => <Dot key={w.key} grey={w.grey} />)
      )}
      {agents.slice(0, 1).map((a) => (
        <Link key={a.agent} to={links.agent(lane.slug, a.agent)} className="cor-tag-link" data-agent={a.agent}>
          <Agent />
          <span className="cor-tag">
            <b>{a.seat}</b>
            <span>{[a.key, a.doing].filter(Boolean).join(" · ") || "trabajando"}</span>
          </span>
        </Link>
      ))}
      {agents.length > 1 && <span className="cor-cell-more">+{agents.length - 1}</span>}
      {you.slice(0, 1).map((y) => (
        <Link key={y.decision.id} to={links.you(lane.slug, y.decision)} className="cor-tag-link" data-you={y.decision.id}>
          <You />
          <span className="cor-tag amber">
            <b>{y.verb}</b>
            <span>{you.length > 1 ? `y ${you.length - 1} más` : col === "revision" ? `${revisionCount} en revisión` : y.decision.title}</span>
          </span>
        </Link>
      ))}
    </div>
  );
};

export const StreamLane = ({ lane, i, links, onResume, resuming }: { lane: Lane; i: number; links: StreamLinks; onResume: (slug: string) => void; resuming: string | null }) => {
  const style = { "--cor-speed": `${lane.pace === "still" ? 16 : SPEEDS[i % SPEEDS.length]}s`, "--cor-delay": `-${(i * 2.3) % 9}s` } as CSSProperties;
  const revisionCount = lane.cells.revision.length;
  return (
    <div className="cor-lane" data-lane={lane.slug} data-paused={lane.paused || undefined} data-pace={lane.pace}>
      <Link className="cor-lane-name" to={links.project(lane.slug)}>
        <Logo slug={lane.slug} title={lane.title} />
        <span className="cor-lane-text">
          <span className="cor-lane-title">{lane.title}</span>
          <span className="cor-cap">{lane.paused ? "en pausa" : lane.next ? `sigue ${lane.next}` : "sin paso siguiente"}</span>
        </span>
      </Link>
      <div className={`cor-track ${lane.pace === "off" ? "off" : lane.pace === "still" ? "still" : ""}`} style={style}>
        {lane.pace === "live" && (
          <>
            <span className="cor-spark" aria-hidden style={{ animationDelay: `-${(i * 3.1) % 11}s` }} />
            <span className="cor-spark" aria-hidden style={{ animationDuration: "16s", animationDelay: `-${(i * 5.3) % 16}s` }} />
          </>
        )}
        {COLUMNS.map((c) => (
          <Cell key={c} lane={lane} col={c} links={links} revisionCount={revisionCount} />
        ))}
        {lane.paused ? (
          <div className="cor-lane-over" data-resume={lane.slug}>
            <span className="cor-body">En pausa: nada arranca aquí.</span>
            <Btn kind="secondary" small disabled={resuming === lane.slug} onClick={() => onResume(lane.slug)}>
              {resuming === lane.slug ? "Reanudando…" : "Reanudar"}
            </Btn>
          </div>
        ) : (
          lane.idle && (
            <div className="cor-lane-over idle" data-idle={lane.slug}>
              <span className="cor-body cor-ellipsis" title={lane.idle.text}>
                {lane.idle.text}
              </span>
              {lane.idle.action && (
                <Link className="cor-btn quiet small" to={links.reason(lane.slug, lane.idle.action.href)} data-idle-action>
                  {lane.idle.action.label}
                </Link>
              )}
            </div>
          )
        )}
      </div>
    </div>
  );
};

export const Stream = ({
  headline,
  totals,
  lanes,
  links,
  onResume,
  resuming,
  pedir,
}: {
  headline: { now: string; you: string | null };
  totals: Totals | null;
  lanes: Lane[];
  links: StreamLinks;
  onResume: (slug: string) => void;
  resuming: string | null;
  pedir: ReactNode;
}) => (
  <>
    <section className="cor-hero" aria-label="Ahora">
      <h1 className="cor-h1" data-headline>
        {headline.now}
        {headline.you && (
          <>
            <br />
            <span className="cor-amber">{headline.you}</span>
          </>
        )}
      </h1>
      {totals && (
        <dl className="cor-totals" data-totals>
          {(
            [
              ["En revisión", totals.revision],
              ["Abiertos", totals.open],
              ["Hechos", totals.done],
            ] as const
          ).map(([t, n]) => (
            <div key={t}>
              <Label as="dt">{t}</Label>
              <dd className="cor-figure">{thousands(n)}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
    <section className="cor-stream" aria-label="La corriente: el trabajo de cada proyecto por etapa">
      <div className="cor-cols" aria-hidden>
        <span />
        <div>
          {COLUMNS.map((c) => (
            <span key={c} className={c === "construccion" ? "on" : undefined}>
              {COLUMN_NAME[c]}
            </span>
          ))}
        </div>
      </div>
      <div className="cor-lanes" data-lanes={lanes.length}>
        {lanes.length === 0 ? (
          <p className="cor-empty cor-text">Todavía no hay proyectos.</p>
        ) : (
          lanes.map((l, i) => (
            <Fragment key={l.slug}>
              <StreamLane lane={l} i={i} links={links} onResume={onResume} resuming={resuming} />
            </Fragment>
          ))
        )}
      </div>
    </section>
    {pedir}
  </>
);
