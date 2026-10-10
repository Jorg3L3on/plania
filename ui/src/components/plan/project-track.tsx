// One project on the index: a compact card (name, progress, state, last activity and a one-line peek with
// the initiative key) that opens downwards on hover or focus, or when clicked or tapped, to the lanes en
// marcha and their tickets in progress. Cards only grow in height, so the row beside them stays put.
import { ArrowRightIcon, ChevronDownIcon } from "lucide-react";
import { Link } from "react-router";
import { accentInk, Glyph, projectAccent, rise } from "@/components/plan/visuals";
import { type Lane } from "@/lib/lanes";
import { useLive } from "@/lib/live";
import { ago } from "@/lib/time";
import { cn } from "@/lib/utils";

function LaneRow({ slug, lane }: { slug: string; lane: Lane }) {
  const { isFresh } = useLive();
  // An agent just changed something in this lane: glow for a moment.
  const fresh = [lane.initiative, ...lane.review, ...lane.now, ...lane.next, ...lane.later, ...lane.done].some((t) => t && isFresh(slug, t.key));
  const inCourse = lane.now.filter((t) => t.status === "In progress");
  const blocked = lane.now.filter((t) => t.status === "Blocked").length;
  return (
    <div
      data-fresh={fresh || undefined}
      className={cn(
        "grid gap-1 rounded-[14px] bg-foreground/[0.04] px-3 py-2.5 transition-shadow duration-700",
        fresh && "shadow-[0_0_0_2px_var(--status-now),0_0_28px_color-mix(in_oklab,var(--status-now)_40%,transparent)]",
      )}
    >
      <span className="flex items-baseline justify-between gap-2">
        <span className="font-display text-[13px] leading-tight font-bold">{lane.initiative?.title ?? "Sueltos"}</span>
        {lane.initiative && <span className="shrink-0 font-mono text-[11px] text-ink-now">{lane.initiative.key}</span>}
      </span>
      <ul className="mt-0.5 grid gap-1 text-[13px] leading-snug">
        {inCourse.map((t) => (
          <li key={t.key} className="flex items-start gap-2">
            <Glyph tone="now" size={7} className="mt-[5px]" />
            <span>{t.title}</span>
          </li>
        ))}
        {inCourse.length === 0 && <li className="text-muted-foreground">Nada en curso</li>}
        {lane.review.length > 0 && <li className="text-xs text-ink-review">{lane.review.length} en revisión</li>}
        {blocked > 0 && <li className="text-xs text-ink-blocked">{blocked === 1 ? "1 bloqueado" : `${blocked} bloqueados`}</li>}
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
  /** Newest updated_at across the project's tasks; empty when it has none. */
  lastActivity: string;
};

const NO_CARD = "Sin ficha.";

export function projectRank(p: TrackProject) {
  if (p.lanes.some((l) => l.state === "moving")) return 0;
  if (p.openQuestions > 0 || p.lanes.length > 0) return 1;
  if (p.line && p.line !== NO_CARD) return 2;
  return 3;
}

/** What a closed card says in one line: the lane en marcha (or the first open one) and how it goes. */
function peekOf(project: TrackProject, moving: Lane[]): { key: string | null; text: string } {
  const lane = moving[0] ?? project.lanes.find((l) => l.initiative);
  if (!lane) return { key: null, text: project.line && project.line !== NO_CARD ? project.line : "Sin iniciativas abiertas." };
  const inCourse = lane.now.filter((t) => t.status === "In progress").length;
  const how = moving[0]
    ? [inCourse > 0 && `${inCourse} en curso`, lane.review.length > 0 && `${lane.review.length} en revisión`].filter(Boolean).join(" · ")
    : lane.next[0] && `siguiente: ${lane.next[0].title}`;
  return { key: lane.initiative?.key ?? null, text: [lane.initiative?.title ?? "Sueltos", how].filter(Boolean).join(" · ") };
}

export function ProjectTrack({
  project,
  index,
  open,
  onToggle,
}: {
  project: TrackProject;
  index: number;
  open: boolean;
  onToggle: () => void;
}) {
  const [from, to] = projectAccent(project.slug);
  const lanes = project.lanes.filter((l) => l.state === "moving");
  const initiatives = project.lanes.filter((l) => l.initiative).length;
  const paused = projectRank(project) === 3;
  const moving = lanes.length > 0;
  const peek = peekOf(project, lanes);
  const nextUp = project.lanes.find((l) => l.initiative && l.next[0]);
  const detailId = `track-${project.slug}`;

  return (
    <article
      data-open={open || undefined}
      className={cn(
        "group/track relative flex animate-rise flex-col overflow-hidden rounded-[22px] border transition duration-300 motion-reduce:transition-none",
        "hover:-translate-y-1 hover:border-[color-mix(in_oklab,var(--track-accent)_55%,transparent)] hover:shadow-[0_24px_60px_rgb(0_0_0/0.25)]",
        "data-open:-translate-y-1 data-open:border-[color-mix(in_oklab,var(--track-accent)_55%,transparent)] data-open:shadow-[0_24px_60px_rgb(0_0_0/0.25)]",
        "motion-reduce:hover:translate-y-0 motion-reduce:data-open:translate-y-0",
        paused ? "border-dashed bg-surface-sunken opacity-85" : "bg-card",
      )}
      style={{
        ...rise(index + 1),
        ["--track-accent" as string]: from,
        ...(moving
          ? { backgroundImage: `linear-gradient(160deg, color-mix(in oklab, ${from} 9%, var(--card)) 0%, var(--card) 55%)`, borderColor: `color-mix(in oklab, ${from} 30%, transparent)` }
          : {}),
      }}
    >
      <span
        aria-hidden
        className="h-1 shrink-0"
        style={{
          background: moving ? `linear-gradient(90deg, ${from}, ${to})` : "repeating-linear-gradient(90deg, var(--status-pending) 0 8px, transparent 8px 14px)",
        }}
      />
      {/* The whole card toggles; the name and "Abrir proyecto" are the links. */}
      <button
        type="button"
        aria-expanded={open}
        aria-controls={detailId}
        aria-label={`${open ? "Cerrar" : "Abrir"} ${project.title}`}
        onClick={onToggle}
        className="absolute inset-0 rounded-[22px] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
      />

      <div className="pointer-events-none relative flex flex-col gap-[7px] px-3.5 pt-3 pb-2.5 sm:gap-2.5 sm:px-[18px] sm:pt-[18px] sm:pb-3.5 tiny:gap-1 tiny:px-3 tiny:pt-2 tiny:pb-1.5">
        <div className="flex items-start justify-between gap-2.5">
          <div className="flex min-w-0 flex-col gap-1">
            <Link
              to={`/p/${project.slug}`}
              className={cn(
                "pointer-events-auto w-fit rounded-md font-display text-[22px] leading-none font-extrabold tracking-tight focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:text-[28px] tiny:text-[19px]",
                paused && "text-foreground/75",
              )}
            >
              {project.title}
            </Link>
            <span className="hidden font-mono text-[11px] text-muted-foreground sm:block">
              {project.slug} · {initiatives === 0 ? (paused ? "en pausa" : "sin iniciativas") : initiatives === 1 ? "1 iniciativa" : `${initiatives} iniciativas en paralelo`}
            </span>
          </div>
          <ChevronDownIcon
            aria-hidden
            className="mt-1 size-[18px] shrink-0 text-status-idle transition-transform duration-300 group-hover/track:rotate-180 group-has-[:focus-visible]/track:rotate-180 group-data-open/track:rotate-180"
          />
        </div>

        {project.progress.total > 0 && (
          <span className="flex items-center gap-2">
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

        <span className="flex min-h-[18px] items-center justify-between gap-2">
          <span className={cn("inline-flex items-center gap-[7px] text-xs font-semibold", moving ? "text-ink-now" : "text-muted-foreground")}>
            <Glyph tone={moving ? "now" : "pending"} size={7} pulse={moving} />
            {moving ? `${lanes.length} en marcha` : paused ? "en pausa" : "quieto"}
          </span>
          <span className="flex items-center gap-2 text-[11px] text-muted-foreground">
            {project.openQuestions > 0 && (
              <span className="rounded-full bg-status-jorge/12 px-2 py-0.5 font-semibold text-ink-jorge">
                {project.openQuestions} {project.openQuestions === 1 ? "pregunta" : "preguntas"}
              </span>
            )}
            {project.lastActivity && ago(project.lastActivity)}
          </span>
        </span>

        <p className="m-0 line-clamp-1 text-xs leading-snug text-foreground/80 group-hover/track:hidden group-data-open/track:hidden sm:line-clamp-2 sm:text-[13px] tiny:line-clamp-1 tiny:text-xs">
          {peek.key && <span className={cn("mr-1.5 font-mono text-[11px] font-semibold", moving ? "text-ink-now" : "text-muted-foreground")}>{peek.key}</span>}
          {peek.text}
        </p>
      </div>

      {/* 0fr → 1fr animates the height without measuring it. */}
      <div
        id={detailId}
        className="pointer-events-none relative grid grid-rows-[0fr] opacity-0 transition-[grid-template-rows,opacity] duration-[420ms,300ms] ease-[cubic-bezier(0.2,0.7,0.2,1)] group-hover/track:grid-rows-[1fr] group-hover/track:opacity-100 group-has-[:focus-visible]/track:grid-rows-[1fr] group-has-[:focus-visible]/track:opacity-100 group-data-open/track:grid-rows-[1fr] group-data-open/track:opacity-100 motion-reduce:transition-none"
      >
        <div className="min-h-0 overflow-hidden">
          <div className="flex flex-col gap-2 px-3 pb-3.5">
            {lanes.length > 0 ? (
              lanes.map((lane) => <LaneRow key={lane.id} slug={project.slug} lane={lane} />)
            ) : (
              <div className="grid gap-1 rounded-[14px] bg-foreground/[0.04] px-3 py-2.5 text-[13px] leading-snug">
                <span className="text-[11px] font-bold tracking-[0.14em] text-muted-foreground uppercase">
                  {paused ? "En pausa" : project.lanes.length > 0 ? "Nada en marcha" : "Sin iniciativas"}
                </span>
                {paused ? (
                  <span className="text-muted-foreground">Nada abierto ni ficha todavía.</span>
                ) : nextUp ? (
                  <span>
                    Siguiente: {nextUp.next[0]!.title} <span className="font-mono text-[11px] text-muted-foreground">{nextUp.initiative!.key}</span>
                  </span>
                ) : (
                  <span>{project.line}</span>
                )}
              </div>
            )}
            <Link
              to={`/p/${project.slug}`}
              tabIndex={open ? 0 : -1}
              className="pointer-events-auto inline-flex w-fit items-center gap-1.5 rounded-md px-0.5 py-1.5 text-xs font-semibold focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              style={{ color: paused ? "var(--muted-foreground)" : accentInk(from) }}
            >
              Abrir proyecto
              <ArrowRightIcon aria-hidden className="size-3.5" />
            </Link>
          </div>
        </div>
      </div>
    </article>
  );
}
