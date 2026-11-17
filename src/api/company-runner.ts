// PLA-I60-5: what Motores shows about «a la vez» for one project, read-only.
//   limits   the project's «Agentes a la vez», «Preguntas a la vez», «Por agente» (projects.settings.runner)
//   live     runs live now in its work lane and its question lane
//   ceiling  the company's «Tope de la Mac», runs live on the whole Mac (other projects included), slots reserved
//            (the Morning brief) and this worker's capacity («memoria para ~N»)
//   plan     the last 5-hour reading, the guard, and the plan weight per run, so the screen can show what the
//            queued runs that fit would add (the same weights admission uses, src/runner/admission.ts)
//   queue    every queued run of the project with its seat, title and why it waits (held_code + detail)
//   seats    per seat: its own «a la vez» (null: del piso), what it runs now and how many of its runs wait
import type { Db } from "../db/client.js";
import type { AgentRun, Project } from "../db/schema.js";
import { agentCapOf, planWeight, projectLimits, workerCapacity } from "../runner/admission.js";
import { lastReading, loadSettings, planView } from "../runner/limits.js";
import { resolveMotor } from "../runner/motor.js";
import { readerOf } from "../store/port.js";
import { gt } from "../store/types.js";

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
  const r = readerOf(db);
  // The project's active runs, oldest first, each with its seat (a run whose agent is gone is left out) and its
  // ticket's title and kind when it has one.
  const rows: { run: AgentRun; slug: string; agentProject: string | null; maxParallel: number | null; title: string | null; taskKind: string | null }[] = [];
  const active = await r.find("agentRuns", { projectId: p.id, status: ["queued", "starting", "running"] }, { orderBy: [{ column: "queuedAt" }] });
  for (const run of active) {
    const a = await r.get("agents", { id: run.agentId });
    if (!a) continue;
    const t = run.taskKey ? await r.get("tasks", { projectId: run.projectId, key: run.taskKey }) : undefined;
    rows.push({ run, slug: a.slug, agentProject: a.projectId, maxParallel: a.maxParallel, title: t?.title ?? null, taskKind: t?.kind ?? null });
  }
  const live = await r.find("agentRuns", { status: ["starting", "running"] });
  const all = { n: live.length, here: live.filter((x) => x.projectId === p.id).length };
  const reserved = (await r.find("runnerReservations", { expiresAt: gt(new Date()) })).reduce((a, x) => a + x.slots, 0);
  const reading = await lastReading(db);
  const view = planView(reading, settings.planGuardPct, now, settings.guardOverride);
  const liveRows = rows.filter((x) => x.run.status !== "queued");
  const liveWeight = liveRows.filter((x) => !reading || (x.run.startedAt && x.run.startedAt >= reading.at)).reduce((a, x) => a + (x.run.planWeight ?? 0), 0);

  const team = await r.find("agents", { projectId: p.id });
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
      .filter((x) => x.run.agentId === a.id && x.run.lane === "work")
      .map((x) => ({
        run_id: x.run.id,
        ticket: x.run.taskKey,
        title: x.title ?? null,
        kind: kindOf(x.run.lane, x.taskKind, x.run.taskKey),
        since: x.run.startedAt?.toISOString() ?? null,
        model: x.run.requestedModel,
        effort: x.run.requestedEffort,
      })),
    queued: rows.filter((x) => x.run.agentId === a.id && x.run.status === "queued" && x.run.lane === "work").length,
  }));
  return {
    limits: { max_concurrent: limits.maxConcurrent, consulta_slots: limits.consultaSlots, max_per_agent: limits.maxPerAgent, serialize_areas: limits.serializeAreas },
    live: { work: liveRows.filter((x) => x.run.lane === "work" && x.agentProject).length, consulta: liveRows.filter((x) => x.run.lane === "consulta").length },
    ceiling: { max: settings.maxConcurrent, live: all.n, live_other_projects: all.n - all.here, reserved, capacity: workerCapacity() },
    plan: { pct: view.five_hour_pct, guard: view.guard_pct, state: view.state, override: view.override, est_pct: settings.estPctPerRun, live_weight: Math.round(liveWeight * 100) / 100 },
    queue: rows
      .filter((x) => x.run.status === "queued")
      .map((x) => ({
        run_id: x.run.id,
        agent: x.slug,
        lane: x.run.lane,
        ticket: x.run.taskKey,
        title: x.run.lane === "consulta" ? null : (x.title ?? null),
        kind: kindOf(x.run.lane, x.taskKind, x.run.taskKey),
        waited_min: Math.max(0, Math.round((now.getTime() - x.run.queuedAt.getTime()) / 60_000)),
        held_code: x.run.heldCode,
        held_detail: (x.run.heldDetail as Record<string, unknown> | null) ?? null,
        weight: weightOf(x.run.agentId, x.run.lane),
      })),
    seats,
  };
}

// The question text for queued question runs (the screen shows the question, not the run).
export async function projectOf(db: Db, slug: string): Promise<Project | null> {
  return (await readerOf(db).get("projects", { slug })) ?? null;
}

// get_project's runner field: the limits and what is live, without the queue or the seats.
export async function runnerOfProject(db: Db, p: Pick<Project, "id" | "settings">): Promise<{ limits: RunnerView["limits"]; live: RunnerView["live"] }> {
  const v = await runnerView(db, p);
  return { limits: v.limits, live: v.live };
}
