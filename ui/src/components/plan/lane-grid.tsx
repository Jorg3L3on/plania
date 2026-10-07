// "En paralelo": one row per lane, the same four columns for all of them, arrows between columns.
// Below md the grid becomes one stacked card per lane (Ahora, a down arrow, Siguiente).
import { ExternalLinkIcon, HandIcon } from "lucide-react";
import type { ReactNode } from "react";
import { FlowArrow, FlowArrowDown, Glyph, Kicker, LANE_STATE, rise, statusWord, TONE_TEXT } from "@/components/plan/visuals";
import { LOOSE_LANE_ID, waitsOnJorge, type Lane, type LaneTask } from "@/lib/lanes";
import { cn } from "@/lib/utils";
import { Glide } from "@/components/plan/glide";
import { TicketButton } from "@/components/plan/ticket-button";

type Open = (key: string) => void;
// slug and scope let each ticket glide between columns when it changes (glide.tsx).
type Ctx = { slug: string; scope: string };

const LATER_CHIPS = 4;

function LaneLabel({ lane, onOpen }: { lane: Lane; onOpen: Open }) {
  const state = LANE_STATE[lane.state];
  if (!lane.initiative) {
    return (
      <div className="flex flex-col justify-center gap-1 py-3 pr-4">
        <span className="font-display text-[17px] leading-tight font-bold text-muted-foreground">Sueltos</span>
        <span className="text-[11px] text-muted-foreground">sin iniciativa</span>
      </div>
    );
  }
  return (
    <div className="flex flex-col justify-center gap-1.5 py-3 pr-4">
      <TicketButton taskKey={lane.initiative.key} onOpen={onOpen} className="text-left">
        <span className="line-clamp-2 font-display text-[17px] leading-tight font-bold tracking-tight underline-offset-4 group-hover/ticket:underline">
          {lane.initiative.title}
        </span>
      </TicketButton>
      <span className="font-mono text-[11px] text-muted-foreground">{lane.initiative.key}</span>
      <span className={cn("inline-flex items-center gap-1.5 text-[11px] font-semibold", TONE_TEXT[state.tone])}>
        <Glyph tone={state.tone} size={7} pulse={lane.state === "moving"} />
        {state.word} · {lane.closed} de {lane.total}
      </span>
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-16 items-center justify-center rounded-2xl border border-dashed border-foreground/10 px-4 py-3 text-xs text-muted-foreground">
      {children}
    </div>
  );
}

function DoneCell({ lane, onOpen, ctx }: { lane: Lane; onOpen: Open; ctx: Ctx }) {
  const last = lane.done[0];
  if (!last) return <Empty>nada aún</Empty>;
  return (
    <Glide slug={ctx.slug} taskKey={last.key} scope={ctx.scope} className="h-full rounded-2xl">
    <TicketButton
      taskKey={last.key}
      onOpen={onOpen}
      className="lift flex h-full w-full flex-col justify-center gap-1 rounded-2xl border bg-card px-4 py-3 text-left"
    >
      <span className="line-clamp-2 text-sm leading-snug font-semibold">{last.title}</span>
      <span className="text-xs text-muted-foreground">
        {lane.done.length > 1 ? `y ${lane.done.length - 1} más hechos` : "hecho"}
      </span>
    </TicketButton>
    </Glide>
  );
}

function NowRow({ task, onOpen, ctx }: { task: LaneTask; onOpen: Open; ctx: Ctx }) {
  const tone = task.status === "In review" ? "review" : task.status === "Blocked" ? "blocked" : "now";
  return (
    <Glide slug={ctx.slug} taskKey={task.key} scope={ctx.scope} className="flex items-start gap-2.5">
      <Glyph tone={tone} size={9} className="mt-1.5" />
      <div className="min-w-0 flex-1">
        <TicketButton taskKey={task.key} onOpen={onOpen} className="text-left">
          <span className="line-clamp-2 text-sm leading-snug underline-offset-4 group-hover/ticket:underline">
            <b className="font-semibold">{task.title}</b>
          </span>
        </TicketButton>
        <span className={cn("flex items-center gap-1.5 text-xs", TONE_TEXT[tone])}>
          {statusWord(task.status)}
          {task.status === "In review" && task.pr_url && (
            <a href={task.pr_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-muted-foreground hover:text-foreground">
              PR <ExternalLinkIcon className="size-3" />
            </a>
          )}
        </span>
        {task.status === "Blocked" && task.blocked_note && (
          waitsOnJorge(task) ? (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-ink-ready">
              <HandIcon className="size-3" aria-hidden /> te toca a ti
            </span>
          ) : (
            <span className="line-clamp-2 text-xs text-muted-foreground">{task.blocked_note}</span>
          )
        )}
      </div>
    </Glide>
  );
}

function NowCell({ lane, onOpen, ctx }: { lane: Lane; onOpen: Open; ctx: Ctx }) {
  if (lane.now.length === 0) {
    return (
      <div className="flex h-full items-center gap-3 rounded-2xl border bg-card px-4 py-3">
        <HandIcon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="flex flex-col">
          <span className="text-sm font-semibold">{lane.state === "paused" ? "En pausa" : "Nadie trabaja aquí"}</span>
          <span className="text-xs text-muted-foreground">
            {lane.next.length > 0 ? "lo siguiente está a la derecha" : "no hay nada abierto"}
          </span>
        </span>
      </div>
    );
  }
  const moving = lane.state === "moving";
  return (
    <div
      className={cn(
        "flex h-full flex-col justify-center gap-2.5 rounded-[18px] border px-4 py-3.5",
        moving
          ? "animate-now-pulse border-status-now/55 bg-[linear-gradient(160deg,color-mix(in_oklab,var(--status-now)_14%,var(--card)),var(--card)_70%)]"
          : "border-status-blocked/40 bg-card",
      )}
    >
      {lane.now.map((t) => <NowRow key={t.key} task={t} onOpen={onOpen} ctx={ctx} />)}
    </div>
  );
}

function NextCell({ lane, onOpen, ctx }: { lane: Lane; onOpen: Open; ctx: Ctx }) {
  if (lane.next.length === 0) return <Empty>—</Empty>;
  const shown = lane.next.slice(0, 3);
  return (
    <div className="lift flex h-full flex-col justify-center gap-2 rounded-2xl border border-status-ready/40 bg-[color-mix(in_oklab,var(--status-ready)_7%,var(--card))] px-4 py-3">
      {shown.map((t, i) => (
        <Glide key={t.key} slug={ctx.slug} taskKey={t.key} scope={ctx.scope} className="flex items-start gap-2.5">
          <span
            aria-hidden
            className={cn(
              "inline-flex size-[22px] shrink-0 items-center justify-center rounded-full text-xs font-bold",
              i === 0 ? "bg-status-ready text-background" : "border-2 border-status-ready text-ink-ready",
            )}
          >
            {i + 1}
          </span>
          <TicketButton taskKey={t.key} onOpen={onOpen} className="min-w-0 pt-0.5 text-left">
            <span className="line-clamp-2 text-sm leading-snug underline-offset-4 group-hover/ticket:underline">{t.title}</span>
          </TicketButton>
        </Glide>
      ))}
      {lane.next.length > shown.length && <span className="pl-8 text-xs text-muted-foreground">y {lane.next.length - shown.length} más listos</span>}
    </div>
  );
}

function LaterCell({ lane, onOpen, ctx }: { lane: Lane; onOpen: Open; ctx: Ctx }) {
  if (lane.later.length === 0) return <Empty>—</Empty>;
  return (
    <div className="flex h-full flex-col justify-center gap-2 rounded-2xl border border-dashed border-foreground/15 bg-surface-sunken px-4 py-3">
      <div className="flex flex-wrap gap-1.5">
        {lane.later.slice(0, LATER_CHIPS).map((t) => (
          <Glide key={t.key} slug={ctx.slug} taskKey={t.key} scope={ctx.scope} className="max-w-full rounded-full">
          <TicketButton
            taskKey={t.key}
            onOpen={onOpen}
            title={t.title}
            className="block max-w-full truncate rounded-full bg-foreground/[0.07] px-2.5 py-1 text-xs text-foreground/80 transition hover:-translate-y-px hover:bg-foreground/[0.12]"
          >
            {t.title}
          </TicketButton>
          </Glide>
        ))}
      </div>
      {lane.later.length > LATER_CHIPS && <span className="text-xs text-muted-foreground">y {lane.later.length - LATER_CHIPS} más</span>}
    </div>
  );
}

function arrowsFor(lane: Lane) {
  const moving = lane.state === "moving";
  return {
    afterDone: { tone: "done" as const, moving: moving && lane.done.length > 0 },
    afterNow: { tone: "now" as const, moving },
    afterNext: { tone: "ready" as const, moving: moving && lane.next.length > 0 },
  };
}

const HEADERS = [
  { label: "Hecho", glyph: "done" as const, className: "text-ink-done" },
  { label: "Ahora", glyph: "now" as const, className: "text-ink-now" },
  { label: "Siguiente", glyph: "ready" as const, className: "text-ink-ready" },
  { label: "Después", glyph: "pending" as const, className: "text-muted-foreground" },
];

export function LaneGrid({ slug, lanes, onOpen }: { slug: string; lanes: Lane[]; onOpen: Open }) {
  const grid = { slug, scope: "grid" };
  const stack = { slug, scope: "stack" };
  return (
    <>
      {/* md and up: one shared grid so every lane's columns line up. */}
      <div className="hidden overflow-x-auto pb-3 md:block">
        <div
          role="table"
          aria-label="Iniciativas en paralelo"
          className="grid min-w-[980px] grid-cols-[176px_minmax(0,1fr)_44px_minmax(0,1.45fr)_44px_minmax(0,1.35fr)_44px_minmax(0,1fr)] gap-y-3.5"
        >
          <div role="row" className="contents">
            <span role="columnheader" className="sr-only">Iniciativa</span>
            {HEADERS.map((h, i) => (
              <div key={h.label} role="columnheader" className={cn("px-1", i > 0 && "col-start-auto")} style={{ gridColumn: 2 + i * 2 }}>
                <Kicker className={h.className}>
                  <Glyph tone={h.glyph} size={9} />
                  {h.label}
                </Kicker>
              </div>
            ))}
          </div>
          {lanes.map((lane, i) => {
            const a = arrowsFor(lane);
            return (
              <div role="row" key={lane.id} data-lane={lane.id} className="contents">
                <div role="rowheader" className="animate-rise border-t" style={rise(i * 2)}>
                  <LaneLabel lane={lane} onOpen={onOpen} />
                </div>
                <div role="cell" className="animate-rise" style={rise(i * 2 + 1)}><DoneCell lane={lane} onOpen={onOpen} ctx={grid} /></div>
                <FlowArrow {...a.afterDone} className="self-center" />
                <div role="cell" className="animate-rise" style={rise(i * 2 + 2)}><NowCell lane={lane} onOpen={onOpen} ctx={grid} /></div>
                <FlowArrow {...a.afterNow} className="self-center" />
                <div role="cell" className="animate-rise" style={rise(i * 2 + 3)}><NextCell lane={lane} onOpen={onOpen} ctx={grid} /></div>
                <FlowArrow {...a.afterNext} className="self-center" />
                <div role="cell" className="animate-rise" style={rise(i * 2 + 4)}><LaterCell lane={lane} onOpen={onOpen} ctx={grid} /></div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Phones: one card per lane, now above next. */}
      <div className="grid gap-4 md:hidden">
        {lanes.map((lane, i) => {
          const moving = lane.state === "moving";
          return (
            <section
              key={lane.id}
              data-lane={lane.id}
              aria-label={lane.initiative?.title ?? "Sueltos"}
              className="animate-rise grid gap-1 rounded-[20px] border bg-card/60 p-4"
              style={rise(i)}
            >
              <LaneLabel lane={lane} onOpen={onOpen} />
              <Kicker className="text-ink-now"><Glyph tone="now" size={8} />Ahora</Kicker>
              <NowCell lane={lane} onOpen={onOpen} ctx={stack} />
              <FlowArrowDown tone="now" moving={moving} />
              <Kicker className="text-ink-ready"><Glyph tone="ready" size={8} />Siguiente</Kicker>
              <NextCell lane={lane} onOpen={onOpen} ctx={stack} />
              {(lane.later.length > 0 || lane.done.length > 0) && (
                <p className="pt-2 text-xs text-muted-foreground">
                  {[lane.done.length > 0 && `${lane.done.length} hechos`, lane.later.length > 0 && `${lane.later.length} después`]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              )}
            </section>
          );
        })}
      </div>
    </>
  );
}

export const isLooseLane = (lane: Lane) => lane.id === LOOSE_LANE_ID;
