// PLA-I59-2 (Motores): the screen's write for the floor's «Motores» console, the teammate's Motor card and Sumar.
//   PUT /api/company/motores {project, seats?: [{agent, motor?, consulta_motor?}], company?: {model?, effort?}}
//     motor / consulta_motor: {model?, effort?} where null clears that part (the seat inherits again), or null for
//     both. company sets the default every inheriting seat follows. All or nothing: one bad value (field + hint,
//     400) or a seat not on the project's team (404) changes nothing. One event per changed seat, and one for the
//     default. A live run keeps the flags it started with; the next run reads the new values.
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { agents, projects, runnerSettings } from "../db/schema.js";
import { ToolError } from "../mcp/errors.js";
import { checkMotor, motorColumns, type MotorPatch } from "../mcp/team.js";
import { webCtx, writeTx } from "../mcp/tx.js";
import { loadSettings } from "../runner/limits.js";
import { notifyQueue } from "../runner/queue.js";

// PLA-I60-5: the same save carries «a la vez»: a seat's own count (max_parallel, null: del piso), the project's
// floor (max_concurrent, max_per_agent, consulta_slots in projects.settings.runner) and the company's ceiling
// (runner_settings.max_concurrent, «Tope de la Mac»). The route validated the ranges.
export type MotoresInput = {
  project: string;
  seats?: { agent: string; motor?: MotorPatch | null; consulta_motor?: MotorPatch | null; max_parallel?: number | null }[];
  floor?: { max_concurrent?: number; max_per_agent?: number; consulta_slots?: number };
  company?: MotorPatch & { max_concurrent?: number };
};

export type MotoresError = { error: "PROJECT_NOT_FOUND" | "AGENT_NOT_FOUND" | "INVALID_FILTER"; status: 400 | 404; field?: string; hint?: string; agent?: string };

export async function setMotores(db: Db, input: MotoresInput): Promise<{ changed: string[]; company: boolean; floor?: boolean } | MotoresError> {
  const [p] = await db.select().from(projects).where(eq(projects.slug, input.project)).limit(1);
  if (!p) return { error: "PROJECT_NOT_FOUND", status: 404 };
  // Validate everything before writing anything.
  let plans: { agent: string; cols: ReturnType<typeof motorColumns> }[];
  let company: { model?: string | null; effort?: string | null } = {};
  try {
    plans = (input.seats ?? []).map((s, i) => ({
      agent: s.agent,
      cols: motorColumns(checkMotor(`seats.${i}.motor`, s.motor), checkMotor(`seats.${i}.consulta_motor`, s.consulta_motor)),
    }));
    if (input.company) company = checkMotor("company", { model: input.company.model, effort: input.company.effort });
  } catch (e) {
    if (e instanceof ToolError) return { error: "INVALID_FILTER", status: 400, field: String(e.detail.field ?? ""), hint: String(e.detail.hint ?? "") };
    throw e;
  }
  const slugs = [...new Set([...plans.map((x) => x.agent), ...(input.seats ?? []).map((x) => x.agent)])];
  const team = slugs.length ? await db.select({ id: agents.id, slug: agents.slug, roleTemplate: agents.roleTemplate }).from(agents).where(and(eq(agents.projectId, p.id), inArray(agents.slug, slugs))) : [];
  const missing = slugs.find((s) => !team.some((t) => t.slug === s));
  if (missing) return { error: "AGENT_NOT_FOUND", status: 404, agent: missing };
  const changed: string[] = [];
  await loadSettings(db);
  const parallel = new Map((input.seats ?? []).filter((x) => x.max_parallel !== undefined).map((x) => [x.agent, x.max_parallel ?? null]));
  const floor = input.floor && Object.values(input.floor).some((v) => v !== undefined) ? input.floor : null;
  const ceiling = input.company?.max_concurrent;
  await writeTx(db, p, { ...webCtx, tool: "screen.motores" }, async (tx, emit) => {
    for (const [agent, n] of parallel) {
      const row = team.find((t) => t.slug === agent)!;
      await tx.update(agents).set({ maxParallel: n, updatedAt: sql`now()` }).where(eq(agents.id, row.id));
      await emit("agent.parallel", null, { agent, max_parallel: n });
      if (!changed.includes(agent)) changed.push(agent);
    }
    if (floor) {
      const runner = { ...(p.settings?.runner ?? {}), ...Object.fromEntries(Object.entries(floor).filter(([, v]) => v !== undefined)) };
      await tx.update(projects).set({ settings: sql`coalesce(${projects.settings}, '{}'::jsonb) || jsonb_build_object('runner', ${JSON.stringify(runner)}::jsonb)` }).where(eq(projects.id, p.id));
      await emit("project.runner", null, { runner });
    }
    if (ceiling !== undefined) {
      await tx.update(runnerSettings).set({ maxConcurrent: ceiling, updatedAt: sql`now()` }).where(eq(runnerSettings.id, 1));
      await emit("company.ceiling", null, { max_concurrent: ceiling });
    }
    for (const plan of plans) {
      if (Object.keys(plan.cols).length === 0) continue;
      const row = team.find((t) => t.slug === plan.agent)!;
      // Preguntar is a PO's: another seat's consulta values are ignored.
      const cols = row.roleTemplate === "product-owner" ? plan.cols : { ...plan.cols, consultaModel: undefined, consultaEffort: undefined };
      const set = Object.fromEntries(Object.entries(cols).filter(([, v]) => v !== undefined));
      if (Object.keys(set).length === 0) continue;
      await tx.update(agents).set({ ...set, updatedAt: sql`now()` }).where(eq(agents.id, row.id));
      await emit("agent.motor", null, { agent: plan.agent, ...set });
      changed.push(plan.agent);
    }
    if (company.model !== undefined || company.effort !== undefined) {
      await tx
        .update(runnerSettings)
        .set({ ...(company.model !== undefined ? { defaultModel: company.model } : {}), ...(company.effort !== undefined ? { defaultEffort: company.effort } : {}), updatedAt: sql`now()` })
        .where(eq(runnerSettings.id, 1));
      await emit("company.motor", null, { ...company });
    }
  });
  // A higher limit can start queued work now.
  if (parallel.size || floor || ceiling !== undefined) await notifyQueue(db);
  return { changed, company: company.model !== undefined || company.effort !== undefined || ceiling !== undefined, floor: !!floor };
}
