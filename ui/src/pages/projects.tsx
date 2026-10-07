import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useNavigate } from "react-router";
import { Skeleton } from "@/components/ui/skeleton";
import { YourTurnStrip } from "@/components/plan/project-parts";
import { ProjectTrack, projectRank, type TrackProject } from "@/components/plan/project-track";
import { Glyph } from "@/components/plan/visuals";
import { api } from "@/lib/api";
import { buildLanes, projectProgress, statusCounts, yourTurn, type YourTurnItem } from "@/lib/lanes";

type TurnItem = YourTurnItem & { slug: string; projectTitle: string };

export function ProjectsPage() {
  const projects = useQuery({ queryKey: ["projects"], queryFn: api.projects });
  const navigate = useNavigate();

  const derived = useMemo(() => {
    const list = projects.data ?? [];
    const tracks: TrackProject[] = list
      .map((p) => ({
        slug: p.slug,
        title: p.title,
        line: p.line,
        openQuestions: p.open_questions,
        lanes: buildLanes(p.tasks),
        progress: projectProgress(p.tasks),
      }))
      .sort((a, b) => projectRank(a) - projectRank(b) || a.slug.localeCompare(b.slug));
    const counts = list.map((p) => statusCounts(p.tasks));
    const turn: TurnItem[] = list.flatMap((p) => yourTurn(p.tasks).map((i) => ({ ...i, slug: p.slug, projectTitle: p.title })));
    const moving = tracks.filter((t) => projectRank(t) === 0).length;
    return {
      tracks,
      turn,
      moving,
      inProgress: counts.reduce((n, c) => n + c.inProgress, 0),
      inReview: counts.reduce((n, c) => n + c.inReview, 0),
      questions: list.reduce((n, p) => n + p.open_questions, 0),
    };
  }, [projects.data]);

  const nowMs = useMemo(() => Date.now(), [projects.data]);
  const n = derived.tracks.length;
  const still = n - derived.moving;

  return (
    <div className="grid gap-8">
      <header className="flex animate-rise flex-wrap items-end justify-between gap-6">
        <div className="grid gap-2.5">
          <h1 className="font-display text-5xl leading-[0.95] font-extrabold tracking-[-0.03em] sm:text-[64px]">¿Dónde va cada cosa?</h1>
          {projects.data && (
            <p className="text-[17px] text-muted-foreground">
              {n === 1 ? "Un proyecto" : `${n} proyectos`}.{" "}
              {derived.moving === 0 ? "Ninguno en marcha ahora." : `${derived.moving} en marcha${still > 0 ? `, ${still} ${still === 1 ? "quieto" : "quietos"}` : ""}.`}
            </p>
          )}
        </div>
        {projects.data && (
          <ul className="flex flex-wrap gap-2.5 text-xs font-semibold">
            {derived.inProgress > 0 && (
              <li className="inline-flex items-center gap-2 rounded-full bg-status-now/12 px-3 py-2 text-ink-now">
                <Glyph tone="now" size={7} />{derived.inProgress} en curso
              </li>
            )}
            {derived.inReview > 0 && (
              <li className="inline-flex items-center gap-2 rounded-full bg-status-review/14 px-3 py-2 text-ink-review">
                <Glyph tone="review" size={7} />{derived.inReview} en revisión
              </li>
            )}
            {derived.questions > 0 && (
              <li className="inline-flex items-center gap-2 rounded-full bg-status-jorge/12 px-3 py-2 text-ink-jorge">
                <Glyph tone="jorge" size={7} />
                {derived.questions === 1 ? "1 pregunta para ti" : `${derived.questions} preguntas para ti`}
              </li>
            )}
          </ul>
        )}
      </header>

      {projects.isPending && (
        <div className="grid gap-4">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-32 rounded-[22px]" />)}
        </div>
      )}
      {projects.isError && <p className="text-sm text-destructive">No se pudieron cargar los proyectos.</p>}

      {projects.data && (
        <>
          <div className="grid gap-4">
            {derived.tracks.map((p, i) => <ProjectTrack key={p.slug} project={p} index={i} nowMs={nowMs} />)}
          </div>
          <YourTurnStrip
            items={derived.turn}
            prefix={(item) => (item as TurnItem).projectTitle}
            onOpen={(item) => navigate(`/p/${(item as TurnItem).slug}?task=${encodeURIComponent(item.task.key)}`)}
          />
        </>
      )}
    </div>
  );
}
