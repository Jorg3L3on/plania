// PLA-I36-9: see it working, and stop one run (cookie-only, src/api/company.ts).
//   runView        the live (or last stopped) run on a set of tickets: which bot, on which step, since when, and the
//                  last thing it did in plain words (its newest event in Plania since the run started).
//   POST /api/company/runs/:id/stop            Detener: that run gets SIGINT and ends stopped; its ticket's lease is
//                                              freed and the ticket notes who stopped it. The project keeps running.
//   POST /api/company/runs/:id/resume          Seguir: the same agent is woken again on the same ticket.
//   POST /api/company/projects/:slug/tasks/:key/note {text}   Decirle algo: a note the agent reads at its next step.
//                  It starts "De Compañía:", never "Jorge:" (that prefix turns a note into a step for Jorge).
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { agentRuns, agents, events, projects, tasks } from "../db/schema.js";
import { wakeAgent, type HeartbeatDeps } from "../jobs/heartbeat.js";
import { ToolError } from "../mcp/errors.js";
import { webCtx } from "../mcp/tx.js";
import { claim, setTask } from "../mcp/writes.js";
import { stopRun } from "../runner/runner.js";

export type RunLine = { id: string; role: string; agent: string; step: string; ticket: string; since: string; last: string | null; status: "running" | "stopped" };

// What an event says in plain words.
const DOING: Record<string, string> = {
  "claim.acquired": "tomó el trabajo",
  "task.status": "movió un ticket",
  note: "dejó una nota",
  "result.added": "registró pruebas",
  "doc.put": "escribió un doc",
  "thread.message": "escribió en el hilo",
  "check.set": "marcó un check",
  "question.asked": "te hizo una pregunta",
  "task.created": "creó un ticket",
  "pr.opened": "abrió el cambio para revisar",
};
const said = (type: string, payload: Record<string, unknown>) => {
  if (type === "task.status" && typeof payload.to === "string") return `pasó un ticket a ${payload.to}`;
  return DOING[type] ?? null;
};

export async function runView(db: Db, projectId: string, keys: string[]): Promise<RunLine | null> {
  if (keys.length === 0) return null;
  const [run] = await db
    .select({ id: agentRuns.id, status: agentRuns.status, role: agentRuns.role, taskKey: agentRuns.taskKey, startedAt: agentRuns.startedAt, queuedAt: agentRuns.queuedAt, agent: agents.slug })
    .from(agentRuns)
    .innerJoin(agents, eq(agents.id, agentRuns.agentId))
    .where(and(eq(agentRuns.projectId, projectId), inArray(agentRuns.taskKey, keys), inArray(agentRuns.status, ["running", "stopped", "ok", "fail", "queued"])))
    .orderBy(desc(sql`coalesce(${agentRuns.startedAt}, ${agentRuns.queuedAt})`))
    .limit(1);
  if (!run || (run.status !== "running" && run.status !== "stopped")) return null;
  const since = run.startedAt ?? run.queuedAt;
  const [t] = await db.select({ title: tasks.title }).from(tasks).where(and(eq(tasks.projectId, projectId), eq(tasks.key, run.taskKey!))).limit(1);
  const recent = await db
    .select({ type: events.type, payload: events.payload })
    .from(events)
    .where(and(eq(events.projectId, projectId), gte(events.createdAt, since), sql`${events.actor}->>'session_id' = ${`run-${run.id.slice(0, 8)}`}`))
    .orderBy(desc(events.id))
    .limit(10);
  const last = recent.map((e) => said(e.type, e.payload as Record<string, unknown>)).find(Boolean) ?? null;
  return { id: run.id, role: run.role, agent: run.agent, step: t?.title ?? run.taskKey!, ticket: run.taskKey!, since: since.toISOString(), last, status: run.status };
}

type Refusal = { error: string; status: 404 | 409; hint: string };

async function runRow(db: Db, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [r] = await db
    .select({ id: agentRuns.id, status: agentRuns.status, taskKey: agentRuns.taskKey, agent: agents.slug, project: projects.slug })
    .from(agentRuns)
    .innerJoin(agents, eq(agents.id, agentRuns.agentId))
    .innerJoin(projects, eq(projects.id, agentRuns.projectId))
    .where(eq(agentRuns.id, id))
    .limit(1);
  return r ?? null;
}

export async function stopOneRun(db: Db, id: string): Promise<{ stopped: true; ticket: string | null } | Refusal> {
  const r = await runRow(db, id);
  if (!r) return { error: "RUN_NOT_FOUND", status: 404, hint: "Esa corrida no existe." };
  if (r.status !== "running") return { error: "RUN_NOT_LIVE", status: 409, hint: "Esa corrida ya terminó." };
  if (!stopRun(r.id)) return { error: "RUN_NOT_LIVE", status: 409, hint: "Esa corrida no corre en esta Mac." };
  if (r.taskKey) {
    const ctx = { ...webCtx, tool: "screen.run_stop" };
    try {
      await claim(db, { project: r.project, key: r.taskKey, action: "release" } as never, ctx);
    } catch (e) {
      if (!(e instanceof ToolError)) throw e;
    }
    await setTask(db, { project: r.project, key: r.taskKey, note: `Se detuvo la corrida de ${r.agent} desde Compañía.` } as never, ctx);
  }
  return { stopped: true, ticket: r.taskKey };
}

export async function resumeRun(db: Db, id: string, deps?: HeartbeatDeps): Promise<{ woke: boolean; reason: string; ticket: string | null } | Refusal> {
  const r = await runRow(db, id);
  if (!r) return { error: "RUN_NOT_FOUND", status: 404, hint: "Esa corrida no existe." };
  if (r.status !== "stopped") return { error: "RUN_NOT_STOPPED", status: 409, hint: "Solo una corrida detenida se retoma." };
  const out = await wakeAgent(db, { agent: r.agent, taskKey: r.taskKey ?? undefined }, deps);
  return { woke: out.woke, reason: out.reason, ticket: r.taskKey };
}

export async function noteForAgent(db: Db, slug: string, key: string, text: string): Promise<{ noted: true } | Refusal> {
  const [p] = await db.select({ id: projects.id }).from(projects).where(eq(projects.slug, slug)).limit(1);
  if (!p) return { error: "PROJECT_NOT_FOUND", status: 404, hint: "no such project" };
  const [t] = await db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.projectId, p.id), eq(tasks.key, key))).limit(1);
  if (!t) return { error: "TASK_NOT_FOUND", status: 404, hint: "Ese ticket no está." };
  await setTask(db, { project: slug, key, note: `De Compañía: ${text.trim()}` } as never, { ...webCtx, tool: "screen.run_note" });
  return { noted: true };
}
