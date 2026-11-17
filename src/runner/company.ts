// PLA-I29: what the Compañía page reads (one call), and the writes only Jorge's screen makes:
// the company and project switches and the runner's knobs. No token budgets (PLA-21).
// No MCP tool reaches any of these writes.
import type { Db } from "../db/client.js";
import type { RunnerSettings } from "../db/schema.js";
import { findProject } from "../mcp/queries.js";
import { webCtx, writeTx } from "../mcp/tx.js";
import { storeOf, readerOf, uowOf } from "../store/port.js";
import { COMPANY, lastReading, loadSettings, planView, screenTz, weekBounds, weekUsage, type PlanView, type WeekUsage } from "./limits.js";
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
  settings: { max_concurrent: number; cooldown_minutes: number; plan_guard_pct: number; guard_override: boolean; reserve_tokens: number; max_turns: number; timeout_minutes: number; default_model: string | null; default_effort: string | null };
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
  const r = readerOf(db);
  const projectRows = await r.find("projects", {}, { orderBy: [{ column: "slug" }] });
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

  // Live and queued runs, oldest first, with their agent's and project's slugs (a run missing either is left out).
  const slugOfProject = new Map(projectRows.map((p) => [p.id, p.slug]));
  const runRows: { id: string; agent: string; role: string; project: string; ticket: string | null; status: string; queuedAt: Date; startedAt: Date | null; turns: number; tokens: number }[] = [];
  for (const run of await r.find("agentRuns", { status: ["running", "queued"] }, { orderBy: [{ column: "queuedAt" }] })) {
    const agent = await r.get("agents", { id: run.agentId });
    const project = slugOfProject.get(run.projectId);
    if (!agent || project === undefined) continue;
    runRows.push({
      id: run.id,
      agent: agent.slug,
      role: run.role,
      project,
      ticket: run.taskKey,
      status: run.status,
      queuedAt: run.queuedAt,
      startedAt: run.startedAt,
      turns: run.turns,
      tokens: run.tokensTotal,
    });
  }
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
      default_model: settings.defaultModel,
      default_effort: settings.defaultEffort,
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
  await storeOf(db).write(COMPANY, {}, (uow) =>
    uow.update("runnerSettings", { id: 1 }, { companyPaused: paused, companyPausedAt: paused ? uow.now : null, updatedAt: uow.now }),
  );
  const stopped = paused ? stopLive(() => true, "company paused") : 0;
  return { paused, stopped };
}

export async function setProjectPaused(db: Db, slug: string, paused: boolean): Promise<{ project: string; paused: boolean; stopped: number }> {
  const project = await findProject(db, slug);
  await writeTx(db, project, { ...webCtx, tool: "screen.runs_paused" }, async (tx, emit) => {
    const uow = uowOf(tx);
    await uow.update("projects", { id: project.id }, { runsPaused: paused, runsPausedAt: paused ? uow.now : null, updatedAt: uow.now });
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
  // PLA-I59-1: the company's default motor; null clears it (the CLI's own default).
  default_model: string | null;
  default_effort: string | null;
}>;

export async function setRunnerSettings(db: Db, patch: SettingsPatch): Promise<CompanyState["settings"]> {
  await loadSettings(db);
  const set: Partial<RunnerSettings> = {};
  if (patch.max_concurrent !== undefined) set.maxConcurrent = patch.max_concurrent;
  if (patch.cooldown_minutes !== undefined) set.cooldownMinutes = patch.cooldown_minutes;
  if (patch.plan_guard_pct !== undefined) set.planGuardPct = patch.plan_guard_pct;
  if (patch.guard_override !== undefined) set.guardOverride = patch.guard_override;
  if (patch.reserve_tokens !== undefined) set.reserveTokens = patch.reserve_tokens;
  if (patch.max_turns !== undefined) set.maxTurns = patch.max_turns;
  if (patch.timeout_minutes !== undefined) set.timeoutMinutes = patch.timeout_minutes;
  if (patch.default_model !== undefined) set.defaultModel = patch.default_model;
  if (patch.default_effort !== undefined) set.defaultEffort = patch.default_effort;
  await storeOf(db).write(COMPANY, {}, (uow) => uow.update("runnerSettings", { id: 1 }, { ...set, updatedAt: uow.now }));
  const s = await loadSettings(db);
  return {
    max_concurrent: s.maxConcurrent,
    cooldown_minutes: s.cooldownMinutes,
    plan_guard_pct: s.planGuardPct,
    guard_override: s.guardOverride,
    reserve_tokens: s.reserveTokens,
    max_turns: s.maxTurns,
    timeout_minutes: s.timeoutMinutes,
    default_model: s.defaultModel,
    default_effort: s.defaultEffort,
  };
}
