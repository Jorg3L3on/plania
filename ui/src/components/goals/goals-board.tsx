import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { GoalCard } from "@/components/goals/goal-card";
import { GoalDialog } from "@/components/goals/goal-dialog";
import type { Goal } from "@/components/goals/model";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";

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
  if (goals.length === 0) return <p className="text-sm text-muted-foreground">Sin metas.</p>;
  return (
    <div className={compact ? "grid grid-cols-1 gap-3 sm:grid-cols-2" : "grid grid-cols-1 gap-3"}>
      {goals.map((goal) => (
        <GoalCard
          key={goal.id}
          goal={goal}
          compact={compact}
          projectTitle={goal.project ? names.get(goal.project) : undefined}
          onEdit={onEdit}
        />
      ))}
    </div>
  );
}

function GoalsBlock({
  project,
  compact = false,
  companyOnly = false,
  heading,
}: {
  project?: string;
  compact?: boolean;
  companyOnly?: boolean;
  heading: "section" | "none";
}) {
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
    <section className="grid gap-3" aria-label="Metas">
      <div className="flex flex-wrap items-end justify-between gap-3">
        {heading === "section" ? (
          <div className="grid gap-1">
            <h2 className="font-display text-2xl font-extrabold tracking-tight">Metas</h2>
            <p className="text-sm text-muted-foreground">El porqué, y cuántos tickets ligados ya están hechos.</p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">El porqué, y cuántos tickets ligados ya están hechos.</p>
        )}
        <div className="flex items-center gap-2">
          {compact && (
            <Link to="/goals" className="inline-flex min-h-9 items-center text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
              Ver metas
            </Link>
          )}
          <Button type="button" onClick={handleCreate}>Nueva meta</Button>
        </div>
      </div>
      {list.isError ? (
        <p className="text-sm text-destructive">No se pudieron cargar las metas.</p>
      ) : !list.data ? (
        <Skeleton className="h-28 rounded-[20px]" />
      ) : (
        <GoalList
          goals={companyOnly ? list.data.goals.filter((goal) => goal.project === null) : list.data.goals}
          names={names}
          compact={compact}
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

export function GoalsHome() {
  return <GoalsBlock compact companyOnly heading="section" />;
}

export function GoalsProject({ slug }: { slug: string }) {
  return <GoalsBlock project={slug} heading="section" />;
}

export function GoalsBoard() {
  return <GoalsBlock heading="none" />;
}
