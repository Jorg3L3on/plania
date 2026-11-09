// PLA-I31-1: events wake the right role; the cadence stays as the slow fallback.
//   ticket → Ready (a move, not a creation)  wakes Taller, on that ticket
//   ticket Ready owned by a PO (moved or created Ready)  wakes that PO, on that ticket (PLA-I30-6)
//   question answered                         wakes whoever asked it (a runner session or a roster slug)
//   pr.reviewed / pr.ci_failed (GitHub job)   wakes Taller, on the PR's ticket
//   idea stage → research / → design          wakes Research / Artist, on the idea
//   project resumed (runs_resumed)            wakes that project's PO (a new project's first wake)
//   thread.message from Jorge, company thread  wakes Asistente (PLA-I32-3); in a project thread the screen
//                                             route makes a Ready PO ticket instead, which wakes the PO
// The hook runs inside writeTx, in the same transaction as the write, and only queues: it inserts an
// agent_runs row with status queued. The heartbeat job's drainQueue starts it through every runner
// check (switches, cooldown, goal, base branch, budgets, plan guard, cap). Coalescing: an agent with a
// queued or running run gets nothing new. A company or project switch that is off enqueues nothing.
// Off unless the heartbeat job runs (PLANIA_JOBS=1), so nothing waits in a queue nobody drains.
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { agentRuns, agents, events, projects, tasks, type Actor, type Agent } from "../db/schema.js";
import type { Q } from "../mcp/tx.js";
import { loadSettings, roleOf, type RunnerRole } from "./limits.js";

export const EVENT_SUMMARY = "queued: event";
const RUNNER_ADAPTER = "claude_code";
const TALLER_WORK = new Set(["code", "bug", "debt", "ops"]);

export const eventWakesEnabled = (env: NodeJS.ProcessEnv = process.env): boolean => env.PLANIA_JOBS === "1" || env.PLANIA_EVENT_WAKES === "1";

export type EventWake =
  | { kind: "queued"; runId: string; agent: string; role: RunnerRole; taskKey: string | null; reason: string }
  | { kind: "none"; reason: string };

type ProjectRef = { id: string; slug: string };
type TaskRef = { id: string; key: string } | null;

// The runner agent for a service role: the roster row named after the role first, else the first by slug.
async function serviceAgent(tx: Q, role: RunnerRole): Promise<Agent | null> {
  const rows = await tx.select().from(agents).where(eq(agents.adapter, RUNNER_ADAPTER)).orderBy(asc(agents.slug));
  const matching = rows.filter((a) => roleOf(a) === role);
  return matching.find((a) => a.slug === role) ?? matching[0] ?? null;
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
  const rows = await tx.select().from(agents).where(eq(agents.adapter, RUNNER_ADAPTER)).orderBy(asc(agents.slug));
  return rows.find((a) => roleOf(a) === "product-owner" && (a.slug === `po-${project.slug}` || a.capabilities.includes(project.slug))) ?? null;
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
  const readyNow =
    (type === "task.status" && payload.to === "Ready" && payload.from !== "Ready") || (type === "task.created" && payload.kind === "ticket" && payload.status === "Ready");
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
    const taller = await serviceAgent(tx, "taller");
    if (t.ownerAgent && t.ownerAgent !== taller?.id) return null;
    if (!t.ownerAgent && !(t.workType && TALLER_WORK.has(t.workType))) return null;
    return { agent: taller, taskKey: task.key, reason: "ticket ready" };
  }
  if (type === "pr.ci_failed" || type === "pr.reviewed") {
    return { agent: await serviceAgent(tx, "taller"), taskKey: task.key, reason: type === "pr.ci_failed" ? "ci red" : "pr review" };
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
    return { agent: await serviceAgent(tx, role), taskKey: task.key, reason: `idea stage ${stage[1]}` };
  }
  return null;
}

const WATCHED = new Set(["task.created", "task.status", "pr.ci_failed", "pr.reviewed", "question.answered", "task.updated", "project.runs_resumed", "thread.message"]);

// Called by writeTx's emit for every event. Cheap for every other type. A queued wake is logged as
// wake.queued (inserted directly, so it is never itself an event the hook reads).
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
  const out = await enqueueWake(tx, { ...target, project });
  if (out.kind === "queued") {
    await tx.insert(events).values({
      projectId: project.id,
      taskId: task?.id ?? null,
      taskKey: task?.key ?? null,
      type: "wake.queued",
      actor: { agent: "plania", session_id: "system" },
      payload: { agent: out.agent, role: out.role, reason: out.reason, run_id: out.runId, from_event: type },
    });
  }
  return out;
}
