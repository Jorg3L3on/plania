import type { Db } from "../db/client.js";
import type { Actor } from "../db/schema.js";
import { storeOf, readerOf, uowOf } from "../store/port.js";
import type { Reader, UnitOfWork } from "../store/types.js";
import { ToolError } from "./errors.js";
import { findProject } from "./queries.js";
import { answerInTx, type AnswerDelegation } from "./questions.js";
import { iso, writeTx, type Ctx, type Q } from "./tx.js";

/** Old clients still send this. Accepted and ignored for one release. */
export const LEGACY_APPROVAL_HINT =
  "ignored approval_id; that step was removed. Won't do and reopening take reason, and an agent also sends delegated_by_jorge {message_id, quote}.";

// Event ids Jorge has already reviewed. delegated_answers use reviewed_at; these moves do not have that column.
export const MOVE_SEEN_KEY = "delegated_move_seen";

// A write of machine-wide rows (machine_state, routine_runs, reviews across projects). The port's write
// names a project; it is used only to replay a request id, which these writes never carry.
export const NO_PROJECT = "";

// One field of an event payload as text, the way payload->>'field' read it: null when it is missing or
// JSON null, the string itself, or the JSON of anything else (enough for the ids and slugs compared here).
export function payloadText(payload: Record<string, unknown>, field: string): string | null {
  const v = payload[field];
  if (v === undefined || v === null) return null;
  return typeof v === "string" ? v : JSON.stringify(v);
}

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
  const r = readerOf(db);
  const projectIds = projects.map((p) => p.id);
  const slugOf = new Map(projects.map((p) => [p.id, p.slug]));
  const rows = await r.find("delegatedAnswers", { projectId: projectIds, reviewedAt: null }, { orderBy: [{ column: "createdAt", desc: true }] });
  // The question each answer closed and that question's task key, as the two left joins had them.
  const questionIds = [...new Set(rows.map((d) => d.questionId).filter((id): id is string => !!id))];
  const questionOf = new Map((questionIds.length ? await r.find("questions", { id: questionIds }) : []).map((q) => [q.id, q]));
  const taskIds = [...new Set([...questionOf.values()].map((q) => q.taskId))];
  const keyOf = new Map((taskIds.length ? await r.find("tasks", { id: taskIds }) : []).map((t) => [t.id, t.key]));
  const approvalIds = rows.map((d) => d.approvalId).filter((id): id is string => !!id);
  const archived = new Map<string, { action: string | null; key: string | null }>();
  if (approvalIds.length) {
    const wanted = new Set(approvalIds);
    const evs = (await r.find("events", { projectId: projectIds, type: "approval.archived" })).filter((e) => {
      const id = payloadText(e.payload, "approval_id");
      return id !== null && wanted.has(id);
    });
    for (const e of evs) {
      const payload = e.payload as { approval_id?: unknown; action?: unknown };
      const id = typeof payload.approval_id === "string" ? payload.approval_id : "";
      if (!id || archived.has(id)) continue;
      archived.set(id, { action: typeof payload.action === "string" ? payload.action : null, key: e.taskKey });
    }
  }
  const out: DelegatedReviewItem[] = rows.map((d) => {
    const old = d.approvalId ? archived.get(d.approvalId) : undefined;
    const q = d.questionId ? questionOf.get(d.questionId) : undefined;
    return {
      id: d.id,
      project: slugOf.get(d.projectId) ?? "",
      key: (q ? keyOf.get(q.taskId) : undefined) ?? old?.key ?? null,
      kind: d.questionId ? "question" : "approval",
      action: old?.action ?? null,
      answer: q?.answer ?? null,
      quote: d.quote,
      message_id: d.messageId,
      at: iso(d.createdAt),
    };
  });
  const seen = new Set(await seenMoveIds(r));
  const moves = (await r.find("events", { projectId: projectIds, type: "task.delegated_move" }, { orderBy: [{ column: "id", desc: true }] })).filter(
    (m) => payloadText(m.payload, "message_id") !== null,
  );
  for (const m of moves) {
    if (seen.has(m.id)) continue;
    const payload = m.payload as { action?: unknown; quote?: unknown; message_id?: unknown };
    const quote = typeof payload.quote === "string" ? payload.quote : "";
    const messageId = typeof payload.message_id === "string" ? payload.message_id : "";
    if (!quote || !messageId) continue;
    out.push({
      id: String(m.id),
      project: slugOf.get(m.projectId) ?? "",
      key: m.taskKey,
      kind: "move",
      action: typeof payload.action === "string" ? payload.action : null,
      answer: null,
      quote,
      message_id: messageId,
      at: iso(m.createdAt),
    });
  }
  return out.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

async function seenMoveIds(r: Reader): Promise<number[]> {
  const row = await r.get("machineState", { key: MOVE_SEEN_KEY });
  const ids = (row?.value as { ids?: unknown } | undefined)?.ids;
  return Array.isArray(ids) ? ids.filter((n): n is number => typeof n === "number") : [];
}

// One machine_state row written whole, stamped with the write's clock.
async function putMachineState(uow: UnitOfWork, key: string, value: Record<string, unknown>): Promise<void> {
  if (await uow.get("machineState", { key })) await uow.update("machineState", { key }, { value, updatedAt: uow.now });
  else await uow.insert("machineState", { key, value });
}

// PLA-06: Jorge saw these on the Bandeja. Screen only: no MCP tool calls this. The rows stay as
// the record; reviewed_at takes an answer off the list, and a numeric id takes a logged move off it.
export async function markDelegatedReviewed(db: Db, ids: string[]): Promise<number> {
  if (!ids.length) return 0;
  const answers = ids.filter((id) => id.includes("-"));
  const moves = [...new Set(ids.filter((id) => /^\d+$/.test(id)).map((id) => Number(id)))];
  if (!answers.length && !moves.length) return 0;
  // The answers may span projects and machine_state belongs to none.
  return storeOf(db).write(NO_PROJECT, {}, async (uow) => {
    let n = 0;
    if (answers.length) {
      const rows = await uow.update("delegatedAnswers", { reviewedAt: null, id: answers }, { reviewedAt: uow.now });
      n += rows.length;
    }
    if (moves.length) {
      const seen = new Set(await seenMoveIds(uow));
      const fresh = moves.filter((id) => !seen.has(id));
      if (fresh.length) {
        await putMachineState(uow, MOVE_SEEN_KEY, { ids: [...seen, ...fresh] });
        n += fresh.length;
      }
    }
    return n;
  });
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
  const row = await readerOf(db).get("machineState", { key: DELEGATION_STATE_KEY });
  if (!row) return true;
  return (row.value as { enabled?: unknown }).enabled !== false;
}

export async function setDelegationEnabled(db: Db, enabled: boolean): Promise<boolean> {
  await storeOf(db).write(NO_PROJECT, {}, (uow) => putMachineState(uow, DELEGATION_STATE_KEY, { enabled }));
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

// Answers and agent Won't do / reopen moves share one hourly budget, across every project.
export async function assertDelegationHourlyCap(tx: Q): Promise<void> {
  const uow = uowOf(tx);
  const since = uow.now.getTime() - 3_600_000;
  const answers = (await uow.find("delegatedAnswers")).filter((d) => d.createdAt.getTime() > since).length;
  const moves = (await uow.find("events", { type: "task.delegated_move" })).filter(
    (e) => payloadText(e.payload, "message_id") !== null && e.createdAt.getTime() > since,
  ).length;
  if (answers + moves >= DELEGATION_HOUR_MAX) {
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
