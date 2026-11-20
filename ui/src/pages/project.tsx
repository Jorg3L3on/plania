import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2Icon, ChevronLeftIcon, ListIcon, Settings2Icon, WaypointsIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { Skeleton } from "@/components/ui/skeleton";
import { StageBoard } from "@/components/plan/stage-board";
import { AhoraLine } from "@/components/plan/ahora-line";
import { ahoraView } from "@/lib/ahora-piso";
import { listedProjects } from "@/lib/proyectos-visibles";
import {
  BranchGraph,
  FichaSheet,
  FixedDecisions,
  IdeasTable,
  InitiativeTable,
  ProjectHeader,
  SectionTitle,
} from "@/components/plan/project-parts";
import { GoalsProject } from "@/components/goals/goals-board";
import { OrdenSection } from "@/components/plan/orden";
import { QuestionsPanel } from "@/components/resume";
import { TaskList } from "@/components/plan/task-list";
import { Kicker } from "@/components/plan/visuals";
import { ProjectOrgBar, ProjectTeam, ThreadPanel, type AddState } from "@/components/compania/org";
import { BlockError, StopBody } from "@/components/compania/parts";
import { useThread } from "@/components/compania/use-thread";
import { GoalDialog } from "@/components/goals/goal-dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { toast } from "sonner";
import { TaskSheet } from "@/components/task-sheet";
import { api, ApiError, type OrgProject } from "@/lib/api";
import { listoAviso } from "@/lib/listo";
import { words } from "@/lib/i18n";
import { PROJECT_PAGE } from "@/lib/project-page-words";
import { linkTo } from "@/lib/corriente";
import { ListoLista } from "@/components/listo";
import { branchEdges, buildLanes, projectProgress, statusCounts } from "@/lib/lanes";
import { cn } from "@/lib/utils";

type View = "lanes" | "lista";

function ViewToggle({ view, onChange }: { view: View; onChange: (v: View) => void }) {
  const w = words(PROJECT_PAGE);
  const options: { value: View; label: string; icon: typeof ListIcon }[] = [
    { value: "lanes", label: w.lanes, icon: WaypointsIcon },
    { value: "lista", label: w.list, icon: ListIcon },
  ];
  return (
    <div role="group" aria-label={w.view} className="inline-flex rounded-full border bg-card p-1">
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

// PLA-I33-2: the top of /p/<slug>: light, goal, plumbing line, Pausar/Reanudar; the team with Añadir al
// equipo; the thread with the PO ("Dile al PO…"). The one Pedir: a message here wakes the PO.
function ProjectOrg({ slug }: { slug: string }) {
  const w = words(PROJECT_PAGE);
  const client = useQueryClient();
  const comp = useQuery({ queryKey: ["company"], queryFn: api.company, staleTime: 10_000, refetchInterval: 20_000 });
  const detail = useQuery({ queryKey: ["company-project", slug], queryFn: () => api.companyProject(slug), refetchInterval: 30_000 });
  const project: OrgProject | undefined = comp.data?.projects.find((p) => p.slug === slug);
  const threadId = detail.data?.thread_id ?? project?.thread.id;
  const po = useThread(threadId, { who: "el PO", invalidate: [["company"], ["company-project", slug]] });
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  const [add, setAdd] = useState<AddState>({ kind: "idle" });
  const [stop, setStop] = useState(false);
  const [goalOpen, setGoalOpen] = useState(false);
  // NEWPROJ-4: one quiet line while something stops a run here; it opens the readiness list.
  const listo = useQuery({ queryKey: ["readiness", slug], queryFn: () => api.readiness(slug), refetchInterval: 60_000 });
  const [listoOpen, setListoOpen] = useState(false);
  const aviso = listo.data ? listoAviso(listo.data) : null;
  const goals = useQuery({ queryKey: ["goals"], queryFn: () => api.goals(), enabled: goalOpen });
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["company"] });
    void client.invalidateQueries({ queryKey: ["company-project", slug] });
  };
  const addMember = useMutation({
    mutationFn: (template: string) => api.addToTeam(slug, template),
    onMutate: () => setAdd({ kind: "busy" }),
    onSuccess: (r) => {
      setAdd({ kind: "done", agent: r.agent.agent });
      refresh();
    },
    onError: (e) => setAdd({ kind: "error", message: e instanceof ApiError ? w.addFailedCode(e.code) : w.addFailed }),
  });
  const pause = useMutation({
    mutationFn: (paused: boolean) => api.setProjectPaused(slug, paused),
    onSuccess: (r) => {
      toast(r.paused ? w.paused : w.resumed);
      setStop(false);
      refresh();
    },
    onError: () => toast.error(w.switchFailed),
  });

  if (comp.isError && detail.isError) return <BlockError what={w.theTeam} onRetry={() => { void comp.refetch(); void detail.refetch(); }} />;
  if (!project) return comp.isPending ? <Skeleton className="h-48 rounded-[22px]" /> : null;
  const paused = project.paused || project.light === "paused";
  const timeZone = comp.data?.week.timezone;
  return (
    <>
      <ProjectOrgBar
        project={project}
        companyPaused={comp.data?.company.paused ?? false}
        canEdit
        onEditGoal={() => setGoalOpen(true)}
        onPause={() => setStop(true)}
        onResume={() => pause.mutate(false)}
      />
      {aviso && (
        <button type="button" className="-mt-2 justify-self-start text-left text-sm text-ink-now underline-offset-4 hover:underline" onClick={() => setListoOpen(true)} data-control="ver-listo">
          {aviso} <span className="text-muted-foreground">{w.seeMissing}</span>
        </button>
      )}
      <Sheet open={listoOpen && !!listo.data} onOpenChange={setListoOpen}>
        <SheetContent side="bottom" className="mx-auto max-h-[85svh] w-full max-w-xl overflow-y-auto rounded-t-[22px] bg-background">
          <SheetHeader className="pr-10">
            <SheetTitle className="font-display text-2xl font-extrabold tracking-tight">{w.missingTitle(project.title)}</SheetTitle>
            <SheetDescription>{aviso ?? w.nothingMissing}</SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-8">
            {listo.data && (
              <ListoLista
                r={listo.data}
                look="page"
                ajustes={
                  // NEWPROJ-6: what is missing is set in the project's Ajustes door.
                  <Link to={linkTo({ slug, tab: "ajustes" })} className="inline-flex min-h-11 items-center justify-self-start rounded-full border bg-card px-4 text-sm font-medium hover:bg-foreground/5" data-control="ir-ajustes">
                    {w.openSettings}
                  </Link>
                }
              />
            )}
          </div>
        </SheetContent>
      </Sheet>
      <div className="grid min-w-0 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        {detail.isError ? (
          <BlockError what={w.theTeam} onRetry={() => void detail.refetch()} />
        ) : (
          <ProjectTeam
            project={slug}
            team={detail.data?.team ?? project.team}
            runs={detail.data?.runs}
            templates={detail.data?.templates ?? []}
            now={now}
            add={add}
            onAdd={(template) => addMember.mutate(template)}
            canEdit
          />
        )}
        <ThreadPanel
          title="PO"
          subtitle={<p className="-mt-2 text-xs text-muted-foreground">{w.poHint}</p>}
          project={slug}
          now={now}
          timeZone={timeZone}
          placeholder={w.poPlaceholder}
          readOnly={paused ? w.poPaused : null}
          {...po}
        />
      </div>
      <Sheet open={stop} onOpenChange={setStop}>
        <SheetContent side="bottom" className="mx-auto max-h-[85svh] w-full max-w-xl overflow-y-auto rounded-t-[22px] bg-background">
          <SheetHeader className="pr-10">
            <SheetTitle className="font-display text-2xl font-extrabold tracking-tight">{w.pauseTitle(project.title)}</SheetTitle>
            <SheetDescription>{w.pauseNote}</SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-8">
            <StopBody
              scope={{ kind: "project", slug, title: project.title }}
              runs={[]}
              projectTitle={() => project.title}
              busy={pause.isPending}
              onCancel={() => setStop(false)}
              onConfirm={() => pause.mutate(true)}
            />
          </div>
        </SheetContent>
      </Sheet>
      {goalOpen && (
        <GoalDialog
          open
          fixedProject={slug}
          goal={(goals.data?.goals ?? []).find((g) => g.project === slug && g.status === "active") ?? null}
          projects={listedProjects(comp.data?.projects ?? [], slug).map((p) => ({ slug: p.slug, title: p.title }))}
          parents={(goals.data?.goals ?? []).filter((g) => g.project === null)}
          onOpenChange={(open) => {
            if (open) return;
            setGoalOpen(false);
            refresh();
          }}
        />
      )}
    </>
  );
}

// PLA-I53-4: the floor's Ahora line, built from the same company card the floor reads, so it says the same words.
function ProjectAhora({ slug }: { slug: string }) {
  const w = words(PROJECT_PAGE);
  const comp = useQuery({ queryKey: ["company"], queryFn: api.company, staleTime: 10_000, refetchInterval: 20_000 });
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  const card = comp.data?.projects.find((p) => p.slug === slug);
  if (!card) return null;
  const view = ahoraView(card, now, { companyPaused: comp.data?.company.paused ?? false, timeZone: comp.data?.week.timezone });
  return (
    <section className="rounded-[20px] border bg-card px-5 py-4" aria-label={w.now} data-section="ahora">
      <AhoraLine view={view} />
    </section>
  );
}

export function ProjectPage() {
  const w = words(PROJECT_PAGE);
  const { slug = "" } = useParams();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);
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
  const ideas = useMemo(() => (tasks ?? []).filter((t) => t.kind === "idea"), [tasks]);
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
  // Pinned decisions that still stand, project-wide and per initiative.
  const fixed = resume
    ? [...new Map([...resume.must_keep, ...resume.initiatives.flatMap((i) => i.must_keep)].map((d) => [d.id, d])).values()]
        .filter((d) => !d.superseded_by)
        .map((d) => d.text)
    : [];
  // 2.11: each open initiative's derived state line, with its note as commentary.
  const initiativeLines = Object.fromEntries((resume?.initiatives ?? []).map((i) => [i.key, { line: i.state?.line ?? "", note: i.state_note ?? "" }]));
  const nowText = resume ? resume.claims.map((c) => `${c.title} (${c.owner?.agent ?? "?"})`).join(", ") : "";
  const nextText = resume ? resume.next_claimable?.title ?? "" : "";

  if (project.isError) {
    const notFound = project.error instanceof ApiError && project.error.status === 404;
    return (
      <div className="grid gap-2">
        <p>{notFound ? w.notFound : w.loadFailed}</p>
        <Link to="/" className="text-sm text-muted-foreground underline">{w.backToProjects}</Link>
      </div>
    );
  }

  const initiativeLanes = derived.lanes.filter((l) => l.initiative);
  // PLA-I53-5: En paralelo is the floor's stage board, from the same server read (tablero, etapa); the completed
  // initiatives fold into one line under it.
  const tablero = project.data?.tablero;
  const hasBoard = !!tablero && (tablero.initiatives.length > 0 || tablero.loose.length > 0 || tablero.loose_done > 0);
  const folded = (tasks ?? []).filter((t) => t.kind === "initiative" && t.status === "Done").map((t) => ({ key: t.key, title: t.title }));

  return (
    // grid-cols-1 keeps the track at the viewport: no section can widen the page on phones.
    <div className="grid grid-cols-1 gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Link to="/" className="inline-flex min-h-9 items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
          <ChevronLeftIcon className="size-4" /> {w.projects}
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          {/* PLA-I53-5: the way back to this project's floor in Compañía. */}
          <Link
            to={`/ceo?piso=${encodeURIComponent(slug)}`}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-full border bg-card px-3.5 text-[13px] font-medium hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            data-control="ver-piso"
          >
            <Building2Icon className="size-3.5" aria-hidden /> {w.seeFloor}
          </Link>
          {/* NEWPROJ-6: the project's settings (La corriente's Ajustes door). */}
          <Link
            to={linkTo({ slug, tab: "ajustes" })}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-full border bg-card px-3.5 text-[13px] font-medium hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            data-control="ajustes"
          >
            <Settings2Icon className="size-3.5" aria-hidden /> {w.settings}
          </Link>
          <ViewToggle view={view} onChange={(v) => setParam("view", v === "lista" ? "lista" : null)} />
        </div>
      </div>

      {!project.data ? (
        <PageSkeleton />
      ) : (
        <>
          <ProjectHeader
            slug={slug}
            title={project.data.title}
            lanes={derived.lanes}
            progress={derived.progress}
            counts={derived.counts}
            headline={resume?.headline}
            version={project.data.version}
            release={resume?.status?.release}
            onOpen={openTask}
          />
          <ProjectOrg slug={slug} />
          <GoalsProject slug={slug} />
          {/* Questions agents asked the owner (Needs owner): answer in place, with an optional line for the decision log. */}
          <QuestionsPanel slug={slug} questions={project.data.resume.open_questions} onOpen={openTask} />
          <ProjectAhora slug={slug} />

          {view === "lista" ? (
            <TaskList slug={slug} tasks={project.data.tasks} openKey={openKey} onOpen={openTask} />
          ) : derived.lanes.length === 0 && ideas.length === 0 ? (
            <div className="flex flex-wrap items-start gap-7">
              <section className="grid min-w-0 flex-[999_1_560px] animate-rise gap-3 rounded-[20px] border border-dashed bg-card/50 px-5 py-6 sm:px-6 sm:py-8">
                <Kicker className="text-muted-foreground">{w.nothingOpen}</Kicker>
                {nowText && <p className="text-[15px] text-muted-foreground">{nowText}</p>}
                <Kicker className="mt-2 text-ink-ready">{w.next}</Kicker>
                <p className="font-display text-2xl font-bold tracking-tight">{nextText || w.noneOpen}</p>
              </section>
              <aside className="grid min-w-0 flex-[1_1_320px] gap-4 sm:min-w-[280px]">
                <BranchGraph edges={derived.edges} />
                <FixedDecisions items={fixed} onFicha={() => setFichaOpen(true)} />
              </aside>
            </div>
          ) : (
            <>
              {hasBoard && (
                <section className="grid min-w-0 gap-3" data-section="tablero">
                  <SectionTitle hint={w.boardHint}>{w.inParallel}</SectionTitle>
                  <StageBoard
                    tablero={tablero!}
                    now={now}
                    selected={openKey}
                    onTicket={(t) => openTask(t.key)}
                    onTrack={(key) => key && openTask(key)}
                    onDone={(key) => key && openTask(key)}
                    folded={folded}
                    onFolded={(key) => openTask(key)}
                    label={w.boardLabel(project.data.title)}
                    className="dark sb-page"
                  />
                </section>
              )}

              <div className="grid grid-cols-1 gap-6">
                <section className="grid min-w-0 gap-3">
                  <SectionTitle hint={w.linesHint}>{w.workLines}</SectionTitle>
                  {initiativeLanes.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{w.onlyLoose}</p>
                  ) : (
                    <InitiativeTable lanes={initiativeLanes} onOpen={openTask} lines={initiativeLines} />
                  )}
                </section>
                <section className="grid min-w-0 gap-3" aria-label={w.ideas}>
                  <SectionTitle hint={w.ideasHint}>{w.ideas}</SectionTitle>
                  <IdeasTable ideas={ideas} onOpen={openTask} />
                </section>
                <aside className="grid gap-3">
                  <SectionTitle>{w.context}</SectionTitle>
                  <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2">
                    <BranchGraph edges={derived.edges} />
                    <FixedDecisions items={fixed} onFicha={() => setFichaOpen(true)} />
                  </div>
                </aside>
              </div>
            </>
          )}

          {/* 2.11: the audit on screen, collapsed with its count. */}
          <OrdenSection slug={slug} onOpen={openTask} />

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
