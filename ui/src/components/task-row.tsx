import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ExternalLinkIcon, LockIcon } from "lucide-react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DueTag } from "@/components/due";
import { api } from "@/lib/api";
import { useLive } from "@/lib/live";
import { localTime } from "@/lib/time";
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

// Who holds the ticket's lease and until when; Liberar frees a lease left by a session that is gone.
export function ClaimLine({ slug, task }: { slug: string; task: Pick<Task, "key" | "title" | "claimed_by" | "lease_until"> }) {
  const queryClient = useQueryClient();
  const release = useMutation({
    mutationFn: () => api.release(slug, task.key),
    onSuccess: () => toast(`${task.title}: lease liberado`),
    onError: () => toast.error("No se pudo liberar."),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["project", slug] }),
  });
  if (!task.claimed_by || !task.lease_until) return null;
  return (
    <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
      <LockIcon className="size-3" />
      <span>
        {task.claimed_by.agent} <span className="font-mono">{task.claimed_by.session_id}</span> hasta {localTime(task.lease_until)}
      </span>
      <Button size="xs" variant="ghost" disabled={release.isPending} onClick={() => release.mutate()}>
        Liberar
      </Button>
    </p>
  );
}

// One line of the list: title, key, summary, plus the controls slot on the right.
export function TaskRow({
  slug,
  task,
  nested = false,
  selected = false,
  onOpen,
  controls,
}: {
  slug: string;
  task: Task;
  nested?: boolean;
  selected?: boolean;
  onOpen: (key: string) => void;
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
        selected && "bg-muted/60",
        fresh && "bg-status-now/15",
      )}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <button
            type="button"
            onClick={() => onOpen(task.key)}
            className={cn(
              "text-left font-medium underline-offset-4 hover:underline focus-visible:underline focus-visible:outline-none",
              task.kind === "initiative" && "font-semibold",
            )}
          >
            {task.title}
          </button>
          {/* Inside a project every key shares its prefix, so ticket codes read like initiative codes.
              Only initiatives show theirs; tickets are known by title (the side panel still shows the key). */}
          {task.kind === "initiative" && <span className="font-mono text-xs text-muted-foreground">{task.key}</span>}
          <DueTag task={task} />
        </div>
        {task.summary && <p className="text-sm text-muted-foreground">{task.summary}</p>}
        {task.status === "Blocked" && task.blocked_note && (
          <p className="mt-1 text-sm text-ink-blocked">{task.blocked_note}</p>
        )}
        <ClaimLine slug={slug} task={task} />
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
