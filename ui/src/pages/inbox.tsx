import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { HechoForm } from "@/components/hecho";
import { ReleaseRow } from "@/components/release-step";
import { DelegadaBadge } from "@/components/delegada-badge";
import { DelegationSwitch } from "@/components/delegation-switch";
import { GatePanel } from "@/components/gate-panel";
import { QuestionsPanel } from "@/components/resume";
import { Kicker } from "@/components/plan/visuals";
import { api } from "@/lib/api";
import { actionWord, optionLabel, waitText } from "@/lib/inbox";
import { localTime } from "@/lib/time";
import type { DelegatedReview, InboxGroup, InboxItem, Question } from "@/lib/types";
import { cn } from "@/lib/utils";

// Everything waiting on Jorge, in three tabs (2.10): Decisiones (approvals to grant or reject,
// several at once, one event each, and questions to answer), Pasos (what only he can do: human
// actions and releases, each with Hecho) and Limpieza (what agents left on the Mac).

const TABS: { id: InboxGroup; label: string; empty: string }[] = [
  { id: "decisiones", label: "Decisiones", empty: "Nada que decidir." },
  { id: "pasos", label: "Pasos", empty: "Ningún paso tuyo pendiente." },
  { id: "limpieza", label: "Limpieza", empty: "La Mac está limpia." },
];

function Tabs({ tab, counts, onChange }: { tab: InboxGroup; counts: Record<InboxGroup, number>; onChange: (t: InboxGroup) => void }) {
  return (
    <div role="tablist" aria-label="Bandeja" className="flex w-fit max-w-full gap-1 overflow-x-auto rounded-full border bg-background/60 p-1">
      {TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          id={`tab-${t.id}`}
          aria-selected={tab === t.id}
          aria-controls={`panel-${t.id}`}
          onClick={() => onChange(t.id)}
          className={cn(
            "inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-medium transition focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
            tab === t.id ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {t.label}
          <span className={cn("rounded-full px-1.5 text-[11px] font-semibold tabular-nums", tab === t.id ? "bg-background/20" : t.id === "limpieza" ? "bg-muted" : counts[t.id] ? "bg-orange-500 text-white" : "bg-muted")}>{counts[t.id]}</span>
        </button>
      ))}
    </div>
  );
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
            <span className="text-muted-foreground">quiere {actionWord(item.action)}{target}</span>
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

// A human action a ticket waits on: the verb, the ticket, and Hecho with an optional note.
function ActionRow({ item }: { item: InboxItem }) {
  const parsed = item.target?.source === "parsed";
  return (
    <li className="grid gap-2 px-4 py-3 text-sm sm:flex sm:flex-wrap sm:items-center sm:gap-x-3">
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="font-medium">{item.why}</span>
        <span className="flex flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground">
          <Link to={`/p/${item.project}?task=${encodeURIComponent(item.key ?? "")}`} className="font-mono underline-offset-4 hover:underline">{item.key}</Link>
          <span>{item.title}</span>
          <span>espera {waitText(item.wait_s)}</span>
          {parsed && <span title="Leído de una línea «Jorge:» del ticket">del texto</span>}
          {item.pr_url && <a href={item.pr_url} target="_blank" rel="noreferrer" className="underline underline-offset-4">PR</a>}
        </span>
      </span>
      <HechoForm slug={item.project} id={item.id} taskKey={item.key} className="sm:ml-auto" />
    </li>
  );
}

// Something left on the Mac that nobody claims, or whose ticket is long done: the command is for Jorge to run.
function DelegatedRow({ item }: { item: DelegatedReview }) {
  const what = item.gate ? `Compuerta ${item.gate}` : item.action ? actionWord(item.action) : "Pregunta";
  const choice = item.answer ? optionLabel(item.answer) : null;
  return (
    <li className="grid gap-1.5 px-4 py-3 text-sm">
      <span className="flex flex-wrap items-baseline gap-x-2">
        {item.key && (
          <Link to={`/p/${item.project}?task=${encodeURIComponent(item.key)}`} className="font-mono text-xs underline-offset-4 hover:underline">
            {item.key}
          </Link>
        )}
        <span className="text-muted-foreground">{what}{choice ? ` · ${choice}` : ""}</span>
      </span>
      <DelegadaBadge quote={item.quote} at={item.at} />
    </li>
  );
}

function FootprintRow({ item }: { item: InboxItem }) {
  const teardown = typeof item.target?.teardown === "string" ? item.target.teardown : "";
  return (
    <li className="grid gap-1 px-4 py-3 text-sm">
      <span className="flex flex-wrap items-baseline gap-x-2">
        {item.key && item.project !== "machine" && (
          <Link to={`/p/${item.project}?task=${encodeURIComponent(item.key)}`} className="font-mono text-xs underline-offset-4 hover:underline">{item.key}</Link>
        )}
        <Link to="/machine" className="font-mono text-xs font-medium break-all underline-offset-4 hover:underline">{item.title}</Link>
        <span className="text-muted-foreground">{item.why}</span>
        <span className="text-xs text-muted-foreground">desde hace {waitText(item.wait_s)}</span>
      </span>
      {teardown ? <code className="rounded-lg bg-surface-sunken px-2.5 py-1 font-mono text-xs leading-5 break-all whitespace-pre-wrap">{teardown}</code> : <span className="text-xs text-muted-foreground">{item.action_hint}</span>}
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

  const [params, setParams] = useSearchParams();
  const counts = useMemo(() => {
    const out: Record<InboxGroup, number> = { decisiones: 0, pasos: 0, limpieza: 0 };
    for (const i of inbox.data?.items ?? []) out[i.group] += 1;
    return out;
  }, [inbox.data]);
  // ?tab= wins; otherwise the first tab with something in it.
  const asked = params.get("tab") as InboxGroup | null;
  const tab: InboxGroup = asked && TABS.some((t) => t.id === asked) ? asked : (TABS.find((t) => counts[t.id] > 0)?.id ?? "decisiones");
  const setTab = (t: InboxGroup) => setParams((p) => {
    const next = new URLSearchParams(p);
    next.set("tab", t);
    return next;
  }, { replace: true });

  const grouped = useMemo(() => {
    const items = (inbox.data?.items ?? []).filter((i) => i.group === tab);
    const projects = [...new Set(items.map((i) => i.project))];
    return projects.map((project) => ({
      project,
      approvals: items.filter((i) => i.project === project && i.kind === "approval"),
      questions: items.filter((i) => i.project === project && i.kind === "question"),
      releases: items.filter((i) => i.project === project && i.kind === "release"),
      actions: items.filter((i) => i.project === project && i.kind === "human_action"),
      footprints: items.filter((i) => i.project === project && i.kind === "footprint"),
    }));
  }, [inbox.data, tab]);

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
    gate: i.gate,
    human_only: i.human_only,
  });

  return (
    <div className="grid gap-8">
      <header className="grid gap-2">
        <Kicker>Te toca a ti</Kicker>
        <h1 className="font-display text-4xl font-extrabold tracking-[-0.03em] sm:text-5xl">Bandeja</h1>
        <p className="text-muted-foreground">
          {inbox.data.count === 0 ? "Nada espera por ti." : `${inbox.data.count} ${inbox.data.count === 1 ? "cosa espera" : "cosas esperan"} por ti.`}
        </p>
        <Tabs tab={tab} counts={counts} onChange={setTab} />
      </header>
      <DelegationSwitch />
      <GatePanel
        items={(inbox.data?.items ?? [])
          .filter((i) => i.kind === "question" && i.gate)
          .map((i) => ({ project: i.project, question: toQuestion(i) }))}
        onOpen={(project, key) => navigate(`/p/${project}?task=${encodeURIComponent(key)}`)}
      />
      {inbox.data.delegated.length > 0 && (
        <section className="grid gap-3" aria-label="Respuestas delegadas">
          <h2 className="text-sm font-medium text-orange-600 dark:text-orange-400">Respuestas delegadas</h2>
          <Card className="gap-0 py-0">
            <CardContent className="px-0">
              <ul className="divide-y">
                {inbox.data.delegated.map((item) => <DelegatedRow key={item.id} item={item} />)}
              </ul>
            </CardContent>
          </Card>
        </section>
      )}

      {tab === "decisiones" && allApprovals.length > 0 && (
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

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="grid gap-8">
      {grouped.length === 0 && <p className="text-sm text-muted-foreground">{TABS.find((t) => t.id === tab)!.empty}</p>}
      {grouped.map(({ project, approvals, questions, releases, actions, footprints }) => (
        <section key={project} id={project} className="scroll-mt-20 grid gap-3">
          <h2 className="font-display text-[15px] font-bold tracking-[0.08em] text-muted-foreground uppercase">
            <Link to={project === "machine" ? "/machine" : `/p/${project}`} className="underline-offset-4 hover:underline">{project === "machine" ? "Máquina" : project}</Link>
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
          {releases.length > 0 && <ul className="grid gap-3">{releases.map((item) => <ReleaseRow key={item.id} item={item} />)}</ul>}
          {actions.length > 0 && (
            <Card className="gap-0 divide-y py-0">
              <CardContent className="px-0">
                <ul className="divide-y">{actions.map((item) => <ActionRow key={item.id} item={item} />)}</ul>
              </CardContent>
            </Card>
          )}
          {footprints.length > 0 && (
            <Card className="gap-0 divide-y py-0">
              <CardContent className="px-0">
                <ul className="divide-y">{footprints.map((item) => <FootprintRow key={item.id} item={item} />)}</ul>
              </CardContent>
            </Card>
          )}
          {questions.some((i) => !i.gate) && (
            <QuestionsPanel slug={project} questions={questions.filter((i) => !i.gate).map(toQuestion)} onOpen={(key) => navigate(`/p/${project}?task=${encodeURIComponent(key)}`)} />
          )}
        </section>
      ))}
      </div>
    </div>
  );
}
