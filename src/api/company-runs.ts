// PLA-I36-9: see it working, and stop one run (cookie-only, src/api/company.ts).
//   runView        the live (or last stopped) run on a set of tickets: which bot, on which step, since when, and the
//                  last thing it did in plain words (its newest event in Plania since the run started).
//   POST /api/company/runs/:id/stop            Detener: that run gets SIGINT and ends stopped; its ticket's lease is
//                                              freed and the ticket notes who stopped it. The project keeps running.
//   POST /api/company/runs/:id/resume          Seguir: the same agent is woken again on the same ticket.
//   POST /api/company/projects/:slug/tasks/:key/note {text}   Decirle algo: a note the agent reads at its next step.
//                  It starts "De Compañía:", never "Jorge:" (that prefix turns a note into a step for Jorge).
import type { Db } from "../db/client.js";
import { wakeAgent, type HeartbeatDeps } from "../jobs/heartbeat.js";
import { ToolError } from "../mcp/errors.js";
import { webCtx } from "../mcp/tx.js";
import { claim, setTask } from "../mcp/writes.js";
import { stopRun } from "../runner/runner.js";
import { isSessionOf, sessionsOf } from "../runner/run-session.js";
import { readerOf } from "../store/port.js";
import { gte } from "../store/types.js";

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
  const r = readerOf(db);
  const runs = await r.find("agentRuns", { projectId, taskKey: keys, status: ["running", "starting", "stopped", "ok", "fail", "queued"] });
  // PLA-I60: a live run wins over a newer queued one (several runs can be on the same request's tickets); then the
  // newest by coalesce(started_at, queued_at).
  const rank = (s: string) => (s === "running" || s === "starting" ? 0 : s === "stopped" ? 1 : 2);
  const at = (x: (typeof runs)[number]) => (x.startedAt ?? x.queuedAt).getTime();
  const [run] = runs.sort((a, b) => rank(a.status) - rank(b.status) || at(b) - at(a));
  if (!run || (run.status !== "running" && run.status !== "stopped")) return null;
  // Every run has its agent (the foreign key).
  const agent = (await r.get("agents", { id: run.agentId }))!;
  const since = run.startedAt ?? run.queuedAt;
  const t = await r.get("tasks", { projectId, key: run.taskKey! });
  // Its newest events in Plania since it started, the ones its own session wrote (either spelling, PLA-I60-1).
  const sessions = sessionsOf(run.id);
  const recent = (await r.find("events", { projectId, createdAt: gte(since) }, { orderBy: [{ column: "id", desc: true }] }))
    .filter((e) => typeof e.actor.session_id === "string" && sessions.includes(e.actor.session_id))
    .slice(0, 10);
  const last = recent.map((e) => said(e.type, e.payload as Record<string, unknown>)).find(Boolean) ?? null;
  return { id: run.id, role: run.role, agent: agent.slug, step: t?.title ?? run.taskKey!, ticket: run.taskKey!, since: since.toISOString(), last, status: run.status };
}

type Refusal = { error: string; status: 404 | 409; hint: string };

// A run with its agent's and project's slugs; null for an id that names none.
async function runRow(db: Db, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const r = readerOf(db);
  const run = await r.get("agentRuns", { id });
  const agent = run ? await r.get("agents", { id: run.agentId }) : undefined;
  const project = run ? await r.get("projects", { id: run.projectId }) : undefined;
  if (!run || !agent || !project) return null;
  return { id: run.id, status: run.status, taskKey: run.taskKey, agent: agent.slug, project: project.slug };
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
  // PLA-18: a run a switch (or, before PLA-21, a budget) stopped still holds its ticket until the next tick frees it, and the
  // wake needs the ticket Ready. Only that run's own lease is released here.
  if (r.taskKey) {
    const store = readerOf(db);
    const p = await store.get("projects", { slug: r.project });
    const t = p ? await store.get("tasks", { projectId: p.id, key: r.taskKey }) : undefined;
    if (t?.status === "In progress" && isSessionOf(t.owner?.session_id, r.id)) {
      await claim(db, { project: r.project, key: r.taskKey, action: "release" } as never, { ...webCtx, tool: "screen.run_resume" });
    }
  }
  const out = await wakeAgent(db, { agent: r.agent, taskKey: r.taskKey ?? undefined }, deps);
  return { woke: out.woke, reason: out.reason, ticket: r.taskKey };
}

export async function noteForAgent(db: Db, slug: string, key: string, text: string): Promise<{ noted: true } | Refusal> {
  const r = readerOf(db);
  const p = await r.get("projects", { slug });
  if (!p) return { error: "PROJECT_NOT_FOUND", status: 404, hint: "no such project" };
  const t = await r.get("tasks", { projectId: p.id, key });
  if (!t) return { error: "TASK_NOT_FOUND", status: 404, hint: "Ese ticket no está." };
  await setTask(db, { project: slug, key, note: `De Compañía: ${text.trim()}` } as never, { ...webCtx, tool: "screen.run_note" });
  return { noted: true };
}
