import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { StopBody } from "@/components/compania/parts";
import { PlumbingMissing, PlumbingSection } from "@/components/compania/plumbing";
import { LimitForm, OWNER_CODE_WORDS, OwnerCodeRow, limitTitle, type LimitTarget } from "@/components/compania/sheets";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { MachinePlumbing } from "@/lib/api";
import { BoxIcon, CableIcon, CogIcon, DatabaseIcon, GitBranchIcon, GlobeIcon, HardDriveIcon, LayersIcon, ServerIcon } from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState, type ComponentType, type KeyboardEvent } from "react";
import { Link, useSearchParams } from "react-router";
import { Card } from "@/components/ui/card";
import { CopyCommand } from "@/components/copy-command";
import { Skeleton } from "@/components/ui/skeleton";
import { hasProjectMark, ProjectMark } from "@/components/plania-mark";
import { Kicker, accentInk, projectAccent } from "@/components/plan/visuals";
import { ApiError, api } from "@/lib/api";
import { SOURCE_WORD, STATE_WORD, ageSource, formatKb, groupItems, isPrimary, nameOf, sizeOf, whyLine, type Group, type TicketNode } from "@/lib/machine";
import { ago, span } from "@/lib/time";
import type { FootprintItem, FootprintKind, FootprintState, MachineBackup } from "@/lib/types";
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
  return <CopyCommand command={command} caption={declared ? "Comando declarado por quien lo creó" : "Comando sugerido; Plania no lo ejecuta"} />;
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

const BACKUP_STALE_MS = 48 * 3600_000;

function formatBytes(n: number): string {
  if (n >= 1024 * 1024 * 1024) return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

// The nightly pg_dump: one quiet line, red when the last attempt failed or the last copy is over 48 h old.
function BackupLine({ backup, nowMs }: { backup: MachineBackup | undefined; nowMs: number }) {
  if (!backup) return null;
  const stale = !backup.at || nowMs - new Date(backup.at).getTime() > BACKUP_STALE_MS;
  const bad = Boolean(backup.error) || (stale && Boolean(backup.attempted_at));
  const copy = backup.at ? `Última copia: ${ago(backup.at, nowMs)}${backup.bytes ? `, ${formatBytes(backup.bytes)}` : ""}` : "Sin copias todavía";
  return (
    <p className={cn("text-[13px] wrap-anywhere", bad ? "font-medium text-destructive" : "text-muted-foreground")} title={backup.path ?? undefined}>
      {copy}
      {backup.error && ` · falló ${backup.attempted_at ? ago(backup.attempted_at, nowMs) : ""}: ${backup.error}`}
    </p>
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
  // PLA-I33-3: the same GET /api/machine, read with its plumbing.
  return useQuery({ queryKey: ["machine"], queryFn: api.machinePlumbing, staleTime: 15_000, refetchInterval: 20_000 });
}

type StopScope = { kind: "company" } | { kind: "project"; slug: string; title: string };

// PLA-I33-3: budgets, plan guard, switches, En marcha and the run log, with their Jorge-only writes
// (the PLA-I30 routes under /api/company, cookie session only).
function Plumbing({ plumbing, nowMs }: { plumbing: MachinePlumbing; nowMs: number }) {
  const client = useQueryClient();
  const [stop, setStop] = useState<StopScope | null>(null);
  const [limit, setLimit] = useState<LimitTarget | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const canEdit = plumbing.viewer?.can_edit_limits ?? true;
  // PLA-I36-11: the owner's code.
  const owner = useQuery({ queryKey: ["owner-code"], queryFn: api.ownerCode, staleTime: 60_000 });
  const enrol = useMutation({
    mutationFn: api.enrolOwnerCode,
    onSuccess: () => void client.invalidateQueries({ queryKey: ["owner-code"] }),
  });
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["machine"] });
    void client.invalidateQueries({ queryKey: ["company"] });
  };
  const titles = new Map(plumbing.budgets.projects.map((p) => [p.slug, p.title]));
  const companySwitch = useMutation({
    mutationFn: (paused: boolean) => api.setCompanyPaused(paused),
    onSuccess: (r) => {
      toast(r.paused ? `Compañía detenida${r.stopped ? ` · ${r.stopped} corridas cerrándose` : ""}` : "Compañía en marcha");
      setStop(null);
      refresh();
    },
    onError: () => toast.error("No se pudo cambiar el interruptor"),
  });
  const projectSwitch = useMutation({
    mutationFn: ({ slug, paused }: { slug: string; paused: boolean }) => api.setProjectPaused(slug, paused),
    onSuccess: (r) => {
      toast(r.paused ? `${titles.get(r.project) ?? r.project} en pausa` : `${titles.get(r.project) ?? r.project} reanudado`);
      setStop(null);
      refresh();
    },
    onError: () => toast.error("No se pudo cambiar el interruptor del proyecto"),
  });
  const saveLimit = useMutation({
    mutationFn: async ({ target, value, code }: { target: LimitTarget; value: number | null; code?: string }) => {
      if (target.kind === "guard") return api.setRunnerSettings({ plan_guard_pct: value ?? target.current });
      if (target.kind === "asistente") return api.setRunnerSettings({ asistente_weekly_limit: value, code });
      if (target.kind === "project") return api.setBudget({ scope: "project", project: target.slug, weekly_limit: value, code });
      throw new Error("per-role limits are retired");
    },
    onSuccess: () => {
      toast("Guardado");
      setLimit(null);
      refresh();
    },
    onError: (e) => toast.error(e instanceof ApiError && OWNER_CODE_WORDS[e.code] ? OWNER_CODE_WORDS[e.code]! : "No se pudo guardar"),
  });
  return (
    <>
      <OwnerCodeRow
        enrolled={owner.data?.enrolled ?? null}
        busy={enrol.isPending}
        secret={enrol.data ?? null}
        error={enrol.error instanceof ApiError ? (enrol.error.code === "INVALID_PASSWORD" ? "Contraseña incorrecta." : (OWNER_CODE_WORDS[enrol.error.code] ?? `No se pudo (${enrol.error.code}).`)) : null}
        onEnrol={(input) => enrol.mutate(input)}
      />
      <PlumbingSection
        plumbing={plumbing}
        now={nowMs}
        canEdit={canEdit}
        dismissed={dismissed}
        onDismiss={(slug) => setDismissed(new Set([...dismissed, slug]))}
        onEditProject={(p) => setLimit({ kind: "project", slug: p.slug, title: p.title, current: p.budget.limit })}
        onEditAsistente={() => setLimit({ kind: "asistente", current: plumbing.budgets.asistente.limit })}
        onMoveGuard={() => setLimit({ kind: "guard", current: plumbing.plan.guard_pct })}
        onStopCompany={() => setStop({ kind: "company" })}
        onResumeCompany={() => companySwitch.mutate(false)}
        onPauseProject={(p) => setStop({ kind: "project", slug: p.slug, title: p.title })}
        onResumeProject={(p) => projectSwitch.mutate({ slug: p.slug, paused: false })}
      />
      {/* 5i: stop the company or pause a project */}
      <Sheet open={stop !== null} onOpenChange={(open) => !open && setStop(null)}>
        <SheetContent side="bottom" className="mx-auto max-h-[85svh] w-full max-w-xl overflow-y-auto rounded-t-[22px] bg-background">
          <SheetHeader className="pr-10">
            <SheetTitle className="font-display text-2xl font-extrabold tracking-tight">
              {stop?.kind === "project" ? `¿Pausar ${stop.title}?` : "¿Detener la compañía?"}
            </SheetTitle>
            <SheetDescription>Se puede deshacer: reanudas cuando quieras.</SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-8">
            {stop && (
              <StopBody
                scope={stop}
                runs={plumbing.runs.live}
                projectTitle={(slug) => titles.get(slug) ?? slug}
                busy={companySwitch.isPending || projectSwitch.isPending}
                onCancel={() => setStop(null)}
                onConfirm={() => (stop.kind === "company" ? companySwitch.mutate(true) : projectSwitch.mutate({ slug: stop.slug, paused: true }))}
              />
            )}
          </div>
        </SheetContent>
      </Sheet>
      <Dialog open={limit !== null} onOpenChange={(open) => !open && setLimit(null)}>
        <DialogContent className="bg-background sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-display text-xl font-extrabold tracking-tight">{limit ? limitTitle(limit) : ""}</DialogTitle>
            <DialogDescription>Solo tú cambias límites. Los agentes no pueden.</DialogDescription>
          </DialogHeader>
          {limit && <LimitForm target={limit} busy={saveLimit.isPending} onCancel={() => setLimit(null)} onSave={(value, code) => saveLimit.mutate({ target: limit, value, code })} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

export function MachinePage() {
  const machine = useMachine();
  // En marcha's clocks tick by the second only while something runs.
  const nowMs = useNow(machine.data?.plumbing?.runs.live.length ? 1000 : 30_000);
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
          {machine.data && <BackupLine backup={machine.data.backup} nowMs={nowMs} />}
        </div>
        {machine.data && <Totals machine={machine.data} />}
      </header>

      {machine.data && (machine.data.plumbing ? <Plumbing plumbing={machine.data.plumbing} nowMs={nowMs} /> : <PlumbingMissing />)}

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
