// PLA-I28: the CEO screen v2 (canvas A on the phone, B on the Mac). Everything shown comes from GET /api/dashboard;
// the two actions go through POST /api/dashboard/wake and /assign.
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { STATUS_DOT, STATUS_WORD } from "@/components/team/types";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { Dashboard, DashboardAgent, DashboardGoal, GoalHealth, QueueItem, QueueKind, ReadyTicket } from "@/components/dashboard/types";

const panel = "rounded-2xl bg-card ring-1 ring-foreground/10";
const heading = "font-display text-xl font-extrabold tracking-tight";
const count = (n: number) => n.toLocaleString("es-MX");
const projectLabel = (slug: string | null) => (!slug ? "Empresa" : slug === "micasa" ? "MiCasa" : slug.charAt(0).toUpperCase() + slug.slice(1));
const pillPrimary = "inline-flex min-h-10 items-center justify-center rounded-full bg-foreground px-4 text-sm font-semibold text-background hover:opacity-90 disabled:opacity-40";
const pillGhost = "inline-flex min-h-10 items-center justify-center rounded-full px-4 text-sm ring-1 ring-foreground/15 hover:bg-muted disabled:opacity-40";

const useWide = () => {
  const [wide, setWide] = useState(() => window.matchMedia("(min-width: 640px)").matches);
  useEffect(() => {
    const query = window.matchMedia("(min-width: 640px)");
    const handleChange = () => setWide(query.matches);
    query.addEventListener("change", handleChange);
    return () => query.removeEventListener("change", handleChange);
  }, []);
  return wide;
};

// ---- KPIs (Mac strip; the phone keeps them in Ritmo)

export const Kpis = ({ data }: { data: Dashboard }) => {
  const { shipped, previous_finished: previous, team, goals } = data;
  const company = goals.find((goal) => goal.project === null);
  const delta = previous > 0 ? Math.round(((shipped.finished - previous) / previous) * 100) : null;
  const items = [
    {
      n: count(shipped.finished),
      label: "salieron",
      sub: delta === null ? "esta semana" : `${delta >= 0 ? "+" : "−"}${Math.abs(delta)} % vs semana pasada`,
      tone: delta === null ? "" : delta >= 0 ? "text-ink-done" : "text-ink-blocked",
    },
    { n: count(shipped.prs), label: "PRs fusionados", sub: "esta semana", tone: "" },
    company
      ? { n: `${company.progress.done}/${company.progress.total}`, label: "meta de la compañía", sub: company.why, tone: "" }
      : { n: "—", label: "meta de la compañía", sub: "sin metas", tone: "" },
    { n: `${team.alive}/${team.total}`, label: "agentes activos", sub: `${team.stuck} atascados`, tone: "" },
  ];
  return (
    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {items.map((item) => (
        <li key={item.label} className={cn(panel, "grid gap-0.5 px-3.5 py-2.5")}>
          <span className="font-display text-2xl font-extrabold tracking-tight tabular-nums">{item.n}</span>
          <span className="text-xs text-muted-foreground">{item.label}</span>
          <span className={cn("truncate text-xs text-muted-foreground", item.tone)}>{item.sub}</span>
        </li>
      ))}
    </ul>
  );
};

// ---- Brief

// PLA-I30: Compañía titles it "Brief de hoy" and signs it as Asistente; the default stays for older callers.
export const Brief = ({ lines, title = "Hoy te toca", sign }: { lines: string[]; title?: string; sign?: string }) => (
  <section aria-labelledby="ceo-brief" className="grid gap-2.5 rounded-[22px] bg-gradient-to-b from-muted to-card p-4 ring-1 ring-foreground/10 sm:p-5">
    <div className="flex items-baseline justify-between gap-3">
      <h2 id="ceo-brief" className="text-[11px] font-bold tracking-[0.14em] text-muted-foreground uppercase">
        {title}
      </h2>
      {sign && <span className="text-xs text-muted-foreground">{sign}</span>}
    </div>
    {lines.length === 0 ? (
      <p className="text-[15px] text-muted-foreground">Nada nuevo desde ayer.</p>
    ) : (
      <ol className="grid list-decimal gap-2 pl-5 text-[15px] leading-snug">
        {lines.map((line) => (
          <li key={line} className="line-clamp-3 break-words">
            {line}
          </li>
        ))}
      </ol>
    )}
  </section>
);

// ---- Queue

const KIND_LABEL: Record<QueueKind, string> = { decidir: "Decidir", merge: "Merge", atorado: "Atorado", paso: "Paso" };
const KIND_TONE: Record<QueueKind, string> = {
  decidir: "bg-status-jorge/20 text-ink-jorge",
  merge: "bg-status-review/20 text-ink-review",
  atorado: "bg-status-blocked/20 text-ink-blocked",
  paso: "bg-status-now/20 text-ink-now",
};
const FILTERS: ("todo" | QueueKind)[] = ["todo", "decidir", "merge", "atorado", "paso"];

const age = (days: number) => (days <= 0 ? "hoy" : days === 1 ? "1 día" : `${days} días`);

const QueueAction = ({ item, onAssign }: { item: QueueItem; onAssign: (item: QueueItem) => void }) => {
  if (item.action === "assign") {
    return (
      <button type="button" className={pillPrimary} onClick={() => onAssign(item)}>
        Asignar
      </button>
    );
  }
  if (item.action === "review") {
    return item.href ? (
      <a className={pillPrimary} href={item.href} target="_blank" rel="noreferrer">
        Revisar
      </a>
    ) : (
      <Link className={pillPrimary} to={`/p/${item.project}`}>
        Revisar
      </Link>
    );
  }
  return (
    <Link className={pillPrimary} to="/inbox">
      Abrir
    </Link>
  );
};

export const Queue = ({
  items,
  onAssign,
  title = "Te necesitan",
  note,
}: {
  items: QueueItem[];
  onAssign: (item: QueueItem) => void;
  title?: string;
  note?: string;
}) => {
  const [filter, setFilter] = useState<"todo" | QueueKind>("todo");
  const counts = useMemo(() => {
    const out: Record<string, number> = { todo: items.length };
    for (const item of items) out[item.kind] = (out[item.kind] ?? 0) + 1;
    return out;
  }, [items]);
  const shown = filter === "todo" ? items : items.filter((item) => item.kind === filter);
  return (
    <section aria-labelledby="ceo-queue" className={cn(panel, "overflow-hidden")}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="grid gap-0.5">
          <h2 id="ceo-queue" className={heading}>
            {title} <span className="font-mono text-sm font-normal text-muted-foreground">{items.length}</span>
          </h2>
          {note && <p className="text-xs text-muted-foreground">{note}</p>}
        </div>
        <div role="tablist" aria-label="Filtrar" className="flex flex-wrap gap-1.5">
          {FILTERS.filter((kind) => kind === "todo" || counts[kind]).map((kind) => (
            <button
              key={kind}
              type="button"
              role="tab"
              aria-selected={filter === kind}
              onClick={() => setFilter(kind)}
              className={cn(
                "inline-flex min-h-9 items-center rounded-full px-3 text-[13px]",
                filter === kind ? "bg-foreground font-semibold text-background" : "ring-1 ring-foreground/15 hover:bg-muted",
              )}
            >
              {kind === "todo" ? "Todo" : KIND_LABEL[kind]} {counts[kind] ?? 0}
            </button>
          ))}
        </div>
      </div>
      {shown.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">Nada te espera.</p>
      ) : (
        <ul>
          {shown.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3 last:border-0">
              <span className={cn("min-w-[76px] rounded-full px-2.5 py-0.5 text-center text-xs font-semibold", KIND_TONE[item.kind])}>
                {KIND_LABEL[item.kind]}
              </span>
              <span className="grid min-w-0 flex-[1_1_220px] gap-0.5">
                <span className="line-clamp-3 text-[15px] font-medium break-words" title={item.title}>
                  {item.title}
                </span>
                <span className="text-xs text-muted-foreground">
                  {item.key && <span className="font-mono">{item.key}</span>}
                  {item.key ? " · " : ""}
                  {projectLabel(item.project)}
                  {item.detail ? ` · ${item.detail}` : ""} · espera {age(item.age_days)}
                </span>
              </span>
              <QueueAction item={item} onAssign={onAssign} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

// ---- Team

const agentLine = (agent: DashboardAgent) => {
  const word = STATUS_WORD[agent.status] ?? agent.status;
  if (agent.claim) return `${word} · ${agent.claim.key}`;
  if (agent.ready > 0) return `${word} · ${agent.ready} ${agent.ready === 1 ? "listo suyo" : "listos suyos"}`;
  return word;
};

export const Team = ({
  agents,
  onAssign,
}: {
  agents: DashboardAgent[];
  onAssign: (agent: DashboardAgent) => void;
}) => {
  const client = useQueryClient();
  const wake = useMutation({
    mutationFn: (slug: string) => api.wakeAgent(slug),
    onSuccess: (result, slug) => {
      if (result.woke) toast.success(`${slug}: ${result.run?.summary ?? "despierto"}`);
      else toast(result.detail ?? "No se pudo despertar", { description: "Se configura en PLA-08." });
      void client.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: () => toast.error("No se pudo despertar"),
  });
  const people = agents.filter((agent) => agent.role !== "human");
  const alive = people.filter((agent) => agent.status === "alive").length;
  return (
    <section aria-labelledby="ceo-team" className={cn(panel, "overflow-hidden")}>
      <div className="flex items-baseline justify-between gap-3 border-b border-border px-4 py-3">
        <h2 id="ceo-team" className={heading}>
          Equipo
        </h2>
        <span className="text-xs text-muted-foreground">
          {alive} {alive === 1 ? "activo" : "activos"} · {people.length - alive} en espera
        </span>
      </div>
      <ul>
        {people.map((agent) => (
          <li key={agent.slug} className="flex items-center gap-3 border-b border-border px-4 py-2.5 last:border-0">
            <span className={cn("size-2.5 shrink-0 rounded-full", STATUS_DOT[agent.status] ?? "bg-status-idle")} aria-hidden />
            <span className="grid min-w-0 flex-1">
              <span className="truncate text-sm font-semibold">{agent.name}</span>
              <span className="truncate text-xs text-muted-foreground">{agentLine(agent)}</span>
            </span>
            <button
              type="button"
              className={cn(pillGhost, "min-h-9 px-3 text-xs")}
              disabled={!agent.can_wake || wake.isPending}
              title={agent.can_wake ? "Despertar ahora" : (agent.wake_reason ?? undefined)}
              aria-label={agent.can_wake ? `Despertar a ${agent.name}` : `Despertar a ${agent.name}: ${agent.wake_reason ?? "no disponible"}`}
              onClick={() => wake.mutate(agent.slug)}
            >
              Despertar
            </button>
            <button type="button" className={cn(pillGhost, "min-h-9 px-3 text-xs font-semibold")} onClick={() => onAssign(agent)}>
              Asignar
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
};

// ---- Goals

const HEALTH: Record<GoalHealth, { word: string; chip: string; bar: string }> = {
  on: { word: "En curso", chip: "bg-status-done/20 text-ink-done", bar: "bg-status-done" },
  risk: { word: "En riesgo", chip: "bg-status-review/20 text-ink-review", bar: "bg-status-review" },
  stop: { word: "Detenida", chip: "bg-status-blocked/20 text-ink-blocked", bar: "bg-status-blocked" },
  none: { word: "Sin iniciativas", chip: "bg-muted text-muted-foreground", bar: "bg-status-idle" },
};
const HEALTH_RANK: Record<GoalHealth, number> = { stop: 0, risk: 1, on: 2, none: 3 };

export const Goals = ({ goals }: { goals: DashboardGoal[] }) => {
  const company = goals.find((goal) => goal.project === null);
  const products = goals
    .filter((goal) => goal.project !== null)
    .sort((a, b) => HEALTH_RANK[a.health] - HEALTH_RANK[b.health] || (a.project ?? "").localeCompare(b.project ?? ""));
  return (
    <section aria-labelledby="ceo-goals" className={cn(panel, "grid gap-3 p-4")}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="ceo-goals" className={heading}>
          Metas
        </h2>
        <Link to="/ceo#proyectos" className="text-[13px] text-muted-foreground hover:text-foreground">
          {company ? `Compañía ${company.progress.done} de ${company.progress.total}` : "Abrir metas"}
        </Link>
      </div>
      {products.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Todavía no hay metas. <Link to="/ceo#proyectos" className="underline">Crea la primera</Link>.
        </p>
      ) : (
        <ul className="grid gap-3">
          {products.map((goal) => {
            const style = HEALTH[goal.health];
            const width = goal.progress.total === 0 ? 0 : Math.round((goal.progress.done / goal.progress.total) * 100);
            return (
              <li key={goal.id} className="grid gap-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-semibold" title={goal.title}>
                    {projectLabel(goal.project)}
                  </span>
                  <span className={cn("shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold", style.chip)}>{style.word}</span>
                </div>
                <div
                  className="h-1.5 overflow-hidden rounded-full bg-muted"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={Math.max(goal.progress.total, 1)}
                  aria-valuenow={goal.progress.done}
                  aria-label={`${projectLabel(goal.project)}: ${goal.progress.done} de ${goal.progress.total}`}
                >
                  <div className={cn("h-full rounded-full", style.bar)} style={{ width: `${width}%` }} />
                </div>
                <span className="text-xs text-muted-foreground">
                  {goal.progress.done} de {goal.progress.total} · {goal.why}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
};

// ---- Ritmo

export const Ritmo = ({ data }: { data: Dashboard }) => {
  const { trend } = data;
  const peak = Math.max(trend.target, ...trend.weeks.map((week) => week.total), 1);
  const targetPct = Math.round((trend.target / peak) * 100);
  const last = trend.weeks.length - 1;
  const usage = data.usage.input + data.usage.output;
  return (
    <section aria-labelledby="ceo-ritmo" className={cn(panel, "grid gap-4 p-4")}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="ceo-ritmo" className={heading}>
          Ritmo
        </h2>
        <span className="text-xs text-muted-foreground">tickets hechos por semana · meta {trend.target}</span>
      </div>
      <div className="relative">
        <span
          aria-hidden
          className="absolute inset-x-0 border-t border-dashed border-muted-foreground/50"
          style={{ bottom: `calc(${targetPct}% * 0.8 + 20px)` }}
        />
        <ol className="grid h-36 grid-cols-6 items-end gap-2">
          {trend.weeks.map((week, index) => (
            <li key={week.from} className="grid h-full grid-rows-[auto_1fr_auto] justify-items-center gap-1" aria-label={`Semana del ${week.label}: ${week.total}`}>
              <span className="font-mono text-[11px] text-muted-foreground">{week.total}</span>
              <span className="flex w-full items-end">
                <span
                  className={cn("block w-full rounded-t-md rounded-b-sm", index === last ? "bg-foreground" : "bg-status-idle/70")}
                  style={{ height: `${Math.max(Math.round((week.total / peak) * 100), week.total > 0 ? 4 : 0)}%` }}
                />
              </span>
              <span className="text-[11px] text-muted-foreground">{index === last ? "esta" : week.label}</span>
            </li>
          ))}
        </ol>
      </div>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { n: trend.cycle_days === null ? "—" : `${String(trend.cycle_days).replace(".", ",")} d`, label: "mediana de creado a hecho" },
          { n: count(trend.in_review), label: "en revisión" },
          { n: count(trend.ready_unowned), label: "listos sin agente" },
          { n: count(usage), label: "tokens reportados" },
        ].map((stat) => (
          <div key={stat.label} className="grid gap-0.5">
            <dd className="font-display text-2xl font-extrabold tracking-tight tabular-nums">{stat.n}</dd>
            <dt className="text-xs text-muted-foreground">{stat.label}</dt>
          </div>
        ))}
      </dl>
    </section>
  );
};

// ---- Assign sheet: an agent picks a ticket, or a stalled initiative picks an agent.

export type AssignTarget = { kind: "agent"; agent: DashboardAgent } | { kind: "initiative"; item: QueueItem };

export const AssignSheet = ({
  target,
  data,
  onClose,
}: {
  target: AssignTarget | null;
  data: Dashboard;
  onClose: () => void;
}) => {
  const wide = useWide();
  const client = useQueryClient();
  const run = useMutation({
    mutationFn: async (pairs: { ticket: ReadyTicket; agent: string }[]) => {
      for (const pair of pairs) await api.assignTask(pair.ticket.project, pair.ticket.key, pair.agent);
      return pairs;
    },
    onSuccess: (pairs) => {
      const who = pairs[0]?.agent ?? "";
      toast.success(pairs.length === 1 ? `${pairs[0]!.ticket.key} → ${who}` : `${pairs.length} tickets → ${who}`);
      void client.invalidateQueries({ queryKey: ["dashboard"] });
      onClose();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "No se pudo asignar"),
  });
  const agents = data.team.agents.filter((agent) => agent.role !== "human");
  const forInitiative = target?.kind === "initiative" ? data.ready_tickets.filter((ticket) => ticket.parent_key === target.item.key) : [];
  const forAgent = target?.kind === "agent" ? data.ready_tickets.filter((ticket) => ticket.owner_agent !== target.agent.slug) : [];
  return (
    <Sheet open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side={wide ? "right" : "bottom"} className="max-h-[85svh] overflow-y-auto bg-background sm:max-h-none sm:max-w-md">
        <SheetHeader className="pr-10">
          <SheetTitle className="font-display text-xl font-extrabold tracking-tight">
            {target?.kind === "agent" ? `Asignar a ${target.agent.name}` : `Asignar ${target?.kind === "initiative" ? target.item.key : ""}`}
          </SheetTitle>
          <SheetDescription>
            {target?.kind === "agent"
              ? "Elige un ticket listo. Queda como suyo; nadie se despierta solo."
              : forInitiative.length === 1
                ? "Su ticket listo pasa al agente que elijas."
                : `Sus ${forInitiative.length} tickets listos pasan al agente que elijas.`}
          </SheetDescription>
        </SheetHeader>
        <ul className="grid gap-1.5 px-4 pb-6">
          {target?.kind === "agent" &&
            (forAgent.length === 0 ? (
              <li className="text-sm text-muted-foreground">No hay tickets listos.</li>
            ) : (
              forAgent.map((ticket) => (
                <li key={`${ticket.project}:${ticket.key}`}>
                  <button
                    type="button"
                    disabled={run.isPending}
                    onClick={() => run.mutate([{ ticket, agent: target.agent.slug }])}
                    className="grid min-h-11 w-full gap-0.5 rounded-xl px-3 py-2 text-left ring-1 ring-foreground/10 hover:bg-muted disabled:opacity-40"
                  >
                    <span className="truncate text-sm">{ticket.title}</span>
                    <span className="text-xs text-muted-foreground">
                      <span className="font-mono">{ticket.key}</span> · {projectLabel(ticket.project)}
                      {ticket.owner_agent ? ` · ahora de ${ticket.owner_agent}` : " · sin agente"}
                    </span>
                  </button>
                </li>
              ))
            ))}
          {target?.kind === "initiative" &&
            (forInitiative.length === 0 ? (
              <li className="text-sm text-muted-foreground">No quedan tickets listos en esta iniciativa.</li>
            ) : (
              agents.map((agent) => (
                <li key={agent.slug}>
                  <button
                    type="button"
                    disabled={run.isPending}
                    onClick={() => run.mutate(forInitiative.map((ticket) => ({ ticket, agent: agent.slug })))}
                    className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2 text-left ring-1 ring-foreground/10 hover:bg-muted disabled:opacity-40"
                  >
                    <span className={cn("size-2.5 shrink-0 rounded-full", STATUS_DOT[agent.status] ?? "bg-status-idle")} aria-hidden />
                    <span className="grid min-w-0 flex-1">
                      <span className="truncate text-sm font-semibold">{agent.name}</span>
                      <span className="truncate text-xs text-muted-foreground">{agent.title}</span>
                    </span>
                  </button>
                </li>
              ))
            ))}
        </ul>
      </SheetContent>
    </Sheet>
  );
};
