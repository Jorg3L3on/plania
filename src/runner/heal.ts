// PLA-I74-5: one heal for a step whose turn is nobody's, PLA-167's wakeForNote generalized. When no run is live on the
// step: a hold an ended runner run left (or a lease that lapsed) comes off and the step goes back to Ready, then the
// agent that works it (its owner agent, else Taller or the PO by work type) is woken with the reason its prompt reads.
// A live run, and a live lease a session outside the runner holds, are left alone.
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { agentRuns, agents, tasks, type Actor, type Agent } from "../db/schema.js";
import { SYSTEM_ACTOR, writeTx, type Q } from "../mcp/tx.js";
import { ST } from "../state/status.js";
import { queueWake, serviceAgent } from "./events.js";
import { kickQueue } from "./queue.js";
import { isRunSession, sessionsOf } from "./run-session.js";

const TALLER_WORK = new Set(["code", "bug", "debt", "ops"]);
const LIVE = ["starting", "running"];

export type HealOut = { released: boolean; woke: boolean; agent: string | null; run_id: string | null; skipped: string | null };

// The agent that works a ticket: its owner when that is an agent (never a person or the ceo seat), else by work type.
export async function workerOf(db: Q, p: { id: string; slug: string }, t: { ownerAgent: string | null; workType: string | null }): Promise<Agent | null> {
  const owner = t.ownerAgent ? (await db.select().from(agents).where(eq(agents.id, t.ownerAgent)).limit(1))[0] : undefined;
  if (owner && owner.kind !== "human" && owner.slug !== "ceo") return owner;
  return serviceAgent(db, TALLER_WORK.has(t.workType ?? "code") ? "taller" : "product-owner", p);
}

export async function healStep(db: Db, p: { id: string; slug: string }, key: string, input: { reason: string; release: boolean; from: string; now?: Date }): Promise<HealOut> {
  const out: HealOut = { released: false, woke: false, agent: null, run_id: null, skipped: null };
  const [live] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(agentRuns)
    .where(and(eq(agentRuns.projectId, p.id), eq(agentRuns.taskKey, key), inArray(agentRuns.status, [...LIVE, "queued"])));
  if ((live?.n ?? 0) > 0) return { ...out, skipped: "a run is live or queued on it" };
  const liveIds = (await db.select({ id: agentRuns.id }).from(agentRuns).where(inArray(agentRuns.status, LIVE))).map((r) => r.id);
  const liveSessions = new Set(liveIds.flatMap(sessionsOf));
  const now = input.now ?? new Date();

  const done = await writeTx(db, p, { actor: SYSTEM_ACTOR, tool: input.from }, async (tx, emit) => {
    const [t] = await tx.select().from(tasks).where(and(eq(tasks.projectId, p.id), eq(tasks.key, key))).limit(1);
    if (!t || t.kind !== "ticket") return { ...out, skipped: "not a ticket" };
    if (t.status === ST.inProgress) {
      const actor = t.owner as Actor | null;
      const leaseLive = !!t.leaseUntil && t.leaseUntil.getTime() > now.getTime();
      const endedRun = isRunSession(actor?.session_id) && !liveSessions.has(actor!.session_id);
      if (leaseLive && !endedRun) return { ...out, skipped: "a live session holds it" };
      if (!input.release) return { ...out, skipped: "held, and this heal does not release" };
      const [u] = await tx
        .update(tasks)
        .set({ owner: null, claimedAt: null, leaseUntil: null, expiringWarnedAt: null, status: ST.ready, statusChangedAt: sql`now()`, version: sql`${tasks.version} + 1`, updatedAt: sql`now()` })
        .where(and(eq(tasks.id, t.id), eq(tasks.status, ST.inProgress), eq(tasks.version, t.version)))
        .returning();
      if (!u) return { ...out, skipped: "it changed hands" };
      await emit("claim.released", u, { owner: actor ?? null, from: ST.inProgress, to: ST.ready, reason: input.reason });
      out.released = true;
    } else if (t.status === ST.needsOwner || t.status === ST.done || t.status === ST.wontDo) {
      return { ...out, skipped: `it is ${t.status}` };
    }
    const agent = await workerOf(tx, p, t);
    if (!agent) return { ...out, skipped: "no agent works it" };
    const w = await queueWake(tx, p, { id: t.id, key: t.key }, { agent, taskKey: t.key, reason: input.reason }, input.from);
    return { ...out, agent: agent.slug, woke: w.kind === "queued", run_id: w.kind === "queued" ? w.runId : null };
  });
  if (done.woke) kickQueue();
  return done;
}
