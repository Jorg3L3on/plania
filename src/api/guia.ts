// PLA-I2-16: the guide to a first delivery (GET /api/guia, cookie only, mounted in src/api/routes.ts). Every step is
// read from data, so it ticks itself; the screen turns this read into steps and words (ui/src/lib/primera-entrega.ts).
//   maquina   the newest machine check reading any page took (src/api/machine-check.ts): lista, falta, sin_revisar
//   proyecto  the first project made after first start (not Asistente's home), with its team
//   reanudar  the company and that project are both running
//   pedido    that project has a task (a request makes the product owner's ticket or idea)
//   plan      a plan from its product owner waits for «Sí, empiecen» (espera), or one was approved or needed none
//   entrega   a delivery waits for Aceptar (a ticket In review), or one was accepted anywhere (the guide goes away)
//   fallo     the project's newest run, when it could not start or found Claude signed out: the reason and the fix
// POST /api/guia/ejemplo makes the example project for someone with no repository at hand: no code, paused, its team.
import { Hono } from "hono";
import { and, asc, desc, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import { withDb, type Db } from "../db/client.js";
import { agentRuns, agents, projects, tasks, threadMessages, threads } from "../db/schema.js";
import { loadSettings } from "../runner/limits.js";
import { createProjectFromTemplate } from "../runner/new-project.js";
import { failReason, startFailureOf } from "../runner/start-failures.js";
import { SIGNED_OUT } from "../runner/signed-out.js";
import { homeSlug } from "../runner/threads.js";
import { arranqueOf } from "../../ui/src/lib/arranque.js";
import { EJEMPLO, type GuiaRead } from "../../ui/src/lib/primera-entrega.js";
import { latestMachineReading } from "./machine-check.js";
import type { MachineCheckReading } from "../../ui/src/lib/falta.js";

export type GuiaDeps = { machine?: () => MachineCheckReading | null; env?: NodeJS.ProcessEnv };

const ACCEPTED = sql`${threadMessages.actionState}->>'action' in ('aceptar', 'fusionar') and not (${threadMessages.actionState}->'result' ? 'error')`;

/** True once the owner (or the project's own switch) accepted any delivery: the guide's job is done. */
export async function firstDeliveryAccepted(db: Db): Promise<boolean> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(threadMessages).where(ACCEPTED);
  return (row?.n ?? 0) > 0;
}

const showsFailure = (summary: string): boolean => !!startFailureOf(summary) || failReason(summary) === SIGNED_OUT;

export async function guiaRead(db: Db, deps: GuiaDeps = {}): Promise<GuiaRead> {
  const env = deps.env ?? process.env;
  const settings = await loadSettings(db);
  const reading = (deps.machine ?? latestMachineReading)();
  const accepted = await firstDeliveryAccepted(db);

  // The first project with a team, other than Asistente's home (first start makes it with no team).
  const [p] = await db
    .select({ id: projects.id, slug: projects.slug, title: projects.title, paused: projects.runsPaused })
    .from(projects)
    .where(and(ne(projects.slug, homeSlug(env)), sql`exists (select 1 from ${agents} a where a.project_id = ${projects.id})`))
    .orderBy(asc(projects.createdAt))
    .limit(1);

  let pedido = false;
  let plan: GuiaRead["plan"] = "nada";
  let entrega: GuiaRead["entrega"] = accepted ? "aceptada" : "nada";
  let fallo: GuiaRead["fallo"] = null;
  if (p) {
    const [t] = await db.select({ n: sql<number>`count(*)::int` }).from(tasks).where(eq(tasks.projectId, p.id));
    pedido = (t?.n ?? 0) > 0;
    const plans = await db
      .select({ proposal: threadMessages.proposal, state: threadMessages.actionState })
      .from(threadMessages)
      .innerJoin(threads, eq(threads.id, threadMessages.threadId))
      .where(and(eq(threads.projectId, p.id), sql`${threadMessages.proposal}->>'kind' = 'plan'`));
    if (plans.some((m) => (m.state?.action as string | undefined) === "empezar" || (m.proposal && !m.proposal.needs_approval))) plan = "aprobado";
    else if (plans.some((m) => !m.state && m.proposal?.needs_approval)) plan = "espera";
    if (entrega !== "aceptada") {
      const [review] = await db.select({ n: sql<number>`count(*)::int` }).from(tasks).where(and(eq(tasks.projectId, p.id), eq(tasks.status, "In review")));
      if ((review?.n ?? 0) > 0) entrega = "espera";
    }
    // A plan whose steps were made also means the owner said yes; a delivery means a plan went ahead.
    if (plan === "nada" && entrega !== "nada") plan = "aprobado";

    const [run] = await db
      .select({ status: agentRuns.status, summary: agentRuns.summary, ticket: agentRuns.taskKey, at: agentRuns.endedAt })
      .from(agentRuns)
      .innerJoin(agents, eq(agents.id, agentRuns.agentId))
      .where(and(eq(agents.projectId, p.id), inArray(agentRuns.status, ["ok", "fail", "stopped", "running", "starting", "queued"]), isNotNull(agentRuns.queuedAt)))
      .orderBy(desc(agentRuns.queuedAt))
      .limit(1);
    const summary = run?.summary ?? "";
    if (run?.status === "fail" && showsFailure(summary)) {
      const w = arranqueOf(summary)!;
      fallo = { summary, ticket: run.ticket ?? null, at: run.at ? run.at.toISOString() : null, por: w.por, arregla: w.arregla };
    }
  }

  return {
    visible: !accepted,
    proyecto: p ? { slug: p.slug, title: p.title } : null,
    maquina: !reading ? "sin_revisar" : reading.ready ? "lista" : "falta",
    company_paused: settings.companyPaused,
    project_paused: p ? p.paused : true,
    pedido,
    plan,
    entrega,
    fallo,
    est_pct_per_run: settings.estPctPerRun,
  };
}

export function guiaRoutes(deps: GuiaDeps = {}) {
  const routes = new Hono();
  routes.get("/", async (c) => c.json(await withDb((db) => guiaRead(db, deps))));
  // The example: refused once a project exists, so a second click cannot make a second one.
  routes.post("/ejemplo", async (c) => {
    const out = await withDb(async (db) => {
      const read = await guiaRead(db, deps);
      if (read.proyecto) return { error: "PROJECT_EXISTS", status: 409 as const, slug: read.proyecto.slug };
      return createProjectFromTemplate(db, { name: EJEMPLO.name, goal: EJEMPLO.goal, no_code: true }, { ctx: undefined });
    });
    if ("error" in out) {
      const { status, ...rest } = out as { status: number } & Record<string, unknown>;
      return c.json(rest, status as 400 | 409);
    }
    return c.json(out, 201);
  });
  return routes;
}
