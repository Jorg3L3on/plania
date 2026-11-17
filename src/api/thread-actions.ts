// PLA-I32-4: what Jorge does on a message, from the screen only (POST /api/threads/:id/actions, cookie only).
//   aceptar   a linked ticket In review: Done (a doc, a plan, ops or research work). On a code ticket with a PR
//             (the button says fusionar; both words are accepted) the PR is merged into sandbox with
//             `gh pr merge --merge` through releaseGh (src/mcp/release-ship.ts, the token in
//             ~/.config/plania/github-token), never into another base; pr.merged is recorded with the sha.
//             The GitHub poller then moves the ticket to Merged, as for any merge.
//   cambios   the text goes to the ticket as a note, the ticket goes back to Ready and its owner wakes.
//   responder answers the message's question (the screen's answer, as on Solo tú).
// Each writes action_state {action, at, result} on the message, so the buttons go away. A refusal is 409 with
// a reason and changes nothing; a message already acted on is 409 ALREADY_ACTED.
import type { Db } from "../db/client.js";
import type { ActionState, Task, ThreadMessage } from "../db/schema.js";
import { ToolError } from "../mcp/errors.js";
import { answer } from "../mcp/questions.js";
import { releaseGh } from "../mcp/release-ship.js";
import { SYSTEM_ACTOR, webCtx, writeTx } from "../mcp/tx.js";
import { setTask } from "../mcp/writes.js";
import { enqueueWake } from "../runner/events.js";
import { COMPANY } from "../runner/limits.js";
import type { ThreadRef } from "../runner/threads.js";
import { storeOf, readerOf } from "../store/port.js";

export const MERGE_BASE = "sandbox";
const PR = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/;
const CODE = new Set(["code", "bug", "debt"]);

export type ActionInput = { message_id: string; action: "aceptar" | "fusionar" | "cambios" | "responder"; text?: string };
export type ActionRefusal = { error: string; status: 404 | 409; hint: string; [k: string]: unknown };
export type ActionDone = { ok: true; action_state: ActionState };

const refuse = (error: string, hint: string, extra: Record<string, unknown> = {}, status: 404 | 409 = 409): ActionRefusal => ({ error, status, hint, ...extra });

async function linkedTicket(db: Db, msg: ThreadMessage, ref: ThreadRef): Promise<Task | null> {
  const link = msg.links.find((l) => l.kind === "ticket" || l.kind === "idea");
  // A link without a ref names no ticket (a missing filter value would match every key).
  if (!link || link.ref == null) return null;
  // On the company thread the key alone names it, and only when one project has it.
  const rows = await readerOf(db).find("tasks", ref.project ? { projectId: ref.project.id, key: link.ref } : { key: link.ref }, { limit: 2 });
  return rows.length === 1 ? rows[0]! : null;
}

async function projectOf(db: Db, t: Task) {
  return (await readerOf(db).get("projects", { id: t.projectId }))!;
}

// The action_state, written in a store write of its own under the thread's project.
async function record(db: Db, ref: ThreadRef, msg: ThreadMessage, state: ActionState): Promise<ActionDone> {
  await storeOf(db).write(ref.project?.id ?? COMPANY, {}, (uow) => uow.update("threadMessages", { id: msg.id }, { actionState: state }));
  return { ok: true, action_state: state };
}

const prOf = (msg: ThreadMessage, t: Task): string | null => msg.links.find((l) => l.kind === "pr" && PR.test(l.ref))?.ref ?? (t.prUrl && PR.test(t.prUrl) ? t.prUrl : null);

// PLA-I40-7: who accepts. "screen" is the owner's click; "auto" is the project's switch (src/api/auto-accept.ts).
export type AcceptBy = "screen" | "auto";

async function merge(db: Db, ref: ThreadRef, msg: ThreadMessage, t: Task, url: string, by: AcceptBy = "screen"): Promise<ActionDone | ActionRefusal> {
  const [, repo, number] = PR.exec(url)!;
  const gh = async (step: string, args: string[]) => {
    const r = await releaseGh.run(args);
    if (!r.ok) throw new ToolError("RELEASE_MERGE_FAILED", { step, output: r.stderr.slice(0, 500) });
    return r.stdout.trim();
  };
  try {
    const view = JSON.parse(await gh("view", ["pr", "view", number!, "--repo", repo!, "--json", "baseRefName,state,headRefOid,url"])) as {
      baseRefName: string;
      state: string;
      headRefOid: string;
      url: string;
    };
    // Never main, never anything but sandbox: the runner's deny rules hold for the screen too.
    if (view.baseRefName !== MERGE_BASE) return refuse("BASE_NOT_SANDBOX", `El PR apunta a ${view.baseRefName}; desde aquí solo se fusiona a ${MERGE_BASE}.`, { base: view.baseRefName });
    // Already merged into sandbox (another card or GitHub, before the poller caught up): that is the accept the
    // owner asked for. This message records it; pr.merged is not written twice (the merge already has its event
    // or the poller writes it).
    if (view.state === "MERGED") {
      const done = JSON.parse(await gh("view", ["pr", "view", number!, "--repo", repo!, "--json", "mergeCommit,url"])) as { mergeCommit: { oid: string } | null };
      return record(db, ref, msg, { action: "aceptar", at: new Date().toISOString(), result: { merged: true, already: true, pr: url, base: MERGE_BASE, sha: done.mergeCommit?.oid ?? null, ticket: t.key } });
    }
    if (view.state !== "OPEN") return refuse("PR_NOT_OPEN", `El PR #${number} está cerrado sin fusionar: pide cambios o abre otro.`, { state: view.state });
    await gh("merge", ["pr", "merge", number!, "--repo", repo!, "--merge", "--match-head-commit", view.headRefOid]);
    const after = JSON.parse(await gh("view", ["pr", "view", number!, "--repo", repo!, "--json", "mergeCommit,url"])) as { mergeCommit: { oid: string } | null; url: string };
    const sha = after.mergeCommit?.oid;
    if (!sha) return refuse("MERGE_FAILED", "GitHub no muestra el commit de fusión.", { step: "view" });
    const project = await projectOf(db, t);
    // An automatic accept is the server's write and names the evidence it stood on.
    const auto = by === "auto";
    const [pass] = auto ? await readerOf(db).find("results", { taskId: t.id, verdict: "pass" }, { orderBy: [{ column: "createdAt", desc: true }], limit: 1 }) : [];
    const ctx = auto ? { actor: SYSTEM_ACTOR, system: true, tool: "auto.accept" } : { ...webCtx, tool: "screen.thread_merge" };
    await writeTx(db, project, ctx, async (_tx, emit) => {
      await emit("pr.merged", { id: t.id, key: t.key }, { number: Number(number), url: after.url || view.url, base: MERGE_BASE, merge_sha: sha, by, message_id: msg.id, ...(auto ? { evidence_id: pass?.id ?? null } : {}) });
    });
    return record(db, ref, msg, { action: "aceptar", at: new Date().toISOString(), result: { merged: true, pr: url, base: MERGE_BASE, sha, ticket: t.key, ...(auto ? { by: "auto" } : {}) } });
  } catch (e) {
    if (e instanceof ToolError && e.code === "RELEASE_MERGE_FAILED") return refuse("MERGE_FAILED", "No se pudo fusionar el PR.", e.detail);
    throw e;
  }
}

async function accept(db: Db, msg: ThreadMessage, ref: ThreadRef, by: AcceptBy = "screen"): Promise<ActionDone | ActionRefusal> {
  const t = await linkedTicket(db, msg, ref);
  if (!t) return refuse("NO_TICKET", "El mensaje no enlaza un ticket de este hilo.");
  if (t.status !== "In review") return refuse("NOT_IN_REVIEW", `${t.key} está en ${t.status}, no En revisión.`, { key: t.key, status: t.status });
  const pr = prOf(msg, t);
  if (pr && CODE.has(t.workType ?? "code")) return merge(db, ref, msg, t, pr, by);
  // Only a PR is accepted automatically: a doc or a plan is the owner's to read.
  if (by === "auto") return refuse("NOT_A_PR", "Solo una entrega con PR se acepta sola.");
  const project = await projectOf(db, t);
  await setTask(db, { project: project.slug, key: t.key, status: "Done", version: t.version } as never, { ...webCtx, tool: "screen.thread_accept" });
  return record(db, ref, msg, { action: "aceptar", at: new Date().toISOString(), result: { ticket: t.key, status: "Done" } });
}

async function changes(db: Db, msg: ThreadMessage, ref: ThreadRef, text: string): Promise<ActionDone | ActionRefusal> {
  const t = await linkedTicket(db, msg, ref);
  if (!t) return refuse("NO_TICKET", "El mensaje no enlaza un ticket de este hilo.");
  if (["Done", "Won't do", "Merged", "Released"].includes(t.status)) return refuse("TICKET_CLOSED", `${t.key} ya está cerrado (${t.status}).`, { key: t.key, status: t.status });
  const project = await projectOf(db, t);
  await setTask(db, { project: project.slug, key: t.key, status: "Ready", version: t.version, note: `Cambios que pide Jorge: ${text}` } as never, { ...webCtx, tool: "screen.thread_changes" });
  // Moving to Ready wakes a PO-owned ticket's PO, or Taller for code (the event hook). Any other owner is
  // woken here, unless it already has a run queued or running.
  let wake: string = "event";
  if (t.ownerAgent) {
    const owner = await readerOf(db).get("agents", { id: t.ownerAgent });
    // PLA-I60-1: one run per work item; a run already on this ticket takes the request too.
    if (owner) {
      const out = await enqueueWake(db, { agent: owner, project, taskKey: t.key, reason: "changes requested" });
      wake = out.kind === "queued" || out.reason === "coalesced" ? "queued" : out.reason;
    }
  }
  return record(db, ref, msg, { action: "cambios", at: new Date().toISOString(), result: { ticket: t.key, status: "Ready", text, wake } });
}

async function reply(db: Db, ref: ThreadRef, msg: ThreadMessage, text: string): Promise<ActionDone | ActionRefusal> {
  if (!msg.questionId) return refuse("NO_QUESTION", "El mensaje no trae una pregunta.");
  const r = readerOf(db);
  const q = await r.get("questions", { id: msg.questionId });
  if (!q) return refuse("NO_QUESTION", "La pregunta ya no existe.");
  if (q.answeredAt) return refuse("ALREADY_ANSWERED", "La pregunta ya tiene respuesta.", { answer: q.answer });
  const project = await r.get("projects", { id: q.projectId });
  await answer(db, { project: project!.slug, question_id: q.id, answer: text }, { ...webCtx, tool: "screen.thread_answer" });
  return record(db, ref, msg, { action: "responder", at: new Date().toISOString(), result: { question_id: q.id, answer: text } });
}

export async function threadAction(db: Db, ref: ThreadRef, input: ActionInput, by: AcceptBy = "screen"): Promise<ActionDone | ActionRefusal> {
  // A missing message id names no message (a missing filter value would match any).
  const msg = input.message_id == null ? undefined : await readerOf(db).get("threadMessages", { id: input.message_id, threadId: ref.thread.id });
  if (!msg) return refuse("MESSAGE_NOT_FOUND", "No hay ese mensaje en este hilo.", {}, 404);
  if (msg.actionState) return refuse("ALREADY_ACTED", "Ya actuaste sobre este mensaje.", { action_state: msg.actionState });
  const text = input.text?.trim() ?? "";
  if (input.action === "aceptar" || input.action === "fusionar") return accept(db, msg, ref, by);
  if (!text) return refuse("TEXT_REQUIRED", input.action === "cambios" ? "Escribe qué cambiar." : "Escribe tu respuesta.");
  if (input.action === "cambios") return changes(db, msg, ref, text);
  return reply(db, ref, msg, text);
}
