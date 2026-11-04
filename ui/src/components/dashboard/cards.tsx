import { CheckIcon } from "lucide-react";
import { progressText } from "@/components/goals/model";
import { STATUS_DOT, STATUS_WORD } from "@/components/team/types";
import { statusWord } from "@/components/plan/visuals";
import { cn } from "@/lib/utils";
import type { Dashboard, DashboardAgent, DashboardGoal } from "@/components/dashboard/types";

const BARS = ["bg-status-done", "bg-status-blocked", "bg-status-review", "bg-status-ready", "bg-status-now"] as const;

const panelClass = "rounded-xl bg-card p-4 ring-1 ring-foreground/10";

const projectLabel = (slug: string | null) => {
  if (!slug) return "Empresa";
  return slug.charAt(0).toUpperCase() + slug.slice(1);
};

const agentLine = (agent: DashboardAgent) => {
  if (agent.note && agent.claim) return `${agent.claim.key} · ${agent.note}`;
  if (agent.claim) return `${agent.claim.key} · ${agent.claim.title}`;
  if (agent.note) return agent.note;
  return STATUS_WORD[agent.status] ?? agent.status;
};

export const StatRow = ({ data }: { data: Dashboard }) => {
  const { team, shipped } = data;
  const idle = `${team.idle} en espera`;
  const stuck = `${team.stuck} ${team.stuck === 1 ? "atascado" : "atascados"}`;
  return (
    <div className="grid gap-3 min-[380px]:grid-cols-2">
      <article className={panelClass}>
        <h2 className="text-[11px] font-bold tracking-[0.14em] text-muted-foreground uppercase">Salió esta semana</h2>
        <p className="mt-2 font-display text-4xl font-extrabold tracking-tight tabular-nums">{shipped.finished}</p>
        <p className="text-xs text-muted-foreground">{shipped.prs === 1 ? "1 PR" : `${shipped.prs} PRs`}</p>
      </article>
      <article className={panelClass}>
        <h2 className="text-[11px] font-bold tracking-[0.14em] text-muted-foreground uppercase">Equipo en marcha</h2>
        <p className="mt-2 font-display text-4xl font-extrabold tracking-tight text-ink-done tabular-nums">
          {team.alive}
          <span className="text-lg font-semibold text-muted-foreground">/{team.total}</span>
        </p>
        <p className="text-xs text-muted-foreground">{idle} · {stuck}</p>
      </article>
    </div>
  );
};

export const GoalBars = ({ goals }: { goals: DashboardGoal[] }) => (
  <section className={panelClass} aria-labelledby="ceo-goals">
    <h2 id="ceo-goals" className="text-[11px] font-bold tracking-[0.14em] text-muted-foreground uppercase">Metas</h2>
    {goals.length === 0 ? (
      <p className="mt-3 text-sm text-muted-foreground">Todavía no hay metas.</p>
    ) : (
      <ul className="mt-3 grid gap-3">
        {goals.map((goal, index) => {
          const width = goal.progress.total === 0 ? 0 : Math.round((goal.progress.done / goal.progress.total) * 100);
          const label = progressText(goal.progress.done, goal.progress.total);
          const fill = BARS[index % BARS.length];
          return (
            <li key={goal.id}>
              <p className="text-sm">
                <span className="text-muted-foreground">{projectLabel(goal.project)}: </span>
                {goal.title}
              </p>
              <div
                className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={Math.max(goal.progress.total, 1)}
                aria-valuenow={goal.progress.done}
                aria-valuetext={label}
                aria-label={`${goal.title}, ${label}`}
              >
                <div className={cn("h-full rounded-full", fill)} style={{ width: `${width}%` }} />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{label}</p>
            </li>
          );
        })}
      </ul>
    )}
  </section>
);

export const TeamNow = ({ agents }: { agents: DashboardAgent[] }) => (
  <section className={panelClass} aria-labelledby="ceo-team">
    <h2 id="ceo-team" className="text-[11px] font-bold tracking-[0.14em] text-muted-foreground uppercase">Equipo ahora</h2>
    {agents.length === 0 ? (
      <p className="mt-3 text-sm text-muted-foreground">Todavía no hay nadie en el organigrama.</p>
    ) : (
      <ul className="mt-1">
        {agents.map((agent) => (
          <li key={agent.slug} className="flex items-center justify-between gap-3 border-b border-border py-2.5 last:border-0">
            <span className="flex min-w-0 items-center gap-2">
              <span className={cn("size-2 shrink-0 rounded-full", STATUS_DOT[agent.status] ?? "bg-status-idle")} aria-hidden />
              <span className="truncate text-sm">{agent.name}</span>
              <span className="sr-only">{STATUS_WORD[agent.status] ?? agent.status}</span>
            </span>
            <span className="max-w-[58%] truncate text-right text-xs text-muted-foreground">{agentLine(agent)}</span>
          </li>
        ))}
      </ul>
    )}
  </section>
);

export const CeoWaits = ({ waits }: { waits: Dashboard["waits"] }) => (
  <section className={cn(panelClass, "ring-status-review")} aria-labelledby="ceo-waits">
    <h2 id="ceo-waits" className="text-[11px] font-bold tracking-[0.14em] text-muted-foreground uppercase">
      Solo tú puedes ({waits.length})
    </h2>
    {waits.length === 0 ? (
      <p className="mt-3 text-sm text-muted-foreground">Nada espera al CEO.</p>
    ) : (
      <>
        <ul className="mt-3 grid gap-2.5">
          {waits.map((item) => (
            <li key={item.id} className="text-sm">
              <span>{item.why}</span>{" "}
              <span className="inline-flex rounded-full bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                {projectLabel(item.project)}
                {item.key ? ` · ${item.key}` : ""}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted-foreground">Nada se detiene por esto: el equipo sigue.</p>
      </>
    )}
  </section>
);

export const WeekWins = ({ shipped }: { shipped: Dashboard["shipped"] }) => {
  const peak = shipped.buckets.reduce((max, bucket) => Math.max(max, bucket.total), 0);
  return (
    <section className={panelClass} aria-labelledby="ceo-wins">
      <h2 id="ceo-wins" className="text-[11px] font-bold tracking-[0.14em] text-muted-foreground uppercase">Lo que salió</h2>
      <ol className="mt-3 grid grid-cols-7 gap-1.5">
        {shipped.buckets.map((bucket) => {
          const height = peak === 0 ? 0 : Math.round((bucket.total / peak) * 100);
          return (
            <li key={bucket.date} className="grid justify-items-center gap-1" aria-label={`${bucket.label}: ${bucket.total}`}>
              <span className="flex h-10 w-full items-end">
                <span className="block w-full rounded-sm bg-status-done/80" style={{ height: `${Math.max(height, bucket.total > 0 ? 12 : 0)}%` }} />
              </span>
              <span className="text-[10px] text-muted-foreground">{bucket.label}</span>
            </li>
          );
        })}
      </ol>
      {shipped.wins.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">Esta semana todavía no se cierra nada.</p>
      ) : (
        <ul className="mt-3 grid gap-2">
          {shipped.wins.map((win) => (
            <li key={`${win.project}:${win.key ?? win.title}`} className="flex gap-2 text-sm">
              <CheckIcon className="mt-0.5 size-4 shrink-0 text-ink-done" aria-hidden />
              <span className="min-w-0">
                {win.title}{" "}
                {win.key && <span className="font-mono text-xs text-muted-foreground">{win.key}</span>}
                <span className="mt-0.5 block text-xs text-muted-foreground">{win.type_label}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

export const StuckWork = ({ stuck }: { stuck: Dashboard["stuck"] }) => (
  <section className={panelClass} aria-labelledby="ceo-stuck">
    <h2 id="ceo-stuck" className="text-[11px] font-bold tracking-[0.14em] text-muted-foreground uppercase">Trabajo atascado</h2>
    {stuck.length === 0 ? (
      <p className="mt-3 text-sm text-muted-foreground">Nadie está atascado.</p>
    ) : (
      <ul className="mt-3 grid gap-2">
        {stuck.map((item) => (
          <li key={`${item.project}:${item.key}`} className="flex items-start justify-between gap-3 text-sm">
            <span className="min-w-0">
              <span className="font-mono text-xs text-muted-foreground">{item.key}</span>
              <span className="mt-0.5 block truncate">{item.title}</span>
            </span>
            <span className="shrink-0 text-right text-xs text-ink-blocked">
              {item.name}
              <span className="mt-0.5 block text-muted-foreground">{statusWord(item.status)}</span>
            </span>
          </li>
        ))}
      </ul>
    )}
  </section>
);
