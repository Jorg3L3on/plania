// PLA-I62-2: La corriente, Compañía's first screen (board A1). What happens now and the three totals, then one lane
// per project across seven stages with the light flowing through it: a violet dot per piece of work waiting in its
// stage (a count when there are many), a white haloed dot for an agent working (its seat, its paso and what it does),
// an amber rhombus where something waits on the owner. A paused lane is dark with Reanudar; a lane where nobody works
// says why. The Pedir bar sits at the bottom with the page's one white button.
import { Fragment, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router";
import type { Decision } from "@/lib/api";
import { thousands } from "@/lib/corriente";
import { COLUMNS, columnName, type Column, type Lane, type Totals } from "@/lib/corriente-stream";
import { words } from "@/lib/i18n";
import { NEW_PROJECT_CONTROL, STREAM_WORDS } from "@/lib/stream-words";
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

const Cell = ({ lane, col, links, revisionCount, idle }: { lane: Lane; col: Column; links: StreamLinks; revisionCount: number; idle?: boolean }) => {
  const work = lane.cells[col];
  const agents = lane.agents.filter((a) => a.col === col);
  const you = lane.you.filter((y) => y.col === col);
  // The work an agent is on is drawn as the agent, not as a dot too.
  const busy = new Set(agents.map((a) => a.key));
  const dots = work.filter((w) => !busy.has(w.key));
  const showDots = agents.length === 0 && you.length === 0 ? dots : dots.slice(0, 2);
  const w = words(STREAM_WORDS);
  return (
    <div className="cor-cell" data-col={col} data-n={work.length}>
      {showDots.length > MAX_DOTS ? (
        <span className="cor-cell-n" aria-label={w.inColumn(showDots.length, columnName(col))}>
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
            <span>{[a.key, a.doing].filter(Boolean).join(" · ") || w.working}</span>
          </span>
        </Link>
      ))}
      {agents.length > 1 && <span className="cor-cell-more">+{agents.length - 1}</span>}
      {idle && lane.idle?.action && (
        <Link to={links.reason(lane.slug, lane.idle.action.href)} className="cor-tag-link" data-idle-action={lane.slug}>
          <span className="cor-tag">
            <b>{lane.idle.action.label}</b>
            <span>{w.nobodyWorks}</span>
          </span>
        </Link>
      )}
      {you.slice(0, 1).map((y) => (
        <Link key={y.decision.id} to={links.you(lane.slug, y.decision)} className="cor-tag-link" data-you={y.decision.id}>
          <You />
          <span className="cor-tag amber">
            <b>{y.verb}</b>
            <span>{you.length > 1 ? w.more(you.length - 1) : col === "revision" ? w.inReview(revisionCount) : y.decision.title}</span>
          </span>
        </Link>
      ))}
    </div>
  );
};

export const StreamLane = ({ lane, i, links, onResume, resuming }: { lane: Lane; i: number; links: StreamLinks; onResume: (slug: string) => void; resuming: string | null }) => {
  const style = { "--cor-speed": `${lane.pace === "still" ? 16 : SPEEDS[i % SPEEDS.length]}s`, "--cor-delay": `-${(i * 2.3) % 9}s` } as CSSProperties;
  const revisionCount = lane.cells.revision.length;
  const w = words(STREAM_WORDS);
  // Nobody works here: the server's action sits in the first empty stage, so it never covers work.
  const idleCol = lane.idle?.action ? (COLUMNS.find((c) => !lane.cells[c].length && !lane.you.some((y) => y.col === c)) ?? null) : null;
  return (
    <div className="cor-lane" data-lane={lane.slug} data-paused={lane.paused || undefined} data-pace={lane.pace}>
      <Link className="cor-lane-name" to={links.project(lane.slug)}>
        <Logo slug={lane.slug} title={lane.title} />
        <span className="cor-lane-text">
          <span className="cor-lane-title">{lane.title}</span>
          <span className="cor-cap cor-ellipsis" title={lane.idle?.text} data-idle={lane.idle ? lane.slug : undefined}>
            {lane.paused ? w.paused : lane.idle ? lane.idle.text : lane.agents[0] ? w.seatWorks(lane.agents[0].seat, lane.agents[0].key ?? null) : lane.next ? w.next(lane.next) : w.noNext}
          </span>
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
          <Cell key={c} lane={lane} col={c} links={links} revisionCount={revisionCount} idle={c === idleCol} />
        ))}
        {lane.paused ? (
          <div className="cor-lane-over" data-resume={lane.slug}>
            <span className="cor-body">{w.pausedLane}</span>
            <Btn kind="secondary" small disabled={resuming === lane.slug} onClick={() => onResume(lane.slug)}>
              {resuming === lane.slug ? w.resuming : w.resume}
            </Btn>
          </div>
        ) : null}
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
  onNew,
  resuming,
  pedir,
}: {
  headline: { now: string; you: string | null };
  totals: Totals | null;
  lanes: Lane[];
  links: StreamLinks;
  onResume: (slug: string) => void;
  onNew?: () => void;
  resuming: string | null;
  pedir: ReactNode;
}) => {
  const w = words(STREAM_WORDS);
  return (
    <>
      <section className="cor-hero" aria-label={w.now}>
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
                [w.totals.revision, totals.revision],
                [w.totals.open, totals.open],
                [w.totals.done, totals.done],
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
      <section className="cor-stream" aria-label={w.streamAria}>
        <div className="cor-cols" aria-hidden>
          <span />
          <div>
            {COLUMNS.map((c) => (
              <span key={c} className={c === "construccion" ? "on" : undefined}>
                {columnName(c)}
              </span>
            ))}
          </div>
        </div>
        <div className="cor-lanes" data-lanes={lanes.length} tabIndex={-1}>
          {lanes.length === 0 ? (
            <p className="cor-empty cor-text">{w.noProjects}</p>
          ) : (
            lanes.map((l, i) => (
              <Fragment key={l.slug}>
                <StreamLane lane={l} i={i} links={links} onResume={onResume} resuming={resuming} />
              </Fragment>
            ))
          )}
          {onNew && (
            <div className="cor-newproj">
              <Btn kind="quiet" small onClick={onNew} data-control={NEW_PROJECT_CONTROL}>
                {w.newProject}
              </Btn>
            </div>
          )}
        </div>
      </section>
      {pedir}
    </>
  );
};
