// "En paralelo": one row per lane, the same five columns for all of them, arrows between columns.
// A column empty in every lane narrows to a strip. Below md the grid becomes one stacked card per lane
// (En revisión, En curso, a down arrow, Siguiente).
import { ExternalLinkIcon, HandIcon } from "lucide-react";
import { Fragment, type ReactNode } from "react";
import { FlowArrow, FlowArrowDown, Glyph, Kicker, LANE_STATE, rise, statusWord, TONE_TEXT } from "@/components/plan/visuals";
import { emptyColumns, LOOSE_LANE_ID, waitsLabel, waitsOnJorge, type Lane, type LaneColumn, type LaneTask, type StationTone } from "@/lib/lanes";
import { cn } from "@/lib/utils";
import { Glide } from "@/components/plan/glide";
import { DueTag } from "@/components/due";
import { TicketButton } from "@/components/plan/ticket-button";
import { dueText, isOverdue } from "@/lib/due";

type Open = (key: string) => void;
// slug and scope let each ticket glide between columns when it changes (glide.tsx).
type Ctx = { slug: string; scope: string };

const LATER_CHIPS = 4;

function LaneLabel({ lane, onOpen }: { lane: Lane; onOpen: Open }) {
  const state = LANE_STATE[lane.state];
  if (!lane.initiative) {
    return (
      <div className="flex flex-col justify-center gap-1 py-2 pr-4">
        <span className="font-display text-[17px] leading-tight font-bold text-muted-foreground">Sueltos</span>
        <span className="text-[11px] text-muted-foreground">sin iniciativa</span>
      </div>
    );
  }
  return (
    <div className="flex flex-col justify-center gap-1 py-2 pr-4">
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
    <div className="flex h-full min-h-16 items-center justify-center rounded-2xl border border-dashed border-foreground/10 px-4 py-3 text-xs text-muted-foreground">
      {children}
    </div>
  );
}

// The ticket's code (ZIG-12, FIL-I6-3) before its title, so a key read elsewhere can be found here.
function KeyTag({ k }: { k: string }) {
  return <span className="mr-1.5 font-mono text-[11px] font-medium text-muted-foreground no-underline">{k}</span>;
}

function DoneCell({ lane, onOpen, ctx }: { lane: Lane; onOpen: Open; ctx: Ctx }) {
  const last = lane.done[0];
  if (!last) return <Empty>nada aún</Empty>;
  return (
    <Glide slug={ctx.slug} taskKey={last.key} scope={ctx.scope} className="h-full rounded-2xl">
    <TicketButton
      taskKey={last.key}
      onOpen={onOpen}
      className="lift flex h-full w-full flex-col justify-center gap-1 rounded-2xl border bg-card px-4 py-2.5 text-left"
    >
      <span className="line-clamp-2 text-sm leading-snug font-semibold"><KeyTag k={last.key} />{last.title}</span>
      <span className="text-xs text-muted-foreground">
        {lane.done.length > 1 ? `y ${lane.done.length - 1} más hechos` : "hecho"}
      </span>
    </TicketButton>
    </Glide>
  );
}

function NowRow({ task, onOpen, ctx }: { task: LaneTask; onOpen: Open; ctx: Ctx }) {
  const tone = task.status === "Blocked" ? "blocked" : waitsOnJorge(task) ? "jorge" : "now";
  return (
    <Glide slug={ctx.slug} taskKey={task.key} scope={ctx.scope} className="flex items-start gap-2.5">
      <Glyph tone={tone} size={9} className="mt-1.5" />
      <div className="min-w-0 flex-1">
        <TicketButton taskKey={task.key} onOpen={onOpen} className="text-left">
          <span className="line-clamp-2 text-sm leading-snug underline-offset-4 group-hover/ticket:underline">
            <KeyTag k={task.key} />
            <b className="font-semibold">{task.title}</b>
          </span>
        </TicketButton>
        {/* The column already says "en curso"; only blocked gets its word. */}
        {(task.status === "Blocked" || task.claimed_by) && (
          <span className={cn("flex items-center gap-1.5 text-xs", TONE_TEXT[tone])}>
            {task.status === "Blocked" && statusWord(task.status)}
            {task.claimed_by && <span className="text-muted-foreground">{task.status === "Blocked" && "· "}{task.claimed_by.agent}</span>}
          </span>
        )}
        <DueTag task={task} className="block" />
        {waitsOnJorge(task) && (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-ink-jorge">
            <HandIcon className="size-3" aria-hidden /> te toca a ti
          </span>
        )}
        {task.status === "Blocked" && task.blocked_note && (
          <span className="line-clamp-2 text-xs text-muted-foreground">{task.blocked_note}</span>
        )}
      </div>
    </Glide>
  );
}

function ReviewCell({ lane, onOpen, ctx }: { lane: Lane; onOpen: Open; ctx: Ctx }) {
  if (lane.review.length === 0) return <Empty>—</Empty>;
  const branch = lane.initiative?.branch?.trim();
  const pr = lane.initiative?.pr_url;
  return (
    <div className="lift flex h-full flex-col justify-center gap-2 rounded-2xl border border-status-review/40 bg-[color-mix(in_oklab,var(--status-review)_7%,var(--card))] px-4 py-3">
      {lane.review.map((t) => (
        <Glide key={t.key} slug={ctx.slug} taskKey={t.key} scope={ctx.scope} className="flex items-start gap-2.5">
          <Glyph tone="review" size={8} className="mt-1.5" />
          <div className="min-w-0 flex-1">
            <TicketButton taskKey={t.key} onOpen={onOpen} className="text-left">
              <span className="line-clamp-2 text-sm leading-snug underline-offset-4 group-hover/ticket:underline"><KeyTag k={t.key} />{t.title}</span>
            </TicketButton>
            {(t.status !== "In review" || t.pr_url) && (
              <span className="flex items-center gap-1.5 text-xs text-ink-review">
                {t.status !== "In review" && statusWord(t.status)}
                {t.pr_url && (
                  <a href={t.pr_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-muted-foreground hover:text-foreground">
                    PR <ExternalLinkIcon className="size-3" />
                  </a>
                )}
              </span>
            )}
          </div>
        </Glide>
      ))}
      {/* One PR per initiative: phases wait on its branch, so say where once. */}
      {branch && (
        <span className="flex items-center gap-1.5 truncate pl-[18px] font-mono text-[11px] text-muted-foreground">
          <span className="truncate" title={branch}>{branch}</span>
          {pr ? (
            <a href={pr} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-0.5 font-sans hover:text-foreground">
              · PR <ExternalLinkIcon className="size-3" />
            </a>
          ) : (
            <span className="shrink-0 font-sans">· sin PR</span>
          )}
        </span>
      )}
    </div>
  );
}

function NowCell({ lane, onOpen, ctx }: { lane: Lane; onOpen: Open; ctx: Ctx }) {
  if (lane.now.length === 0) {
    return (
      <div className="flex h-full items-center gap-3 rounded-2xl border bg-card px-4 py-3">
        <HandIcon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="flex flex-col">
          <span className="text-sm font-semibold">
            {lane.state === "paused" ? "En pausa" : lane.review.length > 0 ? "Nada en curso" : "Nadie trabaja aquí"}
          </span>
          <span className="text-xs text-muted-foreground">
            {lane.review.length > 0
              ? "lo hecho espera revisión"
              : lane.next.length > 0
                ? <><span className="md:hidden">lo siguiente está debajo</span><span className="hidden md:inline">lo siguiente está a la derecha</span></>
                : "no hay nada abierto"}
          </span>
        </span>
      </div>
    );
  }
  const working = lane.now.some((t) => t.status === "In progress");
  return (
    <div
      className={cn(
        "flex h-full flex-col justify-center gap-2.5 rounded-[18px] border px-4 py-3",
        working
          ? "animate-now-pulse border-status-now/55 bg-[linear-gradient(160deg,color-mix(in_oklab,var(--status-now)_14%,var(--card)),var(--card)_70%)]"
          : lane.now.some(waitsOnJorge)
            ? "border-status-jorge/50 bg-[color-mix(in_oklab,var(--status-jorge)_8%,var(--card))]"
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
      {shown.map((t, i) => {
        // Blocked here means queued behind other tickets (lanes.ts isQueued).
        const queued = t.status === "Blocked";
        return (
          <Glide key={t.key} slug={ctx.slug} taskKey={t.key} scope={ctx.scope} className="flex items-start gap-2.5">
            <span
              aria-hidden
              className={cn(
                "inline-flex size-[22px] shrink-0 items-center justify-center rounded-full text-xs font-bold",
                queued
                  ? "border-2 border-dashed border-status-pending text-muted-foreground"
                  : i === 0
                    ? "bg-status-ready text-background"
                    : "border-2 border-status-ready text-ink-ready",
              )}
            >
              {i + 1}
            </span>
            <div className="min-w-0 pt-0.5">
              <TicketButton taskKey={t.key} onOpen={onOpen} className="text-left">
                <span className="line-clamp-2 text-sm leading-snug underline-offset-4 group-hover/ticket:underline"><KeyTag k={t.key} />{t.title}</span>
              </TicketButton>
              {queued && <span className="block text-xs text-muted-foreground">espera {waitsLabel(t, lane)}</span>}
              <DueTag task={t} className="block" />
            </div>
          </Glide>
        );
      })}
      {lane.next.length > shown.length && <span className="pl-8 text-xs text-muted-foreground">y {lane.next.length - shown.length} más</span>}
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
            title={`${t.key} · ${t.title}${dueText(t) ? ` · ${dueText(t)}` : ""}`}
            className={cn(
              "block max-w-full truncate rounded-full px-2.5 py-1 text-xs transition hover:-translate-y-px",
              isOverdue(t) ? "bg-status-blocked/15 text-ink-blocked hover:bg-status-blocked/25" : "bg-foreground/[0.07] text-foreground/80 hover:bg-foreground/[0.12]",
            )}
          >
            <KeyTag k={t.key} />
            {t.title}
          </TicketButton>
          </Glide>
        ))}
      </div>
      {lane.later.length > LATER_CHIPS && <span className="text-xs text-muted-foreground">y {lane.later.length - LATER_CHIPS} más</span>}
    </div>
  );
}

type Column = { id: LaneColumn; label: string; glyph: StationTone; className: string; width: string };

const COLUMNS: Column[] = [
  { id: "done", label: "Hecho", glyph: "done", className: "text-ink-done", width: "minmax(0,0.9fr)" },
  { id: "review", label: "En revisión", glyph: "review", className: "text-ink-review", width: "minmax(0,1.2fr)" },
  { id: "now", label: "En curso", glyph: "now", className: "text-ink-now", width: "minmax(0,1.3fr)" },
  { id: "next", label: "Siguiente", glyph: "ready", className: "text-ink-ready", width: "minmax(0,1.3fr)" },
  { id: "later", label: "Después", glyph: "pending", className: "text-muted-foreground", width: "minmax(0,0.9fr)" },
];

const CELLS: Record<LaneColumn, (p: { lane: Lane; onOpen: Open; ctx: Ctx }) => ReactNode> = {
  done: DoneCell,
  review: ReviewCell,
  now: NowCell,
  next: NextCell,
  later: LaterCell,
};

const LABEL_W = 200;
const ARROW_W = 28;
const STRIP_W = 40;
const COLUMN_MIN = 170;

/** The arrow after a column marches when the lane moves and that column has something to hand on. */
function arrowAfter(lane: Lane, column: LaneColumn) {
  const moving = lane.state === "moving";
  const tone: StationTone = column === "next" ? "ready" : column === "later" ? "pending" : column;
  return { tone, moving: moving && (column === "now" || lane[column].length > 0) };
}

/** Narrow strip for a column nothing in any lane is in: a thin dashed line. */
function Strip() {
  return <div aria-hidden className="mx-auto h-full min-h-16 w-px border-l border-dashed border-foreground/10" />;
}

export function LaneGrid({ slug, lanes, onOpen }: { slug: string; lanes: Lane[]; onOpen: Open }) {
  const grid = { slug, scope: "grid" };
  const stack = { slug, scope: "stack" };
  const empty = emptyColumns(lanes);
  const template = [
    `${LABEL_W}px`,
    COLUMNS.map((c) => (empty.has(c.id) ? `${STRIP_W}px` : c.width)).join(` ${ARROW_W}px `),
  ].join(" ");
  const minWidth =
    LABEL_W + COLUMNS.reduce((w, c) => w + (empty.has(c.id) ? STRIP_W : COLUMN_MIN), 0) + ARROW_W * (COLUMNS.length - 1);
  return (
    <>
      {/* md and up: one shared grid so every lane's columns line up. */}
      <div className="hidden overflow-x-auto pb-3 md:block">
        <div
          role="table"
          aria-label="Iniciativas en paralelo"
          className="grid gap-y-2.5"
          style={{ gridTemplateColumns: template, minWidth }}
        >
          <div role="row" className="contents">
            <span role="columnheader" className="sr-only">Iniciativa</span>
            {COLUMNS.map((c, i) => (
              <div key={c.id} role="columnheader" className="px-1" style={{ gridColumn: 2 + i * 2 }} title={empty.has(c.id) ? `${c.label}: nada` : undefined}>
                {empty.has(c.id) ? (
                  <span className="flex justify-center pt-0.5">
                    <Glyph tone={c.glyph} size={9} />
                    <span className="sr-only">{c.label}</span>
                  </span>
                ) : (
                  <Kicker className={c.className}>
                    <Glyph tone={c.glyph} size={9} />
                    {c.label}
                  </Kicker>
                )}
              </div>
            ))}
          </div>
          {lanes.map((lane, i) => (
            <div role="row" key={lane.id} data-lane={lane.id} className="contents">
              <div role="rowheader" className="animate-rise border-t" style={rise(i * 2)}>
                <LaneLabel lane={lane} onOpen={onOpen} />
              </div>
              {COLUMNS.map((c, j) => {
                const Cell = CELLS[c.id];
                return (
                  <Fragment key={c.id}>
                    {j > 0 && <FlowArrow {...arrowAfter(lane, COLUMNS[j - 1]!.id)} className="self-center" />}
                    <div role="cell" className="animate-rise" style={rise(i * 2 + j + 1)}>
                      {empty.has(c.id) ? <Strip /> : <Cell lane={lane} onOpen={onOpen} ctx={grid} />}
                    </div>
                  </Fragment>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Phones: one card per lane: review, now, then next. */}
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
              {lane.review.length > 0 && (
                <>
                  <Kicker className="text-ink-review"><Glyph tone="review" size={8} />En revisión</Kicker>
                  <ReviewCell lane={lane} onOpen={onOpen} ctx={stack} />
                </>
              )}
              <Kicker className="text-ink-now"><Glyph tone="now" size={8} />En curso</Kicker>
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
