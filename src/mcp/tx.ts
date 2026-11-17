import type { Db } from "../db/client.js";
import type * as schema from "../db/schema.js";
import type { Actor, Project } from "../db/schema.js";
import { bus, type PlaniaEvent } from "../events.js";
import { onWriteEvent } from "../runner/events.js";
import { storeOf, uowOf } from "../store/port.js";
import { RequestIdReused } from "../store/types.js";
import { ToolError } from "./errors.js";

// A Db or an open transaction. Reads that run inside writeTx must use the transaction.
export type Q = Db;

// Who is writing and through which channel. human is true only for Jorge's screen (cookie),
// never inferred from the actor value. requestId + tool make a retry replay the first response.
// verbose: writes return the full task besides the compact {key, status, version, changed} reply.
// system: a poller acting on GitHub or deploy data (moves In review → Merged → Released).
// An app-repo code ticket still needs a scan pass before Merged.
export type Ctx = { actor: Actor; human?: boolean; system?: boolean; requestId?: string; tool?: string; verbose?: boolean; tokenId?: string };


export const WEB_ACTOR: Actor = { agent: "jorge", session_id: "web", machine: "screen" };

// A screen-session answer counts only when this actor stored it. The screen route sets it from the session
// cookie. human on the context is never inferred from an actor a caller sent.
export function isScreenActor(actor: { agent?: string; session_id?: string; machine?: string } | null | undefined): boolean {
  return !!actor && actor.agent === WEB_ACTOR.agent && actor.session_id === WEB_ACTOR.session_id && actor.machine === WEB_ACTOR.machine;
}
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

// Every write runs here: one transaction per call, serialized across the whole server, with its
// events committed or rolled back together with the change. Once it commits, live screens hear about it
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
  let result: T;
  const asked = performance.now();
  let lockedAt = 0;
  try {
    // The store serializes the write, replays a retried request id, and commits everything fn did together.
    result = await storeOf(db).write(project.id, { requestId: ctx.requestId, tool: ctx.tool }, async (uow) => {
      lockedAt = performance.now();
      const tx = uow.sql;
      for (const key of await reapExpiredLeases(tx, project.id, project.slug)) touched("claim.expired", key);
      const emit: Emit = async (type, task, payload = {}, actor = ctx.actor) => {
        touched(type, task?.key ?? null);
        await uow.insert("events", {
          projectId: project.id,
          taskId: task?.id ?? null,
          taskKey: task?.key ?? null,
          type,
          actor,
          tokenId: actor === ctx.actor ? (ctx.tokenId ?? null) : null,
          payload,
        });
        // PLA-I31-1: an event that should wake a role queues it in this same transaction.
        await onWriteEvent(tx, project, type, task, payload);
      };
      return fn(tx, emit);
    });
  } catch (err) {
    if (err instanceof RequestIdReused) throw new ToolError("REQUEST_ID_REUSED", { tool: err.tool });
    throw err;
  }
  // The store's write queue is the lock: the wait is the time in the queue, the hold the time to run and commit.
  if (lockedAt) noteWriteLock(lockedAt - asked, performance.now() - lockedAt);
  for (const change of changes.values()) bus.publish(change);
  return result;
}

// PLA-I60-6: how long writes wait for the global write lock and hold it, over the last 2 000 writes. The load test
// reads it; the heartbeat job keeps it in machine_state (runner.writelock) for Máquina's diagnostics line.
const WINDOW = 2000;
const waits: number[] = [];
const holds: number[] = [];
function noteWriteLock(wait: number, hold: number): void {
  waits.push(wait);
  holds.push(hold);
  if (waits.length > WINDOW) waits.shift();
  if (holds.length > WINDOW) holds.shift();
}
const pct = (xs: number[], p: number): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]! * 10) / 10;
};
export function writeLockStats(): { n: number; wait_p50_ms: number; wait_p95_ms: number; hold_p50_ms: number; hold_p95_ms: number } {
  return { n: waits.length, wait_p50_ms: pct(waits, 50), wait_p95_ms: pct(waits, 95), hold_p50_ms: pct(holds, 50), hold_p95_ms: pct(holds, 95) };
}
export const resetWriteLockStats = (): void => {
  waits.length = 0;
  holds.length = 0;
};

// Leases expire lazily: reads treat lease_until < now() as free, and the first write in the project
// afterwards clears the owner (In progress goes back to Ready) and logs claim.expired. The leases
// job runs an empty writeTx on projects with an expired lease, so this fires within a minute even
// when nobody writes. The workspace stays, so whoever claims next knows where the code is.
// PLA-16: with the project's slug, claim.expired goes through the event hook like an emitted event, so a
// runner run's ticket that falls back to Ready wakes its role again.
// It runs inside the serialized write, so the rows it reads cannot change before it updates them.
export async function reapExpiredLeases(tx: Q, projectId: string, slug?: string): Promise<string[]> {
  const uow = uowOf(tx);
  const leased = (await uow.find("tasks", { projectId })).filter((t) => t.leaseUntil !== null && t.leaseUntil < uow.now);
  const expired: { id: string; key: string; owner: Actor | null; from: string; to: string; lease_until: Date }[] = [];
  for (const e of leased) {
    const working = e.status === "In progress";
    const [t] = await uow.update(
      "tasks",
      { id: e.id, version: e.version },
      {
        owner: null,
        claimedAt: null,
        leaseUntil: null,
        status: working ? "Ready" : e.status,
        ...(working ? { statusChangedAt: uow.now } : {}),
        expiringWarnedAt: null,
        version: e.version + 1,
        updatedAt: uow.now,
      },
    );
    if (t) expired.push({ id: t.id, key: t.key, owner: e.owner, from: e.status, to: t.status, lease_until: e.leaseUntil! });
  }
  for (const r of expired) {
    const payload = { owner: r.owner, from: r.from, to: r.to, lease_until: iso(r.lease_until) };
    await uow.insert("events", { projectId, taskId: r.id, taskKey: r.key, type: "claim.expired", actor: SYSTEM_ACTOR, payload });
    if (slug) await onWriteEvent(tx, { id: projectId, slug }, "claim.expired", { id: r.id, key: r.key }, payload);
  }
  return expired.map((r) => r.key);
}

// Every timestamp leaves the server as ISO-8601 UTC.
export function iso(d: Date): string;
export function iso(d: Date | null): string | null;
export function iso(d: Date | null): string | null {
  return d ? d.toISOString() : null;
}
