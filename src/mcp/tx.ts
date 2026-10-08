import { and, eq, sql } from "drizzle-orm";
import type { NodePgQueryResultHKT } from "drizzle-orm/node-postgres";
import type { PgDatabase } from "drizzle-orm/pg-core";
import type { Db } from "../db/client.js";
import type * as schema from "../db/schema.js";
import { events, writeRequests, type Actor, type Project } from "../db/schema.js";
import { bus, type PlaniaEvent } from "../events.js";
import { ToolError } from "./errors.js";

// A Db or an open transaction. Reads that run inside writeTx must use the transaction.
export type Q = PgDatabase<NodePgQueryResultHKT, typeof schema>;

// Who is writing and through which channel. human is true only for Jorge's screen (cookie),
// never inferred from the actor value. requestId + tool make a retry replay the first response.
// verbose: writes return the full task besides the compact {key, status, version, changed} reply.
// system: a poller acting on GitHub or deploy data (moves In review → Merged → Released, no gates).
export type Ctx = { actor: Actor; human?: boolean; system?: boolean; requestId?: string; tool?: string; verbose?: boolean; tokenId?: string };

const REQUEST_TTL = "30 days";

export const WEB_ACTOR: Actor = { agent: "jorge", session_id: "web", machine: "screen" };
// Writes made by Plania itself, e.g. releasing expired leases.
export const SYSTEM_ACTOR: Actor = { agent: "plania", session_id: "system" };
export const webCtx: Ctx = { actor: WEB_ACTOR, human: true };

// actor: the system actor for moves the server makes inside an agent's write (a blocker satisfied).
export type Emit = (
  type: string,
  task: { id: string; key: string } | null,
  payload?: Record<string, unknown>,
  actor?: Actor,
) => Promise<void>;

// Every write runs here: one transaction per call, serialized per project, with its events
// committed or rolled back together with the change. Once it commits, live screens hear about it
// (one change per task touched), whether the write came from an agent, CI or the screen.
export async function writeTx<T>(
  db: Db,
  project: Pick<Project, "id" | "slug">,
  ctx: Ctx,
  fn: (tx: Q, emit: Emit) => Promise<T>,
): Promise<T> {
  const changes = new Map<string, PlaniaEvent>();
  const touched = (type: string, taskKey: string | null) => {
    const change: PlaniaEvent = taskKey
      ? { type: "task", project: project.slug, key: taskKey }
      : { type: type.startsWith("decision.") ? "decision" : "project", project: project.slug };
    changes.set(JSON.stringify(change), change);
  };
  const result = await db.transaction(async (tx) => {
    // Serializes writers of one project, so event ids commit in order (list_events cursors stay safe).
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${project.id}::text))`);
    if (ctx.requestId) {
      const [seen] = await tx
        .select()
        .from(writeRequests)
        .where(and(eq(writeRequests.projectId, project.id), eq(writeRequests.requestId, ctx.requestId)));
      if (seen && seen.tool !== ctx.tool) throw new ToolError("REQUEST_ID_REUSED", { tool: seen.tool });
      if (seen) return ((seen.response as { __void?: boolean })?.__void ? undefined : seen.response) as T;
    }
    for (const key of await reapExpiredLeases(tx, project.id)) touched("claim.expired", key);
    const emit: Emit = async (type, task, payload = {}, actor = ctx.actor) => {
      touched(type, task?.key ?? null);
      await tx.insert(events).values({
        projectId: project.id,
        taskId: task?.id ?? null,
        taskKey: task?.key ?? null,
        type,
        actor,
        tokenId: actor === ctx.actor ? (ctx.tokenId ?? null) : null,
        payload,
      });
    };
    const result = await fn(tx, emit);
    if (ctx.requestId) {
      await tx
        .delete(writeRequests)
        .where(and(eq(writeRequests.projectId, project.id), sql`${writeRequests.createdAt} < now() - ${REQUEST_TTL}::interval`));
      await tx.insert(writeRequests).values({
        projectId: project.id,
        requestId: ctx.requestId,
        tool: ctx.tool ?? "",
        // A write with nothing to return (a poller's event) still replays as "done".
        response: result === undefined ? { __void: true } : JSON.parse(JSON.stringify(result)),
      });
    }
    return result;
  });
  for (const change of changes.values()) bus.publish(change);
  return result;
}

// Leases expire lazily: reads treat lease_until < now() as free, and the first write in the project
// afterwards clears the owner (In progress goes back to Ready) and logs claim.expired.
// The workspace stays, so whoever claims next knows where the code is.
async function reapExpiredLeases(tx: Q, projectId: string): Promise<string[]> {
  const expired = await tx.execute<{ id: string; key: string; owner: Actor; from: string; to: string }>(sql`
    with expired as (
      select id, owner, status from tasks
      where project_id = ${projectId} and lease_until < now()
      for update
    )
    update tasks t set
      owner = null, claimed_at = null, lease_until = null,
      status = case when t.status = 'In progress' then 'Ready' else t.status end,
      status_changed_at = case when t.status = 'In progress' then now() else t.status_changed_at end,
      expiring_warned_at = null,
      version = t.version + 1, updated_at = now()
    from expired e where t.id = e.id
    returning t.id, t.key, e.owner, e.status as "from", t.status as "to"`);
  for (const r of expired.rows) {
    await tx.insert(events).values({
      projectId,
      taskId: r.id,
      taskKey: r.key,
      type: "claim.expired",
      actor: SYSTEM_ACTOR,
      payload: { owner: r.owner, from: r.from, to: r.to },
    });
  }
  return expired.rows.map((r) => r.key);
}

// Every timestamp leaves the server as ISO-8601 UTC.
export function iso(d: Date): string;
export function iso(d: Date | null): string | null;
export function iso(d: Date | null): string | null {
  return d ? d.toISOString() : null;
}
