import { useQuery } from "@tanstack/react-query";
import { ChevronLeftIcon, ListIcon, WaypointsIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { Skeleton } from "@/components/ui/skeleton";
import { LaneGrid } from "@/components/plan/lane-grid";
import {
  BranchGraph,
  FichaSheet,
  FixedDecisions,
  InitiativeTable,
  ProjectHeader,
  SectionTitle,
} from "@/components/plan/project-parts";
import { QuestionsPanel } from "@/components/resume";
import { TaskList } from "@/components/plan/task-list";
import { Kicker } from "@/components/plan/visuals";
import { TaskSheet } from "@/components/task-sheet";
import { api, ApiError } from "@/lib/api";
import { branchEdges, buildLanes, firstLine, projectProgress, statements, statusCounts } from "@/lib/lanes";
import { cn } from "@/lib/utils";

type View = "lanes" | "lista";

// The v1 card often repeats a pinned decision; compare without the final period.
const dedupe = (items: string[]) => [...new Map(items.map((t) => [t.replace(/[.\s]+$/, ""), t])).values()];

function ViewToggle({ view, onChange }: { view: View; onChange: (v: View) => void }) {
  const options: { value: View; label: string; icon: typeof ListIcon }[] = [
    { value: "lanes", label: "Líneas", icon: WaypointsIcon },
    { value: "lista", label: "Lista", icon: ListIcon },
  ];
  return (
    <div role="group" aria-label="Vista" className="inline-flex rounded-full border bg-card p-1">
      {options.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          aria-pressed={view === value}
          onClick={() => onChange(value)}
          className={cn(
            "inline-flex min-h-9 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-medium transition focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
            view === value ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Icon className="size-3.5" aria-hidden />
          {label}
        </button>
      ))}
    </div>
  );
}

function PageSkeleton() {
  return (
    <div className="grid gap-8">
      <Skeleton className="h-24 w-2/3 rounded-2xl" />
      <Skeleton className="h-64 rounded-2xl" />
    </div>
  );
}

export function ProjectPage() {
  const { slug = "" } = useParams();
  const project = useQuery({ queryKey: ["project", slug], queryFn: () => api.project(slug) });
  const [searchParams, setSearchParams] = useSearchParams();
  const [fichaOpen, setFichaOpen] = useState(false);
  const openKey = searchParams.get("task");
  const view: View = searchParams.get("view") === "lista" ? "lista" : "lanes";

  // Keep the other params (the view) when the side panel opens or closes.
  const setParam = (name: string, value: string | null) =>
    setSearchParams((p) => {
      const next = new URLSearchParams(p);
      if (value === null) next.delete(name);
      else next.set(name, value);
      return next;
    });
  const openTask = (key: string) => setParam("task", key);
  const closeTask = () => setParam("task", null);

  const tasks = project.data?.tasks;
  const derived = useMemo(() => {
    const all = tasks ?? [];
    return {
      lanes: buildLanes(all),
      progress: projectProgress(all),
      counts: statusCounts(all),
      edges: branchEdges(all),
    };
  }, [tasks]);

  const resume = project.data?.resume;
  // Pinned decisions that still stand, project-wide and per initiative; the v1 card's decision while it exists.
  const fixed = resume
    ? dedupe([
        ...[...new Map([...resume.must_keep, ...resume.initiatives.flatMap((i) => i.must_keep)].map((d) => [d.id, d])).values()]
          .filter((d) => !d.superseded_by)
          .map((d) => d.text),
        ...statements(resume.legacy_card?.must_keep_decision ?? ""),
      ])
    : [];
  const branchText = resume?.legacy_card?.branch_or_prod ?? "";
  const nowText = resume
    ? resume.claims.map((c) => `${c.title} (${c.owner?.agent ?? "?"})`).join(", ") || firstLine(resume.legacy_card?.in_progress ?? "")
    : "";
  const nextText = resume ? resume.next_claimable?.title ?? firstLine(resume.legacy_card?.next_action ?? "") : "";

  if (project.isError) {
    const notFound = project.error instanceof ApiError && project.error.status === 404;
    return (
      <div className="grid gap-2">
        <p>{notFound ? "Ese proyecto no existe." : "No se pudo cargar el proyecto."}</p>
        <Link to="/" className="text-sm text-muted-foreground underline">Volver a proyectos</Link>
      </div>
    );
  }

  const initiativeLanes = derived.lanes.filter((l) => l.initiative);

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Link to="/" className="inline-flex min-h-9 items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
          <ChevronLeftIcon className="size-4" /> Proyectos
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <ViewToggle view={view} onChange={(v) => setParam("view", v === "lista" ? "lista" : null)} />
        </div>
      </div>

      {!project.data ? (
        <PageSkeleton />
      ) : (
        <>
          <ProjectHeader
            title={project.data.title}
            lanes={derived.lanes}
            progress={derived.progress}
            counts={derived.counts}
          />
          {/* Questions agents asked Jorge (Needs Jorge): answer in place; the answer becomes a decision. */}
          <QuestionsPanel slug={slug} questions={project.data.resume.open_questions} onOpen={openTask} />

          {view === "lista" ? (
            <TaskList slug={slug} tasks={project.data.tasks} openKey={openKey} onOpen={openTask} />
          ) : derived.lanes.length === 0 ? (
            <div className="flex flex-wrap items-start gap-7">
              <section className="grid min-w-0 flex-[999_1_560px] animate-rise gap-3 rounded-[20px] border border-dashed bg-card/50 px-6 py-8">
                <Kicker className="text-muted-foreground">Nada abierto</Kicker>
                {nowText && <p className="text-[15px] text-muted-foreground">{nowText}</p>}
                <Kicker className="mt-2 text-ink-ready">Siguiente</Kicker>
                <p className="font-display text-2xl font-bold tracking-tight">{nextText || "Sin iniciativas ni tickets abiertos."}</p>
              </section>
              <aside className="grid min-w-[280px] flex-[1_1_320px] gap-4">
                <BranchGraph edges={derived.edges} text={branchText} onFicha={() => setFichaOpen(true)} />
                <FixedDecisions items={fixed} onFicha={() => setFichaOpen(true)} />
              </aside>
            </div>
          ) : (
            <>
              <section className="grid gap-3">
                <SectionTitle
                  hint={
                    <>
                      una fila por iniciativa; cada una avanza por su cuenta
                      <span className="hidden md:inline">, de izquierda a derecha</span>
                    </>
                  }
                >
                  En paralelo
                </SectionTitle>
                <LaneGrid slug={slug} lanes={derived.lanes} onOpen={openTask} />
              </section>

              <div className="grid gap-6">
                <section className="grid min-w-0 gap-3">
                  <SectionTitle hint="las fases de cada iniciativa; el punto que late es donde estás">Líneas de trabajo</SectionTitle>
                  {initiativeLanes.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Sin iniciativas abiertas; solo tickets sueltos.</p>
                  ) : (
                    <InitiativeTable lanes={initiativeLanes} onOpen={openTask} />
                  )}
                </section>
                <aside className="grid gap-3">
                  <SectionTitle>Contexto</SectionTitle>
                  <div className="grid items-start gap-4 md:grid-cols-2">
                    <BranchGraph edges={derived.edges} text={branchText} onFicha={() => setFichaOpen(true)} />
                    <FixedDecisions items={fixed} onFicha={() => setFichaOpen(true)} />
                  </div>
                </aside>
              </div>
            </>
          )}

          <FichaSheet
            resume={project.data.resume}
            decisions={project.data.decisions}
            title={project.data.title}
            open={fichaOpen}
            onOpenChange={setFichaOpen}
            onOpen={openTask}
          />
        </>
      )}

      <TaskSheet slug={slug} taskKey={openKey} onOpen={openTask} onClose={closeTask} />
    </div>
  );
}
