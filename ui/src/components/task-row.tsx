import { ExternalLinkIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { useLive } from "@/lib/live";
import { priorityTone, statusDot } from "@/lib/status";
import type { TaskRow as Task } from "@/lib/types";
import { cn } from "@/lib/utils";

export function StatusLabel({ status }: { status: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm whitespace-nowrap">
      <span className={cn("size-2 rounded-full", statusDot(status))} />
      {status}
    </span>
  );
}

export function PriorityLabel({ priority }: { priority: string }) {
  return (
    <Badge variant="outline" className={cn("font-mono", priorityTone(priority))}>
      {priority}
    </Badge>
  );
}

// One line of the list: title, key, summary, plus the controls slot on the right.
export function TaskRow({
  slug,
  task,
  nested = false,
  controls,
}: {
  slug: string;
  task: Task;
  nested?: boolean;
  controls: ReactNode;
}) {
  const { isFresh } = useLive();
  const fresh = isFresh(slug, task.key);
  return (
    <div
      data-key={task.key}
      className={cn(
        "flex flex-col gap-2 px-4 py-3 transition-colors duration-700 sm:flex-row sm:items-start sm:justify-between sm:gap-4",
        nested && "sm:pl-9",
        fresh && "bg-amber-100/70 dark:bg-amber-500/15",
      )}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className={cn("font-medium", task.kind === "initiative" && "font-semibold")}>{task.title}</span>
          <span className="font-mono text-xs text-muted-foreground">{task.key}</span>
        </div>
        {task.summary && <p className="text-sm text-muted-foreground">{task.summary}</p>}
        {task.status === "Blocked" && task.blocked_note && (
          <p className="mt-1 text-sm text-red-600 dark:text-red-400">{task.blocked_note}</p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {task.status === "In review" && task.pr_url && (
          <a
            href={task.pr_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            PR <ExternalLinkIcon className="size-3.5" />
          </a>
        )}
        {controls}
      </div>
    </div>
  );
}
