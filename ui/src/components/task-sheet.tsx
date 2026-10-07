import { useQuery } from "@tanstack/react-query";
import { ExternalLinkIcon } from "lucide-react";
import type { ReactNode } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { TaskControls } from "@/components/task-controls";
import { api, ApiError } from "@/lib/api";
import type { TaskDetail } from "@/lib/types";
import { cn } from "@/lib/utils";

// Side panel with one task's full body. The open task lives in the URL (?task=KEY),
// so it can be linked and the back button closes it. Live changes refetch it like the list.

function TaskLink({ slug, taskKey, onOpen }: { slug: string; taskKey: string; onOpen: (key: string) => void }) {
  // Titles come from the project list already in the cache; the key is the fallback.
  const project = useQuery({ queryKey: ["project", slug], queryFn: () => api.project(slug) });
  const title = project.data?.tasks.find((t) => t.key === taskKey)?.title;
  return (
    <button
      type="button"
      title={taskKey}
      onClick={() => onOpen(taskKey)}
      className={cn(
        "text-left text-sm underline decoration-muted-foreground/40 underline-offset-4 hover:decoration-foreground",
        !title && "font-mono",
      )}
    >
      {title ?? taskKey}
    </button>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-sm break-words">{children}</dd>
    </>
  );
}

function Details({ slug, task, onOpen }: { slug: string; task: TaskDetail; onOpen: (key: string) => void }) {
  const links = (keys: string[]) => (
    <span className="flex flex-col items-start gap-1">
      {keys.map((k) => <TaskLink key={k} slug={slug} taskKey={k} onOpen={onOpen} />)}
    </span>
  );
  return (
    <div className="grid gap-6 px-4 pb-8">
      <div className="flex flex-wrap items-center gap-2">
        <TaskControls slug={slug} task={task} />
      </div>

      {task.status === "Blocked" && task.blocked_note && (
        <p className="rounded-lg border border-status-blocked/30 bg-status-blocked/5 px-3 py-2 text-sm text-ink-blocked">
          {task.blocked_note}
        </p>
      )}

      <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2">
        {task.parent_key && <Field label="Iniciativa"><TaskLink slug={slug} taskKey={task.parent_key} onOpen={onOpen} /></Field>}
        {task.child_keys.length > 0 && <Field label="Fases">{links(task.child_keys)}</Field>}
        {task.blocked_by.length > 0 && <Field label="Bloqueado por">{links(task.blocked_by)}</Field>}
        {task.origin && <Field label="Origen">{task.origin}</Field>}
        {task.base_branch && <Field label="Rama base"><span className="font-mono">{task.base_branch}</span></Field>}
        {task.branch && <Field label="Rama"><span className="font-mono">{task.branch}</span></Field>}
        {task.pr_url && (
          <Field label="PR">
            <a href={task.pr_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline underline-offset-4">
              {task.pr_url.replace(/^https?:\/\/(www\.)?github\.com\//, "")}
              <ExternalLinkIcon className="size-3.5" />
            </a>
          </Field>
        )}
      </dl>

      <Separator />

      {task.body.trim() ? (
        <article
          className={cn(
            "prose prose-sm max-w-none dark:prose-invert prose-headings:font-semibold",
            "prose-pre:bg-muted prose-pre:text-foreground",
            // Inline code: a soft chip instead of the plugin's literal backticks.
            "prose-code:rounded prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:font-normal",
            "prose-code:before:content-none prose-code:after:content-none",
            // GFM checklists: the checkbox replaces the bullet.
            "[&_li:has(>input)]:list-none [&_ul:has(>li>input)]:pl-0 [&_li>input]:mr-2",
          )}
        >
          <Markdown
            remarkPlugins={[remarkGfm]}
            components={{ a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer" /> }}
          >
            {task.body}
          </Markdown>
        </article>
      ) : (
        <p className="text-sm text-muted-foreground">Sin cuerpo.</p>
      )}
    </div>
  );
}

export function TaskSheet({
  slug,
  taskKey,
  onOpen,
  onClose,
}: {
  slug: string;
  taskKey: string | null;
  onOpen: (key: string) => void;
  onClose: () => void;
}) {
  const task = useQuery({
    queryKey: ["project", slug, "task", taskKey],
    queryFn: () => api.task(slug, taskKey!),
    enabled: taskKey !== null,
  });
  const notFound = task.error instanceof ApiError && task.error.status === 404;

  return (
    <Sheet open={taskKey !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="gap-0 overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-xl">
        <SheetHeader className="pr-12">
          <SheetDescription className="font-mono">
            {taskKey}
            {task.data && ` · ${task.data.kind === "initiative" ? "Iniciativa" : "Ticket"}`}
          </SheetDescription>
          <SheetTitle className="text-lg leading-snug">
            {task.data?.title ?? (task.isPending ? <Skeleton className="h-6 w-3/4" /> : "Tarea")}
          </SheetTitle>
          {task.data?.summary && <p className="text-sm text-muted-foreground">{task.data.summary}</p>}
        </SheetHeader>
        {task.isPending && taskKey && (
          <div className="grid gap-3 px-4">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-40" />
          </div>
        )}
        {task.isError && (
          <p className="px-4 text-sm text-muted-foreground">
            {notFound ? "Esta tarea ya no existe." : "No se pudo cargar la tarea."}
          </p>
        )}
        {task.data && <Details slug={slug} task={task.data} onOpen={onOpen} />}
      </SheetContent>
    </Sheet>
  );
}
