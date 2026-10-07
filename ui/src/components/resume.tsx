import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { localTime } from "@/lib/time";
import type { Claim, Decision, NextTicket, Question, Resume } from "@/lib/types";
import { cn } from "@/lib/utils";

// The generated resume, the questions agents asked Jorge, and the decision log.

function Row({ label, items }: { label: string; items: ReactNode[] }) {
  const shown = items.filter(Boolean);
  return (
    <div className="grid gap-1">
      <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</span>
      {shown.length ? (
        <div className="grid gap-1">{shown.map((x, i) => <div key={i} className="whitespace-pre-wrap">{x}</div>)}</div>
      ) : (
        <span className="text-muted-foreground">—</span>
      )}
    </div>
  );
}

function ClaimItem({ claim, onOpen }: { claim: Claim; onOpen: (key: string) => void }) {
  return (
    <span>
      <button type="button" className="text-left underline-offset-4 hover:underline" onClick={() => onOpen(claim.key)}>{claim.title}</button>
      <span className="text-muted-foreground"> · {claim.owner?.agent}</span>
      {claim.workspace?.branch && <span className="font-mono text-xs text-muted-foreground"> · {claim.workspace.branch}</span>}
    </span>
  );
}

function NextItem({ next, onOpen }: { next: NonNullable<NextTicket>; onOpen: (key: string) => void }) {
  return (
    <button type="button" className="text-left underline-offset-4 hover:underline" onClick={() => onOpen(next.key)}>
      {next.title}
    </button>
  );
}

const LEGACY: [keyof NonNullable<Resume["legacy_card"]>, string][] = [
  ["in_progress", "En curso"],
  ["next_action", "Siguiente"],
  ["branch_or_prod", "Rama / prod"],
  ["must_keep_decision", "Decisión fija"],
];

export function ResumeView({ resume, onOpen }: { resume: Resume; onOpen: (key: string) => void }) {
  const projectWide = resume.standalone.claims.length > 0 || resume.must_keep.length > 0;
  const empty = !resume.initiatives.length && !projectWide && !resume.legacy_card;
  return (
    <div className="grid gap-3">
      {resume.initiatives.map((i) => (
        <Card key={i.key}>
          <CardContent className="grid gap-4">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="font-semibold">{i.title}</span>
              <span className="font-mono text-xs text-muted-foreground">{i.key} · {i.status}</span>
            </div>
            <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
              <Row label="En curso" items={[i.in_progress.note, ...i.in_progress.claims.map((c) => <ClaimItem key={c.key} claim={c} onOpen={onOpen} />)]} />
              <Row
                label="Siguiente"
                items={[i.next_action.note, i.next_action.next_claimable && <NextItem key="next" next={i.next_action.next_claimable} onOpen={onOpen} />]}
              />
              {i.must_keep.length > 0 && <Row label="Fijo" items={i.must_keep.map((d) => d.text)} />}
            </div>
          </CardContent>
        </Card>
      ))}
      {projectWide && (
        <Card>
          <CardContent className="grid gap-4">
            <span className="font-semibold">Todo el proyecto</span>
            <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
              {resume.standalone.claims.length > 0 && (
                <Row label="En curso" items={resume.standalone.claims.map((c) => <ClaimItem key={c.key} claim={c} onOpen={onOpen} />)} />
              )}
              {resume.must_keep.length > 0 && <Row label="Fijo" items={resume.must_keep.map((d) => d.text)} />}
            </div>
          </CardContent>
        </Card>
      )}
      {empty && <p className="text-sm text-muted-foreground">Sin ficha.</p>}
      {resume.legacy_card && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">Ficha anterior (v1, solo lectura)</summary>
          <div className="mt-3 grid gap-x-8 gap-y-4 sm:grid-cols-2">
            {LEGACY.map(([field, label]) => <Row key={field} label={label} items={[resume.legacy_card![field]]} />)}
          </div>
        </details>
      )}
    </div>
  );
}

function QuestionCard({ slug, q, onOpen }: { slug: string; q: Question; onOpen: (key: string) => void }) {
  const queryClient = useQueryClient();
  const [free, setFree] = useState("");
  const send = useMutation({
    mutationFn: (answer: string) => api.answer(slug, q.id, answer),
    onSuccess: () => toast("Respuesta guardada como decisión"),
    onError: () => toast.error("No se pudo guardar la respuesta."),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["project", slug] });
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    if (free.trim()) send.mutate(free.trim());
  }
  return (
    <Card className="ring-orange-500/50">
      <CardContent className="grid gap-3">
        <p className="text-xs text-muted-foreground">
          <button type="button" className="font-mono underline-offset-4 hover:underline" onClick={() => onOpen(q.task_key)}>{q.task_key}</button>
          {" · "}{q.asked_by.agent} · {localTime(q.asked_at)}
        </p>
        <p className="whitespace-pre-wrap">{q.question}</p>
        {q.options.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {q.options.map((o) => (
              <Button key={o} size="sm" variant="outline" disabled={send.isPending} onClick={() => send.mutate(o)}>{o}</Button>
            ))}
          </div>
        )}
        <form onSubmit={submit} className="flex gap-2">
          <Input value={free} onChange={(e) => setFree(e.target.value)} placeholder="Otra respuesta" aria-label="Otra respuesta" />
          <Button type="submit" size="sm" disabled={!free.trim() || send.isPending}>Responder</Button>
        </form>
      </CardContent>
    </Card>
  );
}

export function QuestionsPanel({ slug, questions, onOpen }: { slug: string; questions: Question[]; onOpen: (key: string) => void }) {
  if (!questions.length) return null;
  return (
    <section className="grid gap-3">
      <h2 className="text-sm font-medium text-orange-600 dark:text-orange-400">Preguntas para ti</h2>
      {questions.map((q) => <QuestionCard key={q.id} slug={slug} q={q} onOpen={onOpen} />)}
    </section>
  );
}

// Newest first; a decision that a later one reversed is struck through.
export function DecisionList({ decisions, onOpen }: { decisions: Decision[]; onOpen: (key: string) => void }) {
  if (!decisions.length) return null;
  return (
    <section className="grid gap-3">
      <h2 className="text-sm font-medium text-muted-foreground">Decisiones</h2>
      <Card className="gap-0 divide-y py-0">
        {decisions.map((d) => (
          <div key={d.id} className="grid gap-1 px-4 py-3">
            <p className={cn("whitespace-pre-wrap", d.superseded_by && "text-muted-foreground line-through")}>{d.text}</p>
            <p className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
              {d.pinned && !d.superseded_by && <span className="text-amber-600 dark:text-amber-400">fija</span>}
              {d.task_key && (
                <button type="button" className="font-mono underline-offset-4 hover:underline" onClick={() => onOpen(d.task_key!)}>{d.task_key}</button>
              )}
              {d.tags.map((t) => <span key={t}>#{t}</span>)}
              <span>{localTime(d.created_at)}</span>
            </p>
          </div>
        ))}
      </Card>
    </section>
  );
}
