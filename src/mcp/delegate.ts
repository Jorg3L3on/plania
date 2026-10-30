import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { approvals, delegatedAnswers, machineState, questions, tasks, type Actor } from "../db/schema.js";
import { DELEGABLE_APPROVALS, decideInTx } from "./approvals.js";
import { ToolError } from "./errors.js";
import { findProject } from "./queries.js";
import { answerInTx, type AnswerDelegation } from "./questions.js";
import { iso, WEB_ACTOR, writeTx, type Ctx, type Q } from "./tx.js";

export type DelegatedReviewItem = {
  id: string;
  project: string;
  key: string | null;
  kind: "question" | "approval";
  action: string | null;
  answer: string | null;
  quote: string;
  message_id: string;
  at: string;
};

// Newest first. The Bandeja renders each one with the Delegada badge so the owner can review them
// after the question has closed and left the open list.
export async function delegatedForInbox(db: Q, projects: { id: string; slug: string }[]): Promise<DelegatedReviewItem[]> {
  if (!projects.length) return [];
  const slugOf = new Map(projects.map((p) => [p.id, p.slug]));
  const rows = await db
    .select({
      d: delegatedAnswers,
      answer: questions.answer,
      qkey: tasks.key,
      action: approvals.action,
      akey: approvals.taskKey,
    })
    .from(delegatedAnswers)
    .leftJoin(questions, eq(questions.id, delegatedAnswers.questionId))
    .leftJoin(tasks, eq(tasks.id, questions.taskId))
    .leftJoin(approvals, eq(approvals.id, delegatedAnswers.approvalId))
    .where(and(inArray(delegatedAnswers.projectId, projects.map((p) => p.id)), isNull(delegatedAnswers.reviewedAt)))
    .orderBy(desc(delegatedAnswers.createdAt));
  return rows.map((r) => ({
    id: r.d.id,
    project: slugOf.get(r.d.projectId) ?? "",
    key: r.qkey ?? r.akey,
    kind: r.d.questionId ? "question" : "approval",
    action: r.action,
    answer: r.answer,
    quote: r.d.quote,
    message_id: r.d.messageId,
    at: iso(r.d.createdAt),
  }));
}

// PLA-06: Jorge saw these on the Bandeja. Screen only: no MCP tool calls this. The rows stay as
// the record; reviewed_at takes them off the list and the audit.
export async function markDelegatedReviewed(db: Q, ids: string[]): Promise<number> {
  if (!ids.length) return 0;
  const rows = await db
    .update(delegatedAnswers)
    .set({ reviewedAt: sql`now()` })
    .where(and(isNull(delegatedAnswers.reviewedAt), inArray(delegatedAnswers.id, ids)))
    .returning({ id: delegatedAnswers.id });
  return rows.length;
}

// PLA-I15-2. The owner stays the one who answers a human-only question, by a click on his screen.
// When he is away he can tell the Plania bot in his own chat. Only actor.agent plania-bot may
// record that one instruction, and only with the message id and a short quote. The server cannot
// prove the caller is that bot or that the message exists: every bot on this Mac shares the write
// token, and the actor is a field on the request. The controls are the required evidence, the
// audit, the Delegada badge, the rate limit and the screen kill switch.

export const PLANIA_BOT = "plania-bot";
export const QUOTE_MIN = 8;
export const QUOTE_MAX = 280;
export const MESSAGE_ID_MIN = 8;
export const MESSAGE_ID_MAX = 200;
export const DELEGATION_HOUR_MAX = 10;
// machine_state key. Missing row means on, which is the default.
export const DELEGATION_STATE_KEY = "delegation";

export type DelegationInput = {
  project: string;
  question_id?: string;
  approval_id?: string;
  option?: string;
  decision?: "grant" | "reject";
  delegated_by_jorge?: { message_id?: string; quote?: string };
};

// The actor stored as evidence. No model and no token: the log must not grow a secret.
export function delegatingActor(actor: Actor): Actor {
  return {
    agent: actor.agent,
    session_id: actor.session_id,
    ...(actor.machine ? { machine: actor.machine } : {}),
  };
}

export function parseDelegationEvidence(raw: DelegationInput["delegated_by_jorge"]): { messageId: string; quote: string } {
  const messageId = typeof raw?.message_id === "string" ? raw.message_id.trim() : "";
  const quote = typeof raw?.quote === "string" ? raw.quote.trim() : "";
  if (!messageId || messageId.length < MESSAGE_ID_MIN || messageId.length > MESSAGE_ID_MAX) {
    throw new ToolError("DELEGATION_EVIDENCE", { field: "message_id", min: MESSAGE_ID_MIN, max: MESSAGE_ID_MAX });
  }
  if (!quote || quote.length < QUOTE_MIN || quote.length > QUOTE_MAX) {
    throw new ToolError("DELEGATION_EVIDENCE", { field: "quote", min: QUOTE_MIN, max: QUOTE_MAX });
  }
  return { messageId, quote };
}

export async function delegationEnabled(db: Q): Promise<boolean> {
  const [row] = await db.select().from(machineState).where(sql`${machineState.key} = ${DELEGATION_STATE_KEY}`).limit(1);
  if (!row) return true;
  return (row.value as { enabled?: unknown }).enabled !== false;
}

export async function setDelegationEnabled(db: Db, enabled: boolean): Promise<boolean> {
  await db
    .insert(machineState)
    .values({ key: DELEGATION_STATE_KEY, value: { enabled } })
    .onConflictDoUpdate({ target: machineState.key, set: { value: { enabled }, updatedAt: sql`now()` } });
  return enabled;
}

function assertBot(ctx: Ctx): void {
  // Exact agent name. jorge never reaches here: writeCtx already returns RESERVED_ACTOR.
  // A spoofed screen session (session_id web, machine screen) does not count. Only the name does,
  // and the name is whatever the caller wrote on the shared write token.
  if (ctx.actor.agent !== PLANIA_BOT) {
    throw new ToolError("HUMAN_ONLY", {
      hint: "only actor agent plania-bot may record a delegated answer, and a screen session cannot be spoofed from here",
    });
  }
}

async function assertUnderHourlyCap(tx: Q): Promise<void> {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(delegatedAnswers)
    .where(sql`${delegatedAnswers.createdAt} > now() - interval '1 hour'`);
  if ((row?.n ?? 0) >= DELEGATION_HOUR_MAX) {
    throw new ToolError("DELEGATION_LIMIT", { reason: "hour", max: DELEGATION_HOUR_MAX });
  }
}

export async function answerDelegated(db: Db, input: DelegationInput, ctx: Ctx) {
  assertBot(ctx);
  const evidence = parseDelegationEvidence(input.delegated_by_jorge);
  const questionId = input.question_id?.trim() || "";
  const approvalId = input.approval_id?.trim() || "";
  if ((!questionId && !approvalId) || (questionId && approvalId)) {
    throw new ToolError("NOT_DELEGABLE", { field: "target", hint: "pass question_id or approval_id, not both" });
  }
  if (questionId && input.decision !== undefined) throw new ToolError("NOT_DELEGABLE", { field: "decision" });
  if (approvalId && input.option !== undefined) throw new ToolError("NOT_DELEGABLE", { field: "option" });
  const delegation: AnswerDelegation = { ...evidence, actor: delegatingActor(ctx.actor) };
  const p = await findProject(db, input.project);
  return writeTx(db, p, ctx, async (tx, emit) => {
    if (!(await delegationEnabled(tx))) throw new ToolError("DELEGATION_OFF");
    await assertUnderHourlyCap(tx);
    if (questionId) {
      const option = input.option ?? "";
      if (!option.trim()) throw new ToolError("INVALID_QUESTION", { field: "option" });
      return answerInTx(tx, emit, p, { question_id: questionId, answer: option }, ctx, delegation);
    }
    if (input.decision !== "grant" && input.decision !== "reject") {
      throw new ToolError("NOT_DELEGABLE", { field: "decision", accepts: ["grant", "reject"] });
    }
    // decidedBy is the owner. The evidence row keeps the bot. A grant then unlocks the one move
    // the same way a click on the screen does. waive_check and the other actions are refused.
    return decideInTx(tx, emit, p, { approval_id: approvalId, decision: input.decision }, WEB_ACTOR, delegation);
  });
}

export { DELEGABLE_APPROVALS };
