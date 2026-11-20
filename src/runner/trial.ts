// PLA-I67-6: «Probar». The owner re-runs one past delivery of an agent with one version of a skill (the newest one
// they saved, on or off), to see what it changes before it reaches real work.
//   - The copy: a detached worktree at <root>/<project>/_trial-<id>, cut at the commit the delivery started from (the
//     merge base of its branch and the start branch). Never the delivery's branch, never its ticket, never its PR:
//     the run has no task_key (nothing is reported against the ticket), carries no Plania server at all, and its deny
//     rules (group «probar») refuse commits, pushes, branch moves and PR changes. The copy is removed when it ends.
//   - The run: an agent_runs row with trigger 'trial' and work_key trial:<id>, queued and admitted like any run, so
//     the company and project caps, the agent's cap, the machine and the plan guard all apply (src/runner/runner.ts).
//     It uses plan like any run; the screen says so.
//   - Before and after: the delivery's own last answer (read from its run log) and its diff from the base, next to
//     the trial's last answer and its diff; each with the "slug@hash" list of skills its run carried.
// A trial carries the seat's current «tu manera» and lessons (read only, so the run's knowledge rows and the
// references' counts never include it), its references are left out, and the tried skill replaces the seat's own.
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { agentRuns, projects, skillTrials, tasks, type Agent, type AgentRun, type SkillTrialRow, type TrialStatus } from "../db/schema.js";
import { ToolError } from "../mcp/errors.js";
import type { Q } from "../mcp/tx.js";
import type { KitWritten } from "./kit.js";
import { ownerEntry, resolvedKit, liveBySlug, seatOf, versionsOf, type ResolvedSkill } from "./skills.js";
import { parseStream } from "./stream.js";
import { startBranchOf } from "./start-branch.js";
import { defaultGit, repoPathOf, type GitFn } from "./worktree.js";
import { kitLines } from "./kit.js";
import { languageLine } from "./owner-language.js";
import { personalize } from "../owner.js";

export const TRIAL_OUTPUT_MAX = 6_000;
export const TRIAL_DIFF_MAX = 20_000;
export const TRIAL_SCOPE_MAX = 4_000;
export const TRIAL_DELIVERIES = 8;

export const trialWorkKey = (id: string) => `trial:${id}`;
export const trialIdOfRun = (run: Pick<AgentRun, "workKey">): string | null => (run.workKey.startsWith("trial:") ? run.workKey.slice("trial:".length) : null);
export const trialPathFor = (root: string, project: string, id: string): string => {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(project) || !/^[0-9a-f-]{36}$/.test(id)) throw new Error("unsafe worktree name");
  return path.join(root, project, `_trial-${id}`);
};

const cut = (s: string | null | undefined, max: number): string | null => {
  const t = (s ?? "").trim();
  if (!t) return null;
  return t.length > max ? `${t.slice(0, max)}\n…` : t;
};

// ---- What can be tried

export type TrialDelivery = { run_id: string; task_key: string; title: string; ended_at: string | null; skills: string[] };

// The agent's finished deliveries on a ticket with a branch, newest first, one per ticket.
export async function trialDeliveries(db: Db, project: string, agent: string, limit = TRIAL_DELIVERIES): Promise<TrialDelivery[]> {
  const a = await seatOf(db, project, agent);
  const rows = await db
    .select({ id: agentRuns.id, taskKey: agentRuns.taskKey, endedAt: agentRuns.endedAt, skills: agentRuns.skills, projectId: agentRuns.projectId, title: tasks.title })
    .from(agentRuns)
    .leftJoin(tasks, and(eq(tasks.projectId, agentRuns.projectId), eq(tasks.key, agentRuns.taskKey)))
    .where(and(eq(agentRuns.agentId, a.id), eq(agentRuns.status, "ok"), isNotNull(agentRuns.taskKey), isNotNull(agentRuns.branch)))
    .orderBy(desc(agentRuns.endedAt))
    .limit(200);
  const seen = new Set<string>();
  const out: TrialDelivery[] = [];
  for (const r of rows) {
    if (!r.taskKey || seen.has(r.taskKey)) continue;
    seen.add(r.taskKey);
    out.push({ run_id: r.id, task_key: r.taskKey, title: r.title ?? r.taskKey, ended_at: r.endedAt ? r.endedAt.toISOString() : null, skills: r.skills });
    if (out.length >= limit) break;
  }
  return out;
}

// ---- Making one

export type TrialDeps = { git?: GitFn; env?: NodeJS.ProcessEnv };

const noDelivery = (reason: string) => new ToolError("TRIAL_NO_DELIVERY", { reason });

// The last answer of a run, from its log (the stream's result event); null when the log is gone.
export function runAnswer(logPath: string | null): string | null {
  if (!logPath || !existsSync(logPath)) return null;
  try {
    const r = parseStream(readFileSync(logPath, "utf8"));
    r.end();
    return r.result?.resultText ?? null;
  } catch {
    return null;
  }
}

async function firstOk(git: GitFn, cwd: string, tries: string[][]): Promise<string | null> {
  for (const args of tries) {
    const r = await git(args, cwd).catch(() => null);
    if (r && r.code === 0 && r.stdout.trim()) return r.stdout.trim();
  }
  return null;
}

// The delivery's work as it is: its diff from the commit it started from. Read only (fetch, rev-parse, merge-base, diff).
export async function deliveryDiff(git: GitFn, repo: string, branch: string, start: string): Promise<{ ref: string; base: string; diff: string } | null> {
  await git(["fetch", "origin", start, branch], repo).catch(() => null);
  const ref = await firstOk(git, repo, [
    ["rev-parse", "--verify", "--quiet", `origin/${branch}^{commit}`],
    ["rev-parse", "--verify", "--quiet", `${branch}^{commit}`],
  ]);
  if (!ref) return null;
  const base = await firstOk(git, repo, [
    ["merge-base", `origin/${start}`, ref],
    ["merge-base", start, ref],
  ]);
  if (!base) return null;
  const stat = await git(["diff", "--stat", base, ref], repo).catch(() => null);
  const full = await git(["diff", base, ref], repo).catch(() => null);
  const diff = [stat?.code === 0 ? stat.stdout.trim() : "", full?.code === 0 ? full.stdout.trim() : ""].filter(Boolean).join("\n\n");
  return { ref, base, diff };
}

export async function createTrial(db: Db, project: string, agent: string, slug: string, input: { run_id: string }, deps: TrialDeps = {}): Promise<SkillTrialRow> {
  const a = await seatOf(db, project, agent);
  const row = await liveBySlug(db, slug);
  // A factory skill is tried once the owner edits it (that makes their copy, version 1 = the factory text).
  if (!row) throw new ToolError("SKILL_NOT_FOUND", { skill: slug });
  const v = (await versionsOf(db, row.id))[0]!;
  const [run] = await db
    .select()
    .from(agentRuns)
    .where(and(eq(agentRuns.id, input.run_id), eq(agentRuns.agentId, a.id), eq(agentRuns.status, "ok"), isNotNull(agentRuns.taskKey), isNotNull(agentRuns.branch)))
    .limit(1);
  if (!run) throw noDelivery("not_a_delivery");
  const [p] = await db.select().from(projects).where(eq(projects.id, run.projectId)).limit(1);
  const env = deps.env ?? process.env;
  const repo = repoPathOf(p!.slug, p!.settings, env);
  if (!existsSync(repo)) throw noDelivery("no_repo");
  const got = await deliveryDiff(deps.git ?? defaultGit, repo, run.branch!, startBranchOf(p!.settings));
  if (!got) throw noDelivery("branch_gone");
  const [t] = await db.select({ title: tasks.title }).from(tasks).where(and(eq(tasks.projectId, run.projectId), eq(tasks.key, run.taskKey!))).limit(1);
  const [made] = await db
    .insert(skillTrials)
    .values({
      skillId: row.id,
      agentId: a.id,
      projectId: run.projectId,
      versionN: v.n,
      versionStamp: `${slug}@${v.hash}`,
      taskKey: run.taskKey!,
      taskTitle: t?.title ?? "",
      beforeRunId: run.id,
      baseCommit: got.base,
      beforeStamp: run.skills.find((s) => s.startsWith(`${slug}@`)) ?? null,
      beforeSkills: run.skills,
      beforeOutput: cut(runAnswer(run.logPath) ?? run.summary, TRIAL_OUTPUT_MAX),
      beforeDiff: cut(got.diff, TRIAL_DIFF_MAX),
      status: "queued",
    })
    .returning();
  return made!;
}

export async function trialById(db: Db | Q, id: string): Promise<SkillTrialRow | null> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  return (await db.select().from(skillTrials).where(eq(skillTrials.id, id)).limit(1))[0] ?? null;
}

export async function setTrial(db: Db | Q, id: string, patch: Partial<Pick<SkillTrialRow, "runId" | "status" | "summary" | "afterSkills" | "afterOutput" | "afterDiff" | "finishedAt">>): Promise<void> {
  await db.update(skillTrials).set({ ...patch, ...(patch.summary !== undefined ? { summary: patch.summary.slice(0, 500) } : {}) }).where(eq(skillTrials.id, id));
}

// ---- The run

// The seat's own list with the tried version in place of its skill (added at the end when the seat does not carry it).
export async function trialKit(db: Db, agent: Agent, trial: SkillTrialRow, env: NodeJS.ProcessEnv, role: string | null): Promise<ResolvedSkill[]> {
  const base = await resolvedKit(db, agent, env, role);
  const versions = await versionsOf(db, trial.skillId);
  const version = versions.find((v) => v.n === trial.versionN) ?? versions[0]!;
  const slug = trial.versionStamp.split("@")[0]!;
  const row = (await liveBySlug(db, slug))!;
  const entry = ownerEntry({ row, version, versions: versions.length });
  const at = base.findIndex((s) => s.slug === slug);
  if (at >= 0) return base.map((s, i) => (i === at ? entry : s));
  return [...base, entry];
}

export function trialPrompt(input: { agent: string; role: string; project: { slug: string; title: string }; trial: Pick<SkillTrialRow, "taskKey" | "taskTitle" | "versionStamp">; scope: string | null; cwd: string; kit: KitWritten[] }): string {
  const lines = [
    `You are ${input.agent} (${input.role}) for project ${input.project.slug} (${input.project.title}), on a trial run the owner asked for.`,
    `The owner is trying a new version of one of your skills (${input.trial.versionStamp}) on a delivery you already made, to compare the two. Nothing you do here is delivered: Plania is not reachable in this run, and you must not commit, push, change branches or touch a pull request.`,
    `Redo this delivery: ${input.trial.taskKey}: ${input.trial.taskTitle || input.trial.taskKey}.`,
    ...(input.scope ? ["What it asked:", input.scope] : []),
    `Workspace: ${input.cwd}, a throwaway copy at the commit the delivery started from. Work in it as you would for the real ticket: change the files, run the checks you would run.`,
    "End with a short plain summary of what you did and why: the owner reads it next to the summary of the original delivery.",
    languageLine(),
    ...kitLines(input.kit),
  ];
  return personalize(lines.join("\n"));
}

export async function trialScope(db: Db, projectId: string, key: string): Promise<string | null> {
  const [t] = await db.select({ scope: tasks.scope }).from(tasks).where(and(eq(tasks.projectId, projectId), eq(tasks.key, key))).limit(1);
  return cut(t?.scope ?? null, TRIAL_SCOPE_MAX);
}

// The throwaway copy: a detached worktree at the base commit.
export async function addTrialCopy(input: { repo: string; target: string; base: string }, git: GitFn): Promise<{ ok: true } | { ok: false; summary: string }> {
  if (!/^[0-9a-f]{7,40}$/.test(input.base)) return { ok: false, summary: "fail: trial base" };
  if (existsSync(input.target)) rmSync(input.target, { recursive: true, force: true });
  await git(["worktree", "prune"], input.repo).catch(() => null);
  const added = await git(["worktree", "add", "--detach", input.target, input.base], input.repo).catch(() => null);
  return added && added.code === 0 ? { ok: true } : { ok: false, summary: "fail: trial copy" };
}

// What the trial changed in its copy (new files too), then the copy is removed.
export async function trialResult(git: GitFn, repo: string, cwd: string): Promise<string | null> {
  await git(["add", "-A", "-N", "."], cwd).catch(() => null);
  const stat = await git(["diff", "--stat"], cwd).catch(() => null);
  const full = await git(["diff"], cwd).catch(() => null);
  const diff = [stat?.code === 0 ? stat.stdout.trim() : "", full?.code === 0 ? full.stdout.trim() : ""].filter(Boolean).join("\n\n");
  await git(["worktree", "remove", "--force", cwd], repo).catch(() => null);
  return cut(diff, TRIAL_DIFF_MAX);
}

export const trialStatusOf = (s: "ok" | "fail" | "stopped" | "skipped"): TrialStatus => (s === "ok" ? "done" : s === "fail" ? "failed" : s);

// ---- Reading them

export type TrialView = {
  id: string;
  skill: string;
  status: TrialStatus;
  summary: string;
  created_at: string;
  finished_at: string | null;
  delivery: { task_key: string; title: string };
  before: { version: string | null; skills: string[]; output: string | null; diff: string | null };
  after: { version: string; skills: string[]; output: string | null; diff: string | null };
};

export const trialView = (t: SkillTrialRow): TrialView => ({
  id: t.id,
  skill: t.versionStamp.split("@")[0]!,
  status: t.status,
  summary: t.summary,
  created_at: t.createdAt.toISOString(),
  finished_at: t.finishedAt ? t.finishedAt.toISOString() : null,
  delivery: { task_key: t.taskKey, title: t.taskTitle },
  before: { version: t.beforeStamp, skills: t.beforeSkills, output: t.beforeOutput, diff: t.beforeDiff },
  after: { version: t.versionStamp, skills: t.afterSkills, output: t.afterOutput, diff: t.afterDiff },
});

export async function trialsOf(db: Db, project: string, agent: string, slug: string): Promise<TrialView[]> {
  const a = await seatOf(db, project, agent);
  const row = await liveBySlug(db, slug);
  if (!row) return [];
  const rows = await db
    .select()
    .from(skillTrials)
    .where(and(eq(skillTrials.skillId, row.id), eq(skillTrials.agentId, a.id)))
    .orderBy(desc(skillTrials.createdAt))
    .limit(10);
  return rows.map(trialView);
}

export async function trialOf(db: Db, project: string, agent: string, id: string): Promise<TrialView> {
  const a = await seatOf(db, project, agent);
  const t = await trialById(db, id);
  if (!t || t.agentId !== a.id) throw new ToolError("SKILL_NOT_FOUND", { trial: id });
  return trialView(t);
}


