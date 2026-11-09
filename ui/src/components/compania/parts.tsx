// PLA-I30 blocks still in use after PLA-I33: meters, the plan meter, the per-block error, banners, En marcha,
// the kill switch and the 5i stop sheet (in Máquina's plumbing and the project page). Presentational: data
// and actions come in as props, so tests render each one with fake data. Spend is tokens, never money.
import { cn } from "@/lib/utils";
import {
  budgetBannerText,
  capLine,
  clock,
  elapsed,
  fill,
  idleLine,
  meterTone,
  pausedBannerText,
  pct,
  planBannerText,
  planUnknownLine,
  roleInitials,
  roleWord,
  tokens,
  usedOfLimit,
  type Banner,
  type Budget,
  type CompanyPlan,
  type CompanyProjectRow,
  type CompanyRun,
  type Plumbed,
  type Tone,
} from "@/lib/compania";

export const panel = "rounded-[22px] bg-card ring-1 ring-foreground/10";
export const eyebrow = "text-[11px] font-bold tracking-[0.14em] text-muted-foreground uppercase";
export const heading = "font-display text-xl font-extrabold tracking-tight";
export const pillPrimary =
  "inline-flex min-h-10 shrink-0 items-center justify-center rounded-full bg-foreground px-4 text-sm font-semibold text-background hover:opacity-90 disabled:opacity-40";
export const pillGhost =
  "inline-flex min-h-10 shrink-0 items-center justify-center rounded-full px-4 text-sm ring-1 ring-foreground/15 hover:bg-muted disabled:opacity-40";
export const pillDanger =
  "inline-flex min-h-10 shrink-0 items-center justify-center rounded-full bg-status-blocked px-4 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40";

export const TONE_DOT: Record<Tone, string> = { ok: "bg-status-done", warn: "bg-status-now", stop: "bg-status-blocked", idle: "bg-status-idle" };
export const TONE_INK: Record<Tone, string> = { ok: "text-ink-done", warn: "text-ink-now", stop: "text-ink-blocked", idle: "text-muted-foreground" };
const TONE_BAR: Record<Tone, string> = { ok: "bg-status-ready", warn: "bg-status-now", stop: "bg-status-blocked", idle: "bg-status-idle" };

// ---- small pieces

export const Dot = ({ tone, live }: { tone: Tone; live?: boolean }) => (
  <span className={cn("relative inline-block size-2 shrink-0 rounded-full", TONE_DOT[tone])} aria-hidden>
    {live && <span className={cn("absolute inset-0 animate-ping rounded-full opacity-60", TONE_DOT[tone])} />}
  </span>
);

// A token meter: used against the weekly limit, with the 80% tick.
export const Meter = ({ budget, label, tick = 80, big }: { budget: Budget; label?: string; tick?: number | null; big?: boolean }) => {
  const tone = meterTone(budget);
  return (
    <div className="grid gap-1">
      {label && (
        <div className="flex items-baseline justify-between gap-2 text-xs">
          <span className="truncate text-muted-foreground">{label}</span>
          <span className={cn("shrink-0 font-mono tabular-nums", tone === "ok" ? "text-foreground" : TONE_INK[tone])}>{usedOfLimit(budget)}</span>
        </div>
      )}
      <div
        className={cn("relative overflow-hidden rounded-full bg-muted", big ? "h-2.5" : "h-1.5")}
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(fill(budget))}
        aria-label={`${label ?? "Tokens"}: ${usedOfLimit(budget)}`}
      >
        <div className={cn("h-full rounded-full", TONE_BAR[tone])} style={{ width: `${fill(budget)}%` }} />
        {tick != null && budget.limit != null && <span aria-hidden className="absolute inset-y-0 w-px bg-foreground/40" style={{ left: `${tick}%` }} />}
      </div>
    </div>
  );
};

// The 5-hour plan window: a big meter with the guard as a tick.
export const PlanMeter = ({ plan, timeZone }: { plan: CompanyPlan; timeZone?: string }) => {
  const value = plan.five_hour_pct;
  const tone: Tone = plan.state === "stopped" ? "stop" : plan.state === "warn" || plan.state === "unknown" ? "warn" : "ok";
  return (
    <div className="grid gap-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
        <span className="text-sm font-semibold">Ventana de 5 h del plan</span>
        <span className={cn("shrink-0 font-mono text-sm tabular-nums", TONE_INK[tone])}>
          {value == null ? "desconocido" : `${pct(value)}${plan.resets_at ? ` · se reinicia ${clock(plan.resets_at, timeZone)}` : ""}`}
        </span>
      </div>
      <div className="relative h-3 overflow-hidden rounded-full bg-muted" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={value ?? 0} aria-label="Ventana de 5 h del plan">
        <div className={cn("h-full rounded-full", TONE_BAR[tone])} style={{ width: `${Math.min(100, value ?? 0)}%` }} />
        <span aria-hidden className="absolute inset-y-0 w-0.5 bg-foreground/70" style={{ left: `${plan.guard_pct}%` }} />
      </div>
      <p className="text-xs text-muted-foreground">
        {plan.state === "unknown"
          ? planUnknownLine
          : `La raya es el guardia (${plan.guard_pct}%): arriba de ella no arranca nada nuevo y te queda plan para ti.`}
      </p>
    </div>
  );
};

// ---- 5c: one block failed. The others keep their last data.

export const BlockError = ({ what, onRetry }: { what: string; onRetry: () => void }) => (
  <div role="alert" className="grid gap-2 rounded-[20px] bg-status-blocked/10 p-4 ring-1 ring-status-blocked/40">
    <p className="text-sm font-semibold text-ink-blocked">No se pudo cargar {what}.</p>
    <p className="text-sm text-muted-foreground">Plania no responde. Si la Mac está dormida, nada corre hasta que despierte.</p>
    <div>
      <button type="button" className={pillGhost} onClick={onRetry}>
        Reintentar
      </button>
    </div>
  </div>
);

// ---- Banners (5e grey, 5g red, 5h amber)

export const Banners = ({
  banners,
  canEdit,
  timeZone,
  onResume,
  onRaise,
  onMoveGuard,
  onSeeSpend,
  dismissed,
  onDismiss,
}: {
  banners: Banner[];
  canEdit: boolean;
  timeZone?: string;
  onResume: () => void;
  onRaise: (project: CompanyProjectRow) => void;
  onMoveGuard: () => void;
  onSeeSpend: () => void;
  dismissed: Set<string>;
  onDismiss: (key: string) => void;
}) => {
  const shown = banners.filter((b) => !(b.kind === "budget" && dismissed.has(b.project.slug)));
  if (shown.length === 0) return null;
  return (
    <div className="grid gap-2.5">
      {shown.map((b) => {
        if (b.kind === "paused") {
          return (
            <section key="paused" role="status" data-banner="paused" className="flex flex-wrap items-center gap-3 rounded-[20px] bg-surface-sunken p-4 ring-1 ring-foreground/15">
              <Dot tone="idle" />
              <p className="min-w-0 flex-[1_1_240px] text-sm font-medium">{pausedBannerText(b.since, timeZone)}</p>
              <button type="button" className={pillPrimary} onClick={onResume}>
                Reanudar
              </button>
            </section>
          );
        }
        if (b.kind === "budget") {
          return (
            <section key={`budget-${b.project.slug}`} role="alert" data-banner="budget" className="flex flex-wrap items-center gap-3 rounded-[20px] bg-status-blocked/10 p-4 ring-1 ring-status-blocked/50">
              <span className="font-display text-3xl font-extrabold tracking-tight text-ink-blocked tabular-nums">{pct(b.project.budget.pct)}</span>
              <p className="min-w-0 flex-[1_1_260px] text-sm">{budgetBannerText(b.project).replace(/^[^·]+· /, "")}</p>
              <div className="flex flex-wrap gap-2">
                {canEdit && (
                  <button type="button" className={pillPrimary} onClick={() => onRaise(b.project)}>
                    Subir límite
                  </button>
                )}
                <button type="button" className={pillGhost} onClick={() => onDismiss(b.project.slug)}>
                  Dejarlo así
                </button>
              </div>
            </section>
          );
        }
        return (
          <section key="plan" role="status" data-banner="plan" className="flex flex-wrap items-center gap-3 rounded-[20px] bg-status-now/10 p-4 ring-1 ring-status-now/50">
            <span className="font-display text-3xl font-extrabold tracking-tight text-ink-now tabular-nums">{pct(b.plan.five_hour_pct)}</span>
            <p className="min-w-0 flex-[1_1_260px] text-sm">{planBannerText(b.plan, timeZone).replace(/^[^·]+· /, "")}</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={pillGhost} onClick={onSeeSpend}>
                Ver gasto
              </button>
              {canEdit && (
                <button type="button" className={pillPrimary} onClick={onMoveGuard}>
                  Mover guardia
                </button>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
};

// ---- Project cards (1a; LIB-0003: the same facts at the same places on every card)

// ---- En marcha (LIB-0032/33: live dot, short label, running clock)

const RunRow = ({ run, now, queued, projectTitle }: { run: CompanyRun; now: number; queued?: boolean; projectTitle: (slug: string) => string }) => (
  <li className={cn("flex items-center gap-3 border-b border-border px-4 py-2.5 last:border-0", queued && "opacity-60")} data-run={run.status}>
    <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted font-mono text-[11px] font-semibold">{roleInitials(run.role)}</span>
    <span className="grid min-w-0 flex-1 gap-0.5">
      <span className="truncate text-sm">
        <span className="font-semibold">{roleWord(run.role)}</span> · {projectTitle(run.project)}
        {run.ticket && (
          <>
            {" · "}
            <span className="font-mono text-xs">{run.ticket}</span>
          </>
        )}
      </span>
      <span className="truncate text-xs text-muted-foreground">
        {queued ? "En espera · arranca cuando se libere un lugar" : `Turno ${run.turns} · ${tokens(run.tokens)} tokens`}
      </span>
    </span>
    <span className="flex shrink-0 items-center gap-1.5 font-mono text-sm whitespace-nowrap tabular-nums">
      {!queued && <Dot tone="ok" live />}
      {queued ? "—" : elapsed(run.started_at, now)}
    </span>
  </li>
);

export const EnMarcha = ({ company, now, projectTitle }: { company: Plumbed; now: number; projectTitle: (slug: string) => string }) => (
  <section aria-labelledby="cia-marcha" className={cn(panel, "overflow-hidden")}>
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-4 py-3">
      <h2 id="cia-marcha" className={heading}>
        En marcha <span className="font-mono text-sm font-normal text-muted-foreground">{company.runs.live.length}</span>
      </h2>
      <span className="text-xs text-muted-foreground">{capLine(company)}</span>
    </div>
    {company.runs.live.length === 0 && company.runs.queued.length === 0 ? (
      <p className="px-4 py-6 text-sm text-muted-foreground">{idleLine(company)}</p>
    ) : (
      <ul>
        {company.runs.live.map((run) => (
          <RunRow key={run.id} run={run} now={now} projectTitle={projectTitle} />
        ))}
        {company.runs.queued.map((run) => (
          <RunRow key={run.id} run={run} now={now} queued projectTitle={projectTitle} />
        ))}
      </ul>
    )}
    {company.runs.live.length === 0 && company.runs.queued.length > 0 && <p className="px-4 pb-3 text-xs text-muted-foreground">{idleLine(company)}</p>}
  </section>
);

// ---- Gasto: tokens and % of the plan window, never money (Research R4, R7)

// ---- The company kill switch, at the bottom (the header pill is the second way in)

export const KillSwitch = ({ company, onStop, onResume }: { company: Plumbed; onStop: () => void; onResume: () => void }) => {
  const live = company.runs.live.length;
  if (company.company.paused) {
    return (
      <section aria-labelledby="cia-switch" className="grid gap-3 rounded-[22px] border-2 border-dashed border-foreground/20 p-5">
        <h2 id="cia-switch" className={heading}>
          La compañía está detenida
        </h2>
        <p className="text-sm text-muted-foreground">Nada arranca en ningún proyecto. Un proyecto pausado por su cuenta sigue en pausa al reanudar.</p>
        <div>
          <button type="button" className={pillPrimary} onClick={onResume}>
            Reanudar la compañía
          </button>
        </div>
      </section>
    );
  }
  return (
    <section aria-labelledby="cia-switch" className="grid gap-3 rounded-[22px] border-2 border-dashed border-status-blocked/50 p-5">
      <h2 id="cia-switch" className={heading}>
        La compañía está en marcha
      </h2>
      <p className="text-sm text-muted-foreground">
        Detenerla cierra {live === 1 ? "la corrida" : `las ${live} corridas`} con calma (terminan su paso) y no arranca nada nuevo en ningún proyecto hasta que la reanudes. No borra nada.
      </p>
      <div>
        <button type="button" className={pillDanger} onClick={onStop}>
          Detener la compañía
        </button>
      </div>
    </section>
  );
};

// ---- 5i: the stop confirmation (company or one project). No typing: it is reversible.

export const StopBody = ({
  scope,
  runs,
  projectTitle,
  onConfirm,
  onCancel,
  busy,
}: {
  scope: { kind: "company" } | { kind: "project"; slug: string; title: string };
  runs: CompanyRun[];
  projectTitle: (slug: string) => string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}) => {
  const affected = scope.kind === "company" ? runs : runs.filter((r) => r.project === scope.slug);
  const name = scope.kind === "company" ? "la compañía" : scope.title;
  return (
    <div className="grid gap-4" data-testid="stop-sheet">
      <ul className="grid gap-3 text-sm">
        <li className="grid gap-0.5">
          <span className="font-semibold">Se cierra</span>
          <span className="text-muted-foreground">
            {affected.length === 0
              ? "Nada corre ahora."
              : affected.map((r) => `${roleWord(r.role)} en ${projectTitle(r.project)}${r.ticket ? ` (${r.ticket})` : ""}`).join(" · ") + ": terminan su paso y se cierran."}
          </span>
        </li>
        <li className="grid gap-0.5">
          <span className="font-semibold">Deja de arrancar</span>
          <span className="text-muted-foreground">
            {scope.kind === "company" ? "Ningún proyecto arranca corridas, ni por evento ni por horario." : `${name} no arranca corridas, ni por evento ni por horario.`}
          </span>
        </li>
        <li className="grid gap-0.5">
          <span className="font-semibold">Se queda</span>
          <span className="text-muted-foreground">No se borra nada. La Bandeja, los merges y las decisiones siguen funcionando.</span>
        </li>
      </ul>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={pillDanger} onClick={onConfirm} disabled={busy}>
          {scope.kind === "company" ? "Detener la compañía" : `Pausar ${scope.title}`}
        </button>
        <button type="button" className={pillGhost} onClick={onCancel}>
          Seguir en marcha
        </button>
      </div>
    </div>
  );
};

// ---- Brief header line (Asistente signs it). The brief itself is ceo-v2's Brief.
