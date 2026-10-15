import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLinkIcon } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { HechoForm } from "@/components/hecho";
import { TaskControls } from "@/components/task-controls";
import { ClaimLine } from "@/components/task-row";
import { localTime } from "@/lib/time";
import { api, ApiError } from "@/lib/api";
import type { Check, TaskDetail } from "@/lib/types";
import { cn } from "@/lib/utils";

// One Done when item: done, waived (with why), or open with a way for Jorge to waive it.
function CheckLine({ slug, taskKey, check }: { slug: string; taskKey: string; check: Check }) {
  const queryClient = useQueryClient();
  const [waiving, setWaiving] = useState(false);
  const [reason, setReason] = useState("");
  const waive = useMutation({
    mutationFn: () => api.waiveCheck(slug, taskKey, check.n, reason.trim()),
    onSuccess: () => {
      toast(`Punto ${check.n} eximido`);
      setWaiving(false);
      setReason("");
    },
    onError: () => toast.error("No se pudo eximir el punto."),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["project", slug, "task", taskKey] });
      void queryClient.invalidateQueries({ queryKey: ["project", slug] });
    },
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    if (reason.trim()) waive.mutate();
  }
  const closed = check.done || !!check.waived;
  return (
    <li className="grid gap-1">
      <div className="flex gap-2">
        <span aria-label={check.done ? "hecho" : check.waived ? "eximido" : "pendiente"}>{check.done ? "☑" : check.waived ? "⊘" : "☐"}</span>
        <span className={cn("min-w-0 flex-1", closed && "text-muted-foreground", check.waived && "line-through")}>{check.text}</span>
        {!closed && !waiving && (
          <button type="button" onClick={() => setWaiving(true)} className="text-xs text-muted-foreground underline-offset-4 hover:underline">eximir</button>
        )}
      </div>
      {check.waived && <span className="pl-6 text-xs text-muted-foreground">eximido: {check.waived.reason}</span>}
      {waiving && (
        <form onSubmit={submit} className="flex gap-2 pl-6">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Por qué no hace falta" aria-label="Razón" autoFocus />
          <Button type="submit" size="sm" disabled={!reason.trim() || waive.isPending}>Eximir</Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setWaiving(false)}>Cancelar</Button>
        </form>
      )}
    </li>
  );
}

// Side panel with one task: its scope, Done when checks, evidence, questions and history. The open task lives in the URL (?task=KEY),
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
      <dd className="min-w-0 text-sm [overflow-wrap:anywhere]">{children}</dd>
    </>
  );
}

const MARKDOWN = cn(
  // min-w-0 lets the grid item shrink; long inline code wraps instead of widening the panel.
  "min-w-0 break-words [&_code]:break-words prose-pre:overflow-x-auto",
  "prose prose-sm max-w-none dark:prose-invert prose-headings:font-semibold",
  "prose-pre:bg-muted prose-pre:text-foreground",
  // Inline code: a soft chip instead of the plugin's literal backticks.
  "prose-code:rounded prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:font-normal",
  "prose-code:before:content-none prose-code:after:content-none",
  // GFM checklists: the checkbox replaces the bullet.
  "[&_li:has(>input)]:list-none [&_ul:has(>li>input)]:pl-0 [&_li>input]:mr-2",
);

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-2">
      <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</h3>
      {children}
    </section>
  );
}

const VERDICT: Record<string, string> = { pass: "✓", warn: "⚠", fail: "✗" };

// A log line in words: notes show their text, status moves show from → to, the rest their type.
function logText(e: TaskDetail["log"][number]): string {
  const p = e.payload as Record<string, unknown>;
  if (e.type === "note") return String(p.text ?? "");
  if (e.type === "task.status") return `${p.from} → ${p.to}${p.note ? `: ${p.note}` : ""}`;
  if (e.type === "result.added") return `${VERDICT[String(p.verdict)] ?? ""} ${p.kind}: ${p.cite}`;
  if (e.type === "check.set") return `${p.done ? "☑" : "☐"} ${p.text}`;
  if (e.type === "question.asked") return `Pregunta: ${p.question}`;
  if (e.type === "question.answered") return `Respuesta: ${p.answer}`;
  if (e.type === "blocker.parsed") return `Te toca: ${p.text}`;
  if (e.type === "blocker.resolved") return `Hecho: ${p.text}`;
  return e.type;
}

function Details({ slug, task, onOpen }: { slug: string; task: TaskDetail; onOpen: (key: string) => void }) {
  const scope = task.scope;
  return (
    <div className="grid grid-cols-1 gap-6 px-4 pb-8">
      <div className="flex flex-wrap items-center gap-2">
        <TaskControls slug={slug} task={task} />
      </div>

      {task.status === "Blocked" && task.blocked_note && (
        <p className="rounded-lg border border-status-blocked/30 bg-status-blocked/5 px-3 py-2 text-sm text-ink-blocked">
          {task.blocked_note}
        </p>
      )}
      {task.claim?.live && (
        <ClaimLine
          slug={slug}
          task={{ key: task.key, title: task.title, claimed_by: task.claim.owner, lease_until: task.claim.lease_until }}
        />
      )}

      <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-2 sm:gap-x-6">
        {task.parent_key && <Field label="Iniciativa"><TaskLink slug={slug} taskKey={task.parent_key} onOpen={onOpen} /></Field>}
        {task.phase !== null && <Field label="Fase">{task.phase}</Field>}
        {task.work_type && <Field label="Tipo">{task.work_type}</Field>}
        {task.child_keys.length > 0 && (
          <Field label="Fases">
            <span className="flex flex-col items-start gap-1">
              {task.child_keys.map((k) => <TaskLink key={k} slug={slug} taskKey={k} onOpen={onOpen} />)}
            </span>
          </Field>
        )}
        {task.blocked_by.length > 0 && (
          <Field label="Bloqueado por">
            <span className="flex flex-col items-start gap-1">
              {task.blocked_by.map((b, i) => (
                <span key={i} className={cn("inline-flex items-center gap-2", b.satisfied && "text-muted-foreground")}>
                  {b.satisfied ? "✓" : "○"}
                  {b.type === "task" ? (
                    <TaskLink slug={slug} taskKey={b.task} onOpen={onOpen} />
                  ) : b.type === "env" ? (
                    <span className="font-mono text-xs">{b.env} {b.condition} {b.value}</span>
                  ) : b.type === "human_action" ? (
                    <span>{b.assignee}: {b.text}</span>
                  ) : b.type === "env_flag" ? (
                    <span className="font-mono text-xs">{b.env} {b.flag} = {String(b.equals)}{b.current !== null && b.current !== undefined ? ` (ahora ${String(b.current)})` : ""}</span>
                  ) : b.type === "time_after" ? (
                    <span className="text-xs">desde {localTime(b.at)}</span>
                  ) : (
                    <span className="font-mono text-xs">{b.name} ≥ {b.value}{b.current !== null ? ` (ahora ${b.current})` : ""}</span>
                  )}
                </span>
              ))}
            </span>
          </Field>
        )}
        {task.origin && <Field label="Origen">{task.origin}</Field>}
        {task.next_action && <Field label="Siguiente">{task.next_action}</Field>}
        {task.in_progress_note && <Field label="En curso">{task.in_progress_note}</Field>}
        {task.base_branch && <Field label="Rama base"><span className="font-mono">{task.base_branch}</span></Field>}
        {task.branch && <Field label="Rama"><span className="font-mono">{task.branch}</span></Field>}
        {task.workspace?.worktree_path && (
          <Field label="Worktree">
            <span className="font-mono">{task.workspace.machine ? `${task.workspace.machine}:` : ""}{task.workspace.worktree_path}</span>
          </Field>
        )}
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

      {scope.trim() ? (
        <article className={MARKDOWN}>
          <Markdown
            remarkPlugins={[remarkGfm]}
            components={{ a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer" /> }}
          >
            {scope}
          </Markdown>
        </article>
      ) : (
        <p className="text-sm text-muted-foreground">Sin alcance.</p>
      )}

      {task.blocked_by.some((b) => b.type === "human_action" && !b.satisfied) && (
        <Section title="Te toca">
          <ul className="grid gap-2 text-sm">
            {task.blocked_by.map((b) =>
              b.type === "human_action" && !b.satisfied ? (
                <li key={b.id} className="grid gap-1.5 rounded-xl bg-surface-sunken px-3 py-2">
                  <span>{b.text}</span>
                  <HechoForm slug={slug} id={b.id} taskKey={task.key} />
                </li>
              ) : null,
            )}
          </ul>
        </Section>
      )}

      {task.checks.length > 0 && (
        <Section title="Done when">
          <ul className="grid gap-1 text-sm">
            {task.checks.map((c) => <CheckLine key={c.n} slug={slug} taskKey={task.key} check={c} />)}
          </ul>
        </Section>
      )}

      {task.results.length > 0 && (
        <Section title="Evidencia">
          <ul className="grid gap-2 text-sm">
            {task.results.map((r) => (
              <li key={r.id} className="grid gap-0.5">
                <span>
                  {VERDICT[r.verdict] ?? r.verdict} <span className="font-mono text-xs">{r.kind}</span> {r.cite}
                  {r.url && <a href={r.url} target="_blank" rel="noreferrer" className="ml-1 underline underline-offset-4">enlace</a>}
                </span>
                <span className="text-xs text-muted-foreground">{r.actor.agent} · {localTime(r.at)}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {task.docs.length > 0 && (
        <Section title="Documentos">
          <ul className="grid gap-1 text-sm">
            {task.docs.map((d) => <li key={d.id}>{d.title} <span className="text-xs text-muted-foreground">v{d.version}</span></li>)}
          </ul>
        </Section>
      )}

      {task.questions.length > 0 && (
        <Section title="Preguntas">
          <ul className="grid gap-2 text-sm">
            {task.questions.map((q) => (
              <li key={q.id}>
                {q.question}
                <span className="block text-muted-foreground">{q.answer ? `→ ${q.answer}` : "Sin respuesta"}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {task.log.length > 0 && (
        <Section title={`Historial (${task.log_total})`}>
          <ol className="grid gap-2 text-sm">
            {/* Newest first by time: notes moved from v1 bodies carry their old dates but newer ids. */}
            {[...task.log].sort((a, b) => b.at.localeCompare(a.at) || b.id - a.id).map((e) => (
              <li key={e.id} className="grid gap-0.5">
                <span className="whitespace-pre-wrap">{logText(e)}</span>
                <span className="text-xs text-muted-foreground">{e.actor.agent} · {localTime(e.at)}</span>
              </li>
            ))}
          </ol>
        </Section>
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
