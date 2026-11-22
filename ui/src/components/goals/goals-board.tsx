import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { PlusIcon } from "lucide-react";
import { Link } from "react-router";
import { GoalCard } from "@/components/goals/goal-card";
import { GoalDialog } from "@/components/goals/goal-dialog";
import type { Goal } from "@/components/goals/model";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { words } from "@/lib/i18n";
import { GOALS_WORDS } from "@/lib/goals-words";
import { metasLinea, metasLineaTexto, metasLineaWords, metasPrincipales } from "@/lib/metas-linea";
import { cn } from "@/lib/utils";

function useGoalNames() {
  const projects = useQuery({ queryKey: ["projects"], queryFn: api.projects });
  const names = new Map((projects.data ?? []).map((project) => [project.slug, project.title]));
  return { projects: (projects.data ?? []).map((project) => ({ slug: project.slug, title: project.title })), names };
}

function GoalList({
  goals,
  names,
  compact,
  onEdit,
}: {
  goals: Goal[];
  names: Map<string, string>;
  compact?: boolean;
  onEdit: (goal: Goal) => void;
}) {
  const w = words(GOALS_WORDS);
  if (goals.length === 0) return <p className="text-sm text-muted-foreground">{w.none}</p>;
  return (
    <div className="grid grid-cols-1 gap-2.5">
      {goals.map((goal, index) => (
        <GoalCard
          key={goal.id}
          goal={goal}
          index={index}
          compact={compact}
          names={names}
          onEdit={onEdit}
        />
      ))}
    </div>
  );
}

function GoalsBlock({
  project,
  heading,
}: {
  project?: string;
  heading: "section" | "none";
}) {
  const w = words(GOALS_WORDS);
  const list = useQuery({
    queryKey: project ? ["goals", project] : ["goals"],
    queryFn: () => api.goals(project),
  });
  const tree = useQuery({ queryKey: ["goals"], queryFn: () => api.goals(), enabled: !!project });
  const { projects, names } = useGoalNames();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Goal | null>(null);
  const parents = (tree.data ?? list.data)?.goals.filter((goal) => goal.project === null) ?? [];

  const handleCreate = () => {
    setEditing(null);
    setOpen(true);
  };
  const handleEdit = (goal: Goal) => {
    setEditing(goal);
    setOpen(true);
  };
  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) setEditing(null);
  };

  return (
    <section className="grid gap-3" aria-label={w.goals}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        {heading === "section" ? (
          <div className="grid gap-1">
            <h2 className="font-display text-2xl font-extrabold tracking-tight">{w.goals}</h2>
            <p className="text-xs text-muted-foreground">{w.ladder}</p>
          </div>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          <Button type="button" onClick={handleCreate}>{w.newGoal}</Button>
        </div>
      </div>
      {list.isError ? (
        <p className="text-sm text-destructive">{w.loadFailed}</p>
      ) : !list.data ? (
        <Skeleton className="h-28 rounded-[20px]" />
      ) : (
        <GoalList
          goals={list.data.goals}
          names={names}
          onEdit={handleEdit}
        />
      )}
      <GoalDialog
        open={open}
        goal={editing}
        fixedProject={project}
        projects={projects}
        parents={parents}
        onOpenChange={handleOpenChange}
      />
    </section>
  );
}

/**
 * Inicio's goals. Below the wide breakpoint, one line under La máquina: «Metas», how many company goals are active
 * and their tasks done, a thin bar, «Ver metas» and «Nueva». From xl it is the narrow column beside La máquina: the
 * same summary, then the first three active goals each with its own bar, and it stays in view while the
 * projects scroll. «Nueva» opens the same dialog in place. Nothing shows until the list is read.
 * Bars grow from the left when a value changes, never on load.
 */
export function GoalsHome() {
  const w = words(GOALS_WORDS);
  const l = metasLineaWords();
  const list = useQuery({ queryKey: ["goals"], queryFn: () => api.goals() });
  const { projects } = useGoalNames();
  const [open, setOpen] = useState(false);
  if (!list.data) return null;
  const goals = list.data.goals;
  const m = metasLinea(goals);
  const partes = metasLineaTexto(m);
  const { lista, mas } = metasPrincipales(goals);
  return (
    <section
      aria-labelledby="metas-titulo"
      className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border bg-card/60 px-4 py-2.5 xl:grid xl:content-start xl:gap-4 xl:rounded-2xl xl:p-4"
      data-metas-linea
    >
      <p className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm xl:grid xl:gap-0.5">
        <span id="metas-titulo" className="font-medium xl:font-display xl:text-xl xl:font-bold xl:tracking-tight">
          {w.goals}
        </span>
        {partes.map((t, k) => (
          <span key={t} className="text-muted-foreground">
            <span aria-hidden className={cn("mr-2", k === 0 && "xl:hidden")}>·</span>
            {t}
          </span>
        ))}
      </p>
      {m.total > 0 ? <Barra done={m.done} total={m.total} className="w-20 xl:w-full" /> : null}

      {/* The first goals, only where there is room for them. */}
      {lista.length > 0 ? (
        <ul className="hidden gap-3 border-t pt-3 xl:grid">
          {lista.map((g) => (
            <li key={g.id} className="grid gap-1.5">
              <span className="flex items-baseline justify-between gap-2 text-sm">
                <span className="min-w-0 truncate" title={g.title}>
                  {g.title}
                </span>
                {g.progress.total > 0 ? (
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums" title={w.progress(g.progress.done, g.progress.total)}>
                    {g.progress.done}/{g.progress.total}
                  </span>
                ) : null}
              </span>
              {g.progress.total > 0 ? <Barra done={g.progress.done} total={g.progress.total} /> : null}
            </li>
          ))}
          {mas > 0 ? <li className="text-xs text-muted-foreground">{w.more(mas)}</li> : null}
        </ul>
      ) : null}

      <span className="flex items-center gap-1 xl:-mx-2">
        {m.hay ? (
          <Link to="/goals" className="inline-flex min-h-11 items-center rounded-md px-2 text-sm font-medium text-muted-foreground transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:min-h-8 [@media(hover:hover)_and_(pointer:fine)]:hover:text-foreground">
            {w.seeGoals}
          </Link>
        ) : null}
        <Button type="button" variant="ghost" size="sm" className="min-h-11 transition-[background-color,color,scale] active:scale-[0.97] motion-reduce:transition-none sm:min-h-8" onClick={() => setOpen(true)} data-control="metas-nueva">
          <PlusIcon aria-hidden /> {l.nueva}
        </Button>
      </span>
      <GoalDialog open={open} goal={null} projects={projects} parents={goals.filter((g) => g.project === null)} onOpenChange={setOpen} />
    </section>
  );
}

/** A thin share-done bar; the fill grows from the left on change (a transition, so still on load). */
function Barra({ done, total, className }: { done: number; total: number; className?: string }) {
  return (
    <span aria-hidden className={cn("block h-1 overflow-hidden rounded-full bg-foreground/[0.08]", className)}>
      <span className="block h-full origin-left bg-status-done transition-transform duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none" style={{ transform: `scaleX(${total > 0 ? done / total : 0})` }} />
    </span>
  );
}

export function GoalsProject({ slug }: { slug: string }) {
  return <GoalsBlock project={slug} heading="section" />;
}

export function GoalsBoard() {
  return <GoalsBlock heading="none" />;
}
