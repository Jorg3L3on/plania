import { Button } from "@/components/ui/button";
import { GOAL_STATUS_LABEL, progressText, type Goal, type GoalStatus } from "@/components/goals/model";
import { cn } from "@/lib/utils";

// road.html is a row: a 34px number, then a card with a 15px title, a chip and a 12px line.
// The mock's base.css is not in the repo, and its hex colors are not reused. These are the app's status tokens.
const STEP_BADGE = [
  "bg-status-review text-background",
  "bg-status-ready text-background",
  "bg-status-done text-background",
  "bg-status-now text-background",
  "bg-status-jorge text-background",
  "bg-status-idle text-background",
] as const;

const STEP_BAR = [
  "bg-status-review",
  "bg-status-ready",
  "bg-status-done",
  "bg-status-now",
  "bg-status-jorge",
  "bg-status-idle",
] as const;

const STATUS_CLASS: Record<GoalStatus, string> = {
  active: "bg-status-ready/15 text-ink-ready",
  done: "bg-status-done/15 text-ink-done",
  dropped: "bg-muted text-muted-foreground",
};

function ProgressBar({ done, total, fill }: { done: number; total: number; fill: string }) {
  const width = total === 0 ? 0 : Math.round((done / total) * 100);
  const label = progressText(done, total);
  return (
    <div className="mt-1.5 grid gap-1">
      <div
        className="h-2 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={Math.max(total, 1)}
        aria-valuenow={done}
        aria-valuetext={label}
        aria-label={label}
      >
        <div className={cn("h-full rounded-full", fill)} style={{ width: `${width}%` }} />
      </div>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

export function GoalCard({
  goal,
  index,
  names,
  compact = false,
  onEdit,
}: {
  goal: Goal;
  index: number;
  names: Map<string, string>;
  compact?: boolean;
  onEdit: (goal: Goal) => void;
}) {
  const shown = goal.initiatives.slice(0, 4);
  const rest = goal.initiatives.length - shown.length;
  const level = goal.project ? (names.get(goal.project) ?? goal.project) : "Empresa";
  const step = index % STEP_BADGE.length;
  const handleEdit = () => onEdit(goal);

  return (
    <div className="flex items-start gap-3">
      <span
        aria-hidden
        className={cn(
          "flex size-[34px] shrink-0 items-center justify-center rounded-full text-sm font-extrabold",
          STEP_BADGE[step],
        )}
      >
        {index + 1}
      </span>
      <div className="grid min-w-0 flex-1 gap-2.5">
        <article className={cn("rounded-2xl border bg-card px-3 py-3", goal.status === "dropped" && "opacity-70")}>
          <div className="flex items-start justify-between gap-2">
            <h3 className="min-w-0 text-[15px] font-bold">
              {goal.title}
              <span className="ml-2 inline-flex rounded-full border px-1.5 py-0.5 align-middle text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
                {level}
              </span>
            </h3>
            <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold", STATUS_CLASS[goal.status])}>
              {GOAL_STATUS_LABEL[goal.status]}
            </span>
          </div>
          {goal.why ? <p className="mt-1 text-xs text-muted-foreground">{goal.why}</p> : null}
          {goal.target_on ? <p className="mt-1 text-xs text-muted-foreground">Objetivo {goal.target_on}</p> : null}
          <ProgressBar done={goal.progress.done} total={goal.progress.total} fill={STEP_BAR[step]!} />
          {shown.length > 0 && (
            <ul className="mt-1.5 grid gap-0.5 text-xs text-muted-foreground">
              {shown.map((initiative) => (
                <li key={initiative.key} className="flex min-w-0 items-baseline gap-2">
                  <span className="shrink-0 font-mono">{initiative.key}</span>
                  <span className="min-w-0 truncate text-foreground">{initiative.title}</span>
                </li>
              ))}
              {rest > 0 && <li>y {rest} más</li>}
            </ul>
          )}
          {compact && goal.children.length > 0 && (
            <p className="mt-1 text-xs text-muted-foreground">
              {goal.children.length === 1 ? "1 meta de proyecto" : `${goal.children.length} metas de proyecto`}
            </p>
          )}
          <div className="mt-2">
            <Button type="button" variant="outline" size="sm" onClick={handleEdit} aria-label={`Editar ${goal.title}`}>
              Editar
            </Button>
          </div>
        </article>
        {!compact && goal.children.length > 0 && (
          <div className="grid gap-2.5">
            {goal.children.map((child, childIndex) => (
              <GoalCard
                key={child.id}
                goal={child}
                index={childIndex}
                names={names}
                onEdit={onEdit}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
