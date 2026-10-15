// Project page sections around the lane grid: header, initiative lines,
// branch graph, fixed decisions and the full resume (ficha) panel.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRightIcon, ChevronRightIcon, GitBranchIcon, PencilIcon, PinIcon } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Link } from "react-router";
import { api } from "@/lib/api";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { TicketButton } from "@/components/plan/ticket-button";
import {
  Glyph,
  Kicker,
  LANE_STATE,
  ProgressRing,
  rise,
  statusWord,
  TONE_TEXT,
  toneVar,
} from "@/components/plan/visuals";
import { ProjectMark } from "@/components/plania-mark";
import { releasePending } from "@/components/release-step";
import { DecisionList, ResumeView } from "@/components/resume";
import type { BranchEdge, Lane, StationTone } from "@/lib/lanes";
import type { Decision, Headline, ReleasePlan, Resume } from "@/lib/types";
import { cn } from "@/lib/utils";

// One line on where the project stands. Anyone writes it (set_project or here); the server marks it
// stale when an env, an initiative or a Done moved after it was written.
function HeadlineLine({ slug, headline, version }: { slug: string; headline: Headline; version: number }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(headline.text);
  const save = useMutation({
    mutationFn: () => api.patchProject(slug, text.trim(), version),
    onSuccess: () => {
      setEditing(false);
      toast("Nota guardada");
    },
    onError: () => toast.error("No se pudo guardar la nota; recarga y vuelve a intentarlo."),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ["project", slug] }),
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    if (text.trim() !== headline.text) save.mutate();
    else setEditing(false);
  }
  if (editing) {
    return (
      <form onSubmit={submit} className="grid max-w-2xl gap-2">
        <Textarea value={text} onChange={(e) => setText(e.target.value.slice(0, 280))} rows={2} autoFocus aria-label="Nota de los agentes" />
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{text.length}/280</span>
          <Button type="submit" size="sm" disabled={save.isPending}>Guardar</Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => { setText(headline.text); setEditing(false); }}>Cancelar</Button>
        </div>
      </form>
    );
  }
  return (
    <p className="flex max-w-2xl flex-wrap items-baseline gap-x-2 text-[13px] text-muted-foreground">
      <span>{headline.text || "Sin nota."}</span>
      <button type="button" onClick={() => { setText(headline.text); setEditing(true); }} className="inline-flex items-center gap-1 text-xs underline-offset-4 hover:text-foreground hover:underline" aria-label="Editar la nota">
        <PencilIcon className="size-3" aria-hidden /> editar
      </button>
    </p>
  );
}

// The headline is written by agents for agents (envs, SHAs, keys): it stays one click away.
function AgentNote({ slug, headline, version }: { slug: string; headline: Headline; version: number }) {
  return (
    <details className="group/note mt-1 max-w-2xl">
      <summary className="inline-flex min-h-7 cursor-pointer list-none items-center gap-2 text-xs text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
        <ChevronRightIcon aria-hidden className="size-3.5 transition-transform group-open/note:rotate-90" />
        Nota de los agentes
        {headline.stale && (
          <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-amber-700 uppercase dark:text-amber-400" title="Algo cambió desde que se escribió">
            desactualizada
          </span>
        )}
      </summary>
      <div className="mt-1 pl-5">
        <HeadlineLine slug={slug} headline={headline} version={version} />
      </div>
    </details>
  );
}

type Open = (key: string) => void;

export function SectionTitle({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <h2 className="font-display text-[15px] font-bold tracking-[0.08em] text-muted-foreground uppercase">{children}</h2>
      {hint && <span className="text-[13px] text-muted-foreground">{hint}</span>}
    </div>
  );
}

/** "Materiales" from "Materiales: catalog materials on…"; a title whose head is too short to stand alone stays whole. */
function shortTitle(title: string) {
  const head = title.match(/^(.+?):\s/)?.[1];
  return head && head.length >= 10 ? head : title.replace(/\s*\([^)]*\)\s*$/, "");
}

/** "1 en curso · 4 por revisar" for a lane. */
function laneHow(lane: Lane) {
  const inCourse = lane.now.filter((t) => t.status === "In progress").length;
  const blocked = lane.now.filter((t) => t.status === "Blocked").length;
  return [
    inCourse > 0 && `${inCourse} en curso`,
    lane.review.length > 0 && `${lane.review.length} por revisar`,
    blocked > 0 && `${blocked} ${blocked === 1 ? "bloqueada" : "bloqueadas"}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

type SummaryItem = { key: string | null; name: string; how: string };

function SummaryRow({ label, tone, items, empty, onOpen }: { label: string; tone: StationTone; items: SummaryItem[]; empty: string; onOpen?: Open }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
      <dt className={cn("inline-flex w-[104px] shrink-0 items-center gap-2 text-[11px] font-bold tracking-[0.12em] uppercase", items.length > 0 ? TONE_TEXT[tone] : "text-muted-foreground")}>
        <Glyph tone={items.length > 0 ? tone : "pending"} size={7} pulse={tone === "now" && items.length > 0} />
        {label}
      </dt>
      <dd className="m-0 min-w-0 flex-1 text-[15px] leading-snug">
        {items.length === 0 ? (
          <span className="text-muted-foreground">{empty}</span>
        ) : (
          items.map((item, i) => (
            <span key={item.key ?? item.name}>
              {i > 0 && <span className="text-muted-foreground"> · </span>}
              {item.key && onOpen ? (
                <button type="button" onClick={() => onOpen(item.key!)} className="rounded font-medium underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
                  {item.name}
                </button>
              ) : (
                <span className="font-medium">{item.name}</span>
              )}
              {item.how && <span className="text-muted-foreground"> ({item.how})</span>}
            </span>
          ))
        )}
      </dd>
    </div>
  );
}

/** What a person wants at a glance: what is moving, what comes next, and whether anything waits on Jorge. */
function ProjectSummary({ lanes, needsJorge, onOpen }: { lanes: Lane[]; needsJorge: number; onOpen?: Open }) {
  const item = (l: Lane, how: string): SummaryItem => ({ key: l.initiative?.key ?? null, name: l.initiative ? shortTitle(l.initiative.title) : "Tickets sueltos", how });
  const moving = lanes.filter((l) => l.state === "moving").map((l) => item(l, laneHow(l)));
  // Initiatives nobody has started, and loose tickets that are ready even while another one moves
  // (an initiative en marcha keeps its own next phase to itself).
  const next = lanes
    .filter((l) => (!l.initiative ? l.next.length > 0 : (l.state === "waiting" || l.state === "blocked") && l.next.length + l.now.length > 0))
    .map((l) => item(l, !l.initiative ? `${l.next.length} ${l.next.length === 1 ? "listo" : "listos"}` : l.state === "blocked" ? "bloqueada" : ""));
  const shownNext = next.slice(0, 3);
  if (next.length > 3) shownNext.push({ key: null, name: `y ${next.length - 3} más`, how: "" });
  const jorge: SummaryItem[] = needsJorge > 0 ? [{ key: null, name: needsJorge === 1 ? "1 pregunta" : `${needsJorge} preguntas`, how: "abajo" }] : [];
  return (
    <dl className="mt-2 grid max-w-3xl gap-1.5">
      <SummaryRow label="En marcha" tone="now" items={moving} empty="Nada ahora mismo" onOpen={onOpen} />
      <SummaryRow label="Siguiente" tone="ready" items={shownNext} empty="Nada en cola" onOpen={onOpen} />
      <SummaryRow label="Te espera" tone="jorge" items={jorge} empty="Nada; lo demás avanza solo" />
    </dl>
  );
}

export function ProjectHeader({
  slug,
  title,
  lanes,
  progress,
  counts,
  headline,
  version,
  release,
  onOpen,
}: {
  slug?: string;
  title: string;
  lanes: Lane[];
  progress: { closed: number; total: number };
  counts: { inProgress: number; inReview: number; ready: number; needsJorge: number; blocked: number };
  headline?: Headline;
  version?: number;
  release?: ReleasePlan | null;
  onOpen?: Open;
}) {
  const legend = [
    { n: counts.inProgress, label: "en curso", tone: "now" as const },
    { n: counts.inReview, label: "en revisión", tone: "review" as const },
    { n: counts.needsJorge, label: counts.needsJorge === 1 ? "te espera" : "te esperan", tone: "jorge" as const },
    { n: counts.ready, label: counts.ready === 1 ? "listo para empezar" : "listos para empezar", tone: "ready" as const },
    { n: counts.blocked, label: counts.blocked === 1 ? "bloqueado" : "bloqueados", tone: "blocked" as const },
  ].filter((l) => l.n > 0);
  return (
    <header className="flex animate-rise flex-wrap items-center justify-between gap-x-8 gap-y-3">
      <div className="grid gap-1">
        <h1 className="flex items-center gap-3 font-display text-3xl leading-none font-extrabold tracking-[-0.03em] sm:text-4xl">
          {slug && <ProjectMark slug={slug} className="size-8 sm:size-9" />}
          {title}
          {/* 2.10: merged tickets waiting for Jorge's sandbox → main; opens the step in the Bandeja. */}
          {slug && releasePending(release) && (
            <Link
              to={`/inbox?tab=pasos#${slug}`}
              title={`${release.from.branch} → ${release.into.branch}`}
              className="inline-flex h-7 items-center gap-1.5 rounded-full bg-orange-500/12 px-2.5 font-sans text-xs font-semibold tracking-normal text-ink-jorge transition hover:bg-orange-500/20 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              Para lanzar <span className="tabular-nums">{release.tickets.length}</span>
            </Link>
          )}
        </h1>
        <ProjectSummary lanes={lanes} needsJorge={counts.needsJorge} onOpen={onOpen} />
        {slug && headline && version !== undefined && <AgentNote slug={slug} headline={headline} version={version} />}
      </div>
      <div className="flex flex-wrap items-center gap-x-7 gap-y-3 rounded-[20px] border bg-card/60 px-5 py-3">
        {progress.total > 0 && (
          <div className="flex items-center gap-3.5">
            <ProgressRing closed={progress.closed} total={progress.total} size={52} />
            <div className="flex flex-col">
              <span className="font-display text-[22px] leading-none font-bold">
                {progress.closed}
                <span className="text-lg font-medium text-muted-foreground">/{progress.total}</span>
              </span>
              <span className="mt-1 text-xs text-muted-foreground">tickets cerrados</span>
            </div>
          </div>
        )}
        {legend.length > 0 && (
          <ul className="flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-foreground/80 sm:grid sm:grid-flow-col sm:grid-rows-2">
            {legend.map((l) => (
              <li key={l.label} className="inline-flex items-center gap-2">
                <Glyph tone={l.tone} size={8} />
                {l.n} {l.label}
              </li>
            ))}
          </ul>
        )}
      </div>
    </header>
  );
}

function InitiativeStatus({ lane }: { lane: Lane }) {
  const state = LANE_STATE[lane.state];
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold", TONE_TEXT[state.tone])}
      style={{ background: `color-mix(in oklab, ${toneVar(state.tone)} 13%, transparent)` }}
    >
      <Glyph tone={state.tone} size={7} pulse={lane.state === "moving"} />
      {statusWord(lane.initiative!.status)}
    </span>
  );
}

// In review, Merged and Released count as advanced: done in green, then the review stretch in violet.
function InitiativeProgress({ lane, barClassName }: { lane: Lane; barClassName?: string }) {
  const share = (n: number) => (lane.total === 0 ? 0 : (n / lane.total) * 100);
  const inReview = lane.review.length;
  const advanced = lane.closed + inReview;
  return (
    <div className="flex items-center gap-2.5">
      <div className={cn("flex h-1.5 w-24 overflow-hidden rounded-full bg-foreground/10", barClassName)} aria-hidden>
        <div className="h-full bg-status-done" style={{ width: `${share(lane.closed)}%` }} />
        <div className="h-full bg-status-review" style={{ width: `${share(inReview)}%` }} />
      </div>
      <span
        className="whitespace-nowrap text-muted-foreground tabular-nums"
        title={`${lane.closed} cerrados, ${inReview} en revisión, ${lane.total} en total`}
      >
        {advanced} de {lane.total}
        {inReview > 0 && <span className="text-ink-review"> · {inReview} en revisión</span>}
      </span>
    </div>
  );
}

function InitiativeHere({ lane, onOpen, clamp }: { lane: Lane; onOpen: Open; clamp: string }) {
  const here = lane.stations.find((s) => s.here)?.task;
  if (!here) return <span className="text-muted-foreground">—</span>;
  return (
    <TicketButton taskKey={here.key} onOpen={onOpen} title={here.title} className="text-left">
      <span className={cn("text-foreground/85 underline-offset-4 group-hover/ticket:underline", clamp)}>{here.title}</span>
    </TicketButton>
  );
}

function InitiativeName({ lane, onOpen }: { lane: Lane; onOpen: Open }) {
  const initiative = lane.initiative!;
  return (
    <TicketButton taskKey={initiative.key} onOpen={onOpen} className="text-left">
      <span className="font-semibold underline-offset-4 group-hover/ticket:underline">{initiative.title}</span>
      <span className="ml-2 font-mono text-xs text-muted-foreground">{initiative.key}</span>
    </TicketButton>
  );
}

/** All initiatives at a glance: status, progress and the station where each one stands.
 *  A table from sm up; on a phone, one stacked row per initiative instead of a sideways scroll. */
export function InitiativeTable({ lanes, onOpen }: { lanes: Lane[]; onOpen: Open }) {
  return (
    <div className="lift animate-rise overflow-hidden rounded-[20px] border bg-card">
      <ul className="divide-y text-[13px] sm:hidden">
        {lanes.map((lane) => (
          <li key={lane.id} className="grid gap-2 px-4 py-3.5">
            <div className="flex items-start justify-between gap-3">
              <InitiativeName lane={lane} onOpen={onOpen} />
              <InitiativeStatus lane={lane} />
            </div>
            <InitiativeProgress lane={lane} barClassName="w-auto flex-1" />
            <div className="flex min-w-0 gap-2">
              <span className="text-[11px] font-bold tracking-[0.12em] text-muted-foreground uppercase">Aquí</span>
              <InitiativeHere lane={lane} onOpen={onOpen} clamp="line-clamp-2" />
            </div>
          </li>
        ))}
      </ul>
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full min-w-[560px] border-collapse text-left text-[13px]">
          <thead>
            <tr className="border-b bg-foreground/[0.03] text-[11px] font-bold tracking-[0.12em] text-muted-foreground uppercase">
              <th className="px-5 py-3 font-bold">Iniciativa</th>
              <th className="px-3 py-3 font-bold">Estado</th>
              <th className="px-3 py-3 font-bold">Avance</th>
              <th className="px-5 py-3 font-bold">Aquí</th>
            </tr>
          </thead>
          <tbody>
            {lanes.map((lane) => (
              <tr key={lane.id} className="border-b transition-colors last:border-b-0 hover:bg-foreground/[0.04]">
                <td className="max-w-[320px] px-5 py-3"><InitiativeName lane={lane} onOpen={onOpen} /></td>
                <td className="px-3 py-3"><InitiativeStatus lane={lane} /></td>
                <td className="px-3 py-3"><InitiativeProgress lane={lane} /></td>
                <td className="max-w-[300px] px-5 py-3"><InitiativeHere lane={lane} onOpen={onOpen} clamp="line-clamp-1" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Branch → base edges from initiatives, drawn as a small git graph. */
export function BranchGraph({ edges }: { edges: BranchEdge[] }) {
  const bases = [...new Set(edges.map((e) => e.base))];
  return (
    // grid-cols-1 (minmax(0,1fr)) all the way down, or the truncated branch names set the width on phones.
    <section className="lift grid animate-rise grid-cols-1 gap-4 rounded-[20px] border bg-card px-5 py-5" style={rise(4)}>
      <Kicker className="text-muted-foreground">
        <GitBranchIcon className="size-3.5" aria-hidden />
        Rama y prod
      </Kicker>
      {bases.length > 0 && (
        <ul className="grid grid-cols-1 gap-3">
          {bases.map((base) => (
            <li key={base} className="grid grid-cols-1">
              <span className="flex min-h-8 items-center gap-3.5">
                <span aria-hidden className="size-3.5 shrink-0 rounded-full bg-status-done shadow-[0_0_0_4px_color-mix(in_oklab,var(--status-done)_15%,transparent)]" />
                <span className="truncate font-mono text-[13px] font-medium">{base}</span>
              </span>
              {edges.filter((e) => e.base === base).map((e) => (
                <span key={e.branch} className="grid grid-cols-1">
                  <span aria-hidden className="ml-[6px] h-4 w-0.5 bg-[linear-gradient(var(--status-done),var(--status-review))]" />
                  <span className="flex min-h-8 items-center gap-3.5">
                    <span aria-hidden className="size-3.5 shrink-0 rounded-full bg-status-review" />
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate font-mono text-[13px] font-medium">{e.branch}</span>
                      <span className="truncate text-xs text-muted-foreground">{e.lanes.join(", ")}</span>
                    </span>
                  </span>
                </span>
              ))}
            </li>
          ))}
        </ul>
      )}
      {bases.length === 0 && <p className="text-[13px] text-muted-foreground">Sin ramas registradas.</p>}
    </section>
  );
}

function FichaLink({ onClick, className }: { onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex min-h-11 w-fit items-center gap-1.5 rounded-md text-[13px] font-medium text-ink-review hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        className,
      )}
    >
      Ver la ficha completa
      <ArrowRightIcon className="size-3.5" aria-hidden />
    </button>
  );
}

/** Pinned decisions that still stand. */
export function FixedDecisions({ items, onFicha }: { items: string[]; onFicha: () => void }) {
  return (
    <section
      className="lift grid animate-rise grid-cols-1 gap-3 rounded-[20px] border border-status-review/30 bg-[linear-gradient(160deg,color-mix(in_oklab,var(--status-review)_10%,var(--card)),var(--card)_70%)] px-5 pt-5 pb-2"
      style={rise(5)}
    >
      <Kicker className="text-ink-review">
        <PinIcon className="size-3.5" aria-hidden />
        Decisiones fijas
      </Kicker>
      {items.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">Ninguna todavía.</p>
      ) : (
        <ul className="grid grid-cols-1 gap-2 text-[13px] leading-snug">
          {items.slice(0, 4).map((s) => (
            <li key={s} className="flex gap-2.5">
              <span aria-hidden className="text-ink-review">—</span>
              {/* Decisions often carry a long artifact URL; let it wrap anywhere. */}
              <span className="min-w-0 [overflow-wrap:anywhere]">{s}</span>
            </li>
          ))}
          {items.length > 4 && <li className="pl-5 text-muted-foreground">y {items.length - 4} más</li>}
        </ul>
      )}
      <FichaLink onClick={onFicha} />
    </section>
  );
}

/** "Ver la ficha completa": the generated resume per initiative and the decision log, from v2. */
export function FichaSheet({
  resume,
  decisions,
  title,
  open,
  onOpenChange,
  onOpen,
}: {
  resume: Resume;
  decisions: Decision[];
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpen: Open;
}) {
  const openTask = (key: string) => {
    onOpenChange(false);
    onOpen(key);
  };
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="gap-0 overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-2xl">
        <SheetHeader className="pr-12">
          <SheetDescription>Ficha del proyecto</SheetDescription>
          <SheetTitle className="font-display text-2xl">{title}</SheetTitle>
        </SheetHeader>
        <div className="grid gap-8 px-4 pb-8">
          <ResumeView resume={resume} onOpen={openTask} />
          <DecisionList decisions={decisions} onOpen={openTask} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
