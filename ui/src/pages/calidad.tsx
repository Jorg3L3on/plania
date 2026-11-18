import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { BookOpenIcon, CircleCheckIcon, GaugeIcon, TriangleAlertIcon, Undo2Icon } from "lucide-react";
import type { ReactNode } from "react";
import { useSearchParams } from "react-router";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Kicker } from "@/components/plan/visuals";
import { api } from "@/lib/api";
import {
  GROUPS,
  GROUP_HINT,
  GROUP_LABEL,
  KIND_WORD,
  NONE,
  PERIODS,
  compact,
  count,
  decimal,
  fetchScoreboard,
  groupDetail,
  groupName,
  parseBy,
  parseDays,
  pct,
  reasonWord,
  resumen,
  roleWord,
  runWords,
  type GroupBy,
  type ReadItem,
  type ScoreGroup,
  type Scoreboard,
} from "@/lib/calidad";
import { ago, localTime } from "@/lib/time";
import { cn } from "@/lib/utils";

// AUDIT-5: Calidad. One screen over GET /api/scoreboard: what happened in sentences, four numbers, the groups in a
// table, and the list to read each week. Everything is read-only.

// A row of small buttons where one is on (the group and the period).
function Choice<T extends string | number>({ label, value, options, onPick }: { label: string; value: T; options: { id: T; label: string }[]; onPick: (v: T) => void }) {
  return (
    <div className="grid gap-1.5">
      <span className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{label}</span>
      <div role="group" aria-label={label} className="flex w-fit max-w-full flex-wrap gap-1 rounded-xl bg-surface-sunken p-1">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            aria-pressed={o.id === value}
            onClick={() => onPick(o.id)}
            className={cn(
              "min-h-8 rounded-lg px-3 text-[13px] font-medium transition focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none pointer-coarse:min-h-10",
              o.id === value ? "bg-card text-foreground shadow-sm ring-1 ring-foreground/10" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value, detail, tone }: { label: string; value: string; detail: string; tone?: string }) {
  return (
    <Card className="gap-1 px-4">
      <span className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{label}</span>
      <span className={cn("font-display text-4xl leading-none font-extrabold tracking-[-0.03em] tabular-nums", tone)}>{value}</span>
      <span className="text-xs text-muted-foreground tabular-nums">{detail}</span>
    </Card>
  );
}

// A number with the count it came from under it: "50 %" over "1 de 2".
function Num({ main, sub, title }: { main: string; sub?: string | null; title?: string }) {
  return (
    <td className="px-3 py-2.5 text-right align-top tabular-nums" title={title}>
      <span className={cn("block", main === NONE && "text-muted-foreground")}>{main}</span>
      {sub && <span className="block text-xs text-muted-foreground">{sub}</span>}
    </td>
  );
}

const COLUMNS: { label: string; hint: string }[] = [
  { label: "Corridas", hint: "Corridas que terminaron en el periodo: bien, con error o detenidas." },
  { label: "Tareas terminadas", hint: "Tareas que llegaron a fusionarse, publicarse o cerrarse en el periodo." },
  { label: "Corridas por tarea", hint: "Cuántas corridas tomó, en promedio, cada tarea terminada." },
  { label: "Tokens por tarea", hint: "Tokens de entrada y salida por tarea terminada, en promedio." },
  { label: "QA a la primera", hint: "De las entregas que QA revisó por primera vez, cuántas aprobó." },
  { label: "Devueltas por ti", hint: "Entregas que QA aprobó y tú pediste cambiar." },
  { label: "Con error", hint: "Corridas que terminaron con error. Debajo, las que llegaron al tope de turnos." },
  { label: "Detenidas tras 2 errores", hint: "Tareas que Plania detuvo porque el mismo agente falló dos veces seguidas." },
  { label: "Retomadas", hint: "Parte de las corridas que retomó una sesión anterior en vez de empezar de cero." },
  { label: "Aciertos: retomada / nueva", hint: "De las corridas que retomaron una sesión, cuántas terminaron bien; y lo mismo para las que empezaron de cero." },
  { label: "Contexto al cierre", hint: "Tokens de contexto que llevaba el último turno. Es la mediana de las corridas que lo registraron." },
];

function Row({ by, g, total }: { by: GroupBy; g: ScoreGroup; total?: boolean }) {
  const reasons = g.failures.by_reason.map((r) => `${reasonWord(r.reason)}: ${count(r.count)}`).join("\n");
  const detail = total ? null : groupDetail(by, g.key);
  return (
    <tr className={cn("border-t", total && "bg-surface-sunken font-medium")}>
      <th scope="row" className="max-w-[18rem] px-3 py-2.5 text-left align-top font-medium">
        <span className={cn("block break-words", !total && (by === "model" || by === "prompt_version") && g.key !== null && "font-mono text-[13px]")}>{total ? "Todo" : groupName(by, g.key)}</span>
        {detail && <span className="block font-mono text-[11px] font-normal text-muted-foreground">{detail}</span>}
      </th>
      <Num main={count(g.runs)} />
      <Num main={count(g.tickets_landed)} />
      <Num main={decimal(g.runs_per_ticket)} />
      <Num main={compact(g.tokens_per_ticket)} />
      <Num main={pct(g.qa_first.rate)} sub={g.qa_first.concluded ? `${count(g.qa_first.passed)} de ${count(g.qa_first.concluded)}` : null} />
      <Num main={pct(g.sent_back.rate)} sub={g.sent_back.passed ? `${count(g.sent_back.count)} de ${count(g.sent_back.passed)}` : null} />
      <Num main={count(g.failures.total)} sub={g.failures.max_turns ? `${count(g.failures.max_turns)} por tope de turnos` : null} title={reasons || undefined} />
      <Num main={count(g.blocked_after_two)} />
      <Num main={pct(g.resumed.share)} sub={g.resumed.runs + g.resumed.fresh_runs ? `${count(g.resumed.runs)} de ${count(g.resumed.runs + g.resumed.fresh_runs)}` : null} />
      <Num main={`${pct(g.resumed.ok_rate_resumed)} / ${pct(g.resumed.ok_rate_fresh)}`} />
      <Num main={compact(g.context_tokens_median)} />
    </tr>
  );
}

function Groups({ data }: { data: Scoreboard }) {
  return (
    <Card className="gap-0 py-0">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1080px] border-collapse text-sm">
          <caption className="sr-only">Números por {GROUP_LABEL[data.by].toLowerCase()}</caption>
          <thead>
            <tr>
              <th scope="col" className="px-3 py-2.5 text-left text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{GROUP_LABEL[data.by]}</th>
              {COLUMNS.map((c) => (
                <th key={c.label} scope="col" title={c.hint} className="px-3 py-2.5 text-right align-bottom text-[11px] leading-tight font-semibold tracking-wide text-muted-foreground uppercase">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.groups.map((g) => (
              <Row key={g.key ?? "\u0000"} by={data.by} g={g} />
            ))}
            {data.groups.length !== 1 && <Row by={data.by} g={data.total} total />}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Reasons({ total }: { total: ScoreGroup }) {
  if (total.failures.total === 0) return null;
  // Each bar is that reason's part of all the failures, so the bars add up to one whole.
  const max = total.failures.total;
  return (
    <section className="grid gap-3" aria-labelledby="calidad-motivos">
      <h2 id="calidad-motivos" className="font-display text-xl font-bold tracking-tight">Por qué fallaron</h2>
      <Card className="gap-2.5 px-4">
        {total.failures.by_reason.map((r) => (
          <div key={r.reason} className="grid grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto] items-center gap-3 text-sm">
            <span className="break-words">{reasonWord(r.reason)}</span>
            <span className="h-2 overflow-hidden rounded-full bg-surface-sunken" aria-hidden>
              <span className="block h-full rounded-full bg-status-blocked" style={{ width: `${(r.count / max) * 100}%` }} />
            </span>
            <span className="min-w-8 text-right tabular-nums">{count(r.count)}</span>
          </div>
        ))}
      </Card>
    </section>
  );
}

const KIND_TONE: Record<ReadItem["kind"], string> = { failed: "text-ink-blocked", returned: "text-ink-review", sent_back: "text-ink-jorge" };

function Quote({ who, children, mono }: { who: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="grid gap-0.5 sm:grid-cols-[5.5rem_minmax(0,1fr)] sm:gap-3">
      <span className="text-xs font-semibold text-muted-foreground sm:pt-0.5">{who}</span>
      <p className={cn("max-h-56 overflow-y-auto break-words whitespace-pre-wrap", mono && "font-mono text-[13px]")}>{children}</p>
    </div>
  );
}

function Reading({ items, now }: { items: ReadItem[]; now?: number }) {
  return (
    <section className="grid gap-3" aria-labelledby="calidad-lectura">
      <div className="grid gap-1">
        <h2 id="calidad-lectura" className="font-display text-xl font-bold tracking-tight">Para leer esta semana</h2>
        <p className="text-sm text-muted-foreground">Lo último que falló, lo que QA devolvió y lo que devolviste tú, con lo que dijo cada quien. Los números dicen cuánto; esto dice por qué.</p>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nada falló ni se devolvió en este periodo.</p>
      ) : (
        <Card className="gap-0 divide-y py-0">
          {items.map((i, n) => (
            <article key={`${i.kind}-${i.at}-${n}`} className="grid gap-2 px-4 py-3.5 text-sm">
              <header className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                <span className={cn("text-xs font-bold tracking-wide uppercase", KIND_TONE[i.kind])}>
                  {KIND_WORD[i.kind]}
                  {i.kind === "returned" && i.attempt && i.attempt > 1 ? ` (revisión ${i.attempt})` : ""}
                </span>
                <span className="min-w-0 font-medium break-words">{i.title ?? (i.key ? "Tarea sin título" : "Trabajo sin tarea")}</span>
                <span className="text-xs text-muted-foreground">
                  {[i.project, i.key, i.role ? roleWord(i.role) : null].filter(Boolean).join(" · ")}
                </span>
                <time dateTime={i.at} title={localTime(i.at)} className="ml-auto text-xs text-muted-foreground tabular-nums">{ago(i.at, now)}</time>
              </header>
              {i.owner_text && <Quote who="Tú pediste">{i.owner_text}</Quote>}
              {i.qa_notes && <Quote who="QA dijo">{i.qa_notes}</Quote>}
              {i.summary && <Quote who="La corrida">{runWords(i.summary)}</Quote>}
            </article>
          ))}
        </Card>
      )}
    </section>
  );
}

const COMING: { icon: typeof GaugeIcon; title: string; line: string }[] = [
  { icon: CircleCheckIcon, title: "Tareas terminadas y lo que costaron", line: "Cuántas corridas y cuántos tokens tomó cada tarea que llegó a su destino." },
  { icon: GaugeIcon, title: "QA a la primera", line: "De las entregas que QA revisó, cuántas aprobó sin devolverlas." },
  { icon: Undo2Icon, title: "Lo que devolviste tú", line: "Entregas que QA aprobó y aun así pediste cambiar." },
  { icon: TriangleAlertIcon, title: "Por qué fallan las corridas", line: "Las que terminaron con error, por motivo, y las tareas que se detuvieron tras dos errores seguidos." },
  { icon: BookOpenIcon, title: "La lectura de la semana", line: "Lo último que falló o se devolvió, con las notas de QA y lo que pediste." },
];

function Empty({ narrowed }: { narrowed: boolean }) {
  return (
    <Card className="gap-5 px-5 py-6 sm:px-8 sm:py-8">
      <div className="grid max-w-2xl gap-2">
        <h2 className="font-display text-2xl font-bold tracking-tight">Todavía no hay nada que medir</h2>
        <p className="text-muted-foreground">
          Esta página se llena sola con el trabajo de los agentes: no hay nada que configurar.
          {narrowed ? " En este periodo y proyecto no hubo corridas; prueba con un periodo más largo o con todos los proyectos." : " En cuanto haya corridas, aquí vas a ver:"}
        </p>
      </div>
      <ul className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
        {COMING.map(({ icon: Icon, title, line }) => (
          <li key={title} className="grid grid-cols-[auto_minmax(0,1fr)] gap-3">
            <span className="flex size-9 items-center justify-center rounded-xl bg-surface-sunken text-muted-foreground">
              <Icon className="size-4.5" aria-hidden />
            </span>
            <span className="grid gap-0.5">
              <span className="text-sm font-medium">{title}</span>
              <span className="text-sm text-muted-foreground">{line}</span>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// Everything under the controls, from one answer. Exported so a test can render it without a server.
export function CalidadView({ data, now }: { data: Scoreboard; now?: number }) {
  if (data.empty) return <Empty narrowed={data.project !== null || data.days < 28} />;
  const t = data.total;
  return (
    <div className="grid gap-8">
      <section className="grid gap-4" aria-label="Resumen">
        <p className="max-w-3xl text-lg leading-relaxed text-pretty">{resumen(t).join(" ")}</p>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Tareas terminadas" value={count(t.tickets_landed)} detail={t.tickets_landed ? `${decimal(t.runs_per_ticket)} corridas y ${compact(t.tokens_per_ticket)} tokens cada una` : "ninguna en el periodo"} />
          <Stat label="QA a la primera" value={pct(t.qa_first.rate)} detail={t.qa_first.concluded ? `${count(t.qa_first.passed)} de ${count(t.qa_first.concluded)} entregas` : "sin entregas revisadas"} />
          <Stat label="Devueltas por ti" value={pct(t.sent_back.rate)} detail={t.sent_back.passed ? `${count(t.sent_back.count)} de ${count(t.sent_back.passed)} que QA aprobó` : "sin entregas aprobadas por QA"} />
          <Stat
            label="Corridas con error"
            value={count(t.failures.total)}
            detail={t.failures.total ? `de ${count(t.runs)}; ${count(t.failures.max_turns)} por tope de turnos` : `de ${count(t.runs)} corridas`}
            tone={t.failures.total ? "text-ink-blocked" : undefined}
          />
        </div>
      </section>

      <section className="grid gap-3" aria-labelledby="calidad-grupos">
        <div className="grid gap-1">
          <h2 id="calidad-grupos" className="font-display text-xl font-bold tracking-tight">Por {GROUP_LABEL[data.by].toLowerCase()}</h2>
          <p className="text-sm text-muted-foreground">
            {GROUP_HINT[data.by]} Lo que dijeron QA y tú se anota a la corrida de Taller que hizo esa entrega. Una raya ({NONE}) es que no hubo con qué medir.
          </p>
        </div>
        <Groups data={data} />
      </section>

      <Reasons total={t} />
      <Reading items={data.to_read} now={now} />
    </div>
  );
}

const ALL = "__all__";

export function CalidadPage() {
  const [params, setParams] = useSearchParams();
  const by = parseBy(params.get("por"));
  const days = parseDays(params.get("dias"));
  const project = params.get("proyecto") ?? undefined;
  const board = useQuery({ queryKey: ["scoreboard", by, days, project ?? ""], queryFn: () => fetchScoreboard({ by, days, project }), placeholderData: keepPreviousData });
  const projects = useQuery({ queryKey: ["projects"], queryFn: api.projects, staleTime: 60_000 });

  const set = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  return (
    <div className="grid gap-8">
      <header className="grid gap-2">
        <Kicker>Agentes</Kicker>
        <h1 className="font-display text-4xl font-extrabold tracking-[-0.03em] sm:text-5xl">Calidad</h1>
        <p className="max-w-2xl text-muted-foreground">Qué tan bien construyen los agentes, medido con lo que Plania ya guarda de cada corrida, cada revisión de QA y cada vez que pides cambios.</p>
      </header>

      <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
        <Choice label="Agrupar por" value={by} options={GROUPS.map((g) => ({ id: g, label: GROUP_LABEL[g] }))} onPick={(v) => set("por", v === "role" ? null : v)} />
        <Choice label="Periodo" value={days} options={PERIODS.map((d) => ({ id: d as number, label: `${d} días` }))} onPick={(v) => set("dias", v === 28 ? null : String(v))} />
        <div className="grid gap-1.5">
          <span id="calidad-proyecto" className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Proyecto</span>
          <Select value={project ?? ALL} onValueChange={(v) => set("proyecto", v === ALL ? null : v)}>
            <SelectTrigger aria-labelledby="calidad-proyecto" className="h-10 min-w-44 rounded-xl">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todos los proyectos</SelectItem>
              {(projects.data ?? []).map((p) => (
                <SelectItem key={p.slug} value={p.slug}>{p.title}</SelectItem>
              ))}
              {project && !projects.data?.some((p) => p.slug === project) && <SelectItem value={project}>{project}</SelectItem>}
            </SelectContent>
          </Select>
        </div>
      </div>

      {board.isPending ? (
        <div className="grid gap-4">
          <Skeleton className="h-16 max-w-3xl rounded-2xl" />
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-28 rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-64 rounded-xl" />
        </div>
      ) : board.isError ? (
        <p className="text-sm text-destructive">No se pudieron cargar los números. Revisa que el proyecto exista y vuelve a intentar.</p>
      ) : (
        <div className={cn("transition-opacity", board.isPlaceholderData && "opacity-60")}>
          <CalidadView data={board.data} />
        </div>
      )}
    </div>
  );
}
