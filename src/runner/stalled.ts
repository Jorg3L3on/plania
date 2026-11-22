// PLA-I60-4: the sweep that keeps an idea from sitting in a stage nobody works on (see stages.ts).
import { eq, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { agents, type Agent } from "../db/schema.js";
import { enqueueWake, eventWakesEnabled, serviceAgent } from "./events.js";
import { STAGE_REASON, stageOwner, type IdeaStage } from "./stages.js";
import { ST } from "../state/status.js";

type Stalled = { id: string; key: string; stage: IdeaStage; project_id: string; slug: string; owner_agent: string | null } & Record<string, unknown>;

// One retry per open idea whose stage owner has had no run on it since the stage last changed.
export async function sweepStalledIdeas(db: Db, now = new Date(), env: NodeJS.ProcessEnv = process.env): Promise<number> {
  if (!eventWakesEnabled(env)) return 0;
  const found = await db.execute<Stalled>(sql`
    select t.id, t.key, t.stage, t.project_id, p.slug, t.owner_agent
    from tasks t
    join projects p on p.id = t.project_id
    where t.kind = 'idea' and t.status = ${ST.open} and t.promoted_to is null and t.stage in ('idea', 'research', 'design', 'planning')
      and not p.runs_paused
      and not exists (
        select 1 from agent_runs r
        where r.project_id = t.project_id and r.work_key = 'task:' || t.key and r.status in ('queued', 'starting', 'running'))
      and not exists (
        select 1 from agent_runs r
        where r.project_id = t.project_id and r.work_key = 'task:' || t.key and r.role = (case t.stage
            when 'idea' then 'product-owner' when 'research' then 'research' when 'design' then 'artist' when 'planning' then 'product-owner' end)
          and r.queued_at >= coalesce(
            (select max(e.created_at) from events e
              where e.task_id = t.id and ((e.type = 'task.updated' and e.payload->'changes' ? 'stage') or e.type = 'task.created')),
            t.created_at))
    order by t.created_at
    limit 50`);
  let queued = 0;
  for (const row of found.rows) {
    const role = stageOwner(row.stage);
    if (!role) continue;
    const project = { id: row.project_id, slug: row.slug };
    // The PO that owns the idea, else the project's agent for that role.
    let agent: Agent | null = null;
    if (role === "product-owner" && row.owner_agent) agent = (await db.select().from(agents).where(eq(agents.id, row.owner_agent)).limit(1))[0] ?? null;
    agent ??= await serviceAgent(db, role, project);
    const out = await enqueueWake(db, { agent, project, taskKey: row.key, reason: `${STAGE_REASON[row.stage]} (stage ${row.stage} had no run)`, now, trigger: "retry" });
    if (out.kind === "queued") queued += 1;
  }
  return queued;
}
