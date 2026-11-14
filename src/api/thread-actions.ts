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
import { and, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { agentRuns, agents, projects, questions, results, tasks, threadMessages, type ActionState, type Task, type ThreadMessage } from "../db/schema.js";
import { ToolError } from "../mcp/errors.js";
import { answer } from "../mcp/questions.js";
import { releaseGh } from "../mcp/release-ship.js";
import { SYSTEM_ACTOR, webCtx, writeTx } from "../mcp/tx.js";
import { setTask } from "../mcp/writes.js";
import { enqueueWake } from "../runner/events.js";
import type { ThreadRef } from "../runner/threads.js";

export const MERGE_BASE = "sandbox";
const PR = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/;
const CODE = new Set(["code", "bug", "debt"]);

export type ActionInput = { message_id: string; action: "aceptar" | "fusionar" | "cambios" | "responder"; text?: string };
export type ActionRefusal = { error: string; status: 404 | 409; hint: string; [k: string]: unknown };
export type ActionDone = { ok: true; action_state: ActionState };

const refuse = (error: string, hint: string, extra: Record<string, unknown> = {}, status: 404 | 409 = 409): ActionRefusal => ({ error, status, hint, ...extra });

async function linkedTicket(db: Db, msg: ThreadMessage, ref: ThreadRef): Promise<Task | null> {
  const link = msg.links.find((l) => l.kind === "ticket" || l.kind === "idea");
  if (!link) return null;
  const where = ref.project ? and(eq(tasks.projectId, ref.project.id), eq(tasks.key, link.ref)) : eq(tasks.key, link.ref);
  const rows = await db.select().from(tasks).where(where).limit(2);
  return rows.length === 1 ? rows[0]! : null;
}

async function projectOf(db: Db, t: Task) {
  return (await db.select().from(projects).where(eq(projects.id, t.projectId)).limit(1))[0]!;
}

async function record(db: Db, msg: ThreadMessage, state: ActionState): Promise<ActionDone> {
  await db.update(threadMessages).set({ actionState: state }).where(eq(threadMessages.id, msg.id));
  return { ok: true, action_state: state };
}

const prOf = (msg: ThreadMessage, t: Task): string | null => msg.links.find((l) => l.kind === "pr" && PR.test(l.ref))?.ref ?? (t.prUrl && PR.test(t.prUrl) ? t.prUrl : null);

// PLA-I40-7: who accepts. "screen" is the owner's click; "auto" is the project's switch (src/api/auto-accept.ts).
export type AcceptBy = "screen" | "auto";

async function merge(db: Db, msg: ThreadMessage, t: Task, url: string, by: AcceptBy = "screen"): Promise<ActionDone | ActionRefusal> {
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
      return record(db, msg, { action: "aceptar", at: new Date().toISOString(), result: { merged: true, already: true, pr: url, base: MERGE_BASE, sha: done.mergeCommit?.oid ?? null, ticket: t.key } });
    }
    if (view.state !== "OPEN") return refuse("PR_NOT_OPEN", `El PR #${number} está cerrado sin fusionar: pide cambios o abre otro.`, { state: view.state });
    await gh("merge", ["pr", "merge", number!, "--repo", repo!, "--merge", "--match-head-commit", view.headRefOid]);
    const after = JSON.parse(await gh("view", ["pr", "view", number!, "--repo", repo!, "--json", "mergeCommit,url"])) as { mergeCommit: { oid: string } | null; url: string };
    const sha = after.mergeCommit?.oid;
    if (!sha) return refuse("MERGE_FAILED", "GitHub no muestra el commit de fusión.", { step: "view" });
    const project = await projectOf(db, t);
    // An automatic accept is the server's write and names the evidence it stood on.
    const auto = by === "auto";
    const [pass] = auto ? await db.select({ id: results.id }).from(results).where(and(eq(results.taskId, t.id), eq(results.verdict, "pass"))).orderBy(desc(results.createdAt)).limit(1) : [];
    const ctx = auto ? { actor: SYSTEM_ACTOR, system: true, tool: "auto.accept" } : { ...webCtx, tool: "screen.thread_merge" };
    await writeTx(db, project, ctx, async (_tx, emit) => {
      await emit("pr.merged", { id: t.id, key: t.key }, { number: Number(number), url: after.url || view.url, base: MERGE_BASE, merge_sha: sha, by, message_id: msg.id, ...(auto ? { evidence_id: pass?.id ?? null } : {}) });
    });
    return record(db, msg, { action: "aceptar", at: new Date().toISOString(), result: { merged: true, pr: url, base: MERGE_BASE, sha, ticket: t.key, ...(auto ? { by: "auto" } : {}) } });
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
  if (pr && CODE.has(t.workType ?? "code")) return merge(db, msg, t, pr, by);
  // Only a PR is accepted automatically: a doc or a plan is the owner's to read.
  if (by === "auto") return refuse("NOT_A_PR", "Solo una entrega con PR se acepta sola.");
  const project = await projectOf(db, t);
  await setTask(db, { project: project.slug, key: t.key, status: "Done", version: t.version } as never, { ...webCtx, tool: "screen.thread_accept" });
  return record(db, msg, { action: "aceptar", at: new Date().toISOString(), result: { ticket: t.key, status: "Done" } });
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
    const [owner] = await db.select().from(agents).where(eq(agents.id, t.ownerAgent)).limit(1);
    const [busy] = owner
      ? await db.select({ id: agentRuns.id }).from(agentRuns).where(and(eq(agentRuns.agentId, owner.id), inArray(agentRuns.status, ["queued", "running"]))).limit(1)
      : [];
    if (owner && !busy) {
      const out = await enqueueWake(db, { agent: owner, project, taskKey: t.key, reason: "changes requested" });
      wake = out.kind === "queued" ? "queued" : out.reason;
    } else if (busy) wake = "queued";
  }
  return record(db, msg, { action: "cambios", at: new Date().toISOString(), result: { ticket: t.key, status: "Ready", text, wake } });
}

async function reply(db: Db, msg: ThreadMessage, text: string): Promise<ActionDone | ActionRefusal> {
  if (!msg.questionId) return refuse("NO_QUESTION", "El mensaje no trae una pregunta.");
  const [q] = await db.select().from(questions).where(eq(questions.id, msg.questionId)).limit(1);
  if (!q) return refuse("NO_QUESTION", "La pregunta ya no existe.");
  if (q.answeredAt) return refuse("ALREADY_ANSWERED", "La pregunta ya tiene respuesta.", { answer: q.answer });
  const [project] = await db.select().from(projects).where(eq(projects.id, q.projectId)).limit(1);
  await answer(db, { project: project!.slug, question_id: q.id, answer: text }, { ...webCtx, tool: "screen.thread_answer" });
  return record(db, msg, { action: "responder", at: new Date().toISOString(), result: { question_id: q.id, answer: text } });
}

export async function threadAction(db: Db, ref: ThreadRef, input: ActionInput, by: AcceptBy = "screen"): Promise<ActionDone | ActionRefusal> {
  const [msg] = await db
    .select()
    .from(threadMessages)
    .where(and(eq(threadMessages.id, input.message_id), eq(threadMessages.threadId, ref.thread.id)))
    .limit(1);
  if (!msg) return refuse("MESSAGE_NOT_FOUND", "No hay ese mensaje en este hilo.", {}, 404);
  if (msg.actionState) return refuse("ALREADY_ACTED", "Ya actuaste sobre este mensaje.", { action_state: msg.actionState });
  const text = input.text?.trim() ?? "";
  if (input.action === "aceptar" || input.action === "fusionar") return accept(db, msg, ref, by);
  if (!text) return refuse("TEXT_REQUIRED", input.action === "cambios" ? "Escribe qué cambiar." : "Escribe tu respuesta.");
  if (input.action === "cambios") return changes(db, msg, ref, text);
  return reply(db, msg, text);
}
