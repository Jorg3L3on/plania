// PLA-I30-3: the project sheet (2a/2b, /ceo?p=<slug>), the Equipo sheet (3a/3b, /ceo?equipo), a role prompt
// (Prompt ↗, /ceo?doc=<id>), the new-project dialog (4a/4b) and the limit editor. The bodies are plain
// components so test/compania-ui.test.ts renders them; the page wraps them in a Sheet or Dialog.
// Cambiar / Subir límite / Mover guardia render only when canEdit (Jorge's screen session).
import { useState, type FormEvent } from "react";
import Markdown from "react-markdown";
import { Link } from "react-router";
import { cn } from "@/lib/utils";
import {
  ago,
  nextWakeWord,
  promptHref,
  roleInitials,
  roleWord,
  tokens,
  ROLE_LABEL,
  ROLE_NOTE,
  RUNNER_ROLES,
  RUN_WORD,
  STAGE_LABEL,
  type Budget,
  type Company,
  type CompanyProjectRow,
  type Health,
  type NewProjectResult,
  type ProjectFacts,
  type ProjectSheetData,
  type PromptRef,
  type RosterRow,
  type RunBrief,
  type RunnerRole,
} from "@/lib/compania";
import { BlockError, Dot, Meter, TONE_INK, eyebrow, pillDanger, pillGhost, pillPrimary } from "@/components/compania/parts";

const section = "grid gap-2";

const RunList = ({ runs, now, projectTitle }: { runs: RunBrief[]; now: number; projectTitle?: (slug: string) => string }) =>
  runs.length === 0 ? (
    <p className="text-sm text-muted-foreground">Ninguna corrida todavía.</p>
  ) : (
    <ul className="grid gap-1.5">
      {runs.map((run) => {
        const failed = !run.resolved && (run.status === "fail" || run.status === "stopped");
        const escalated = /escal/i.test(run.summary);
        return (
          <li key={run.id} className="flex items-center gap-2.5 text-sm" data-run-status={run.status}>
            <Dot tone={escalated || failed ? "stop" : run.status === "ok" ? "ok" : "idle"} />
            <span className="grid min-w-0 flex-1">
              <span className="truncate">
                <span className="font-semibold">{roleWord(run.role)}</span>
                {projectTitle ? ` · ${projectTitle(run.project)}` : ""}
                {run.ticket && (
                  <>
                    {" · "}
                    <span className="font-mono text-xs">{run.ticket}</span>
                  </>
                )}
                {" · "}
                {RUN_WORD[run.status] ?? run.status}
                {run.resolved && <span className="text-muted-foreground"> · resuelto</span>}
              </span>
              {run.summary && <span className={cn("truncate text-xs text-muted-foreground", run.resolved && "line-through")}>{run.summary}</span>}
            </span>
            <span className="shrink-0 text-right font-mono text-xs whitespace-nowrap text-muted-foreground tabular-nums">
              {tokens(run.tokens)} tok · {ago(run.ended_at ?? run.started_at, now)}
            </span>
          </li>
        );
      })}
    </ul>
  );

const BudgetBlock = ({ budget, canEdit, onEdit }: { budget: Budget; canEdit: boolean; onEdit: () => void }) => (
  <div className="grid gap-2">
    <Meter budget={budget} label="Presupuesto semanal" big />
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="text-xs text-muted-foreground">
        {budget.reason === "unset" ? "Sin límite: no arranca hasta que tenga uno." : "Aviso al 80% · alto al 100% · se reinicia lun 00:00"}
      </span>
      {canEdit && (
        <button type="button" className={cn(pillGhost, "min-h-9 px-3 text-xs")} onClick={onEdit} data-control="cambiar">
          Cambiar
        </button>
      )}
    </div>
  </div>
);

// ---- PLA-I30-6: Pedirle al PO. One sentence becomes a Ready ticket the PO owns; the PO wakes on it.

export type AskState = { kind: "idle" } | { kind: "busy" } | { kind: "done"; key: string; wake: "queued" | "busy" | "off" } | { kind: "error"; message: string };

export const AskBox = ({ paused, state, onAsk }: { paused: boolean; state: AskState; onAsk: (text: string) => void }) => {
  const [text, setText] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (text.trim().length < 3 || state.kind === "busy" || paused) return;
    onAsk(text.trim());
    setText("");
  };
  return (
    <form className="grid gap-2 rounded-2xl bg-muted/60 p-3" onSubmit={submit} data-testid="ask-po">
      <label className={eyebrow} htmlFor="ask-po-text">
        Pedirle al PO
      </label>
      <div className="flex gap-2">
        <input
          id="ask-po-text"
          className="min-h-10 min-w-0 flex-1 rounded-xl border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
          placeholder={paused ? "Reanuda el proyecto para pedirle algo" : "Ej.: arma el borrador de Campos y flujos con la propuesta"}
          value={text}
          maxLength={500}
          disabled={paused || state.kind === "busy"}
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" className={cn(pillPrimary, "shrink-0")} disabled={paused || state.kind === "busy" || text.trim().length < 3}>
          {state.kind === "busy" ? "Enviando…" : "Pedir"}
        </button>
      </div>
      {state.kind === "done" && (
        <p className="text-xs" data-ask-result={state.key}>
          Listo: <span className="font-mono">{state.key}</span>
          {state.wake === "queued" ? " · el PO despierta en su turno" : state.wake === "busy" ? " · el PO lo toma al terminar lo que corre" : " · el PO lo verá cuando despierte"}
        </p>
      )}
      {state.kind === "error" && <p className="text-xs text-ink-blocked">{state.message}</p>}
      {state.kind === "idle" && !paused && <p className="text-xs text-muted-foreground">Una frase basta: el PO escribe el alcance y lo hace o se lo pasa a Taller.</p>}
    </form>
  );
};

// ---- 2a / 2b

export const ProjectSheetBody = ({
  project,
  facts,
  health,
  sheet,
  sheetError,
  onRetry,
  canEdit,
  companyPaused,
  now,
  onEditBudget,
  onEditGoal,
  onPause,
  onResume,
  ask = { kind: "idle" },
  onAsk,
  wake,
  onWake,
}: {
  project: CompanyProjectRow;
  facts: ProjectFacts | undefined;
  health: Health;
  sheet: ProjectSheetData | undefined;
  sheetError?: boolean;
  onRetry?: () => void;
  canEdit: boolean;
  companyPaused: boolean;
  now: number;
  onEditBudget: () => void;
  onEditGoal: () => void;
  onPause: () => void;
  onResume: () => void;
  ask?: AskState;
  onAsk?: (text: string) => void;
  wake?: { busy: boolean; text: string | null };
  onWake?: () => void;
}) => {
  const goal = sheet?.goal ?? facts?.goal ?? null;
  const switchRow = (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-muted/60 p-3">
      <span className="grid min-w-0 flex-1 gap-0.5 text-sm">
        <span className="font-semibold">{project.paused ? "En pausa" : "En marcha"}</span>
        <span className="text-xs text-muted-foreground">
          {project.paused ? "Su PO despierta cuando lo reanudes." : "Pausarlo cierra lo que corre aquí (terminan su paso) y no borra nada."}
          {companyPaused && " La compañía está detenida: sigue sin arrancar hasta que la reanudes."}
        </span>
      </span>
      {project.paused ? (
        <button type="button" className={pillPrimary} onClick={onResume}>
          Reanudar
        </button>
      ) : (
        <button type="button" className={pillDanger} onClick={onPause}>
          Pausar
        </button>
      )}
    </div>
  );
  return (
    <div className="grid gap-5" data-testid="project-sheet">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span className={cn("inline-flex items-center gap-1.5 font-semibold", TONE_INK[health.tone])}>
          <Dot tone={health.tone} /> {health.word}
        </span>
        <span className="text-muted-foreground">
          PO {facts?.po?.name ?? "sin asignar"} · {ago(facts?.last_move_at ?? null, now)}
        </span>
        {canEdit && onWake && facts?.po && !project.paused && !companyPaused && (
          <button type="button" className={cn(pillGhost, "ml-auto min-h-8 px-3 text-xs")} onClick={onWake} disabled={wake?.busy} data-control="despertar">
            {wake?.busy ? "Despertando…" : "Despertar ahora"}
          </button>
        )}
      </div>
      {wake?.text && (
        <p className="-mt-3 text-xs text-muted-foreground" data-wake-result>
          {wake.text}
        </p>
      )}
      {health.reason === "nowork" && (
        <p className="-mt-3 text-xs text-ink-now">Ningún bot tiene un ticket que pueda tomar aquí. Pídele algo al PO para que arranque.</p>
      )}
      {canEdit && onAsk && facts?.po && <AskBox paused={project.paused || companyPaused} state={ask} onAsk={onAsk} />}
      <div className="sm:hidden">{switchRow}</div>
      <div className={section}>
        <div className="flex items-baseline justify-between gap-2">
          <p className={eyebrow}>Meta</p>
          <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={onEditGoal}>
            Editar
          </button>
        </div>
        {goal ? (
          <p className="font-voice text-xl leading-snug italic break-words">{goal}</p>
        ) : (
          <p className="text-sm text-ink-now">Sin meta: su product owner no despierta hasta que tenga una.</p>
        )}
      </div>
      {sheetError ? (
        <BlockError what="el detalle del proyecto" onRetry={onRetry ?? (() => {})} />
      ) : !sheet ? (
        <div className="grid gap-2" aria-hidden>
          <div className="h-16 animate-pulse rounded-xl bg-muted" />
          <div className="h-24 animate-pulse rounded-xl bg-muted" />
        </div>
      ) : (
        <>
          <div className={section}>
            <div className="flex items-baseline justify-between gap-2">
              <p className={eyebrow}>Ideas</p>
              <span className="text-xs text-muted-foreground">avanzan solas, sin compuertas</span>
            </div>
            <ol className="grid grid-cols-5 gap-1.5">
              {sheet.pipeline.map((s) => (
                <li key={s.stage} className="grid min-w-0 gap-0.5 rounded-xl bg-muted/60 p-2 text-center" title={s.newest ?? undefined}>
                  <span className="font-display text-xl font-extrabold tabular-nums">{s.count}</span>
                  <span className="truncate text-[11px] text-muted-foreground">{STAGE_LABEL[s.stage]}</span>
                  {s.newest && <span className="hidden truncate text-[11px] sm:block">{s.newest}</span>}
                </li>
              ))}
            </ol>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className={section}>
              <p className={eyebrow}>En curso</p>
              {sheet.in_progress.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nada en curso.</p>
              ) : (
                <ul className="grid gap-1.5 text-sm">
                  {sheet.in_progress.map((t) => (
                    <li key={t.key} className="grid min-w-0">
                      <span className="truncate" title={t.title}>
                        <span className="font-mono text-xs">{t.key}</span> {t.title}
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        {t.status === "In review" ? "en revisión" : "en curso"}
                        {t.owner ? ` · ${t.owner}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className={section}>
              <p className={eyebrow}>Bloqueado</p>
              {sheet.blocked.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nada bloqueado.</p>
              ) : (
                <ul className="grid gap-1.5 text-sm">
                  {sheet.blocked.map((t) => (
                    <li key={t.key} className="grid min-w-0">
                      <span className="truncate" title={t.title}>
                        <span className="font-mono text-xs">{t.key}</span> {t.title}
                      </span>
                      <span className="line-clamp-2 text-xs text-ink-blocked">espera: {t.why}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <div className={section}>
            <p className={eyebrow}>Siguiente</p>
            {sheet.next.length === 0 ? (
              <p className="text-sm text-muted-foreground">No hay tickets Listos. Su PO escribe ideas cuando despierta.</p>
            ) : (
              <ol className="grid list-decimal gap-1 pl-5 text-sm">
                {sheet.next.map((t) => (
                  <li key={t.key} className="truncate" title={t.title} data-yours={t.yours ? "1" : undefined}>
                    <span className="font-mono text-xs">{t.key}</span> {t.title}
                    {t.yours && <span className="ml-1.5 rounded-full bg-ink-now/15 px-1.5 py-0.5 text-[11px] font-semibold text-ink-now">Te toca</span>}
                  </li>
                ))}
              </ol>
            )}
          </div>
          <div className={section}>
            <p className={eyebrow}>Corridas recientes</p>
            <RunList runs={sheet.runs} now={now} />
          </div>
        </>
      )}
      <div className={section}>
        <p className={eyebrow}>Presupuesto</p>
        <BudgetBlock budget={project.budget} canEdit={canEdit} onEdit={onEditBudget} />
      </div>
      <div className="hidden sm:grid sm:gap-2">
        <p className={eyebrow}>Interruptor</p>
        {switchRow}
      </div>
      <Link to={`/p/${project.slug}`} className="text-sm text-muted-foreground hover:text-foreground">
        Abrir la página del proyecto →
      </Link>
    </div>
  );
};

// ---- 3a / 3b: the real roles only. No names, no hire.

const RoleRow = ({
  role,
  rows,
  budget,
  prompt,
  company,
  canEdit,
  now,
  onEditBudget,
  projectTitle,
}: {
  role: RunnerRole;
  rows: RosterRow[];
  budget: Budget | undefined;
  prompt: PromptRef | null | undefined;
  company: Company;
  canEdit: boolean;
  now: number;
  onEditBudget: (role: RunnerRole) => void;
  projectTitle: (slug: string) => string;
}) => {
  const live = company.runs.live.filter((r) => r.role === role);
  const last = rows
    .map((r) => r.last_run)
    .filter((r): r is RunBrief => r !== null)
    .sort((a, b) => (b.started_at ?? "").localeCompare(a.started_at ?? ""))[0];
  const tz = company.week.timezone;
  const href = promptHref(prompt);
  const isPo = role === "product-owner";
  return (
    <li className="grid gap-2.5 border-b border-border py-3.5 last:border-0" data-role={role}>
      <div className="flex items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-muted font-mono text-xs font-semibold">{roleInitials(role)}</span>
        <span className="grid min-w-0 flex-1">
          <span className="flex items-center gap-2 truncate text-sm font-semibold">
            {ROLE_LABEL[role]}
            {live.length > 0 && <Dot tone="ok" live />}
            <span className="font-normal text-muted-foreground">{ROLE_NOTE[role]}</span>
          </span>
          <span className="truncate text-xs text-muted-foreground">
            {live.length > 0
              ? `Corriendo ${live.map((r) => r.ticket ?? projectTitle(r.project)).join(", ")}`
              : last
                ? `Última: ${last.ticket ?? projectTitle(last.project)} · ${RUN_WORD[last.status] ?? last.status} · ${ago(last.ended_at ?? last.started_at, now)}`
                : "Sin corridas todavía"}
          </span>
        </span>
        {href ? (
          <Link to={href} className="shrink-0 text-xs font-semibold hover:underline" data-prompt={prompt?.doc_id}>
            Prompt ↗
          </Link>
        ) : (
          <span className="shrink-0 text-xs text-muted-foreground">Sin prompt</span>
        )}
      </div>
      {isPo ? (
        <details className="group text-xs">
          <summary className="cursor-pointer text-muted-foreground">
            {rows.length} {rows.length === 1 ? "product owner" : "product owners"} · uno por proyecto
          </summary>
          <table className="mt-2 w-full text-left">
            <thead className="text-muted-foreground">
              <tr>
                <th className="py-1 font-normal">Proyecto</th>
                <th className="py-1 font-normal">Última</th>
                <th className="py-1 text-right font-normal">Siguiente</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const paused = company.company.paused || company.projects.find((p) => p.slug === r.project)?.paused === true;
                return (
                  <tr key={r.slug} className="border-t border-border">
                    <td className="truncate py-1.5">{r.project ? projectTitle(r.project) : r.name}</td>
                    <td className="py-1.5">{r.last_run ? `${RUN_WORD[r.last_run.status] ?? r.last_run.status} · ${ago(r.last_run.ended_at ?? r.last_run.started_at, now)}` : "—"}</td>
                    <td className="py-1.5 text-right font-mono">{nextWakeWord(r, { paused, timeZone: tz })}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </details>
      ) : (
        <p className="text-xs text-muted-foreground">
          Siguiente: <span className="font-mono">{rows[0] ? nextWakeWord(rows[0], { paused: company.company.paused, timeZone: tz }) : "—"}</span>
        </p>
      )}
      {budget && (
        <div className="flex items-end gap-3">
          <div className="min-w-0 flex-1">
            <Meter budget={budget} label="Tokens esta semana" />
          </div>
          {canEdit && (
            <button type="button" className={cn(pillGhost, "min-h-8 px-3 text-xs")} onClick={() => onEditBudget(role)} data-control="cambiar">
              Cambiar
            </button>
          )}
        </div>
      )}
    </li>
  );
};

export const EquipoSheetBody = ({
  company,
  canEdit,
  now,
  onEditBudget,
  projectTitle,
}: {
  company: Company;
  canEdit: boolean;
  now: number;
  onEditBudget: (role: RunnerRole) => void;
  projectTitle: (slug: string) => string;
}) => {
  const roster = company.roster ?? [];
  return (
    <div className="grid gap-2" data-testid="equipo-sheet">
      <p className="text-xs text-muted-foreground">
        Tope: {company.settings.max_concurrent} a la vez · descanso {company.settings.cooldown_minutes} min entre corridas de un mismo rol · Claude Code en tu Mac.
      </p>
      <ul>
        {RUNNER_ROLES.map((role) => (
          <RoleRow
            key={role}
            role={role}
            rows={roster.filter((r) => r.role === role)}
            budget={company.roles.find((r) => r.role === role)?.budget}
            prompt={company.prompts?.[role]}
            company={company}
            canEdit={canEdit}
            now={now}
            onEditBudget={onEditBudget}
            projectTitle={projectTitle}
          />
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">Los roles salen de una plantilla: aquí cambias límites, no personas.</p>
    </div>
  );
};

// ---- Prompt ↗

export const PromptDocBody = ({ doc }: { doc: { title: string; version: number; markdown: string } }) => (
  <div className="grid gap-2" data-testid="prompt-doc">
    <p className="text-xs text-muted-foreground">v{doc.version} · se lee en la primera corrida de cada sesión</p>
    <div className="grid gap-2 text-sm leading-relaxed break-words [&_code]:font-mono [&_code]:text-xs [&_h1]:font-display [&_h1]:text-lg [&_h1]:font-extrabold [&_h2]:font-semibold [&_li]:ml-5 [&_li]:list-disc">
      <Markdown>{doc.markdown}</Markdown>
    </div>
  </div>
);

// ---- 4a / 4b: a name and a goal sentence. The project starts paused.

export type NewProjectState = { kind: "idle" } | { kind: "busy" } | { kind: "missing" } | { kind: "error"; message: string } | { kind: "done"; result: NewProjectResult; name: string; goal: string };

export const NewProjectForm = ({ state, onSubmit, onCancel }: { state: NewProjectState; onSubmit: (input: { name: string; goal: string }) => void; onCancel: () => void }) => {
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim() && goal.trim()) onSubmit({ name: name.trim(), goal: goal.trim() });
  };
  return (
    <form className="grid gap-4" onSubmit={submit} data-testid="new-project-form">
      <label className="grid gap-1.5 text-sm">
        <span className="font-semibold">Nombre</span>
        <input
          className="min-h-11 rounded-xl bg-background px-3 ring-1 ring-foreground/15 outline-none focus:ring-2 focus:ring-foreground/40"
          value={name}
          maxLength={60}
          onChange={(e) => setName(e.target.value)}
          placeholder="Viajia"
          required
        />
      </label>
      <label className="grid gap-1.5 text-sm">
        <span className="font-semibold">Meta, en una oración</span>
        <textarea
          className="min-h-20 rounded-xl bg-background px-3 py-2 ring-1 ring-foreground/15 outline-none focus:ring-2 focus:ring-foreground/40"
          value={goal}
          maxLength={240}
          onChange={(e) => setGoal(e.target.value)}
          placeholder="Que alguien arme su viaje en diez minutos."
          required
        />
        <span className="text-xs text-muted-foreground">Lo que tendría que ser cierto cuando el proyecto vaya bien; el PO la lee en cada corrida.</span>
      </label>
      {state.kind === "missing" && (
        <p role="alert" className="rounded-xl bg-status-now/10 p-3 text-sm text-ink-now ring-1 ring-status-now/40">
          Todavía no se pueden crear proyectos desde aquí: el servidor no tiene esa ruta (llega con PLA-I31-3). No se creó nada.
        </p>
      )}
      {state.kind === "error" && (
        <p role="alert" className="rounded-xl bg-status-blocked/10 p-3 text-sm text-ink-blocked ring-1 ring-status-blocked/40">
          {state.message}
        </p>
      )}
      <p className="text-xs text-muted-foreground">Empieza en pausa. Su PO despierta cuando lo reanudes.</p>
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={pillPrimary} disabled={state.kind === "busy" || !name.trim() || !goal.trim()}>
          {state.kind === "busy" ? "Creando…" : "Crear proyecto"}
        </button>
        <button type="button" className={pillGhost} onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </form>
  );
};

export const NewProjectDone = ({ state, onOpen, onClose }: { state: Extract<NewProjectState, { kind: "done" }>; onOpen: (slug: string) => void; onClose: () => void }) => {
  const promptLink = state.result.prompt_doc_id ? `/ceo?doc=${encodeURIComponent(state.result.prompt_doc_id)}` : null;
  return (
    <div className="grid gap-4" data-testid="new-project-done">
      <p className="font-voice text-lg leading-snug italic">{state.goal}</p>
      <ul className="grid gap-2 text-sm">
        <li className="flex items-center gap-2">
          <Dot tone="ok" /> Proyecto creado · clave <span className="font-mono">{state.result.key_prefix}</span>
        </li>
        <li className="flex items-center gap-2">
          <Dot tone="ok" /> Product owner creado de la plantilla
          {promptLink && (
            <Link to={promptLink} className="text-xs font-semibold hover:underline">
              Prompt ↗
            </Link>
          )}
        </li>
        <li className="flex items-center gap-2">
          <Dot tone="idle" /> Empieza en pausa · Su PO despierta cuando lo reanudes
        </li>
      </ul>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={pillPrimary} onClick={() => onOpen(state.result.slug)}>
          Ver {state.name}
        </button>
        <button type="button" className={pillGhost} onClick={onClose}>
          Cerrar
        </button>
      </div>
    </div>
  );
};

// ---- Jorge-only number editor: a weekly token limit or the plan guard.

export type LimitTarget =
  | { kind: "project"; slug: string; title: string; current: number | null }
  | { kind: "role"; role: RunnerRole; current: number | null }
  | { kind: "guard"; current: number };

export const LimitForm = ({ target, busy, onSave, onCancel }: { target: LimitTarget; busy?: boolean; onSave: (value: number | null) => void; onCancel: () => void }) => {
  const guard = target.kind === "guard";
  const [value, setValue] = useState(target.current == null ? "" : String(target.current));
  const parsed = value.trim() === "" ? null : Number(value.replace(/[_\s,]/g, ""));
  const valid = guard ? parsed !== null && Number.isInteger(parsed) && parsed >= 0 && parsed <= 100 : parsed === null || (Number.isInteger(parsed) && parsed >= 1);
  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onSave(parsed);
      }}
    >
      <label className="grid gap-1.5 text-sm">
        <span className="font-semibold">{guard ? "Guardia del plan (% de la ventana de 5 h)" : "Límite semanal en tokens"}</span>
        <input
          inputMode="numeric"
          className="min-h-11 rounded-xl bg-background px-3 font-mono ring-1 ring-foreground/15 outline-none focus:ring-2 focus:ring-foreground/40"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={guard ? "70" : "500000"}
        />
        <span className="text-xs text-muted-foreground">
          {guard
            ? "Arriba de este % no arranca nada nuevo, para que te quede plan a ti."
            : `${parsed ? tokens(parsed) : "Vacío = sin límite, y sin límite no arranca nada"} · aviso al 80%, alto al 100%`}
        </span>
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={pillPrimary} disabled={!valid || busy}>
          Guardar
        </button>
        <button type="button" className={pillGhost} onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </form>
  );
};

export const limitTitle = (t: LimitTarget) =>
  t.kind === "guard" ? "Mover guardia" : t.kind === "project" ? `Límite de ${t.title}` : `Límite de ${ROLE_LABEL[t.role]}`;
