// PLA-I33-3: the plumbing that left Compañía lives in Máquina (ADR 31c1cead): the week's tokens per team
// and for Asistente (shown only: PLA-21 removed the budgets), the plan guard (Mover guardia), the company
// and project switches (with the 5i confirm sheet), En marcha and the run log.
// Presentational: data and actions are props, so test/compania-org.test.ts renders it with fake data.
// Tokens, never money.
import { cn } from "@/lib/utils";
import { bannersOf, tokens, type CompanyProjectRow, type RunBrief } from "@/lib/compania";
import type { MachinePlumbing } from "@/lib/api";
import { plumbedOf } from "@/lib/org";
import { Banners, Dot, EnMarcha, KillSwitch, PlanMeter, eyebrow, heading, panel, pillGhost, pillPrimary } from "@/components/compania/parts";
import { RunList } from "@/components/compania/sheets";

// PLA-21: no weekly budgets. The week's tokens per team and for Asistente, shown only.
const UsageRow = ({ label, used, paused }: { label: string; used: number; paused?: boolean }) => (
  <li className={cn("flex min-w-0 items-baseline justify-between gap-3 text-sm", paused && "opacity-60")} data-usage={label}>
    <span className="truncate text-muted-foreground">{paused ? `${label} · en pausa` : label}</span>
    <span className="shrink-0 font-mono tabular-nums">{tokens(used)}</span>
  </li>
);

export const WeekTokens = ({ plumbing }: { plumbing: MachinePlumbing }) => (
  <section id="tokens" aria-labelledby="pl-tokens" className={cn(panel, "grid min-w-0 scroll-mt-20 content-start gap-3 p-4")} data-block="tokens">
    <div className="grid gap-0.5">
      <h2 id="pl-tokens" className={heading}>
        Tokens esta semana
      </h2>
      <p className="text-xs text-muted-foreground">Uno por equipo y uno para Asistente · sin límite</p>
    </div>
    <ul className="grid gap-2">
      <UsageRow label="Asistente" used={plumbing.usage.asistente.used} />
      {plumbing.usage.projects.map((p) => (
        <UsageRow key={p.slug} label={p.title} used={p.usage.used} paused={p.paused} />
      ))}
    </ul>
  </section>
);

// PLA-25: "Seguir aunque el plan esté alto". On, the bots run past the guard; only a plan the provider has
// rejected still stops them.
export const Guard = ({
  plumbing,
  canEdit,
  onMoveGuard,
  onToggleOverride,
}: {
  plumbing: MachinePlumbing;
  canEdit: boolean;
  onMoveGuard: () => void;
  onToggleOverride?: (on: boolean) => void;
}) => {
  const override = plumbing.plan.override === true;
  return (
  <section id="guardia" aria-labelledby="pl-guard" className={cn(panel, "grid min-w-0 scroll-mt-20 content-start gap-3 p-4")} data-block="guardia">
    <h2 id="pl-guard" className={heading}>
      Guardia del plan
    </h2>
    <PlanMeter plan={plumbing.plan} timeZone={plumbing.week.timezone} />
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
      <span>
        Semana del plan <span className="font-mono tabular-nums">{plumbing.plan.seven_day_pct == null ? "—" : `${Math.round(plumbing.plan.seven_day_pct)}%`}</span>
      </span>
      {canEdit && (
        <button type="button" className={cn(pillGhost, "min-h-8 px-3 text-xs")} onClick={onMoveGuard} data-control="mover-guardia">
          Mover guardia
        </button>
      )}
    </div>
    <div className="grid gap-1 border-t border-foreground/10 pt-3" data-part="guardia-ignorada">
      <label className="flex min-h-8 items-center gap-2 text-sm font-semibold">
        <input type="checkbox" checked={override} disabled={!canEdit || !onToggleOverride} onChange={(e) => onToggleOverride?.(e.target.checked)} data-control="seguir-sin-guardia" />
        Seguir aunque el plan esté alto
      </label>
      <p className="text-xs text-muted-foreground" data-state={override ? "ignorado" : "activo"}>
        {override
          ? "Límite ignorado: los bots arrancan aunque la ventana pase de la guardia. Solo para si el plan responde «rechazado»."
          : "La guardia detiene las corridas nuevas al llegar al porcentaje."}
      </p>
    </div>
  </section>
  );
};

export const Switches = ({
  plumbing,
  canEdit,
  onStopCompany,
  onResumeCompany,
  onPauseProject,
  onResumeProject,
}: {
  plumbing: MachinePlumbing;
  canEdit: boolean;
  onStopCompany: () => void;
  onResumeCompany: () => void;
  onPauseProject: (p: CompanyProjectRow) => void;
  onResumeProject: (p: CompanyProjectRow) => void;
}) => (
  <section aria-labelledby="pl-switches" className="grid min-w-0 content-start gap-3" data-block="interruptores">
    <h2 id="pl-switches" className={cn(heading, "sr-only")}>
      Interruptores
    </h2>
    <KillSwitch company={plumbedOf(plumbing)} onStop={onStopCompany} onResume={onResumeCompany} />
    <ul className={cn(panel, "grid gap-0 overflow-hidden")} aria-label="Proyectos">
      {plumbing.usage.projects.map((p) => (
        <li key={p.slug} className="flex min-w-0 items-center justify-between gap-3 border-b border-border px-4 py-2.5 last:border-0" data-switch={p.slug}>
          <span className="flex min-w-0 items-center gap-2 text-sm">
            <Dot tone={plumbing.company.paused || p.paused ? "idle" : "ok"} />
            <span className="truncate font-semibold">{p.title}</span>
            <span className="shrink-0 text-xs text-muted-foreground">{p.paused ? "en pausa" : plumbing.company.paused ? "detenida" : "en marcha"}</span>
          </span>
          {canEdit &&
            (p.paused ? (
              <button type="button" className={cn(pillPrimary, "min-h-8 px-3 text-xs")} onClick={() => onResumeProject(p)}>
                Reanudar
              </button>
            ) : (
              <button type="button" className={cn(pillGhost, "min-h-8 px-3 text-xs")} onClick={() => onPauseProject(p)}>
                Pausar
              </button>
            ))}
        </li>
      ))}
    </ul>
  </section>
);

export const RunLog = ({ log, now, projectTitle }: { log: RunBrief[]; now: number; projectTitle: (slug: string) => string }) => (
  <section aria-labelledby="pl-log" className={cn(panel, "grid min-w-0 content-start gap-3 p-4")} data-block="bitacora">
    <h2 id="pl-log" className={heading}>
      Bitácora de corridas
    </h2>
    <RunList runs={log} now={now} projectTitle={projectTitle} />
  </section>
);

// The five blocks in one section, with the 100 % and guard banners on top.
export const PlumbingSection = ({
  plumbing,
  now,
  canEdit,
  onMoveGuard,
  onToggleOverride,
  onStopCompany,
  onResumeCompany,
  onPauseProject,
  onResumeProject,
}: {
  plumbing: MachinePlumbing;
  now: number;
  canEdit: boolean;
  onMoveGuard: () => void;
  onToggleOverride?: (on: boolean) => void;
  onStopCompany: () => void;
  onResumeCompany: () => void;
  onPauseProject: (p: CompanyProjectRow) => void;
  onResumeProject: (p: CompanyProjectRow) => void;
}) => {
  const plumbed = plumbedOf(plumbing);
  const titles = new Map(plumbing.usage.projects.map((p) => [p.slug, p.title]));
  const projectTitle = (slug: string) => titles.get(slug) ?? slug;
  return (
    <section aria-labelledby="plomeria" id="plomeria" className="grid min-w-0 scroll-mt-20 gap-4" data-testid="plumbing">
      <div className="grid gap-0.5">
        <p className={eyebrow}>Plomería</p>
        <h2 id="plomeria" className="font-display text-2xl font-extrabold tracking-tight">
          Tokens, guardia e interruptores
        </h2>
      </div>
      <Banners
        banners={bannersOf(plumbed)}
        canEdit={canEdit}
        timeZone={plumbing.week.timezone}
        onResume={onResumeCompany}
        onMoveGuard={onMoveGuard}
        onSeeSpend={() => document.getElementById("tokens")?.scrollIntoView({ behavior: "smooth", block: "start" })}
      />
      <div className="grid min-w-0 items-start gap-4 lg:grid-cols-2">
        <WeekTokens plumbing={plumbing} />
        <div className="grid min-w-0 gap-4">
          <Guard plumbing={plumbing} canEdit={canEdit} onMoveGuard={onMoveGuard} onToggleOverride={onToggleOverride} />
          <EnMarcha company={plumbed} now={now} projectTitle={projectTitle} />
        </div>
        <Switches
          plumbing={plumbing}
          canEdit={canEdit}
          onStopCompany={onStopCompany}
          onResumeCompany={onResumeCompany}
          onPauseProject={onPauseProject}
          onResumeProject={onResumeProject}
        />
        <RunLog log={plumbing.log} now={now} projectTitle={projectTitle} />
      </div>
    </section>
  );
};

export const PlumbingMissing = () => (
  <p className="rounded-[20px] border border-dashed px-4 py-4 text-sm text-muted-foreground" data-empty="plumbing">
    El servidor todavía no sirve la plomería (tokens, guardia, interruptores). Aparece aquí cuando se actualice.
  </p>
);
