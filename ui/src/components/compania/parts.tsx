// PLA-I30 blocks still in use after PLA-I33: meters, the plan meter, the per-block error, banners, En marcha,
// the kill switch and the 5i stop sheet (in Máquina's plumbing and the project page). Presentational: data
// and actions come in as props, so tests render each one with fake data. Spend is tokens, never money.
import { cn } from "@/lib/utils";
import {
  capLine,
  clock,
  elapsed,
  idleLine,
  pausedBannerText,
  pct,
  planBannerText,
  planUnknownText,
  roleInitials,
  roleWord,
  tokens,
  type Banner,
  type CompanyPlan,
  type CompanyRun,
  type Plumbed,
  type Tone,
} from "@/lib/compania";
import { getLanguage, words, type Language } from "@/lib/i18n";
import { COMPANIA_PARTS } from "@/lib/compania-words";

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

// The 5-hour plan window: a big meter with the guard as a tick.
export const PlanMeter = ({ plan, timeZone }: { plan: CompanyPlan; timeZone?: string }) => {
  const w = words(COMPANIA_PARTS);
  const value = plan.five_hour_pct;
  const tone: Tone = plan.state === "stopped" ? "stop" : plan.state === "warn" || plan.state === "unknown" ? "warn" : "ok";
  return (
    <div className="grid gap-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
        <span className="text-sm font-semibold">{w.planWindow}</span>
        <span className={cn("shrink-0 font-mono text-sm tabular-nums", TONE_INK[tone])}>
          {value == null ? w.unknown : `${pct(value)}${plan.resets_at ? w.resets(clock(plan.resets_at, timeZone)) : ""}`}
        </span>
      </div>
      <div className="relative h-3 overflow-hidden rounded-full bg-muted" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={value ?? 0} aria-label={w.planWindow}>
        <div className={cn("h-full rounded-full", TONE_BAR[tone])} style={{ width: `${Math.min(100, value ?? 0)}%` }} />
        <span aria-hidden className="absolute inset-y-0 w-0.5 bg-foreground/70" style={{ left: `${plan.guard_pct}%` }} />
      </div>
      <p className="text-xs text-muted-foreground">
        {plan.state === "unknown"
          ? planUnknownText()
          : w.guardLine(plan.guard_pct)}
      </p>
    </div>
  );
};

// ---- 5c: one block failed. The others keep their last data.

export const BlockError = ({ what, onRetry }: { what: string; onRetry: () => void }) => {
  const w = words(COMPANIA_PARTS);
  return (
  <div role="alert" className="grid gap-2 rounded-[20px] bg-status-blocked/10 p-4 ring-1 ring-status-blocked/40">
    <p className="text-sm font-semibold text-ink-blocked">{w.couldNotLoad(what)}</p>
    <p className="text-sm text-muted-foreground">{w.noAnswer}</p>
    <div>
      <button type="button" className={pillGhost} onClick={onRetry}>
        {w.retry}
      </button>
    </div>
  </div>
  );
};

// ---- Banners (5e grey, 5h amber). PLA-21: no budget banner.

export const Banners = ({
  banners,
  canEdit,
  timeZone,
  onResume,
  onMoveGuard,
  onSeeSpend,
}: {
  banners: Banner[];
  canEdit: boolean;
  timeZone?: string;
  onResume: () => void;
  onMoveGuard: () => void;
  onSeeSpend: () => void;
}) => {
  const w = words(COMPANIA_PARTS);
  if (banners.length === 0) return null;
  return (
    <div className="grid gap-2.5">
      {banners.map((b) => {
        if (b.kind === "paused") {
          return (
            <section key="paused" role="status" data-banner="paused" className="flex flex-wrap items-center gap-3 rounded-[20px] bg-surface-sunken p-4 ring-1 ring-foreground/15">
              <Dot tone="idle" />
              <p className="min-w-0 flex-[1_1_240px] text-sm font-medium">{pausedBannerText(b.since, timeZone)}</p>
              <button type="button" className={pillPrimary} onClick={onResume}>
                {w.resume}
              </button>
            </section>
          );
        }
        return (
          <section key="plan" role="status" data-banner="plan" className="flex flex-wrap items-center gap-3 rounded-[20px] bg-status-now/10 p-4 ring-1 ring-status-now/50">
            <span className="font-display text-3xl font-extrabold tracking-tight text-ink-now tabular-nums">{pct(b.plan.five_hour_pct)}</span>
            <p className="min-w-0 flex-[1_1_260px] text-sm">{planBannerText(b.plan, timeZone).replace(/^[^·]+· /, "")}</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={pillGhost} onClick={onSeeSpend}>
                {w.seeSpend}
              </button>
              {canEdit && (
                <button type="button" className={pillPrimary} onClick={onMoveGuard}>
                  {w.moveGuard}
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

const RunRow = ({ run, now, queued, projectTitle }: { run: CompanyRun; now: number; queued?: boolean; projectTitle: (slug: string) => string }) => {
  const w = words(COMPANIA_PARTS);
  return (
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
        {queued ? w.queued : w.turn(run.turns, tokens(run.tokens))}
      </span>
    </span>
    <span className="flex shrink-0 items-center gap-1.5 font-mono text-sm whitespace-nowrap tabular-nums">
      {!queued && <Dot tone="ok" live />}
      {queued ? "—" : elapsed(run.started_at, now)}
    </span>
  </li>
  );
};

export const EnMarcha = ({ company, now, projectTitle }: { company: Plumbed; now: number; projectTitle: (slug: string) => string }) => (
  <section aria-labelledby="cia-marcha" className={cn(panel, "overflow-hidden")}>
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-4 py-3">
      <h2 id="cia-marcha" className={heading}>
        {words(COMPANIA_PARTS).running} <span className="font-mono text-sm font-normal text-muted-foreground">{company.runs.live.length}</span>
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
  const w = words(COMPANIA_PARTS);
  const live = company.runs.live.length;
  if (company.company.paused) {
    return (
      <section aria-labelledby="cia-switch" className="grid gap-3 rounded-[22px] border-2 border-dashed border-foreground/20 p-5">
        <h2 id="cia-switch" className={heading}>
          {w.companyStopped}
        </h2>
        <p className="text-sm text-muted-foreground">{w.stoppedLead}</p>
        <div>
          <button type="button" className={pillPrimary} onClick={onResume}>
            {w.resumeCompany}
          </button>
        </div>
      </section>
    );
  }
  return (
    <section aria-labelledby="cia-switch" className="grid gap-3 rounded-[22px] border-2 border-dashed border-status-blocked/50 p-5">
      <h2 id="cia-switch" className={heading}>
        {w.companyRunning}
      </h2>
      <p className="text-sm text-muted-foreground">
        {w.stopLead(live)}
      </p>
      <div>
        <button type="button" className={pillDanger} onClick={onStop}>
          {w.stopCompany}
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
  const w = words(COMPANIA_PARTS);
  const affected = scope.kind === "company" ? runs : runs.filter((r) => r.project === scope.slug);
  const name = scope.kind === "company" ? w.theCompany : scope.title;
  return (
    <div className="grid gap-4" data-testid="stop-sheet">
      <ul className="grid gap-3 text-sm">
        <li className="grid gap-0.5">
          <span className="font-semibold">{w.closes}</span>
          <span className="text-muted-foreground">
            {affected.length === 0
              ? w.nothingRuns
              : affected.map((r) => `${w.runIn(roleWord(r.role), projectTitle(r.project))}${r.ticket ? ` (${r.ticket})` : ""}`).join(" · ") + w.finishStep}
          </span>
        </li>
        <li className="grid gap-0.5">
          <span className="font-semibold">{w.stopsStarting}</span>
          <span className="text-muted-foreground">
            {scope.kind === "company" ? w.noProjectStarts : w.projectStops(name)}
          </span>
        </li>
        <li className="grid gap-0.5">
          <span className="font-semibold">{w.stays}</span>
          <span className="text-muted-foreground">{w.staysLine}</span>
        </li>
      </ul>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={pillDanger} onClick={onConfirm} disabled={busy}>
          {scope.kind === "company" ? w.stopCompany : w.pauseProject(scope.title)}
        </button>
        <button type="button" className={pillGhost} onClick={onCancel}>
          {w.keepRunning}
        </button>
      </div>
    </div>
  );
};

// ---- Brief header line (Asistente signs it). The brief itself is ceo-v2's Brief.

// PLA-I42-5: "Brief de hoy" when the Morning brief's lines are from today in the screen's zone, else "Último brief".
const dayIn = (ms: number, timeZone: string) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
export const briefTitle = (generatedAt: string, now: number, timeZone: string, language: Language = getLanguage()): string =>
  dayIn(Date.parse(generatedAt), timeZone) === dayIn(now, timeZone) ? words(COMPANIA_PARTS, language).briefToday : words(COMPANIA_PARTS, language).lastBrief;
// PLA-I2-10: a constant other files read; the language is fixed for the page load.
export const BRIEF_LINK_LABEL = words(COMPANIA_PARTS).briefLink;
