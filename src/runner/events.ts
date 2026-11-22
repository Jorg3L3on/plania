// PLA-I31-1: events wake the right role; the cadence stays as the slow fallback.
//   ticket → Ready (a move, not a creation)  wakes Taller, on that ticket
//   ticket Ready owned by a PO (moved or created Ready)  wakes that PO, on that ticket (PLA-I30-6)
//   question answered                         wakes whoever asked it (a runner session or a roster slug)
//   pr.reviewed / pr.ci_failed (GitHub job)   wakes Taller, on the PR's ticket
//   idea stage → research / → design          wakes Research / Artist, on the idea
//   project resumed (runs_resumed)            wakes that project's PO (a new project's first wake)
//   question asked by a PO (not human_only)   wakes Asistente, on that ticket (PLA-I32-5)
//   thread.message from the owner, company thread  wakes Asistente (PLA-I32-3); in a project thread the screen
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
import { agentRuns, agents, events, projects, taskBlockers, tasks, type Actor, type Agent, type RunTrigger } from "../db/schema.js";
import { hasUnsatisfiedBlocker } from "../mcp/blockers.js";
import { LANDED, ST, sqlNotIn } from "../state/status.js";
import { wakeOf } from "../state/transitions.js";
import { workable } from "../state/workable.js";
import type { Q } from "../mcp/tx.js";
import { loadSettings, roleOf, type RunnerRole } from "./limits.js";
import { insertRun, kickQueue } from "./queue.js";
import { STAGE_REASON, stageOwner, type IdeaStage } from "./stages.js";
import { isRunSession, runPrefixOf } from "./run-session.js";
import { ownerEs } from "../owner.js";
import { wakesOn } from "../install-state.js";
import { buildReason } from "../api/company-pedido.js";

export const EVENT_SUMMARY = "queued: event";
const RUNNER_ADAPTER = "claude_code";
const TALLER_WORK = new Set(["code", "bug", "debt", "ops"]);
const PRIORITY = ["P0", "P1", "P2", "P3"];

// PLA-I2-2: wakesOn is PLANIA_JOBS=1, or PLANIA_JOBS unset on an install made by the first-start screen.
export const eventWakesEnabled = (env: NodeJS.ProcessEnv = process.env): boolean => wakesOn(env) || env.PLANIA_EVENT_WAKES === "1";

// A runner run writes as session run-<first 8 of its agent_runs id> (see userPrompt in runner.ts).
export { isRunSession } from "./run-session.js";

export type EventWake =
  | { kind: "queued"; runId: string; agent: string; role: RunnerRole; taskKey: string | null; reason: string }
  | { kind: "none"; reason: string; existingRunId?: string };

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
  const prefix = runPrefixOf(actor.session_id);
  if (prefix) {
    // PLA-I60-1: 16 hex for runs since 0060, 8 for older ones; the newest run wins an 8-hex tie.
    const [run] = await tx
      .select({ agentId: agentRuns.agentId })
      .from(agentRuns)
      .where(sql`replace(${agentRuns.id}::text, '-', '') like ${`${prefix}%`}`)
      .orderBy(sql`${agentRuns.queuedAt} desc`)
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

/** PLA-82 (F-12): the roster agent behind a write: its actor, else the run the runner named for the connection. */
export async function agentOfCtx(tx: Q, ctx: { actor: Actor | null | undefined; runSession?: string }): Promise<Agent | null> {
  return (await agentOfActor(tx, ctx.actor)) ?? (ctx.runSession ? agentOfActor(tx, { agent: "", session_id: ctx.runSession } as Actor) : null);
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
// PLA-54: steps filed in Backlog (every PO plan) are not seen here: promoteChained (src/mcp/blockers.ts) moves
// them to Ready after this landing, and that move wakes Taller with reason "unblocked by <key>".
export async function freedBy(tx: Q, project: ProjectRef, landedId: string, taller: Agent | null): Promise<string | null> {
  if (!taller) return null;
  const rows = await tx
    .select({ key: tasks.key, title: tasks.title, priority: tasks.priority, phase: tasks.phase, workType: tasks.workType, ownerAgent: tasks.ownerAgent })
    .from(tasks)
    .innerJoin(taskBlockers, and(eq(taskBlockers.taskId, tasks.id), eq(taskBlockers.blockerId, landedId)))
    .where(
      and(
        eq(tasks.projectId, project.id),
        workable,
        sql`not exists (
          select 1 from ${taskBlockers} tb join ${tasks} b on b.id = tb.blocker_id
          where tb.task_id = ${tasks.id} and tb.blocker_id <> ${landedId}::uuid and ${sqlNotIn(sql`b.status`, LANDED)}
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

// Queue one wake, or say why not. Never spawns. PLA-I60-1: one active run per (agent, project, work key), enforced
// by the unique index through insertRun; a wake for work the agent already has coalesces into that run.
export async function enqueueWake(
  tx: Q,
  input: { agent: Agent | null; project: ProjectRef; taskKey: string | null; reason: string; now?: Date; trigger?: RunTrigger; consultaId?: string | null; notBefore?: Date | null; appendReason?: boolean },
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
  const out = await insertRun(tx, {
    agent,
    project,
    role,
    taskKey: input.taskKey,
    consultaId: input.consultaId ?? null,
    trigger: input.trigger ?? "event",
    reason: input.reason,
    summary: `${EVENT_SUMMARY} ${input.reason}`,
    queuedAt: input.now ?? new Date(),
    reserveTokens: settings.reserveTokens,
    notBefore: input.notBefore ?? null,
    appendReason: input.appendReason,
  });
  if (out.kind === "coalesced") return { kind: "none", reason: "coalesced", existingRunId: out.existing.id };
  kickQueue();
  return { kind: "queued", runId: out.run.id, agent: agent.slug, role, taskKey: input.taskKey, reason: input.reason };
}

// PLA-164: the owner said «Constrúyelo» on this idea (the screen's pedido.construir event).
async function builtByOwner(tx: Q, ideaId: string): Promise<boolean> {
  const [row] = await tx.select({ n: sql<number>`count(*)::int` }).from(events).where(and(eq(events.taskId, ideaId), eq(events.type, "pedido.construir")));
  return (row?.n ?? 0) > 0;
}
// PLA-164: the initiative was built from an idea the owner said «Constrúyelo» to.
async function initiativeBuiltByOwner(tx: Q, project: ProjectRef, initiativeKey: string): Promise<boolean> {
  const rows = await tx
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.projectId, project.id), eq(tasks.kind, "idea"), eq(tasks.promotedTo, initiativeKey), sql`exists (select 1 from events e where e.task_id = ${tasks.id} and e.type = 'pedido.construir')`))
    .limit(1);
  return rows.length > 0;
}

// PLA-151: the first Ready, unblocked step of an initiative that Taller may take (its own, or unowned Taller work;
// never [PRUEBA]), by phase then key.
async function firstStepFor(tx: Q, project: ProjectRef, initiativeId: string, taller: Agent | null): Promise<string | null> {
  if (!taller) return null;
  const rows = await tx
    .select({ key: tasks.key, title: tasks.title, phase: tasks.phase, workType: tasks.workType, ownerAgent: tasks.ownerAgent })
    .from(tasks)
    .where(and(eq(tasks.projectId, project.id), eq(tasks.parentId, initiativeId), workable));
  const mine = rows
    .filter((t) => !t.title.includes("[PRUEBA]") && (t.ownerAgent ? t.ownerAgent === taller.id : !!t.workType && TALLER_WORK.has(t.workType)))
    .sort((a, b) => (a.phase ?? Number.MAX_SAFE_INTEGER) - (b.phase ?? Number.MAX_SAFE_INTEGER) || a.key.localeCompare(b.key, "en", { numeric: true }));
  return mine[0]?.key ?? null;
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
    if (payload.thread_kind !== "company" || payload.author !== "owner") return null;
    return { agent: await asistenteAgent(tx), taskKey: null, reason: "message from the owner" };
  }
  if (!task) return null;

  // PLA-151 (guided test 3): after «Constrúyelo» the PO files the plan (step 1 born Ready, the rest chained) and then
  // moves the initiative to Active. Nothing moved step 1, so nobody woke Taller and the board said «Nadie trabaja».
  // The initiative turning Active wakes Taller on its first Ready, unblocked step Taller may take.
  // PLA-I74-4: which wake a status move earns is the transitions table's (src/state/transitions.ts wakeOf).
  const move = type === "task.status" && typeof payload.to === "string" ? wakeOf(payload.from as string | null, payload.to) : null;
  if (move === "initiative-started") {
    const taller = await serviceAgent(tx, "taller", project);
    const first = await firstStepFor(tx, project, task.id, taller);
    return first ? { agent: taller, taskKey: first, reason: `initiative ${task.key} started` } : null;
  }

  // PLA-164 (guided test 2026-11-22): after «Constrúyelo» the PO created the initiative, its step 1 born Ready, and set
  // promoted_to, but left the initiative in Planning: PLA-151's Active rule never fired and the board asked the owner for
  // «Que empiece ya». The idea's promoted_to landing after «Constrúyelo» is the start: Taller wakes on the first step.
  if (type === "task.updated" && Array.isArray((payload.changes as Record<string, unknown> | undefined)?.promoted_to)) {
    const to = ((payload.changes as Record<string, unknown>).promoted_to as unknown[])[1];
    if (typeof to === "string" && to && (await builtByOwner(tx, task.id))) {
      const [ini] = await tx.select({ id: tasks.id, status: tasks.status }).from(tasks).where(and(eq(tasks.projectId, project.id), eq(tasks.key, to))).limit(1);
      if (ini && ini.status !== ST.onHold) {
        const taller = await serviceAgent(tx, "taller", project);
        const first = await firstStepFor(tx, project, ini.id, taller);
        return first ? { agent: taller, taskKey: first, reason: `built from ${task.key}` } : null;
      }
    }
    return null;
  }

  // PLA-I30-6: a ticket a product owner owns wakes that PO when it is Ready, created that way included
  // (Pedirle al PO creates it Ready). Taller wakes on a move, and on a standalone ticket created Ready and given to it (PLA-103).
  // PLA-16: a runner run's lease that ran out (the run ended without finishing or freeing its ticket) puts
  // the ticket back in Ready like a move. A person's or another client's expired lease wakes nobody.
  const runnerLeaseExpired =
    type === "claim.expired" && payload.from === ST.inProgress && wakeOf(String(payload.from), String(payload.to), "ticket") === "ready" && isRunSession((payload.owner as Actor | null | undefined)?.session_id);
  const readyNow =
    move === "ready" ||
    (type === "task.created" && payload.kind === "ticket" && typeof payload.status === "string" && wakeOf(null, payload.status, "ticket") === "ready") ||
    runnerLeaseExpired;
  if (readyNow) {
    const [t] = await tx
      .select({ kind: tasks.kind, title: tasks.title, workType: tasks.workType, ownerAgent: tasks.ownerAgent, parentId: tasks.parentId, blocked: hasUnsatisfiedBlocker(task.id) })
      .from(tasks)
      .where(eq(tasks.id, task.id))
      .limit(1);
    if (!t || t.kind !== "ticket" || t.title.includes("[PRUEBA]")) return null;
    if (t.ownerAgent) {
      const [owner] = await tx.select().from(agents).where(eq(agents.id, t.ownerAgent)).limit(1);
      if (owner && roleOf(owner) === "product-owner") return { agent: owner, taskKey: task.key, reason: "ticket ready" };
    }
    // PLA-103 (guided test PLA-86, F-29): a standalone ticket created Ready and given to Taller (the PO splits a «Hacerlo
    // ya» into one) waited forever: Taller woke on a move only and the cadence never came; MIA-38 sat Ready 80 minutes.
    // Only that case wakes on creation: plan steps (a parent), tickets behind a blocker and unassigned tickets still
    // wait for their move.
    const taller = await serviceAgent(tx, "taller", project);
    // PLA-151: a step created Ready, unblocked, under an initiative that is already Active wakes Taller too.
    // PLA-164: or under one built from an idea the owner said «Constrúyelo» to (not On hold).
    const parentRow = type === "task.created" && t.parentId && !t.blocked ? (await tx.select({ key: tasks.key, status: tasks.status }).from(tasks).where(eq(tasks.id, t.parentId)).limit(1))[0] : undefined;
    const parentActive = !!parentRow && (parentRow.status === ST.active || (parentRow.status !== ST.onHold && (await initiativeBuiltByOwner(tx, project, parentRow.key))));
    if (type === "task.created" && !parentActive && !(t.ownerAgent && t.ownerAgent === taller?.id && !t.parentId && !t.blocked)) return null;
    if (t.ownerAgent && t.ownerAgent !== taller?.id) return null;
    if (!t.ownerAgent && !(t.workType && TALLER_WORK.has(t.workType))) return null;
    // PLA-54: a chain step the server moved to Ready says which landing freed it.
    const freed = Array.isArray(payload.unblocked_by) && payload.unblocked_by.length ? `unblocked by ${payload.unblocked_by.join(", ")}` : null;
    return { agent: taller, taskKey: task.key, reason: runnerLeaseExpired ? "lease expired" : (freed ?? "ticket ready") };
  }
  // PLA-15: a ticket lands once (In review → Merged; Merged → Released → Done after it is not a landing).
  if (move === "landed") {
    const taller = await serviceAgent(tx, "taller", project);
    const next = await freedBy(tx, project, task.id, taller);
    return next ? { agent: taller, taskKey: next, reason: `unblocked by ${task.key}` } : null;
  }
  if (type === "pr.ci_failed" || type === "pr.reviewed") {
    return { agent: await serviceAgent(tx, "taller", project), taskKey: task.key, reason: type === "pr.ci_failed" ? "ci red" : "pr review" };
  }
  // PLA-I32-5: a PO's question goes to Asistente first; it answers what Plania already says, or leaves it to the owner.
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
    // PLA-I60-4: every stage with an owner wakes it (planning wakes the PO; before, nothing did).
    const role = stageOwner(String(stage[1]));
    if (!role) return null;
    let agent: Agent | null = null;
    if (role === "product-owner") {
      const [t] = await tx.select({ ownerAgent: tasks.ownerAgent }).from(tasks).where(eq(tasks.id, task.id)).limit(1);
      if (t?.ownerAgent) agent = (await tx.select().from(agents).where(eq(agents.id, t.ownerAgent)).limit(1))[0] ?? null;
      if (agent && roleOf(agent) !== "product-owner") agent = null;
    }
    agent ??= await serviceAgent(tx, role, project);
    return { agent, taskKey: task.key, reason: STAGE_REASON[stage[1] as IdeaStage] || `idea stage ${stage[1]}` };
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
  // PLA-I49-6: a project's runs coming back also wake the Artist or Research who own a Ready request of the owner's
  // there (origin owner: a sketch asked from the brief while the project was paused), once each. The PO wakes as before.
  if (type === "project.runs_resumed") await wakeReadyOwners(tx, project);
  const target = await targetOf(tx, project, type, task, payload);
  if (!target) return null;
  return queueWake(tx, project, task, target, type);
}

async function wakeReadyOwners(tx: Q, project: ProjectRef): Promise<void> {
  const rows = await tx
    .select({ id: tasks.id, key: tasks.key, agent: agents })
    .from(tasks)
    .innerJoin(agents, eq(agents.id, tasks.ownerAgent))
    .where(and(eq(tasks.projectId, project.id), eq(tasks.origin, "owner"), workable))
    .orderBy(asc(tasks.createdAt));
  const seen = new Set<string>();
  for (const r of rows) {
    const role = roleOf(r.agent);
    if ((role !== "artist" && role !== "research") || seen.has(r.agent.id)) continue;
    seen.add(r.agent.id);
    await queueWake(tx, project, { id: r.id, key: r.key }, { agent: r.agent, taskKey: r.key, reason: "project resumed" }, "project.runs_resumed");
  }
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

// PLA-I40-6: a request made Ready for a product owner that already had a run queued or live is coalesced, and
// nothing wakes that PO for it again. So when a PO's run ends well, one wake is queued for its oldest Ready
// ticket that nothing holds. Never the ticket the run was on: an unfinished one would wake it in a loop.
export async function wakePoIfWaiting(tx: Q, agent: Agent, project: ProjectRef, justRan: string | null, env: NodeJS.ProcessEnv = process.env): Promise<EventWake | null> {
  if (!eventWakesEnabled(env)) return null;
  if (roleOf(agent) === "taller") return wakeTallerIfWaiting(tx, agent, project, justRan);
  if (roleOf(agent) !== "product-owner") return null;
  const rows = await tx
    .select({ id: tasks.id, key: tasks.key, title: tasks.title })
    .from(tasks)
    .where(and(eq(tasks.projectId, project.id), eq(tasks.ownerAgent, agent.id), workable)) // PLA-165, PLA-I74-4: the one workable rule
    .orderBy(asc(tasks.createdAt));
  const next = rows.find((t) => t.key !== justRan && !t.title.includes("[PRUEBA]"));
  if (next) return queueWake(tx, project, { id: next.id, key: next.key }, { agent, taskKey: next.key, reason: "request waiting" }, "run.ended");
  // PLA-I54-4: an owner's «Constrúyelo» whose wake was coalesced: the idea still waits for its promoted_to.
  const [built] = await tx
    .select({ id: tasks.id, key: tasks.key })
    .from(tasks)
    .where(
      and(
        eq(tasks.projectId, project.id),
        eq(tasks.kind, "idea"),
        eq(tasks.origin, "owner"),
        eq(tasks.status, ST.open),
        eq(tasks.ownerAgent, agent.id),
        sql`${tasks.promotedTo} is null`,
        sql`${tasks.key} <> ${justRan ?? ""}`,
        sql`exists (select 1 from events e where e.task_id = ${tasks.id} and e.type = 'pedido.construir')`,
      ),
    )
    .orderBy(asc(tasks.createdAt))
    .limit(1);
  if (built) return queueWake(tx, project, built, { agent, taskKey: built.key, reason: buildReason() }, "run.ended");
  // PLA-I54-1: an idea the owner asked to shape (Darle forma) whose wake was coalesced waits in the buzón: no run ever
  // took it. The PO takes the oldest one once nothing Ready waits.
  const [idea] = await tx
    .select({ id: tasks.id, key: tasks.key })
    .from(tasks)
    .where(
      and(
        eq(tasks.projectId, project.id),
        eq(tasks.kind, "idea"),
        eq(tasks.origin, "owner"),
        eq(tasks.status, ST.open),
        eq(tasks.stage, "idea"),
        eq(tasks.ownerAgent, agent.id),
        sql`${tasks.promotedTo} is null`,
        sql`${tasks.key} <> ${justRan ?? ""}`,
        sql`not exists (select 1 from agent_runs r where r.project_id = ${tasks.projectId} and r.task_key = ${tasks.key})`,
      ),
    )
    .orderBy(asc(tasks.createdAt))
    .limit(1);
  if (!idea) return null;
  return queueWake(tx, project, idea, { agent, taskKey: idea.key, reason: `pedido ${ownerEs("de")} para darle forma` }, "run.ended");
}

// PLA-104: a wake for Taller that arrived while it was busy (a ticket made Ready for it, «Hacer primero») was coalesced
// and lost, so an idle Taller sat next to its own Ready tickets. When its run ends well it takes the oldest one it owns
// that nothing blocks. Never the ticket the run was on (an unfinished one would loop), never a [PRUEBA] one.
async function wakeTallerIfWaiting(tx: Q, agent: Agent, project: ProjectRef, justRan: string | null): Promise<EventWake | null> {
  const rows = await tx
    .select({ id: tasks.id, key: tasks.key, title: tasks.title, priority: tasks.priority })
    .from(tasks)
    .where(and(eq(tasks.projectId, project.id), eq(tasks.ownerAgent, agent.id), workable)) // PLA-165, PLA-I74-4: the one workable rule
    .orderBy(asc(tasks.createdAt));
  // As freedBy: the project's next_first («Hacer primero») first, then priority, then the oldest.
  const [p] = await tx.select({ settings: projects.settings }).from(projects).where(eq(projects.id, project.id)).limit(1);
  const first = p?.settings.next_first;
  const rank = (priority: string | null) => (PRIORITY.includes(priority ?? "") ? PRIORITY.indexOf(priority!) : PRIORITY.length);
  const next = rows
    .filter((t) => t.key !== justRan && !t.title.includes("[PRUEBA]"))
    .sort((a, b) => Number(b.key === first) - Number(a.key === first) || rank(a.priority) - rank(b.priority))[0];
  if (!next) return null;
  return queueWake(tx, project, { id: next.id, key: next.key }, { agent, taskKey: next.key, reason: "ticket listo esperando" }, "run.ended");
}
