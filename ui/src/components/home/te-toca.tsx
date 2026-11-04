// "Te toca": what waits on Jorge, decided from Inicio's city. One question at a time with its
// options, and the rest (your own actions) counted with a way into the Bandeja.
import { ArrowRightIcon } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { accentInk, projectAccent } from "@/components/plan/visuals";
import { waitText } from "@/lib/inbox";
import { useQuestionAnswer } from "@/lib/use-question-answer";
import type { InboxItem } from "@/lib/types";
import { cn } from "@/lib/utils";

type Names = (slug: string) => string;

function ProjectWord({ slug, names }: { slug: string; names: Names }) {
  const [a] = projectAccent(slug);
  return <span className="font-semibold" style={{ color: accentInk(a) }}>{names(slug)}</span>;
}

const taskHref = (item: InboxItem) => `/p/${item.project}?task=${encodeURIComponent(item.key ?? "")}`;

// One question with its options; the optional decision line goes to the decision log, as in the Bandeja.
function QuestionCard({ item, index, total, names, onNext, when }: { item: InboxItem; index: number; total: number; names: Names; onNext: () => void; when?: string }) {
  const flow = useQuestionAnswer(item.project, item.id);
  const [free, setFree] = useState("");
  const [decision, setDecision] = useState("");
  const pending = flow.send.isPending;
  const decided = decision.trim() || undefined;

  const handleChoose = (option: string) => {
    flow.send.mutate({ answer: option, decision: decided });
  };
  const handleSubmitFree = (e: FormEvent) => {
    e.preventDefault();
    if (free.trim()) flow.send.mutate({ answer: free.trim(), decision: decided });
  };
  return (
    <article className="grid gap-2.5 rounded-[16px] border border-status-jorge/25 bg-status-jorge/[0.07] px-4 py-3.5">
      <p className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>
          <ProjectWord slug={item.project} names={names} /> ·{" "}
          <Link to={taskHref(item)} className="font-mono underline-offset-4 hover:underline">{item.key}</Link>
          {" · "}
          {total === 1 ? "una pregunta" : `pregunta ${index + 1} de ${total}`}
        </span>
        <span>{when ? `${when} · ` : ""}espera {waitText(item.wait_s)}</span>
      </p>
      <p className="text-[15px] leading-snug whitespace-pre-wrap">{item.why}</p>
      {(item.options?.length ?? 0) > 0 && (
        <div className="grid gap-1.5">
          {item.options!.map((o, i) => (
            <button
              key={o}
              type="button"
              disabled={pending}
              onClick={() => handleChoose(o)}
              aria-label={o}
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
      <form onSubmit={handleSubmitFree} className="flex gap-2">
        <Input value={free} onChange={(e) => setFree(e.target.value)} placeholder="Otra respuesta" aria-label="Otra respuesta" className="bg-background/60" />
        <Button type="submit" size="sm" disabled={!free.trim() || pending}>Responder</Button>
      </form>
      <Input
        value={decision}
        onChange={(e) => setDecision(e.target.value)}
        placeholder="Si esto decide algo, una línea para el registro de decisiones (opcional)"
        aria-label="Decisión"
        className="bg-background/60 text-base md:text-xs"
      />
      {total > 1 && (
        <button type="button" onClick={onNext} className="inline-flex min-h-8 w-fit items-center gap-1 justify-self-end text-xs font-semibold text-ink-jorge hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
          Siguiente pregunta <ArrowRightIcon className="size-3.5" aria-hidden />
        </button>
      )}
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
// and Jorge's own actions counted with a way into the Bandeja.
export function TeTocaItems({ items, names, when }: { items: InboxItem[]; names: Names; when?: (item: InboxItem) => string | undefined }) {
  const [qi, setQi] = useState(0);
  const groups = useMemo(() => {
    const by = (kind: InboxItem["kind"]) => items.filter((i) => i.kind === kind);
    const actions = [...by("release"), ...by("human_action")];
    const actionProjects = [...new Set(actions.map((i) => i.project))];
    return { questions: by("question"), actions, actionProjects };
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
          when={when?.(question)}
        />
      )}
      {groups.actionProjects.map((slug) => {
        const mine = groups.actions.filter((i) => i.project === slug);
        const word = when?.(mine[0]!);
        return (
          <CountRow
            key={slug}
            n={mine.length}
            tone="bg-status-done/12 text-ink-done"
            title={`${mine.length === 1 ? "acción tuya" : "acciones tuyas"} en ${names(slug)}`}
            detail={word ? `${word} · ${mine[0]!.why}` : mine[0]!.why}
            to={`/inbox?tab=pasos#${slug}`}
            cta={mine.length === 1 ? "Ver" : `Ver las ${mine.length}`}
          />
        );
      })}
    </div>
  );
}
