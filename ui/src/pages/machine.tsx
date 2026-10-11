import { useQuery } from "@tanstack/react-query";
import { BoxIcon, CableIcon, CheckIcon, CogIcon, CopyIcon, DatabaseIcon, GitBranchIcon, GlobeIcon, HardDriveIcon, LayersIcon, ServerIcon } from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState, type ComponentType, type KeyboardEvent } from "react";
import { Link, useSearchParams } from "react-router";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { hasProjectMark, ProjectMark } from "@/components/plania-mark";
import { Kicker, accentInk, projectAccent } from "@/components/plan/visuals";
import { api } from "@/lib/api";
import { SOURCE_WORD, STATE_WORD, ageSource, formatKb, groupItems, isPrimary, nameOf, sizeOf, whyLine, type Group, type TicketNode } from "@/lib/machine";
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

function CopyTeardown({ command, declared }: { command: string; declared: boolean }) {
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
    <div className="grid gap-0.5">
      <span className="px-0.5 text-[10.5px] text-muted-foreground">{declared ? "Comando declarado por quien lo creó" : "Comando sugerido; Plania no lo ejecuta"}</span>
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
    </div>
  );
}

function Row({ it, nowMs, showTicket }: { it: FootprintItem; nowMs: number; showTicket: boolean }) {
  const Icon = ICON[it.kind];
  const { name, detail } = nameOf(it);
  const size = sizeOf(it);
  const age = ageSource(it);
  const gone = it.state === "gone";
  const why = whyLine(it, nowMs);
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
          {isPrimary(it) && <Tag>principal</Tag>}
          {d.on_secondary_server === true && <Tag tone="warn">servidor secundario</Tag>}
          {it.kind === "worktree" && d.dirty === true && <Tag tone="warn">sin guardar</Tag>}
          {it.kind === "worktree" && d.merged === true && <Tag>integrada</Tag>}
        </div>
        <p className="text-xs text-muted-foreground">
          {meta.map((m, i) => <Fragment key={i}>{i > 0 && " · "}{m}</Fragment>)}
        </p>
        {why && <p className={cn("text-xs", it.state === "stale" ? "text-ink-now" : "text-muted-foreground")}>{why}</p>}
        {purpose && (
          <p className="text-sm">
            {purpose}
            {!it.purpose && it.lease && <span className="text-xs text-muted-foreground"> · puerto reservado por {it.lease.holder.agent}</span>}
          </p>
        )}
      </div>
      <StateBadge state={it.state} />
      {/* The command takes the whole row, under the icon too: it is the longest thing on it. */}
      {it.teardown && <div className="col-span-full"><CopyTeardown command={it.teardown} declared={it.source !== "observed"} /></div>}
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
          {g.kind === "project" &&
            (hasProjectMark(g.title) ? (
              <ProjectMark slug={g.title} className="size-5" />
            ) : (
              <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: a }} />
            ))}
          <h2 className="min-w-0 truncate font-display text-lg font-bold tracking-tight" style={g.kind === "project" ? { color: accentInk(a) } : undefined}>{g.title}</h2>
          {g.kind === "repo" && <Kicker className="text-muted-foreground">repo</Kicker>}
        </div>
        <span className="shrink-0 text-xs text-muted-foreground">{g.count === 1 ? "1 elemento" : `${g.count} elementos`}</span>
      </header>
      <ul className="divide-y">
        {/* Servers en uso lead the card; each still names its ticket. */}
        {g.servers.map((it) => <Row key={it.id} it={it} nowMs={nowMs} showTicket />)}
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

// What the audit finds about the Mac that no project audit holds: a short list under the header.
function Findings({ findings }: { findings: NonNullable<ReturnType<typeof useMachine>["data"]>["findings"] }) {
  if (!findings.length) return null;
  return (
    <section aria-label="Hallazgos" className="grid gap-2 rounded-xl border border-status-now/40 bg-status-now/8 px-4 py-3">
      <Kicker className="text-ink-now">{findings.length === 1 ? "1 hallazgo" : `${findings.length} hallazgos`}</Kicker>
      <ul className="grid gap-2">
        {findings.map((f, i) => (
          <li key={i} className="grid min-w-0 gap-0.5 text-sm">
            {/* Paths and commands have no spaces: let them wrap anywhere, or they widen the page on phones. */}
            <span className="wrap-anywhere"><span className="mr-2 font-mono text-[11px] font-semibold text-ink-now">{f.code}</span>{f.detail}</span>
            <span className="text-xs wrap-anywhere text-muted-foreground">{f.fix_hint}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

type TabId = "servidores" | "bases" | "worktrees" | "otros";
const TABS: { id: TabId; label: string; icon: ComponentType<{ className?: string }>; kinds: FootprintKind[]; empty: string }[] = [
  { id: "servidores", label: "Servidores activos", icon: ServerIcon, kinds: ["server"], empty: "Ningún servidor corriendo." },
  { id: "bases", label: "Bases de datos", icon: DatabaseIcon, kinds: ["database", "db_server"], empty: "Ninguna base de datos." },
  { id: "worktrees", label: "Worktrees", icon: GitBranchIcon, kinds: ["worktree"], empty: "Ningún worktree." },
  // Services, browsers, containers, tunnels and caches: few, but they should not vanish.
  { id: "otros", label: "Otros", icon: CogIcon, kinds: ["service", "browser", "container", "tunnel", "cache"], empty: "Nada más." },
];

function Tabs({ active, counts, onChange }: { active: TabId; counts: Record<TabId, number>; onChange: (id: TabId) => void }) {
  const refs = useRef<Partial<Record<TabId, HTMLButtonElement | null>>>({});
  // Arrow keys move between tabs (roving tabindex), as a tablist should.
  function onKeyDown(e: KeyboardEvent) {
    const i = TABS.findIndex((t) => t.id === active);
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    const to = e.key === "Home" ? TABS[0] : e.key === "End" ? TABS[TABS.length - 1] : step ? TABS[(i + step + TABS.length) % TABS.length] : null;
    if (!to) return;
    e.preventDefault();
    onChange(to.id);
    refs.current[to.id]?.focus();
  }
  return (
    <div role="tablist" aria-label="Qué ver" onKeyDown={onKeyDown} className="grid w-full grid-cols-2 gap-1 rounded-[22px] border bg-card p-1 sm:flex sm:w-fit sm:flex-wrap sm:rounded-full">
      {TABS.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          ref={(el) => { refs.current[id] = el; }}
          id={`tab-${id}`}
          type="button"
          role="tab"
          aria-selected={active === id}
          aria-controls={`panel-${id}`}
          tabIndex={active === id ? 0 : -1}
          onClick={() => onChange(id)}
          className={cn(
            "inline-flex min-h-9 items-center justify-center gap-1.5 rounded-full px-3.5 text-[13px] font-medium transition focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:justify-start",
            active === id ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Icon className="size-3.5" aria-hidden />
          {label}
          <span className={cn("rounded-full px-1.5 font-mono text-[11px]", active === id ? "bg-background/15" : "bg-foreground/[0.08]")}>{counts[id]}</span>
        </button>
      ))}
    </div>
  );
}

function useMachine() {
  return useQuery({ queryKey: ["machine"], queryFn: api.machine, staleTime: 15_000 });
}

export function MachinePage() {
  const machine = useMachine();
  const nowMs = useNow();
  const [params, setParams] = useSearchParams();
  const tab = TABS.find((t) => t.id === params.get("tab")) ?? TABS[0]!;
  // Stopped things wait a day before they are released; hidden unless asked for.
  const [showGone, setShowGone] = useState(false);
  const items = useMemo(() => machine.data?.items ?? [], [machine.data]);
  const counts = useMemo(
    () => Object.fromEntries(TABS.map((t) => [t.id, items.filter((i) => t.kinds.includes(i.kind) && i.state !== "gone").length])) as Record<TabId, number>,
    [items],
  );
  const inTab = useMemo(() => items.filter((i) => tab.kinds.includes(i.kind)), [items, tab]);
  const gone = inTab.filter((i) => i.state === "gone").length;
  const groups = useMemo(() => groupItems(showGone ? inTab : inTab.filter((i) => i.state !== "gone")), [inTab, showGone]);

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

      {machine.data && <Findings findings={machine.data.findings ?? []} />}

      {machine.isPending && (
        <div className="grid gap-4">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-40 rounded-xl" />)}
        </div>
      )}
      {machine.isError && <p className="text-sm text-destructive">No se pudo cargar la máquina.</p>}
      {machine.data && items.length === 0 && (
        <p className="text-sm text-muted-foreground">Todavía no se ha visto nada. El servicio local revisa la Mac cada minuto.</p>
      )}
      {machine.data && items.length > 0 && (
        <div className="grid gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Tabs active={tab.id} counts={counts} onChange={(id) => setParams(id === TABS[0]!.id ? {} : { tab: id }, { replace: true })} />
            {gone > 0 && (
              <button
                type="button"
                aria-pressed={showGone}
                onClick={() => setShowGone((v) => !v)}
                className="min-h-9 rounded-full px-3 text-xs font-medium text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                {showGone ? "Ocultar detenidos" : `Mostrar ${gone} ${gone === 1 ? "detenido" : "detenidos"}`}
              </button>
            )}
          </div>
          <div role="tabpanel" id={`panel-${tab.id}`} aria-labelledby={`tab-${tab.id}`}>
            {groups.length === 0 ? (
              <p className="rounded-xl border border-dashed px-4 py-6 text-sm text-muted-foreground">{tab.empty}</p>
            ) : (
              <div className="grid items-start gap-4 xl:grid-cols-2">
                {groups.map((g) => <GroupCard key={g.id} g={g} nowMs={nowMs} />)}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
