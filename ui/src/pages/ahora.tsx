// Ahora: what Jorge should do, what is in flight, ideas by stage, what is stuck, and what is next.
// The project list, the inbox and the machine, plus one project read for each project that already has an idea.
// LiveProvider already invalidates those keys, so there is no second refresh.
import { useQueries, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { TeTocaItems } from "@/components/home/te-toca";
import { StageChip } from "@/components/task-row";
import { RetomarSheet } from "@/components/retomar-sheet";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Kicker, accentInk, projectAccent } from "@/components/plan/visuals";
import { api } from "@/lib/api";
import {
  GATE_MARK,
  QUIET_PREFIX,
  READINESS_BADGE,
  SUMMARY_ANYWAY,
  SUMMARY_BUTTON,
  SUMMARY_CANCEL,
  SUMMARY_ONLY,
  URGENCY_WORD,
  bloqueadoOf,
  enCursoOf,
  ideaOutcome,
  ideaStageLabel,
  ideasByStage,
  ideasFromProject,
  oldestWaitingIdea,
  quietLine,
  siguienteOf,
  sinTrabajoOf,
  summaryAction,
  summaryLabel,
  teTocaOf,
  unblockOf,
  type AhoraIdea,
  type CourseRow,
  type CourseState,
  type IdeaColumn,
  type IdeaStage,
  type QuietProject,
} from "@/lib/ahora";
import { cn } from "@/lib/utils";

const BADGE_CLASS: Record<CourseState, string> = {
  ready: "bg-status-done/12 text-ink-done",
  caution: "bg-status-now/16 text-ink-now",
  blocked: "bg-status-blocked/12 text-ink-blocked",
};

const STAGE_TONE: Record<IdeaStage, string> = {
  idea: "text-muted-foreground",
  research: "text-ink-now",
  design: "text-ink-review",
  planning: "text-ink-ready",
  ready: "text-ink-done",
};

function useNow(everyMs = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}

function Section({ id, title, tone, meta, children }: { id: string; title: string; tone: string; meta?: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="grid content-start gap-3 rounded-[22px] border bg-card px-4 py-4 sm:px-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id={`${id}-title`} className={cn("font-display text-[15px] font-bold tracking-[0.08em] uppercase", tone)}>{title}</h2>
        {meta && <p className="text-xs text-muted-foreground tabular-nums">{meta}</p>}
      </div>
      {children}
    </section>
  );
}

function ProjectName({ slug, title }: { slug: string; title: string }) {
  const [accent] = projectAccent(slug);
  return <span className="font-semibold" style={{ color: accentInk(accent) }}>{title}</span>;
}

function taskHref(slug: string, key: string) {
  return `/p/${slug}?task=${encodeURIComponent(key)}`;
}

const rowLink = "grid min-h-11 gap-0.5 rounded-xl bg-surface-sunken px-3 py-2.5 transition hover:bg-foreground/[0.06] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

function GateMark() {
  return (
    <span role="img" className="text-sm leading-none font-semibold text-ink-jorge" aria-label="Pregunta de compuerta abierta">
      {GATE_MARK}
    </span>
  );
}

function IdeaCard({ idea }: { idea: AhoraIdea }) {
  const outcome = ideaOutcome(idea);
  return (
    <Link to={taskHref(idea.slug, idea.key)} className={cn(rowLink, "gap-1.5")}>
      <span className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs text-muted-foreground">{idea.key}</span>
        {idea.gateOpen && <GateMark />}
      </span>
      <span className="line-clamp-1 text-sm leading-snug">{idea.line}</span>
      <span className="flex flex-wrap items-center gap-2">
        <StageChip stage={idea.stage} />
        <ProjectName slug={idea.slug} title={idea.projectTitle} />
      </span>
      {outcome ? (
        <span className="text-xs text-muted-foreground">{outcome}</span>
      ) : (
        <span className="line-clamp-2 text-xs leading-snug text-muted-foreground">{idea.waits || "—"}</span>
      )}
    </Link>
  );
}

function IdeasBoard({ columns }: { columns: IdeaColumn[] }) {
  return (
    <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2 xl:grid-cols-5">
      {columns.map((col) => (
        <div key={col.stage} className="grid min-w-0 content-start gap-2">
          <h3 className={cn("text-[11px] font-bold tracking-[0.12em] uppercase", STAGE_TONE[col.stage])}>{col.label}</h3>
          {col.ideas.length === 0 && <p className="text-xs text-muted-foreground">Ninguna</p>}
          {col.ideas.length > 0 && (
            <ul className="grid gap-2">
              {col.ideas.map((idea) => (
                <li key={`${idea.slug}/${idea.key}`}>
                  <IdeaCard idea={idea} />
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}

function WaitingIdeaLine({ idea }: { idea: AhoraIdea }) {
  return (
    <li>
      <Link to={taskHref(idea.slug, idea.key)} className={rowLink}>
        <span className="flex flex-wrap items-baseline gap-x-2 text-xs">
          <span className="font-bold tracking-[0.08em] text-muted-foreground uppercase">Idea</span>
          <ProjectName slug={idea.slug} title={idea.projectTitle} />
          <span className="font-mono text-muted-foreground">{idea.key}</span>
          {idea.gateOpen && <GateMark />}
        </span>
        <span className="line-clamp-1 text-sm leading-snug">
          <span className="text-muted-foreground">{ideaStageLabel(idea.stage)}. </span>
          {idea.line}
        </span>
      </Link>
    </li>
  );
}

function QuietLine({ projects }: { projects: QuietProject[] }) {
  if (!projects.length) return <p className="text-sm text-muted-foreground">{quietLine([])}</p>;
  return (
    <p className="text-sm text-muted-foreground">
      {QUIET_PREFIX}:{" "}
      {projects.map((project, index) => (
        <span key={project.slug}>
          {index > 0 && ", "}
          <Link
            to={`/p/${project.slug}`}
            className="font-medium text-foreground underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {project.title}
          </Link>
        </span>
      ))}
    </p>
  );
}

function ReadinessBadge({ state }: { state: CourseState }) {
  return (
    <span className={cn("inline-flex h-5 items-center rounded-full px-2 text-[11px] font-semibold", BADGE_CLASS[state])}>
      {READINESS_BADGE[state]}
    </span>
  );
}

export function AhoraPage() {
  const projects = useQuery({ queryKey: ["projects"], queryFn: api.projects });
  const inbox = useQuery({ queryKey: ["inbox"], queryFn: () => api.inbox(), staleTime: 15_000 });
  const machine = useQuery({ queryKey: ["machine"], queryFn: api.machine, staleTime: 15_000 });
  const nowMs = useNow();
  const summaryButtonRef = useRef<HTMLButtonElement | null>(null);
  const proceedRef = useRef(false);
  const [summary, setSummary] = useState<CourseRow | null>(null);
  const [confirm, setConfirm] = useState<CourseRow | null>(null);
  const handleSummary = (row: CourseRow, button: HTMLButtonElement) => {
    summaryButtonRef.current = button;
    if (summaryAction(row.state) === "open") setSummary(row);
    if (summaryAction(row.state) === "confirm") setConfirm(row);
  };
  const handleSummaryOpen = (open: boolean) => {
    if (!open) setSummary(null);
  };
  const handleConfirmOpen = (open: boolean) => {
    if (!open) setConfirm(null);
  };
  const handleConfirmSummary = () => {
    if (!confirm) return;
    proceedRef.current = true;
    setSummary(confirm);
    setConfirm(null);
  };
  const handleCancelConfirm = () => setConfirm(null);
  const handleConfirmCloseAutoFocus = (event: Event) => {
    event.preventDefault();
    if (proceedRef.current) {
      proceedRef.current = false;
      return;
    }
    summaryButtonRef.current?.focus();
  };

  const ideaSlugs = useMemo(
    () => (projects.data ?? []).filter((p) => p.tasks.some((t) => t.kind === "idea")).map((p) => p.slug),
    [projects.data],
  );
  const ideaQueries = useQueries({
    queries: ideaSlugs.map((slug) => ({
      queryKey: ["project", slug],
      queryFn: () => api.project(slug),
      staleTime: 15_000,
    })),
  });

  const model = useMemo(() => {
    const list = projects.data ?? [];
    const prints = machine.data?.items ?? [];
    return {
      teToca: inbox.data ? teTocaOf(inbox.data) : null,
      curso: enCursoOf(list),
      quiet: sinTrabajoOf(list),
      bloqueado: bloqueadoOf(list, prints, nowMs),
      siguiente: siguienteOf(list),
    };
  }, [projects.data, inbox.data, machine.data, nowMs]);

  const titleOf = (slug: string) => projects.data?.find((p) => p.slug === slug)?.title ?? slug;

  if (projects.isError) return <p className="text-sm text-destructive">No se pudieron cargar los proyectos.</p>;
  if (!projects.data) {
    return (
      <div className="grid gap-4">
        <Skeleton className="h-16 rounded-2xl" />
        <Skeleton className="h-40 rounded-[22px]" />
        <Skeleton className="h-40 rounded-[22px]" />
      </div>
    );
  }

  const teToca = model.teToca;
  const teTocaMeta = teToca && teToca.count > 0 ? (teToca.count === 1 ? "1 cosa" : `${teToca.count} cosas`) : undefined;
  const ideasPending = ideaSlugs.length > 0 && ideaQueries.some((q) => q.isPending);
  const ideasFailed = ideaQueries.some((q) => q.isError);
  const ideasReady = ideaSlugs.length === 0 || ideaQueries.every((q) => q.isSuccess || q.isError);
  const ideas = ideaQueries.flatMap((q) =>
    q.data ? ideasFromProject({ slug: q.data.slug, title: q.data.title }, q.data.tasks, q.data.resume.open_questions) : [],
  );
  const ideaColumns = ideasByStage(ideas);
  const waitingIdea = ideasReady ? oldestWaitingIdea(ideas) : null;
  const ideaMeta = ideas.length === 0 ? undefined : ideas.length === 1 ? "1 idea" : `${ideas.length} ideas`;
  const siguienteEmpty = model.siguiente.length === 0 && !waitingIdea && !ideasPending;

  return (
    <div className="grid grid-cols-1 gap-4 sm:gap-5">
      <header className="grid gap-1">
        <Kicker className="text-muted-foreground">En este momento</Kicker>
        <h1 className="font-display text-3xl font-extrabold tracking-[-0.03em] sm:text-4xl">Ahora</h1>
      </header>

      <Section id="te-toca" title="Te toca" tone="text-ink-jorge" meta={teTocaMeta}>
        {inbox.isPending && <Skeleton className="h-16 rounded-xl" />}
        {inbox.isError && <p className="text-sm text-destructive">No se pudo cargar la bandeja.</p>}
        {teToca && teToca.items.length === 0 && <p className="text-sm text-muted-foreground">Nada te toca.</p>}
        {teToca && teToca.items.length > 0 && (
          <TeTocaItems items={teToca.items} names={titleOf} when={(item) => (item.urgency ? URGENCY_WORD[item.urgency] : undefined)} />
        )}
        {teToca && teToca.count > teToca.items.length && (
          <Link to="/inbox" className="inline-flex min-h-8 w-fit items-center text-[13px] font-semibold text-ink-jorge underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
            Ver las {teToca.count} en la bandeja
          </Link>
        )}
      </Section>

      <Section id="en-curso" title="En curso" tone="text-ink-now">
        {model.curso.length > 0 && (
          <ul className="grid gap-2">
            {model.curso.map((row) => {
              const unblock = unblockOf(row, inbox.data?.items ?? []);
              const action = summaryAction(row.state);
              return (
                <li key={row.slug} aria-label={`${row.title}, ${READINESS_BADGE[row.state]}`} className="flex flex-wrap items-start gap-2 rounded-xl bg-surface-sunken px-3 py-2.5">
                  <div className="grid min-w-0 flex-1 gap-1">
                    <span className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                      <Link to={`/p/${row.slug}`} className="rounded-lg focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
                        <ProjectName slug={row.slug} title={row.title} />
                      </Link>
                      <ReadinessBadge state={row.state} />
                    </span>
                    <span className="text-sm leading-snug text-foreground/80 wrap-anywhere">{row.line}</span>
                    {unblock && (
                      <Link
                        to={unblock.href}
                        className="w-fit text-sm font-semibold underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                      >
                        {unblock.label}
                      </Link>
                    )}
                  </div>
                  {action !== "none" && (
                    <div className="grid justify-items-end gap-1">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        aria-label={summaryLabel(row.title, row.state)}
                        onClick={(event) => handleSummary(row, event.currentTarget)}
                      >
                        {SUMMARY_BUTTON}
                      </Button>
                      <span className="text-[11px] text-muted-foreground">{SUMMARY_ONLY}</span>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {(model.quiet.length > 0 || model.curso.length === 0) && <QuietLine projects={model.quiet} />}
      </Section>

      <Section id="ideas" title="Ideas" tone="text-foreground" meta={ideasPending ? undefined : ideaMeta}>
        {ideasPending && <Skeleton className="h-28 rounded-xl" />}
        {!ideasPending && ideasFailed && ideas.length === 0 && <p className="text-sm text-destructive">No se pudieron cargar las ideas.</p>}
        {!ideasPending && ideasFailed && ideas.length > 0 && <p className="text-sm text-destructive">No se pudieron cargar todas las ideas.</p>}
        {!ideasPending && !ideasFailed && ideas.length === 0 && <p className="text-sm text-muted-foreground">Ninguna idea.</p>}
        {!ideasPending && ideas.length > 0 && <IdeasBoard columns={ideaColumns} />}
      </Section>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Section id="bloqueado" title="Bloqueado" tone="text-ink-blocked">
          {model.bloqueado.length === 0 && <p className="text-sm text-muted-foreground">Nada bloqueado.</p>}
          {model.bloqueado.length > 0 && (
            <ul className="grid gap-2">
              {model.bloqueado.map((row) => (
                <li key={`${row.kind}/${row.slug}/${row.key}/${row.on}`}>
                  <Link to={taskHref(row.slug, row.key)} className="grid min-h-11 gap-0.5 rounded-xl bg-surface-sunken px-3 py-2.5 transition hover:bg-foreground/[0.06] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
                    <span className="flex flex-wrap items-baseline gap-x-2 text-xs">
                      <ProjectName slug={row.slug} title={row.title} />
                      <span className="font-mono text-muted-foreground">{row.key}</span>
                    </span>
                    <span className="text-sm leading-snug">{row.on}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section id="siguiente" title="Siguiente" tone="text-ink-ready">
          {ideasPending && model.siguiente.length === 0 && <Skeleton className="h-11 rounded-xl" />}
          {siguienteEmpty && <p className="text-sm text-muted-foreground">Nada en cola.</p>}
          {(waitingIdea || model.siguiente.length > 0) && (
            <ul className="grid gap-2">
              {waitingIdea && <WaitingIdeaLine idea={waitingIdea} />}
              {model.siguiente.map((row) => (
                <li key={row.slug}>
                  <Link to={taskHref(row.slug, row.key)} className={rowLink}>
                    <span className="flex flex-wrap items-baseline gap-x-2 text-xs">
                      <ProjectName slug={row.slug} title={row.title} />
                      <span className="font-mono text-muted-foreground">{row.key}</span>
                    </span>
                    <span className="text-sm leading-snug">{row.taskTitle}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
      <Dialog open={confirm !== null} onOpenChange={handleConfirmOpen}>
        <DialogContent
          showCloseButton={false}
          aria-label={confirm ? `Ver resumen de ${confirm.title}, ${READINESS_BADGE.caution}` : undefined}
          onCloseAutoFocus={handleConfirmCloseAutoFocus}
        >
          <DialogHeader>
            <DialogTitle>{confirm ? `Ver resumen de ${confirm.title}` : SUMMARY_BUTTON}</DialogTitle>
            <DialogDescription>
              {confirm ? `${confirm.title} está ${READINESS_BADGE.caution}. ` : ""}
              {SUMMARY_ONLY} Revisa las razones antes de abrirlo.
            </DialogDescription>
          </DialogHeader>
          {confirm && confirm.reasons.length > 0 && (
            <ul className="grid gap-1">
              {confirm.reasons.map((reason) => (
                <li key={`${reason.code}/${reason.task_key ?? ""}`} className="text-sm leading-snug">
                  {reason.text}
                </li>
              ))}
            </ul>
          )}
          {confirm && confirm.reasons.length === 0 && <p className="text-sm leading-snug">{confirm.line}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleCancelConfirm}>
              {SUMMARY_CANCEL}
            </Button>
            <Button type="button" onClick={handleConfirmSummary}>
              {SUMMARY_ANYWAY}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <RetomarSheet
        slug={summary?.slug ?? ""}
        title={summary?.title ?? ""}
        readiness={summary ? { state: summary.state, reasons: summary.reasons, line: summary.line } : null}
        open={summary !== null}
        onOpenChange={handleSummaryOpen}
      />
    </div>
  );
}
