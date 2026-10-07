// Project page sections around the lane grid: header, "Te toca a ti", initiative lines,
// branch graph, fixed decisions and the full resume (ficha) panel.
import { ArrowRightIcon, GitBranchIcon, HandIcon, PinIcon } from "lucide-react";
import type { ReactNode } from "react";
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
import { DecisionList, ResumeView } from "@/components/resume";
import type { BranchEdge, Lane, YourTurnItem } from "@/lib/lanes";
import type { Decision, Resume } from "@/lib/types";
import { cn } from "@/lib/utils";

type Open = (key: string) => void;

export function SectionTitle({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <h2 className="font-display text-[15px] font-bold tracking-[0.08em] text-muted-foreground uppercase">{children}</h2>
      {hint && <span className="text-[13px] text-muted-foreground">{hint}</span>}
    </div>
  );
}

function laneSentence(lanes: Lane[]) {
  const initiatives = lanes.filter((l) => l.initiative);
  if (initiatives.length === 0) return "Sin iniciativas abiertas.";
  const moving = initiatives.filter((l) => l.state === "moving").length;
  const parts = [`${initiatives.length} ${initiatives.length === 1 ? "iniciativa abierta" : "iniciativas abiertas"}`];
  if (moving > 0) parts.push(`${moving} en marcha`);
  const still = initiatives.length - moving;
  if (still > 0) parts.push(`${still} ${still === 1 ? "quieta" : "quietas"}`);
  return parts.join(" · ");
}

export function ProjectHeader({
  title,
  lanes,
  progress,
  counts,
}: {
  title: string;
  lanes: Lane[];
  progress: { closed: number; total: number };
  counts: { inProgress: number; inReview: number; ready: number; needsJorge: number; blocked: number };
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
        <h1 className="font-display text-3xl leading-none font-extrabold tracking-[-0.03em] sm:text-4xl">{title}</h1>
        <p className="text-[15px] text-muted-foreground">{laneSentence(lanes)}</p>
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

export function YourTurnStrip({ items, onOpen, prefix }: { items: YourTurnItem[]; onOpen: (item: YourTurnItem) => void; prefix?: (item: YourTurnItem) => string }) {
  if (items.length === 0) return null;
  return (
    <section
      aria-label="Te toca a ti"
      className="flex animate-rise flex-wrap items-center gap-3 rounded-[18px] border border-status-jorge/25 bg-status-jorge/[0.07] px-5 py-3.5"
      style={rise(1)}
    >
      <Kicker className="text-ink-jorge">
        <HandIcon className="size-3.5" aria-hidden />
        Te toca a ti
      </Kicker>
      {items.map((item) => (
        <button
          key={item.task.key + (prefix?.(item) ?? "")}
          type="button"
          onClick={() => onOpen(item)}
          className="min-h-9 rounded-full bg-foreground/[0.08] px-3 py-1.5 text-left text-[13px] transition hover:-translate-y-px hover:bg-foreground/[0.14] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {prefix && <span className="text-muted-foreground">{prefix(item)} · </span>}
          {item.ask}
        </button>
      ))}
      <span className="ml-auto text-xs text-muted-foreground">todo lo demás avanza solo</span>
    </section>
  );
}

/** All initiatives at a glance: status, progress and the station where each one stands. */
export function InitiativeTable({ lanes, onOpen }: { lanes: Lane[]; onOpen: Open }) {
  return (
    <div className="lift animate-rise overflow-x-auto rounded-[20px] border bg-card">
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
          {lanes.map((lane) => {
            const initiative = lane.initiative!;
            const state = LANE_STATE[lane.state];
            const here = lane.stations.find((s) => s.here)?.task;
            const pct = lane.total === 0 ? 0 : Math.round((lane.closed / lane.total) * 100);
            return (
              <tr key={lane.id} className="border-b transition-colors last:border-b-0 hover:bg-foreground/[0.04]">
                <td className="max-w-[320px] px-5 py-3">
                  <TicketButton taskKey={initiative.key} onOpen={onOpen} className="text-left">
                    <span className="font-semibold underline-offset-4 group-hover/ticket:underline">{initiative.title}</span>
                    <span className="ml-2 font-mono text-xs text-muted-foreground">{initiative.key}</span>
                  </TicketButton>
                </td>
                <td className="px-3 py-3">
                  <span
                    className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold", TONE_TEXT[state.tone])}
                    style={{ background: `color-mix(in oklab, ${toneVar(state.tone)} 13%, transparent)` }}
                  >
                    <Glyph tone={state.tone} size={7} pulse={lane.state === "moving"} />
                    {statusWord(initiative.status)}
                  </span>
                </td>
                <td className="px-3 py-3 whitespace-nowrap">
                  <div className="flex items-center gap-2.5">
                    <div className="h-1.5 w-24 overflow-hidden rounded-full bg-foreground/10" aria-hidden>
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: `linear-gradient(90deg, var(--status-done), ${toneVar(state.tone)})` }} />
                    </div>
                    <span className="text-muted-foreground tabular-nums">
                      {lane.closed} de {lane.total}
                    </span>
                  </div>
                </td>
                <td className="max-w-[300px] px-5 py-3">
                  {here ? (
                    <TicketButton taskKey={here.key} onOpen={onOpen} title={here.title} className="text-left">
                      <span className="line-clamp-1 text-foreground/85 underline-offset-4 group-hover/ticket:underline">{here.title}</span>
                    </TicketButton>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Branch → base edges from initiatives, drawn as a small git graph, then the resume's free text. */
export function BranchGraph({ edges, text, onFicha }: { edges: BranchEdge[]; text: string; onFicha: () => void }) {
  const bases = [...new Set(edges.map((e) => e.base))];
  return (
    <section className="lift grid animate-rise gap-4 rounded-[20px] border bg-card px-5 py-5" style={rise(4)}>
      <Kicker className="text-muted-foreground">
        <GitBranchIcon className="size-3.5" aria-hidden />
        Rama y prod
      </Kicker>
      {bases.length > 0 && (
        <ul className="grid gap-3">
          {bases.map((base) => (
            <li key={base} className="grid">
              <span className="flex min-h-8 items-center gap-3.5">
                <span aria-hidden className="size-3.5 shrink-0 rounded-full bg-status-done shadow-[0_0_0_4px_color-mix(in_oklab,var(--status-done)_15%,transparent)]" />
                <span className="font-mono text-[13px] font-medium">{base}</span>
              </span>
              {edges.filter((e) => e.base === base).map((e) => (
                <span key={e.branch} className="grid">
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
      {text ? (
        <p className={cn("line-clamp-4 text-[13px] text-foreground/80", bases.length > 0 && "border-t pt-3")}>{text}</p>
      ) : (
        bases.length === 0 && <p className="text-[13px] text-muted-foreground">Sin ramas registradas.</p>
      )}
      {text.length > 180 && <FichaLink onClick={onFicha} />}
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

/** Pinned decisions (v2), or the v1 card's decision split into statements while it exists. */
export function FixedDecisions({ items, onFicha }: { items: string[]; onFicha: () => void }) {
  return (
    <section
      className="lift grid animate-rise gap-3 rounded-[20px] border border-status-review/30 bg-[linear-gradient(160deg,color-mix(in_oklab,var(--status-review)_10%,var(--card)),var(--card)_70%)] px-5 pt-5 pb-2"
      style={rise(5)}
    >
      <Kicker className="text-ink-review">
        <PinIcon className="size-3.5" aria-hidden />
        Decisiones fijas
      </Kicker>
      {items.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">Ninguna todavía.</p>
      ) : (
        <ul className="grid gap-2 text-[13px] leading-snug">
          {items.slice(0, 4).map((s) => (
            <li key={s} className="flex gap-2.5">
              <span aria-hidden className="text-ink-review">—</span>
              {s}
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
