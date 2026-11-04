import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { HechoForm } from "@/components/hecho";
import { ReleaseRow } from "@/components/release-step";
import { DelegadaBadge } from "@/components/delegada-badge";
import { DelegationSwitch } from "@/components/delegation-switch";
import { QuestionsPanel } from "@/components/resume";
import { Kicker } from "@/components/plan/visuals";
import { api } from "@/lib/api";
import { actionWord, waitText } from "@/lib/inbox";
import { localTime } from "@/lib/time";
import type { DelegatedReview, InboxGroup, InboxItem, Question } from "@/lib/types";
import { cn } from "@/lib/utils";

// Everything waiting on Jorge, in three tabs (2.10): Decisiones (questions to answer), Pasos
// (what only he can do: human actions and releases, each with Hecho) and Limpieza (what agents
// left on the Mac). Logged moves sit in the delegated list, not in a group.

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
function DelegatedRow({ item, onSeen, busy }: { item: DelegatedReview; onSeen: () => void; busy: boolean }) {
  const what = item.action ? actionWord(item.action) : "Pregunta";
  const choice = item.answer;
  return (
    <li className="grid gap-1.5 px-4 py-3 text-sm">
      <span className="flex flex-wrap items-center gap-x-2">
        {item.key && (
          <Link to={`/p/${item.project}?task=${encodeURIComponent(item.key)}`} className="font-mono text-xs underline-offset-4 hover:underline">
            {item.key}
          </Link>
        )}
        <span className="text-muted-foreground">{what}{choice ? ` · ${choice}` : ""}</span>
        <Button variant="ghost" size="sm" className="ml-auto h-7" disabled={busy} onClick={onSeen} aria-label={`Marcar como vista ${item.key ?? ""}`.trim()}>
          Visto
        </Button>
      </span>
      <DelegadaBadge quote={item.quote} at={item.at} />
    </li>
  );
}

function LeaseRow({ item }: { item: InboxItem }) {
  return (
    <li className="grid gap-1 px-4 py-3 text-sm">
      <span className="flex flex-wrap items-baseline gap-x-2">
        {item.key && (
          <Link to={`/p/${item.project}?task=${encodeURIComponent(item.key)}`} className="font-mono text-xs underline-offset-4 hover:underline">
            {item.key}
          </Link>
        )}
        <span className="font-medium">{item.title}</span>
        <span className="text-muted-foreground">{item.why}</span>
        <span className="text-xs text-muted-foreground">desde hace {waitText(item.wait_s)}</span>
      </span>
      <span className="text-xs text-muted-foreground">{item.action_hint}</span>
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

  // PLA-06: a seen delegated answer or move leaves this list; the record stays on the server.
  const seen = useMutation({
    mutationFn: (ids: string[]) => api.reviewDelegated(ids),
    onSuccess: (out) => toast(out.reviewed === 1 ? "1 marcada como vista" : `${out.reviewed} marcadas como vistas`),
    onError: () => toast.error("No se pudo marcar."),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ["inbox"] }),
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
      questions: items.filter((i) => i.project === project && i.kind === "question"),
      releases: items.filter((i) => i.project === project && i.kind === "release"),
      actions: items.filter((i) => i.project === project && i.kind === "human_action"),
      footprints: items.filter((i) => i.project === project && i.kind === "footprint"),
      leases: items.filter((i) => i.project === project && (i.kind === "lease" || i.kind === "assign")),
    }));
  }, [inbox.data, tab]);

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
      {inbox.data.delegated.length > 0 && (
        <section className="grid gap-3" aria-label="Respuestas delegadas">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-medium text-orange-600 dark:text-orange-400">
              Respuestas delegadas <span className="tabular-nums text-muted-foreground">({inbox.data.delegated.length})</span>
            </h2>
            <Button variant="outline" size="sm" disabled={seen.isPending} onClick={() => seen.mutate(inbox.data.delegated.map((d) => d.id))}>
              Marcar todas como vistas
            </Button>
          </div>
          <Card className="gap-0 py-0">
            <CardContent className="px-0">
              <ul className="divide-y">
                {inbox.data.delegated.map((item) => <DelegatedRow key={item.id} item={item} busy={seen.isPending} onSeen={() => seen.mutate([item.id])} />)}
              </ul>
            </CardContent>
          </Card>
        </section>
      )}

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="grid gap-8">
      {grouped.length === 0 && <p className="text-sm text-muted-foreground">{TABS.find((t) => t.id === tab)!.empty}</p>}
      {grouped.map(({ project, questions, releases, actions, footprints, leases }) => (
        <section key={project} id={project} className="scroll-mt-20 grid gap-3">
          <h2 className="font-display text-[15px] font-bold tracking-[0.08em] text-muted-foreground uppercase">
            <Link to={project === "machine" ? "/machine" : `/p/${project}`} className="underline-offset-4 hover:underline">{project === "machine" ? "Máquina" : project}</Link>
          </h2>
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
          {leases.length > 0 && (
            <Card className="gap-0 divide-y py-0">
              <CardContent className="px-0">
                <ul className="divide-y">{leases.map((item) => <LeaseRow key={item.id} item={item} />)}</ul>
              </CardContent>
            </Card>
          )}
          {questions.length > 0 && (
            <QuestionsPanel slug={project} questions={questions.map(toQuestion)} onOpen={(key) => navigate(`/p/${project}?task=${encodeURIComponent(key)}`)} />
          )}
        </section>
      ))}
      </div>
    </div>
  );
}
