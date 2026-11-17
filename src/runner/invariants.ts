// PLA-I60-6: the runner's rules, checked against the database. Admission is built to keep them (spec section 5);
// this proves it: the load test calls it every 100 ms, and the audit job turns any violation into a finding.
//   I1  one active run per (agent, project, work key)            (the unique index makes this impossible)
//   I2  no lock key held by a run that is no longer live          (a leak would block that folder or branch)
//   I3  a project's live work-lane runs within «Agentes a la vez»; its questions within «Preguntas a la vez»
//   I4  an agent's live work runs within its cap
//   I5  live work runs within the ceiling minus reserved slots (questions: I3b); a worker's runs within its capacity
// Lowering a number never stops a live run, so I3-I5 are not checked for ten minutes after one changed.
import { sql } from "drizzle-orm";
import type { Q } from "../mcp/tx.js";

export type Violation = { code: "I1" | "I2" | "I3" | "I3b" | "I4" | "I5" | "I5b"; detail: string };

export async function checkRunnerInvariants(db: Q): Promise<Violation[]> {
  const out: Violation[] = [];
  const rows = async (q: ReturnType<typeof sql>) => (await db.execute<Record<string, unknown>>(q)).rows;
  for (const r of await rows(sql`
    select agent_id, project_id, work_key, count(*)::int n from agent_runs
    where status in ('queued', 'starting', 'running') group by 1, 2, 3 having count(*) > 1`))
    out.push({ code: "I1", detail: `${r.work_key}: ${r.n} active runs for one agent` });
  for (const r of await rows(sql`
    select l.lock_key, r.status from run_locks l join agent_runs r on r.id = l.run_id
    where r.status not in ('starting', 'running')`))
    out.push({ code: "I2", detail: `${r.lock_key} held by a ${r.status} run` });

  const [changed] = await rows(sql`
    select (exists (select 1 from events where type in ('project.runner', 'agent.parallel', 'company.ceiling') and created_at > now() - interval '10 minutes')
         or exists (select 1 from runner_settings where updated_at > now() - interval '10 minutes')) as recent`);
  if (changed?.recent) return out;

  for (const r of await rows(sql`
    select a.project_id, count(*)::int live, coalesce((p.settings->'runner'->>'max_concurrent')::int, 1) cap
    from agent_runs r join agents a on a.id = r.agent_id join projects p on p.id = a.project_id
    where r.status in ('starting', 'running') and r.lane = 'work'
    group by a.project_id, p.settings having count(*) > coalesce((p.settings->'runner'->>'max_concurrent')::int, 1)`))
    out.push({ code: "I3", detail: `project ${r.project_id}: ${r.live} live over ${r.cap}` });
  for (const r of await rows(sql`
    select r.project_id, count(*)::int live, coalesce((p.settings->'runner'->>'consulta_slots')::int, 1) cap
    from agent_runs r join projects p on p.id = r.project_id
    where r.status in ('starting', 'running') and r.lane = 'consulta'
    group by r.project_id, p.settings having count(*) > coalesce((p.settings->'runner'->>'consulta_slots')::int, 1)`))
    out.push({ code: "I3b", detail: `project ${r.project_id}: ${r.live} questions over ${r.cap}` });
  for (const r of await rows(sql`
    select r.agent_id, count(*)::int live, coalesce(a.max_parallel, case when a.project_id is null then 1 else (p.settings->'runner'->>'max_per_agent')::int end, 1) cap
    from agent_runs r join agents a on a.id = r.agent_id left join projects p on p.id = a.project_id
    where r.status in ('starting', 'running') and r.lane = 'work'
    group by r.agent_id, a.max_parallel, a.project_id, p.settings
    having count(*) > coalesce(a.max_parallel, case when a.project_id is null then 1 else (p.settings->'runner'->>'max_per_agent')::int end, 1)`))
    out.push({ code: "I4", detail: `agent ${r.agent_id}: ${r.live} live over ${r.cap}` });
  for (const r of await rows(sql`
    select count(*)::int live,
           (select max_concurrent from runner_settings where id = 1)
           - coalesce((select sum(slots) from runner_reservations where expires_at > now()), 0)::int allowed
    from agent_runs where status in ('starting', 'running') and lane = 'work'
    having count(*) > (select max_concurrent from runner_settings where id = 1)
           - coalesce((select sum(slots) from runner_reservations where expires_at > now()), 0)`))
    out.push({ code: "I5", detail: `${r.live} live over ${r.allowed}` });
  for (const r of await rows(sql`
    select r.worker_id, count(*)::int live, w.capacity from agent_runs r join runner_workers w on w.id = r.worker_id
    where r.status in ('starting', 'running') group by r.worker_id, w.capacity having count(*) > w.capacity`))
    out.push({ code: "I5b", detail: `worker ${r.worker_id}: ${r.live} live over ${r.capacity}` });
  return out;
}
