import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { QuestionsPanel } from "@/components/resume";
import { Kicker } from "@/components/plan/visuals";
import { api } from "@/lib/api";
import { localTime } from "@/lib/time";
import type { InboxItem, Question } from "@/lib/types";
import { cn } from "@/lib/utils";

// Everything waiting on Jorge, in one place: approvals to grant or reject (several at once, one
// event each) and questions to answer. Empty means nothing needs him.

const ACTION: Record<string, string> = {
  done: "marcar Done",
  wont_do: "marcar Won't do",
  reopen: "reabrir",
  waive_check: "eximir un punto del Done when",
  runbook_step: "ejecutar un paso",
  lease_resource: "tomar un recurso",
};

function waitText(s: number): string {
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min`;
  if (s < 86400) return `${Math.round(s / 3600)} h`;
  return `${Math.round(s / 86400)} d`;
}

function ApprovalRow({ item, checked, onToggle }: { item: InboxItem; checked: boolean; onToggle: () => void }) {
  const target = item.target && Object.keys(item.target).length ? ` ${JSON.stringify(item.target)}` : "";
  return (
    <li className={cn("grid gap-1 px-4 py-3 transition", checked && "bg-accent/40")}>
      <label className="flex cursor-pointer items-start gap-3">
        <input type="checkbox" checked={checked} onChange={onToggle} className="mt-1 size-4 accent-foreground" aria-label={`Seleccionar ${item.key}`} />
        <span className="grid min-w-0 flex-1 gap-1">
          <span className="flex flex-wrap items-baseline gap-x-2 text-sm">
            <Link to={`/p/${item.project}?task=${encodeURIComponent(item.key ?? "")}`} className="font-mono text-xs underline-offset-4 hover:underline">{item.key}</Link>
            <span className="font-medium">{item.title}</span>
            <span className="text-muted-foreground">quiere {ACTION[item.action ?? ""] ?? item.action}{target}</span>
          </span>
          <span className="text-sm whitespace-pre-wrap">{item.why}</span>
          <span className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
            <span>espera {waitText(item.wait_s)}</span>
            {item.evidence?.last_pass && <span>último pass: {item.evidence.last_pass.kind} · {item.evidence.last_pass.cite}</span>}
            {item.evidence && item.evidence.open_checks > 0 && <span>{item.evidence.open_checks} puntos abiertos</span>}
            {item.pr_url && <a href={item.pr_url} target="_blank" rel="noreferrer" className="underline underline-offset-4">PR</a>}
            <span>{localTime(item.waiting_since)}</span>
          </span>
        </span>
      </label>
    </li>
  );
}

// A human action a ticket waits on: one button each.
function ActionRow({ item }: { item: InboxItem }) {
  const queryClient = useQueryClient();
  const act = useMutation({
    mutationFn: () => api.resolveBlocker(item.project, item.id),
    onSuccess: () => toast("Marcado como hecho"),
    onError: () => toast.error("No se pudo guardar."),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["inbox"] });
      void queryClient.invalidateQueries({ queryKey: ["project", item.project] });
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm">
      <Link to={`/p/${item.project}?task=${encodeURIComponent(item.key ?? "")}`} className="font-mono text-xs underline-offset-4 hover:underline">{item.key}</Link>
      <span className="font-medium">{item.title}</span>
      <span className="text-muted-foreground">te toca: {item.why}</span>
      <span className="text-xs text-muted-foreground">espera {waitText(item.wait_s)}</span>
      {item.pr_url && <a href={item.pr_url} target="_blank" rel="noreferrer" className="text-xs underline underline-offset-4">PR</a>}
      <Button size="sm" variant="outline" className="ml-auto" disabled={act.isPending} onClick={() => act.mutate()}>
        Hecho
      </Button>
    </li>
  );
}

export function InboxPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const inbox = useQuery({ queryKey: ["inbox"], queryFn: () => api.inbox() });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");

  const decide = useMutation({
    mutationFn: ({ decision }: { decision: "grant" | "reject" }) => api.decide([...selected], decision, note.trim() || undefined),
    onSuccess: (out, { decision }) => {
      const failed = out.results.filter((r) => !r.ok).length;
      toast(`${out.decided} ${decision === "grant" ? "aprobadas" : "rechazadas"}${failed ? `, ${failed} ya no estaban` : ""}`);
      setSelected(new Set());
      setNote("");
    },
    onError: () => toast.error("No se pudo guardar la decisión."),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["inbox"] });
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });

  const grouped = useMemo(() => {
    const items = inbox.data?.items ?? [];
    const projects = [...new Set(items.map((i) => i.project))];
    return projects.map((project) => ({
      project,
      approvals: items.filter((i) => i.project === project && i.kind === "approval"),
      questions: items.filter((i) => i.project === project && i.kind === "question"),
      actions: items.filter((i) => i.project === project && i.kind === "human_action"),
    }));
  }, [inbox.data]);

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allApprovals = (inbox.data?.items ?? []).filter((i) => i.kind === "approval").map((i) => i.id);

  if (inbox.isPending) return <Skeleton className="h-40 rounded-2xl" />;
  if (inbox.isError) return <p className="text-sm text-destructive">No se pudo cargar la bandeja.</p>;

  const toQuestion = (i: InboxItem): Question => ({
    id: i.id,
    task_key: i.key ?? "",
    question: i.why,
    options: i.options ?? [],
    asked_by: { agent: "", session_id: "" },
    asked_at: i.waiting_since,
    answer: null,
    answered_by: null,
    answered_at: null,
    decision_id: null,
  });

  return (
    <div className="grid gap-8">
      <header className="grid gap-2">
        <Kicker>Te toca a ti</Kicker>
        <h1 className="font-display text-4xl font-extrabold tracking-[-0.03em] sm:text-5xl">Bandeja</h1>
        <p className="text-muted-foreground">
          {inbox.data.count === 0 ? "Nada espera por ti." : `${inbox.data.count} ${inbox.data.count === 1 ? "cosa espera" : "cosas esperan"} tu decisión.`}
        </p>
      </header>

      {allApprovals.length > 0 && (
        <div className="sticky top-[calc(var(--header-h)+0.5rem)] z-10 flex flex-wrap items-center gap-2 rounded-2xl border bg-background/80 p-3 backdrop-blur-md">
          <Button variant="outline" size="sm" onClick={() => setSelected(new Set(selected.size === allApprovals.length ? [] : allApprovals))}>
            {selected.size === allApprovals.length ? "Ninguna" : "Todas"}
          </Button>
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Nota (opcional)" className="min-w-0 flex-1 basis-40 sm:max-w-xs" aria-label="Nota" />
          <div className="ml-auto flex gap-2">
            <Button size="sm" variant="destructive" disabled={!selected.size || decide.isPending} onClick={() => decide.mutate({ decision: "reject" })}>
              Rechazar ({selected.size})
            </Button>
            <Button size="sm" disabled={!selected.size || decide.isPending} onClick={() => decide.mutate({ decision: "grant" })}>
              Aprobar ({selected.size})
            </Button>
          </div>
        </div>
      )}

      {grouped.map(({ project, approvals, questions, actions }) => (
        <section key={project} className="grid gap-3">
          <h2 className="font-display text-[15px] font-bold tracking-[0.08em] text-muted-foreground uppercase">
            <Link to={`/p/${project}`} className="underline-offset-4 hover:underline">{project}</Link>
          </h2>
          {approvals.length > 0 && (
            <Card className="gap-0 divide-y py-0">
              <CardContent className="px-0">
                <ul className="divide-y">
                  {approvals.map((item) => <ApprovalRow key={item.id} item={item} checked={selected.has(item.id)} onToggle={() => toggle(item.id)} />)}
                </ul>
              </CardContent>
            </Card>
          )}
          {actions.length > 0 && (
            <Card className="gap-0 divide-y py-0">
              <CardContent className="px-0">
                <ul className="divide-y">{actions.map((item) => <ActionRow key={item.id} item={item} />)}</ul>
              </CardContent>
            </Card>
          )}
          {questions.length > 0 && (
            <QuestionsPanel slug={project} questions={questions.map(toQuestion)} onOpen={(key) => navigate(`/p/${project}?task=${encodeURIComponent(key)}`)} />
          )}
        </section>
      ))}
    </div>
  );
}
