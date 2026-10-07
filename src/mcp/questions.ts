import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { decisions, questions, tasks, type Task } from "../db/schema.js";
import { decisionShape } from "./decisions.js";
import { ToolError } from "./errors.js";
import { TERMINAL, assertTransition } from "./lifecycle.js";
import { findProject, liveOwner, requireTask, taskShape } from "./queries.js";
import { iso, writeTx, type Ctx, type Q } from "./tx.js";

// Questions for Jorge live in Plania, not in one session's chat. ask puts a ticket in Needs Jorge
// (initiatives keep their status); answer records the reply, logs it as a decision on the task and,
// once no question is left open, puts the ticket back where it was.

type QuestionRow = typeof questions.$inferSelect;

export function questionShape(q: QuestionRow, taskKey: string) {
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
  };
}

export async function taskQuestions(db: Q, t: Pick<Task, "id" | "key">) {
  const rows = await db.select().from(questions).where(eq(questions.taskId, t.id)).orderBy(asc(questions.askedAt));
  return rows.map((q) => questionShape(q, t.key));
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
  input: { project: string; key: string; question: string; options?: string[] },
  ctx: Ctx,
) {
  if (!input.question.trim()) throw new ToolError("INVALID_QUESTION");
  const p = await findProject(db, input.project);
  return writeTx(db, p, ctx, async (tx, emit) => {
    const t = await requireTask(tx, p.id, input.key);
    if ((TERMINAL as readonly string[]).includes(t.status)) {
      throw new ToolError("INVALID_TRANSITION", { from: t.status, to: "Needs Jorge", hint: "the task is closed" });
    }
    const moves = t.kind === "ticket" && t.status !== "Needs Jorge";
    if (moves) assertTransition(t.kind, t.status, "Needs Jorge", { via: "ask" });
    const [q] = await tx
      .insert(questions)
      .values({
        projectId: p.id,
        taskId: t.id,
        question: input.question,
        options: input.options ?? [],
        statusBefore: moves ? t.status : null,
        askedBy: ctx.actor,
      })
      .returning();
    if (moves) {
      // The lease stays: the asker keeps the ticket while Jorge thinks (heartbeat to keep it).
      await tx
        .update(tasks)
        .set({ status: "Needs Jorge", version: sql`${tasks.version} + 1`, updatedAt: sql`now()` })
        .where(eq(tasks.id, t.id));
      await emit("task.status", t, { from: t.status, to: "Needs Jorge" });
    }
    await emit("question.asked", t, { question_id: q!.id, question: q!.question, options: q!.options });
    return { question: questionShape(q!, t.key), task: await taskShape(tx, await requireTask(tx, p.id, input.key)) };
  });
}

export async function answer(db: Db, input: { project: string; question_id: string; answer: string }, ctx: Ctx) {
  if (!input.answer.trim()) throw new ToolError("INVALID_QUESTION", { field: "answer" });
  const p = await findProject(db, input.project);
  return writeTx(db, p, ctx, async (tx, emit) => {
    const [row] = await tx
      .select({ q: questions, t: tasks })
      .from(questions)
      .innerJoin(tasks, eq(tasks.id, questions.taskId))
      .where(and(eq(questions.projectId, p.id), sql`${questions.id}::text = ${input.question_id}`))
      .limit(1);
    if (!row) throw new ToolError("QUESTION_NOT_FOUND", { question_id: input.question_id });
    const { q, t } = row;
    if (q.answeredAt) throw new ToolError("ALREADY_ANSWERED", { answer: q.answer, answered_by: q.answeredBy });

    const text = `${q.question} → ${input.answer}`.slice(0, 2_000);
    const [d] = await tx
      .insert(decisions)
      .values({ projectId: p.id, line: text, taskId: t.id, tags: ["answer"], actor: ctx.actor })
      .returning();
    const [answered] = await tx
      .update(questions)
      .set({ answer: input.answer, answeredBy: ctx.actor, answeredAt: sql`now()`, decisionId: d!.id })
      .where(eq(questions.id, q.id))
      .returning();
    await emit("question.answered", t, { question_id: q.id, answer: input.answer, decision_id: d!.id });
    await emit("decision.added", t, { decision_id: d!.id, text, tags: ["answer"] });

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
    if (t.status === "Needs Jorge" && !stillOpen) {
      let to = first?.statusBefore ?? "Ready";
      if (to === "In progress" && !liveOwner(t)) to = "Ready";
      assertTransition(t.kind, t.status, to, { via: "answer" });
      await tx
        .update(tasks)
        .set({ status: to, version: sql`${tasks.version} + 1`, updatedAt: sql`now()` })
        .where(eq(tasks.id, t.id));
      await emit("task.status", t, { from: t.status, to });
    }
    return {
      question: questionShape(answered!, t.key),
      decision: decisionShape(d!, t.key),
      task: await taskShape(tx, await requireTask(tx, p.id, t.key)),
    };
  });
}
