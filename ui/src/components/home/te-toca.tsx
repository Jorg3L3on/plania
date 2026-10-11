// "Te toca": what waits on Jorge, decided from Inicio's city. One question at a time with its
// options, each approval with Aprobar / Rechazar, and the rest (your own actions) counted with a
// way into the Bandeja. Every write is the same call the Bandeja makes.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRightIcon } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { accentInk, projectAccent } from "@/components/plan/visuals";
import { api } from "@/lib/api";
import { actionWord, waitText } from "@/lib/inbox";
import type { InboxItem } from "@/lib/types";
import { cn } from "@/lib/utils";

type Names = (slug: string) => string;

function useRefresh() {
  const queryClient = useQueryClient();
  return (slug: string) => {
    void queryClient.invalidateQueries({ queryKey: ["inbox"] });
    void queryClient.invalidateQueries({ queryKey: ["projects"] });
    void queryClient.invalidateQueries({ queryKey: ["project", slug] });
  };
}

function ProjectWord({ slug, names }: { slug: string; names: Names }) {
  const [a] = projectAccent(slug);
  return <span className="font-semibold" style={{ color: accentInk(a) }}>{names(slug)}</span>;
}

const taskHref = (item: InboxItem) => `/p/${item.project}?task=${encodeURIComponent(item.key ?? "")}`;

// One question with its options; the optional decision line goes to the decision log, as in the Bandeja.
function QuestionCard({ item, index, total, names, onNext }: { item: InboxItem; index: number; total: number; names: Names; onNext: () => void }) {
  const refresh = useRefresh();
  const [free, setFree] = useState("");
  const [decision, setDecision] = useState("");
  const send = useMutation({
    mutationFn: (answer: string) => api.answer(item.project, item.id, answer, decision.trim() || undefined),
    onSuccess: () => {
      toast(decision.trim() ? "Respuesta guardada como decisión" : "Respuesta guardada");
      setFree("");
      setDecision("");
    },
    onError: () => toast.error("No se pudo guardar la respuesta."),
    onSettled: () => refresh(item.project),
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    if (free.trim()) send.mutate(free.trim());
  }
  return (
    <article className="grid gap-2.5 rounded-[16px] border border-status-jorge/25 bg-status-jorge/[0.07] px-4 py-3.5">
      <p className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>
          <ProjectWord slug={item.project} names={names} /> ·{" "}
          <Link to={taskHref(item)} className="font-mono underline-offset-4 hover:underline">{item.key}</Link>
          {" · "}
          {total === 1 ? "una pregunta" : `pregunta ${index + 1} de ${total}`}
        </span>
        <span>espera {waitText(item.wait_s)}</span>
      </p>
      <p className="text-[15px] leading-snug whitespace-pre-wrap">{item.why}</p>
      {(item.options?.length ?? 0) > 0 && (
        <div className="grid gap-1.5">
          {item.options!.map((o, i) => (
            <button
              key={o}
              type="button"
              disabled={send.isPending}
              onClick={() => send.mutate(o)}
              className={cn(
                "flex min-h-11 items-center justify-between gap-3 rounded-xl border px-3 py-2 text-left text-[13px] leading-snug transition hover:bg-foreground/[0.06] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50",
                i === 0 ? "border-foreground/15 bg-foreground/[0.05]" : "border-foreground/10",
              )}
            >
              <span>{o}</span>
              {/propuesta/i.test(o) && <span className="shrink-0 text-[11px] font-semibold text-ink-jorge">propuesta</span>}
            </button>
          ))}
        </div>
      )}
      <form onSubmit={submit} className="grid gap-1.5">
        <div className="flex gap-2">
          <Input value={free} onChange={(e) => setFree(e.target.value)} placeholder="Otra respuesta" aria-label="Otra respuesta" className="bg-background/60" />
          <Button type="submit" size="sm" disabled={!free.trim() || send.isPending}>Responder</Button>
        </div>
        <Input
          value={decision}
          onChange={(e) => setDecision(e.target.value)}
          placeholder="Si esto decide algo, una línea para el registro de decisiones (opcional)"
          aria-label="Decisión"
          className="bg-background/60 text-base md:text-xs"
        />
      </form>
      {total > 1 && (
        <button type="button" onClick={onNext} className="inline-flex min-h-8 w-fit items-center gap-1 justify-self-end text-xs font-semibold text-ink-jorge hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
          Siguiente pregunta <ArrowRightIcon className="size-3.5" aria-hidden />
        </button>
      )}
    </article>
  );
}

// An approval, granted or rejected right here; one write and one event, as from the Bandeja.
function ApprovalCard({ item, names }: { item: InboxItem; names: Names }) {
  const refresh = useRefresh();
  const decide = useMutation({
    mutationFn: (decision: "grant" | "reject") => api.decide([item.id], decision),
    onSuccess: (out, decision) => {
      const r = out.results[0];
      if (r?.ok) toast(decision === "grant" ? "Aprobado" : "Rechazado");
      else toast.error("Esa petición ya no estaba.");
    },
    onError: () => toast.error("No se pudo guardar la decisión."),
    onSettled: () => refresh(item.project),
  });
  const target = item.target && Object.keys(item.target).length ? ` ${JSON.stringify(item.target)}` : "";
  return (
    <article className="grid gap-1.5 rounded-[16px] border bg-surface-sunken px-4 py-3">
      <p className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
        <ProjectWord slug={item.project} names={names} />
        <Link to={taskHref(item)} className="font-mono text-xs text-muted-foreground underline-offset-4 hover:underline">{item.key}</Link>
        <span className="font-medium">quiere {actionWord(item.action)}{target}</span>
      </p>
      {item.title && <p className="text-[13px] text-foreground/80">{item.title}</p>}
      <p className="text-[13px] leading-snug whitespace-pre-wrap text-foreground/80">{item.why}</p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted-foreground">
        {item.evidence?.last_pass && <span>último pass: {item.evidence.last_pass.kind} · {item.evidence.last_pass.cite}</span>}
        {item.evidence && item.evidence.open_checks > 0 && <span>{item.evidence.open_checks} {item.evidence.open_checks === 1 ? "punto abierto" : "puntos abiertos"}</span>}
        {item.pr_url && <a href={item.pr_url} target="_blank" rel="noreferrer" className="text-ink-review underline-offset-4 hover:underline">PR</a>}
        <span>espera {waitText(item.wait_s)}</span>
        <span className="ml-auto flex gap-2">
          <Button size="sm" variant="destructive" disabled={decide.isPending} onClick={() => decide.mutate("reject")}>Rechazar</Button>
          <Button size="sm" disabled={decide.isPending} onClick={() => decide.mutate("grant")}>Aprobar</Button>
        </span>
      </div>
    </article>
  );
}

// Your own actions: counted here, done from the Bandeja.
function CountRow({ n, tone, title, detail, to, cta }: { n: number; tone: string; title: string; detail: string; to: string; cta: string }) {
  return (
    <Link to={to} className="flex items-center gap-3 rounded-[16px] border bg-surface-sunken px-4 py-3 transition hover:bg-foreground/[0.06] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
      <span className={cn("inline-flex size-9 shrink-0 items-center justify-center rounded-xl font-display text-base font-extrabold", tone)}>{n}</span>
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="text-[13px] font-medium">{title}</span>
        <span className="truncate text-xs text-muted-foreground">{detail}</span>
      </span>
      <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-muted-foreground">{cta} <ArrowRightIcon className="size-3.5" aria-hidden /></span>
    </Link>
  );
}

// What waits on Jorge for one tower of the city (or outside every tower): one question at a time,
// each approval, and Jorge's own actions counted with a way into the Bandeja.
export function TeTocaItems({ items, names }: { items: InboxItem[]; names: Names }) {
  const [qi, setQi] = useState(0);
  const groups = useMemo(() => {
    const by = (kind: InboxItem["kind"]) => items.filter((i) => i.kind === kind);
    const actions = by("human_action");
    const actionProjects = [...new Set(actions.map((i) => i.project))];
    return { questions: by("question"), approvals: by("approval"), actions, actionProjects };
  }, [items]);
  const question = groups.questions[Math.min(qi, Math.max(0, groups.questions.length - 1))];
  if (items.length === 0) return null;
  return (
    <div className="grid gap-2.5">
      {question && (
        <QuestionCard
          key={question.id}
          item={question}
          index={groups.questions.indexOf(question)}
          total={groups.questions.length}
          names={names}
          onNext={() => setQi((i) => (i + 1) % groups.questions.length)}
        />
      )}
      {groups.approvals.map((item) => <ApprovalCard key={item.id} item={item} names={names} />)}
      {groups.actionProjects.map((slug) => {
        const mine = groups.actions.filter((i) => i.project === slug);
        return (
          <CountRow
            key={slug}
            n={mine.length}
            tone="bg-status-done/12 text-ink-done"
            title={`${mine.length === 1 ? "acción tuya" : "acciones tuyas"} en ${names(slug)}`}
            detail={mine[0]!.why}
            to={`/inbox#${slug}`}
            cta={mine.length === 1 ? "Ver" : `Ver las ${mine.length}`}
          />
        );
      })}
    </div>
  );
}
