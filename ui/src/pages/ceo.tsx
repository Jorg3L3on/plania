// PLA-I30-2: Compañía at /ceo (frames 1a Mac, 1b phone, as overridden by the pinned decisions: no Pedir here,
// Inicio stays at /). Order: greeting → banners → brief → Solo tú → Proyectos → En marcha + Gasto → kill switch.
// Data: GET /api/dashboard (brief, queue, greeting) and GET /api/company (switches, budgets, runs, plan).
// Each block loads and fails on its own (5b, 5c). Sheets live in the URL: ?p=<slug>, ?equipo, ?doc=<id>, ?nuevo.
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router";
import { toast } from "sonner";
import { Brief, Queue } from "@/components/dashboard/ceo-v2";
import {
  BlockError,
  BriefSkeleton,
  Banners,
  CardsSkeleton,
  CompanyPill,
  EnMarcha,
  Gasto,
  KillSwitch,
  ProjectCards,
  SideSkeleton,
  StopBody,
  type CardItem,
} from "@/components/compania/parts";
import {
  EquipoSheetBody,
  LimitForm,
  NewProjectDone,
  NewProjectForm,
  ProjectSheetBody,
  PromptDocBody,
  limitTitle,
  type LimitTarget,
  type NewProjectState,
} from "@/components/compania/sheets";
import { GoalDialog } from "@/components/goals/goal-dialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ApiError, api } from "@/lib/api";
import { bannersOf, byHealth, healthOf, pillOf, sheetOf } from "@/lib/compania";
import { greeting } from "@/lib/greeting";

const dayLabel = (timeZone: string) =>
  new Intl.DateTimeFormat("es-MX", { weekday: "long", day: "numeric", month: "long", timeZone })
    .format(new Date())
    .replace(/^./, (l) => l.toUpperCase());

const useWide = () => {
  const [wide, setWide] = useState(() => typeof window !== "undefined" && window.matchMedia("(min-width: 640px)").matches);
  useEffect(() => {
    const query = window.matchMedia("(min-width: 640px)");
    const onChange = () => setWide(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return wide;
};

// Clocks tick only while something runs.
const useNow = (ticking: boolean) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    if (!ticking) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [ticking]);
  return now;
};

const titleCase = (slug: string) => (slug === "micasa" ? "MiCasa" : slug === "zigzag" ? "ZigZag" : slug.charAt(0).toUpperCase() + slug.slice(1));

type StopScope = { kind: "company" } | { kind: "project"; slug: string; title: string };

const sheetClass = "max-h-[92svh] overflow-y-auto bg-background sm:max-h-none sm:max-w-[560px]";

export const CeoPage = () => {
  const client = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const wide = useWide();
  const dash = useQuery({ queryKey: ["dashboard"], queryFn: api.dashboard, staleTime: 15_000 });
  const comp = useQuery({ queryKey: ["company"], queryFn: api.company, staleTime: 10_000, refetchInterval: 20_000 });
  const company = comp.data;
  const now = useNow((company?.runs.live.length ?? 0) > 0);
  const sheet = sheetOf(location.search);
  const [stop, setStop] = useState<StopScope | null>(null);
  const [limit, setLimit] = useState<LimitTarget | null>(null);
  const [goalFor, setGoalFor] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState<NewProjectState>({ kind: "idle" });

  const timeZone = dash.data?.timezone ?? company?.week.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const { hello, subtitle } = greeting(timeZone);
  const canEdit = company?.viewer?.can_edit_limits ?? true;

  const projectTitle = useMemo(() => {
    const names = new Map((company?.projects ?? []).map((p) => [p.slug, p.title]));
    return (slug: string) => names.get(slug) ?? titleCase(slug);
  }, [company]);

  // /goals lands on #proyectos.
  useEffect(() => {
    if (location.hash !== "#proyectos" || !company) return;
    document.getElementById("proyectos")?.scrollIntoView({ block: "start" });
  }, [location.hash, company]);

  const openSheet = (search: string) => navigate({ pathname: "/ceo", search });
  const closeSheet = () => navigate({ pathname: "/ceo", search: "" }, { replace: true });

  const refresh = () => void client.invalidateQueries({ queryKey: ["company"] });
  const companySwitch = useMutation({
    mutationFn: (paused: boolean) => api.setCompanyPaused(paused),
    onSuccess: (r) => {
      toast(r.paused ? `Compañía detenida${r.stopped ? ` · ${r.stopped} corridas cerrándose` : ""}` : "Compañía en marcha");
      setStop(null);
      refresh();
    },
    onError: () => toast.error("No se pudo cambiar el interruptor"),
  });
  const projectSwitch = useMutation({
    mutationFn: ({ slug, paused }: { slug: string; paused: boolean }) => api.setProjectPaused(slug, paused),
    onSuccess: (r) => {
      toast(r.paused ? `${projectTitle(r.project)} en pausa` : `${projectTitle(r.project)} reanudado`);
      setStop(null);
      refresh();
    },
    onError: () => toast.error("No se pudo cambiar el interruptor del proyecto"),
  });
  const saveLimit = useMutation({
    mutationFn: async ({ target, value }: { target: LimitTarget; value: number | null }) => {
      if (target.kind === "guard") return api.setRunnerSettings({ plan_guard_pct: value ?? target.current });
      if (target.kind === "role") return api.setBudget({ scope: "role", role: target.role, weekly_limit: value });
      return api.setBudget({ scope: "project", project: target.slug, weekly_limit: value });
    },
    onSuccess: () => {
      toast("Guardado");
      setLimit(null);
      refresh();
    },
    onError: () => toast.error("No se pudo guardar"),
  });
  const createProject = useMutation({
    mutationFn: (input: { name: string; goal: string }) => api.createCompanyProject(input),
    onMutate: () => setCreating({ kind: "busy" }),
    onSuccess: (result, input) => {
      setCreating({ kind: "done", result, name: input.name, goal: input.goal });
      refresh();
    },
    onError: (e) => {
      if (e instanceof ApiError && (e.status === 404 || e.status === 405)) setCreating({ kind: "missing" });
      else setCreating({ kind: "error", message: e instanceof ApiError ? `No se pudo crear (${e.code}).` : "No se pudo crear el proyecto." });
    },
  });

  const projectSheet = useQuery({
    queryKey: ["company-project", sheet?.kind === "project" ? sheet.slug : ""],
    queryFn: () => api.companyProject(sheet?.kind === "project" ? sheet.slug : ""),
    enabled: sheet?.kind === "project",
  });
  const doc = useQuery({
    queryKey: ["prompt-doc", sheet?.kind === "doc" ? sheet.id : ""],
    queryFn: () => api.promptDoc(sheet?.kind === "doc" ? sheet.id : ""),
    enabled: sheet?.kind === "doc",
  });
  const goals = useQuery({ queryKey: ["goals"], queryFn: () => api.goals(), enabled: goalFor !== null });

  const needsJorge = useMemo(
    () => new Set((dash.data?.queue ?? []).filter((q) => q.kind === "decidir" || q.kind === "atorado").map((q) => q.project)),
    [dash.data],
  );
  const cards: CardItem[] = useMemo(() => {
    if (!company) return [];
    return company.projects
      .map((project) => {
        const facts = company.project_facts?.[project.slug];
        return { project, facts, health: healthOf(project, facts, { companyPaused: company.company.paused, needsJorge: needsJorge.has(project.slug), now }) };
      })
      .sort(byHealth);
  }, [company, needsJorge, now]);

  const pill = pillOf(company, comp.isError && !company);
  const banners = company ? bannersOf(company) : [];
  const liveRuns = company?.runs.live ?? [];
  const sheetProject = sheet?.kind === "project" ? company?.projects.find((p) => p.slug === sheet.slug) : undefined;
  const sheetCard = sheetProject ? cards.find((c) => c.project.slug === sheetProject.slug) : undefined;

  const onPill = () => {
    if (!company) return void comp.refetch();
    if (company.company.paused) return companySwitch.mutate(false);
    setStop({ kind: "company" });
  };

  return (
    <div className="mx-auto grid w-full max-w-6xl gap-5">
      <header className="grid gap-1">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="font-display text-4xl leading-[0.95] font-extrabold tracking-[-0.03em] sm:text-5xl">
            {company && company.projects.length === 0 ? "Hola" : hello}, {dash.data?.name ?? "Jorge"}
          </h1>
          <CompanyPill pill={pill} onClick={onPill} />
        </div>
        <p className="text-sm text-muted-foreground">
          {dayLabel(timeZone)} · {subtitle}
        </p>
      </header>

      {comp.isError && !company && <BlockError what="la compañía" onRetry={() => void comp.refetch()} />}
      {company && (
        <Banners
          banners={banners}
          canEdit={canEdit}
          timeZone={timeZone}
          dismissed={dismissed}
          onDismiss={(slug) => setDismissed(new Set([...dismissed, slug]))}
          onResume={() => companySwitch.mutate(false)}
          onRaise={(p) => setLimit({ kind: "project", slug: p.slug, title: p.title, current: p.budget.limit })}
          onMoveGuard={() => setLimit({ kind: "guard", current: company.plan.guard_pct })}
          onSeeSpend={() => document.getElementById("gasto")?.scrollIntoView({ behavior: "smooth", block: "start" })}
        />
      )}

      {dash.isPending ? (
        <BriefSkeleton />
      ) : dash.isError || !dash.data ? (
        <BlockError what="el brief" onRetry={() => void dash.refetch()} />
      ) : (
        <>
          <Brief lines={dash.data.brief} title="Brief de hoy" sign="Asistente · jefa de gabinete" />
          <Queue items={dash.data.queue} title="Solo tú" note="Nada se detiene por esto: el equipo sigue con lo demás." onAssign={() => navigate("/inbox")} />
        </>
      )}

      {comp.isPending ? (
        <CardsSkeleton />
      ) : company ? (
        <ProjectCards
          items={cards}
          now={now}
          onOpen={(slug) => openSheet(`?p=${encodeURIComponent(slug)}`)}
          onResume={(slug) => projectSwitch.mutate({ slug, paused: false })}
          onWriteGoal={(slug) => setGoalFor(slug)}
          onNew={() => {
            setCreating({ kind: "idle" });
            openSheet("?nuevo");
          }}
          onEquipo={() => openSheet("?equipo")}
        />
      ) : null}

      {comp.isPending ? (
        <SideSkeleton />
      ) : company ? (
        <>
          <div className="grid items-start gap-4 lg:grid-cols-2">
            <EnMarcha company={company} now={now} projectTitle={projectTitle} />
            <Gasto company={company} canEdit={canEdit} projectTitle={projectTitle} onMoveGuard={() => setLimit({ kind: "guard", current: company.plan.guard_pct })} />
          </div>
          <KillSwitch company={company} onStop={() => setStop({ kind: "company" })} onResume={() => companySwitch.mutate(false)} />
        </>
      ) : null}

      {/* Project sheet (2a side, 2b bottom) */}
      <Sheet open={sheet?.kind === "project"} onOpenChange={(open) => !open && closeSheet()}>
        <SheetContent side={wide ? "right" : "bottom"} className={sheetClass}>
          <SheetHeader className="pr-10">
            <SheetTitle className="font-display text-2xl font-extrabold tracking-tight break-words">
              {sheetProject?.title ?? (sheet?.kind === "project" ? titleCase(sheet.slug) : "")}
            </SheetTitle>
            <SheetDescription className="sr-only">Hoja del proyecto</SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-8">
            {sheetProject && sheetCard && company ? (
              <ProjectSheetBody
                project={sheetProject}
                facts={sheetCard.facts}
                health={sheetCard.health}
                sheet={projectSheet.data}
                sheetError={projectSheet.isError}
                onRetry={() => void projectSheet.refetch()}
                canEdit={canEdit}
                companyPaused={company.company.paused}
                now={now}
                onEditBudget={() => setLimit({ kind: "project", slug: sheetProject.slug, title: sheetProject.title, current: sheetProject.budget.limit })}
                onEditGoal={() => setGoalFor(sheetProject.slug)}
                onPause={() => setStop({ kind: "project", slug: sheetProject.slug, title: sheetProject.title })}
                onResume={() => projectSwitch.mutate({ slug: sheetProject.slug, paused: false })}
              />
            ) : comp.isPending ? (
              <div className="h-40 animate-pulse rounded-xl bg-muted" />
            ) : (
              <p className="text-sm text-muted-foreground">Ese proyecto no está.</p>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Equipo sheet (3a / 3b) */}
      <Sheet open={sheet?.kind === "equipo"} onOpenChange={(open) => !open && closeSheet()}>
        <SheetContent side={wide ? "right" : "bottom"} className={sheetClass}>
          <SheetHeader className="pr-10">
            <SheetTitle className="font-display text-2xl font-extrabold tracking-tight">Equipo</SheetTitle>
            <SheetDescription>Los roles reales, en Claude Code. Cada uno lee su prompt de Plania.</SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-8">
            {company ? (
              <EquipoSheetBody
                company={company}
                canEdit={canEdit}
                now={now}
                projectTitle={projectTitle}
                onEditBudget={(role) => setLimit({ kind: "role", role, current: company.roles.find((r) => r.role === role)?.budget.limit ?? null })}
              />
            ) : (
              <div className="h-40 animate-pulse rounded-xl bg-muted" />
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Prompt ↗ */}
      <Sheet open={sheet?.kind === "doc"} onOpenChange={(open) => !open && closeSheet()}>
        <SheetContent side={wide ? "right" : "bottom"} className={sheetClass}>
          <SheetHeader className="pr-10">
            <SheetTitle className="font-display text-xl font-extrabold tracking-tight">{doc.data?.title ?? "Prompt"}</SheetTitle>
            <SheetDescription className="sr-only">Prompt del rol</SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-8">
            {doc.data ? (
              <PromptDocBody doc={doc.data} />
            ) : doc.isError ? (
              <BlockError what="el prompt" onRetry={() => void doc.refetch()} />
            ) : (
              <div className="h-40 animate-pulse rounded-xl bg-muted" />
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* New project (4a / 4b) */}
      <Dialog open={sheet?.kind === "nuevo"} onOpenChange={(open) => !open && closeSheet()}>
        <DialogContent className="bg-background sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl font-extrabold tracking-tight">
              {creating.kind === "done" ? `${creating.name} está listo` : "Nuevo proyecto"}
            </DialogTitle>
            <DialogDescription>
              {creating.kind === "done" ? "Alguien ya está a cargo: su product owner." : "Un nombre y una meta. Lo demás tiene valores por defecto."}
            </DialogDescription>
          </DialogHeader>
          {creating.kind === "done" ? (
            <NewProjectDone state={creating} onOpen={(slug) => openSheet(`?p=${encodeURIComponent(slug)}`)} onClose={closeSheet} />
          ) : (
            <NewProjectForm state={creating} onSubmit={(input) => createProject.mutate(input)} onCancel={closeSheet} />
          )}
        </DialogContent>
      </Dialog>

      {/* 5i: stop the company or pause a project */}
      <Sheet open={stop !== null} onOpenChange={(open) => !open && setStop(null)}>
        <SheetContent side="bottom" className="mx-auto max-h-[85svh] w-full max-w-xl overflow-y-auto rounded-t-[22px] bg-background">
          <SheetHeader className="pr-10">
            <SheetTitle className="font-display text-2xl font-extrabold tracking-tight">
              {stop?.kind === "project" ? `¿Pausar ${stop.title}?` : "¿Detener la compañía?"}
            </SheetTitle>
            <SheetDescription>Se puede deshacer: reanudas cuando quieras.</SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-8">
            {stop && (
              <StopBody
                scope={stop}
                runs={liveRuns}
                projectTitle={projectTitle}
                busy={companySwitch.isPending || projectSwitch.isPending}
                onCancel={() => setStop(null)}
                onConfirm={() => (stop.kind === "company" ? companySwitch.mutate(true) : projectSwitch.mutate({ slug: stop.slug, paused: true }))}
              />
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Jorge-only limits */}
      <Dialog open={limit !== null} onOpenChange={(open) => !open && setLimit(null)}>
        <DialogContent className="bg-background sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-display text-xl font-extrabold tracking-tight">{limit ? limitTitle(limit) : ""}</DialogTitle>
            <DialogDescription>Solo tú cambias límites. Los agentes no pueden.</DialogDescription>
          </DialogHeader>
          {limit && <LimitForm target={limit} busy={saveLimit.isPending} onCancel={() => setLimit(null)} onSave={(value) => saveLimit.mutate({ target: limit, value })} />}
        </DialogContent>
      </Dialog>

      {goalFor !== null && (
        <GoalDialog
          open
          fixedProject={goalFor}
          goal={(goals.data?.goals ?? []).find((g) => g.project === goalFor && g.status === "active") ?? null}
          projects={(company?.projects ?? []).map((p) => ({ slug: p.slug, title: p.title }))}
          parents={(goals.data?.goals ?? []).filter((g) => g.project === null)}
          onOpenChange={(open) => {
            if (open) return;
            setGoalFor(null);
            refresh();
            void client.invalidateQueries({ queryKey: ["company-project"] });
          }}
        />
      )}
    </div>
  );
};
