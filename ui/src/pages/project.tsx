import { useQuery } from "@tanstack/react-query";
import { ChevronLeftIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { TaskControls } from "@/components/task-controls";
import { TaskRow } from "@/components/task-row";
import { TaskSheet } from "@/components/task-sheet";
import { api, ApiError } from "@/lib/api";
import { DecisionList, QuestionsPanel, ResumeView } from "@/components/resume";
import { CLOSED_STATUSES, PRIORITIES, TICKET_STATUSES, type TaskRow as Task } from "@/lib/types";

type Filters = { status: string; priority: string; showClosed: boolean };

// Groups tickets under their initiative; tickets with no shown initiative go last.
function groupTasks(tasks: Task[], f: Filters) {
  const shown = (t: Task) => f.showClosed || !CLOSED_STATUSES.has(t.status);
  const filtering = f.status !== "all" || f.priority !== "all";
  const matches = (t: Task) =>
    shown(t) && (f.status === "all" || t.status === f.status) && (f.priority === "all" || t.priority === f.priority);

  const initiatives = tasks.filter((t) => t.kind === "initiative" && shown(t));
  const initiativeKeys = new Set(initiatives.map((i) => i.key));
  const tickets = tasks.filter((t) => t.kind === "ticket" && matches(t));

  const groups = initiatives
    .map((initiative) => ({ initiative, children: tickets.filter((t) => t.parent_key === initiative.key) }))
    .filter((g) => !filtering || g.children.length > 0);
  const loose = tickets.filter((t) => !t.parent_key || !initiativeKeys.has(t.parent_key));
  return { groups, loose };
}

export function ProjectPage() {
  const { slug = "" } = useParams();
  const project = useQuery({ queryKey: ["project", slug], queryFn: () => api.project(slug) });
  const [searchParams, setSearchParams] = useSearchParams();
  const openKey = searchParams.get("task");
  const openTask = (key: string) => setSearchParams({ task: key });
  const closeTask = () => setSearchParams({}, { replace: false });
  const [filters, setFilters] = useState<Filters>({ status: "all", priority: "all", showClosed: false });
  const { groups, loose } = useMemo(
    () => groupTasks(project.data?.tasks ?? [], filters),
    [project.data, filters],
  );

  if (project.isError) {
    const notFound = project.error instanceof ApiError && project.error.status === 404;
    return (
      <div className="grid gap-2">
        <p>{notFound ? "Ese proyecto no existe." : "No se pudo cargar el proyecto."}</p>
        <Link to="/" className="text-sm text-muted-foreground underline">Volver a proyectos</Link>
      </div>
    );
  }

  return (
    <div className="grid gap-8">
      <div className="grid gap-1">
        <Link to="/" className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeftIcon className="size-4" /> Proyectos
        </Link>
        {project.data ? (
          <h1 className="flex flex-wrap items-baseline gap-3 text-2xl font-semibold tracking-tight">
            {project.data.title}
            <span className="font-mono text-sm font-normal text-muted-foreground">{project.data.slug}</span>
            <a href={api.exportUrl(project.data.slug)} className="text-sm font-normal text-muted-foreground underline underline-offset-4">
              Exportar JSON
            </a>
          </h1>
        ) : (
          <Skeleton className="h-8 w-48" />
        )}
      </div>

      {project.data && <QuestionsPanel slug={slug} questions={project.data.resume.open_questions} onOpen={openTask} />}

      <section className="grid gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">Ficha</h2>
        {project.data ? <ResumeView resume={project.data.resume} onOpen={openTask} /> : <Skeleton className="h-36 rounded-xl" />}
      </section>

      <section className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-medium text-muted-foreground">Trabajo</h2>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={filters.status} onValueChange={(status) => setFilters((f) => ({ ...f, status }))}>
              <SelectTrigger size="sm" className="w-40" aria-label="Filtrar por estado"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los estados</SelectItem>
                {TICKET_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filters.priority} onValueChange={(priority) => setFilters((f) => ({ ...f, priority }))}>
              <SelectTrigger size="sm" className="w-36" aria-label="Filtrar por prioridad"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Toda prioridad</SelectItem>
                {PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-2 pl-1">
              <Switch
                id="show-closed"
                checked={filters.showClosed}
                onCheckedChange={(showClosed) => setFilters((f) => ({ ...f, showClosed }))}
              />
              <Label htmlFor="show-closed" className="text-sm font-normal">Cerrados</Label>
            </div>
          </div>
        </div>

        {project.isPending && <Skeleton className="h-40 rounded-xl" />}
        {project.data && groups.length === 0 && loose.length === 0 && (
          <Card>
            <CardContent className="py-6 text-center text-sm text-muted-foreground">
              {filters.status !== "all" || filters.priority !== "all" ? "Nada coincide con los filtros." : "Nada abierto."}
            </CardContent>
          </Card>
        )}
        {groups.map(({ initiative, children }) => (
          <Card key={initiative.key} className="gap-0 divide-y py-0">
            <TaskRow
              slug={slug}
              task={initiative}
              selected={openKey === initiative.key}
              onOpen={openTask}
              controls={<TaskControls slug={slug} task={initiative} />}
            />
            {children.map((t) => (
              <TaskRow
                key={t.key}
                slug={slug}
                task={t}
                nested
                selected={openKey === t.key}
                onOpen={openTask}
                controls={<TaskControls slug={slug} task={t} />}
              />
            ))}
          </Card>
        ))}
        {loose.length > 0 && (
          <Card className="gap-0 divide-y py-0">
            <div className="px-4 py-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">Sin iniciativa</div>
            {loose.map((t) => (
              <TaskRow
                key={t.key}
                slug={slug}
                task={t}
                selected={openKey === t.key}
                onOpen={openTask}
                controls={<TaskControls slug={slug} task={t} />}
              />
            ))}
          </Card>
        )}
      </section>

      {project.data && <DecisionList decisions={project.data.decisions} onOpen={openTask} />}

      <TaskSheet slug={slug} taskKey={openKey} onOpen={openTask} onClose={closeTask} />
    </div>
  );
}
