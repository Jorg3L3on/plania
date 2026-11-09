// PLA-I33-1: Compañía como organización (ADR 31c1cead, Design 3a2c3385). Jorge talks with Asistente and sees
// each team working. Mac: the thread on the left (fixed width), team cards on the right in two columns.
// Phone: the thread on top folded to its last message, cards in one column. Plumbing (budgets, guard,
// switches, En marcha, run log) lives in Máquina; one line here links there.
// Data: GET /api/company and GET /api/threads/:id. Each block loads and fails on its own.
// URL: ?vista=<slug> previews a project, ?doc=<id> a doc, ?nuevo the new project dialog;
// ?p=<slug> redirects to /p/<slug> and ?equipo to Máquina.
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate, useLocation, useNavigate } from "react-router";
import { BlockError } from "@/components/compania/parts";
import { CompanyPlumbing, ProjectPreview, TeamCards, TeamCardsSkeleton, ThreadPanel, ThreadSkeleton } from "@/components/compania/org";
import { NewProjectDone, NewProjectForm, PromptDocBody, type NewProjectState } from "@/components/compania/sheets";
import { useThread } from "@/components/compania/use-thread";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ApiError, api } from "@/lib/api";
import { sheetOf } from "@/lib/compania";
import { byLight } from "@/lib/org";
import { greeting } from "@/lib/greeting";

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
  const sheet = sheetOf(location.search);
  // Old links: the project sheet is now the project page, the Equipo sheet now lives in Máquina.
  if (sheet?.kind === "project") return <Navigate to={`/p/${encodeURIComponent(sheet.slug)}`} replace />;
  if (sheet?.kind === "equipo") return <Navigate to="/machine" replace />;
  return <Compania />;
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
  const { hello, subtitle } = greeting(timeZone);
  const asistente = useThread(company?.asistente.thread_id, { who: "Asistente", invalidate: [["company"]] });
  const previewSlug = sheet?.kind === "vista" ? sheet.slug : null;
  const previewProject = previewSlug ? company?.projects.find((p) => p.slug === previewSlug) : undefined;
  const previewThread = useQuery({
    queryKey: ["thread", previewProject?.thread.id],
    queryFn: () => api.thread(previewProject!.thread.id),
    enabled: !!previewProject?.thread.id,
  });
  const doc = useQuery({
    queryKey: ["prompt-doc", sheet?.kind === "doc" ? sheet.id : ""],
    queryFn: () => api.promptDoc(sheet?.kind === "doc" ? sheet.id : ""),
    enabled: sheet?.kind === "doc",
  });

  const projects = useMemo(() => [...(company?.projects ?? [])].sort(byLight), [company]);
  const openSheet = (search: string) => navigate({ pathname: "/ceo", search });
  const closeSheet = () => navigate({ pathname: "/ceo", search: "" }, { replace: true });

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

  return (
    <div className="mx-auto grid w-full max-w-6xl min-w-0 gap-5">
      <header className="grid min-w-0 gap-1">
        <h1 className="font-display text-4xl leading-[0.95] font-extrabold tracking-[-0.03em] sm:text-5xl">
          {company && company.projects.length === 0 ? "Hola" : hello}, Jorge
        </h1>
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <p className="text-sm text-muted-foreground">
            {dayLabel(timeZone)} · {subtitle}
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

      <div className="grid min-w-0 items-start gap-5 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <div className="min-w-0 lg:sticky lg:top-20">
          {comp.isPending ? (
            <ThreadSkeleton />
          ) : company ? (
            <ThreadPanel
              title="Asistente"
              subtitle={<p className="-mt-2 text-xs text-muted-foreground">Tu canal con la compañía. Dile qué quieres y a qué proyecto.</p>}
              project={null}
              now={now}
              timeZone={timeZone}
              placeholder="Dile a Asistente…"
              {...asistente}
            />
          ) : null}
        </div>
        <div className="min-w-0">
          {comp.isPending ? (
            <TeamCardsSkeleton />
          ) : company ? (
            <TeamCards
              projects={projects}
              now={now}
              onPreview={(slug) => openSheet(`?vista=${encodeURIComponent(slug)}`)}
              onNew={() => {
                setCreating({ kind: "idle" });
                openSheet("?nuevo");
              }}
            />
          ) : null}
        </div>
      </div>

      {/* Vista previa: header, team, last 3 messages, Abrir */}
      <Sheet open={sheet?.kind === "vista"} onOpenChange={(open) => !open && closeSheet()}>
        <SheetContent side={wide ? "right" : "bottom"} className={sheetClass}>
          <SheetHeader className="pr-10">
            <SheetTitle className="font-display text-2xl font-extrabold tracking-tight break-words">{previewProject?.title ?? previewSlug ?? ""}</SheetTitle>
            <SheetDescription className="sr-only">Vista previa del proyecto</SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-8">
            {previewProject ? (
              <ProjectPreview project={previewProject} messages={previewThread.data?.messages ?? []} now={now} timeZone={timeZone} />
            ) : comp.isPending ? (
              <div className="h-40 animate-pulse rounded-xl bg-muted" />
            ) : (
              <p className="text-sm text-muted-foreground">Ese proyecto no está.</p>
            )}
          </div>
        </SheetContent>
      </Sheet>

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
