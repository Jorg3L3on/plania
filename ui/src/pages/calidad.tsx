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
  groupHint,
  groupLabel,
  kindWord,
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
import { CALIDAD_PAGE } from "@/lib/calidad-words";
import { words } from "@/lib/i18n";
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

// PLA-I2-10: the columns' labels and hints are in lib/calidad-words.ts.

function Row({ by, g, total }: { by: GroupBy; g: ScoreGroup; total?: boolean }) {
  const w = words(CALIDAD_PAGE);
  const reasons = g.failures.by_reason.map((r) => `${reasonWord(r.reason)}: ${count(r.count)}`).join("\n");
  const detail = total ? null : groupDetail(by, g.key);
  return (
    <tr className={cn("border-t", total && "bg-surface-sunken font-medium")}>
      <th scope="row" className="max-w-[18rem] px-3 py-2.5 text-left align-top font-medium">
        <span className={cn("block break-words", !total && (by === "model" || by === "prompt_version") && g.key !== null && "font-mono text-[13px]")}>{total ? w.all : groupName(by, g.key)}</span>
        {detail && <span className="block font-mono text-[11px] font-normal text-muted-foreground">{detail}</span>}
      </th>
      <Num main={count(g.runs)} />
      <Num main={count(g.tickets_landed)} />
      <Num main={decimal(g.runs_per_ticket)} />
      <Num main={compact(g.tokens_per_ticket)} />
      <Num main={pct(g.qa_first.rate)} sub={g.qa_first.concluded ? w.of(count(g.qa_first.passed), count(g.qa_first.concluded)) : null} />
      <Num main={pct(g.sent_back.rate)} sub={g.sent_back.passed ? w.of(count(g.sent_back.count), count(g.sent_back.passed)) : null} />
      <Num main={count(g.failures.total)} sub={g.failures.max_turns ? w.byMaxTurns(count(g.failures.max_turns)) : null} title={reasons || undefined} />
      <Num main={count(g.blocked_after_two)} />
      <Num main={pct(g.resumed.share)} sub={g.resumed.runs + g.resumed.fresh_runs ? w.of(count(g.resumed.runs), count(g.resumed.runs + g.resumed.fresh_runs)) : null} />
      <Num main={`${pct(g.resumed.ok_rate_resumed)} / ${pct(g.resumed.ok_rate_fresh)}`} />
      <Num main={compact(g.context_tokens_median)} />
    </tr>
  );
}

function Groups({ data }: { data: Scoreboard }) {
  const w = words(CALIDAD_PAGE);
  return (
    <Card className="gap-0 py-0">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1080px] border-collapse text-sm">
          <caption className="sr-only">{w.caption(groupLabel(data.by).toLowerCase())}</caption>
          <thead>
            <tr>
              <th scope="col" className="px-3 py-2.5 text-left text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{groupLabel(data.by)}</th>
              {w.columns.map((c) => (
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
  const w = words(CALIDAD_PAGE);
  if (total.failures.total === 0) return null;
  // Each bar is that reason's part of all the failures, so the bars add up to one whole.
  const max = total.failures.total;
  return (
    <section className="grid gap-3" aria-labelledby="calidad-motivos">
      <h2 id="calidad-motivos" className="font-display text-xl font-bold tracking-tight">{w.whyFailed}</h2>
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

const KIND_TONE: Record<ReadItem["kind"], string> = { failed: "text-ink-blocked", returned: "text-ink-review", sent_back: "text-ink-owner" };

function Quote({ who, children, mono }: { who: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="grid gap-0.5 sm:grid-cols-[5.5rem_minmax(0,1fr)] sm:gap-3">
      <span className="text-xs font-semibold text-muted-foreground sm:pt-0.5">{who}</span>
      <p className={cn("max-h-56 overflow-y-auto break-words whitespace-pre-wrap", mono && "font-mono text-[13px]")}>{children}</p>
    </div>
  );
}

function Reading({ items, now }: { items: ReadItem[]; now?: number }) {
  const w = words(CALIDAD_PAGE);
  return (
    <section className="grid gap-3" aria-labelledby="calidad-lectura">
      <div className="grid gap-1">
        <h2 id="calidad-lectura" className="font-display text-xl font-bold tracking-tight">{w.readTitle}</h2>
        <p className="text-sm text-muted-foreground">{w.readLead}</p>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{w.readEmpty}</p>
      ) : (
        <Card className="gap-0 divide-y py-0">
          {items.map((i, n) => (
            <article key={`${i.kind}-${i.at}-${n}`} className="grid gap-2 px-4 py-3.5 text-sm">
              <header className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                <span className={cn("text-xs font-bold tracking-wide uppercase", KIND_TONE[i.kind])}>
                  {kindWord(i.kind)}
                  {i.kind === "returned" && i.attempt && i.attempt > 1 ? w.review(i.attempt) : ""}
                </span>
                <span className="min-w-0 font-medium break-words">{i.title ?? (i.key ? w.untitled : w.noTask)}</span>
                <span className="text-xs text-muted-foreground">
                  {[i.project, i.key, i.role ? roleWord(i.role) : null].filter(Boolean).join(" · ")}
                </span>
                <time dateTime={i.at} title={localTime(i.at)} className="ml-auto text-xs text-muted-foreground tabular-nums">{ago(i.at, now)}</time>
              </header>
              {i.owner_text && <Quote who={w.youAsked}>{i.owner_text}</Quote>}
              {i.qa_notes && <Quote who={w.qaSaid}>{i.qa_notes}</Quote>}
              {i.summary && <Quote who={w.theRun}>{runWords(i.summary)}</Quote>}
            </article>
          ))}
        </Card>
      )}
    </section>
  );
}

// PLA-I2-10: the icons, in the order of the words' `coming` list (lib/calidad-words.ts).
const COMING_ICONS: (typeof GaugeIcon)[] = [CircleCheckIcon, GaugeIcon, Undo2Icon, TriangleAlertIcon, BookOpenIcon];

function Empty({ narrowed }: { narrowed: boolean }) {
  const w = words(CALIDAD_PAGE);
  return (
    <Card className="gap-5 px-5 py-6 sm:px-8 sm:py-8">
      <div className="grid max-w-2xl gap-2">
        <h2 className="font-display text-2xl font-bold tracking-tight">{w.emptyTitle}</h2>
        <p className="text-muted-foreground">
          {w.emptyLead}
          {narrowed ? w.emptyNarrowed : w.emptyComing}
        </p>
      </div>
      <ul className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
        {w.coming.map(({ title, line }, n) => {
          const Icon = COMING_ICONS[n] ?? GaugeIcon;
          return (
          <li key={title} className="grid grid-cols-[auto_minmax(0,1fr)] gap-3">
            <span className="flex size-9 items-center justify-center rounded-xl bg-surface-sunken text-muted-foreground">
              <Icon className="size-4.5" aria-hidden />
            </span>
            <span className="grid gap-0.5">
              <span className="text-sm font-medium">{title}</span>
              <span className="text-sm text-muted-foreground">{line}</span>
            </span>
          </li>
          );
        })}
      </ul>
    </Card>
  );
}

// Everything under the controls, from one answer. Exported so a test can render it without a server.
export function CalidadView({ data, now }: { data: Scoreboard; now?: number }) {
  const w = words(CALIDAD_PAGE);
  if (data.empty) return <Empty narrowed={data.project !== null || data.days < 28} />;
  const t = data.total;
  return (
    <div className="grid gap-8">
      <section className="grid gap-4" aria-label={w.summary}>
        <p className="max-w-3xl text-lg leading-relaxed text-pretty">{resumen(t).join(" ")}</p>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label={w.landed} value={count(t.tickets_landed)} detail={t.tickets_landed ? w.landedDetail(decimal(t.runs_per_ticket), compact(t.tokens_per_ticket)) : w.landedNone} />
          <Stat label={w.qaFirst} value={pct(t.qa_first.rate)} detail={t.qa_first.concluded ? w.qaFirstDetail(count(t.qa_first.passed), count(t.qa_first.concluded)) : w.qaFirstNone} />
          <Stat label={w.sentBack} value={pct(t.sent_back.rate)} detail={t.sent_back.passed ? w.sentBackDetail(count(t.sent_back.count), count(t.sent_back.passed)) : w.sentBackNone} />
          <Stat
            label={w.failed}
            value={count(t.failures.total)}
            detail={t.failures.total ? w.failedDetail(count(t.runs), count(t.failures.max_turns)) : w.failedNone(count(t.runs))}
            tone={t.failures.total ? "text-ink-blocked" : undefined}
          />
        </div>
      </section>

      <section className="grid gap-3" aria-labelledby="calidad-grupos">
        <div className="grid gap-1">
          <h2 id="calidad-grupos" className="font-display text-xl font-bold tracking-tight">{w.byTitle(groupLabel(data.by).toLowerCase())}</h2>
          <p className="text-sm text-muted-foreground">
            {groupHint(data.by)}
            {w.byHint(NONE)}
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
  const w = words(CALIDAD_PAGE);
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
        <Kicker>{w.kicker}</Kicker>
        <h1 className="font-display text-4xl font-extrabold tracking-[-0.03em] sm:text-5xl">{w.title}</h1>
        <p className="max-w-2xl text-muted-foreground">{w.lead}</p>
      </header>

      <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
        <Choice label={w.groupBy} value={by} options={GROUPS.map((g) => ({ id: g, label: groupLabel(g) }))} onPick={(v) => set("por", v === "role" ? null : v)} />
        <Choice label={w.period} value={days} options={PERIODS.map((d) => ({ id: d as number, label: w.days(d) }))} onPick={(v) => set("dias", v === 28 ? null : String(v))} />
        <div className="grid gap-1.5">
          <span id="calidad-proyecto" className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{w.project}</span>
          <Select value={project ?? ALL} onValueChange={(v) => set("proyecto", v === ALL ? null : v)}>
            <SelectTrigger aria-labelledby="calidad-proyecto" className="h-10 min-w-44 rounded-xl">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{w.allProjects}</SelectItem>
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
        <p className="text-sm text-destructive">{w.loadFailed}</p>
      ) : (
        <div className={cn("transition-opacity", board.isPlaceholderData && "opacity-60")}>
          <CalidadView data={board.data} />
        </div>
      )}
    </div>
  );
}
