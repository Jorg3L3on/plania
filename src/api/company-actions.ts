// PLA-I30-6/7: the two actions on a project sheet, on the cookie-only company routes (src/api/company.ts).
//   POST /api/company/projects/:slug/ask  {text}  Pedirle al PO: a Ready ticket owned by po-<slug>, origin jorge.
//        The event hook (src/runner/events.ts) queues the PO's wake in the same write.
//   POST /api/company/projects/:slug/wake         Despertar ahora: one wake of po-<slug> through wakeAgent,
//        only when the PO has Ready work in this project; otherwise {woke: false, reason: "idle"} and no run.
// Both refuse a paused project or company, and a project without a runner PO, with 409 and a reason.
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { agentRuns, agents, projects, type Agent } from "../db/schema.js";
import { loadReady, pickReady, wakeAgent, type HeartbeatDeps } from "../jobs/heartbeat.js";
import { WEB_ACTOR } from "../mcp/tx.js";
import { createTask } from "../mcp/writes.js";
import { eventWakesEnabled } from "../runner/events.js";
import { loadSettings, roleOf } from "../runner/limits.js";

export type ActionRefusal = { error: "PROJECT_NOT_FOUND" | "PROJECT_PAUSED" | "COMPANY_PAUSED" | "NO_PO"; status: 404 | 409; hint: string };

type Gate = { project: { id: string; slug: string }; po: Agent };

async function gate(db: Db, slug: string): Promise<Gate | ActionRefusal> {
  const [project] = await db.select({ id: projects.id, slug: projects.slug, paused: projects.runsPaused }).from(projects).where(eq(projects.slug, slug)).limit(1);
  if (!project) return { error: "PROJECT_NOT_FOUND", status: 404, hint: "no such project" };
  if ((await loadSettings(db)).companyPaused) return { error: "COMPANY_PAUSED", status: 409, hint: "La compañía está detenida." };
  if (project.paused) return { error: "PROJECT_PAUSED", status: 409, hint: "El proyecto está en pausa: reanúdalo primero." };
  const rows = await db.select().from(agents).where(eq(agents.adapter, "claude_code"));
  const po = rows.find((a) => roleOf(a) === "product-owner" && (a.slug === `po-${slug}` || a.capabilities.includes(slug)));
  if (!po) return { error: "NO_PO", status: 409, hint: "Este proyecto no tiene un PO que corra en Claude Code." };
  return { project: { id: project.id, slug: project.slug }, po };
}

const firstLine = (text: string) => {
  const line = text.trim().split("\n")[0]!.trim();
  return line.length > 120 ? `${line.slice(0, 117)}…` : line;
};

export type AskResult = { key: string; title: string; po: string; wake: "queued" | "busy" | "off" };

export async function askPo(db: Db, slug: string, text: string): Promise<AskResult | ActionRefusal> {
  const g = await gate(db, slug);
  if ("error" in g) return g;
  const sentence = text.trim();
  const out = (await createTask(
    db,
    {
      project: g.project.slug,
      title: firstLine(sentence),
      status: "Ready",
      origin: "jorge",
      work_type: "ops",
      priority: "P2",
      owner_agent: g.po.slug,
      scope: [
        `Pedido de Jorge desde Compañía: "${sentence}"`,
        "",
        "Para el PO: escribe el alcance real y los checks de este ticket antes de empezar. Si es trabajo de PO (docs, plan, ideas), hazlo aquí. Si hace falta código, crea tickets Listos para Taller y cierra este con lo que dejaste.",
      ].join("\n"),
      checks: ["El PO reescribió alcance y checks, y lo hizo o lo partió en tickets para Taller"],
    },
    { actor: WEB_ACTOR, human: true, tool: "company.ask" },
  )) as { key: string };
  const [run] = await db
    .select({ id: agentRuns.id, taskKey: agentRuns.taskKey })
    .from(agentRuns)
    .where(and(eq(agentRuns.agentId, g.po.id), inArray(agentRuns.status, ["queued", "running"])))
    .limit(1);
  const wake = !eventWakesEnabled() ? "off" : run?.taskKey === out.key ? "queued" : run ? "busy" : "off";
  return { key: out.key, title: firstLine(sentence), po: g.po.slug, wake };
}

export type WakeOutcome = { woke: boolean; reason: string; ticket: string | null; summary: string };

export async function wakePo(db: Db, slug: string, deps?: HeartbeatDeps): Promise<WakeOutcome | ActionRefusal> {
  const g = await gate(db, slug);
  if ("error" in g) return g;
  const work = pickReady(g.po, (await loadReady(db)).filter((r) => r.project === g.project.slug));
  if (!work) return { woke: false, reason: "idle", ticket: null, summary: "Sin trabajo para el PO: pídele algo." };
  const out = await wakeAgent(db, { agent: g.po.slug, taskKey: work.key }, deps);
  return { woke: out.woke, reason: out.reason, ticket: out.run?.task_key ?? work.key, summary: out.run?.summary ?? "" };
}
