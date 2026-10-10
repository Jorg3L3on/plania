import { useQuery } from "@tanstack/react-query";
import { BoxIcon, CableIcon, CheckIcon, CogIcon, CopyIcon, DatabaseIcon, GitBranchIcon, GlobeIcon, HardDriveIcon, LayersIcon, ServerIcon } from "lucide-react";
import { Fragment, useEffect, useMemo, useState, type ComponentType } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Kicker, accentInk, projectAccent } from "@/components/plan/visuals";
import { api } from "@/lib/api";
import { SOURCE_WORD, STATE_WORD, ageSource, formatKb, groupItems, nameOf, sizeOf, type Group, type TicketNode } from "@/lib/machine";
import { ago, span } from "@/lib/time";
import type { FootprintItem, FootprintKind, FootprintState } from "@/lib/types";
import { cn } from "@/lib/utils";

// What runs and is stored on this Mac for agent work, from the machine job (observed) and from
// register_footprint (declared). Read-only: it shows the teardown command, it never runs one.

const ICON: Record<FootprintKind, ComponentType<{ className?: string }>> = {
  worktree: GitBranchIcon,
  server: ServerIcon,
  db_server: HardDriveIcon,
  database: DatabaseIcon,
  container: BoxIcon,
  browser: GlobeIcon,
  tunnel: CableIcon,
  service: CogIcon,
  cache: LayersIcon,
};
const KIND_WORD: Record<FootprintKind, string> = {
  worktree: "worktree",
  server: "servidor",
  db_server: "servidor de bases",
  database: "base de datos",
  container: "contenedor",
  browser: "navegador",
  tunnel: "túnel",
  service: "servicio",
  cache: "caché",
};

// Literal class names so Tailwind generates every one.
const STATE_CLASS: Record<FootprintState, string> = {
  live: "bg-status-done/12 text-ink-done",
  orphan: "bg-status-jorge/14 text-ink-jorge",
  stale: "bg-status-now/16 text-ink-now",
  ghost: "bg-status-pending/25 text-muted-foreground",
  gone: "bg-muted text-muted-foreground",
  released: "bg-muted text-muted-foreground",
  self: "bg-status-review/12 text-ink-review",
  system: "bg-status-ready/12 text-ink-ready",
};

// Re-render now and then so "hace 5 min" keeps moving without a refetch.
function useNow(everyMs = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}

function StateBadge({ state }: { state: FootprintState }) {
  return (
    <span className={cn("inline-flex h-5 shrink-0 items-center rounded-full px-2 text-[11px] font-semibold whitespace-nowrap", STATE_CLASS[state])}>
      {STATE_WORD[state]}
    </span>
  );
}

function Tag({ children, tone }: { children: React.ReactNode; tone?: "warn" }) {
  return (
    <span className={cn("inline-flex h-4.5 items-center rounded-full border px-1.5 text-[10.5px] font-medium whitespace-nowrap", tone === "warn" ? "border-status-now/50 text-ink-now" : "text-muted-foreground")}>
      {children}
    </span>
  );
}

function CopyTeardown({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("No se pudo copiar.");
    }
  }
  const Icon = copied ? CheckIcon : CopyIcon;
  return (
    <div className="flex items-start gap-1 rounded-lg bg-surface-sunken py-1 pr-1 pl-2.5">
      <code className="min-w-0 flex-1 py-0.5 font-mono text-xs leading-5 break-all whitespace-pre-wrap">{command}</code>
      <button
        type="button"
        onClick={() => void copy()}
        aria-label="Copiar el comando"
        className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:bg-background hover:text-foreground"
      >
        <Icon className="size-3.5" />
      </button>
    </div>
  );
}

function Row({ it, nowMs, showTicket }: { it: FootprintItem; nowMs: number; showTicket: boolean }) {
  const Icon = ICON[it.kind];
  const { name, detail } = nameOf(it);
  const size = sizeOf(it);
  const age = ageSource(it);
  const gone = it.state === "gone";
  const purpose = it.purpose || it.lease?.purpose || "";
  const holder = it.holder ?? it.lease?.holder ?? null;
  const d = it.details;
  const session = it.session_id ?? holder?.session_id ?? null;
  const meta: React.ReactNode[] = [];
  if (gone && it.last_seen_at) meta.push(<span key="seen">visto por última vez {ago(it.last_seen_at, nowMs)}</span>);
  else if (age) meta.push(<span key="age">{age.label === "activo" ? `activo ${span(age.iso, nowMs)}` : `${age.label} ${ago(age.iso, nowMs)}`}</span>);
  if (size) meta.push(<span key="size" className="font-medium text-foreground/80">{size}</span>);
  if (showTicket && it.task_key && it.project) {
    meta.push(
      <span key="task" className="min-w-0">
        <Link to={`/p/${it.project}?task=${encodeURIComponent(it.task_key)}`} className="font-mono underline-offset-4 hover:underline">{it.task_key}</Link>
        {it.task_title ? ` ${it.task_title}` : ""}
      </span>,
    );
  }
  if (session) meta.push(<span key="session" className="font-mono">{holder?.agent ? `${holder.agent} · ` : ""}{session.length > 14 ? `${session.slice(0, 8)}…` : session}</span>);
  meta.push(<span key="source">{SOURCE_WORD[it.source]}</span>);

  return (
    <li className={cn("grid grid-cols-[auto_1fr_auto] gap-x-3 gap-y-1.5 px-4 py-3", gone && "opacity-60")}>
      <span className="mt-0.5 inline-flex size-8 items-center justify-center rounded-lg bg-surface-sunken text-muted-foreground" title={KIND_WORD[it.kind]}>
        <Icon className="size-4" />
        <span className="sr-only">{KIND_WORD[it.kind]}</span>
      </span>
      <div className="grid min-w-0 gap-1.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={cn("min-w-0 font-medium break-all", it.kind === "server" && "font-mono")}>{name}</span>
          {detail && <span className="min-w-0 text-sm break-all text-muted-foreground">{detail}</span>}
          {it.kind === "worktree" && d.dirty === true && <Tag tone="warn">sin guardar</Tag>}
          {it.kind === "worktree" && d.merged === true && <Tag>integrada</Tag>}
        </div>
        <p className="text-xs text-muted-foreground">
          {meta.map((m, i) => <Fragment key={i}>{i > 0 && " · "}{m}</Fragment>)}
        </p>
        {purpose && (
          <p className="text-sm">
            {purpose}
            {!it.purpose && it.lease && <span className="text-xs text-muted-foreground"> · puerto reservado por {it.lease.holder.agent}</span>}
          </p>
        )}
      </div>
      <StateBadge state={it.state} />
      {/* The command takes the whole row, under the icon too: it is the longest thing on it. */}
      {it.teardown && <div className="col-span-full"><CopyTeardown command={it.teardown} /></div>}
    </li>
  );
}

function SubHeader({ k, title, depth }: { k: string; title: string; depth: 0 | 1 }) {
  return (
    <li className={cn("flex min-w-0 items-baseline gap-2 border-t bg-surface-sunken/60 px-4 py-1.5 text-xs", depth === 1 && "pl-7")}>
      <span className="shrink-0 font-mono font-semibold whitespace-nowrap">{k}</span>
      <span className="min-w-0 truncate text-muted-foreground">{title}</span>
    </li>
  );
}

function TicketRows({ t, nowMs, depth }: { t: TicketNode; nowMs: number; depth: 0 | 1 }) {
  return (
    <>
      <SubHeader k={t.key} title={t.title} depth={depth} />
      {t.items.map((it) => <Row key={it.id} it={it} nowMs={nowMs} showTicket={false} />)}
    </>
  );
}

function GroupCard({ g, nowMs }: { g: Group; nowMs: number }) {
  const [a] = projectAccent(g.title);
  const flat = g.kind !== "project";
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <header className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          {g.kind === "project" && <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: a }} />}
          <h2 className="min-w-0 truncate font-display text-lg font-bold tracking-tight" style={g.kind === "project" ? { color: accentInk(a) } : undefined}>{g.title}</h2>
          {g.kind === "repo" && <Kicker className="text-muted-foreground">repo</Kicker>}
        </div>
        <span className="shrink-0 text-xs text-muted-foreground">{g.count === 1 ? "1 elemento" : `${g.count} elementos`}</span>
      </header>
      <ul className="divide-y">
        {g.items.map((it) => <Row key={it.id} it={it} nowMs={nowMs} showTicket={flat} />)}
        {g.tickets.map((t) => <TicketRows key={t.key} t={t} nowMs={nowMs} depth={0} />)}
        {g.initiatives.map((i) => (
          <Fragment key={i.key}>
            <SubHeader k={i.key} title={i.title} depth={0} />
            {i.items.map((it) => <Row key={it.id} it={it} nowMs={nowMs} showTicket={false} />)}
            {i.tickets.map((t) => <TicketRows key={t.key} t={t} nowMs={nowMs} depth={1} />)}
          </Fragment>
        ))}
      </ul>
    </Card>
  );
}

function Totals({ machine }: { machine: NonNullable<ReturnType<typeof useMachine>["data"]> }) {
  const t = machine.totals;
  const pill = "inline-flex items-center gap-2 rounded-full px-3 py-2";
  return (
    <ul className="flex flex-wrap gap-2.5 text-xs font-semibold">
      <li className={cn(pill, "bg-status-done/12 text-ink-done")}>{t.servers === 1 ? "1 servidor" : `${t.servers} servidores`}</li>
      <li className={cn(pill, "bg-status-ready/12 text-ink-ready")}>{t.databases === 1 ? "1 base de datos" : `${t.databases} bases de datos`}</li>
      <li className={cn(pill, "bg-muted text-foreground/80")}>{formatKb(t.worktree_kb)} en worktrees</li>
      {t.orphan > 0 && <li className={cn(pill, "bg-status-jorge/14 text-ink-jorge")}>{t.orphan} sin dueño</li>}
      {t.stale > 0 && <li className={cn(pill, "bg-status-now/16 text-ink-now")}>{t.stale === 1 ? "1 obsoleto" : `${t.stale} obsoletos`}</li>}
    </ul>
  );
}

function useMachine() {
  return useQuery({ queryKey: ["machine"], queryFn: api.machine, staleTime: 15_000 });
}

export function MachinePage() {
  const machine = useMachine();
  const nowMs = useNow();
  const groups = useMemo(() => groupItems(machine.data?.items ?? []), [machine.data]);

  return (
    <div className="grid gap-8">
      <header className="flex animate-rise flex-wrap items-end justify-between gap-6">
        <div className="grid gap-2.5">
          <Kicker className="text-muted-foreground">Máquina</Kicker>
          <h1 className="font-display text-4xl leading-[0.95] font-extrabold tracking-[-0.03em] sm:text-5xl">¿Qué hay corriendo?</h1>
          {machine.data && <p className="text-[15px] break-all text-muted-foreground">{machine.data.machine}</p>}
        </div>
        {machine.data && <Totals machine={machine.data} />}
      </header>

      {machine.isPending && (
        <div className="grid gap-4">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-40 rounded-xl" />)}
        </div>
      )}
      {machine.isError && <p className="text-sm text-destructive">No se pudo cargar la máquina.</p>}
      {machine.data && groups.length === 0 && (
        <p className="text-sm text-muted-foreground">Todavía no se ha visto nada. El servicio local revisa la Mac cada minuto.</p>
      )}
      {machine.data && groups.length > 0 && (
        <div className="grid items-start gap-4 xl:grid-cols-2">
          {groups.map((g) => <GroupCard key={g.id} g={g} nowMs={nowMs} />)}
        </div>
      )}
    </div>
  );
}
