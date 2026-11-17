// PLA-I40-1: why a run would not start now. One pure verdict, read by the runner's preflight (which
// skips or queues on it) and by the screen (which says it), so the two cannot disagree.
//   agentHold      the switches, the agent's rest between runs, a product owner without a goal
//   capacityHold  the plan guard, then the cap on runs at once
// The order is preflight's. Nothing here writes, and the screen's facts never probe usage.
import type { Agent, Project, RunnerSettings } from "../db/schema.js";
import type { Q } from "../mcp/tx.js";
import { readerOf } from "../store/port.js";
import { ne, notNull } from "../store/types.js";
import { lastReading, planView, type PlanView, type RunnerRole } from "./limits.js";

const MINUTE = 60_000;

export type HoldCode = "paused" | "rest" | "no_goal" | "usage" | "slot";
export type Hold = { code: HoldCode; scope?: "company" | "project"; startsAt: Date | null };

export type AgentFacts = {
  companyPaused: boolean;
  projectPaused: boolean;
  role: RunnerRole | null;
  cooldownMinutes: number;
  // When the agent's last run that really ran (not skipped) ended.
  lastEndedAt: Date | null;
  hasGoal: boolean;
  now: Date;
};
export type CapacityFacts = { plan: PlanView; running: number; maxConcurrent: number; now: Date };

export function agentHold(f: AgentFacts): Hold | null {
  if (f.companyPaused) return { code: "paused", scope: "company", startsAt: null };
  // Asistente works for the company: only the company switch holds it.
  if (f.projectPaused && f.role !== "asistente") return { code: "paused", scope: "project", startsAt: null };
  if (f.cooldownMinutes > 0 && f.lastEndedAt) {
    const until = f.lastEndedAt.getTime() + f.cooldownMinutes * MINUTE;
    if (f.now.getTime() < until) return { code: "rest", startsAt: new Date(until) };
  }
  if (f.role === "product-owner" && !f.hasGoal) return { code: "no_goal", startsAt: null };
  return null;
}

export function capacityHold(f: CapacityFacts): Hold | null {
  if (f.plan.state === "unknown" || f.plan.state === "stopped") {
    const resets = f.plan.state === "stopped" && f.plan.resets_at ? new Date(f.plan.resets_at) : null;
    return { code: "usage", startsAt: resets && resets.getTime() > f.now.getTime() ? resets : null };
  }
  if (f.running >= f.maxConcurrent) return { code: "slot", startsAt: null };
  return null;
}

export const holdOf = (own: AgentFacts, capacity: CapacityFacts): Hold | null => agentHold(own) ?? capacityHold(capacity);

// ---- The facts, read from the store

export async function projectGoal(db: Q, projectId: string): Promise<{ title: string; why: string } | null> {
  const [row] = await readerOf(db).find("goals", { projectId, status: "active" }, { orderBy: [{ column: "position" }, { column: "createdAt" }], limit: 1 });
  return row ? { title: row.title, why: row.why } : null;
}

// PLA-50: the owner's questions (consultas) have a lane of their own. A run is a question's when its id is some
// consulta's run_id. The general cap (max_concurrent) counts every other running run; the question lane counts only
// question runs, CONSULTA_SLOTS at a time. So a question never waits behind a long Artist or Taller run, and a
// question never takes the slot real work needs.
export const CONSULTA_SLOTS = 1;
export type Lane = "work" | "consulta";

export async function runningCount(db: Q, lane: Lane = "work"): Promise<number> {
  return readerOf(db).count("agentRuns", { status: ["starting", "running"], lane });
}

export async function agentFacts(
  db: Q,
  input: { agent: Agent; role: RunnerRole | null; project: Pick<Project, "id" | "runsPaused">; settings: RunnerSettings; now: Date },
): Promise<AgentFacts> {
  const { agent, role, project, settings, now } = input;
  let lastEndedAt: Date | null = null;
  if (settings.cooldownMinutes > 0) {
    // PLA-I60-4: only the agent's own periodic runs start its rest.
    const [last] = await readerOf(db).find(
      "agentRuns",
      { agentId: agent.id, trigger: "cadence", endedAt: notNull(), status: ne("skipped") },
      { orderBy: [{ column: "endedAt", desc: true }], limit: 1 },
    );
    lastEndedAt = last?.endedAt ?? null;
  }
  return {
    companyPaused: settings.companyPaused,
    projectPaused: project.runsPaused,
    role,
    cooldownMinutes: settings.cooldownMinutes,
    lastEndedAt,
    hasGoal: role !== "product-owner" || !!(await projectGoal(db, project.id)),
    now,
  };
}

// The last reading as it stands: preflight probes when it is unknown, the screen does not.
export async function capacityFacts(db: Q, settings: RunnerSettings, now: Date, lane: Lane = "work"): Promise<CapacityFacts> {
  return {
    plan: planView(await lastReading(db), settings.planGuardPct, now, settings.guardOverride),
    running: await runningCount(db, lane),
    maxConcurrent: lane === "consulta" ? CONSULTA_SLOTS : settings.maxConcurrent,
    now,
  };
}
