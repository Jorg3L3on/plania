import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { PlusIcon, TargetIcon } from "lucide-react";
import { GoalCard } from "@/components/goals/goal-card";
import { GoalDialog } from "@/components/goals/goal-dialog";
import { EnlaceVer, TituloTarjeta } from "@/components/home/tarjeta";
import type { Goal } from "@/components/goals/model";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { words } from "@/lib/i18n";
import { GOALS_WORDS } from "@/lib/goals-words";
import { metasLinea, metasLineaTexto, metasLineaWords, metasPrincipales, porcentaje, segmentosMeta, type Segmento } from "@/lib/metas-linea";
import { dayText } from "@/lib/due";
import { Cifra } from "@/components/home/cifra";
import { cn } from "@/lib/utils";

function useGoalNames() {
  const projects = useQuery({ queryKey: ["projects"], queryFn: api.projects });
  const names = new Map((projects.data ?? []).map((project) => [project.slug, project.title]));
  return { projects: (projects.data ?? []).map((project) => ({ slug: project.slug, title: project.title })), names };
}

function GoalList({
  goals,
  names,
  compact,
  onEdit,
}: {
  goals: Goal[];
  names: Map<string, string>;
  compact?: boolean;
  onEdit: (goal: Goal) => void;
}) {
  const w = words(GOALS_WORDS);
  if (goals.length === 0) return <p className="text-sm text-muted-foreground">{w.none}</p>;
  return (
    <div className="grid grid-cols-1 gap-2.5">
      {goals.map((goal, index) => (
        <GoalCard
          key={goal.id}
          goal={goal}
          index={index}
          compact={compact}
          names={names}
          onEdit={onEdit}
        />
      ))}
    </div>
  );
}

function GoalsBlock({
  project,
  heading,
}: {
  project?: string;
  heading: "section" | "none";
}) {
  const w = words(GOALS_WORDS);
  const list = useQuery({
    queryKey: project ? ["goals", project] : ["goals"],
    queryFn: () => api.goals(project),
  });
  const tree = useQuery({ queryKey: ["goals"], queryFn: () => api.goals(), enabled: !!project });
  const { projects, names } = useGoalNames();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Goal | null>(null);
  const parents = (tree.data ?? list.data)?.goals.filter((goal) => goal.project === null) ?? [];

  const handleCreate = () => {
    setEditing(null);
    setOpen(true);
  };
  const handleEdit = (goal: Goal) => {
    setEditing(goal);
    setOpen(true);
  };
  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) setEditing(null);
  };

  return (
    <section className="grid gap-3" aria-label={w.goals}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        {heading === "section" ? (
          <div className="grid gap-1">
            <h2 className="font-display text-2xl font-extrabold tracking-tight">{w.goals}</h2>
            <p className="text-xs text-muted-foreground">{w.ladder}</p>
          </div>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          <Button type="button" onClick={handleCreate}>{w.newGoal}</Button>
        </div>
      </div>
      {list.isError ? (
        <p className="text-sm text-destructive">{w.loadFailed}</p>
      ) : !list.data ? (
        <Skeleton className="h-28 rounded-[20px]" />
      ) : (
        <GoalList
          goals={list.data.goals}
          names={names}
          onEdit={handleEdit}
        />
      )}
      <GoalDialog
        open={open}
        goal={editing}
        fixedProject={project}
        projects={projects}
        parents={parents}
        onOpenChange={handleOpenChange}
      />
    </section>
  );
}

/**
 * Inicio's goals. Below the wide breakpoint, one line under La máquina: «Metas», how many company goals are active
 * and their tasks done, a thin bar, «Ver metas» and «Nueva». From xl it is the narrow column beside La máquina: the
 * same summary, then the first three active goals each with its own bar, and it stays in view while the
 * projects scroll. «Nueva» opens the same dialog in place. Nothing shows until the list is read.
 * Bars grow from the left when a value changes, never on load.
 */
// Inicio's goals card. From xl, a 320px column beside La máquina: the first goal in the board's order leads (its title
// in the display face, its why in the headline's serif, its share done large, and one segment per initiative so it
// shows where the work stands), and the others follow as one quiet line each. Below xl it folds to one strip: the
// main goal and its share. «Ver metas» and «Nueva» close it either way.
export function GoalsHome() {
  const w = words(GOALS_WORDS);
  const l = metasLineaWords();
  const list = useQuery({ queryKey: ["goals"], queryFn: () => api.goals() });
  const { projects } = useGoalNames();
  const [open, setOpen] = useState(false);
  if (!list.data) return null;
  const goals = list.data.goals;
  const m = metasLinea(goals);
  const partes = metasLineaTexto(m);
  const { lista, mas } = metasPrincipales(goals);
  const [principal, ...resto] = lista;
  const otras = resto.length + mas;
  return (
    <section
      aria-labelledby="metas-titulo"
      className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border bg-card/60 px-4 py-2.5 xl:grid xl:content-start xl:gap-4 xl:rounded-2xl xl:p-4"
      data-metas-linea
    >
      {/* The same title as La máquina beside it: the green kicker, a heading only; «Ver metas» at the foot is the way in. */}
      <TituloTarjeta id="metas-titulo" icon={TargetIcon}>
        {w.goals}
      </TituloTarjeta>

      {principal ? (
        <>
          {/* Below xl: the main goal and its share, on the title's line. */}
          <span className="flex min-w-0 flex-1 basis-56 items-baseline gap-x-3 xl:hidden">
            <span className="min-w-0 truncate text-sm font-semibold" title={principal.title}>{principal.title}</span>
            {principal.progress.total > 0 ? (
              <Cifra value={`${porcentaje(principal.progress.done, principal.progress.total)}%`} className="font-display text-lg leading-none font-extrabold" />
            ) : null}
            {otras > 0 ? <span className="shrink-0 text-sm text-muted-foreground">{l.yMas(otras)}</span> : null}
          </span>
          <MetaPrincipal goal={principal} />
          {otras > 0 ? (
            <ul className="hidden gap-1.5 border-t pt-3 text-sm xl:grid" data-metas-resto>
              {resto.map((g) => (
                <li key={g.id} className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate" title={g.title}>{g.title}</span>
                  {g.progress.total > 0 ? (
                    <span className="shrink-0 text-muted-foreground tabular-nums" title={w.progress(g.progress.done, g.progress.total)}>
                      {porcentaje(g.progress.done, g.progress.total)}%
                    </span>
                  ) : null}
                </li>
              ))}
              {mas > 0 ? <li className="text-xs text-muted-foreground">{w.more(mas)}</li> : null}
            </ul>
          ) : null}
        </>
      ) : (
        // No active goal: the line says so (none yet, or none active).
        <p className="min-w-0 flex-1 text-sm text-muted-foreground">{partes.join(" · ")}</p>
      )}

      <span className="flex justify-between gap-3">
        <Button type="button" variant="ghost" size="sm" className="min-h-11 transition-[background-color,color,scale] active:scale-[0.97] motion-reduce:transition-none sm:min-h-8" onClick={() => setOpen(true)} data-control="metas-nueva">
          <PlusIcon aria-hidden /> {l.nueva}
        </Button>
        {m.hay ? <EnlaceVer to="/goals">{w.seeGoals}</EnlaceVer> : null}
      </span>
      <GoalDialog open={open} goal={null} projects={projects} parents={goals.filter((g) => g.project === null)} onOpenChange={setOpen} />
    </section>
  );
}

const SEG_CLASE: Record<Segmento, string> = {
  hecha: "bg-status-done",
  enCurso: "bg-status-now/70",
  porEmpezar: "shadow-[inset_0_0_0_1.5px_var(--status-pending)]",
};

/** The main goal, xl only: title, why, share done, and its initiatives as segments (or the tasks' bar when it has none). */
function MetaPrincipal({ goal }: { goal: Goal }) {
  const l = metasLineaWords();
  const segs = segmentosMeta(goal);
  const cuenta = (s: Segmento) => segs.filter((x) => x === s).length;
  const { done, total } = goal.progress;
  const detalle = [total > 0 && l.tareasDe(done, total), goal.target_on && l.para(dayText(goal.target_on))].filter(Boolean).join(" · ");
  return (
    <div className="hidden gap-2.5 xl:grid" data-meta-principal>
      <h3 className="m-0 font-display text-[21px] leading-[1.12] font-bold tracking-[-0.02em] text-balance">{goal.title}</h3>
      {goal.why.trim() ? <p className="m-0 line-clamp-3 font-voice text-lg leading-[1.2] text-foreground/70 italic">{goal.why}</p> : null}
      {total > 0 ? (
        <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <Cifra value={`${porcentaje(done, total)}%`} className="font-display text-4xl leading-none font-extrabold tracking-[-0.03em]" />
          {detalle ? <span className="text-xs text-muted-foreground">{detalle}</span> : null}
        </span>
      ) : detalle ? (
        <span className="text-xs text-muted-foreground">{detalle}</span>
      ) : null}
      {segs.length > 0 ? (
        <span className="grid gap-1.5">
          {/* Each segment's colour eases when its initiative moves on; the order (done first) keeps it filling left to right. */}
          <span className="flex gap-[3px]" role="img" aria-label={l.iniciativas(cuenta("hecha"), segs.length)}>
            {segs.map((s, k) => (
              <span key={k} className={cn("h-2 min-w-1 flex-1 rounded-[3px] transition-[background-color,box-shadow] duration-300 ease-out motion-reduce:transition-none", SEG_CLASE[s])} />
            ))}
          </span>
          {/* The key carries the counts, only for the kinds there are. */}
          <span aria-hidden className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11.5px] text-muted-foreground">
            {(["hecha", "enCurso", "porEmpezar"] as const).map((s) =>
              cuenta(s) > 0 ? (
                <span key={s} className="inline-flex items-center gap-1.5">
                  <span className={cn("h-1.5 w-2.5 rounded-[2px]", SEG_CLASE[s])} />
                  {l.segmento[s](cuenta(s))}
                </span>
              ) : null,
            )}
          </span>
        </span>
      ) : total > 0 ? (
        <Barra done={done} total={total} className="h-1.5" />
      ) : null}
    </div>
  );
}

/** A thin share-done bar; the fill grows from the left on change (a transition, so still on load). */
function Barra({ done, total, className }: { done: number; total: number; className?: string }) {
  return (
    <span aria-hidden className={cn("block h-1 overflow-hidden rounded-full bg-foreground/[0.08]", className)}>
      <span className="block h-full origin-left bg-status-done transition-transform duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none" style={{ transform: `scaleX(${total > 0 ? done / total : 0})` }} />
    </span>
  );
}

export function GoalsProject({ slug }: { slug: string }) {
  return <GoalsBlock project={slug} heading="section" />;
}

export function GoalsBoard() {
  return <GoalsBlock heading="none" />;
}
