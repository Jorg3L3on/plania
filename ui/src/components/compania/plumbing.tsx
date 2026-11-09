// PLA-I33-3: the plumbing that left Compañía lives in Máquina (ADR 31c1cead): weekly token budgets per
// project and for Asistente (Cambiar), the plan guard (Mover guardia), the company and project switches
// (with the 5i confirm sheet), En marcha and the run log. One weekly budget per team; no per-role limits.
// Presentational: data and actions are props, so test/compania-org.test.ts renders it with fake data.
// Tokens, never money.
import { cn } from "@/lib/utils";
import { bannersOf, type Budget, type CompanyProjectRow, type RunBrief } from "@/lib/compania";
import type { MachinePlumbing } from "@/lib/api";
import { plumbedOf } from "@/lib/org";
import { Banners, Dot, EnMarcha, KillSwitch, Meter, PlanMeter, eyebrow, heading, panel, pillGhost, pillPrimary } from "@/components/compania/parts";
import { RunList } from "@/components/compania/sheets";

const Cambiar = ({ onClick, label }: { onClick: () => void; label: string }) => (
  <button type="button" className={cn(pillGhost, "min-h-8 px-3 text-xs")} onClick={onClick} data-control="cambiar" aria-label={label}>
    Cambiar
  </button>
);

const BudgetRow = ({ label, budget, paused, canEdit, onEdit }: { label: string; budget: Budget; paused?: boolean; canEdit: boolean; onEdit: () => void }) => (
  <li className={cn("grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-end gap-3", paused && "opacity-60")} data-budget={label}>
    <Meter budget={budget} label={paused ? `${label} · en pausa` : label} />
    {canEdit ? <Cambiar onClick={onEdit} label={`Cambiar el presupuesto de ${label}`} /> : <span />}
  </li>
);

export const Budgets = ({
  plumbing,
  canEdit,
  onEditProject,
  onEditAsistente,
}: {
  plumbing: MachinePlumbing;
  canEdit: boolean;
  onEditProject: (p: CompanyProjectRow) => void;
  onEditAsistente: () => void;
}) => (
  <section id="presupuestos" aria-labelledby="pl-budgets" className={cn(panel, "grid min-w-0 scroll-mt-20 content-start gap-3 p-4")} data-block="presupuestos">
    <div className="grid gap-0.5">
      <h2 id="pl-budgets" className={heading}>
        Presupuestos
      </h2>
      <p className="text-xs text-muted-foreground">Tokens por semana, uno por equipo y uno para Asistente · aviso al 80 % · alto al 100 %</p>
    </div>
    <ul className="grid gap-3">
      <BudgetRow label="Asistente" budget={plumbing.budgets.asistente} canEdit={canEdit} onEdit={onEditAsistente} />
      {plumbing.budgets.projects.map((p) => (
        <BudgetRow key={p.slug} label={p.title} budget={p.budget} paused={p.paused} canEdit={canEdit} onEdit={() => onEditProject(p)} />
      ))}
    </ul>
    {plumbing.budgets.projects.length === 0 && <p className="text-sm text-muted-foreground">0 tokens esta semana.</p>}
  </section>
);

export const Guard = ({ plumbing, canEdit, onMoveGuard }: { plumbing: MachinePlumbing; canEdit: boolean; onMoveGuard: () => void }) => (
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
  </section>
);

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
      {plumbing.budgets.projects.map((p) => (
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
  dismissed,
  onDismiss,
  onEditProject,
  onEditAsistente,
  onMoveGuard,
  onStopCompany,
  onResumeCompany,
  onPauseProject,
  onResumeProject,
}: {
  plumbing: MachinePlumbing;
  now: number;
  canEdit: boolean;
  dismissed: Set<string>;
  onDismiss: (slug: string) => void;
  onEditProject: (p: CompanyProjectRow) => void;
  onEditAsistente: () => void;
  onMoveGuard: () => void;
  onStopCompany: () => void;
  onResumeCompany: () => void;
  onPauseProject: (p: CompanyProjectRow) => void;
  onResumeProject: (p: CompanyProjectRow) => void;
}) => {
  const plumbed = plumbedOf(plumbing);
  const titles = new Map(plumbing.budgets.projects.map((p) => [p.slug, p.title]));
  const projectTitle = (slug: string) => titles.get(slug) ?? slug;
  return (
    <section aria-labelledby="plomeria" id="plomeria" className="grid min-w-0 scroll-mt-20 gap-4" data-testid="plumbing">
      <div className="grid gap-0.5">
        <p className={eyebrow}>Plomería</p>
        <h2 id="plomeria" className="font-display text-2xl font-extrabold tracking-tight">
          Presupuestos, guardia e interruptores
        </h2>
      </div>
      <Banners
        banners={bannersOf(plumbed)}
        canEdit={canEdit}
        timeZone={plumbing.week.timezone}
        dismissed={dismissed}
        onDismiss={onDismiss}
        onResume={onResumeCompany}
        onRaise={onEditProject}
        onMoveGuard={onMoveGuard}
        onSeeSpend={() => document.getElementById("presupuestos")?.scrollIntoView({ behavior: "smooth", block: "start" })}
      />
      <div className="grid min-w-0 items-start gap-4 lg:grid-cols-2">
        <Budgets plumbing={plumbing} canEdit={canEdit} onEditProject={onEditProject} onEditAsistente={onEditAsistente} />
        <div className="grid min-w-0 gap-4">
          <Guard plumbing={plumbing} canEdit={canEdit} onMoveGuard={onMoveGuard} />
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
    El servidor todavía no sirve la plomería (presupuestos, guardia, interruptores). Aparece aquí cuando se actualice.
  </p>
);
