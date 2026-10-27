import { randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { gateChallenges, projects, questions, tasks } from "../db/schema.js";
import { ToolError, type ErrorCode } from "../mcp/errors.js";
import { type Emit, type Q, writeTx, type Ctx } from "../mcp/tx.js";
import { gateStore } from "./store.js";
import { gateClock, matchTotp } from "./totp.js";

// A gate answer is a challenge plus a TOTP code, consumed in the same write transaction as `answer`.
// The code and the secret are never written to a row, an event, or an error.

const CHALLENGE_MS = 2 * 60 * 1000;
const MAX_ATTEMPTS = 3;

export type GateFailure = { code: ErrorCode; detail: Record<string, unknown> };

const NOT_ENROLLED: GateFailure = {
  code: "GATE_CODE_NOT_ENROLLED",
  detail: { hint: "enrol the authenticator on the screen: current password, then copy the base32 secret and otpauth URI into the app" },
};

type QuestionRef = { id: string; gate: string | null };
type TaskRef = { id: string; key: string };

async function projectBySlug(db: Db, slug: string) {
  const [row] = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
  if (!row) throw new ToolError("PROJECT_NOT_FOUND");
  return row;
}

function fail(code: ErrorCode, detail: Record<string, unknown> = {}): GateFailure {
  return { code, detail };
}

async function reject(
  tx: Q,
  emit: Emit,
  task: TaskRef,
  questionId: string,
  nonce: string | null,
  reason: string,
  code: ErrorCode,
  detail: Record<string, unknown> = {},
): Promise<GateFailure> {
  await emit("gate.code.rejected", task, { question_id: questionId, nonce, reason });
  return fail(code, detail);
}

// Screen only. One open challenge per click, bound to the question and the option, dead in two minutes.
export async function createGateChallenge(db: Db, projectSlug: string, questionId: string, option: string, ctx: Ctx) {
  if (!ctx.human) throw new ToolError("HUMAN_ONLY", { hint: "a gate code is started from the screen" });
  const project = await projectBySlug(db, projectSlug);
  return writeTx(db, project, ctx, async (tx, emit) => {
    if (!(await gateStore().get())) throw new ToolError(NOT_ENROLLED.code, NOT_ENROLLED.detail);
    const [row] = await tx
      .select({ q: questions, t: tasks })
      .from(questions)
      .innerJoin(tasks, eq(tasks.id, questions.taskId))
      .where(sql`${questions.projectId} = ${project.id} and ${questions.id}::text = ${questionId}`)
      .limit(1);
    if (!row) throw new ToolError("QUESTION_NOT_FOUND", { question_id: questionId });
    const { q, t } = row;
    if (!q.humanOnly) throw new ToolError("INVALID_QUESTION", { field: "challenge", hint: "only a human-only question takes a code" });
    if (q.answeredAt) throw new ToolError("ALREADY_ANSWERED", { answer: q.answer, answered_by: q.answeredBy });
    if (q.options.length > 0 && !q.options.includes(option)) throw new ToolError("INVALID_QUESTION", { field: "option" });
    const nonce = randomBytes(32).toString("base64url");
    const expiresAt = new Date(gateClock.now() + CHALLENGE_MS);
    await tx.insert(gateChallenges).values({ questionId: q.id, option, nonce, expiresAt });
    await emit("gate.challenge.created", t, { question_id: q.id, nonce, option, gate: q.gate, expires_at: expiresAt.toISOString() });
    return { nonce, expires_at: expiresAt.toISOString() };
  });
}

// Called inside answer's write transaction. Null means the code was consumed and the answer may be stored.
// A rejection returns instead of throwing, so the attempt counter commits with the event.
export async function consumeGateCode(
  tx: Q,
  emit: Emit,
  q: QuestionRef,
  task: TaskRef,
  answerText: string,
  proof: { nonce?: string; code?: string },
): Promise<GateFailure | null> {
  const secret = await gateStore().get();
  if (!secret) return reject(tx, emit, task, q.id, null, "not_enrolled", NOT_ENROLLED.code, NOT_ENROLLED.detail);

  const nonce = proof.nonce?.trim() ?? "";
  const code = proof.code?.trim() ?? "";
  if (!nonce || !code) return reject(tx, emit, task, q.id, nonce || null, "missing", "GATE_CODE_INVALID", { reason: "missing" });

  const [ch] = await tx.select().from(gateChallenges).where(eq(gateChallenges.nonce, nonce)).limit(1);
  if (!ch || ch.questionId !== q.id) return reject(tx, emit, task, q.id, nonce, "mismatch", "GATE_CODE_INVALID", { reason: "mismatch" });
  if (ch.state === "locked" || ch.attempts >= MAX_ATTEMPTS) {
    return reject(tx, emit, task, q.id, nonce, "locked", "GATE_CHALLENGE_LOCKED", { attempts: ch.attempts });
  }
  if (ch.state === "used") return reject(tx, emit, task, q.id, nonce, "used", "GATE_CODE_INVALID", { reason: "used" });
  if (ch.state === "expired" || ch.expiresAt.getTime() <= gateClock.now()) {
    if (ch.state === "open") await tx.update(gateChallenges).set({ state: "expired" }).where(eq(gateChallenges.id, ch.id));
    return reject(tx, emit, task, q.id, nonce, "expired", "GATE_CODE_EXPIRED");
  }
  if (ch.option !== answerText) return burn(tx, emit, task, ch.id, q.id, nonce, ch.attempts, "mismatch");

  const step = matchTotp(secret, code, gateClock.now());
  if (step === null) return burn(tx, emit, task, ch.id, q.id, nonce, ch.attempts, "invalid");

  const [replay] = await tx.select({ id: gateChallenges.id }).from(gateChallenges).where(eq(gateChallenges.totpStep, step)).limit(1);
  if (replay) return burn(tx, emit, task, ch.id, q.id, nonce, ch.attempts, "replay");

  await tx.update(gateChallenges).set({ state: "used", usedAt: sql`now()`, totpStep: step }).where(eq(gateChallenges.id, ch.id));
  await emit("gate.answered", task, { question_id: q.id, nonce, option: ch.option, gate: q.gate });
  return null;
}

async function burn(
  tx: Q,
  emit: Emit,
  task: TaskRef,
  challengeId: string,
  questionId: string,
  nonce: string,
  attempts: number,
  reason: string,
): Promise<GateFailure> {
  const next = attempts + 1;
  const locked = next >= MAX_ATTEMPTS;
  await tx
    .update(gateChallenges)
    .set(locked ? { attempts: next, state: "locked" } : { attempts: next })
    .where(eq(gateChallenges.id, challengeId));
  return reject(tx, emit, task, questionId, nonce, locked ? "locked" : reason, locked ? "GATE_CHALLENGE_LOCKED" : "GATE_CODE_INVALID", locked ? { attempts: next } : { reason });
}
