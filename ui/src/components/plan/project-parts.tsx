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
  projectAccent,
  rise,
  shortLabel,
  statusWord,
  TONE_TEXT,
  toneVar,
} from "@/components/plan/visuals";
import type { BranchEdge, Lane, YourTurnItem } from "@/lib/lanes";
import { statements } from "@/lib/lanes";
import type { Resume } from "@/lib/types";
import { cn } from "@/lib/utils";

type Open = (key: string) => void;

export function SectionTitle({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <h2 className="font-display text-[15px] font-bold tracking-[0.08em] text-muted-foreground uppercase">{children}</h2>
      {hint && <span className="text-[13px] text-muted-foreground/80">{hint}</span>}
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
  slug,
  title,
  lanes,
  progress,
  counts,
}: {
  slug: string;
  title: string;
  lanes: Lane[];
  progress: { closed: number; total: number };
  counts: { inProgress: number; inReview: number; ready: number; blocked: number };
}) {
  const [from, to] = projectAccent(slug);
  const legend = [
    { n: counts.inProgress, label: "en curso", tone: "now" as const },
    { n: counts.inReview, label: "en revisión", tone: "review" as const },
    { n: counts.ready, label: counts.ready === 1 ? "listo para empezar" : "listos para empezar", tone: "ready" as const },
    { n: counts.blocked, label: counts.blocked === 1 ? "bloqueado" : "bloqueados", tone: "blocked" as const },
  ].filter((l) => l.n > 0);
  return (
    <header className="flex animate-rise flex-wrap items-end justify-between gap-8">
      <div className="grid gap-2">
        <span className="inline-flex items-center gap-2.5 text-xs font-semibold tracking-[0.14em] uppercase" style={{ color: from }}>
          <span aria-hidden className="size-2.5 rounded-[3px]" style={{ background: `linear-gradient(135deg, ${from}, ${to})` }} />
          Proyecto · {slug}
        </span>
        <h1 className="font-display text-5xl leading-[0.95] font-extrabold tracking-[-0.03em] sm:text-7xl">{title}</h1>
        <p className="mt-1 text-[17px] text-muted-foreground">{laneSentence(lanes)}</p>
      </div>
      <div className="flex flex-wrap items-center gap-7">
        {progress.total > 0 && (
          <div className="flex items-center gap-3.5">
            <ProgressRing closed={progress.closed} total={progress.total} />
            <div className="flex flex-col">
              <span className="font-display text-[26px] leading-none font-bold">
                {progress.closed}
                <span className="text-lg font-medium text-muted-foreground">/{progress.total}</span>
              </span>
              <span className="mt-1 text-xs text-muted-foreground">tickets cerrados</span>
            </div>
          </div>
        )}
        {legend.length > 0 && (
          <ul className="grid gap-1.5 text-[13px] text-foreground/80">
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
      className="flex animate-rise flex-wrap items-center gap-3 rounded-[18px] border border-status-ready/20 bg-status-ready/[0.07] px-5 py-3.5"
      style={rise(1)}
    >
      <Kicker className="text-status-ready">
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

/** One initiative as a subway line: filled stations behind, a beating "Aquí", hollow ones ahead. */
export function InitiativeLine({ lane, onOpen, index }: { lane: Lane; onOpen: Open; index: number }) {
  const initiative = lane.initiative!;
  const state = LANE_STATE[lane.state];
  return (
    <article className="lift grid animate-rise gap-5 rounded-[20px] border bg-card px-6 pt-5 pb-5" style={rise(index + 3)}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="grid min-w-0 gap-1">
          <TicketButton taskKey={initiative.key} onOpen={onOpen} className="text-left">
            <span className="font-display text-xl font-bold tracking-tight underline-offset-4 group-hover/ticket:underline">
              {initiative.title}
            </span>
            <span className="ml-2 font-mono text-xs text-muted-foreground">{initiative.key}</span>
          </TicketButton>
          {initiative.summary && <span className="line-clamp-2 text-[13px] text-muted-foreground">{initiative.summary}</span>}
        </div>
        <span
          className={cn("inline-flex shrink-0 items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold", TONE_TEXT[state.tone])}
          style={{ background: `color-mix(in oklab, ${toneVar(state.tone)} 13%, transparent)` }}
        >
          <Glyph tone={state.tone} size={7} />
          {statusWord(initiative.status)} · {lane.closed} de {lane.total}
        </span>
      </div>
      {lane.stations.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sin tickets todavía.</p>
      ) : (
        <ol className="flex overflow-x-auto px-1 pt-7 pb-1" aria-label={`Fases de ${initiative.title}`}>
          {lane.stations.map((s, i) => {
            const nextStation = lane.stations[i + 1];
            const solid = nextStation && s.tone !== "pending" && s.tone !== "ready" && nextStation.tone !== "pending" && nextStation.tone !== "ready";
            return (
              <li key={s.task.key} className={cn("flex items-start", nextStation ? "min-w-[108px] flex-1" : "flex-none")}>
                <TicketButton
                  taskKey={s.task.key}
                  onOpen={onOpen}
                  title={s.task.title}
                  className="relative flex w-20 shrink-0 flex-col items-center gap-2.5 text-center"
                >
                  {s.here && (
                    <span className="absolute -top-6 text-[10px] font-bold tracking-[0.14em] text-status-now uppercase">Aquí</span>
                  )}
                  <Glyph tone={s.tone} size={s.here ? 22 : 18} pulse={s.here && lane.state === "moving"} className={s.here ? "-mt-0.5 ring-[3px] ring-background" : undefined} />
                  <span className="text-xs leading-tight text-muted-foreground">
                    <b className={cn("block font-semibold", s.tone === "pending" ? "text-foreground/75" : "text-foreground")}>{shortLabel(s.task.title)}</b>
                    {statusWord(s.task.status)}
                  </span>
                </TicketButton>
                {nextStation && (
                  <span
                    aria-hidden
                    className="mt-2 h-[3px] min-w-6 flex-1 rounded-full"
                    style={{
                      background: solid
                        ? `linear-gradient(90deg, ${toneVar(s.tone)}, ${toneVar(nextStation.tone)})`
                        : "repeating-linear-gradient(90deg, var(--status-pending) 0 8px, transparent 8px 14px)",
                    }}
                  />
                )}
              </li>
            );
          })}
        </ol>
      )}
    </article>
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
        "inline-flex min-h-11 w-fit items-center gap-1.5 rounded-md text-[13px] font-medium text-status-review hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        className,
      )}
    >
      Ver la ficha completa
      <ArrowRightIcon className="size-3.5" aria-hidden />
    </button>
  );
}

export function FixedDecisions({ text, onFicha }: { text: string; onFicha: () => void }) {
  const items = statements(text);
  return (
    <section
      className="lift grid animate-rise gap-3 rounded-[20px] border border-status-review/30 bg-[linear-gradient(160deg,color-mix(in_oklab,var(--status-review)_10%,var(--card)),var(--card)_70%)] px-5 pt-5 pb-2"
      style={rise(5)}
    >
      <Kicker className="text-status-review">
        <PinIcon className="size-3.5" aria-hidden />
        Decisiones fijas
      </Kicker>
      {items.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">Ninguna todavía.</p>
      ) : (
        <ul className="grid gap-2 text-[13px] leading-snug">
          {items.slice(0, 4).map((s) => (
            <li key={s} className="flex gap-2.5">
              <span aria-hidden className="text-status-review">—</span>
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

const RESUME_FIELDS: [keyof Resume, string][] = [
  ["in_progress", "En curso"],
  ["next_action", "Siguiente"],
  ["branch_or_prod", "Rama / prod"],
  ["must_keep_decision", "Decisión fija"],
];

export function FichaSheet({ resume, title, open, onOpenChange }: { resume: Resume; title: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="gap-0 overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-xl">
        <SheetHeader className="pr-12">
          <SheetDescription>Ficha del proyecto</SheetDescription>
          <SheetTitle className="font-display text-2xl">{title}</SheetTitle>
        </SheetHeader>
        <dl className="grid gap-5 px-4 pb-8">
          {RESUME_FIELDS.map(([field, label]) => (
            <div key={field} className="grid gap-1">
              <dt className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{label}</dt>
              <dd className={cn("text-sm whitespace-pre-wrap", !resume[field] && "text-muted-foreground")}>{resume[field] || "—"}</dd>
            </div>
          ))}
        </dl>
      </SheetContent>
    </Sheet>
  );
}
