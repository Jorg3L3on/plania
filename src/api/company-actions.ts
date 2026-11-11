// PLA-I30-6/7: the two actions on a project sheet, on the cookie-only company routes (src/api/company.ts).
//   POST /api/company/projects/:slug/ask  {text}  Pedirle al PO: a Ready ticket owned by po-<slug>, origin jorge.
//        The event hook (src/runner/events.ts) queues the PO's wake in the same write.
//   POST /api/company/projects/:slug/wake         Despertar ahora: one wake of po-<slug> through wakeAgent,
//        only when the PO has Ready work in this project; otherwise {woke: false, reason: "idle"} and no run.
// Both refuse a paused project or company, and a project without a runner PO, with 409 and a reason.
// PLA-I36-6/8: ask takes {kind: cambio | direccion | idea, now}; now wakes the PO at once (only when it has
//   Ready work, which the new ticket is). The ticket's scope asks the PO for a plan through `propose`.
//   POST /api/company/projects/:slug/next {key}       Cambiar lo siguiente: that Ready ticket goes first.
//   PUT  /api/company/projects/:slug/options {plan_approval?, preview_url?}
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { agentRuns, agents, projects, tasks, type Agent } from "../db/schema.js";
import { loadReady, pickReady, wakeAgent, type HeartbeatDeps } from "../jobs/heartbeat.js";
import { WEB_ACTOR } from "../mcp/tx.js";
import { createTask } from "../mcp/writes.js";
import { eventWakesEnabled } from "../runner/events.js";
import { loadSettings, roleOf } from "../runner/limits.js";

export type ActionRefusal = { error: "PROJECT_NOT_FOUND" | "PROJECT_PAUSED" | "COMPANY_PAUSED" | "NO_PO"; status: 404 | 409; hint: string };

// PLA-I32-2: the PO of a project is the runner agent on its team (project_id) made from the product-owner
// template; a row from before 0041 is still found by po-<slug> or a capability naming the project.
export async function projectPo(db: Db, project: { id: string; slug: string }): Promise<Agent | null> {
  const rows = await db.select().from(agents).where(and(eq(agents.adapter, "claude_code"), sql`${agents.status} <> 'retired'`));
  const pos = rows.filter((a) => roleOf(a) === "product-owner");
  return (
    pos.find((a) => a.projectId === project.id) ??
    pos.find((a) => !a.projectId && (a.slug === `po-${project.slug}` || a.capabilities.includes(project.slug))) ??
    null
  );
}

type Guard = { project: { id: string; slug: string }; po: Agent };

async function guard(db: Db, slug: string): Promise<Guard | ActionRefusal> {
  const [project] = await db.select({ id: projects.id, slug: projects.slug, paused: projects.runsPaused }).from(projects).where(eq(projects.slug, slug)).limit(1);
  if (!project) return { error: "PROJECT_NOT_FOUND", status: 404, hint: "no such project" };
  if ((await loadSettings(db)).companyPaused) return { error: "COMPANY_PAUSED", status: 409, hint: "La compañía está detenida." };
  if (project.paused) return { error: "PROJECT_PAUSED", status: 409, hint: "El proyecto está en pausa: reanúdalo primero." };
  const po = await projectPo(db, project);
  if (!po) return { error: "NO_PO", status: 409, hint: "Este proyecto no tiene un PO que corra en Claude Code." };
  return { project: { id: project.id, slug: project.slug }, po };
}

export const firstLine = (text: string) => {
  const line = text.trim().split("\n")[0]!.trim();
  return line.length > 120 ? `${line.slice(0, 117)}…` : line;
};

export type OrderKind = "cambio" | "direccion" | "idea";
const KIND_WORD: Record<OrderKind, string> = { cambio: "un cambio", direccion: "una dirección", idea: "una idea" };
export type AskResult = { key: string; title: string; po: string; wake: "queued" | "busy" | "off"; woke: WakeOutcome | null };

// A Ready ticket owned by the project's PO, origin jorge; the event hook queues the PO's wake in the same
// write. wake says what happened: queued (on this ticket), busy (the PO already has a run), off (no wakes).
export async function createPoTicket(
  db: Db,
  project: { slug: string },
  po: Agent,
  text: string,
  from = "Compañía",
  kind: OrderKind | null = null,
): Promise<{ key: string; title: string; wake: "queued" | "busy" | "off" }> {
  const sentence = text.trim();
  const [proj] = await db.select({ settings: projects.settings }).from(projects).where(eq(projects.slug, project.slug)).limit(1);
  const approval = !!proj?.settings.plan_approval;
  const out = (await createTask(
    db,
    {
      project: project.slug,
      title: firstLine(sentence),
      status: "Ready",
      origin: "jorge",
      work_type: "ops",
      priority: "P2",
      owner_agent: po.slug,
      scope: [
        `Pedido de Jorge desde ${from}${kind ? ` (${KIND_WORD[kind]})` : ""}: "${sentence}"`,
        "",
        "Para el PO: escribe el alcance real y los checks de este ticket antes de empezar, y una nota `Entendí: …` con lo que entendiste en una línea.",
        approval
          ? `Este proyecto aprueba planes: no crees tickets para Taller. Propón el plan con \`propose\` (kind plan, order: la clave de este ticket): lo que entendiste, los pasos con lo que significa hecho y el costo. Plania crea los tickets cuando alguien diga "Sí, empiecen".`
          : "Si es trabajo de PO (docs, plan, ideas), hazlo aquí. Si hace falta código, propón el plan con `propose` (kind plan) o crea tickets Listos para Taller, y cierra este con lo que dejaste.",
      ].join("\n"),
      checks: ["El PO reescribió alcance y checks, y lo hizo o lo partió en tickets para Taller"],
    },
    { actor: WEB_ACTOR, human: true, tool: "company.ask" },
  )) as { key: string };
  const [run] = await db
    .select({ id: agentRuns.id, taskKey: agentRuns.taskKey })
    .from(agentRuns)
    .where(and(eq(agentRuns.agentId, po.id), inArray(agentRuns.status, ["queued", "running"])))
    .limit(1);
  const wake = !eventWakesEnabled() ? "off" : run?.taskKey === out.key ? "queued" : run ? "busy" : "off";
  return { key: out.key, title: firstLine(sentence), wake };
}

export async function askPo(db: Db, slug: string, text: string, opts: { kind?: OrderKind; now?: boolean } = {}, deps?: HeartbeatDeps): Promise<AskResult | ActionRefusal> {
  const g = await guard(db, slug);
  if ("error" in g) return g;
  const made = await createPoTicket(db, g.project, g.po, text, "Compañía", opts.kind ?? null);
  const woke = opts.now ? await wakePo(db, slug, deps) : null;
  return { key: made.key, title: made.title, po: g.po.slug, wake: made.wake, woke: woke && !("error" in woke) ? woke : null };
}

// PLA-I36-6: Cambiar lo siguiente. The ticket must be Ready in this project.
export async function pickNext(db: Db, slug: string, key: string): Promise<{ next: string } | { error: string; status: 404 | 409; hint: string }> {
  const [p] = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
  if (!p) return { error: "PROJECT_NOT_FOUND", status: 404, hint: "no such project" };
  const [t] = await db.select({ status: tasks.status, kind: tasks.kind }).from(tasks).where(and(eq(tasks.projectId, p.id), eq(tasks.key, key))).limit(1);
  if (!t || t.kind !== "ticket") return { error: "TASK_NOT_FOUND", status: 404, hint: "Ese ticket no está en el proyecto." };
  if (t.status !== "Ready") return { error: "NOT_READY", status: 409, hint: "Solo un ticket listo puede ir primero." };
  await db.update(projects).set({ settings: { ...p.settings, next_first: key }, updatedAt: sql`now()` }).where(eq(projects.id, p.id));
  return { next: key };
}

// PLA-I36-8/10: the project's switches that are not limits: plan approval and the preview address.
export async function setProjectOptions(db: Db, slug: string, input: { plan_approval?: boolean; preview_url?: string | null }): Promise<{ plan_approval: boolean; preview_url: string | null } | { error: string; status: 404; hint: string }> {
  const [p] = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
  if (!p) return { error: "PROJECT_NOT_FOUND", status: 404, hint: "no such project" };
  const settings = { ...p.settings };
  if (input.plan_approval !== undefined) settings.plan_approval = input.plan_approval;
  if (input.preview_url !== undefined) {
    if (input.preview_url) settings.preview_url = input.preview_url;
    else delete settings.preview_url;
  }
  await db.update(projects).set({ settings, updatedAt: sql`now()` }).where(eq(projects.id, p.id));
  return { plan_approval: !!settings.plan_approval, preview_url: settings.preview_url ?? null };
}

export type WakeOutcome = { woke: boolean; reason: string; ticket: string | null; summary: string };

export async function wakePo(db: Db, slug: string, deps?: HeartbeatDeps): Promise<WakeOutcome | ActionRefusal> {
  const g = await guard(db, slug);
  if ("error" in g) return g;
  const work = pickReady(g.po, (await loadReady(db)).filter((r) => r.project === g.project.slug));
  if (!work) return { woke: false, reason: "idle", ticket: null, summary: "Sin trabajo para el PO: pídele algo." };
  const out = await wakeAgent(db, { agent: g.po.slug, taskKey: work.key }, deps);
  return { woke: out.woke, reason: out.reason, ticket: out.run?.task_key ?? work.key, summary: out.run?.summary ?? "" };
}
