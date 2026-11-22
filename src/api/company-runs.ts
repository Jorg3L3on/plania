// PLA-I36-9: see it working, and stop one run (cookie-only, src/api/company.ts).
//   runView        the live (or last stopped) run on a set of tickets: which bot, on which step, since when, and the
//                  last thing it did in plain words (its newest event in Plania since the run started).
//   POST /api/company/runs/:id/stop            Detener: that run gets SIGINT and ends stopped; its ticket's lease is
//                                              freed and the ticket notes who stopped it. The project keeps running.
//   POST /api/company/runs/:id/resume          Seguir: the same agent is woken again on the same ticket.
//   POST /api/company/projects/:slug/tasks/:key/note {text}   Decirle algo: a note the agent reads at its next step.
//                  It starts "De Compañía:", never "Owner:" (that prefix turns a note into a step for the owner).
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { agentRuns, agents, events, projects, tasks } from "../db/schema.js";
import { wakeAgent, type HeartbeatDeps } from "../jobs/heartbeat.js";
import { ToolError } from "../mcp/errors.js";
import { webCtx } from "../mcp/tx.js";
import { claim, setTask } from "../mcp/writes.js";
import { stopRun } from "../runner/runner.js";
import { isSessionOf, sessionsOf } from "../runner/run-session.js";
import { defineWords, say } from "../words.js";
import { healStep } from "../runner/heal.js";
import { ST } from "../state/status.js";

// PLA-I2-10: what a run did and the run errors in the install's language; the Spanish is unchanged.
export const COMPANY_RUNS_WORDS = defineWords({
  es: {
    doing: {
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
    } as Record<string, string>,
    movedTo: (to: string) => `pasó un ticket a ${to}`,
    noRun: "Esa corrida no existe.",
    ended: "Esa corrida ya terminó.",
    notHere: "Esa corrida no corre en esta máquina.",
    stoppedNote: (agent: string) => `Se detuvo la corrida de ${agent} desde Compañía.`,
    notStopped: "Solo una corrida detenida se retoma.",
    noTicket: "Ese ticket no está.",
    fromCompany: (text: string) => `De Compañía: ${text}`,
  },
  en: {
    doing: {
      "claim.acquired": "took the work",
      "task.status": "moved a ticket",
      note: "left a note",
      "result.added": "recorded tests",
      "doc.put": "wrote a doc",
      "thread.message": "wrote in the thread",
      "check.set": "ticked a check",
      "question.asked": "asked you a question",
      "task.created": "created a ticket",
      "pr.opened": "opened the change for review",
    } as Record<string, string>,
    movedTo: (to: string) => `moved a ticket to ${to}`,
    noRun: "That run does not exist.",
    ended: "That run already ended.",
    notHere: "That run is not running on this machine.",
    stoppedNote: (agent: string) => `${agent}'s run was stopped from Compañía.`,
    notStopped: "Only a stopped run can be resumed.",
    noTicket: "That ticket is not here.",
    fromCompany: (text: string) => `From Compañía: ${text}`,
  },
});
const rw = () => say(COMPANY_RUNS_WORDS);

export type RunLine = { id: string; role: string; agent: string; step: string; ticket: string; since: string; last: string | null; status: "running" | "stopped" };

// What an event says in plain words.
const said = (type: string, payload: Record<string, unknown>) => {
  if (type === "task.status" && typeof payload.to === "string") return rw().movedTo(payload.to);
  return rw().doing[type] ?? null;
};

export async function runView(db: Db, projectId: string, keys: string[]): Promise<RunLine | null> {
  if (keys.length === 0) return null;
  const [run] = await db
    .select({ id: agentRuns.id, status: agentRuns.status, role: agentRuns.role, taskKey: agentRuns.taskKey, startedAt: agentRuns.startedAt, queuedAt: agentRuns.queuedAt, agent: agents.slug })
    .from(agentRuns)
    .innerJoin(agents, eq(agents.id, agentRuns.agentId))
    .where(and(eq(agentRuns.projectId, projectId), inArray(agentRuns.taskKey, keys), inArray(agentRuns.status, ["running", "starting", "stopped", "ok", "fail", "queued"])))
    // PLA-I60: a live run wins over a newer queued one (several runs can be on the same request's tickets).
    .orderBy(sql`case when ${agentRuns.status} in ('running', 'starting') then 0 when ${agentRuns.status} = 'stopped' then 1 else 2 end`, desc(sql`coalesce(${agentRuns.startedAt}, ${agentRuns.queuedAt})`))
    .limit(1);
  if (!run || (run.status !== "running" && run.status !== "stopped")) return null;
  const since = run.startedAt ?? run.queuedAt;
  const [t] = await db.select({ title: tasks.title }).from(tasks).where(and(eq(tasks.projectId, projectId), eq(tasks.key, run.taskKey!))).limit(1);
  const recent = await db
    .select({ type: events.type, payload: events.payload })
    .from(events)
    .where(and(eq(events.projectId, projectId), gte(events.createdAt, since), sql`${events.actor}->>'session_id' in (${sql.join(sessionsOf(run.id).map((x) => sql`${x}`), sql`, `)})`))
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
  if (!r) return { error: "RUN_NOT_FOUND", status: 404, hint: rw().noRun };
  if (r.status !== "running") return { error: "RUN_NOT_LIVE", status: 409, hint: rw().ended };
  if (!stopRun(r.id)) return { error: "RUN_NOT_LIVE", status: 409, hint: rw().notHere };
  if (r.taskKey) {
    const ctx = { ...webCtx, tool: "screen.run_stop" };
    try {
      await claim(db, { project: r.project, key: r.taskKey, action: "release" } as never, ctx);
    } catch (e) {
      if (!(e instanceof ToolError)) throw e;
    }
    await setTask(db, { project: r.project, key: r.taskKey, note: rw().stoppedNote(r.agent) } as never, ctx);
  }
  return { stopped: true, ticket: r.taskKey };
}

export async function resumeRun(db: Db, id: string, deps?: HeartbeatDeps): Promise<{ woke: boolean; reason: string; ticket: string | null } | Refusal> {
  const r = await runRow(db, id);
  if (!r) return { error: "RUN_NOT_FOUND", status: 404, hint: rw().noRun };
  if (r.status !== "stopped") return { error: "RUN_NOT_STOPPED", status: 409, hint: rw().notStopped };
  // PLA-18: a run a switch (or, before PLA-21, a budget) stopped still holds its ticket until the next tick frees it, and the
  // wake needs the ticket Ready. Only that run's own lease is released here.
  if (r.taskKey) {
    const [t] = await db
      .select({ status: tasks.status, owner: tasks.owner })
      .from(tasks)
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .where(and(eq(projects.slug, r.project), eq(tasks.key, r.taskKey)))
      .limit(1);
    if (t?.status === ST.inProgress && isSessionOf(t.owner?.session_id, r.id)) {
      await claim(db, { project: r.project, key: r.taskKey, action: "release" } as never, { ...webCtx, tool: "screen.run_resume" });
    }
  }
  const out = await wakeAgent(db, { agent: r.agent, taskKey: r.taskKey ?? undefined }, deps);
  return { woke: out.woke, reason: out.reason, ticket: r.taskKey };
}

export async function noteForAgent(db: Db, slug: string, key: string, text: string): Promise<{ noted: true; woke?: boolean } | Refusal> {
  const [p] = await db.select({ id: projects.id, slug: projects.slug }).from(projects).where(eq(projects.slug, slug)).limit(1);
  if (!p) return { error: "PROJECT_NOT_FOUND", status: 404, hint: "no such project" };
  const [t] = await db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.projectId, p.id), eq(tasks.key, key))).limit(1);
  if (!t) return { error: "TASK_NOT_FOUND", status: 404, hint: rw().noTicket };
  await setTask(db, { project: slug, key, note: rw().fromCompany(text.trim()), note_kind: "screen", note_words: text.trim() } as never, { ...webCtx, tool: "screen.run_note" });
  return { noted: true, ...(await wakeForNote(db, p, key, text.trim())) };
}

// PLA-167 (guided test 2026-11-22): a note on a step nobody runs reached nobody. The note is an event on the ticket; an
// idle agent never reads it, and a run that ended while holding the step kept its 30-minute lease, so the board said
// «Taller trabaja» and offered nothing for half an hour, twice. When no run is live on the ticket: a lease held by an
// ended runner run is released, and the agent that works the ticket (its owner, else Taller) is woken with the note as
// the reason its prompt reads. A live run gets the note at its next step, as before; a person's lease is left alone.
async function wakeForNote(db: Db, p: { id: string; slug: string }, key: string, text: string): Promise<{ woke: boolean }> {
  const [t] = await db.select({ kind: tasks.kind, status: tasks.status }).from(tasks).where(and(eq(tasks.projectId, p.id), eq(tasks.key, key))).limit(1);
  // A note wakes a step someone should be working (Ready, or held); one in review or waiting stays as it is.
  if (!t || t.kind !== "ticket" || (t.status !== ST.inProgress && t.status !== ST.ready)) return { woke: false };
  // PLA-I74-5: the watchdog's heal, with the note as the reason.
  const out = await healStep(db, p, key, { reason: `note from the owner: ${text}`, release: true, from: "screen.run_note" });
  return { woke: out.woke };
}
