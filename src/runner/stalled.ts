// PLA-I60-4: the sweep that keeps an idea from sitting in a stage nobody works on (see stages.ts).
import type { Db } from "../db/client.js";
import type { Agent, Task } from "../db/schema.js";
import { readerOf } from "../store/port.js";
import { enqueueWake, eventWakesEnabled, serviceAgent } from "./events.js";
import { ACTIVE_STATUSES, workKeyOf } from "./queue.js";
import { STAGE_REASON, stageOwner, type IdeaStage } from "./stages.js";

const SWEPT: readonly string[] = ["idea", "research", "design", "planning"];

// An event that set the idea's stage: its creation, or an update whose changes name the stage.
function setsStage(e: { type: string; payload: Record<string, unknown> }): boolean {
  if (e.type === "task.created") return true;
  if (e.type !== "task.updated") return false;
  const changes = e.payload?.changes;
  if (Array.isArray(changes)) return changes.includes("stage");
  return !!changes && typeof changes === "object" && Object.prototype.hasOwnProperty.call(changes, "stage");
}

// One retry per open idea whose stage owner has had no run on it since the stage last changed.
export async function sweepStalledIdeas(db: Db, now = new Date(), env: NodeJS.ProcessEnv = process.env): Promise<number> {
  if (!eventWakesEnabled(env)) return 0;
  const r = readerOf(db);
  const found: { t: Task; slug: string }[] = [];
  const ideas = await r.find("tasks", { kind: "idea", status: "Open", promotedTo: null, stage: [...SWEPT] }, { orderBy: [{ column: "createdAt" }] });
  for (const t of ideas) {
    if (found.length >= 50) break;
    const p = await r.get("projects", { id: t.projectId });
    if (!p || p.runsPaused) continue;
    const runs = await r.find("agentRuns", { projectId: t.projectId, workKey: workKeyOf(t.key) });
    // Its stage owner already has the work queued or live.
    if (runs.some((x) => (ACTIVE_STATUSES as readonly string[]).includes(x.status))) continue;
    // When the stage last changed (the idea's creation, else when it was made).
    const stageEvents = (await r.find("events", { taskId: t.id })).filter(setsStage);
    const since = stageEvents.reduce<Date | null>((a, e) => (!a || e.createdAt > a ? e.createdAt : a), null) ?? t.createdAt;
    const role = stageOwner(t.stage);
    if (runs.some((x) => x.role === role && x.queuedAt.getTime() >= since.getTime())) continue;
    found.push({ t, slug: p.slug });
  }
  let queued = 0;
  for (const { t, slug } of found) {
    const stage = t.stage as IdeaStage;
    const role = stageOwner(stage);
    if (!role) continue;
    const project = { id: t.projectId, slug };
    // The PO that owns the idea, else the project's agent for that role.
    let agent: Agent | null = null;
    if (role === "product-owner" && t.ownerAgent) agent = (await r.get("agents", { id: t.ownerAgent })) ?? null;
    agent ??= await serviceAgent(db, role, project);
    const out = await enqueueWake(db, { agent, project, taskKey: t.key, reason: `${STAGE_REASON[stage]} (stage ${stage} had no run)`, now, trigger: "retry" });
    if (out.kind === "queued") queued += 1;
  }
  return queued;
}
