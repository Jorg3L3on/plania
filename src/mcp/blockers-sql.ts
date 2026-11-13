import { sql } from "drizzle-orm";
import { blockers, envCommits, envStates, projectMetrics, taskBlockers, tasks } from "../db/schema.js";

// SQL: the blocker row (alias) holds, isGating's rule (jorge-lines.ts). Parsed lines from other fields only reach the inbox.
export const gatingSql = (alias: string) => sql.raw(`not (coalesce(${alias}.spec->>'source', '') = 'parsed' and coalesce(${alias}.spec->>'field', '') <> 'blocked_note')`);

// Legacy SQL for callers not yet on the store port (runner/events.ts, runner/failed.ts, audit.ts,
// readiness.ts). blockers.ts evaluates the same rule over store rows (blockedTaskIds); this file goes
// away once those callers move.

// SQL: true when the task (by id expression) has a blocker that does not hold yet.
export function hasUnsatisfiedBlocker(taskId: unknown) {
  return sql`(
    exists (
      select 1 from ${taskBlockers} tb join ${tasks} b on b.id = tb.blocker_id
      where tb.task_id = ${taskId} and b.status not in ('In review', 'Merged', 'Released', 'Done')
    )
    or exists (
      select 1 from ${blockers} bl
      join ${tasks} bt on bt.id = bl.task_id
      left join ${envStates} es on es.project_id = bt.project_id and es.env = bl.spec->>'env'
      where bl.task_id = ${taskId} and ${gatingSql("bl")} and not coalesce(case bl.type
        when 'env' then case bl.spec->>'condition'
          when 'migration_gte' then es.migrations_applied >= (bl.spec->>'value')::int
          when 'deployed_after' then es.deployed_at > (bl.spec->>'value')::timestamptz
          when 'contains_commit' then exists (
            select 1 from ${envCommits} ec
            where ec.project_id = bt.project_id and ec.env = bl.spec->>'env' and ec.sha like (bl.spec->>'value') || '%'
          )
        end
        when 'human_action' then bl.satisfied_at is not null
        when 'env_flag' then es.flags -> (bl.spec->>'flag') = bl.spec -> 'equals'
        when 'time_after' then now() >= (bl.spec->>'at')::timestamptz
        when 'metric_gte' then exists (
          select 1 from ${projectMetrics} pm
          where pm.project_id = bt.project_id and pm.name = bl.spec->>'name' and pm.value >= (bl.spec->>'value')::numeric
        )
      end, false)
    )
  )`;
}
