// One project on the index: accent stripe, name and progress, then one row per lane en marcha with
// the initiative's name and key and the tickets in progress. Lanes that are not moving stay off the index.
import { ArrowRightIcon } from "lucide-react";
import { Link } from "react-router";
import { accentInk, Glyph, projectAccent, rise } from "@/components/plan/visuals";
import { type Lane } from "@/lib/lanes";
import { useLive } from "@/lib/live";
import { cn } from "@/lib/utils";

function LaneRow({ slug, lane }: { slug: string; lane: Lane }) {
  const { isFresh } = useLive();
  // An agent just changed something in this lane: glow for a moment.
  const fresh = [lane.initiative, ...lane.review, ...lane.now, ...lane.next, ...lane.later, ...lane.done].some((t) => t && isFresh(slug, t.key));
  const inCourse = lane.now.filter((t) => t.status === "In progress");
  return (
    <div
      data-fresh={fresh || undefined}
      className={cn(
        "flex flex-wrap items-center gap-x-2.5 gap-y-1.5 rounded-[14px] sm:gap-x-3.5 bg-foreground/[0.04] px-3.5 py-2.5 transition-shadow duration-700",
        fresh && "shadow-[0_0_0_2px_var(--status-now),0_0_28px_color-mix(in_oklab,var(--status-now)_40%,transparent)]",
      )}
    >
      <span className="flex w-full min-w-0 shrink-0 flex-col gap-0.5 sm:w-[220px]">
        <span className="truncate font-display text-[13px] font-bold" title={lane.initiative?.title}>
          {lane.initiative?.title ?? "Sueltos"}
        </span>
        <span className="inline-flex items-center gap-1.5 text-[11px] text-ink-now">
          <Glyph tone="now" size={7} pulse />
          {lane.initiative ? <span className="font-mono">{lane.initiative.key}</span> : "en marcha"}
        </span>
      </span>
      <ul className="grid min-w-[180px] flex-1 gap-1 text-sm leading-snug">
        {inCourse.map((t) => (
          <li key={t.key} className="flex min-w-0 items-center gap-2">
            <Glyph tone="now" size={7} />
            <span className="truncate" title={t.title}>{t.title}</span>
          </li>
        ))}
        {inCourse.length === 0 && <li className="text-muted-foreground">Nada en curso</li>}
        {lane.review.length > 0 && <li className="text-xs text-ink-review">{lane.review.length} en revisión</li>}
      </ul>
    </div>
  );
}

export type TrackProject = {
  slug: string;
  title: string;
  /** The generated one-liner (resumeLine on the server); "Sin ficha." when there is nothing to say. */
  line: string;
  openQuestions: number;
  lanes: Lane[];
  progress: { closed: number; total: number };
};

const NO_CARD = "Sin ficha.";

export function projectRank(p: TrackProject) {
  if (p.lanes.some((l) => l.state === "moving")) return 0;
  if (p.openQuestions > 0 || p.lanes.length > 0) return 1;
  if (p.line && p.line !== NO_CARD) return 2;
  return 3;
}

export function ProjectTrack({ project, index }: { project: TrackProject; index: number }) {
  const [from, to] = projectAccent(project.slug);
  const lanes = project.lanes.filter((l) => l.state === "moving");
  const initiatives = project.lanes.filter((l) => l.initiative).length;
  const paused = projectRank(project) === 3;
  const moving = projectRank(project) === 0;

  return (
    <article
      className={cn(
        "group/track relative flex animate-rise overflow-hidden rounded-[22px] border transition duration-300 hover:-translate-y-1 hover:border-foreground/20 hover:shadow-[0_24px_60px_rgb(0_0_0/0.25)] motion-reduce:transition-none motion-reduce:hover:translate-y-0",
        paused ? "border-dashed bg-surface-sunken opacity-85" : "bg-card",
      )}
      style={{
        ...rise(index + 1),
        ...(moving
          ? { backgroundImage: `linear-gradient(135deg, color-mix(in oklab, ${from} 9%, var(--card)) 0%, var(--card) 45%)`, borderColor: `color-mix(in oklab, ${from} 30%, transparent)` }
          : {}),
      }}
    >
      <span
        aria-hidden
        className="w-1.5 shrink-0"
        style={{
          background: paused
            ? "repeating-linear-gradient(180deg, var(--status-pending) 0 8px, transparent 8px 14px)"
            : `linear-gradient(${from}, ${to})`,
        }}
      />
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-4 px-4 py-5 sm:gap-6 sm:px-6">
        <div className="flex w-full flex-col gap-1.5 sm:w-[200px] sm:min-w-[170px]">
          {/* The name is the link; it stretches over the whole track so the card is one big target. */}
          <Link
            to={`/p/${project.slug}`}
            className={cn(
              "font-display text-3xl leading-none font-extrabold tracking-tight after:absolute after:inset-0 after:rounded-[22px] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring",
              paused && "text-foreground/75",
            )}
          >
            {project.title}
          </Link>
          <span className="font-mono text-xs text-muted-foreground">
            {project.slug} · {initiatives === 0 ? (paused ? "en pausa" : "sin iniciativas") : initiatives === 1 ? "1 iniciativa" : `${initiatives} iniciativas en paralelo`}
          </span>
          {project.progress.total > 0 && (
            <span className="mt-1.5 flex items-center gap-2">
              <span className="h-[5px] flex-1 overflow-hidden rounded-full bg-foreground/[0.08]">
                <span
                  className="block h-full origin-left animate-grow-x rounded-full"
                  style={{
                    width: `${(project.progress.closed / project.progress.total) * 100}%`,
                    background: "linear-gradient(90deg, var(--status-done), var(--status-now))",
                  }}
                />
              </span>
              <span className="font-mono text-[11px] text-muted-foreground">
                {project.progress.closed}/{project.progress.total}
              </span>
            </span>
          )}
        </div>

        <div className="flex min-w-0 flex-[999_1_420px] flex-col gap-2.5">
          {lanes.length > 0 ? (
            lanes.map((lane) => <LaneRow key={lane.id} slug={project.slug} lane={lane} />)
          ) : (
            <span className="flex flex-col gap-1">
              <span className="text-[11px] font-bold tracking-[0.14em] text-muted-foreground uppercase">
                {paused ? "En pausa" : project.lanes.length > 0 ? "Nada en marcha" : "Sin iniciativas"}
              </span>
              <span className={cn("text-[15px] leading-snug", paused ? "text-muted-foreground" : "font-medium")}>
                {paused ? "Nada abierto ni ficha todavía." : project.line}
              </span>
            </span>
          )}
        </div>

        {project.openQuestions > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-status-jorge/12 px-3 py-1.5 text-xs font-semibold text-ink-jorge">
            {project.openQuestions} {project.openQuestions === 1 ? "pregunta" : "preguntas"} para ti
          </span>
        )}
        <ArrowRightIcon
          aria-hidden
          className="size-5 shrink-0 opacity-50 transition duration-300 group-hover/track:translate-x-1.5 group-hover/track:opacity-100"
          style={{ color: paused ? "var(--muted-foreground)" : accentInk(from) }}
        />
      </div>
    </article>
  );
}
