import { useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router";
import { QuestionMarks } from "@/components/question-marks";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { GATE_ENROLL_STEP, optionLabel } from "@/lib/inbox";
import { localTime } from "@/lib/time";
import { useQuestionAnswer } from "@/lib/use-gate-answer";
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

export function ResumeView({ resume, onOpen }: { resume: Resume; onOpen: (key: string) => void }) {
  const projectWide = resume.standalone.claims.length > 0 || resume.must_keep.length > 0;
  const empty = !resume.initiatives.length && !projectWide;
  return (
    <div className="grid gap-3">
      {resume.initiatives.map((i) => (
        <Card key={i.key}>
          <CardContent className="grid gap-4">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="font-semibold">{i.title}</span>
              <span className="font-mono text-xs text-muted-foreground">{i.key} · {i.status}</span>
            </div>
            {/* 2.11: the derived state first; the note after it, as commentary. */}
            {i.state?.line && <p className="text-sm">{i.state.line}</p>}
            {i.state_note && <p className="-mt-2 text-xs text-muted-foreground italic">{i.state_note}</p>}
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
    </div>
  );
}

function QuestionCard({ slug, q, onOpen }: { slug: string; q: Question; onOpen: (key: string) => void }) {
  const humanOnly = !!q.human_only;
  const needsCode = !!q.gate;
  const flow = useQuestionAnswer(slug, q.id, needsCode);
  const [free, setFree] = useState("");
  const [decision, setDecision] = useState("");
  const pending = flow.send.isPending || flow.begin.isPending;
  const decided = decision.trim() || undefined;
  const needsEnrol = needsCode && flow.enrolled === false;

  function choose(option: string) {
    if (needsCode) flow.begin.mutate(option);
    else flow.send.mutate({ answer: option, decision: decided });
  }
  function submitFree(e: FormEvent) {
    e.preventDefault();
    if (free.trim()) flow.send.mutate({ answer: free.trim(), decision: decided });
  }
  function confirmCode(e: FormEvent) {
    e.preventDefault();
    if (!flow.challenge || !/^\d{6}$/.test(flow.code)) return;
    flow.send.mutate({ answer: flow.challenge.option, decision: decided, nonce: flow.challenge.nonce, code: flow.code });
  }
  return (
    <Card className="ring-orange-500/50">
      <CardContent className="grid gap-3">
        <p className="text-xs text-muted-foreground">
          <button type="button" className="font-mono underline-offset-4 hover:underline" onClick={() => onOpen(q.task_key)}>{q.task_key}</button>
          {" · "}{q.asked_by.agent} · {localTime(q.asked_at)}
        </p>
        <QuestionMarks gate={q.gate} humanOnly={humanOnly} />
        <p className="whitespace-pre-wrap">{q.question}</p>
        {needsEnrol && (
          <p className="text-sm text-muted-foreground">
            {GATE_ENROLL_STEP}{" "}
            <Link to="/inbox#compuertas" className="font-medium text-foreground underline-offset-4 hover:underline">Ir a Compuertas</Link>
          </p>
        )}
        {flow.challenge ? (
          <form onSubmit={confirmCode} className="grid gap-2">
            <p className="text-sm">Opción: {optionLabel(flow.challenge.option)}. Teclea el código de 6 dígitos de tu app.</p>
            <div className="flex gap-2">
              <Input
                value={flow.code}
                onChange={(e) => flow.setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="Código de 6 dígitos"
                aria-label="Código de la app autenticadora"
              />
              <Button type="submit" size="sm" disabled={pending || !/^\d{6}$/.test(flow.code)}>Confirmar</Button>
              <Button type="button" size="sm" variant="ghost" onClick={flow.clear}>Cancelar</Button>
            </div>
          </form>
        ) : (
          !needsEnrol && (
            <>
              {q.options.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {q.options.map((o) => (
                    <Button key={o} size="sm" variant="outline" className="h-auto min-h-7 py-1 text-left whitespace-normal pointer-coarse:h-auto pointer-coarse:min-h-9" disabled={pending || (needsCode && flow.enrolled === undefined)} onClick={() => choose(o)}>{optionLabel(o)}</Button>
                  ))}
                </div>
              )}
              {!needsCode && (
                <form onSubmit={submitFree} className="grid gap-2">
                  <div className="flex gap-2">
                    <Input value={free} onChange={(e) => setFree(e.target.value)} placeholder="Otra respuesta" aria-label="Otra respuesta" />
                    <Button type="submit" size="sm" disabled={!free.trim() || pending}>Responder</Button>
                  </div>
                </form>
              )}
            </>
          )
        )}
        <Input
          value={decision}
          onChange={(e) => setDecision(e.target.value)}
          placeholder="Si esto decide algo, una línea para el registro de decisiones (opcional)"
          aria-label="Decisión"
          className="text-base md:text-xs"
        />
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
            <p className={cn("whitespace-pre-wrap", (d.superseded_by || d.retired) && "text-muted-foreground line-through")}>{d.text}</p>
            <p className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
              {d.pinned && !d.superseded_by && !d.retired && <span className="text-amber-600 dark:text-amber-400">fija</span>}
              {d.retired && <span title={d.retired.reason ?? undefined}>retirada</span>}
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
