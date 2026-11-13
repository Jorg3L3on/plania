// PLA-I31-1: events wake the right role; the cadence stays as the slow fallback.
//   ticket → Ready (a move, not a creation)  wakes Taller, on that ticket
//   ticket Ready owned by a PO (moved or created Ready)  wakes that PO, on that ticket (PLA-I30-6)
//   question answered                         wakes whoever asked it (a runner session or a roster slug)
//   pr.reviewed / pr.ci_failed (GitHub job)   wakes Taller, on the PR's ticket
//   idea stage → research / → design          wakes Research / Artist, on the idea
//   project resumed (runs_resumed)            wakes that project's PO (a new project's first wake)
//   question asked by a PO (not human_only)   wakes Asistente, on that ticket (PLA-I32-5)
//   thread.message from Jorge, company thread  wakes Asistente (PLA-I32-3); in a project thread the screen
//                                             route makes a Ready PO ticket instead, which wakes the PO
//   ticket → Merged, Released or Done          wakes Taller, on the first Ready ticket it was blocking (PLA-15)
//   a runner run's lease expired (reaper)      wakes Taller (or the PO that owns it), on that ticket (PLA-16)
// A run that ended in fail holding its ticket is not an event: src/runner/failed.ts sweeps it each tick.
// The hook runs inside writeTx, in the same transaction as the write, and only queues: it inserts an
// agent_runs row with status queued. The heartbeat job's drainQueue starts it through every runner
// check (switches, cooldown, goal, base branch, plan guard, cap). Coalescing: an agent with a
// queued or running run gets nothing new. A company or project switch that is off enqueues nothing.
// Off unless the heartbeat job runs (PLANIA_JOBS=1), so nothing waits in a queue nobody drains.
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { agentRuns, agents, events, projects, taskBlockers, tasks, type Actor, type Agent } from "../db/schema.js";
import { hasUnsatisfiedBlocker } from "../mcp/blockers.js";
import type { Q } from "../mcp/tx.js";
import { loadSettings, roleOf, type RunnerRole } from "./limits.js";

export const EVENT_SUMMARY = "queued: event";
const RUNNER_ADAPTER = "claude_code";
const TALLER_WORK = new Set(["code", "bug", "debt", "ops"]);
// PLA-15: the statuses where a ticket's work is in the integration branch (or needed no merge).
const LANDED = new Set(["Merged", "Released", "Done"]);
const PRIORITY = ["P0", "P1", "P2", "P3"];

export const eventWakesEnabled = (env: NodeJS.ProcessEnv = process.env): boolean => env.PLANIA_JOBS === "1" || env.PLANIA_EVENT_WAKES === "1";

// A runner run writes as session run-<first 8 of its agent_runs id> (see userPrompt in runner.ts).
export const isRunSession = (sessionId: string | null | undefined): boolean => /^run-[0-9a-f]{8}$/.test(sessionId ?? "");

export type EventWake =
  | { kind: "queued"; runId: string; agent: string; role: RunnerRole; taskKey: string | null; reason: string }
  | { kind: "none"; reason: string };

type ProjectRef = { id: string; slug: string };
type TaskRef = { id: string; key: string } | null;

// PLA-I32-5: the runner agent for a role in a project is that project's team member (project_id). Only when
// the project has no such member does a company-level row (no project, before 0041) take it: the one named
// after the role first, else the first by slug. A member of another project's team never does.
export async function serviceAgent(tx: Q, role: RunnerRole, project: ProjectRef): Promise<Agent | null> {
  const rows = await tx.select().from(agents).where(and(eq(agents.adapter, RUNNER_ADAPTER), sql`${agents.status} <> 'retired'`)).orderBy(asc(agents.slug));
  const matching = rows.filter((a) => roleOf(a) === role);
  const team = matching.filter((a) => a.projectId === project.id);
  if (team.length) return team[0]!;
  const shared = matching.filter((a) => !a.projectId);
  return shared.find((a) => a.slug === role) ?? shared[0] ?? null;
}

// Who asked: a runner session is run-<first 8 of the agent_runs id> (see userPrompt); otherwise the
// actor's agent may be a roster slug.
export async function agentOfActor(tx: Q, actor: Actor | null | undefined): Promise<Agent | null> {
  if (!actor) return null;
  const m = /^run-([0-9a-f]{8})$/.exec(actor.session_id ?? "");
  if (m) {
    const [run] = await tx
      .select({ agentId: agentRuns.agentId })
      .from(agentRuns)
      .where(sql`${agentRuns.id}::text like ${`${m[1]}%`}`)
      .limit(1);
    if (run) {
      const [row] = await tx.select().from(agents).where(eq(agents.id, run.agentId)).limit(1);
      if (row) return row;
    }
  }
  const slug = (actor.agent ?? "").trim().toLowerCase();
  if (!slug) return null;
  const [row] = await tx.select().from(agents).where(eq(agents.slug, slug)).limit(1);
  return row ?? null;
}

// PLA-I32-3: the chief of staff on the runner (role_template asistente, else the old rules).
export async function asistenteAgent(tx: Q): Promise<Agent | null> {
  const rows = await tx.select().from(agents).where(and(eq(agents.adapter, RUNNER_ADAPTER), sql`${agents.status} <> 'retired'`)).orderBy(asc(agents.slug));
  const matching = rows.filter((a) => roleOf(a) === "asistente");
  return matching.find((a) => a.slug === "asistente") ?? matching[0] ?? null;
}

async function poOf(tx: Q, project: ProjectRef): Promise<Agent | null> {
  const rows = await tx.select().from(agents).where(and(eq(agents.adapter, RUNNER_ADAPTER), sql`${agents.status} <> 'retired'`)).orderBy(asc(agents.slug));
  const pos = rows.filter((a) => roleOf(a) === "product-owner");
  return (
    pos.find((a) => a.projectId === project.id) ??
    pos.find((a) => !a.projectId && (a.slug === `po-${project.slug}` || a.capabilities.includes(project.slug))) ??
    null
  );
}

// PLA-15: the steps of a plan are created Ready and wait on blocked_by, so no move to Ready ever wakes
// Taller on step N+1: the landing of step N does. The Ready ticket this one was blocking that Taller may
// take (its own, or unowned Taller work; never [PRUEBA]), with every ticket it waits on landed too (a
// blocker still In review holds by the blocker rule, but its code is not in the branch yet) and every
// other blocker holding. Several freed at once: the project's next_first, then priority, phase, key.
export async function freedBy(tx: Q, project: ProjectRef, landedId: string, taller: Agent | null): Promise<string | null> {
  if (!taller) return null;
  const rows = await tx
    .select({ key: tasks.key, title: tasks.title, priority: tasks.priority, phase: tasks.phase, workType: tasks.workType, ownerAgent: tasks.ownerAgent })
    .from(tasks)
    .innerJoin(taskBlockers, and(eq(taskBlockers.taskId, tasks.id), eq(taskBlockers.blockerId, landedId)))
    .where(
      and(
        eq(tasks.projectId, project.id),
        eq(tasks.kind, "ticket"),
        eq(tasks.status, "Ready"),
        sql`not ${hasUnsatisfiedBlocker(tasks.id)}`,
        sql`not exists (
          select 1 from ${taskBlockers} tb join ${tasks} b on b.id = tb.blocker_id
          where tb.task_id = ${tasks.id} and tb.blocker_id <> ${landedId}::uuid and b.status not in ('Merged', 'Released', 'Done')
        )`,
      ),
    );
  const [p] = await tx.select({ settings: projects.settings }).from(projects).where(eq(projects.id, project.id)).limit(1);
  const first = p?.settings.next_first;
  const rank = (priority: string | null) => (PRIORITY.includes(priority ?? "") ? PRIORITY.indexOf(priority!) : PRIORITY.length);
  const mine = rows
    .filter((t) => !t.title.includes("[PRUEBA]") && (t.ownerAgent ? t.ownerAgent === taller.id : !!t.workType && TALLER_WORK.has(t.workType)))
    .sort(
      (a, b) =>
        Number(b.key === first) - Number(a.key === first) ||
        rank(a.priority) - rank(b.priority) ||
        (a.phase ?? Number.MAX_SAFE_INTEGER) - (b.phase ?? Number.MAX_SAFE_INTEGER) ||
        a.key.localeCompare(b.key, "en", { numeric: true }),
    );
  return mine[0]?.key ?? null;
}

// Queue one wake, or say why not. Never spawns.
export async function enqueueWake(
  tx: Q,
  input: { agent: Agent | null; project: ProjectRef; taskKey: string | null; reason: string; now?: Date },
): Promise<EventWake> {
  const { agent, project } = input;
  if (!agent) return { kind: "none", reason: "no agent" };
  if (agent.adapter !== RUNNER_ADAPTER) return { kind: "none", reason: "not a runner agent" };
  const role = roleOf(agent);
  if (!role) return { kind: "none", reason: "no runner role" };
  const settings = await loadSettings(tx);
  if (settings.companyPaused) return { kind: "none", reason: "company paused" };
  // Asistente works for the company: its home project's switch does not hold it (the company switch does).
  const [p] = await tx.select({ paused: projects.runsPaused }).from(projects).where(eq(projects.id, project.id)).limit(1);
  if (!p || (p.paused && role !== "asistente")) return { kind: "none", reason: `project ${project.slug} paused` };
  const [busy] = await tx
    .select({ id: agentRuns.id })
    .from(agentRuns)
    .where(and(eq(agentRuns.agentId, agent.id), inArray(agentRuns.status, ["queued", "running"])))
    .limit(1);
  if (busy) return { kind: "none", reason: "coalesced" };
  const [row] = await tx
    .insert(agentRuns)
    .values({
      agentId: agent.id,
      projectId: project.id,
      taskKey: input.taskKey,
      role,
      status: "queued",
      summary: `${EVENT_SUMMARY} ${input.reason}`.slice(0, 500),
      queuedAt: input.now ?? new Date(),
      reserveTokens: settings.reserveTokens,
    })
    .returning({ id: agentRuns.id });
  return { kind: "queued", runId: row!.id, agent: agent.slug, role, taskKey: input.taskKey, reason: input.reason };
}

// What an emitted event should wake, if anything. Read-only; enqueueWake decides the rest.
async function targetOf(
  tx: Q,
  project: ProjectRef,
  type: string,
  task: TaskRef,
  payload: Record<string, unknown>,
): Promise<{ agent: Agent | null; taskKey: string | null; reason: string } | null> {
  if (type === "project.runs_resumed") return { agent: await poOf(tx, project), taskKey: null, reason: "project resumed" };
  if (type === "thread.message") {
    if (payload.thread_kind !== "company" || payload.author !== "jorge") return null;
    return { agent: await asistenteAgent(tx), taskKey: null, reason: "message from Jorge" };
  }
  if (!task) return null;

  // PLA-I30-6: a ticket a product owner owns wakes that PO when it is Ready, created that way included
  // (Pedirle al PO creates it Ready). Taller still wakes on a move only.
  // PLA-16: a runner run's lease that ran out (the run ended without finishing or freeing its ticket) puts
  // the ticket back in Ready like a move. A person's or another client's expired lease wakes nobody.
  const runnerLeaseExpired =
    type === "claim.expired" && payload.from === "In progress" && payload.to === "Ready" && isRunSession((payload.owner as Actor | null | undefined)?.session_id);
  const readyNow =
    (type === "task.status" && payload.to === "Ready" && payload.from !== "Ready") ||
    (type === "task.created" && payload.kind === "ticket" && payload.status === "Ready") ||
    runnerLeaseExpired;
  if (readyNow) {
    const [t] = await tx
      .select({ kind: tasks.kind, title: tasks.title, workType: tasks.workType, ownerAgent: tasks.ownerAgent })
      .from(tasks)
      .where(eq(tasks.id, task.id))
      .limit(1);
    if (!t || t.kind !== "ticket" || t.title.includes("[PRUEBA]")) return null;
    if (t.ownerAgent) {
      const [owner] = await tx.select().from(agents).where(eq(agents.id, t.ownerAgent)).limit(1);
      if (owner && roleOf(owner) === "product-owner") return { agent: owner, taskKey: task.key, reason: "ticket ready" };
    }
    if (type === "task.created") return null;
    const taller = await serviceAgent(tx, "taller", project);
    if (t.ownerAgent && t.ownerAgent !== taller?.id) return null;
    if (!t.ownerAgent && !(t.workType && TALLER_WORK.has(t.workType))) return null;
    return { agent: taller, taskKey: task.key, reason: runnerLeaseExpired ? "lease expired" : "ticket ready" };
  }
  // PLA-15: a ticket lands once (In review → Merged; Merged → Released → Done after it is not a landing).
  if (type === "task.status" && LANDED.has(String(payload.to)) && !LANDED.has(String(payload.from))) {
    const taller = await serviceAgent(tx, "taller", project);
    const next = await freedBy(tx, project, task.id, taller);
    return next ? { agent: taller, taskKey: next, reason: `unblocked by ${task.key}` } : null;
  }
  if (type === "pr.ci_failed" || type === "pr.reviewed") {
    return { agent: await serviceAgent(tx, "taller", project), taskKey: task.key, reason: type === "pr.ci_failed" ? "ci red" : "pr review" };
  }
  // PLA-I32-5: a PO's question goes to Asistente first; it answers what Plania already says, or leaves it to Jorge.
  if (type === "question.asked") {
    const id = typeof payload.question_id === "string" ? payload.question_id : null;
    if (!id || payload.human_only === true) return null;
    const [q] = await tx.execute<{ asked_by: Actor }>(sql`select asked_by from questions where id = ${id}::uuid limit 1`).then((r) => r.rows);
    const asker = await agentOfActor(tx, q?.asked_by);
    if (!asker || roleOf(asker) !== "product-owner") return null;
    return { agent: await asistenteAgent(tx), taskKey: task.key, reason: `question from ${asker.slug}` };
  }
  if (type === "question.answered") {
    const id = typeof payload.question_id === "string" ? payload.question_id : null;
    if (!id) return null;
    const [q] = await tx.execute<{ asked_by: Actor }>(sql`select asked_by from questions where id = ${id}::uuid limit 1`).then((r) => r.rows);
    return { agent: await agentOfActor(tx, q?.asked_by), taskKey: task.key, reason: "question answered" };
  }
  if (type === "task.updated") {
    const stage = (payload.changes as Record<string, unknown> | undefined)?.stage;
    if (!Array.isArray(stage) || stage[0] === stage[1]) return null;
    const role: RunnerRole | null = stage[1] === "research" ? "research" : stage[1] === "design" ? "artist" : null;
    if (!role) return null;
    return { agent: await serviceAgent(tx, role, project), taskKey: task.key, reason: `idea stage ${stage[1]}` };
  }
  return null;
}

const WATCHED = new Set(["task.created", "task.status", "pr.ci_failed", "pr.reviewed", "question.answered", "task.updated", "project.runs_resumed", "thread.message", "question.asked", "claim.expired"]);

// Called by writeTx's emit for every event (and by the lease reaper for claim.expired). Cheap for every
// other type.
export async function onWriteEvent(
  tx: Q,
  project: ProjectRef,
  type: string,
  task: TaskRef,
  payload: Record<string, unknown>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<EventWake | null> {
  if (!WATCHED.has(type) || !eventWakesEnabled(env)) return null;
  const target = await targetOf(tx, project, type, task, payload);
  if (!target) return null;
  return queueWake(tx, project, task, target, type);
}

// Queue one wake and log it as wake.queued (inserted directly, so it is never itself an event the hook reads).
export async function queueWake(
  tx: Q,
  project: ProjectRef,
  task: TaskRef,
  target: { agent: Agent | null; taskKey: string | null; reason: string },
  fromEvent: string,
): Promise<EventWake> {
  const out = await enqueueWake(tx, { ...target, project });
  if (out.kind === "queued") {
    await tx.insert(events).values({
      projectId: project.id,
      taskId: task?.id ?? null,
      taskKey: task?.key ?? null,
      type: "wake.queued",
      actor: { agent: "plania", session_id: "system" },
      payload: { agent: out.agent, role: out.role, reason: out.reason, run_id: out.runId, from_event: fromEvent },
    });
  }
  return out;
}
