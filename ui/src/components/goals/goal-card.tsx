import { Button } from "@/components/ui/button";
import { Kicker } from "@/components/plan/visuals";
import { GOAL_STATUS_LABEL, progressText, type Goal, type GoalStatus } from "@/components/goals/model";
import { cn } from "@/lib/utils";

const STATUS_CLASS: Record<GoalStatus, string> = {
  active: "bg-status-ready/15 text-ink-ready",
  done: "bg-status-done/15 text-ink-done",
  dropped: "bg-muted text-muted-foreground",
};

function ProgressBar({ done, total }: { done: number; total: number }) {
  const width = total === 0 ? 0 : Math.round((done / total) * 100);
  const label = progressText(done, total);
  return (
    <div className="grid gap-1.5">
      <div
        className="h-2 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={Math.max(total, 1)}
        aria-valuenow={done}
        aria-valuetext={label}
        aria-label={label}
      >
        <div className="h-full rounded-full bg-status-done" style={{ width: `${width}%` }} />
      </div>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

export function GoalCard({
  goal,
  projectTitle,
  compact = false,
  onEdit,
}: {
  goal: Goal;
  projectTitle?: string;
  compact?: boolean;
  onEdit: (goal: Goal) => void;
}) {
  const shown = goal.initiatives.slice(0, 4);
  const rest = goal.initiatives.length - shown.length;
  const level = goal.project ? (projectTitle ?? goal.project) : "Empresa";
  const handleEdit = () => onEdit(goal);

  return (
    <article className={cn("grid gap-3 rounded-[20px] border bg-card p-4", goal.status === "dropped" && "opacity-70")}>
      <div className="flex items-start justify-between gap-3">
        <Kicker className="text-muted-foreground">{level}</Kicker>
        <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", STATUS_CLASS[goal.status])}>{GOAL_STATUS_LABEL[goal.status]}</span>
      </div>
      <div className="grid gap-1">
        <h3 className="font-display text-xl font-bold tracking-tight">{goal.title}</h3>
        {goal.why ? <p className="text-sm text-muted-foreground">{goal.why}</p> : null}
        {goal.target_on ? <p className="text-xs text-muted-foreground">Objetivo {goal.target_on}</p> : null}
      </div>
      <ProgressBar done={goal.progress.done} total={goal.progress.total} />
      {shown.length > 0 && (
        <ul className="grid gap-1 text-sm">
          {shown.map((initiative) => (
            <li key={initiative.key} className="flex min-w-0 items-baseline gap-2">
              <span className="shrink-0 font-mono text-xs text-muted-foreground">{initiative.key}</span>
              <span className="min-w-0 truncate">{initiative.title}</span>
            </li>
          ))}
          {rest > 0 && <li className="text-xs text-muted-foreground">y {rest} más</li>}
        </ul>
      )}
      <div>
        <Button type="button" variant="outline" size="sm" onClick={handleEdit} aria-label={`Editar ${goal.title}`}>
          Editar
        </Button>
      </div>
      {!compact && goal.children.length > 0 && (
        <div className="grid gap-3 border-l border-border pl-3">
          {goal.children.map((child) => (
            <GoalCard key={child.id} goal={child} projectTitle={projectTitle} onEdit={onEdit} />
          ))}
        </div>
      )}
      {compact && goal.children.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {goal.children.length === 1 ? "1 meta de proyecto" : `${goal.children.length} metas de proyecto`}
        </p>
      )}
    </article>
  );
}
