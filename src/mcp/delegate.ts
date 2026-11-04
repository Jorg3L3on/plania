import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { delegatedAnswers, events, machineState, questions, tasks, type Actor } from "../db/schema.js";
import { ToolError } from "./errors.js";
import { findProject } from "./queries.js";
import { answerInTx, type AnswerDelegation } from "./questions.js";
import { iso, writeTx, type Ctx, type Q } from "./tx.js";

/** Old clients still send this. Accepted and ignored for one release. */
export const LEGACY_APPROVAL_HINT =
  "ignored approval_id; that step was removed. Won't do and reopening take reason, and an agent also sends delegated_by_jorge {message_id, quote}.";

// Event ids Jorge has already reviewed. delegated_answers use reviewed_at; these moves do not have that column.
export const MOVE_SEEN_KEY = "delegated_move_seen";

export type DelegatedReviewItem = {
  id: string;
  project: string;
  key: string | null;
  kind: "question" | "approval" | "move";
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
    })
    .from(delegatedAnswers)
    .leftJoin(questions, eq(questions.id, delegatedAnswers.questionId))
    .leftJoin(tasks, eq(tasks.id, questions.taskId))
    .where(and(inArray(delegatedAnswers.projectId, projects.map((p) => p.id)), isNull(delegatedAnswers.reviewedAt)))
    .orderBy(desc(delegatedAnswers.createdAt));
  const approvalIds = rows.map((r) => r.d.approvalId).filter((id): id is string => !!id);
  const archived = new Map<string, { action: string | null; key: string | null }>();
  if (approvalIds.length) {
    const evs = await db
      .select({ key: events.taskKey, payload: events.payload })
      .from(events)
      .where(
        and(
          inArray(events.projectId, projects.map((p) => p.id)),
          eq(events.type, "approval.archived"),
          sql`${events.payload}->>'approval_id' in (${sql.join(approvalIds.map((id) => sql`${id}`), sql`, `)})`,
        ),
      );
    for (const e of evs) {
      const payload = e.payload as { approval_id?: unknown; action?: unknown };
      const id = typeof payload.approval_id === "string" ? payload.approval_id : "";
      if (!id || archived.has(id)) continue;
      archived.set(id, { action: typeof payload.action === "string" ? payload.action : null, key: e.key });
    }
  }
  const out: DelegatedReviewItem[] = rows.map((r) => {
    const old = r.d.approvalId ? archived.get(r.d.approvalId) : undefined;
    return {
      id: r.d.id,
      project: slugOf.get(r.d.projectId) ?? "",
      key: r.qkey ?? old?.key ?? null,
      kind: r.d.questionId ? "question" : "approval",
      action: old?.action ?? null,
      answer: r.answer,
      quote: r.d.quote,
      message_id: r.d.messageId,
      at: iso(r.d.createdAt),
    };
  });
  const seen = new Set(await seenMoveIds(db));
  const moves = await db
    .select({ id: events.id, projectId: events.projectId, key: events.taskKey, payload: events.payload, at: events.createdAt })
    .from(events)
    .where(
      and(
        inArray(events.projectId, projects.map((p) => p.id)),
        eq(events.type, "task.delegated_move"),
        sql`${events.payload}->>'message_id' is not null`,
      ),
    )
    .orderBy(desc(events.id));
  for (const m of moves) {
    if (seen.has(m.id)) continue;
    const payload = m.payload as { action?: unknown; quote?: unknown; message_id?: unknown };
    const quote = typeof payload.quote === "string" ? payload.quote : "";
    const messageId = typeof payload.message_id === "string" ? payload.message_id : "";
    if (!quote || !messageId) continue;
    out.push({
      id: String(m.id),
      project: slugOf.get(m.projectId) ?? "",
      key: m.key,
      kind: "move",
      action: typeof payload.action === "string" ? payload.action : null,
      answer: null,
      quote,
      message_id: messageId,
      at: iso(m.at),
    });
  }
  return out.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

async function seenMoveIds(db: Q): Promise<number[]> {
  const [row] = await db.select().from(machineState).where(eq(machineState.key, MOVE_SEEN_KEY)).limit(1);
  const ids = (row?.value as { ids?: unknown } | undefined)?.ids;
  return Array.isArray(ids) ? ids.filter((n): n is number => typeof n === "number") : [];
}

// PLA-06: Jorge saw these on the Bandeja. Screen only: no MCP tool calls this. The rows stay as
// the record; reviewed_at takes an answer off the list, and a numeric id takes a logged move off it.
export async function markDelegatedReviewed(db: Q, ids: string[]): Promise<number> {
  if (!ids.length) return 0;
  const answers = ids.filter((id) => id.includes("-"));
  const moves = [...new Set(ids.filter((id) => /^\d+$/.test(id)).map((id) => Number(id)))];
  let n = 0;
  if (answers.length) {
    const rows = await db
      .update(delegatedAnswers)
      .set({ reviewedAt: sql`now()` })
      .where(and(isNull(delegatedAnswers.reviewedAt), inArray(delegatedAnswers.id, answers)))
      .returning({ id: delegatedAnswers.id });
    n += rows.length;
  }
  if (moves.length) {
    const seen = new Set(await seenMoveIds(db));
    const fresh = moves.filter((id) => !seen.has(id));
    if (fresh.length) {
      const idsNext = [...seen, ...fresh];
      await db
        .insert(machineState)
        .values({ key: MOVE_SEEN_KEY, value: { ids: idsNext } })
        .onConflictDoUpdate({ target: machineState.key, set: { value: { ids: idsNext }, updatedAt: sql`now()` } });
      n += fresh.length;
    }
  }
  return n;
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

// Answers and agent Won't do / reopen moves share one hourly budget.
export async function assertDelegationHourlyCap(tx: Q): Promise<void> {
  const [answers] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(delegatedAnswers)
    .where(sql`${delegatedAnswers.createdAt} > now() - interval '1 hour'`);
  const [moves] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(events)
    .where(sql`${events.type} = 'task.delegated_move' and ${events.payload}->>'message_id' is not null and ${events.createdAt} > now() - interval '1 hour'`);
  if ((answers?.n ?? 0) + (moves?.n ?? 0) >= DELEGATION_HOUR_MAX) {
    throw new ToolError("DELEGATION_LIMIT", { reason: "hour", max: DELEGATION_HOUR_MAX });
  }
}

export async function answerDelegated(db: Db, input: DelegationInput, ctx: Ctx) {
  const questionId = input.question_id?.trim() || "";
  const legacy = typeof input.approval_id === "string" && input.approval_id.trim().length > 0;
  // The old approval target is not a write. Any caller gets the hint and nothing is stored.
  if (!questionId) {
    if (legacy) return { ignored: true, hint: LEGACY_APPROVAL_HINT };
    throw new ToolError("NOT_DELEGABLE", { field: "target", hint: "pass question_id" });
  }
  assertBot(ctx);
  const evidence = parseDelegationEvidence(input.delegated_by_jorge);
  const delegation: AnswerDelegation = { ...evidence, actor: delegatingActor(ctx.actor) };
  const p = await findProject(db, input.project);
  return writeTx(db, p, ctx, async (tx, emit) => {
    if (!(await delegationEnabled(tx))) throw new ToolError("DELEGATION_OFF");
    await assertDelegationHourlyCap(tx);
    const option = input.option ?? "";
    if (!option.trim()) throw new ToolError("INVALID_QUESTION", { field: "option" });
    const answered = await answerInTx(tx, emit, p, { question_id: questionId, answer: option }, ctx, delegation);
    return legacy ? { ...answered, hint: LEGACY_APPROVAL_HINT } : answered;
  });
}
