// PLA-I60-5: what Motores shows about «a la vez» for one project, read-only.
//   limits   the project's «Agentes a la vez», «Preguntas a la vez», «Por agente» (projects.settings.runner)
//   live     runs live now in its work lane and its question lane
//   ceiling  the company's «Tope de la máquina», runs live on the whole Mac (other projects included), slots reserved
//            (the Morning brief) and this worker's capacity («memoria para ~N»)
//   plan     the last 5-hour reading, the guard, and the plan weight per run, so the screen can show what the
//            queued runs that fit would add (the same weights admission uses, src/runner/admission.ts)
//   queue    every queued run of the project with its seat, title and why it waits (held_code + detail)
//   seats    per seat: its own «a la vez» (null: del piso), what it runs now and how many of its runs wait
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { agentRuns, agents, projects, runnerReservations, tasks, type Project } from "../db/schema.js";
import { agentCapOf, planWeight, projectLimits, workerCapacity } from "../runner/admission.js";
import { lastReading, loadSettings, planView } from "../runner/limits.js";
import { resolveMotor } from "../runner/motor.js";

export type RunnerLive = { run_id: string; ticket: string | null; title: string | null; kind: "ticket" | "idea" | "pregunta" | "general"; since: string | null; model: string | null; effort: string | null };
export type RunnerQueued = {
  run_id: string;
  agent: string;
  lane: "work" | "consulta";
  ticket: string | null;
  title: string | null;
  kind: RunnerLive["kind"];
  waited_min: number;
  held_code: string | null;
  held_detail: Record<string, unknown> | null;
  weight: number;
};
export type RunnerSeat = { agent: string; max_parallel: number | null; cap: number; live: RunnerLive[]; queued: number };
export type RunnerView = {
  limits: { max_concurrent: number; consulta_slots: number; max_per_agent: number; serialize_areas: boolean };
  live: { work: number; consulta: number };
  ceiling: { max: number; live: number; live_other_projects: number; reserved: number; capacity: number };
  plan: { pct: number | null; guard: number; state: string; override: boolean; est_pct: number; live_weight: number };
  queue: RunnerQueued[];
  seats: RunnerSeat[];
};

const kindOf = (lane: string, taskKind: string | null, key: string | null): RunnerLive["kind"] => (lane === "consulta" ? "pregunta" : !key ? "general" : taskKind === "idea" ? "idea" : "ticket");

export async function runnerView(db: Db, p: Pick<Project, "id" | "settings">, now = new Date()): Promise<RunnerView> {
  const settings = await loadSettings(db);
  const limits = projectLimits(p.settings?.runner);
  const rows = await db
    .select({ run: agentRuns, slug: agents.slug, agentProject: agents.projectId, maxParallel: agents.maxParallel, title: tasks.title, taskKind: tasks.kind })
    .from(agentRuns)
    .innerJoin(agents, eq(agents.id, agentRuns.agentId))
    .leftJoin(tasks, and(eq(tasks.projectId, agentRuns.projectId), eq(tasks.key, agentRuns.taskKey)))
    .where(and(eq(agentRuns.projectId, p.id), inArray(agentRuns.status, ["queued", "starting", "running"])))
    .orderBy(asc(agentRuns.queuedAt));
  const [all] = await db
    .select({ n: sql<number>`count(*)::int`, here: sql<number>`count(*) filter (where ${agentRuns.projectId} = ${p.id})::int` })
    .from(agentRuns)
    .where(inArray(agentRuns.status, ["starting", "running"]));
  const [res] = await db
    .select({ n: sql<number>`coalesce(sum(${runnerReservations.slots}), 0)::int` })
    .from(runnerReservations)
    .where(sql`${runnerReservations.expiresAt} > now()`);
  const reading = await lastReading(db);
  const view = planView(reading, settings.planGuardPct, now, settings.guardOverride);
  const liveRows = rows.filter((r) => r.run.status !== "queued");
  const liveWeight = liveRows.filter((r) => !reading || (r.run.startedAt && r.run.startedAt >= reading.at)).reduce((a, r) => a + (r.run.planWeight ?? 0), 0);

  const team = await db.select().from(agents).where(eq(agents.projectId, p.id));
  const weightOf = (agentId: string, lane: string) => {
    const a = team.find((x) => x.id === agentId);
    const m = resolveMotor({
      consulta: lane === "consulta",
      seat: { model: a?.motorModel ?? null, effort: a?.motorEffort ?? null, consultaModel: a?.consultaModel ?? null, consultaEffort: a?.consultaEffort ?? null },
      company: { model: settings.defaultModel, effort: settings.defaultEffort },
    });
    return planWeight(m.model, m.effort, settings.estPctPerRun);
  };
  const seats: RunnerSeat[] = team.map((a) => ({
    agent: a.slug,
    max_parallel: a.maxParallel,
    cap: agentCapOf(a, limits),
    live: liveRows
      .filter((r) => r.run.agentId === a.id && r.run.lane === "work")
      .map((r) => ({
        run_id: r.run.id,
        ticket: r.run.taskKey,
        title: r.title ?? null,
        kind: kindOf(r.run.lane, r.taskKind, r.run.taskKey),
        since: r.run.startedAt?.toISOString() ?? null,
        model: r.run.requestedModel,
        effort: r.run.requestedEffort,
      })),
    queued: rows.filter((r) => r.run.agentId === a.id && r.run.status === "queued" && r.run.lane === "work").length,
  }));
  return {
    limits: { max_concurrent: limits.maxConcurrent, consulta_slots: limits.consultaSlots, max_per_agent: limits.maxPerAgent, serialize_areas: limits.serializeAreas },
    live: { work: liveRows.filter((r) => r.run.lane === "work" && r.agentProject).length, consulta: liveRows.filter((r) => r.run.lane === "consulta").length },
    ceiling: { max: settings.maxConcurrent, live: all?.n ?? 0, live_other_projects: (all?.n ?? 0) - (all?.here ?? 0), reserved: res?.n ?? 0, capacity: workerCapacity() },
    plan: { pct: view.five_hour_pct, guard: view.guard_pct, state: view.state, override: view.override, est_pct: settings.estPctPerRun, live_weight: Math.round(liveWeight * 100) / 100 },
    queue: rows
      .filter((r) => r.run.status === "queued")
      .map((r) => ({
        run_id: r.run.id,
        agent: r.slug,
        lane: r.run.lane,
        ticket: r.run.taskKey,
        title: r.run.lane === "consulta" ? null : (r.title ?? null),
        kind: kindOf(r.run.lane, r.taskKind, r.run.taskKey),
        waited_min: Math.max(0, Math.round((now.getTime() - r.run.queuedAt.getTime()) / 60_000)),
        held_code: r.run.heldCode,
        held_detail: (r.run.heldDetail as Record<string, unknown> | null) ?? null,
        weight: weightOf(r.run.agentId, r.run.lane),
      })),
    seats,
  };
}

// The question text for queued question runs (the screen shows the question, not the run).
export async function projectOf(db: Db, slug: string): Promise<Project | null> {
  return (await db.select().from(projects).where(eq(projects.slug, slug)).limit(1))[0] ?? null;
}

// get_project's runner field: the limits and what is live, without the queue or the seats.
export async function runnerOfProject(db: Db, p: Pick<Project, "id" | "settings">): Promise<{ limits: RunnerView["limits"]; live: RunnerView["live"] }> {
  const v = await runnerView(db, p);
  return { limits: v.limits, live: v.live };
}
