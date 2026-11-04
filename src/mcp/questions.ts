import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { LEGACY_ASK_FIELD } from "../db/legacy-names.js";
import { decisions, delegatedAnswers, questions, tasks, type Actor, type Task } from "../db/schema.js";
import { decisionShape } from "./decisions.js";
import { ToolError } from "./errors.js";
import { TERMINAL, assertTransition } from "./lifecycle.js";
import { findProject, liveOwner, requireTask, writeReply } from "./queries.js";
import { WEB_ACTOR, isScreenActor, iso, writeTx, type Ctx, type Emit, type Q } from "./tx.js";

// Evidence answer_delegated already checked. The stored actor on the question stays the owner.
export type AnswerDelegation = { messageId: string; quote: string; actor: Actor };

export type DelegatedView = { message_id: string; quote: string; at: string; by: Actor };

// Questions for Jorge live in Plania, not in one session's chat. ask puts a ticket in Needs Jorge
// (initiatives keep their status); answer records the reply, logs a decision on the task when the
// caller gives decision_text and, once no question is left open, puts the ticket back where it was.

type QuestionRow = typeof questions.$inferSelect;

export function questionShape(q: QuestionRow, taskKey: string, delegated?: DelegatedView | null) {
  return {
    id: q.id,
    task_key: taskKey,
    question: q.question,
    options: q.options,
    asked_by: q.askedBy,
    asked_at: iso(q.askedAt),
    answer: q.answer,
    answered_by: q.answeredBy,
    answered_at: iso(q.answeredAt),
    decision_id: q.decisionId,
    // 2.8: what else waits on this answer, and how soon Jorge is needed.
    blocks: q.blocks,
    urgency: q.urgency,
    human_only: q.humanOnly,
    // Present only when plania-bot recorded the owner's instruction. The screen click has no row.
    ...(delegated ? { delegated } : {}),
  };
}

function delegatedView(row: typeof delegatedAnswers.$inferSelect): DelegatedView {
  return { message_id: row.messageId, quote: row.quote, at: iso(row.createdAt), by: row.actor };
}

export const URGENCIES = ["now", "soon", "whenever"] as const;
export type Urgency = (typeof URGENCIES)[number];

// One release: an older client may still send the removed field. It is not stored.
export const LEGACY_ASK_HINT =
  "ignored an obsolete field from an older client; ideas move stage by stage with only the stage doc checked";

export async function taskQuestions(db: Q, t: Pick<Task, "id" | "key">) {
  const rows = await db.select().from(questions).where(eq(questions.taskId, t.id)).orderBy(asc(questions.askedAt));
  const ids = rows.map((q) => q.id);
  const stamps = ids.length
    ? await db.select().from(delegatedAnswers).where(inArray(delegatedAnswers.questionId, ids))
    : [];
  const byQuestion = new Map(stamps.filter((s) => s.questionId).map((s) => [s.questionId, delegatedView(s)]));
  return rows.map((q) => questionShape(q, t.key, byQuestion.get(q.id)));
}

export async function openQuestions(db: Q, projectId: string) {
  const rows = await db
    .select({ q: questions, key: tasks.key })
    .from(questions)
    .innerJoin(tasks, eq(tasks.id, questions.taskId))
    .where(and(eq(questions.projectId, projectId), isNull(questions.answeredAt)))
    .orderBy(asc(questions.askedAt));
  return rows.map((r) => questionShape(r.q, r.key));
}

export async function ask(
  db: Db,
  input: { project: string; key: string; question: string; options?: string[]; blocks?: string[]; urgency?: Urgency; human_only?: boolean } & Record<string, unknown>,
  ctx: Ctx,
) {
  if (!input.question.trim()) throw new ToolError("INVALID_QUESTION");
  if (input.urgency !== undefined && !(URGENCIES as readonly string[]).includes(input.urgency)) throw new ToolError("INVALID_QUESTION", { field: "urgency", accepts: URGENCIES });
  // PLA-I20-1: a 2.16 client may still send the removed field. Ignore it and say so.
  const legacy = input[LEGACY_ASK_FIELD];
  const ignoredLegacy = legacy !== undefined && legacy !== null;
  const p = await findProject(db, input.project);
  return writeTx(db, p, ctx, async (tx, emit) => {
    const t = await requireTask(tx, p.id, input.key);
    // blocks: other keys this answer holds up; each must exist (canonical keys are stored).
    const blocks: string[] = [];
    for (const k of input.blocks ?? []) {
      const b = await requireTask(tx, p.id, k);
      if (!blocks.includes(b.key)) blocks.push(b.key);
    }
    if ((TERMINAL as readonly string[]).includes(t.status)) {
      throw new ToolError("INVALID_TRANSITION", { from: t.status, to: "Needs Jorge", hint: "the task is closed" });
    }
    const options = input.options ?? [];
    const moves = t.kind === "ticket" && t.status !== "Needs Jorge";
    if (moves) assertTransition(t.kind, t.status, "Needs Jorge", { via: "ask" });
    const humanOnly = input.human_only ?? false;
    const [q] = await tx
      .insert(questions)
      .values({
        projectId: p.id,
        taskId: t.id,
        question: input.question,
        options,
        blocks,
        urgency: input.urgency ?? null,
        humanOnly,
        statusBefore: moves ? t.status : null,
        askedBy: ctx.actor,
      })
      .returning();
    if (moves) {
      // The lease stays: the asker keeps the ticket while Jorge thinks (heartbeat to keep it).
      await tx
        .update(tasks)
        .set({ status: "Needs Jorge", statusChangedAt: sql`now()`, version: sql`${tasks.version} + 1`, updatedAt: sql`now()` })
        .where(eq(tasks.id, t.id));
      await emit("task.status", t, { from: t.status, to: "Needs Jorge" });
    }
    await emit("question.asked", t, { question_id: q!.id, question: q!.question, options: q!.options, blocks: q!.blocks, urgency: q!.urgency, human_only: q!.humanOnly });
    const u = await requireTask(tx, p.id, t.key);
    // 2.13: the reply says where the wait now lives, so nobody also writes it into next_action or a note.
    const waits = u.status === "Needs Jorge" ? "the ticket waits in Needs Jorge until he answers" : "the question waits in Jorge's inbox until he answers";
    return writeReply(tx, u, ctx, moves ? ["questions", "status"] : ["questions"], {
      question_id: q!.id,
      waits,
      question: questionShape(q!, t.key),
      ...(ignoredLegacy ? { hint: LEGACY_ASK_HINT } : {}),
    });
  });
}

// The screen path. A human_only question needs the session cookie.
// answer_delegated does not call this: it uses answerInTx inside its own transaction.
export async function answer(
  db: Db,
  input: { project: string; question_id: string; answer: string; decision_text?: string },
  ctx: Ctx,
) {
  if (!input.answer.trim()) throw new ToolError("INVALID_QUESTION", { field: "answer" });
  const p = await findProject(db, input.project);
  return writeTx(db, p, ctx, (tx, emit) => answerInTx(tx, emit, p, input, ctx));
}

export async function answerInTx(
  tx: Q,
  emit: Emit,
  p: { id: string },
  input: { question_id: string; answer: string; decision_text?: string },
  ctx: Ctx,
  delegation?: AnswerDelegation,
) {
  const [row] = await tx
    .select({ q: questions, t: tasks })
    .from(questions)
    .innerJoin(tasks, eq(tasks.id, questions.taskId))
    .where(and(eq(questions.projectId, p.id), sql`${questions.id}::text = ${input.question_id}`))
    .limit(1);
  if (!row) throw new ToolError("QUESTION_NOT_FOUND", { question_id: input.question_id });
  const { q, t } = row;
  if (q.answeredAt) throw new ToolError("ALREADY_ANSWERED", { answer: q.answer, answered_by: q.answeredBy });
  // A human_only question is answered on the screen as free text.
  // human is set only by the screen session. The actor must be the screen actor too, so a caller
  // that spoofs the session id cannot store the answer. delegation is set only by answer_delegated,
  // after it has already required actor agent plania-bot and the owner's quote.
  if (q.humanOnly && !delegation) {
    if (!ctx.human || !isScreenActor(ctx.actor)) {
      throw new ToolError("HUMAN_ONLY", { hint: "a human-only question is answered on the owner's screen; bots are refused" });
    }
  }
  if (delegation) {
    // answer_delegated closes one human_only question that has named options.
    const named = q.options.length > 0 && q.humanOnly;
    if (!named) throw new ToolError("NOT_DELEGABLE", { question_id: q.id, hint: "a named human_only option, or the screen" });
    if (!q.options.includes(input.answer)) throw new ToolError("INVALID_QUESTION", { field: "option" });
    const [prior] = await tx.select({ id: delegatedAnswers.id }).from(delegatedAnswers).where(eq(delegatedAnswers.questionId, q.id)).limit(1);
    if (prior) throw new ToolError("DELEGATION_LIMIT", { reason: "question", question_id: q.id });
  }

  // 2.1: an answer is a decision only when the caller says what was decided (decision_text);
  // otherwise the answer stays on the question and the decision log keeps its signal.
  // A human_only answer is the owner's, whatever else the caller sent. A delegated
  // answer is his too: the bot is only the messenger, and the evidence row says so.
  const by = delegation || q.humanOnly ? WEB_ACTOR : ctx.actor;
  let stamp: DelegatedView | undefined;
  if (delegation) {
    const [stored] = await tx
      .insert(delegatedAnswers)
      .values({
        projectId: p.id,
        questionId: q.id,
        messageId: delegation.messageId,
        quote: delegation.quote,
        actor: delegation.actor,
      })
      .returning();
    stamp = delegatedView(stored!);
  }
  let d: typeof decisions.$inferSelect | undefined;
  if (input.decision_text?.trim()) {
    if (/^\s*\d{4}-\d{2}-\d{2}\b/.test(input.decision_text)) throw new ToolError("TEXT_HAS_DATE");
    [d] = await tx
      .insert(decisions)
      .values({ projectId: p.id, line: input.decision_text.trim().slice(0, 2_000), taskId: t.id, tags: ["answer"], actor: by })
      .returning();
  }
  const [answered] = await tx
    .update(questions)
    .set({ answer: input.answer, answeredBy: by, answeredAt: sql`now()`, decisionId: d?.id ?? null })
    .where(eq(questions.id, q.id))
    .returning();
  const evidence = stamp ? { delegated: stamp } : {};
  await emit("question.answered", t, { question_id: q.id, answer: input.answer, decision_id: d?.id ?? null, ...evidence }, by);
  if (d) await emit("decision.added", t, { decision_id: d.id, text: d.line, tags: ["answer"] }, by);

  // Back to where it was once nothing is left open. In progress without a live lease is Ready.
  const [first] = await tx
    .select({ statusBefore: questions.statusBefore })
    .from(questions)
    .where(and(eq(questions.taskId, t.id), sql`${questions.statusBefore} is not null`))
    .orderBy(sql`${questions.askedAt} desc`)
    .limit(1);
  const [stillOpen] = await tx
    .select({ id: questions.id })
    .from(questions)
    .where(and(eq(questions.taskId, t.id), isNull(questions.answeredAt)))
    .limit(1);
  const changed = ["questions"];
  if (t.status === "Needs Jorge" && !stillOpen) {
    let to = first?.statusBefore ?? "Ready";
    if (to === "In progress" && !liveOwner(t)) to = "Ready";
    assertTransition(t.kind, t.status, to, { via: "answer" });
    await tx
      .update(tasks)
      .set({ status: to, statusChangedAt: sql`now()`, version: sql`${tasks.version} + 1`, updatedAt: sql`now()` })
      .where(eq(tasks.id, t.id));
    await emit("task.status", t, { from: t.status, to });
    changed.push("status");
  }
  const u = await requireTask(tx, p.id, t.key);
  return writeReply(tx, u, ctx, changed, {
    question: questionShape(answered!, t.key, stamp),
    decision: d ? decisionShape(d, t.key) : null,
  });
}
