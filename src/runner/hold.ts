// PLA-I40-1: why a run would not start now. One pure verdict, read by the runner's preflight (which
// skips or queues on it) and by the screen (which says it), so the two cannot disagree.
//   agentHold      the switches, the agent's rest between runs, a product owner without a goal
//   capacityHold  the plan guard, then the cap on runs at once
// The order is preflight's. Nothing here writes, and the screen's facts never probe usage.
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { agentRuns, goals, type Agent, type Project, type RunnerSettings } from "../db/schema.js";
import type { Q } from "../mcp/tx.js";
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

// ---- The facts, read from the database

export async function projectGoal(db: Q, projectId: string): Promise<{ title: string; why: string } | null> {
  const [row] = await db
    .select({ title: goals.title, why: goals.why })
    .from(goals)
    .where(and(eq(goals.projectId, projectId), eq(goals.status, "active")))
    .orderBy(asc(goals.position), asc(goals.createdAt))
    .limit(1);
  return row ?? null;
}

export async function runningCount(db: Q): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(agentRuns).where(eq(agentRuns.status, "running"));
  return row?.n ?? 0;
}

export async function agentFacts(
  db: Q,
  input: { agent: Agent; role: RunnerRole | null; project: Pick<Project, "id" | "runsPaused">; settings: RunnerSettings; now: Date },
): Promise<AgentFacts> {
  const { agent, role, project, settings, now } = input;
  let lastEndedAt: Date | null = null;
  if (settings.cooldownMinutes > 0) {
    const [last] = await db
      .select({ endedAt: agentRuns.endedAt })
      .from(agentRuns)
      .where(and(eq(agentRuns.agentId, agent.id), sql`${agentRuns.endedAt} is not null`, sql`${agentRuns.status} <> 'skipped'`))
      .orderBy(desc(agentRuns.endedAt))
      .limit(1);
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
export async function capacityFacts(db: Q, settings: RunnerSettings, now: Date): Promise<CapacityFacts> {
  return {
    plan: planView(await lastReading(db), settings.planGuardPct, now, settings.guardOverride),
    running: await runningCount(db),
    maxConcurrent: settings.maxConcurrent,
    now,
  };
}
