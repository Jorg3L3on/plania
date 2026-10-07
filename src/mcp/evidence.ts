import { and, asc, eq, gte, inArray, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { checks, results, tasks, type Task } from "../db/schema.js";
import { ToolError, findProject, requireTask, taskShape } from "./queries.js";
import { iso, writeTx, type Ctx, type Q } from "./tx.js";

// Evidence as records. Anyone may add a result (the owner, a QA session, CI); In review needs one
// that fits the ticket's work_type and was recorded during the current claim.

export const RESULT_KINDS = ["unit", "integration", "test", "verify", "live", "grep", "subagent", "ci"] as const;
export const VERDICTS = ["pass", "warn", "fail"] as const;

// What In review accepts per work_type: a passing result of one of these kinds.
// research also accepts any result or an attached doc; decision-needed never goes to In review.
export const REVIEW_EVIDENCE: Record<string, readonly string[]> = {
  code: ["unit", "integration", "test", "live", "ci"],
  ops: ["live", "verify", "ci"],
  research: RESULT_KINDS,
};

type Result = typeof results.$inferSelect;

export function resultShape(r: Result) {
  return { id: r.id, kind: r.kind, verdict: r.verdict, cite: r.cite, url: r.url, actor: r.actor, at: iso(r.createdAt) };
}

export async function taskResults(db: Q, taskId: string) {
  const rows = await db.select().from(results).where(eq(results.taskId, taskId)).orderBy(asc(results.createdAt));
  return rows.map(resultShape);
}

// Throws EVIDENCE_REQUIRED unless the ticket may enter In review. hasDoc is for research tickets.
export async function assertReviewEvidence(tx: Q, t: Task, hasDoc: (tx: Q, t: Task) => Promise<boolean>): Promise<void> {
  const workType = t.workType ?? "code";
  if (workType === "decision-needed") {
    throw new ToolError("EVIDENCE_REQUIRED", { work_type: workType, hint: "a decision is answered (ask/answer), not reviewed" });
  }
  const accepts = REVIEW_EVIDENCE[workType] ?? REVIEW_EVIDENCE.code!;
  const where = [eq(results.taskId, t.id), inArray(results.kind, [...accepts])];
  if (workType !== "research") where.push(eq(results.verdict, "pass"));
  // Evidence counts from the current claim on; a new session proves its own work.
  if (t.claimedAt) where.push(gte(results.createdAt, t.claimedAt));
  const [found] = await tx.select({ id: results.id }).from(results).where(and(...where)).limit(1);
  if (found) return;
  if (workType === "research" && (await hasDoc(tx, t))) return;
  throw new ToolError("EVIDENCE_REQUIRED", {
    work_type: workType,
    accepts: workType === "research" ? "any result, or a doc (attach_doc)" : accepts.map((k) => `${k} pass`),
    since: iso(t.claimedAt),
  });
}

export async function validateEvidence(tx: Q, t: Task, id: string): Promise<void> {
  const [r] = await tx
    .select({ id: results.id })
    .from(results)
    .where(and(eq(results.taskId, t.id), sql`${results.id}::text = ${id}`))
    .limit(1);
  if (!r) throw new ToolError("RESULT_NOT_FOUND", { evidence_id: id });
}

export async function addResult(
  db: Db,
  input: { project: string; key: string; kind: string; verdict: string; cite: string; url?: string; check_ns?: number[] },
  ctx: Ctx,
) {
  if (!(RESULT_KINDS as readonly string[]).includes(input.kind)) throw new ToolError("INVALID_RESULT", { field: "kind", allowed: RESULT_KINDS });
  if (!(VERDICTS as readonly string[]).includes(input.verdict)) throw new ToolError("INVALID_RESULT", { field: "verdict", allowed: VERDICTS });
  if (!input.cite.trim()) throw new ToolError("INVALID_RESULT", { field: "cite" });
  if (input.check_ns?.length && input.verdict !== "pass") throw new ToolError("INVALID_RESULT", { field: "check_ns", hint: "only a pass ticks checks" });
  const p = await findProject(db, input.project);
  return writeTx(db, p, ctx, async (tx, emit) => {
    const t = await requireTask(tx, p.id, input.key);
    const [r] = await tx
      .insert(results)
      .values({ taskId: t.id, kind: input.kind, verdict: input.verdict, cite: input.cite, url: input.url ?? null, actor: ctx.actor })
      .returning();
    const ticked: number[] = [];
    for (const n of new Set(input.check_ns ?? [])) {
      const [c] = await tx
        .update(checks)
        .set({ done: true, doneAt: sql`now()`, doneBy: ctx.actor, evidenceId: r!.id })
        .where(and(eq(checks.taskId, t.id), eq(checks.n, n)))
        .returning();
      if (!c) throw new ToolError("CHECK_NOT_FOUND", { n });
      ticked.push(n);
    }
    await tx.update(tasks).set({ updatedAt: sql`now()` }).where(eq(tasks.id, t.id));
    await emit("result.added", t, { result_id: r!.id, kind: r!.kind, verdict: r!.verdict, cite: r!.cite, url: r!.url, checks: ticked });
    return { result: resultShape(r!), task: await taskShape(tx, await requireTask(tx, p.id, input.key)) };
  });
}
