// PLA-I29: what the Compañía page reads (one call), and the writes only Jorge's screen makes:
// the company and project switches and the runner's knobs. No token budgets (PLA-21).
// No MCP tool reaches any of these writes.
import { asc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { agentRuns, agents, projects, runnerSettings } from "../db/schema.js";
import { findProject } from "../mcp/queries.js";
import { webCtx, writeTx } from "../mcp/tx.js";
import { lastReading, loadSettings, planView, screenTz, weekBounds, weekUsage, type PlanView, type WeekUsage } from "./limits.js";
import { latestBrief, type Brief } from "./asistente.js";
import { stopLive } from "./runner.js";

export type RunView = {
  id: string;
  agent: string;
  role: string;
  project: string;
  ticket: string | null;
  status: "running" | "queued";
  queued_at: string;
  started_at: string | null;
  turns: number;
  tokens: number;
};

export type CompanyState = {
  company: { paused: boolean; paused_at: string | null };
  settings: { max_concurrent: number; cooldown_minutes: number; plan_guard_pct: number; guard_override: boolean; reserve_tokens: number; max_turns: number; timeout_minutes: number };
  week: { starts_at: string; resets_at: string; timezone: string };
  projects: { slug: string; title: string; paused: boolean; paused_at: string | null; usage: WeekUsage }[];
  runs: { live: RunView[]; queued: RunView[] };
  plan: PlanView;
  // PLA-I31-2: the latest Asistente brief (07:00 daily), or null before the first one.
  brief: Brief | null;
};

export async function companyState(db: Db, now = new Date()): Promise<CompanyState> {
  const settings = await loadSettings(db);
  const tz = screenTz();
  const { startsAt, resetsAt } = await weekBounds(db, now, tz);
  const projectRows = await db.select().from(projects).orderBy(asc(projects.slug));
  const projectsOut = [];
  for (const p of projectRows) {
    projectsOut.push({
      slug: p.slug,
      title: p.title,
      paused: p.runsPaused,
      paused_at: p.runsPausedAt?.toISOString() ?? null,
      usage: await weekUsage(db, { kind: "project", projectId: p.id }, startsAt),
    });
  }

  const runRows = await db
    .select({
      id: agentRuns.id,
      agent: agents.slug,
      role: agentRuns.role,
      project: projects.slug,
      ticket: agentRuns.taskKey,
      status: agentRuns.status,
      queuedAt: agentRuns.queuedAt,
      startedAt: agentRuns.startedAt,
      turns: agentRuns.turns,
      tokens: agentRuns.tokensTotal,
    })
    .from(agentRuns)
    .innerJoin(agents, eq(agents.id, agentRuns.agentId))
    .innerJoin(projects, eq(projects.id, agentRuns.projectId))
    .where(inArray(agentRuns.status, ["running", "queued"]))
    .orderBy(asc(agentRuns.queuedAt));
  const view = (r: (typeof runRows)[number]): RunView => ({
    id: r.id,
    agent: r.agent,
    role: r.role,
    project: r.project,
    ticket: r.ticket,
    status: r.status as "running" | "queued",
    queued_at: r.queuedAt.toISOString(),
    started_at: r.startedAt?.toISOString() ?? null,
    turns: r.turns,
    tokens: Number(r.tokens),
  });

  return {
    company: { paused: settings.companyPaused, paused_at: settings.companyPausedAt?.toISOString() ?? null },
    settings: {
      max_concurrent: settings.maxConcurrent,
      cooldown_minutes: settings.cooldownMinutes,
      plan_guard_pct: settings.planGuardPct,
      guard_override: settings.guardOverride,
      reserve_tokens: settings.reserveTokens,
      max_turns: settings.maxTurns,
      timeout_minutes: settings.timeoutMinutes,
    },
    week: { starts_at: startsAt.toISOString(), resets_at: resetsAt.toISOString(), timezone: tz },
    projects: projectsOut,
    runs: { live: runRows.filter((r) => r.status === "running").map(view), queued: runRows.filter((r) => r.status === "queued").map(view) },
    plan: planView(await lastReading(db), settings.planGuardPct, now, settings.guardOverride),
    brief: await latestBrief(db),
  };
}

// Off: no new runs, live runs get SIGINT. On again: project switches stay as they are,
// so a project Jorge paused on its own stays paused.
export async function setCompanyPaused(db: Db, paused: boolean): Promise<{ paused: boolean; stopped: number }> {
  await loadSettings(db);
  await db
    .update(runnerSettings)
    .set({ companyPaused: paused, companyPausedAt: paused ? new Date() : null, updatedAt: sql`now()` })
    .where(eq(runnerSettings.id, 1));
  const stopped = paused ? stopLive(() => true, "company paused") : 0;
  return { paused, stopped };
}

export async function setProjectPaused(db: Db, slug: string, paused: boolean): Promise<{ project: string; paused: boolean; stopped: number }> {
  const project = await findProject(db, slug);
  await writeTx(db, project, { ...webCtx, tool: "screen.runs_paused" }, async (tx, emit) => {
    await tx
      .update(projects)
      .set({ runsPaused: paused, runsPausedAt: paused ? new Date() : null, updatedAt: sql`now()` })
      .where(eq(projects.id, project.id));
    await emit(paused ? "project.runs_paused" : "project.runs_resumed", null, {});
  });
  const stopped = paused ? stopLive((run) => run.projectId === project.id && run.role !== "asistente", `project ${project.slug} paused`) : 0;
  return { project: project.slug, paused, stopped };
}


export type SettingsPatch = Partial<{
  max_concurrent: number;
  cooldown_minutes: number;
  plan_guard_pct: number;
  guard_override: boolean;
  reserve_tokens: number;
  max_turns: number;
  timeout_minutes: number;
}>;

export async function setRunnerSettings(db: Db, patch: SettingsPatch): Promise<CompanyState["settings"]> {
  await loadSettings(db);
  const set: Record<string, unknown> = { updatedAt: sql`now()` };
  if (patch.max_concurrent !== undefined) set.maxConcurrent = patch.max_concurrent;
  if (patch.cooldown_minutes !== undefined) set.cooldownMinutes = patch.cooldown_minutes;
  if (patch.plan_guard_pct !== undefined) set.planGuardPct = patch.plan_guard_pct;
  if (patch.guard_override !== undefined) set.guardOverride = patch.guard_override;
  if (patch.reserve_tokens !== undefined) set.reserveTokens = patch.reserve_tokens;
  if (patch.max_turns !== undefined) set.maxTurns = patch.max_turns;
  if (patch.timeout_minutes !== undefined) set.timeoutMinutes = patch.timeout_minutes;
  await db.update(runnerSettings).set(set).where(eq(runnerSettings.id, 1));
  const s = await loadSettings(db);
  return {
    max_concurrent: s.maxConcurrent,
    cooldown_minutes: s.cooldownMinutes,
    plan_guard_pct: s.planGuardPct,
    guard_override: s.guardOverride,
    reserve_tokens: s.reserveTokens,
    max_turns: s.maxTurns,
    timeout_minutes: s.timeoutMinutes,
  };
}
