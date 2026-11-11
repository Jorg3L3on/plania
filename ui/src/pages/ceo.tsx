// PLA-I35: Compañía v2 (Design afdb15dd v2, canvas docs/company-mockups/compania-v2.html). A report, not a
// board of bots: Te toca on top (the decisions, options with names), Asistente folded on the left (360 px on a
// Mac), on the right each running project as a report card and the paused ones as a list with Reanudar.
// Phone: one column, Te toca first. Plumbing lives in Máquina; one line in the header links there.
// Data: GET /api/company (decisions[] included) and GET /api/threads/:id; POST /api/company/decisions/:id acts.
// URL: ?doc=<id> a doc, ?nuevo the new project dialog; ?p=<slug> and ?vista=<slug> redirect to /p/<slug>,
// ?equipo to Máquina.
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate, useLocation, useNavigate } from "react-router";
import { BlockError, eyebrow, panel, pillGhost, pillPrimary } from "@/components/compania/parts";
import { CompanyPlumbing, ThreadSkeleton } from "@/components/compania/org";
import { AsistenteFolded, PausedList, ProjectReport, ProjectsSkeleton, TeToca, type DecisionBusy } from "@/components/compania/v2";
import { NewProjectDone, NewProjectForm, PromptDocBody, type NewProjectState } from "@/components/compania/sheets";
import { useThread } from "@/components/compania/use-thread";
import { GoalDialog } from "@/components/goals/goal-dialog";
import type { Goal } from "@/components/goals/model";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ApiError, api, type Decision, type DecisionInput, type OrgProject } from "@/lib/api";
import { ceoRedirect, sheetOf } from "@/lib/compania";
import { byLight } from "@/lib/org";
import { greeting } from "@/lib/greeting";
import { cn } from "@/lib/utils";
import { companyLine } from "@/lib/v2";

const dayLabel = (timeZone: string) =>
  new Intl.DateTimeFormat("es-MX", { weekday: "long", day: "numeric", month: "long", timeZone })
    .format(new Date())
    .replace(/^./, (l) => l.toUpperCase());

export const useWide = () => {
  const [wide, setWide] = useState(() => typeof window !== "undefined" && window.matchMedia("(min-width: 640px)").matches);
  useEffect(() => {
    const query = window.matchMedia("(min-width: 640px)");
    const onChange = () => setWide(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return wide;
};

// "hace 5 min" keeps moving without a refetch.
export const useMinute = () => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
};

const sheetClass = "max-h-[92svh] overflow-y-auto bg-background sm:max-h-none data-[side=right]:sm:max-w-[560px]";

export const CeoPage = () => {
  const location = useLocation();
  // Old links: the project sheet is now the project page, the Equipo sheet now lives in Máquina.
  const to = ceoRedirect(location.search);
  return to ? <Navigate to={to} replace /> : <Compania />;
};

const DECISION_REFUSAL: Record<string, string> = {
  ALREADY_ACTED: "Ya actuaste sobre esto.",
  CHECKS_OPEN: "El ticket tiene checks abiertos.",
  NOT_IN_REVIEW: "Ya no está en revisión.",
  MERGE_FAILED: "No se pudo fusionar: revisa el PR.",
  BASE_NOT_SANDBOX: "El PR no apunta a sandbox.",
  OWNER_CODE: "Publicar se hace en Bandeja, con tu código.",
};

const Compania = () => {
  const client = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const wide = useWide();
  const now = useMinute();
  const comp = useQuery({ queryKey: ["company"], queryFn: api.company, staleTime: 10_000, refetchInterval: 20_000 });
  const company = comp.data;
  const sheet = sheetOf(location.search);
  const [creating, setCreating] = useState<NewProjectState>({ kind: "idle" });

  const timeZone = company?.week.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const { hello } = greeting(timeZone);
  const asistente = useThread(company?.asistente.thread_id, { who: "Asistente", invalidate: [["company"]] });
  const doc = useQuery({
    queryKey: ["prompt-doc", sheet?.kind === "doc" ? sheet.id : ""],
    queryFn: () => api.promptDoc(sheet?.kind === "doc" ? sheet.id : ""),
    enabled: sheet?.kind === "doc",
  });

  const projects = useMemo(() => [...(company?.projects ?? [])].sort(byLight), [company]);
  const live = projects.filter((p) => !p.paused && p.light !== "paused");
  const paused = projects.filter((p) => p.paused || p.light === "paused");
  const titles = useMemo(() => Object.fromEntries(projects.map((p) => [p.slug, p.title])), [projects]);
  const openSheet = (search: string) => navigate({ pathname: "/ceo", search });
  const closeSheet = () => navigate({ pathname: "/ceo", search: "" }, { replace: true });

  // Te toca: the result is written in the row at once; the next read keeps it (acted rows stay 24 h).
  const [acted, setActed] = useState<Record<string, Decision>>({});
  const [busy, setBusy] = useState<DecisionBusy>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const decisions = useMemo(() => (company?.decisions ?? []).map((d) => acted[d.id] ?? d), [company, acted]);
  const act = useMutation({
    mutationFn: (v: { d: Decision; input: DecisionInput; key: string }) => api.actDecision(v.d.id, v.input),
    onMutate: (v) => {
      setBusy({ id: v.d.id, key: v.key });
      setErrors((e) => ({ ...e, [v.d.id]: "" }));
    },
    onSuccess: (r, v) => {
      setActed((a) => ({ ...a, [v.d.id]: r.decision ?? { ...v.d, state: r.state, actions: [] } }));
      void client.invalidateQueries({ queryKey: ["company"] });
      void client.invalidateQueries({ queryKey: ["thread"] });
    },
    onError: (e, v) =>
      setErrors((x) => ({
        ...x,
        [v.d.id]: e instanceof ApiError ? (DECISION_REFUSAL[e.code] ?? `No se pudo (${e.code}).`) : "No se pudo. Si la Mac está dormida, intenta al despertar.",
      })),
    onSettled: () => setBusy(null),
  });
  // PLA-I36-4: Fijar opens the goal dialog for that project's goal (the placeholder is edited, not kept).
  const [fijar, setFijar] = useState<OrgProject | null>(null);
  const fijarGoal: Goal | null =
    fijar?.rumbo?.goal_id != null
      ? {
          id: fijar.rumbo.goal_id,
          title: fijar.rumbo.goal ?? "",
          why: fijar.rumbo.why,
          status: "active",
          target_on: fijar.rumbo.target_on,
          position: 0,
          project: fijar.slug,
          parent_id: null,
          progress: { done: 0, total: 0 },
          initiatives: [],
          children: [],
        }
      : null;
  const [resuming, setResuming] = useState<string | null>(null);
  const resume = useMutation({
    mutationFn: (slug: string) => api.setProjectPaused(slug, false),
    onMutate: (slug) => setResuming(slug),
    onSettled: () => {
      setResuming(null);
      void client.invalidateQueries({ queryKey: ["company"] });
    },
  });

  const createProject = useMutation({
    mutationFn: (input: { name: string; goal: string }) => api.createCompanyProject(input),
    onMutate: () => setCreating({ kind: "busy" }),
    onSuccess: (result, input) => {
      setCreating({ kind: "done", result, name: input.name, goal: input.goal });
      void client.invalidateQueries({ queryKey: ["company"] });
    },
    onError: (e) => {
      if (e instanceof ApiError && (e.status === 404 || e.status === 405)) setCreating({ kind: "missing" });
      else setCreating({ kind: "error", message: e instanceof ApiError ? `No se pudo crear (${e.code}).` : "No se pudo crear el proyecto." });
    },
  });
  const onNew = () => {
    setCreating({ kind: "idle" });
    openSheet("?nuevo");
  };

  return (
    <div className="mx-auto grid w-full max-w-6xl min-w-0 gap-5">
      <header className="grid min-w-0 gap-1">
        <h1 className="font-display text-4xl leading-[0.95] font-extrabold tracking-[-0.03em] sm:text-5xl">
          {company && company.projects.length === 0 ? "Hola" : hello}, Jorge
        </h1>
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <p className="min-w-0 text-sm text-muted-foreground">
            {dayLabel(timeZone)}
            {company && company.projects.length > 0 ? ` · ${companyLine(company.projects)}` : ""}
          </p>
          {company && <CompanyPlumbing plumbing={company.plumbing} />}
        </div>
        {company?.company.paused && (
          <p role="status" data-banner="paused" className="mt-2 rounded-[16px] bg-surface-sunken px-4 py-2.5 text-sm ring-1 ring-foreground/15">
            La compañía está detenida: nada arranca. Se reanuda en Máquina.
          </p>
        )}
      </header>

      {comp.isError && !company && <BlockError what="la compañía" onRetry={() => void comp.refetch()} />}

      {comp.isPending ? (
        <div className="h-36 animate-pulse rounded-[22px] bg-muted" aria-hidden data-testid="te-toca-skeleton" />
      ) : company ? (
        <TeToca decisions={decisions} inbox={company.inbox} open={new URLSearchParams(location.search).get("decision")} titles={titles} now={now} busy={busy} errors={errors} onAct={(d, input, key) => act.mutate({ d, input, key })} />
      ) : null}

      <div className="grid min-w-0 items-start gap-5 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
        <div className="min-w-0 lg:sticky lg:top-20">
          {comp.isPending ? (
            <ThreadSkeleton />
          ) : company ? (
            <AsistenteFolded
              thread={asistente.thread}
              loading={asistente.loading}
              error={asistente.error}
              onRetry={asistente.onRetry}
              projects={projects}
              now={now}
              timeZone={timeZone}
              send={asistente.send}
              onSend={asistente.onSend}
              expanded={asistente.expanded}
              onToggle={asistente.onToggle}
            />
          ) : null}
        </div>
        <section id="proyectos" aria-labelledby="cia-proyectos" className="grid min-w-0 scroll-mt-20 content-start gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 id="cia-proyectos" className={eyebrow}>
              Proyectos <span className="ml-1 font-mono text-foreground">{projects.length}</span>
            </h2>
            <button type="button" className={cn(pillGhost, "min-h-9 px-3 text-[13px]")} onClick={onNew}>
              + Nuevo proyecto
            </button>
          </div>
          {comp.isPending ? (
            <ProjectsSkeleton />
          ) : company && projects.length === 0 ? (
            <div className={cn(panel, "grid justify-items-start gap-3 p-5")} data-empty="projects">
              <p className="font-display text-lg font-extrabold tracking-tight">Todavía no hay proyectos</p>
              <p className="text-sm text-muted-foreground">Un proyecto es un nombre y una meta. Llega con su equipo: PO, Research, Artist y Taller.</p>
              <button type="button" className={pillPrimary} onClick={onNew}>
                Crear el primer proyecto
              </button>
            </div>
          ) : company ? (
            <>
              {live.length > 0 && (
                <ul className={cn("grid min-w-0 gap-3", live.length > 1 && "xl:grid-cols-2")} data-testid="project-cards">
                  {live.map((p) => (
                    <ProjectReport key={p.slug} project={p} decisions={decisions} now={now} companyPaused={company.company.paused} timeZone={timeZone} onFijar={setFijar} />
                  ))}
                </ul>
              )}
              <PausedList projects={paused} now={now} busy={resuming} onResume={(slug) => resume.mutate(slug)} />
            </>
          ) : null}
        </section>
      </div>

      {/* A doc linked from a message or a role row */}
      <Sheet open={sheet?.kind === "doc"} onOpenChange={(open) => !open && closeSheet()}>
        <SheetContent side={wide ? "right" : "bottom"} className={sheetClass}>
          <SheetHeader className="pr-10">
            <SheetTitle className="font-display text-xl font-extrabold tracking-tight">{doc.data?.title ?? "Doc"}</SheetTitle>
            <SheetDescription className="sr-only">Documento</SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-8">
            {doc.data ? (
              <PromptDocBody doc={doc.data} />
            ) : doc.isError ? (
              <BlockError what="el doc" onRetry={() => void doc.refetch()} />
            ) : (
              <div className="h-40 animate-pulse rounded-xl bg-muted" />
            )}
          </div>
        </SheetContent>
      </Sheet>

      <GoalDialog
        open={fijar !== null}
        goal={fijarGoal}
        fixedProject={fijar?.slug}
        projects={[]}
        parents={[]}
        onOpenChange={(open) => !open && setFijar(null)}
        onSaved={() => void client.invalidateQueries({ queryKey: ["company"] })}
      />

      {/* New project (4a / 4b) */}
      <Dialog open={sheet?.kind === "nuevo"} onOpenChange={(open) => !open && closeSheet()}>
        <DialogContent className="bg-background sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl font-extrabold tracking-tight">
              {creating.kind === "done" ? `${creating.name} está listo` : "Nuevo proyecto"}
            </DialogTitle>
            <DialogDescription>
              {creating.kind === "done" ? "Llega con su equipo: PO, Research, Artist y Taller." : "Un nombre y una meta. Lo demás tiene valores por defecto."}
            </DialogDescription>
          </DialogHeader>
          {creating.kind === "done" ? (
            <NewProjectDone state={creating} onOpen={(slug) => navigate(`/p/${encodeURIComponent(slug)}`)} onClose={closeSheet} />
          ) : (
            <NewProjectForm state={creating} onSubmit={(input) => createProject.mutate(input)} onCancel={closeSheet} />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};
